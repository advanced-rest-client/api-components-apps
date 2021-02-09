import path from 'path';
import lcovParse from 'lcov-parse';
import { BaseTestRunner } from './base-test-runner.js';
import logging from '../lib/logging.js';
import { spawn } from 'child_process';

/** @typedef {import('../models/CoverageModel.js').CoverageRun} CoverageRun */
/** @typedef {import('../models/CoverageModel.js').CoverageSummaryResult} CoverageSummaryResult */
/** @typedef {import('../models/CoverageModel.js').CoverageReport} CoverageReport */
/** @typedef {import('../models/CoverageModel.js').CoverageResult} CoverageResult */


/**
 * Runs the component test via `npm test` command.
 * @param {string} cwd Working directory for the command
 * @return {Promise<void>}
 */
async function runTest(cwd) {
  logging.info(`Running a test in ${cwd}`);
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const options = {
      env,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      cwd,
    };
    // @ts-ignore
    const test = spawn('npm', ['test'], options);
    test.on('close', () => {
      logging.info(`Test ended.`);
      resolve();
    });
    test.on('error', (err) => {
      logging.error(`The test resulted in error ${err}`);
      reject(err);
    });
  });
}

/**
 * Computes percentage of the coverage.
 *
 * @param {number} total The total number of processed items
 * @param {number} hits The number of hits
 * @return {number|null} Coverage result. Null means it's not applicable
 */
function computeCoverage(total, hits) {
  if (hits === 0 && total > 0) {
    return 0;
  }
  if (total === 0 || hits === 0) {
    return null;
  }
  const result = (hits/total) * 100;
  return Number(result.toFixed(2));
}

/**
 * Runs tests for a component and reports back coverage results.
 */
export class CoverageTestRunner extends BaseTestRunner {
  /**
   * @param {CoverageRun} runInfo
   * @param {string} workingDir
   */
  constructor(runInfo, workingDir) {
    const { branch, component, org } = runInfo;
    const config = {
      branch,
      type: 'coverage',
    };
    super(org, component, null, config);
    this.workingDir = workingDir;
  }

  /**
   * Runs the test and collects lcov data.
   * @return {Promise<CoverageResult>}
   */
  async _run() {
    const componentDir = path.join(this.workingDir, this.component);
    await runTest(componentDir);
    return this.collectLcovData();
  }

  /**
   * Creates a summary result from the coverage data.
   * @return {Promise<CoverageResult>}
   */
  async collectLcovData() {
    const data = await this.readCoverage();
    const summary = this.computeSummary(data);
    const details = this.computeDetails(data);
    return {
      summary,
      details,
    }
  }

  /**
   * Computes coverage summary report for the test run datastore entry
   * @param {Array<object>} data Parsed lcov data
   * @return {CoverageSummaryResult}
   */
  computeSummary(data) {
    let f = 0;
    let fHit = 0;
    let b = 0;
    let bHit = 0;
    let l = 0;
    let lHit = 0;
    let t = 0;
    let tHit = 0;
    data.forEach((info) => {
      const { functions={}, lines={}, branches={} } = info;
      f += functions.found || 0;
      t += f;
      fHit += functions.hit || 0;
      tHit += fHit;
      b += branches.found || 0;
      t += b;
      bHit += branches.hit;
      tHit += bHit;
      l += lines.found || 0;
      t += l;
      lHit += lines.hit || 0;
      tHit += lHit;
    });
    const branches = computeCoverage(b, bHit);
    const lines = computeCoverage(l, lHit);
    const functions = computeCoverage(f, fHit);
    const coverage = computeCoverage(t, tHit);
    const result = {
      coverage: coverage || 0,
      branches,
      lines,
      functions,
    };
    return result;
  }

  /**
   * Computes coverage detailed report per each covered file.
   * @param {Array<object>} data Parsed lcov data
   * @return {CoverageReport[]}
   */
  computeDetails(data) {
    return data.map((file) => this.computeFileDetails(file));
  }

  /**
   * Computes coverage detailed report for a file.
   * @param {object} data Parsed lcov data for a file
   * @return {CoverageReport}
   */
  computeFileDetails(data) {
    const { title, file, functions={}, lines={}, branches={} } = data;
    const base = path.join(this.workingDir, this.component);
    const localFile = String(file).replace(base, '').substr(1);
    const result = {
      file: localFile,
      functions: {
        hit: functions.hit || 0,
        found: functions.found || 0,
      },
      lines: {
        hit: lines.hit || 0,
        found: lines.found || 0,
      },
      branches: {
        hit: branches.hit || 0,
        found: branches.found || 0,
      },
      coverage: 0,
    };
    const total = result.functions.found + result.lines.found + result.branches.found;
    const hit = result.functions.hit + result.lines.hit + result.branches.hit;
    result.coverage = computeCoverage(total, hit);
    if (title) {
      result.title = title;
    }
    return result;
  }

  /**
   * Reads the data from the coverage file.
   * @return {Promise<Object[]>} Result of parsing the data.
   * @see https://www.npmjs.com/package/lcov-parse
   */
  async readCoverage() {
    const file = path.join(this.workingDir, this.component, 'coverage', 'lcov.info');
    return new Promise((resolve, reject) => {
      lcovParse(file, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }
}
