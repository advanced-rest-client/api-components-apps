import fs from 'fs-extra';
import path from 'path';
import logging from '../lib/logging.js';
import { DependencyModel } from '../models/dependency-model.js';

/**
 * A class reposonsilble for building the dependency graph
 */
export class DependencyGraph {
  /**
   * @param {string} workingDir Component location.
   * @param {string} org Component's organization name
   * @param {string} component Component name from ARC organization.
   */
  constructor(workingDir, org, component) {
    this.component = component;
    this.organization = org;
    this.workingDir = workingDir;
    this.model = new DependencyModel();
  }

  /**
   * Builds dependency graph information for a component
   * @return {Promise<void>}
   */
  async buildGraph() {
    logging.verbose('Building dependency graph...');
    const pkg = await this.readPackage();
    const [deps, dev] = await this.readProjectDependencies(pkg);
    await this.processDepenedencies(deps, dev, pkg.name);
    logging.verbose('Dependency graph ready.');
  }

  /**
   * Reads package.json file to an object.
   * @return {Promise<object>}
   */
  async readPackage() {
    const file = path.join(this.workingDir, 'package.json');
    return fs.readJson(file);
  }

  /**
   * Reads dependencies from bower/package file.
   * @param {Object} pkg Componennt package contents≥
   * @return {Promise<object[]>} First item is a map of dependencies and second item is a
   * map of dev dependencies. Both can be undefined.
   */
  async readProjectDependencies(pkg) {
    let deps;
    if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
      deps = pkg.dependencies;
    }
    let devDeps;
    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length) {
      devDeps = pkg.devDependencies;
    }
    return [deps, devDeps];
  }

  /**
   * Filters out all non ARC/API components.
   * @param {object} deps Bower/Npm dependencies map
   * @return {string[]} List of ARC/API components dependencies
   */
  filterDependencies(deps) {
    const result = [];
    for (let [key, value] of Object.entries(deps)) {
      if (key.indexOf('@advanced-rest-client') === 0 || key.indexOf('@api-components') === 0) {
        result[result.length] = key;
        continue;
      }
      const index = value.indexOf('advanced-rest-client/');
      if (index === -1) {
        continue;
      }
      value = value.substr(21);
      const hash = value.indexOf('#');
      if (hash !== -1) {
        value = value.substr(0, hash);
      }
      result[result.length] = value;
    }
    return result.length ? result : undefined;
  }

  /**
   * Filters and stores dependendies graph data.
   * @param {?Object} deps List of dependencies listend in package.json file
   * @param {?Object} dev List of dev dependencies listend in package.json file
   * @param {String} pkg Package full name
   * @return {Promise}
   */
  processDepenedencies(deps, dev, pkg) {
    if (deps) {
      deps = this.filterDependencies(deps);
    }
    if (dev) {
      dev = this.filterDependencies(dev);
    }
    return this.model.set(this.component, deps, dev, this.organization, pkg);
  }
}
