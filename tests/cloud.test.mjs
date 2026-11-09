// Pukytoon online, against the stand-in for its Supabase project (tests/fake-cloud.mjs): everyone's games in
// the feed, signing in with an emailed code and picking a name, likes, sharing a Studio game and a Claude
// link, share links, reports, remixing, hiding someone, taking a game down, signing out, deleting the
// account, and carrying on with no connection.
import { devices, wait, OUT } from './helpers.mjs';

const spec = (key, pack, title) => ({ spec: 1, mechanic: { key, version: '1.0.0' }, params: {}, theme: { pack }, meta: { title } });

async function until(test, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await test()) return true;
        await wait(100);
    }
    return false;
}

async function phone(browser, url, setup) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], permissions: ['clipboard-read', 'clipboard-write'] });
    if (setup) setup(ctx.cloud);
    // The phone's share sheet: recorded instead of shown
    await ctx.addInitScript(() => { window.__shared = []; navigator.share = async data => { window.__shared.push(data); }; });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // 4xx answers (a wrong code, a second report) are part of the test; anything else is an error
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    return { ctx, page, errors, db: ctx.cloud };
}

const titles = page => page.$$eval('.slide:not(.add-slide) h2', hs => hs.map(h => h.textContent));
const activeTitle = page => page.textContent('.slide.active h2');
const toastSays = (page, text) => until(async () => (await page.textContent('#toast')).includes(text) && await page.$eval('#toast', t => t.classList.contains('show')));

async function goTo(page, title) {
    await page.evaluate(t => [...document.querySelectorAll('.slide')].find(s => s.querySelector('h2')?.textContent === t)?.scrollIntoView(), title);
    return until(async () => (await activeTitle(page)) === title);
}

async function signIn(page, db, email, { wrongFirst = false } = {}) {
    await page.fill('#acct-email-input', email);
    await page.click('#acct-email button[type=submit]');
    await page.waitForSelector('#acct-code:not([hidden])');
    if (wrongFirst) {
        await page.fill('#acct-code-input', '000000');
        await page.click('#acct-code button[type=submit]');
        await until(async () => (await page.textContent('#acct-error')) !== '');
    }
    await page.fill('#acct-code-input', db.codes[email]);
    await page.click('#acct-code button[type=submit]');
}

export async function run({ browser, url, check }) {
    let bobGame;
    const { ctx, page, errors, db } = await phone(browser, url, db => {
        const bob = db.person('bob', 'Bob'), cara = db.person('cara', 'Cara');
        bobGame = db.studioGame(bob, 'Bob’s Candy Swap', spec('match-3', 'sweets', 'Bob’s Candy Swap'), 5);
        db.linkGame(bob, 'Moon Jumper', 'https://claude.ai/public/artifacts/moon-1', 'claude', 10);
        db.studioGame(cara, 'Cara Dash', spec('endless-runner', 'pets', 'Cara Dash'), 20);
    });

    // Everyone's games, after the built-in ones
    await until(async () => (await titles(page)).length >= 5);
    const t = await titles(page);
    check(t.slice(2).join(' | ') === 'Bob’s Candy Swap | Moon Jumper | Cara Dash', `Everyone's games follow the built-in ones, newest first (${t.join(', ')})`);
    await goTo(page, 'Bob’s Candy Swap');
    check((await page.textContent('.slide.active .by')) === 'by Bob · @bob' && (await page.textContent('.slide.active .rail .count')) === '0',
          'A shared game says who made it, and how many like it');
    const g = await (await page.waitForSelector('.slide.active iframe')).contentFrame();
    await g.waitForFunction(() => window.__puky && window.__puky.ready, null, { timeout: 15000 });
    check((await g.evaluate(() => window.__puky.manifest.key)) === 'match-3', 'It plays from its spec, like a game made on this phone');
    await page.screenshot({ path: `${OUT}/cloud-01-feed.png` });

    // Liking needs an account: sign in with a code, pick a name
    await page.click('.slide.active .rail button[aria-label="Like"]');
    await page.waitForSelector('#account:not([hidden]) #acct-email:not([hidden])');
    check((await page.textContent('#acct-why')).includes('like'), 'Liking a shared game asks you to sign in, and says why');
    await page.screenshot({ path: `${OUT}/cloud-02-sign-in.png` });
    await signIn(page, db, 'tester@test.invalid', { wrongFirst: true });
    check(db.calls.includes('POST /auth/v1/otp'), 'The code is emailed (one request, no password)');
    await page.waitForSelector('#acct-name:not([hidden])');
    check(true, 'A wrong code is explained, the right one signs in, and a new account picks a name');
    await page.fill('#acct-display', 'Test Er');
    check(await page.inputValue('#acct-handle') === 'test_er', 'The @name follows the name until you change it');
    await page.fill('#acct-handle', 'bob');
    await page.click('#acct-name button[type=submit]');
    check(await until(async () => (await page.textContent('#acct-error')).includes('taken')), 'Someone else’s @name is refused');
    await page.fill('#acct-handle', 'tester');
    await page.click('#acct-name button[type=submit]');
    await until(async () => page.isHidden('#account'));
    const tester = db.users.find(u => u.handle === 'tester');
    check(!!tester && tester.display_name === 'Test Er' && await toastSays(page, 'Hi, Test Er!') &&
          (await page.textContent('#btn-account')) === 'T', 'The name is saved, and the account button shows it');

    // A reload keeps you signed in, with your name, and asks nothing
    await page.reload();
    await until(async () => (await page.textContent('#btn-account')) === 'T');
    await wait(600);
    check((await page.textContent('#btn-account')) === 'T' && await page.isHidden('#account'), 'After a reload you’re still signed in, with your name, and nothing pops up');
    await goTo(page, 'Bob’s Candy Swap');
    const likeCount = () => page.textContent('.slide.active .rail .count');
    await page.click('.slide.active .rail button[aria-label="Like"]');
    await until(async () => (await likeCount()) === '1');
    check(db.likes.length === 1 && (await likeCount()) === '1' &&
          (await page.textContent('.slide.active .rail button[aria-label="Like"]')) === '♥', 'Signed in, a like is saved online and counted');
    await page.click('.slide.active .rail button[aria-label="Like"]');
    await until(async () => (await likeCount()) === '0');
    check(db.likes.length === 0 && (await likeCount()) === '0', 'Tapping it again takes the like back');

    // A Studio game for everyone
    await page.click('#btn-create');
    await page.waitForSelector('#studio:not([hidden])');
    await page.click('#studio-mechanics .card:has-text("Whack-a-mole")'); await wait(400);
    await page.fill('#studio-title', 'Tester Whack');
    await page.click('#studio-publish');
    check(await toastSays(page, 'Shared with everyone'), 'Publish puts the game in everyone’s feed');
    const shared = db.games.find(x => x.title === 'Tester Whack');
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.games.v1'))[0]);
    check(!!shared && shared.owner_id === tester.id && shared.spec.mechanic.key === 'whack-a-mole' && local.cloudId === shared.id && local.slug === shared.slug,
          'Online it is the same spec, under your name; the phone remembers which game it is');
    check((await page.textContent('.slide.active .by')) === 'Shared with everyone', 'Its card says it’s shared');
    await page.click('.slide.active .rail button[aria-label="Share"]');
    const sent = await until(() => page.evaluate(() => window.__shared.length === 1));
    const link = sent && await page.evaluate(() => window.__shared[0].url);
    check(sent && link.endsWith(`?g=${shared.slug}`), `Share hands the phone a link to it (${link})`);

    // Editing it publishes a new version of the same game
    await page.click('.slide.active .rail button[aria-label="Edit in the Studio"]');
    await page.waitForSelector('#studio:not([hidden])');
    check((await page.textContent('#studio-share .chip.selected')) === 'Everyone', 'A shared game opens in the Studio still shared');
    await page.fill('#studio-title', 'Tester Whack 2');
    await page.click('#studio-publish');
    await until(() => shared.version === 2);
    check(shared.version === 2 && shared.title === 'Tester Whack 2' && db.games.filter(x => x.owner_id === tester.id).length === 1,
          'Saving it updates the shared game (version 2), not a second copy');

    // A Claude link for everyone
    await page.click('#btn-add');
    await page.fill('#drop', 'https://claude.ai/public/artifacts/tester-2');
    await page.fill('#name', 'Tester Claude');
    await page.click('#btn-save');
    check(await toastSays(page, 'Tap ⤴ to share it'), 'Adding a Claude link says it can be shared');
    await page.click('.slide.active .rail button[aria-label="Share"]');
    await page.waitForSelector('#menu:not([hidden])');
    await page.click('#menu-options button:has-text("Share with everyone")');
    await until(() => db.games.some(x => x.title === 'Tester Claude'));
    check(db.games.find(x => x.title === 'Tester Claude')?.made_with === 'claude' && await until(() => page.evaluate(() => window.__shared.length === 2)),
          'A Claude link is shared after asking, then its link goes to the share sheet');

    // A share link opens the feed at that game
    const page2 = await ctx.newPage();
    await page2.goto(`${url}?g=${bobGame.slug}`);
    await until(async () => (await page2.textContent('.slide[data-index="0"] h2').catch(() => '')) === 'Bob’s Candy Swap');
    check((await page2.textContent('.slide[data-index="0"] h2')) === 'Bob’s Candy Swap' && (await page2.textContent('.slide.active h2')) === 'Bob’s Candy Swap',
          'A share link opens the feed at its game, first');
    await page2.goto(`${url}?g=no-such-game-000000`);
    check(await toastSays(page2, 'isn’t on Pukytoon any more'), 'A link to a game that’s gone says so');
    await page2.close();

    // Someone else's game: copy its link, report it, remix it, hide its maker
    await goTo(page, 'Bob’s Candy Swap');
    await page.click('.slide.active .rail button[aria-label="More"]');
    await page.waitForSelector('#menu:not([hidden])');
    const options = await page.$$eval('#menu-options button', bs => bs.map(b => b.textContent));
    check(options.join(' | ') === '✦ Make your own version | Copy the link | Report this game | Hide games by Bob', `Its menu: ${options.join(', ')}`);
    await page.click('#menu-options button:has-text("Copy the link")');
    check(await toastSays(page, 'Link copied') && (await page.evaluate(() => navigator.clipboard.readText())).endsWith(`?g=${bobGame.slug}`), 'Copy the link copies it');
    await page.click('.slide.active .rail button[aria-label="More"]');
    await page.click('#menu-options button:has-text("Report this game")');
    await page.waitForSelector('#menu-options button:has-text("Spam")');
    await page.screenshot({ path: `${OUT}/cloud-03-report.png` });
    await page.click('#menu-options button:has-text("Spam")');
    check(await toastSays(page, 'Thanks for telling us') && db.reports.length === 1 && db.reports[0].reason === 'spam' && db.reports[0].game_id === bobGame.id,
          'A report goes in with its reason');
    await page.click('.slide.active .rail button[aria-label="More"]');
    await page.click('#menu-options button:has-text("Report this game")');
    await page.click('#menu-options button:has-text("Spam")');
    check(await toastSays(page, 'already reported') && db.reports.length === 1, 'Reporting it twice is counted once');
    await page.click('.slide.active .rail button[aria-label="More"]');
    await page.click('#menu-options button:has-text("Make your own version")');
    await page.waitForSelector('#studio:not([hidden])');
    check(await page.inputValue('#studio-title') === 'Bob’s Candy Swap remix' && (await page.textContent('#studio-publish')) === 'Publish' &&
          (await page.textContent('#studio-mechanics .card.selected')).includes('Match-3'), 'Remix opens their game in the Studio as a new one of yours');
    await page.evaluate(() => history.back());
    await until(async () => page.isHidden('#studio'));
    await goTo(page, 'Moon Jumper');
    await page.click('.slide.active .rail button[aria-label="More"]');
    await page.click('#menu-options button:has-text("Hide games by Bob")');
    await until(async () => !(await titles(page)).includes('Moon Jumper'));
    const after = await titles(page);
    check(!after.includes('Moon Jumper') && !after.includes('Bob’s Candy Swap') && after.includes('Cara Dash'), 'Hiding Bob takes all his games out of your feed');

    // Taking your own game down
    await goTo(page, 'Tester Whack 2');
    await page.click('.slide.active .rail button[aria-label="Remove from the feed"]');
    await page.click('#menu-options button:has-text("Take it down for everyone too")');
    await until(async () => !(await titles(page)).includes('Tester Whack 2'));
    check(!db.games.some(x => x.title === 'Tester Whack 2') && !(await titles(page)).includes('Tester Whack 2'), 'Removing a shared game can take it down for everyone');

    // Signing out, signing in again, deleting the account
    await page.click('#btn-account');
    check((await page.textContent('#acct-me-name')) === 'Test Er' && (await page.textContent('#acct-me-detail')) === '@tester · tester@test.invalid', 'The account sheet shows your name and email');
    await page.click('#acct-signout');
    check(await until(async () => (await page.textContent('#btn-account')) === '☺') && db.calls.includes('POST /auth/v1/logout'), 'Sign out');
    await page.click('#btn-account');
    await signIn(page, db, 'tester@test.invalid');
    check(await toastSays(page, 'Signed in as Test Er') && await page.isHidden('#account') && db.users.filter(u => u.handle === 'tester').length === 1,
          'Signing in again finds your name: no second account');
    await page.click('#btn-account');
    await page.waitForSelector('#acct-me:not([hidden])');
    await page.click('#acct-rename');
    await page.fill('#acct-display', 'Test Err');
    await page.click('#acct-name button[type=submit]');
    await page.waitForSelector('#acct-me:not([hidden])');
    check((await page.textContent('#acct-me-name')) === 'Test Err' && db.users.find(u => u.handle === 'tester').display_name === 'Test Err',
          'Change my name updates it, and goes back to the account');
    await page.click('#acct-delete');
    await until(() => db.calls.includes('POST /rest/v1/rpc/delete_my_account'));
    await until(async () => (await page.textContent('#btn-account')) === '☺');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.games.v1')).find(x => x.title === 'Tester Claude'));
    check(!db.users.some(u => u.handle === 'tester') && !db.games.some(x => x.title === 'Tester Claude') && kept && !kept.cloudId,
          'Delete the account: it and its shared games are gone online, the phone keeps its copies');

    // Publishing for everyone while signed out, then not signing in
    await page.click('#btn-create');
    await page.waitForSelector('#studio:not([hidden])');
    await page.fill('#studio-title', 'Offline Merge');
    await page.click('#studio-publish');
    await page.waitForSelector('#account:not([hidden])');
    check((await page.textContent('#acct-why')).includes('share your game'), 'Publishing for everyone while signed out asks you to sign in');
    await page.click('#account .sheet-backdrop');
    check(await toastSays(page, 'Saved on this phone') && (await activeTitle(page)) === 'Offline Merge', '...and closing that keeps the game on the phone');
    check(!errors.length, `No page errors${errors.length ? ': ' + errors[0] : ''}`);
    await ctx.close();

    // On the website, the email's link comes back to the page it was sent from, signed in
    const web = await phone(browser, url, db => { db.person('webby', 'Webby'); });
    await web.page.click('#btn-account');
    await web.page.fill('#acct-email-input', 'webby@test.invalid');
    await web.page.click('#acct-email button[type=submit]');
    await web.page.waitForSelector('#acct-code:not([hidden])');
    const back = web.db.redirects['webby@test.invalid'];
    check(back === url, `The website's sign-in link comes back to the website (${back})`);
    const opened = await web.ctx.newPage();   // a link from an email arrives as a fresh page load
    opened.on('pageerror', e => web.errors.push(e.message));
    await opened.goto(`${back}#${web.db.linkFor('webby@test.invalid')}`);
    check(await until(async () => (await opened.textContent('#btn-account')) === 'W') && !(await opened.evaluate(() => location.hash)),
          'Opening it signs in, and the address forgets the link’s tokens');
    check(!web.errors.length, `No page errors on the website link${web.errors.length ? ': ' + web.errors[0] : ''}`);
    await web.ctx.close();

    // No connection: the phone's games, and a clear message when signing in
    const off = await phone(browser, url, db => { db.down = true; });
    await until(async () => (await titles(off.page)).length >= 2);
    await wait(800);
    check((await titles(off.page)).join(' | ') === 'Happy Animal Merge | Zombie Bomber', 'With no connection the feed still has the games on the phone');
    await off.page.click('#btn-account');
    await off.page.fill('#acct-email-input', 'x@test.invalid');
    await off.page.click('#acct-email button[type=submit]');
    check(await until(async () => (await off.page.textContent('#acct-error')).includes('No connection')), 'Signing in offline says there’s no connection');
    check(!off.errors.length, `No page errors offline${off.errors.length ? ': ' + off.errors[0] : ''}`);
    await off.ctx.close();
}
