// Copyright 2019, Mulesoft.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { start as traceStart } from '@google-cloud/trace-agent';
import { start as debugStart } from '@google-cloud/debug-agent';
import express from 'express';
import config from './config.js';
import logging from './lib/logging.js';
import background from './lib/background.js';
import { CoverageModel } from './models/CoverageModel.js';
import { CoverageRunner } from './coverage-runner/CoverageRunner.js';

/** @typedef {import('@google-cloud/pubsub').Topic} Topic */
/** @typedef {import('./models/CoverageModel.js').CoverageRun} CoverageRun */
/** @typedef {import('http').IncomingMessage} IncomingMessage */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').Request} Request */

const IS_PRODUCTION = config.get('NODE_ENV') === 'production';

if (IS_PRODUCTION) {
  traceStart();
  debugStart();
}

// When running on Google App Engine Managed VMs, the worker needs
// to respond to HTTP requests and can optionally supply a health check.
const app = express();
export default app;

app.use(logging.requestLogger);

app.get('/_ah/health', (req, res) => {
  res.status(200).send('ok');
});

/**
 * Handler for the error event from the topic.
 *
 * @param {Topic} topic The source topic
 * @param {Error} err An error
 */
function onError(topic, err) {
  logging.error(`Error in topic ${topic}`);
  logging.error(err);
}

/**
 * A worker that performs a component test, reads lcov coverage
 * results, and uploads them to the store.
 */
class ApiComponentsCoverageWorker {
  /**
   * @constructor
   */
  constructor() {
    this._onMessage = this._onMessage.bind(this);
    /**
     * @type {CoverageRunner[]}
     */
    this.queue = [];
    this.model = new CoverageModel();
  }

  /**
   * Subscribe to Cloud Pub/Sub and receive messages to process tests requests.
   *
   * @return {Promise<void>}
   */
  async subscribe() {
    background.on('message', this._onMessage);
    background.on('error', onError);
    await background.subscribeCoverage();
  }

  /**
   * Handler for the message event from the topic.
   *
   * @param {Topic} topic The source topic
   * @param {object} data Incomming message
   */
  _onMessage(topic, data) {
    switch (data.action) {
      case 'runCoverage':
        this.runTest(data.id);
        break;
      case 'removeCoverage':
        this.removeTest(data.id);
        break;
      default:
        logging.warn('Unknown request');
        logging.warn(data);
    }
  }

  /**
   * Removes coverage run from the queue.
   * @param {string} id Coverage run id.
   */
  removeTest(id) {
    logging.verbose(`Removing test ${id}`);
    const i = this.queue.findIndex((item) => item.id === id);
    if (i !== -1) {
      const instance = this.queue[i];
      if (instance.running) {
        this.isRunning = false;
      }
      instance.abort = true;
      instance.removeAllListeners();
      this.queue.splice(i, 1);
      if (instance.workingDir) {
        instance.cleanup();
      }
    }
  }

  /**
   * Adds coverage run to the queue.
   * @param {string} id Coverage run id.
   */
  async runTest(id) {
    logging.verbose(`Running test ${id}`);
    try {
      const info = await this.model.get(id);
      this.setupQueue(id, info);
    } catch (e) {
      logging.warn(e);
    }
  }

  /**
   * Adds a coverage run to the queue.
   *
   * @param {string} id The ID of the run
   * @param {CoverageRun} info Datastore entry.
   */
  setupQueue(id, info) {
    const runner = new CoverageRunner(id, info);
    this.queue.push(runner);
    logging.verbose(`Coverage run ${id} added to the queue.`);
    runner.once('end', () => this.afterRun(runner));
    this.run();
  }

  /**
   * Web API access to run a test. This is for debug only.
   *
   * @param {Request} req
   * @param {Response} res
   * @return {Promise<void>}
   */
  async routeTestRun(req, res) {
    if (IS_PRODUCTION) {
      res.send(`Not allowed in production.`);
      return;
    }
    const { id } = req.params;
    try {
      await this.runTest(id);
      res.send({
        result: 'ok',
      });
    } catch (e) {
      logging.error(e);
      res.send('Unable to process the request');
    }
  }

  /**
   * A lifecycle method called when the coverage returned with a result.
   * @param {CoverageRunner} runner A runner that finished working
   */
  afterRun(runner) {
    this.isRunning = false;
    this._removeFromQueue(runner);
    this.run();
  }

  /**
   * Runs a next item from the queue.
   */
  run() {
    if (this.isRunning) {
      return;
    }
    if (this.queue.length) {
      this.isRunning = true;
      this.queue[0].run();
    }
  }

  /**
   * Removes a runner instance from the queue.
   * @param {CoverageRunner} instance A runner that is to be removed.
   */
  _removeFromQueue(instance) {
    const index = this.queue.indexOf(instance);
    if (index === -1) {
      logging.warn('Test runner instance not in the queue.');
      return;
    }
    this.queue.splice(index, 1);
  }
}

const worker = new ApiComponentsCoverageWorker();
app.get('/test/:id', worker.routeTestRun.bind(worker));
app.use(logging.errorLogger);

const server = app.listen(config.get('PORT'), () => {
  // @ts-ignore
  const { port } = server.address();
  /* eslint-disable no-console */
  console.log(`Worker listening on port ${port}`);
  worker.subscribe();
});
// worker.processMessages();
