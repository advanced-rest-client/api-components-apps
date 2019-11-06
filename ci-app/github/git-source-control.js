import path from 'path';
import Git from 'nodegit';
import logging from '../lib/logging';
import config from '../config';
import openpgp from 'openpgp';
import fs from 'fs-extra';
/**
 * A class that allows to manipulate a git repository.
 * It allows to:
 * - clone a repository from GitHub
 * - open existing repository
 * - checkout a branch
 * - create a signed commit
 * - push branch to the origin.
 */
export class GitSourceControl {
  /**
   * @param {String} workingDir A working directory where all operations are performed.
   * This is not cloned repository location. It is constructed from `workingDir` and `name`.
   * @param {String} org Repository owner organization
   * @param {String} name Repository name
   */
  constructor(workingDir, org, name) {
    this.org = org;
    this.name = name;
    this.repoName = `${org}/${name}`;
    this.workingDir = workingDir;
  }
  /**
   * Creates GitHub repository URL.
   * @param {Boolean} useSsh When true an SSH scheme is used instead of HTTP.
   * This is to be used when the repository is to be marged with a remote branch.
   * If the repository is checked out only in read-only mode a HTTP can be used intead.
   * Note, pushing changes requires signed commits which triggest additional logic.
   * @return {String} An URL to use to checkout the repository.
   */
  getRepoUrl(useSsh) {
    const authority = useSsh ? 'git@github.com:' : 'https://github.com/';
    return `${authority}${this.repoName}.git`;
  }
  /**
   * Clones the repository to current working directory.
   * It creates a folder in the working directory with the component.
   * @param {Boolean} useSsh When true an SSH scheme is used instead of HTTP.
   * @param {String} branch A branch name to checkout
   * @return {Promise} Resolved when a repository is created.
   */
  async clone(useSsh, branch='master') {
    const url = this.getRepoUrl(useSsh);
    const repo = await this._clone({
      url,
      dir: path.join(this.workingDir, this.name)
    });
    this.repo = repo;
    const ref = await this.ensureBranch(repo, branch);
    logging.verbose('On branch ' + ref.shorthand());
  }
  /**
   * Opens an existing repository and sets `repo` property.
   * @return {Promise}
   */
  async open() {
    const dir = path.join(this.workingDir, this.name);
    const repo = await Git.Repository.open(dir);
    this.repo = repo;
  }
  /**
   * Clones the repository.
   * This sets `repo` property with the reference to `Repository` object.
   *
   * @param {Object} cloneOpts Configuration object:
   * - {String} branch a branch name to checkout
   * - {String} url Repository location
   * - {String} dir A directory where to checkout the repository
   *
   * @return {Promise<Object>} Promise resolved to a Repo object
   */
  async _clone(cloneOpts) {
    const opts = {
      fetchOpts: this._getFetchOptions()
    };
    const { dir, url } = cloneOpts;
    logging.verbose(`Cloning ${url}...`);
    const repo = await Git.Clone(url, dir, opts);
    logging.verbose('Repository cloned.');
    return repo;
  }
  /**
   * Ensures that the repository is on specific branch.
   * If the branch does not exist it is created.
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch A branch to checkout.
   * @return {Promise<Object>} Promise resolved when the repository is at branch. Returns
   * a reference to a branch.
   */
  async ensureBranch(repo, branch) {
    let ref = await repo.getCurrentBranch();
    const current = ref.shorthand();
    if (current !== branch) {
      logging.verbose(`Checkout out ${branch} branch...`);
      await this.checkoutBranch(repo, branch);
    } else {
      logging.verbose(`Already on ${branch} branch.`);
    }
    return await repo.getCurrentBranch();
  }

  /**
   * Creates a FetchOptions object as defined in nodegit.
   * This uses configured SSH key to be used to connect to GitHub.
   * @return {Object}
   */
  _getFetchOptions() {
    return {
      callbacks: {
        credentials: function(url, userName) {
          return Git.Cred.sshKeyNew(
            userName,
            config.get('GITHUB_SSH_KEY_PUB'),
            config.get('GITHUB_SSH_KEY'),
            config.get('GITHUB_SSH_KEY_PASS')
          );
        }
      }
    };
  }
  /**
   * Checkouts repository branch. The branch must exists in the origin.
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch Branch to checkout
   * @return {Promise} [description]
   */
  async checkoutBranch(repo, branch) {
    logging.verbose(`Changing branch to ${branch}...`);
    let ref;
    try {
      ref = await repo.getBranch(branch);
    } catch (_) {
      logging.verbose(`Creating new branch ${branch}...`);
      const reference = await this.createBranch(repo, branch);
      await repo.checkoutBranch(reference, {});
      const commit = await repo.getReferenceCommit('refs/remotes/origin/' + branch);
      await Git.Reset.reset(repo, commit, 3, {});
    }
    if (ref) {
      await repo.checkoutBranch(ref, {});
    }
  }

  /**
   * Creates a branch for given name.
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch Name of the branch to create
   * @return {Promise} Resolved promise returns a {Git.Reference} object.
   */
  async createBranch(repo, branch) {
    logging.verbose(`Creating branch ${branch}...`);
    const targetCommit = await repo.getHeadCommit();
    return await repo.createBranch(branch, targetCommit, false);
  }

  /**
   * Callback for GPG signature when signing the commit.
   * @param {String} tosign A string to sign.
   * @return {Promise}
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
      detached: true
    };
    const signed = await openpgp.sign(options);
    return signed.signature;
  }
  /**
   * Decrypts GPG key to be used to sign commits.
   * @return {Promise}
   */
  async _decryptGpg() {
    const key = config.get('GPG_KEY');
    const pass = config.get('GPG_KEY_PASS');
    const buff = await fs.readFile(key);
    const armored = await openpgp.key.readArmored(buff);
    const keyObj = armored.keys[0];
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
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch Current branch
   * @param {String} message Commit message
   * @param {String} oid Commit ID.
   * @param {Array} parents Commit parents.
   * @return {Promise}
   */
  async createCommit(repo, branch, message, oid, parents) {
    const author = this._createSignature();
    const committer = this._createSignature();
    // return repo.createCommit(branch, author, committer, message, oid, parents);
    // https://github.com/nodegit/nodegit/issues/1018
    return await repo.createCommitWithSignature(branch, author, committer, message, oid,
      parents, this._onSignature.bind(this));
  }

  async push(repo, branch) {
    logging.verbose('Pushing to the remote: ' + branch);
    const remote = await repo.getRemote('origin');
    const refs = [`refs/heads/${branch}:refs/heads/${branch}`];
    return await remote.push(refs, this._getFetchOptions());
  }
}