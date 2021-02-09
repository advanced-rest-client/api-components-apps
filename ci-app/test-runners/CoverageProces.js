/* eslint-disable import/no-commonjs */
const { config, Server } = require('karma');
const path = require('path');

/** @typedef {import('karma').Config} Config */

/**
 * Sends a log message to the parent.
 * @param {any} message
 */
function log(message) {
  process.send({ type: 'log', message });
}

/**
 * The test runner.
 */
class Runner {
  /**
   * Runs a test for the current component.
   * @param {string} workingDir A dire where the component is located.
   * @return {Promise<void>}
   */
  async run(workingDir) {
    this.workingDir = workingDir;
    process.chdir(workingDir);
    const opts = await this.createConfig();
    log('Creating karma server...');
    // @ts-ignore
    this.server = new Server(opts, (exitCode) => {
      log(`Karma has exited with ${exitCode}`);
      this._resolve();
      this.server = null;
    });
    const result = new Promise((resolve) => {
      this._resolve = resolve;
    });
    log('Starting karma server...');
    this.server.start();
    return result;
  }

  /**
   * Creats configuration for
   * @return {Promise<Config>} [description]
   */
  async createConfig() {
    const cnfFile = path.join(this.workingDir, 'karma.conf.js');
    log(`Reading tests configuration from ${cnfFile}`);
    const cnf = config.parseConfig(cnfFile, {});
    return cnf;
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
