const {BaseModel} = require('./base-model');
/**
 * A model for catalog items.
 */
class ComponentModel extends BaseModel {
  /**
   * @constructor
   */
  constructor() {
    super('api-components');
  }

  get componentExcludeIndexes() {
    return [
      'name', 'version', 'versions', 'group'
    ];
  }

  get versionExcludeIndexes() {
    return [
      'name', 'version', 'docs', 'changelog'
    ];
  }

  _createGroupKey(name) {
    return this.store.key({
      namespace: this.namespace,
      path: [
        this.groupsKind,
        this.slug(name)
      ]
    });
  }

  _createComponentKey(groupName, componentName) {
    return this.store.key({
      namespace: this.namespace,
      path: [
        this.groupsKind,
        this.slug(groupName),
        this.componentsKind,
        this.slug(componentName)
      ]
    });
  }

  /**
   * Creates datastore key for version object
   * @param {String} groupName Component's group
   * @param {String} componentName Component name
   * @param {String} version Component version
   * @return {Object}
   */
  _createVersionKey(groupName, componentName, version) {
    return this.store.key({
      namespace: this.namespace,
      path: [
        this.groupsKind,
        this.slug(groupName),
        this.componentsKind,
        this.slug(componentName),
        this.versionsKind,
        version
      ]
    });
  }
  /**
   * Lists groups.
   *
   * @param {?Number} limit Number of results to return in the query.
   * @param {?String} nextPageToken Datastore start token.
   * @return {Promise<Array>} Promise resolved to a list of components.
   */
  listGroups(limit, nextPageToken) {
    if (!limit) {
      limit = this.listLimit;
    }
    let query = this.store.createQuery(this.namespace, this.groupsKind);
    query = query.limit(limit);
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    return this.store.runQuery(query)
    .then((result) => {
      const entities = result[0].map(this.fromDatastore.bind(this));
      const hasMore = result[1].moreResults !== this.NO_MORE_RESULTS ? result[1].endCursor : false;
      return [entities, hasMore];
    });
  }
  /**
   * Lists components.
   *
   * @param {?Number} limit Number of results to return in the query.
   * @param {?String} nextPageToken Datastore start token.
   * @param {?String} group Group name, when set it limits results to a specific group
   * @return {Promise<Array>} Promise resolved to a list of components.
   */
  listComponents(limit, nextPageToken, group) {
    if (!limit) {
      limit = this.listLimit;
    }
    let query = this.store.createQuery(this.namespace, this.componentsKind);
    if (group) {
      const key = this._createGroupKey(group);
      query = query.hasAncestor(key);
    }
    query = query.limit(limit);
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    return this.store.runQuery(query)
    .then((result) => {
      const entities = result[0].map(this.fromDatastore.bind(this));
      const hasMore = result[1].moreResults !== this.NO_MORE_RESULTS ? result[1].endCursor : false;
      return [entities, hasMore];
    });
  }

  queryComponents(limit, nextPageToken, filters) {
    if (!limit) {
      limit = this.listLimit;
    }
    let query = this.store.createQuery(this.namespace, this.componentsKind);
    if (filters.group) {
      const key = this._createGroupKey(filters.group);
      query = query.hasAncestor(key);
    }
    if (filters.tags && filters.tags.length) {
      filters.tags.forEach((tag) => {
        query = query.filter('tags', '=', tag);
      });
    }
    query = query.limit(limit);
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    return this.store.runQuery(query)
    .then((result) => {
      const entities = result[0].map(this.fromDatastore.bind(this));
      const hasMore = result[1].moreResults !== this.NO_MORE_RESULTS ? result[1].endCursor : false;
      return [entities, hasMore];
    });
  }
  /**
   * Lists names of API components (with `apic` tag)
   * @return {Promise<Array>} Promise resolved to a list of names.
   */
  listApiComponents() {
    let query = this.store.createQuery(this.namespace, this.componentsKind);
    query = query.filter('tags', '=', 'apic');
    return this.store.runQuery(query)
    .then((result) => result[0])
    .then((components) => {
      const result = [];
      if (!components.length) {
        return result;
      }
      for (let i = 0, len = components.length; i < len; i++) {
        result[result.length] = components[i].name;
      }
      return result;
    });
  }
  /**
   * Lists version of a component.
   * @param {String} group Component group id
   * @param {String} component Component id
   * @param {?Number} limit Number of results to return in the query.
   * @param {?String} nextPageToken Datastore start token.
   * @return {Promise<Array>}
   */
  listVersions(group, component, limit, nextPageToken) {
    if (!limit) {
      limit = this.listLimit;
    }
    const key = this._createComponentKey(group, component);
    let query = this.store.createQuery(this.namespace, this.versionsKind).hasAncestor(key);
    query = query.limit(limit);
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    return this.store.runQuery(query)
    .then((result) => {
      const entities = result[0].map(this.fromDatastore.bind(this));
      const hasMore = result[1].moreResults !== this.NO_MORE_RESULTS ? result[1].endCursor : false;
      return [entities, hasMore];
    });
  }

  /**
   * Creates a new version of API component in the data store.
   *
   * @param {String} version Component version
   * @param {String} componentName Component name
   * @param {String} groupName Component's group
   * @param {String} data Data to store
   * @param {?String} changelog Changelog string to store with version
   * @return {Promise}
   */
  addVersion(version, componentName, groupName, data, changelog) {
    return this._ensureGroup(groupName)
    .then(() => this._ensureComponent(version, componentName, groupName))
    .then((cmp) => this._ensureVersion(cmp, version, componentName, groupName, data, changelog));
  }
  /**
   * Creates a group of components if it does not exist.
   *
   * @param {String} groupName Name of the group
   * @return {Promise}
   */
  _ensureGroup(groupName) {
    const key = this._createGroupKey(groupName);
    return this.store.get(key)
    .catch(() => this._createGroup(groupName, key));
  }
  /**
   * Returns group model.
   * @param {String} name Group name
   * @return {Promise<Object>}
   */
  getGroup(name) {
    const key = this._createGroupKey(name);
    return this.store.get(key)
    .then((entity) => {
      if (entity && entity[0]) {
        return this.fromDatastore(entity[0]);
      }
    });
  }
  /**
   * Creates a component group entity.
   *
   * @param {String} name Name of the group
   * @param {Object} key Key of the entity.
   * @return {Object} Generated model.
   */
  _createGroup(name, key) {
    const data = [{
      name: 'name',
      value: name,
      excludeFromIndexes: true
    }];
    const entity = {
      key,
      data
    };
    return this.store.upsert(entity);
  }
  /**
   * Test if component data are already stored and creates a model if not.
   *
   * @param {String} version Component version
   * @param {String} componentName Component name
   * @param {String} groupName Component's group
   * @return {Promise}
   */
  _ensureComponent(version, componentName, groupName) {
    const key = this._createComponentKey(groupName, componentName);
    return this.store.get(key)
    .catch(() => {})
    .then((data) => {
      if (!data || !data[0]) {
        return this._createComponent(componentName, version, groupName, key);
      } else {
        return this._addComponentVersion(data[0], version, key);
      }
    });
  }
  /**
   * Returns component definition.
   * @param {String} groupName Group id
   * @param {String} componentName Component id
   * @return {Promise<Object>}
   */
  getComponent(groupName, componentName) {
    const key = this._createComponentKey(groupName, componentName);
    return this.store.get(key)
    .then((entity) => {
      if (entity && entity[0]) {
        return this.fromDatastore(entity[0]);
      }
    });
  }
  /**
   * Creates a component.
   *
   * @param {String} name Name of the group
   * @param {String} version Component version
   * @param {String} groupName Component's group
   * @param {Object} key Key of the entity.
   * @return {Object} Generated model.
   */
  _createComponent(name, version, groupName, key) {
    const data = [{
      name: 'name',
      value: name,
      excludeFromIndexes: true
    }, {
      name: 'version',
      value: version,
      excludeFromIndexes: true
    }, {
      name: 'versions',
      value: [version],
      excludeFromIndexes: true
    }, {
      name: 'group',
      value: groupName,
      excludeFromIndexes: true
    }];
    const entity = {
      key,
      data
    };
    return this.store.upsert(entity)
    .then(() => this.store.get(key))
    .then((entity) => {
      if (entity && entity[0]) {
        return this.fromDatastore(entity[0]);
      }
    });
  }
  /**
   * Adds a new version to the component model.
   * @param {Object} model Existing model
   * @param {String} version Version number
   * @param {Object} key Datastore key
   * @return {Object} updated model
   */
  _addComponentVersion(model, version, key) {
    if (!model.versions) {
      model.versions = [];
    }
    if (model.versions.indexOf(version) !== -1) {
      return;
    }
    model.versions[model.versions.length] = version;
    model.version = version;
    const entity = {
      key,
      data: model,
      excludeFromIndexes: this.componentExcludeIndexes
    };
    return this.store.update(entity)
    .then(() => this.store.get(key))
    .then((entity) => {
      if (entity && entity[0]) {
        return this.fromDatastore(entity[0]);
      }
    });
  }
  /**
   * Replaces/creates version in the datastrore
   *
   * @param {Object} parent Parent component
   * @param {String} version Component version
   * @param {String} componentName Component name
   * @param {String} groupName Component's group
   * @param {Object} data Polymer analysis result
   * @param {?String} changelog Version changelog
   * @return {Promise}
   */
  _ensureVersion(parent, version, componentName, groupName, data, changelog) {
    const key = this._createVersionKey(groupName, componentName, version);
    return this.store.get(key)
    .catch(() => {})
    .then((model) => {
      if (!model || !model[0]) {
        return this._createVersion(parent, version, componentName, groupName, data, changelog);
      } else {
        model = model[0];
        model.created = Date.now();
        model.docs = JSON.stringify(data);
        if (parent.tags) {
          model.tags = parent.tags;
        } else if (model.tags) {
          delete model.tags;
        }
        if (changelog) {
          model.changelog = changelog;
        } else if (model.changelog) {
          delete model.changelog;
        }
        const entity = {
          key,
          data: model,
          excludeFromIndexes: this.versionExcludeIndexes
        };
        return this.store.update(entity);
      }
    });
  }
  /**
   * Creates component version entity.
   *
   * @param {Object} parent Parent component
   * @param {String} version Component version
   * @param {String} componentName Component name
   * @param {String} groupName Component's group
   * @param {Object} docs Polymer analysis result
   * @param {?String} changelog
   * @return {Promise}
   */
  _createVersion(parent, version, componentName, groupName, docs, changelog) {
    const key = this._createVersionKey(groupName, componentName, version);
    const data = [{
      name: 'name',
      value: componentName,
      excludeFromIndexes: true
    }, {
      name: 'docs',
      value: JSON.stringify(docs),
      excludeFromIndexes: true
    }, {
      name: 'created',
      value: Date.now(),
      excludeFromIndexes: false
    }];
    if (parent.tags) {
      data.push({
        name: 'tags',
        value: parent.tags,
        excludeFromIndexes: false
      });
    }
    if (changelog) {
      data.push({
        name: 'changelog',
        value: changelog,
        excludeFromIndexes: true
      });
    }
    const entity = {
      key,
      data
    };
    return this.store.upsert(entity);
  }
  /**
   * Returns component definition.
   * @param {String} groupName Group name
   * @param {String} componentName Component name
   * @param {String} version Version name.
   * @return {Promise<Object>}
   */
  getVersion(groupName, componentName, version) {
    const key = this._createVersionKey(groupName, componentName, version);
    return this.store.get(key)
    .then((entity) => {
      if (entity && entity[0]) {
        return this.fromDatastore(entity[0]);
      }
    });
  }
  /**
   * Queries for versions.
   * @param {?Number} limit Number of results to return in the query.
   * @param {?String} nextPageToken Datastore start token.
   * @param {Object} filters Map for: group, component, tags, and until
   * @return {Promise}
   */
  queryVersions(limit, nextPageToken, filters) {
    if (!limit) {
      limit = this.listLimit;
    }
    let query = this.store.createQuery(this.namespace, this.versionsKind);
    if (filters.group && filters.component) {
      const key = this._createComponentKey(filters.group, filters.component);
      query = query.hasAncestor(key);
    }
    if (filters.tags && filters.tags.length) {
      filters.tags.forEach((tag) => {
        query = query.filter('tags', '=', tag);
      });
    }
    if (filters.since) {
      query = query.filter('created', '>=', Number(filters.since));
    }
    if (filters.until) {
      query = query.filter('created', '<=', Number(filters.until));
    }
    query = query.limit(limit);
    if (nextPageToken) {
      query = query.start(nextPageToken);
    }
    return this.store.runQuery(query)
    .then((result) => {
      const entities = result[0].map(this.fromDatastore.bind(this));
      const hasMore = result[1].moreResults !== this.NO_MORE_RESULTS ? result[1].endCursor : false;
      return [entities, hasMore];
    });
  }
}

module.exports.ComponentModel = ComponentModel;
