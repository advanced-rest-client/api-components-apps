import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import semver from 'semver';
import logging from '../lib/logging';

export const rcFile = '.npmrc';
export const rcContents = '//registry.npmjs.org/:_authToken=${NPM_TOKEN}';

export class NpmPublish {
  /**
   * @param {String} pkgDir A directory where package sources are located
   * @param {String} tag A tag name of current release.
   */
  constructor(pkgDir, tag) {
    if (!pkgDir) {
      throw new Error('pkgDir is a required argument when publishing a package');
    }
    if (!tag) {
      throw new Error('tag is a required argument when publishing a package');
    }
    /**
     * Package directory
     * @type {String}
     */
    this.pkgDir = pkgDir;
    /**
     * A tag name that is bein released.
     * @type {String}
     */
    this.tag = tag;
  }
  /**
   * Publishes the package in NPM registry.
   * @return {Promise}
   */
  async publish() {
    await this.createNpmRcEntry();
    await this.npmPublish();
  }
  /**
   * Creates a `.mpmrc` file inside package directory with CI's NPM token
   * to authenticate the user.
   * Previously created file is deleted.
   * @return {Promise}
   */
  async createNpmRcEntry() {
    const { pkgDir } = this;
    logging.verbose(`Creating ${rcFile} file in ${pkgDir}`);
    const file = path.join(pkgDir, rcFile);
    const exists = await fs.pathExists(file);
    if (exists) {
      await fs.remove(file);
    }
    await fs.writeFile(file, rcContents, 'utf8');
  }
  /**
   * Generates the publish command
   * @return {String}
   */
  createCommand() {
    let tag = this.tag;
    if (tag[0] === 'v') {
      tag = tag.substr(1);
    }
    let cmd = 'npm publish --access public';
    const info = semver.prerelease(tag);
    if (info) {
      cmd += ` --tag ${info[0]}`;
    }
    return cmd;
  }

  /**
   * Runs NPM command to publish the component.
   * If the `tag` is a pre-release tag it creates a tagged release.
   * @return {Promise}
   */
  npmPublish() {
    const cmd = this.createCommand();
    const opts = {
      cwd: this.pkgDir
    };
    logging.info(`Publishing package...`);
    return new Promise((resolve) => {
      exec(cmd, opts, (err, stdout, stderr) => {
        if (err) {
          logging.error(err);
        } else {
          logging.info(`Package published.`);
          logging.verbose(stdout);
        }
        // "code E403" - exists
        resolve();
      });
    });
  }
}
