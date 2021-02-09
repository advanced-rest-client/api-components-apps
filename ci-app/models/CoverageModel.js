import semver from 'semver';
import background from '../lib/background.js';
import logging from '../lib/logging.js';
import { BaseModel } from './base-model.js';
import { v4 as uuidv4 } from 'uuid';

/** @typedef {import('@google-cloud/datastore/build/src/entity').entity.Key} Key */
/** @typedef {import('@google-cloud/datastore').Transaction} Transaction */

/**
 * @typedef {object} Creator
 * @property {string} id Creator ID
 * @property {string} displayName Creator name
 */

/**
 * @typedef {object} InsertCoverageOptions
 * @property {string=} branch Component's branch. Default to "master".
 * @property {string} component The name of the component
 * @property {string} org GitHub organization of the component.
 * @property {string} tag The release tag (version) of the component.
 * @property {Creator=} creator If the build is scheduled by a person then this person't info.
 */
/**
 * @typedef {object} CoverageSummaryResult
 * @property {number=} functions Coverage of functions
 * @property {number=} lines Coverage of lines
 * @property {number=} branches Coverage of branches
 * @property {number} coverage Total coverage
 */
/**
 * @typedef {object} CoverageRun
 * @property {string=} branch Component's branch. Default to "master".
 * @property {string} component The name of the component
 * @property {string} org GitHub organization of the component.
 * @property {string} tag The release tag (version) of the component.
 * @property {Creator=} creator If the build is scheduled by a person then this person't info.
 * @property {string} id The ID of an object. It is not the same as the data store key.
 * @property {number} created Timestamp of when the object was created.
 * @property {string} status Current status of the test run.
 * @property {CoverageSummaryResult=} coverage The summary result of the coverage run.
 * @property {number=} startTime Timestamp when the test started
 * @property {number=} endTime Timestamp when the test finished
 * @property {boolean=} error A flag determinig that the test resulted with an error
 * @property {string=} message An error message.
 */

/**
 * @typedef {object} CoverageFileRest
 * @property {number} hit Covered number
 * @property {number} found The total ocurrances
 */

/**
 * @typedef {object} CoverageReport
 * @property {string=} title Test title
 * @property {string} file The file from which the report is coming from
 * @property {CoverageFileRest} functions Coverage result for functions
 * @property {CoverageFileRest} lines Coverage result for lines
 * @property {CoverageFileRest} branches Coverage result for branches
 * @property {number} coverage Total coverage for the file
 */

/**
 * @typedef {object} CoverageQueryResult
 * @property {CoverageRun[]} entities The list of entities
 * @property {string=} pageToken The page token used in pagination
 */

/**
 * @typedef {Object} CoverageResult
 * @property {CoverageSummaryResult} summary The summary value for the coverage runs listing
 * @property {CoverageReport[]} details Detailed results per file.
 */

/**
 * Properties excluded from indexes
 * @type {string[]}
 */
const excludedIndexes = [
  'branch',
  'component',
  'org',
  'tag',
  'status',
  'functions',
  'lines',
  'branches',
  'branches',
  'coverage',
  'startTime',
  'endTime',
  'error',
  'message',
  'creator',
  'creator.id',
  'creator.displayName',
  'coverage',
  'coverage.functions',
  'coverage.lines',
  'coverage.branches',
  'coverage.coverage',
];

/**
 * A model for catalog items.
 */
export class CoverageModel extends BaseModel {
  /**
   * @constructor
   */
  constructor() {
    super('api-components-coverage');
  }

  /**
   * Lists test runs
   * @param {number=} [limit=25] A number of results to return.
   * @param {string=} nextPageToken A page token value.
   * @return {Promise<CoverageQueryResult>} Query results.
   */
  async list(limit=25, nextPageToken) {
    let query = this.store.createQuery(this.namespace, this.testKind);
    query = query.limit(limit);
    query = query.order('created', {
      descending: true,
    });
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    const [entitiesRaw, queryInfo] = await this.store.runQuery(query);
    const entities = /** @type CoverageRun[] */ (entitiesRaw.map(this.fromDatastore.bind(this)));
    const pageToken = queryInfo.moreResults !== this.NO_MORE_RESULTS ? queryInfo.endCursor : undefined;
    return {
      entities,
      pageToken,
    };
  }

  /**
   * Insert a definition of a coverage run to the data store.
   * @param {InsertCoverageOptions} info Test definition.
   * @return {Promise<CoverageRun>} The created resource
   */
  async insert(info) {
    const now = Date.now();
    const keyName = uuidv4();
    const key = this.createCoverageRunKey(keyName);
    const { branch='master', component, org, tag } = info;
    const insert = /** @type InsertCoverageOptions */ ({
      branch,
      created: now,
      status: 'queued',
      component,
      org,
      tag,
    });
    if (info.creator) {
      insert.creator = info.creator;
    }
    const entity = {
      key,
      data: insert,
      excludeLargeProperties: true,
      excludeFromIndexes: excludedIndexes,
    };
    await this.store.upsert(entity);
    logging.info(`Created coverage run entry: ${keyName}`);
    background.queueCoverageRun(keyName);
    return this.get(keyName);
  }

  // /**
  //  * Resets a run state of a coverage for a component.
  //  * @param {String} runId The id of the test run.
  //  * @return {Promise<void>}
  //  */
  // async reset(runId) {
  //   const transaction = this.store.transaction();
  //   const key = this.createCoverageRunKey(runId);
  //   try {
  //     await transaction.run();
  //     const data = await transaction.get(key);
  //     const run = /** @type CoverageRun */ (data[0]);
  //     run.status = 'queued';
  //     delete run.functions;
  //     delete run.lines;
  //     delete run.branches;
  //     delete run.coverage;
  //     delete run.endTime;
  //     delete run.error;
  //     delete run.message;
  //     transaction.save({
  //       key,
  //       data: run,
  //       excludeFromIndexes: excludedIndexes,
  //     });
  //     await transaction.commit();
  //     background.queueCoverageRun(runId);
  //   } catch (e) {
  //     transaction.rollback();
  //     throw e;
  //   }
  // }

  /**
   * Reads a single coverage run from the data store
   * @param {string} id The id of the coverage run
   * @return {Promise<CoverageRun>}
   */
  async get(id) {
    const key = this.createCoverageRunKey(id);
    const entity = await this.store.get(key);
    const result = entity && entity[0];
    if (result) {
      return this.fromDatastore(result);
    }
  }

  /**
   * Marks coverage run as started
   * @param {string} runId The id of the coverage run
   */
  async start(runId) {
    const transaction = this.store.transaction();
    const key = this.createCoverageRunKey(runId);
    try {
      await transaction.run();
      const data = await transaction.get(key);
      const run = /** @type CoverageRun */ (data[0]);
      run.status = 'running';
      run.startTime = Date.now();
      transaction.save({
        key,
        data: run,
        excludeFromIndexes: excludedIndexes,
      });
      await transaction.commit();
    } catch (e) {
      transaction.rollback();
      throw e;
    }
  }

  /**
   * Marks coverage run as error
   * @param {string} runId The id of the coverage run
   * @param {string} message Error message to store
   */
  async runError(runId, message) {
    const transaction = this.store.transaction();
    const key = this.createCoverageRunKey(runId);
    try {
      await transaction.run();
      const data = await transaction.get(key);
      const run = /** @type CoverageRun */ (data[0]);
      run.status = 'finished';
      run.endTime = Date.now();
      run.error = true;
      run.message = message;
      transaction.save({
        key,
        data: run,
        excludeFromIndexes: excludedIndexes,
      });
      await transaction.commit();
    } catch (e) {
      transaction.rollback();
      throw e;
    }
  }

  /**
   * Makrs tests as finished with the coverage results
   * @param {string} runId The id of the coverage run
   * @param {CoverageResult} coverage Coverage results
   * @return {Promise<void>}
   */
  async finishRun(runId, coverage) {
    const transaction = this.store.transaction();
    const key = this.createCoverageRunKey(runId);
    try {
      await transaction.run();
      const data = await transaction.get(key);
      const run = /** @type CoverageRun */ (data[0]);
      this._finishRunSummary(transaction, key, run, coverage);
      this._addComponentCoverageRun(transaction, run, coverage);
      this._addComponentVersionCoverage(transaction, run, coverage);
      await this._addComponentCoverage(transaction, run, coverage);
      await transaction.commit();
    } catch (e) {
      transaction.rollback();
      throw e;
    }
  }

  /**
   * Updates values on the coverage run and stores the data in a transaction.
   * @param {Transaction} transaction Datastore transaction
   * @param {Key} key Datastore key
   * @param {CoverageRun} run Coverage run model
   * @param {CoverageResult} coverage Coverage results
   */
  _finishRunSummary(transaction, key, run, coverage) {
    run.status = 'finished';
    run.endTime = Date.now();
    const report = { ...coverage.summary };
    if (report.branches === null) {
      delete report.branches;
    }
    if (report.functions === null) {
      delete report.functions;
    }
    if (report.lines === null) {
      delete report.lines;
    }
    run.coverage = report;
    transaction.save({
      key,
      data: run,
      excludeFromIndexes: excludedIndexes,
    });
  }

  /**
   * Creates coverage data entry for a component version
   * @param {Transaction} transaction Datastore transaction
   * @param {CoverageRun} run Coverage run model
   * @param {CoverageResult} coverage Coverage results
   */
  _addComponentCoverageRun(transaction, run, coverage) {
    const { details } = coverage;
    const { component, tag, org } = run;
    details.forEach((detail) => {
      const { file, title, functions, lines, branches, coverage } = detail;
      const key = this.createComponentVersionFileCoverageKey(component, org, tag, file);
      transaction.save({
        key,
        excludeFromIndexes: [
          'file',
          'title',
          'functions',
          'functions.hit',
          'functions.found',
          'lines',
          'lines.hit',
          'lines.found',
          'branches',
          'branches.hit',
          'branches.found',
          'coverage',
        ],
        data: {
          file,
          title,
          functions,
          lines,
          branches,
          coverage,
        },
      });
    });
  }

  /**
   * Creates coverage data entry for a component version
   * @param {Transaction} transaction Datastore transaction
   * @param {CoverageRun} run Coverage run model
   * @param {CoverageResult} coverage Coverage results
   */
  _addComponentVersionCoverage(transaction, run, coverage) {
    const { summary } = coverage;
    const { component, tag, org } = run;
    const key = this.createComponentVersionCoverageKey(component, org, tag);
    transaction.save({
      key,
      excludeFromIndexes: [
        'coverage',
        'coverage.functions',
        'coverage.lines',
        'coverage.branches',
        'coverage.coverage',
        'version',
      ],
      data: {
        coverage: summary,
        version: tag,
      },
    });
  }

  /**
   * Creates coverage data entry for a component, if version is greater than
   * the current stored in the data store.
   *
   * @param {Transaction} transaction Datastore transaction
   * @param {CoverageRun} run Coverage run model
   * @param {CoverageResult} coverage Coverage results
   */
  async _addComponentCoverage(transaction, run, coverage) {
    const { component, tag, org } = run;
    if (semver.prerelease(tag)) {
      return;
    }
    const key = this.createComponentCoverageKey(component, org);
    const data = await transaction.get(key);
    if (data && data[0]) {
      const { version } = data[0];
      if (semver.gt(version, tag)) {
        return;
      }
    }
    const { summary } = coverage;
    transaction.save({
      key,
      excludeFromIndexes: [
        'coverage',
        'coverage.functions',
        'coverage.lines',
        'coverage.branches',
        'coverage.coverage',
        'version',
      ],
      data: {
        coverage: summary,
        version: tag,
      },
    });
  }

  /**
   * Removes the coverage run.
   * @param {string} runId The id of the coverage run
   * @return {Promise<void>}
   */
  async delete(runId) {
    await background.dequeueCoverageRun(runId);
    const key = this.createCoverageRunKey(runId);
    await this.store.delete(key);
  }
}
