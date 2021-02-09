import tmp from 'tmp';
import { EventEmitter } from 'events';
import logging from '../lib/logging.js';
import fs from 'fs-extra';

/* eslint-disable class-methods-use-this */

/**
 * Base class for component builders.
 */
export class BaseBuild extends EventEmitter {
  /**
   * Creates a working directory where the files will be processed.
   *
   * @return {Promise} Resolved promise when the tmp dire was created
   * with path to the working directory.
   */
  async createWorkingDir() {
    const path = await this.createTempDir();
    const dir = await fs.realpath(path);
    logging.verbose(`Created working directory ${dir}`);
    this.workingDir = dir;
    return dir;
  }

  /**
   * Cleans up the temporaty directory.
   * @return {Promise}
   */
  async cleanup() {
    if (!this.workingDir) {
      return;
    }
    logging.debug('Cleaning up temporaty dir...');
    const exists = await fs.pathExists(this.workingDir);
    if (exists) {
      logging.debug(`Removing ${this.workingDir}`);
      await fs.remove(this.workingDir);
    }
  }

  /**
   * Creates a temp working dir for the console.
   * @return {Promise}
   */
  async createTempDir() {
    logging.debug('Creating working directory...');
    return new Promise((resolve, reject) => {
      tmp.dir((err, _path) => {
        if (err) {
          reject(new Error(`Unable to create a temp dir: ${err.message}`));
        } else {
          resolve(_path);
        }
      });
    });
  }
}
