import winston from 'winston';
import expressWinston from 'express-winston';
import { LoggingWinston } from '@google-cloud/logging-winston';
import config from '../config.js';

const colorize = config.get('NODE_ENV') !== 'production';

// Logger to capture all requests and output them to the console.
const requestLogger = expressWinston.logger({
  level: 'warn',
  transports: [
    new LoggingWinston(),
    new winston.transports.Console({
      json: false,
      colorize,
    }),
  ],
  expressFormat: true,
  meta: false,
});

// Logger to capture any top-level errors and output json diagnostic info.
const errorLogger = expressWinston.errorLogger({
  level: 'warn',
  transports: [
    new LoggingWinston(),
    new winston.transports.Console({
      json: true,
      colorize,
    }),
  ],
});

const logger = winston.createLogger({
  level: 'verbose',
  transports: [
    new winston.transports.Console({
      json: false,
      colorize,
    }),
  ],
});
export default {
  errorLogger,
  requestLogger,
  error: logger.error.bind(logger),
  warn: logger.warn.bind(logger),
  info: logger.info.bind(logger),
  log: logger.log.bind(logger),
  verbose: logger.verbose.bind(logger),
  debug: logger.debug.bind(logger),
  silly: logger.silly.bind(logger),
};
