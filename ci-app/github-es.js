/* eslint-disable require-jsdoc */
/* eslint-disable import/no-namespace */
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
import * as traceAgent from '@google-cloud/trace-agent';
import * as debugAgent from '@google-cloud/debug-agent';
import express from 'express';
import config from './config.js';
import logging from './lib/logging.js';
import background from './lib/background.js';
import { ApicBuildRunner } from './builds/build-runner.js';

const IS_PRODUCTION = config.get('NODE_ENV') === 'production';

if (IS_PRODUCTION) {
  traceAgent.start();
  debugAgent.start();
}

/**
 * Routing for GitHub web hooks.
 */
class GithubBuild {
  constructor() {
    this.queue = [];
    this._onMessage = this._onMessage.bind(this);
    this._onError = this._onError.bind(this);
  }

  /**
   * Subscribe to Cloud Pub/Sub and receive messages to process tests requests.
   *
   * @return {Promise}
   */
  async subscribe() {
    background.on('message', this._onMessage);
    background.on('error', this._onError);
    try {
      await background.subscribeGithubBuild();
    } catch (e) {
      logging.error(e);
      // eslint-disable-next-line no-process-exit
      process.exit(100);
    }
  }

  _onMessage(topic, data) {
    switch (data.action) {
      case 'process-build':
        this.processBuild(data.id);
        break;
      default:
        logging.warn('Unknown request');
        logging.warn(data);
    }
  }

  _onError(topic, err) {
    logging.error(`Error in GitHub topic ${topic}`);
    logging.error(err);
  }

  processBuild(buildId) {
    this.setupQueue(buildId);
  }

  setupQueue(id) {
    logging.info(`Setting up the queue for ${id} build`);
    const runner = new ApicBuildRunner(id);
    this.queue.push(runner);
    logging.verbose(`Build ${id} added to the queue.`);
    runner.on('end', () => this.afterRun(runner));
    runner.on('error', (err) => this.buildError(runner, err));
    this.run();
  }

  afterRun(runner) {
    this.isRunning = false;
    this._removeFromQueue(runner);
    this.run();
  }

  buildError(runner, err) {
    this.isRunning = false;
    this._removeFromQueue(runner);
    logging.error(err);
    this.run();
  }

  run() {
    if (this.isRunning) {
      return;
    }
    if (this.queue.length) {
      this.isRunning = true;
      this.queue[0].run();
    }
  }

  routeRun(req, res) {
    const { id } = req.params;
    this.setupQueue(id);
    res.sendStatus(204);
  }

  _removeFromQueue(instance) {
    const index = this.queue.indexOf(instance);
    if (index === -1) {
      logging.warn('Test runner instance not in the queue.');
      return;
    }
    instance.abort = true;
    this.queue.splice(index, 1);
  }
}

// When running on Google App Engine Managed VMs, the worker needs
// to respond to HTTP requests and can optionally supply a health check.
const app = express();
export default app;

app.use(logging.requestLogger);

app.get('/_ah/health', (req, res) => {
  res.status(200).send('ok');
});

const worker = new GithubBuild();
app.get('/:id', worker.routeRun.bind(worker));
app.use(logging.errorLogger);

const server = app.listen(config.get('PORT'), () => {
  const port = server.address().port;
  /* eslint-disable no-console */
  console.log(`GitHub worker listening on port ${port}`);
});
worker.subscribe();
