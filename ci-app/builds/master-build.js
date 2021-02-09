import logging from '../lib/logging.js';
import Git from 'nodegit';
import { GitBuild } from './git-build.js';
import fs from 'fs-extra';
import path from 'path';
import { getScopeAndName, nonElements } from './utils.js';
/**
 * A class responsible for processing "master" branch after push.
 */
export class MasterBuild extends GitBuild {
  /**
   * @param {object} info Data store entry for the build
   */
  constructor(info) {
    super();
    this.info = info;
    const { component } = info;
    const names = getScopeAndName(component);
    this.name = names[1];
  }

  /**
   * Performs a build on a master branch:
   * - tag version on GitHub
   * @return {Promise<void>}
   */
  async build() {
    if (nonElements.indexOf(this.name) !== -1) {
      logging.info(`Ignoring master build for ${this.name}`);
      return;
    }

    try {
      await this.createWorkingDir();
      await this._clone();
      await this._tag();
      await this.cleanup();
      logging.info('Master build completed.');
    } catch (e) {
      logging.error(`Master build error: ${e.message}`);
      throw e;
    }
  }

  /**
   * Creates a new tag for current version, if not exists.
   * @return {Promise<void>}
   * @throws {Error} When a tag already exists
   */
  async _tag() {
    const ver = await this._getVersion();
    const tags = await Git.Tag.list(this.repo);
    if (tags.indexOf(ver) !== -1) {
      throw new Error(`Tag ${ver} already exist.`);
    }
    const oid = await this._addTag(ver);
    const tag = await this.repo.getTag(oid);
    const tagName = tag.name();
    logging.verbose(`Created tag: ${tagName}`);
    await this._push(tagName);
  }

  /**
   * Creates a new tag.
   * @param {string} ver
   * @return {Promise<Git.Oid>}
   */
  async _addTag(ver) {
    const tagger = this._createSignature();
    const message = `Publishing release v${ver}`;
    const commit = await Git.Commit.lookup(this.repo, this.info.commit);
    return Git.Tag.create(this.repo, ver, commit, tagger, message, 0);
  }

  /**
   * Reads version from package.json file.
   * @return {Promise<string>} Wersion of currently processed element.
   */
  async _getVersion() {
    const pkg = await fs.readJson(path.join(this.workingDir, 'package.json'), { throws: false });
    if (!pkg || !pkg.version) {
      throw new Error('package.json file not found.');
    }
    return pkg.version;
  }

  /**
   * Pushes tag to the remote.
   * @param {string} tag Tag name
   * @return {Promise<number>}
   */
  async _push(tag) {
    logging.verbose(`Pushing to the remote: ${tag}`);
    const remote = await this.repo.getRemote('origin');
    const refs = [`refs/tags/${tag}:refs/tags/${tag}`];
    return remote.push(refs, this._getFetchOptions());
  }
}
