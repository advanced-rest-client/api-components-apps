import logging from '../lib/logging';
import Git from 'nodegit';
import { GitBuild } from './git-build';
import fs from 'fs-extra';
import path from 'path';
import { getScopeAndName, nonElements } from './utils.js';
/**
 * A class responsible for processing "master" branch after push.
 */
export class MasterBuild extends GitBuild {
  constructor(info) {
    super();
    this.info = info;
    const { component } = info;
    const names = getScopeAndName(component);
    this.name = names[1];
  }

  build() {
    if (nonElements.indexOf(this.name) !== -1) {
      logging.info(`Ignoring master build for ${this.name}`);
      return;
    }

    return this.createWorkingDir()
      .then(() => this._clone())
      .then(() => this._tag())
      .then(() => this.cleanup())
      .then(() => {
        logging.info('Master build completed.');
      })
      .catch((cause) => {
        logging.error('Master build error: ' + cause.message);
        throw cause;
      });
  }

  _tag() {
    let ver;
    return this._getVersion()
      .then((version) => {
        ver = version;
        return Git.Tag.list(this.repo);
      })
      .then((tags) => {
        if (tags.indexOf(ver) !== -1) {
          throw new Error(`Tag ${ver} already exist.`);
        }
        return this._addTag(ver);
      })
      .then((oid) => this.repo.getTag(oid))
      .then((tag) => {
        logging.verbose('Created tag: ' + tag.name());
      })
      .then(() => this._push(ver));
  }

  _addTag(ver) {
    const tagger = this._createSignature();
    const message = 'Publishing release v' + ver;
    return Git.Commit.lookup(this.repo, this.info.commit).then((commit) =>
      Git.Tag.create(this.repo, ver, commit, tagger, message, 0)
    );
  }

  _getVersion() {
    return fs.readJson(path.join(this.workingDir, 'package.json'), { throws: false }).then((pkg) => {
      if (!pkg || !pkg.version) {
        throw new Error('package.json file not found.');
      }
      return pkg.version;
    });
  }

  _push(tag) {
    logging.verbose('Pushing to the remote: ' + tag);
    return this.repo.getRemote('origin').then((remote) => {
      const refs = [`refs/tags/${tag}:refs/tags/${tag}`];
      return remote.push(refs, this._getFetchOptions());
    });
  }
}
