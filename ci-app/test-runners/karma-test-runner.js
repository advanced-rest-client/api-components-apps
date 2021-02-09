/* eslint-disable require-jsdoc */
import path from 'path';
import { BaseTestRunner } from './base-test-runner.js';
import logging from '../lib/logging.js';
import { fork } from 'child_process';

export class KarmaTestRunner extends BaseTestRunner {
  _procCleanUp() {
    this._resolver = null;
    this._rejecter = null;
    this.proc.removeAllListeners('message');
    this.proc.removeAllListeners('error');
    try {
      this.proc.kill();
    } catch (_) {
      // ..
    }
    this.proc = null;
  }

  _messageHandler(data) {
    switch (data.type) {
      case 'error':
        this._rejecter(new Error(data.message));
        break;
      case 'result':
        this._resolver(data.result);
        break;
      case 'log':
        logging.verbose(data.message);
        return;
      default:
        logging.error(`Unknown command from karma process ${data.type}`);
        return;
    }
    this._procCleanUp();
  }

  _errorHandler(err) {
    this._rejecter(err);
    this._procCleanUp();
  }

  async _run() {
    this._messageHandler = this._messageHandler.bind(this);
    this._errorHandler = this._errorHandler.bind(this);
    // A placeholder for any ENV setup
    const env = Object.assign({ }, process.env);
    // execArgv are copied from this process and this is not what we want.
    const options = {
      execArgv: [],
      env,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    };
    return new Promise((resolve, reject) => {
      this._resolver = resolve;
      this._rejecter = reject;
      const file = path.join(__dirname, 'karma-proc.js');
      // @ts-ignore
      const proc = fork(file, options);
      this.proc = proc;
      proc.on('message', this._messageHandler);
      proc.on('error', this._errorHandler);
      proc.send({ workingDir: this.componentDir });
    });
  }
}
