import path from 'path';
import { BaseBuild } from '../builds/base-build.js';
import { AmfModelGenerator } from './amf-model-generator.js';
import { DependendenciesManager } from './dependencies-manager.js';
import logging from '../lib/logging.js';
import { GitSourceControl } from '../github/git-source-control.js';

/**
 * Base test runner for all types of tests.
 */
export class BaseTestRunner extends BaseBuild {
  /**
   * @param {string} org Organization name
   * @param {string} component Name of the component/project
   * @param {string} pkgName The name of the package
   * @param {object} config Datastore entry.
   */
  constructor(org, component, pkgName, config) {
    super();
    this.org = org;
    this.component = component;
    this.pkgName = pkgName;
    this.repoName = `${org}/${component}`;
    this.testConfig = config;
    this.abort = false;
  }

  /**
   * 1. Create tmp dir
   * 2. Clone repo
   * 3. Install dependencies
   * 4. Create AMF models (AMF build)
   * 5. Run test via `_run()` (child method)
   * 5. Create report.
   *
   * @return {Promise}
   */
  async run() {
    if (!this.workingDir) {
      this.workingDir = await this.createWorkingDir();
    }
    this.componentDir = path.join(this.workingDir, this.component);
    await this._prepareComponent();
    const result = await this._run();
    return result;
  }

  /**
   * @abstract
   * @return {Promise<any>}
   */
  async _run() {
    return !this.abort;
  }

  /**
   * 1. Clone repo
   * 2. Create AMF model (AMF build)
   * 3. Install dependencies
   * @return {Promise}
   */
  async _prepareComponent() {
    const { component } = this;
    logging.verbose(`Preparing ${component} component to run in test`);
    const github = new GitSourceControl(this.workingDir, this.org, this.component);
    let branch;
    if (this.testConfig.type === 'bottom-up') {
      branch = this.testConfig.branch || 'stage';
    }
    await github.clone(false, branch);
    if (this.testConfig.type === 'amf-build') {
      await this.updateModels(component);
    }
    await this._prepareDependencies(component);
    logging.verbose(`Component ${component} is ready`);
  }

  /**
   * Installs dependencies of a component.
   * @param {String} component Component name
   * @return {Promise}
   */
  async _prepareDependencies(component) {
    if (this.abort) {
      return;
    }
    logging.verbose(`Installing dependencies for ${component}`);
    const dm = new DependendenciesManager(path.join(this.workingDir, component));
    let extra;
    if (this.testConfig.type === 'bottom-up') {
      const { component, org } = this.testConfig;
      const name = component.split('/')[1];
      extra = {
        component: name,
        org,
        pkgName: component,
        branch: this.testConfig.branch,
      };
    }
    try {
      await dm.installDependencies(extra);
    } catch (cause) {
      logging.error(`Cannot Install dependencies for ${component}`);
      logging.error(cause.stack || cause.message);
      throw cause;
    }
  }

  /**
   * Generates AMF model for AMF type test.
   *
   * @param {String} component Component name
   * @return {Promise}
   */
  async updateModels(component) {
    if (this.abort) {
      return;
    }
    logging.verbose(`Generating API models for ${component}`);
    const updater = new AmfModelGenerator(this.workingDir, component);
    try {
      await updater.generate();
    } catch (cause) {
      logging.error(`Cannot generate AMF model for ${component}`);
      logging.error(cause.stack || cause.message);
      throw cause;
    }
    logging.verbose('API model generated.');
  }
}
