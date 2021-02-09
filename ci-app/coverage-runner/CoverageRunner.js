import { BaseBuild } from '../builds/base-build.js';
import { CoverageModel } from '../models/CoverageModel.js';
import logging from '../lib/logging.js';
import { CoverageTestRunner } from '../test-runners/CoverageTestRunner.js';

/** @typedef {import('../models/CoverageModel.js').CoverageRun} CoverageRun */
/** @typedef {import('../models/CoverageModel.js').CoverageSummaryResult} CoverageSummaryResult */
/** @typedef {import('../models/CoverageModel.js').CoverageResult} CoverageResult */

/**
 * A class that runs a coverage tests.
 */
export class CoverageRunner extends BaseBuild {
  /**
   * @param {string} id Coverage run id
   * @param {CoverageRun} runInfo Run info model.
   */
  constructor(id, runInfo) {
    super();
    this.id = id;
    this.runInfo = runInfo;
    /**
     * Whether or not this runner is running.
     * @type {Boolean}
     */
    this.running = false;
    /**
     * Whether or not this runner has been stopped.
     * @type {Boolean}
     */
    this.abort = false;
    /**
     * Data model
     * @type {CoverageModel}
     */
    this.model = new CoverageModel();
    /**
     * Component working directory
     * @type {string|null}
     */
    this.workingDir = null;
  }

  /**
   * Runs the test and collects coverage data for a project.
   * @return {Promise<void>}
   */
  async run() {
    this.running = true;
    try {
      await this.model.start(this.id);
      this.workingDir = await this.createWorkingDir();
      this.emit('status', 'running');
      setImmediate(() => this._run());
    } catch (e) {
      this.emit('status', 'error', e.message);
      await this.reportError(e);
    }
  }

  /**
   * Runs the test.
   * @return {Promise<void>}
   */
  async _run() {
    if (this.abort) {
      return;
    }
    const runner = new CoverageTestRunner(this.runInfo, this.workingDir);
    try {
      const result = /** @type CoverageResult */ (await runner.run());
      await this.reportResult(result);
      this.emit('end');
    } catch (e) {
      await this.reportError(e);
    }
  }

  /**
   * Reports happy finish.
   * @param {CoverageResult} result Coverage data.
   * @return {Promise<void>}
   */
  async reportResult(result) {
    if (this.abort) {
      return;
    }
    logging.info(`Component finished with success.`);
    await this.model.finishRun(this.id, result);
  }

  /**
   * Reports run error.
   * @param {Error} err The error object
   */
  async reportError(err) {
    if (this.abort) {
      return;
    }
    // console.error(err);
    logging.info('Test finished with error.');
    logging.error(err.stack || err.message);
    let msg;
    if (err.message) {
      msg = err.message;
    }
    if (!msg) {
      msg = 'Unknown error occurred';
    }
    try {
      await this.model.runError(this.id, msg);
      await this.cleanup();
    } catch (cause) {
      logging.error(cause.stack || cause.message);
    }
    this.running = false;
    this.emit('end');
  }
}
