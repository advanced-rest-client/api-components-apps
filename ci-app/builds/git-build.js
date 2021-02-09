import fs from 'fs-extra';
import Git from 'nodegit';
import openpgp from 'openpgp';
import { BaseBuild } from './base-build.js';
import logging from '../lib/logging.js';
import config from '../config.js';

/**
 * @typedef {object} CloneOptions
 * @property {string=} componentDir
 * @property {string=} sshUrl
 * @property {string=} branch
 */

/**
 * Base class for git builders.
 */
export class GitBuild extends BaseBuild {
  /**
   * @constructor
   */
  constructor() {
    super();
    /**
     * @type {Git.Repository}
     */
    this.repo = null;
    /**
     * Component info object
     * @type {object|null}
     */
    this.info = null;
  }

  /**
   * Clones the repository.
   * This sets `repo` property with the reference to `Repository` object.
   *
   * @param {CloneOptions=} cloneOpts An object to override values from `this.info`
   * property. Additional property is `componentDir` which overrides `this.workingDir`.
   * @return {Promise}
   */
  async _clone(cloneOpts={}) {
    const opts = {
      fetchOpts: this._getFetchOptions(),
    };
    const { info = {} } = this;
    const config = { ...info, ...cloneOpts };

    const componentDir = config.componentDir || this.workingDir;
    logging.verbose(`Cloning ${config.sshUrl}...`);
    // @ts-ignore
    const repo = await Git.Clone(config.sshUrl, componentDir, opts);
    this.repo = repo;
    let ref = await repo.getCurrentBranch();
    logging.verbose('Repository cloned.');
    const current = ref.shorthand();
    if (current !== config.branch) {
      await this._checkoutBranch(config.branch);
    }
    ref = await this.repo.getCurrentBranch();
    logging.verbose(`On branch ${ref.shorthand()}`);
  }

  /**
   * Checks out a branch
   * @param {string} name Branch name to checkout.
   * @return {Promise<void>}
   */
  async _checkoutBranch(name) {
    logging.verbose(`Changing branch to ${name}...`);
    let ref;
    try {
      ref = await this.repo.getBranch(name);
    } catch (_) {
      const reference = await this._createBranch(name);
      await this.repo.checkoutBranch(reference, {});
      const commit = await this.repo.getReferenceCommit(`refs/remotes/origin/${name}`);
      await Git.Reset.reset(this.repo, commit, 3, {});
    }
    if (ref) {
      await this.repo.checkoutBranch(ref, {});
    }
  }

  /**
   * Creates a branch for given name.
   * @param {string} name Name of the branch to create
   * @return {Promise<Git.Reference>} Resolved promise returns a {Git.Reference} object.
   */
  async _createBranch(name) {
    logging.verbose(`Creating branch ${name}...`);
    const targetCommit = await this.repo.getHeadCommit();
    return this.repo.createBranch(name, targetCommit, false);
  }

  /**
   * Creates a FetchOptions object as defined in nodegit.
   * This uses configured SSH key to be used to connect to GitHub.
   * @return {Object}
   */
  _getFetchOptions() {
    /**
     * The callback function when signing request.
     * @param {string} url
     * @param {string} userName
     * @return {object}
     */
    const clbFn = function(url, userName) {
      if (!url) {
        return;
      }
      return Git.Cred.sshKeyNew(
          userName,
          config.get('GITHUB_SSH_KEY_PUB'),
          config.get('GITHUB_SSH_KEY'),
          config.get('GITHUB_SSH_KEY_PASS'),
      );
    };
    return {
      callbacks: {
        credentials: clbFn,
      },
    };
  }

  /**
   * Callback for GPG signature when signing the commit.
   * @param {string} tosign A string to sign.
   * @return {Promise<any>}
   */
  async _onSignature(tosign) {
    const privateKeyResult = await this._decryptGpg();
    if (!privateKeyResult) {
      throw new Error('GPG key decoding error.');
    }
    const buf = new Uint8Array(tosign.length);
    for (let i = 0; i < tosign.length; i++) {
      buf[i] = tosign.charCodeAt(i);
    }
    const options = {
      message: openpgp.message.fromBinary(buf),
      privateKeys: [privateKeyResult],
      detached: true,
    };
    const signed = await openpgp.sign(options);
    return signed.signature;
  }

  /**
   * Decrypts GPG key to be used to sign commits.
   * @return {Promise<openpgp.key.Key>}
   */
  async _decryptGpg() {
    const key = config.get('GPG_KEY');
    const pass = config.get('GPG_KEY_PASS');
    const buff = await fs.readFile(key);
    const armored = await openpgp.key.readArmored(buff);
    const [keyObj] = armored.keys;
    const decrypted = keyObj.decrypt(pass);
    if (decrypted) {
      return keyObj;
    }
  }

  /**
   * Creates a signature object from application configuration.
   * @return {Git.Signature}
   */
  _createSignature() {
    const name = config.get('CI_NAME');
    const email = config.get('CI_EMAIL');
    return Git.Signature.now(name, email);
  }

  /**
   * Creates a commit.
   * @TODO: when nodegit is ready to use GPG keys this should use configured
   * GPG key to sing the commit. Currently GPG support is merged with master but
   * not yet released.
   * @param {string} branch Current branch
   * @param {string} message Commit message
   * @param {string} oid Commit ID.
   * @param {Git.Commit[]} parents Commit parents.
   * @return {Promise<Git.Oid>}
   */
  _createCommit(branch, message, oid, parents) {
    const author = this._createSignature();
    const committer = this._createSignature();
    return this.repo.createCommit(branch, author, committer, message, oid, parents);
    // https://github.com/nodegit/nodegit/issues/1018
    // return this.repo.createCommitWithSignature(author, committer, message, oid,
    //   parents, 'gpgsig', this._onSignature.bind(this));
  }

  /**
   * Pushes current tip to the remote
   * @param {string} branch
   * @return {Promise<number>}
   */
  async _push(branch) {
    logging.verbose(`Pushing to the remote: ${branch}`);
    const remote = await this.repo.getRemote('origin');
    const refs = [`refs/heads/${branch}:refs/heads/${branch}`];
    return remote.push(refs, this._getFetchOptions());
  }
}
