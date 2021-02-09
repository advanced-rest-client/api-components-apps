import { verifyToken, isTokenExpired, hasScope } from '../lib/jwt.js';
import { TokenModel } from '../models/token-model.js';
import cors from 'cors';
import { AccessError } from './errors.js';

/* eslint-disable class-methods-use-this */

/** @typedef {import('express').Response} Response */
/** @typedef {import('express').Request} Request */

/**
 * @typedef {object} QueryResult
 * @property {object[]} entities The list of entities to send with the response
 * @property {string=} pageToken The page token used in pagination
 */

let tokenModel;

/**
 * Mase for all API routes
 */
export class BaseApi {
  /**
   * @constructor
   */
  constructor() {
    this._processCors = this._processCors.bind(this);
  }

  /**
   * Sets CORS on all routes for `OPTIONS` HTTP method.
   * @param {Object} router Express app.
   */
  setCors(router) {
    router.options('*', cors(this._processCors));
  }

  /**
   * Shorthand function to register a route on this class.
   * @param {Object} router Express app.
   * @param {Array<Array<String>>} routes List of routes. Each route is an array
   * where:
   * - index `0` is the API route, eg, `/api/models/:modelId`
   * - index `1` is the function name to call
   * - index `2` is optional and describes HTTP method. Defaults to 'get'.
   * It must be lowercase.
   */
  wrapApi(router, routes) {
    for (let i = 0, len = routes.length; i < len; i++) {
      const route = routes[i];
      const method = route[2] || 'get';
      const clb = this[route[1]].bind(this);
      router[method](route[0], cors(this._processCors), clb);
    }
  }

  /**
   * @return {TokenModel} Instance of TokenModel
   */
  get tokenModel() {
    if (!tokenModel) {
      tokenModel = new TokenModel();
    }
    return tokenModel;
  }

  /**
   * Sends error to the client in a standarized way.
   * @param {Response} res HTTP response object
   * @param {String} message Error message to send.
   * @param {Number=} [status=400] HTTP status code, default to 400.
   */
  sendError(res, message, status=400) {
    res.status(status).send({
      error: true,
      message,
    });
  }

  /**
   * Tests whether the request has user session that is admin / org user or has
   * authorization header with valid JWT.
   * @param {Request} req
   * @param {String=} scope
   * @return {Promise<Boolean>}
   */
  async isValidAccess(req, scope) {
    // @ts-ignore
    const { user } = req;
    if (user && (user.orgUser || user.superUser)) {
      return true;
    }
    const auth = req.get('authorization');
    if (!auth) {
      return false;
    }
    if (!String(auth).toLowerCase().startsWith('bearer ')) {
      return false;
    }
    const token = auth.substr(7);
    let detail;
    try {
      detail = await verifyToken(token);
    } catch (_) {
      return false;
    }
    if (isTokenExpired(detail)) {
      return false;
    }
    if (scope) {
      if (!hasScope(detail, 'all')) {
        if (!hasScope(detail, scope)) {
          return false;
        }
      }
    }
    let queryResult;
    try {
      queryResult = await this.tokenModel.find(token);
      if (!queryResult || queryResult.revoked) {
        return false;
      }
      // @ts-ignore
      req.user = {
        id: queryResult.issuer.id,
        displayName: queryResult.issuer.displayName,
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Ensures that the current user has access to the resource or throws an error
   * otherwise.
   * @param {Object} req
   * @param {?String} scope
   * @return {Promise} Resolves when has access, rejects when do not have access.
   */
  async ensureAccess(req, scope) {
    let has = false;
    try {
      has = await this.isValidAccess(req, scope);
    } catch (_) {
      // ..
    }
    if (!has) {
      throw new AccessError();
    }
  }

  /**
   * Processes CORS request.
   * @param {Request} req
   * @param {Function} callback
   */
  _processCors(req, callback) {
    const whitelist = [
      'https://ci.advancedrestclient.com',
    ];
    const origin = req.header('Origin');
    let corsOptions;
    if (!origin) {
      corsOptions = { origin: false };
    } else if (origin.indexOf('http://localhost:') === 0 || origin.indexOf('http://127.0.0.1:') === 0) {
      corsOptions = { origin: true };
    } else if (whitelist.indexOf(origin) !== -1) {
      corsOptions = { origin: true };
    }
    if (corsOptions) {
      // @ts-ignore
      corsOptions.credentials = true;
      // @ts-ignore
      corsOptions.allowedHeaders = ['Content-Type', 'Authorization'];
      // @ts-ignore
      corsOptions.origin = origin;
    }
    callback(null, corsOptions);
  }

  /**
   * Sends response as a list response.
   * @param {object[]} result Response from the data model.
   * @param {Response} res HTTP resposne
   */
  sendListResult(result, res) {
    const data = {
      items: result[0],
    };
    if (result[1]) {
      data.nextPageToken = result[1];
    }
    res.send(data);
  }

  /**
   * Sends query results data in response.
   * @param {QueryResult} data
   * @param {Response} res HTTP resposne
   */
  sendQueryResult(data, res) {
    const result = {
      items: data.entities,
    };
    if (data.pageToken) {
      result.nextPageToken = data.pageToken;
    }
    res.send(result);
  }

  /**
   * Validates pagination parameters for variuos endpoints that result with list of results.
   * @param {Object} req HTTP request
   * @return {String|undefined} Validation oerr message or undefined if valid.
   */
  validatePagination(req) {
    const messages = [];
    let { limit } = req.query;
    if (limit) {
      if (isNaN(limit)) {
        messages[messages.length] = 'Limit value is not a number';
      }
      limit = Number(limit);
      if (limit > 300 || limit < 0) {
        messages[messages.length] = 'Limit out of bounds [0, 300]';
      }
    }
    return messages.length ? messages.join(' ') : undefined;
  }
}
