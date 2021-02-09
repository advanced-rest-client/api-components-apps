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
import config from './config';
import logging from './lib/logging';
import { ComponentModel } from './models/component-model';
import { TestsModel } from './models/test-model';
import { ApicTestRunner } from './test-runners/apic-test-runner.js';
import background from './lib/background';

const IS_PRODUCTION = config.get('NODE_ENV') === 'production';

if (IS_PRODUCTION) {
  traceAgent.start();
  debugAgent.start();
}

// When running on Google App Engine Managed VMs, the worker needs
// to respond to HTTP requests and can optionally supply a health check.
const app = express();
export default app;

app.use(logging.requestLogger);

app.get('/_ah/health', (req, res) => {
  res.status(200).send('ok');
});

class ApiComponentsTestsWorker {
  constructor() {
    this.testCount = 0;
    this.lastRunTime = 0;
    this.lastEndTime = 0;
    this.catalogModel = new ComponentModel();
    this.testsModel = new TestsModel();
    this.queue = [];
    this._onMessage = this._onMessage.bind(this);
    this._onError = this._onError.bind(this);
  }

  /**
   * Subscribe to Cloud Pub/Sub and receive messages to process tests requests.
   *
   * @return {Promise}
   */
  subscribe() {
    background.on('message', this._onMessage);
    background.on('error', this._onError);
    return background.subscribe();
  }

  _onMessage(topic, data) {
    switch (data.action) {
      case 'runTest':
        this.runTest(data.id);
        break;
      case 'removeTest':
        this.removeTest(data.id);
        break;
      default:
        logging.warn('Unknown request');
        logging.warn(data);
    }
  }

  _onError(topic, err) {
    logging.error(`Error in topic ${topic}`);
    logging.error(err);
  }

  removeTest(id) {
    logging.verbose('Removing test ' + id);
    const i = this.queue.findIndex((item) => item.entryId === id);
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

  async runTest(id) {
    logging.verbose('Running test ' + id);
    try {
      const info = await this.testsModel.getTest(id);
      this.setupQueue(id, info);
    } catch (e) {
      logging.warn(e);
    }
  }

  setupQueue(id, info) {
    const runner = new ApicTestRunner(id, info);
    this.queue.push(runner);
    logging.verbose('Test ' + id + ' added to the queue.');
    runner.once('end', () => this.afterRun(runner));
    runner.once('error', (err) => this.testError(runner, err));
    this.run();
  }

  routeMain(req, res) {
    res.send(`This worker has processed ${this.testCount} tests.`);
  }

  routeTestRun(req, res) {
    const id = req.params.id;
    this.runTest(id)
      .then(() => {
        res.send(`This worker has processed ${this.testCount} tests.`);
      })
      .catch((cause) => {
        logging.error(cause);
        res.send(`${cause}`);
      });
  }

  afterRun(runner) {
    this.isRunning = false;
    this.testCount++;
    this._removeFromQueue(runner);
    this.run();
  }

  testError(runner, err) {
    this.isRunning = false;
    this.testCount++;
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

  _removeFromQueue(instance) {
    const index = this.queue.indexOf(instance);
    if (index === -1) {
      logging.warn('Test runner instance not in the queue.');
      return;
    }
    this.queue.splice(index, 1);
  }
}

const worker = new ApiComponentsTestsWorker();
app.get('/', worker.routeMain.bind(worker));
app.get('/test/:id', worker.routeTestRun.bind(worker));
app.use(logging.errorLogger);

const server = app.listen(config.get('PORT'), () => {
  const port = server.address().port;
  /* eslint-disable no-console */
  console.log(`Worker listening on port ${port}`);
});
// worker.processMessages();
worker.subscribe();
