// Runs the tests in a headless phone-sized Chromium against a local copy of the site:
//   node tests/run.mjs                 all of them
//   node tests/run.mjs mechanics       one or more of: mechanics, feed, studio, cloud
// Every browser context gets a stand-in for the Supabase project (tests/fake-cloud.mjs) as context.cloud,
// so no test reaches the real one.
import { serve, launch, counter } from './helpers.mjs';
import { fakeCloud } from './fake-cloud.mjs';

const SUITES = {
    mechanics: () => import('./mechanics.test.mjs'),
    feed: () => import('./feed.test.mjs'),
    studio: () => import('./studio.test.mjs'),
    cloud: () => import('./cloud.test.mjs')
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUITES);
const { server, url } = await serve();
const browser = await launch();
const newContext = browser.newContext.bind(browser);
browser.newContext = async (...args) => {
    const context = await newContext(...args);
    context.cloud = await fakeCloud(context);
    return context;
};
const results = counter();

for (const name of names) {
    if (!SUITES[name]) { results.check(false, `no test suite called "${name}"`); continue; }
    console.log(`\n# ${name}`);
    const suite = await SUITES[name]();
    try {
        await suite.run({ browser, url, check: results.check });
    } catch (e) {
        results.check(false, `${name} stopped: ${e && e.stack ? e.stack : e}`);
    }
}

await browser.close();
server.close();
console.log(`\n${results.passed} passed, ${results.failed} failed`);
process.exit(results.failed ? 1 : 0);
