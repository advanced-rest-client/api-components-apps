import { EventEmitter } from 'events';
import { ComponentBuildModel } from '../models/component-build-model.js';
import { StageBuild } from './stage-build.js';
import { MasterBuild } from './master-build.js';
import { TagBuild } from './tag-build.js';

/**
 * A class that runs GitHub webhooks builds.
 */
export class ApicBuildRunner extends EventEmitter {
  /**
   * @param {string} id The data store ID of the build.
   */
  constructor(id) {
    super();
    this.id = id;
    this.running = false;
    this.abort = false;
    this.model = new ComponentBuildModel();
  }

  /**
   * Runs the current build.
   * @return {Promise<void>}
   */
  async run() {
    await this.model.startBuild(this.id);
    const info = await this.model.get(this.id);
    await this._process(info);
  }

  /**
   * Executes corresponding to the configured branch build.
   * @param {object} model Read from the data store info model.
   * @return {Promise<void>}
   */
  async _process(model) {
    switch (model.type) {
      case 'stage-build':
        return this._buildStage(model);
      case 'master-build':
        return this._buildMaster(model);
      case 'tag-build':
        return this._buildTag(model);
      default:
        throw new Error('Unsupported build type.');
    }
  }

  /**
   * Runs the stage build process.
   * @param {object} model Read from the data store info model.
   * @return {Promise<void>}
   */
  async _buildStage(model) {
    this.running = true;
    const runner = new StageBuild(model);
    try {
      await runner.build();
      await this.notifyEnd();
    } catch (e) {
      this.notifyError(e);
    }
  }

  /**
   * Runs the master branch build process.
   * @param {object} model Read from the data store info model.
   * @return {Promise<void>}
   */
  async _buildMaster(model) {
    this.running = true;
    const runner = new MasterBuild(model);
    try {
      await runner.build();
      await this.notifyEnd();
    } catch (e) {
      this.notifyError(e);
    }
  }

  /**
   * Runs the tag build process.
   * @param {object} model Read from the data store info model.
   * @return {Promise<void>}
   */
  async _buildTag(model) {
    this.running = true;
    const runner = new TagBuild(model);
    try {
      await runner.build();
      await this.notifyEnd();
    } catch (e) {
      this.notifyError(e);
    }
  }

  /**
   * Updates the model after finishing the task.
   * @return {Promise<void>}
   */
  async notifyEnd() {
    this.running = false;
    try {
      await this.model.finishBuild(this.id);
    } catch (_) {
      // ...
    }
    this.emit('end');
  }

  /**
   * Updates the model after an error.
   * @param {Error} cause The error object
   * @return {Promise<void>}
   */
  async notifyError(cause) {
    this.running = false;
    try {
      await this.model.setBuildError(this.id, cause.message);
    } catch (_) {
      // ...
    }
    this.emit('error', cause);
  }
}
