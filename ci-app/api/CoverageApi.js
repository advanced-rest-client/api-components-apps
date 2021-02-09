import express from 'express';
import { BaseApi } from './base-api.js';
import logging from '../lib/logging.js';
import bodyParser from 'body-parser';
// import background from '../lib/background.js';
import { CoverageModel } from '../models/CoverageModel.js';

/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

const router = express.Router();
router.use(bodyParser.json());
export default router;

const allowedOrgs = [
  'advanced-rest-client',
  'api-modeling',
  'anypoint-web-components',
];

/**
 * API route definition for builds.
 */
class CoverageApi extends BaseApi {
  /**
   * @constructor
   */
  constructor() {
    super();
    this.model = new CoverageModel();
  }

  /**
   * Route to list builds.
   * @param {Request} req
   * @param {Response} res
   * @return {Promise<void>}
   */
  async scheduleCoverage(req, res) {
    try {
      await this.ensureAccess(req, 'create-coverage');
      const errors = this.validateCreateCoverage(req);
      if (errors) {
        this.sendError(res, errors, 400);
        return;
      }
      // @ts-ignore
      const { body, user } = req;
      const info = {
        component: body.component,
        org: body.org,
        tag: body.tag,
        creator: {
          id: user.id,
          displayName: user.displayName || '',
        },
      };
      if (body.branch) {
        info.branch = body.branch;
      }
      const created = await this.model.insert(info);
      res.send({ created });
    } catch (e) {
      logging.error(e);
      const status = e.status || 500;
      this.sendError(res, e.message, status);
    }
  }

  /**
   * Validates whether the coverage run schedule request is valid.
   * @param {Request} req
   * @return {string|undefined} Error message or nothing.
   */
  validateCreateCoverage(req) {
    const messages = [];
    const body = req.body;
    if (!body.org) {
      messages[messages.length] = 'The "org" property is required.';
    } else if (allowedOrgs.indexOf(body.org) === -1) {
      messages[messages.length] = `"${body.org}" is unknown for this CI.`;
    }
    if (!body.tag) {
      messages[messages.length] = 'The "tag" property is required.';
    }
    if (!body.component) {
      messages[messages.length] = 'The "component" property is required.';
    }
    return messages.length ? messages.join(' ') : undefined;
  }
}

const api = new CoverageApi();
api.setCors(router);
api.wrapApi(router, [
  ['/', 'scheduleCoverage', 'post'],
  // ['/:id', 'getBuild'],
  // ['/:id/restart', 'restartBuild', 'put'],
]);
