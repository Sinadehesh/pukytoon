// The Creator Studio, as a person uses it on a phone: pick a mechanic and theme, tune it with a live
// preview, set rules (a preset, a bad and a good custom one), swap a picture, add music and a name,
// publish, play it from the feed, edit it, and close the Studio with Back.
import { devices, wait, OUT } from './helpers.mjs';

export async function run({ browser, url, check }) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await wait(1000);
    const preview = async () => (await page.waitForSelector('#studio-frame')).contentFrame();
    const ready = f => f.waitForFunction(() => window.__puky && window.__puky.ready, null, { timeout: 15000 });

    await page.click('#btn-create');
    await page.waitForSelector('#studio:not([hidden])');
    check((await page.$$('#studio-mechanics .card')).length === 4 && (await page.$$('#studio-themes .card')).length === 6, 'Studio offers 4 mechanics and 6 themes');
    let f = await preview(); await ready(f);
    check((await f.evaluate(() => window.__puky.manifest.key)) === 'drop-merge', 'The preview starts with Drop and merge');
    await page.screenshot({ path: `${OUT}/studio-01.png` });

    await page.click('#studio-mechanics .card:has-text("Endless runner")'); await wait(400);
    await page.click('#studio-themes .card:has-text("Sweet Shop")'); await wait(400);
    f = await preview(); await ready(f);
    check((await f.evaluate(() => window.__puky.manifest.key)) === 'endless-runner', 'The preview switches to the runner');
    check(await page.inputValue('#studio-title') === 'Sweet Shop Dash', 'Named after the theme until a name is typed');
    check((await page.$$('#studio-params .param')).length === 8, 'The runner shows its 8 settings');

    await f.evaluate(() => { window.__got = []; Pukytoon.on('spec.update', s => window.__got.push(s)); });
    await page.$eval('#param-speed', el => {
        el.value = '9';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(300);
    check((await f.evaluate(() => window.__puky.params().speed)) === 9, 'A new speed reaches the running preview');
    await page.click('#studio-win .chip:has-text("Run 500 m")'); await wait(200);
    check((await f.evaluate(() => window.__got.at(-1).rules.win)) === 'distance >= 500', 'A win preset reaches the preview');
    await page.click('#studio-lose .chip:has-text("Custom")');
    await page.fill('#studio-lose .rule-input', 'lives = 0');
    check((await page.textContent('#studio-lose .rule-note')).includes('=='), 'A mistyped rule is explained');
    await page.fill('#studio-lose .rule-input', 'lives <= 0 || time >= 45');
    check((await page.textContent('#studio-lose .rule-note')) === '', 'A good custom rule is accepted');
    await page.click('#studio-pictures .slot-head:has-text("Runner")');
    await page.click('#studio-pictures .pic[title="Fox"]'); await wait(400);
    f = await preview(); await ready(f);
    await page.click('#studio-music .chip:has-text("Easy Lemon")'); await wait(300);
    check((await page.textContent('#studio-credit')).includes('Kevin MacLeod'), 'Choosing music shows its credit');
    await page.fill('#studio-title', 'Gummy Fox Dash');
    check((await page.textContent('#studio-share .chip.selected')) === 'Everyone', 'A new game is for everyone unless you say otherwise');
    await page.click('#studio-share .chip:has-text("Only on this phone")');   // sharing is the cloud suite's
    await page.screenshot({ path: `${OUT}/studio-02.png` });

    await page.click('#studio-publish'); await wait(1500);
    check(await page.isHidden('#studio'), 'Publish closes the Studio');
    check((await page.textContent('.slide.active h2')) === 'Gummy Fox Dash' && (await page.textContent('.slide.active .chip')) === 'Made in the Studio' &&
          (await page.textContent('.slide.active .caption p')) === 'Endless runner · Sweet Shop', 'The game is on screen in the feed, credited to the Studio');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.games.v1'))[0]);
    check(saved.kind === 'studio' && saved.spec.theme.overrides.player === 'pets/07_fox' && saved.spec.params.speed === 9 &&
          saved.spec.rules.lose === 'lives <= 0 || time >= 45' && saved.spec.theme.overrides.music === 'easy_lemon',
          `Its spec keeps every choice, in ${JSON.stringify(saved.spec).length} bytes`);
    const g = await (await page.waitForSelector('.slide.active iframe')).contentFrame(); await ready(g);
    await wait(500);
    check((await g.evaluate(() => window.__puky.scene)) === 'title', 'In the feed it waits, paused, under the Play cover');

    await page.click('.slide.active .cover'); await wait(800);
    check((await g.evaluate(() => window.__puky.scene)) === 'play', 'Play starts it at once (no second tap)');
    const box = await (await page.$('.slide.active iframe')).boundingBox();
    for (let k = 0; k < 6; k++) { await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await wait(450); }
    const v = await g.evaluate(() => window.__puky.vars());
    check(v.distance > 0 && v.time > 1, `It runs and takes taps (${v.distance} m)`);
    await page.screenshot({ path: `${OUT}/studio-03-playing.png` });
    await page.click('#btn-back'); await wait(600);
    const t1 = await g.evaluate(() => window.__puky.vars().time); await wait(800);
    check(t1 === await g.evaluate(() => window.__puky.vars().time), 'Back to the feed pauses it');

    await page.click('.slide.active .rail button[aria-label="Edit in the Studio"]');
    await page.waitForSelector('#studio:not([hidden])');
    check(await page.inputValue('#studio-title') === 'Gummy Fox Dash' && (await page.textContent('#studio-publish')) === 'Save', 'Edit opens it in the Studio, with Save');
    await page.fill('#studio-title', 'Gummy Fox Sprint');
    await page.click('#studio-publish'); await wait(1200);
    check((await page.textContent('.slide.active h2')) === 'Gummy Fox Sprint' &&
          await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.games.v1')).length) === 1, 'Saving updates the same game');

    await page.click('#btn-create'); await page.waitForSelector('#studio:not([hidden])'); await wait(300);
    await page.click('#studio-themes .card:has-text("Gem Mine")'); await wait(600);
    await page.evaluate(() => history.back()); await wait(600);
    check(await page.isHidden('#studio'), 'Back closes the Studio, even after the preview reloaded');
    await page.reload(); await wait(1500);
    check(await page.evaluate(() => [...document.querySelectorAll('.slide h2')].some(h => h.textContent === 'Gummy Fox Sprint')), 'The game is still there after a reload');
    check(!errors.length, `No page errors${errors.length ? ': ' + errors[0] : ''}`);
    await ctx.close();
}
