/* eslint-disable require-jsdoc */
import GitHub from 'github-api';
import { Storage } from '@google-cloud/storage';
import { spawn } from 'child_process';
import path from 'path';
import tar from 'tar-fs';
import logging from '../lib/logging.js';
import { GitSourceControl } from '../github/git-source-control.js';

const bucketName = 'apic-ci-amf-cache';

export class AmfBuilder {
  /**
   * @param {string} workingDir A working directory where to create AMF library
   * @param {Object} opts
   * @param {string=} opts.branch A branch to checkout
   * @param {string=} opts.sha An sha of a commit to use to build the library
   * Either sha or branch is allowed as an option.
   * If branch is passed it is translated to sha.
   */
  constructor(workingDir, opts) {
    this.workingDir = workingDir;
    this.branch = opts.branch;
    this.sha = opts.sha;
    this.storage = new Storage();
    this.bucket = this.storage.bucket(bucketName);
  }

  /**
   * Bucket file name for current configuration.
   * Be sure to call `requestSha()` before accessing this function.
   * @return {string}
   */
  get cacheFile() {
    const { sha } = this;
    if (!sha) {
      throw new Error('Commit sha not set');
    }
    return `${sha}-amf-cache.tar.gz`;
  }

  /**
   * Runs the builder. It tries to restore cached build of the AMF from
   * app's bucket or builds AMF from sources.
   *
   * The cache is restored for commit SHA value so it is safe to restore cache
   * from a branch as SHA is different when updated.
   *
   * @return {Promise}
   */
  async run() {
    if (!this.sha) {
      await this.requestSha();
    }
    try {
      await this.restoreCached();
      return;
    } catch (e) {
      logging.verbose(e.message);
    }
    logging.info('Building AMF from sources.');
    await this.cloneAmf();
    await this.buildAmf(this.branch || this.sha);
    try {
      await this.cacheAmf();
    } catch (e) {
      // It's not crucial to the build and test process.
      logging.error(e);
    }
  }

  /**
   * Clones AMF using HTTP scheme to a selected branch or SHA
   * @return {Promise}
   */
  async cloneAmf() {
    const github = new GitSourceControl(this.workingDir, 'aml-org', 'amf');
    await github.clone(false, 'develop');
  }

  /**
   * It makes an API call to GitHub API to check for the sha value
   * for requested branch. The value is set on `this.sha`.
   *
   * @return {Promise}
   */
  async requestSha() {
    const { branch } = this;
    const github = new GitHub();
    const repo = github.getRepo('aml-org', 'amf');
    const data = await repo.getBranch(branch);
    const info = data.data;
    if (!info) {
      throw new Error('Branch does not exists');
    }
    const { commit } = info;
    this.sha = commit.sha;
  }

  /**
   * Finds cached build of the AMF library.
   * @return {Promise<void>} Resolved to a boolean value where true means that the AMF library was restored.
   */
  async restoreCached() {
    await this.ensureBucket();
    const { cacheFile } = this;
    const file = this.bucket.file(cacheFile);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error('AMF cache file does not exist.');
    }
    const dir = path.join(this.workingDir, 'lib');
    await this._readFileStream(file, dir);
  }

  _readFileStream(file, dir) {
    return new Promise((resolve, reject) => {
      file.createReadStream()
          .on('error', (err) => {
            reject(err);
          })
          .on('end', () => {
            logging.verbose('Cache file downloaded. Unpacking...');
          })
          .pipe(tar.extract(dir))
          // eslint-disable-next-line prefer-arrow-callback
          .on('error', function(err) {
            reject(err);
          })
          .on('finish', () => {
            logging.verbose('Cache restored...');
            resolve();
          });
    });
  }

  /**
   * Creates a bucket with lifecycle rules when needed.
   * @return {Promise}
   */
  async ensureBucket() {
    const [exists] = await this.bucket.exists();
    if (exists) {
      return;
    }
    const [bucket] = await this.bucket.create();
    this.bucket = bucket;
    // will keep files for 30 days
    await bucket.addLifecycleRule({
      action: 'delete',
      condition: {
        age: 30, // days
      },
    });
  }

  /**
   * Runs AMF builder which runs stb build process
   * in the repository folder and copies the required libraries into
   * `workingDir` + `lib` directory, and finally, installs the node dependencies.
   *
   * @param {string} branchOrSha Branch name or SHA commit id.
   * @return {Promise}
   */
  async buildAmf(branchOrSha) {
    const file = path.join(__dirname, 'amf-compiler.sh');
    return new Promise((resolve, reject) => {
      const amf = spawn(file, [branchOrSha], {
        cwd: this.workingDir,
      });
      let lastError;

      amf.stdout.on('data', (data) => {
        logging.verbose(`[AMF BUILD]: ${data}`);
      });

      amf.stderr.on('data', (data) => {
        logging.error(`[AMF BUILD] ERR: ${data}`);
        const trimmed = data.trim ? data.trim() : data;
        if (trimmed) {
          lastError = trimmed;
        }
      });

      amf.on('close', (code) => {
        logging.info(`[AMF BUILD] exit code is ${code}`);
        if (code !== 0) {
          if (lastError) {
            lastError = new Error(lastError);
          } else {
            lastError = new Error(`AMF build exit with code ${code}`);
          }
          reject(lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Caches created AMF library in bucket store.
   * @return {Promise}
   */
  async cacheAmf() {
    const { cacheFile } = this;
    const file = this.bucket.file(cacheFile);
    const dir = path.join(this.workingDir, 'lib');
    await this._streamUploadCache(file, dir);
  }

  _streamUploadCache(file, dir) {
    return new Promise((resolve, reject) => {
      let finished = false;
      tar.pack(dir)
          .pipe(file.createWriteStream({ gzip: true }))
          .on('error', (err) => {
            reject(err);
            finished = true;
          })
          .on('finish', () => {
            if (!finished) {
              resolve();
            }
          });
    });
  }
}
