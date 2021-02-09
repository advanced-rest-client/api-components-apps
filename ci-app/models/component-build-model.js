import background from '../lib/background.js';
import logging from '../lib/logging.js';
import { BaseModel } from './base-model.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {object} InsertComponentBuildOptions
 * @property {string} branch Component's branch. Default to "master".
 * @property {string} component The name of the component
 * @property {string} org GitHub organization of the component.
 * @property {string} type The type of the build
 * @property {string} commit The commit SHA
 * @property {string} sshUrl SSH URL of the repository
 * @property {boolean=} bumpVersion Whether or not version should be bumped when nurrning the build.
 * @property {number=} startTime Timestamp when the build started
 * @property {number=} endTime Timestamp when the build finished
 * @property {boolean=} error A flag determinig that the test resulted with an error
 * @property {string=} message An error message.
 */


/**
 * @typedef {InsertComponentBuildOptions} ComponentBuild
 * @property {string} id The ID of an object. It is not the same as the data store key.
 * @property {number} created Timestamp of when the object was created.
 * @property {string} status Current status of the build
 */

/**
 * @typedef {object} ComponentBuildQueryResult
 * @property {ComponentBuild[]} entities The list of entities
 * @property {string=} pageToken The page token used in pagination
 */

/**
 * A list of properties to exclude from indexing.
 * @type {string[]}
 */
const excludedIndexes = [
  'type', 'commit', 'branch', 'status', 'component', 'error', 'message', 'sshUrl', 'org', 'bumpVersion',
];



/**
 * A model for catalog items.
 */
export class ComponentBuildModel extends BaseModel {
  /**
   * @constructor
   */
  constructor() {
    super('api-components-builds');
  }

  /**
   * Lists test runs
   * @param {number=} [limit=25] A number of results to return.
   * @param {string=} nextPageToken A page token value.
   * @return {Promise<ComponentBuildQueryResult>} Query results.
   */
  async list(limit=25, nextPageToken) {
    let query = this.store.createQuery(this.namespace, this.buildKind);
    query = query.order('created', {
      descending: true,
    });
    query = query.limit(limit);
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    const [entitiesRaw, queryInfo] = await this.store.runQuery(query);
    const entities = entitiesRaw.map(this.fromDatastore.bind(this));
    const pageToken = queryInfo.moreResults !== this.NO_MORE_RESULTS ? queryInfo.endCursor : undefined;
    return {
      entities,
      pageToken,
    };
  }

  /**
   * Creates a new build.
   * @param {InsertComponentBuildOptions} info Build definition.
   * @return {Promise<ComponentBuild>} The created build
   */
  async insertBuild(info) {
    const now = Date.now();
    const id = uuidv4();
    const key = this.createBuildKey(id);
    const results = [
      {
        name: 'type',
        value: info.type,
        excludeFromIndexes: true,
      },
      {
        name: 'branch',
        value: info.branch,
        excludeFromIndexes: true,
      },
      {
        name: 'created',
        value: now,
      },
      {
        name: 'status',
        value: 'queued',
        excludeFromIndexes: true,
      },
      {
        name: 'component',
        value: info.component,
        excludeFromIndexes: true,
      },
      {
        name: 'commit',
        value: info.commit,
        excludeFromIndexes: true,
      },
      {
        name: 'sshUrl',
        value: info.sshUrl,
        excludeFromIndexes: true,
      },
      {
        name: 'org',
        value: info.org,
        excludeFromIndexes: true,
      },
    ];

    if (typeof info.bumpVersion === 'boolean') {
      results[results.length] = {
        name: 'bumpVersion',
        // @ts-ignore
        value: info.bumpVersion,
        excludeFromIndexes: true,
      };
    }

    const entity = {
      key,
      data: results,
    };

    await this.store.upsert(entity);
    logging.info(`Created build entry: ${id}`);
    background.queueStageBuild(id);
    return this.get(id);
  }

  /**
   * Reads the build info
   * @param {string} id The ID of the build
   * @return {Promise<ComponentBuild>}
   */
  async get(id) {
    const key = this.createBuildKey(id);
    const [entry] = await this.store.get(key);
    return this.fromDatastore(entry);
  }

  /**
   * Updates the build to set status to running.
   * @param {string} id The ID of the build
   * @return {Promise<void>}
   */
  async startBuild(id) {
    await this.updateBuildProperties(id, {
      status: 'running',
      startTime: Date.now(),
    });
  }

  /**
   * Resets the build data
   * @param {string} id The ID of the build
   * @return {Promise<void>}
   */
  async restartBuild(id) {
    await this.updateBuildProperties(id, {
      status: 'queued',
      startTime: Date.now(),
      endTime: 0,
      message: '',
      error: false,
    });
  }

  /**
   * Updates the build to set error.
   * @param {string} id The ID of the build
   * @param {string} message Error message to set
   * @return {Promise<void>}
   */
  async setBuildError(id, message) {
    await this.updateBuildProperties(id, {
      status: 'finished',
      endTime: Date.now(),
      error: true,
      message,
    });
  }

  /**
   * Updates the build to set finished state
   * @param {string} id The ID of the build
   * @param {string=} message Additional message to set.
   * @return {Promise<void>}
   */
  async finishBuild(id, message) {
    const props = {
      status: 'finished',
      endTime: Date.now(),
    };
    if (message) {
      props.message = message;
    }
    await this.updateBuildProperties(id, props);
  }

  /**
   * Updates build properties in the data store.
   * It uses a transation to update values.
   *
   * @param {string} id The ID of the build
   * @param {object} props Properties to update
   * @return {Promise<void>}
   */
  async updateBuildProperties(id, props) {
    const transaction = this.store.transaction();
    const key = this.createBuildKey(id);
    try {
      await transaction.run();
      const data = await transaction.get(key);
      const [test] = data;
      Object.keys(props).forEach((key) => {
        test[key] = props[key];
      });
      transaction.save({
        key,
        data: test,
        excludeFromIndexes: excludedIndexes,
      });
      await transaction.commit();
    } catch (e) {
      transaction.rollback();
      throw e;
    }
  }

  /**
   * Deletes a build run.
   * @param {string} id The ID of the build
   * @return {Promise<void>}
   */
  async delete(id) {
    background.dequeueBuild(id);
    const key = this.createBuildKey(id);
    await this.store.delete(key);
  }
}
