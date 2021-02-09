import express from 'express';
import { BaseApi } from './base-api.js';
import { ComponentBuildModel } from '../models/component-build-model.js';
import logging from '../lib/logging.js';
import background from '../lib/background.js';

/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

const router = express.Router();
export default router;

/**
 * API route definition for builds.
 */
class BuildsApiRoute extends BaseApi {
  /**
   * @constructor
   */
  constructor() {
    super();
    this.model = new ComponentBuildModel();
  }

  /**
   * Route to list builds.
   * @param {Request} req
   * @param {Response} res
   * @return {Promise<void>}
   */
  async listBuilds(req, res) {
    const errors = this.validatePagination(req);
    if (errors) {
      this.sendError(res, errors);
      return;
    }
    const { limit, nextPageToken } = req.query;
    let typedLimit;
    if (limit) {
      typedLimit = Number(limit);
      if (Number.isNaN(typedLimit)) {
        typedLimit = undefined;
      }
    }
    let typedToken;
    if (nextPageToken) {
      typedToken = String(nextPageToken);
    }
    try {
      const result = await this.model.list(typedLimit, typedToken);
      this.sendQueryResult(result, res);
    } catch (cause) {
      logging.error(cause);
      if (cause.code === 3) {
        this.sendError(res, 'Inavlid nextPageToken parameter');
        return;
      }
      this.sendError(res, cause.message, 500);
    }
  }

  /**
   * Route to get a build info.
   * @param {Request} req
   * @param {Response} res
   * @return {Promise<void>}
   */
  async getBuild(req, res) {
    const { id } = req.params;
    try {
      const resource = await this.model.get(id);
      if (resource) {
        res.send(resource);
      } else {
        this.sendError(res, 'Build not found', 404);
      }
    } catch (cause) {
      logging.error(cause);
      this.sendError(res, cause.message, 500);
    }
  }

  /**
   * Route to restart a build.
   * @param {Request} req
   * @param {Response} res
   * @return {Promise<void>}
   */
  async restartBuild(req, res) {
    const { id } = req.params;
    try {
      await this.ensureAccess(req, 'restart-build');
      await this.model.restartBuild(id);
      background.queueStageBuild(id);
    } catch (cause) {
      logging.error(cause);
      const status = cause.status || 500;
      this.sendError(res, cause.message, status);
    }
  }
}

const api = new BuildsApiRoute();
api.setCors(router);
api.wrapApi(router, [
  ['/', 'listBuilds'],
  ['/:id', 'getBuild'],
  ['/:id/restart', 'restartBuild', 'put'],
]);
