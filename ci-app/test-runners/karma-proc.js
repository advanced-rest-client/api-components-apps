/* eslint-disable import/no-commonjs */
/* eslint-disable require-jsdoc */
const { config, Server } = require('karma');
const path = require('path');
const runResult = {};

function log(message) {
  process.send({ type: 'log', message });
}

const ensureBrowser = (browser) => {
  const id = browser.id;
  if (!runResult[id]) {
    runResult[id] = {
      browser: browser.name,
      logs: [],
      startTime: browser.lastResult ? browser.lastResult.startTime : Date.now(),
    };
  }
  return id;
};

const ArcCiReporter = function() {
  this.onSpecComplete = (browser, result) => {
    const id = ensureBrowser(browser);
    runResult[id].logs.push({
      suite: result.suite,
      description: result.description,
      success: result.success,
      failed: result.failed,
      total: result.total,
      skipped: result.skipped,
      errors: result.assertionErrors,
      error: result.error,
      log: result.log,
    });
  };
};

class Runner {
  async run(workingDir) {
    this.workingDir = workingDir;
    process.chdir(workingDir);
    let opts;
    try {
      opts = await this.createConfig();
    } catch (e) {
      throw new Error('No karma config found.');
    }
    log('Creating karma server...');
    // @ts-ignore
    this.server = new Server(opts, (exitCode) => {
      log(`Karma has exited with ${exitCode}`);
      this._resolve(this.getReport());
      this.server = null;
    });
    this._addListeners(this.server);
    const result = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    log('Starting karma server...');
    this.server.start();
    return result;
  }

  async createConfig() {
    const cnfFile = path.join(this.workingDir, 'karma.conf.js');
    log(`Reading tests configuration from ${cnfFile}`);
    const cnf = config.parseConfig(cnfFile, {
      reporters: ['arcci'],
    });
    // @ts-ignore
    if (!cnf.plugins) {
      // @ts-ignore
      cnf.plugins = [];
    }
    // @ts-ignore
    cnf.plugins.push({
      'reporter:arcci': ['type', ArcCiReporter],
    });
    return cnf;
  }

  getReport() {
    const keys = Object.keys(runResult);
    const report = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      error: false,
      results: [],
    };
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i];
      const browser = runResult[key];
      report.total += browser.total || 0;
      report.success += browser.success || 0;
      report.failed += browser.failed || 0;
      report.skipped += browser.skipped || 0;
      report.results.push(browser);
      if (!report.error && (browser.error || browser.failed)) {
        report.error = true;
      }
    }
    return report;
  }

  _addListeners(srv) {
    srv.on('browser_complete', this._browserComplete.bind(this));
    srv.on('browser_error', this._browserError.bind(this));
  }

  _browserComplete(browser, result) {
    const id = ensureBrowser(browser);
    const lastResult = browser.lastResult || {};
    const b = runResult[id];
    b.total = lastResult.total || 0;
    b.success = lastResult.success || 0;
    b.failed = lastResult.failed || 0;
    b.skipped = lastResult.skipped || 0;
    b.error = lastResult.error;
    b.endTime = lastResult.endTime || Date.now();
  }

  _browserError(browser, error) {
    const id = ensureBrowser(browser);
    const b = runResult[id];
    b.error = true;
    b.message = String(error);
    const lastResult = browser.lastResult || {};
    b.total = lastResult.total || 0;
    b.success = lastResult.success || 0;
    b.failed = lastResult.failed || 0;
    b.skipped = lastResult.skipped || 0;
    b.endTime = lastResult.endTime || Date.now();
  }
}

process.on('message', async (data) => {
  const runner = new Runner();
  try {
    const result = await runner.run(data.workingDir);
    process.send({ type: 'result', result });
  } catch (cause) {
    process.send({ type: 'error', message: cause.message });
  }
});
