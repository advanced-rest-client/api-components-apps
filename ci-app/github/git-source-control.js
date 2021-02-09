/* eslint-disable import/no-namespace */
import path from 'path';
import Git from 'nodegit';
import logging from '../lib/logging.js';
import config from '../config.js';
import * as openpgp from 'openpgp';
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
   * @param {string} workingDir A working directory where all operations are performed.
   * This is not cloned repository location. It is constructed from `workingDir` and `name`.
   * @param {string} org Repository owner organization
   * @param {string} name Repository name
   */
  constructor(workingDir, org, name) {
    this.org = org;
    this.name = name;
    this.repoName = `${org}/${name}`;
    this.workingDir = workingDir;
    /**
     * @type {Git.Repository}
     */
    this.repo = null;
  }

  /**
   * Creates GitHub repository URL.
   * @param {boolean} useSsh When true an SSH scheme is used instead of HTTP.
   * This is to be used when the repository is to be merged with a remote branch.
   * If the repository is checked out only in read-only mode a HTTP can be used instead.
   * Note, pushing changes requires signed commits which triggest additional logic.
   * @return {string} An URL to use to checkout the repository.
   */
  getRepoUrl(useSsh) {
    const authority = useSsh ? 'git@github.com:' : 'https://github.com/';
    return `${authority}${this.repoName}.git`;
  }

  /**
   * Clones the repository to current working directory.
   * It creates a folder in the working directory with the component.
   * @param {boolean} useSsh When true an SSH scheme is used instead of HTTP.
   * @param {string} branch A branch name to checkout
   * @return {Promise} Resolved when a repository is created.
   */
  async clone(useSsh, branch='master') {
    const url = this.getRepoUrl(useSsh);
    const repo = await this._clone({
      url,
      dir: path.join(this.workingDir, this.name),
    });
    this.repo = repo;
    const ref = await this.ensureBranch(repo, branch);
    logging.verbose(`On branch ${ref.shorthand()}`);
  }

  /**
   * Opens an existing repository and sets `repo` property.
   * @return {Promise<Git.Repository>}
   */
  async open() {
    const dir = path.join(this.workingDir, this.name);
    const repo = await Git.Repository.open(dir);
    this.repo = repo;
    return repo;
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
      fetchOpts: this._getFetchOptions(),
    };
    const { dir, url } = cloneOpts;
    logging.verbose(`Cloning ${url} into ${dir}...`);
    const repo = await Git.Clone.clone(url, dir, opts);
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
    const ref = await repo.getCurrentBranch();
    const current = ref.shorthand();
    if (current !== branch) {
      logging.verbose(`Checkout out ${branch} branch...`);
      await this.checkoutBranch(repo, branch);
    } else {
      logging.verbose(`Already on ${branch} branch.`);
    }
    return repo.getCurrentBranch();
  }

  /**
   * Creates a FetchOptions object as defined in nodegit.
   * This uses configured SSH key to be used to connect to GitHub.
   * @return {Object}
   */
  _getFetchOptions() {
    return {
      callbacks: {
        credentials: (url, userName) => {
          // ssh key configuration is in config.json file
          const credentials = Git.Cred.sshKeyNew(
              userName,
              config.get('GITHUB_SSH_KEY_PUB'),
              config.get('GITHUB_SSH_KEY'),
              config.get('GITHUB_SSH_KEY_PASS'),
          );
          return credentials;
        },
      },
    };
  }

  /**
   * Checkouts repository branch. The branch must exists in the origin.
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch Branch to checkout
   * @return {Promise} Promise resolved when the branch is ready
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
      const commit = await repo.getReferenceCommit(`refs/remotes/origin/${branch}`);
      await Git.Reset.reset(repo, commit, 3, {});
    }
    if (ref) {
      await repo.checkoutBranch(ref, {});
    }
  }

  /**
   * Checkouts branch and if the branch does not exist it is created.
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch Branch to checkout
   * @return {Promise} Promise resolved when the branch is ready
   */
  async checkoutOrCreate(repo, branch) {
    let ref;
    try {
      ref = await repo.getBranch(branch);
    } catch (_) {
      logging.verbose(`Creating ${branch} branch...`);
      const targetCommit = await repo.getHeadCommit();
      ref = await repo.createBranch(branch, targetCommit, false);
    }
    return repo.checkoutBranch(ref, {});
  }

  /**
   * Creates a branch for given name.
   *
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {string} branch Name of the branch to create
   * @return {Promise} Resolved promise returns a {Git.Reference} object.
   */
  async createBranch(repo, branch) {
    logging.verbose(`Creating branch ${branch}...`);
    const targetCommit = await repo.getHeadCommit();
    return repo.createBranch(branch, targetCommit, false);
  }

  /**
   * Callback for GPG signature when signing the commit.
   * @param {string} toSign A string to sign.
   * @return {Promise}
   */
  async _onSignature(toSign) {
    const privateKeyResult = await this._decryptGpg();
    if (!privateKeyResult) {
      throw new Error('GPG key decoding error.');
    }
    const buf = new Uint8Array(toSign.length);
    for (let i = 0; i < toSign.length; i++) {
      buf[i] = toSign.charCodeAt(i);
    }
    const options = {
      message: openpgp.message.fromBinary(buf),
      privateKeys: [privateKeyResult],
      detached: true,
    };
    const signed = await openpgp.sign(options);
    return {
      code: Git.Error.CODE.OK,
      field: 'gpgsig',
      signedData: signed.signature,
    };
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
    return repo.createCommitWithSignature(branch, author, committer, message, oid,
        parents, this._onSignature.bind(this));
  }

  /**
   * Pushes commits to the origin.
   * @param {Object} repo A reference to a repository object. It can be `this.repo`
   * created when `clone()` is called.
   * @param {String} branch The branch name
   * @return {Promise}
   */
  async push(repo, branch) {
    logging.verbose(`Pushing to the remote: ${branch}`);
    const remote = await repo.getRemote('origin');
    const refs = [`refs/heads/${branch}:refs/heads/${branch}`];
    return remote.push(refs, this._getFetchOptions());
  }

  /**
   * Commits `files` to current branch.
   * It adds the files, write to index, and write to the repo tree.
   *
   * @param {Object} repo The repository object.
   * @param {Array<String>} files A list of file to be added to current working tree.
   * @return {Promise<String>} Promise resolved to the nodegit `oid`
   */
  async commitFiles(repo, files) {
    const index = await repo.index();
    for (let i = 0, len = files.length; i < len; i++) {
      const file = files[i];
      await index.addByPath(file);
    }
    await index.write();
    return index.writeTree();
  }

  /**
   * Merge current branch with remote branch favouring our branch.
   * @param {Object} repo The repository object.
   * @param {String} remote Remote branch name
   * @return {Promise}
   */
  async mergeRemote(repo, remote) {
    const origin = `origin/${remote}`;
    await repo.fetch('origin', this._getFetchOptions());
    const sig = this._createSignature();
    return repo.mergeBranches(remote, origin, sig, 1, { fileFavor: Git.Merge.FILE_FAVOR.OURS });
  }
}
