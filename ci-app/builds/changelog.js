import fs from 'fs-extra';
import Git from 'nodegit';
import path from 'path';
import semver from 'semver';
import logging from '../lib/logging.js';

/**
 * @typedef {object} CommitMessage
 * @property {string} sha
 * @property {string} message
 * @property {string} author
 */
/**
 * @typedef {object} CommitMessages
 * @property {CommitMessage[]} build
 * @property {CommitMessage[]} ci
 * @property {CommitMessage[]} chore
 * @property {CommitMessage[]} docs
 * @property {CommitMessage[]} feat
 * @property {CommitMessage[]} fix
 * @property {CommitMessage[]} perf
 * @property {CommitMessage[]} refactor
 * @property {CommitMessage[]} revert
 * @property {CommitMessage[]} style
 * @property {CommitMessage[]} test
 * @property {CommitMessage[]} other
 */

const commitsMap = {
  build: 'Build',
  ci: 'Continuous integration',
  chore: 'Update',
  docs: 'Documentation',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance Improvements',
  refactor: 'Refactor',
  revert: 'Reverting Changes',
  style: 'Styling',
  test: 'Testing',
  other: 'Other',
};
/**
 * A class that builds changelog file from git commits.
 */
export class Changelog {
  /**
   * @constructor
   *
   * @param {String} workingDir Component directory location.
   * @param {String} organization Component organization on GitHub
   * @param {String} repository Component repository name
   */
  constructor(workingDir, organization, repository) {
    this.workingDir = workingDir;
    this.changelogFile = 'CHANGELOG.md';
    this.organization = organization;
    this.component = repository;
  }

  /**
   * @return {String} A path to the changelog file.
   */
  get logPath() {
    const { workingDir, changelogFile } = this;
    return path.join(workingDir, changelogFile);
  }

  /**
   * Reads component's package JSON file.
   * @return {Promise<Object>} Promise resolved to file contents
   */
  async readPackage() {
    const pkgFile = path.join(this.workingDir, 'package.json');
    return fs.readJSON(pkgFile);
  }

  /**
   * Opens an existing repository and sets `repo` property.
   *
   * @return {Promise<Git.Repository>} Reference to the repository object.
   */
  async open() {
    const dir = path.join(this.workingDir, '.git');
    return Git.Repository.open(dir);
  }

  /**
   * Lists commits history from `commit` to `until`.
   * @param {Git.Commit} commit A reference to a commit
   * @param {String=} until Optional. Commits equal or after this commit SHA
   * are excluded from the resulting list.
   * @return {Promise<Git.Commit[]>} A promise resolved to a list of commits.
   */
  listHistory(commit, until) {
    return new Promise((resolve, reject) => {
      const history = commit.history(); // Git.Revwalk.SORT.TIME
      const commits = /** @type Git.Commit[] */ ([]);
      let finished = false;
      history.on('commit', (commit) => {
        if (finished) {
          return;
        }
        if (commit.sha() === until) {
          finished = true;
          return;
        }
        commits.push(commit);
      });
      history.on('end', () => {
        resolve(commits);
      });
      history.on('error', (e) => {
        reject(e);
      });
      history.start();
    });
  }

  /**
   * @param {Git.Repository} repo Repository object
   * @param {string} tagName A tag to get the commit from
   * @return {Promise<Git.Commit>} [description]
   */
  async getTagCommit(repo, tagName) {
    const tag = await repo.getTagByName(tagName);
    const ref = await tag.peel();
    return Git.Commit.lookup(repo, ref.id());
  }

  /**
   * Reads an SHA of a commit for last tag
   * @param {Git.Repository} repo Opened repository reference.
   * @return {Promise<string>} A promise resolved to SHA or null if not found.
   */
  async getLastTagName(repo) {
    const tags = await Git.Tag.list(repo);
    if (!tags.length) {
      return null;
    }
    let tagName = tags.pop();
    // @FIXME: This to be removed in prod
    tagName = tags.pop();
    return tagName;
  }

  /**
   * Reads an SHA of a commit for the tag
   * @param {Git.Repository} repo Opened repository reference.
   * @param {String} tagName A name of the tag to retreive SHA for
   * @return {Promise<string>} A promise resolved to SHA or null if not found.
   */
  async getTagSha(repo, tagName) {
    if (!tagName) {
      return null;
    }
    try {
      const tagCommit = await this.getTagCommit(repo, tagName);
      return tagCommit.sha();
    } catch (_) {
      return null;
    }
  }

  /**
   * Returns header message for a single commit
   * @param {String} version Current (new) version
   * @param {Git.Commit} masterCommit A reference to current commit
   * @param {Number} indent Header indent
   * @param {String=} last Optional last tag version
   * @return {String} header for a single commit.
   */
  getMessageHeader(version, masterCommit, indent, last) {
    const date = masterCommit.date();
    const shortDate = date.toISOString().split('T')[0];
    let header = `<a name="${version}"></a>\n`;
    const headerTag = new Array(indent).fill('#').join('');
    header += `${headerTag} `;
    if (last) {
      const { organization, component } = this;
      const url = `https://github.com/${organization}/${component}/compare/${last}...${version}`;
      header += `[${version}](${url})`;
    } else {
      header += `${version}`;
    }
    header += ` (${shortDate})\n\n`;
    return header;
  }

  /**
   * Transforms a list of commits into an info object with categorized list of messages.
   *
   * @param {Git.Commit[]} commits List of Commit
   * @return {CommitMessages} A map of categorized commit messages
   */
  processCommitMessages(commits) {
    const result = {
      build: [],
      ci: [],
      chore: [],
      docs: [],
      feat: [],
      fix: [],
      perf: [],
      refactor: [],
      revert: [],
      style: [],
      test: [],
      other: [],
    };
    const re = /^(build|ci|chore|docs|feat|fix|perf|refactor|revert|style|test|breaking|update|new|docs): (.*)/i;
    for (let i = 0, len = commits.length; i < len; i++) {
      const commit = commits[i];
      const message = commit.message();
      const matches = message.match(re);
      if (!matches) {
        continue;
      }
      const type = matches[1];
      const authorMessage = matches[2];
      const item = {
        sha: commit.sha(),
        message: authorMessage,
        author: commit.author().name(),
      };
      if (!result[type]) {
        item.message = message;
        result.other.push(item);
      } else {
        result[type].push(item);
      }
    }
    return result;
  }

  /**
   * Creates a changelog commits list message
   * @param {CommitMessages} info Info object returned by `processCommitMessages()`
   * @param {number} indent Current title indent
   * @return {string} Commits log message
   */
  createCommitLog(info, indent) {
    const headerTag = new Array(indent + 1).fill('#').join('');
    const { organization, component } = this;
    let message = '';
    Object.keys(info).forEach((key) => {
      const messages = info[key];
      if (!messages.length) {
        return;
      }
      const title = commitsMap[key] || `Unknown (${key})`;
      message += `${headerTag} ${title}\n\n`;
      for (let i = 0, len = messages.length; i < len; i++) {
        const item = messages[i];
        const url = `https://github.com/${organization}/${component}/commit/${item.sha}`;
        const shortSha = item.sha.substr(0, 7);
        message += `* ${item.message} [${shortSha}](${url}) by ${item.author}\n`;
      }
      message += '\n\n';
    });
    return message;
  }

  /**
   * Gets the main header level number
   * @param {string} version Current (new) version
   * @return {number} Main header level
   */
  getHeaderLevel(version) {
    let headerIndent = 1;
    const path = semver.patch(version);
    const minor = semver.minor(version);
    const major = semver.major(version);
    if (major !== 0 && path > 0 || minor > 0) {
      headerIndent = 2;
    }
    return headerIndent;
  }

  /**
   * Builds a commit message from current commit to a last tag.
   * @param {Git.Commit[]} commits A list of commits the process
   * @param {string} version Current (new) version
   * @param {Git.Commit} masterCommit A reference to current commit.
   * @param {string} lastTagName Previous tag name
   * @return {string} Commit message for a tag
   */
  buildMessage(commits, version, masterCommit, lastTagName) {
    const headerIndent = this.getHeaderLevel(version);
    let message = this.getMessageHeader(version, masterCommit, headerIndent, lastTagName);
    const data = this.processCommitMessages(commits);
    message += this.createCommitLog(data, headerIndent);
    return message;
  }

  /**
   * Generates a changelog entry for a tag from current commit to a previous commit.
   * @return {Promise<string>}
   */
  async getLastTagChangelog() {
    const repo = await this.open();
    const lastTagName = await this.getLastTagName(repo);
    const lastTagSha = await this.getTagSha(repo, lastTagName);
    const commit = await repo.getHeadCommit();
    const commits = await this.listHistory(commit, lastTagSha);
    const pkg = await this.readPackage();
    const message = this.buildMessage(commits, pkg.version, commit, lastTagName);
    return message;
  }

  /**
   * Finds a commits for a tag. The tag is defined as a list of commits between two
   * tags represented by their commit SHA.
   * @param {Git.Commit[]} commits List of repo's commits
   * @param {string=} fromSha Starting (higher) tag's SHA
   * @param {string=} toSha Ending (lower) tag's SHA
   * @return {Git.Commit[]} A list of commits between the two tags.
   */
  findTagCommits(commits, fromSha, toSha) {
    const result = [];
    let started = !fromSha;
    for (let i = 0, len = commits.length; i < len; i++) {
      const commit = commits[i];
      const sha = commit.sha();
      if (!started && fromSha && sha === fromSha) {
        started = true;
        continue;
      }
      if (!started) {
        continue;
      }
      result.push(commit);
      if (toSha && toSha === sha) {
        break;
      }
    }
    return result;
  }

  /**
   * Creates a changelog file content for the whole history.
   * @return {Promise<string>}
   */
  async createChangelogContent() {
    const repo = await this.open();
    const tags = await Git.Tag.list(repo);
    if (!tags.length) {
      return '';
    }
    const commit = await repo.getHeadCommit();
    const allCommits = await this.listHistory(commit);
    allCommits.reverse();
    let logs = '';
    for (let i = 0, len = tags.length; i < len; i++) {
      const tagName = tags[i];
      const tagSha = await this.getTagSha(repo, tagName);
      if (!tagSha) {
        continue;
      }
      const lastTagSha = await this.getTagSha(repo, tags[i - 1]);
      const commits = this.findTagCommits(allCommits, lastTagSha, tagSha);
      logs += this.buildMessage(commits, tagName, commit, tags[i - 1]);
    }
    return logs;
  }

  /**
   * Builds changelog file.
   *
   * @return {Promise<void>}
   */
  async build() {
    logging.verbose('Building changelog...');
    const exists = await fs.pathExists(this.logPath);
    let log;
    if (!exists) {
      log = await this.createChangelogContent();
    } else {
      log = await this.getLastTagChangelog();
    }
    await fs.ensureFile(this.logPath);
    let contents = await fs.readFile(this.logPath, 'utf8');
    if (contents && contents.substr(contents.length - 2) !== '\n\n') {
      contents += '\n\n';
    }
    contents += log;
    await fs.writeFile(this.logPath, contents, 'utf8');
  }

  /**
   * Reads latest release log.
   *
   * @return {Promise<string>}
   */
  async get() {
    logging.verbose('Reading changelog data...');
    return this.getLastTagChangelog();
  }
}
