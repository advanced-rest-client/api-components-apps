import { Datastore } from '@google-cloud/datastore';
import decamelize from 'decamelize';
import slug from 'slug';
import config from '../config.js';

/** @typedef {import('@google-cloud/datastore/build/src/entity').entity.Key} Key */

/* eslint class-methods-use-this: 'off' */

/**
 * A base model for all datastore model classes.
 */
export class BaseModel {
  /**
   * @param {String} namespace Datastore namespace to use with datastore requests.
   */
  constructor(namespace) {
    this.namespace = namespace;
    this.store = new Datastore({
      projectId: config.get('GCLOUD_PROJECT'),
      namespace: this.namespace,
    });
    this.listLimit = 25;
  }

  /**
   * @return A symbol representing no more results in the data store
   */
  get NO_MORE_RESULTS() {
    return Datastore.NO_MORE_RESULTS;
  }

  /**
   * @return The kind value for tests
   */
  get testKind() {
    return 'Test';
  }

  /**
   * @return The kind value for components
   */
  get componentsKind() {
    return 'Component';
  }

  /**
   * @return The kind value for versions
   */
  get versionsKind() {
    return 'Version';
  }

  /**
   * @return The kind value for groups
   */
  get groupsKind() {
    return 'Group';
  }

  /**
   * @return The kind value for groups
   */
  get organizationKind() {
    return 'Organization';
  }

  /**
   * @return The kind value for test logs
   */
  get testLogsKind() {
    return 'TestComponentLogs';
  }

  /**
   * @return The kind value for users
   */
  get userKind() {
    return 'User';
  }

  /**
   * @return The kind value for JWT tokens
   */
  get tokenKind() {
    return 'Jwt';
  }

  /**
   * @return The kind value for builds
   */
  get buildKind() {
    return 'Build';
  }

  /**
   * @return The kind value for messages (ARC messages)
   */
  get messageKind() {
    return 'Messages';
  }

  /**
   * @return The kind value for dependencies
   */
  get dependencyKind() {
    return 'Dependency';
  }

  /**
   * @return The kind value for coverage run
   */
  get coverageRunKind() {
    return 'CoverageTest';
  }

  /**
   * @return The kind value for coverage run
   */
  get coverageComponentKind() {
    return 'ComponentVersionCoverageResult';
  }

  /**
   * @return The namespace value for users
   */
  get apicUsersNamespace() {
    return 'api-components-users';
  }

  /**
   * @return The namespace value for tests
   */
  get apicTestsNamespace() {
    return 'api-components-tests';
  }

  /**
   * @return The namespace value for builds
   */
  get buildsNamespace() {
    return 'api-components-builds';
  }

  /**
   * @return The namespace value for coverage
   */
  get coverageNamespace() {
    return 'api-components-coverage';
  }

  /**
   * Creates a slug from a string.
   *
   * @param {String} name Value to slug,
   * @return {String}
   */
  slug(name) {
    return slug(decamelize(name, '-'));
  }

  /**
   * Translates from Datastore's entity format to
   * the format expected by the application.
   *
   * Datastore format:
   *    {
   *      key: [kind, id],
   *      data: {
   *        property: value
   *      }
   *    }
   *
   *  Application format:
   *    {
   *      id: id,
   *      property: value
   *    }
   * @param {object} obj Datastore entry
   * @return {object}
   */
  fromDatastore(obj) {
    const key = obj[this.store.KEY];
    obj.id = key.name || key.id;
    return obj;
  }

  /**
   * Creates a datastore key for a test.
   * @param {String} testId Test id
   * @return {Key} Datastore key
   */
  createTestKey(testId) {
    return this.store.key({
      namespace: this.namespace,
      path: [this.testKind, testId],
    });
  }

  /**
   * Creates a datastore key for a coverage test run
   * @param {String} runId Test id
   * @return {Key} Datastore key
   */
  createCoverageRunKey(runId) {
    return this.store.key({
      namespace: this.coverageNamespace,
      path: [this.coverageRunKind, runId],
    });
  }

  /**
   * Creates a datastore key for a component in a test.
   * @param {String} testId Test id
   * @param {String} componentName Component name
   * @return {Key} Datastore key
   */
  createTestComponentKey(testId, componentName) {
    return this.store.key({
      namespace: this.namespace,
      path: [this.testKind, testId, this.componentsKind, this.slug(componentName)],
    });
  }

  /**
   * Creates a key for test logs
   *
   * @param {String} testId Test id
   * @param {String} componentName Component name
   * @param {string} id The id of the log
   * @return {Key} Datastore key
   */
  createTestLogKey(testId, componentName, id) {
    return this.store.key({
      namespace: this.namespace,
      path: [this.testKind, testId, this.componentsKind, this.slug(componentName), this.testLogsKind, id],
    });
  }

  /**
   * Creates a datastore key for a build.
   * @param {String} id Build id
   * @return {Object} Datastore key
   */
  createBuildKey(id) {
    return this.store.key({
      namespace: this.buildsNamespace,
      path: [this.buildKind, id],
    });
  }

  /**
   * Creates an key for a coverage result entry for a file
   * @param {string} component The name of the component
   * @param {string} org Component's organization
   * @param {string} version Version of the component
   * @param {string} file Covered file name
   * @return {Key}
   */
  createComponentVersionFileCoverageKey(component, org, version, file) {
    return this.store.key({
      namespace: this.coverageNamespace,
      path: [
        this.organizationKind, this.slug(org),
        this.componentsKind, this.slug(component),
        this.versionsKind, version,
        this.coverageComponentKind, file,
      ],
    });
  }

  /**
   * Creates an key for a coverage result entry for a file
   * @param {string} component The name of the component
   * @param {string} org Component's organization
   * @param {string} version Version of the component
   * @return {Key}
   */
  createComponentVersionCoverageKey(component, org, version) {
    return this.store.key({
      namespace: this.coverageNamespace,
      path: [
        this.organizationKind, this.slug(org),
        this.componentsKind, this.slug(component),
        this.versionsKind, version,
      ],
    });
  }

  /**
   * Creates an key for a coverage result entry for a file
   * @param {string} component The name of the component
   * @param {string} org Component's organization
   * @return {Key}
   */
  createComponentCoverageKey(component, org) {
    return this.store.key({
      namespace: this.coverageNamespace,
      path: [
        this.organizationKind, this.slug(org),
        this.componentsKind, this.slug(component),
      ],
    });
  }
}
