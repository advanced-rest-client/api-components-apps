/* eslint-disable no-sync */
/* eslint-disable no-console */

// import { KarmaTestRunner } from '../test-runners/karma-test-runner.js';
// const testConfig = {
//   component: '@advanced-rest-client/arc-icons',
//   org: 'advanced-rest-client',
//   branch: 'master',
//   type: 'bottom-up',
//   includeDev: false
// };

// const runner = new KarmaTestRunner(
//     'advanced-rest-client',
//     'arc-icons',
//     '@advanced-rest-client/arc-icons',
//     testConfig
// );
// runner.run()
//     .then((result) => console.log(result))
//     .catch((cause) => console.log(cause));

import { AmfBuilder } from '../test-runners/amf-builder.js';
import { KarmaTestRunner } from '../test-runners/karma-test-runner.js';
import tmp from 'tmp';
import fs from 'fs-extra';

(async () => {
  const tmpObj = tmp.dirSync({ keep: true });
  const workingDir = tmpObj.name;
  const config = {
    branch: 'release/4.7.0',
  };
  const build = new AmfBuilder(workingDir, config);
  try {
    await build.run();
    console.log('Build complete');
    const list = await fs.readdir(`${workingDir}/lib`);
    console.log(list);

    const runner = new KarmaTestRunner('advanced-rest-client', 'amf-helper-mixin', '@advanced-rest-client/amf-helper-mixin', config);
    runner.workingDir = workingDir;
    const result = await runner.run();
    console.log('test result');
    console.log(result);
  } catch (e) {
    console.error(e);
  }
})();

// // import { GitSourceControl } from '../github/git-source-control.js';
// import { Changelog } from '../builds/changelog.js';
// import path from 'path';
// // import fs from 'fs-extra';
//
// (async () => {
//   const workingDir = '/tmp/apic-ci-tests';
//   // await fs.ensureDir(workingDir);
//   const org = 'advanced-rest-client';
//   const name = 'auth-methods';
//   const elementDir = path.join(workingDir, name);
//   // const github = new GitSourceControl(workingDir, org, name);
//   // await github.clone(false);
//   // console.log(elementDir);
//   const changelog = new Changelog(elementDir, org, name);
//   const value = await changelog.get();
//   console.log(value);
// })();
