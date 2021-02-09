// Copyright 2018, Mulesoft.
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

import { EventEmitter } from 'events';
import { PubSub } from '@google-cloud/pubsub';
import config from '../config.js';
import logging from './logging.js';

/** @typedef {import('@google-cloud/pubsub').Topic} Topic */
/** @typedef {import('@google-cloud/pubsub').Subscription} Subscription */
/** @typedef {import('@google-cloud/pubsub').Message} Message */

/**
 * A class that contains logic to communicate with the background
 * apps through the PubSub system.
 * @extends EventEmitter
 */
class Background extends EventEmitter {
  /**
   * @constructor
   */
  constructor() {
    super();
    /**
     * @type {String}
     */
    this.topicTestProcess = 'apic-tests';
    /**
     * @type {String}
     */
    this.topicCoverageProcess = 'apic-coverage';
    /**
     * @type {String}
     */
    this.topicTestResult = 'apic-test-result';
    /**
     * @type {String}
     */
    this.topicGhWebhook = 'apic-gh-webhook';
    /**
     * @type {String}
     */
    this.subBuildWorker = 'ci-build-worker';
    /**
     * @type {String}
     */
    this.subWorkerTestResult = 'ci-test-result';
    /**
     * @type {String}
     */
    this.subCoverageWorker = 'ci-coverage-worker';
    /**
     * @type {String}
     */
    this.subGhCi = 'ci-gh-subscription';
    /**
     * @type {PubSub}
     */
    this.pubsub = new PubSub({
      projectId: config.get('GCLOUD_PROJECT'),
    });
    /**
     * @type {Subscription[]}
     */
    this.subscriptions = [];
  }

  /**
   * Gets or creates Pub/Sub topic.
   * @param {String} name Topic name
   * @return {Promise<Topic>}
   */
  async getTopic(name) {
    try {
      const [topic] = await this.pubsub.topic(name).get();
      return topic;
    } catch (e) {
      logging.verbose(`Creating new topic ${name}`);
      const [topic] = await this.pubsub.createTopic(name);
      return topic;
    }
  }

  /**
   * Gets or creates Pub/Sub subscription.
   * @param {Topic} topic Existing topic.
   * @param {String} name Subscription name.
   * @return {Promise<Subscription>}
   */
  async getSubscription(topic, name) {
    try {
      const [subscription] = await this.pubsub.subscription(name).get();
      return subscription;
    } catch (e) {
      logging.verbose(`Creating new subscription ${name}`);
      const [subscription] = await this.pubsub.createSubscription(topic, name, {
        pushConfig: undefined,
      });
      return subscription;
    }
  }

  /**
   * Sunscribes to a test runner topic
   * @return {Promise<void>}
   */
  async subscribe() {
    logging.info('PubSub: Subscribing to Tests topic.');
    const topic = await this.getTopic(this.topicTestProcess);
    const subscription = await this.getSubscription(topic, this.subBuildWorker);
    subscription.on('message', this.handleMessage.bind(this, this.topicTestProcess));
    subscription.on('error', this.handleError.bind(this, this.topicTestProcess));
    logging.verbose(
      `Subscribed to a topic: ${this.topicTestProcess} with subscription ${this.subBuildWorker}`
    );
    this.subscriptions.push(subscription);
  }

  /**
   * Sunscribes to a github webhooks runner topic
   * @return {Promise<void>}
   */
  async subscribeGithubBuild() {
    logging.info('PubSub: Subscribing to GitHub topic...');
    const topic = await this.getTopic(this.topicGhWebhook);
    const subscription = await this.getSubscription(topic, this.subGhCi);
    subscription.on('message', this.handleMessage.bind(this, this.topicGhWebhook));
    subscription.on('error', this.handleError.bind(this, this.topicGhWebhook));
    logging.verbose(
      `Subscribed to a topic: ${this.topicGhWebhook} with subscription ${this.subGhCi}`
    );
    this.subscriptions.push(subscription);
    logging.info('PubSub: GitHub topic subscription ready.');
  }

  /**
   * Sunscribes to a test results topic
   * @return {Promise<void>}
   */
  async subscribeTestsResults() {
    logging.info('PubSub: Subscribing to Test results topic.');
    const topic = await this.getTopic(this.topicTestResult);
    const subscription = await this.getSubscription(topic, this.subWorkerTestResult);
    subscription.on('message', this.handleMessage.bind(this, this.topicTestResult));
    subscription.on('error', this.handleError.bind(this, this.topicTestResult));
    logging.verbose(
      `Subscribed to a topic: ${this.topicTestResult} with subscription ${this.subWorkerTestResult}`
    );
    this.subscriptions.push(subscription);
  }

  /**
   * Sunscribes to a coverage topic
   * @return {Promise<void>}
   */
  async subscribeCoverage() {
    logging.info('PubSub: Subscribing to Coverage topic.');
    const topic = await this.getTopic(this.topicCoverageProcess);
    const subscription = await this.getSubscription(topic, this.subCoverageWorker);
    subscription.on('message', this.handleMessage.bind(this, this.topicCoverageProcess));
    subscription.on('error', this.handleError.bind(this, this.topicCoverageProcess));
    logging.verbose(
      `Subscribed to a topic: ${this.topicCoverageProcess} with subscription ${this.subCoverageWorker}`
    );
    this.subscriptions.push(subscription);
  }

  /**
   * Handles a message from a topic.
   * It acknowledge receiving of the message and dispatches an
   * event with the message data.
   *
   * @param {Topic} topic The topic sending the message
   * @param {Message} message Incomming message
   */
  handleMessage(topic, message) {
    message.ack();
    const data = JSON.parse(message.data.toString('utf8'));
    this.emit('message', topic, data);
  }

  /**
   * Handles topic errors.
   *
   * @param {Topic} topic The topic sending the message
   * @param {Error} err Incomming error
   */
  handleError(topic, err) {
    this.emit('error', topic, err);
  }

  /**
   * Removes all active subscriptions.
   */
  unsubscribe() {
    this.subscriptions.forEach((sub) => {
      // @ts-ignore
      sub.removeListeners('message');
      // @ts-ignore
      sub.removeListeners('error');
    });
    this.subscriptions = [];
  }

  /**
   * Publishes a message to a topic
   * @param {object} payload The message to send
   * @param {string} topicName The name of the topic to publish the message to.
   * @return {Promise<void>}
   */
  async publish(payload, topicName) {
    try {
      const topic = await this.getTopic(topicName);
      await topic.publisher.publish(Buffer.from(JSON.stringify(payload)));
      logging.info(`Message published to topic ${topicName}`);
    } catch (e) {
      logging.error('Error occurred while queuing background task', e);
    }
  }

  /**
   * Queues a test to be performed by the worker
   * @param {String} id Datastore id of the test
   * @return {Promise}
   */
  async queueTest(id) {
    const data = {
      action: 'runTest',
      id,
    };
    await this.publish(data, this.topicTestProcess);
  }

  /**
   * Removes a test from the queue. This is done by the tests runner
   * worker.
   *
   * @param {string} id The ID of the test
   * @return {Promise<void>}
   */
  async dequeueTest(id) {
    const data = {
      action: 'removeTest',
      id,
    };
    await this.publish(data, this.topicTestProcess);
  }

  /**
   * Queues a coverage run to be performed by the worker
   * @param {String} id Datastore id of the run
   * @return {Promise}
   */
  async queueCoverageRun(id) {
    const data = {
      action: 'runCoverage',
      id,
    };
    await this.publish(data, this.topicCoverageProcess);
  }

  /**
   * Removes a coverage run from the queue. This is done by the coverage runner
   * worker.
   *
   * @param {string} id The ID of the test
   * @return {Promise<void>}
   */
  async dequeueCoverageRun(id) {
    const data = {
      action: 'removeCoverage',
      id,
    };
    await this.publish(data, this.topicCoverageProcess);
  }

  /**
   * Sends information to the background worker to queue a build
   * @param {String} id Build id
   * @return {Promise}
   */
  async queueStageBuild(id) {
    const data = {
      action: 'process-build',
      id,
    };
    await this.publish(data, this.topicGhWebhook);
  }

  /**
   * Sends information to the background worker to remove build from it's queue.
   * @param {string} id Build id
   * @return {Promise<void>}
   */
  async dequeueBuild(id) {
    const data = {
      action: 'remove-build',
      id,
    };
    await this.publish(data, this.topicGhWebhook);
  }
}
const instance = new Background();
export default instance;
