import express from 'express';
import logging from '../lib/logging.js';
import testsRoute from './tests-api.js';
import meRoute from './me-api.js';
import tokenRoute from './token-api.js';
import githubRoute from './github-api.js';
import groupsRoute from './groups-api.js';
import componentsRoute from './components-api.js';
import messagesRoute from './messages-api.js';
import analyticsRoute from './analytics-api.js';
import buildsRoute from './builds-api.js';
import coverageRoute from './CoverageApi.js';

const router = express.Router();
export default router;

// Test scheduling route
router.use('/tests', testsRoute);
// User route
router.use('/me', meRoute);
// JWT info route
router.use('/tokeninfo', tokenRoute);
// GitHub webhooks route
router.use('/github', githubRoute);
// Groups route
router.use('/groups', groupsRoute);
// Components route
router.use('/components', componentsRoute);
// ARC info messages
router.use('/messages', messagesRoute);
// ARC analytics route
router.use('/analytics', analyticsRoute);
// Componetns build status
router.use('/builds', buildsRoute);
// Componetns coverage data
router.use('/coverage', coverageRoute);
// Errors
router.use((req, res) => {
  const message = `Route ${req.url} not found`;
  logging.warn(message);
  res.status(404).send({
    error: true,
    message,
  });
});

// router.use((err, req, res) => {
//   logging.error(err);
//   res.send({
//     error: true,
//     message: 'There was an error. That is all we can share.',
//   });
// });
