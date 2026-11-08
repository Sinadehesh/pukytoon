// The feed, on a Pixel 7-sized screen: swiping, playing, adding games from links and every kind of code,
// their saves, likes and removing; then link games as the Android app plays them (its native plugins
// stood in for by recorders).
import { devices, wait, OUT } from './helpers.mjs';

const HTML_GAME = "Here's your game!\n```html\n<!DOCTYPE html><html><head><title>Tap Counter</title><style>body{margin:0;display:grid;place-items:center;height:100vh;background:#123;color:#fff;font:24px sans-serif}</style></head>\n<body><button id=\"b\" style=\"font-size:32px;padding:20px\">Tap me</button><div id=\"c\">0</div>\n<script>let n=+localStorage.getItem('taps')||0;c.textContent=n;b.onclick=()=>{n++;localStorage.setItem('taps',n);c.textContent=n;};</script></body></html>\n```\nEnjoy!";
const REACT_GAME = `import React, { useState } from 'react';
import { Trophy, RotateCcw, Github } from 'lucide-react';

export default function ReactionGame() {
  const [score, setScore] = useState(0);
  return (
    <div id="wrap" className="min-h-screen flex flex-col items-center justify-center bg-indigo-600 text-white gap-4">
      <h1 className="text-3xl font-bold flex items-center gap-2"><Trophy /> Score: <span id="score">{score}</span></h1>
      <button id="hit" className="px-6 py-3 bg-white text-indigo-700 rounded-xl" onClick={() => setScore(s => s + 1)}>Hit</button>
      <button onClick={() => setScore(0)}><RotateCcw /><Github /></button>
    </div>
  );
}`;
const SHADCN_GAME = `import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
export default function App() { const [n, setN] = useState(0);
  return <Card className="m-4"><CardHeader><CardTitle>Clicker</CardTitle></CardHeader>
  <CardContent><Button id="go" onClick={() => setN(n + 1)}>Clicked {n}</Button></CardContent></Card>; }`;
const TS_GAME = `import { useState } from 'react';
type P = { start: number };
const Counter = ({ start }: P) => { const [n, setN] = useState<number>(start); return <button id="ts" onClick={() => setN(n + 1)}>TS {n}</button>; };
export default function App() { return <Counter start={5} />; }`;
const BROKEN_GAME = `export default function App() { return <div>{undefinedThing}</div>; }`;
const JS_GAME = `const c = document.createElement('canvas'); c.id = 'cv'; c.width = 200; c.height = 200; document.body.appendChild(c);
const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(10, 10, 100, 100); window.drawn = true;`;
const GEMINI = 'https://gemini.google.com/share/16dc6123e264';

export async function run({ browser, url, check }) {
    await feed({ browser, url, check });
    await inApp({ browser, url, check });
}

async function feed({ browser, url, check }) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    // Real touch events: Chromium's synthesized scroll gesture does nothing in headless mode
    const touchSwipe = async (y0, y1, steps, ms) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
        for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / steps }] }); await wait(ms); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const swipeUp = () => touchSwipe(700, 250, 12, 12);
    const flickUp = () => touchSwipe(650, 520, 3, 10);
    const flickDown = () => touchSwipe(400, 530, 3, 10);
    const activeIndex = () => page.evaluate(() => Number(document.querySelector('.slide.active')?.dataset.index));
    const activeFrame = async () => (await page.waitForSelector('.slide.active iframe')).contentFrame();
    const playing = () => page.evaluate(() => document.body.classList.contains('playing'));

    await page.goto(url);
    const det = await page.evaluate(async () => {
        const r = await import('./js/runtime.js');
        const d = s => { const x = r.detectInput(s); return x && (x.kind === 'link' ? `link:${x.source}:${x.embeddable}:${x.url}` : `code:${x.format}`); };
        return {
            claude: d('https://claude.ai/public/artifacts/0b6c7e7a-1111-2222-3333-444455556666'),
            claudeEmbed: d('<iframe src="https://claude.site/public/artifacts/abc/embed" width="100%" height="600"></iframe>'),
            gemini: d('Check my game: https://gemini.google.com/share/16dc6123e264 !'),
            gco: d('https://g.co/gemini/share/abc'),
            kimi: d('https://www.kimi.com/share/xyz'),
            web: d('https://example.com/game.html'),
            html: d('<canvas id=c></canvas><script>1</script>'),
            react: d('import {useState} from "react"\nexport default function A(){return <div/>}'),
            jsxNoImport: d('function App(){ return (<div>Hi</div>) }'),
            js: d('const a = 1; console.log(a)'),
            urlInCode: d('<html><body><a href="https://claude.ai">x</a><script>let x={}</script></body></html>'),
            title1: r.guessTitle(r.detectInput('export default function SnakeGame(){return null}')),
            title2: r.guessTitle(r.detectInput('<html><head><title>Space Blaster</title></head></html>'))
        };
    });
    check(det.claude.startsWith('link:claude:false') && det.claudeEmbed === 'link:claude:false:https://claude.site/public/artifacts/abc/embed',
        'Claude links and embed code are recognised');
    check(det.gemini === 'link:gemini:false:https://gemini.google.com/share/16dc6123e264' && det.gco.startsWith('link:gemini') && det.kimi.startsWith('link:kimi'),
        'Gemini (also in a sentence, and g.co) and Kimi links');
    check(det.web.startsWith('link:web:true'), 'Other links play in the feed');
    check(det.html === 'code:html' && det.react === 'code:react' && det.jsxNoImport === 'code:react' && det.js === 'code:js' && det.urlInCode === 'code:html',
        'Code formats, and a URL inside code stays code');
    check(det.title1 === 'Snake Game' && det.title2 === 'Space Blaster', 'Titles guessed');

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await wait(1500);
    check(await activeIndex() === 0, 'Feed opens on the first game');
    const merge = await activeFrame();
    await merge.waitForSelector('canvas');
    check(merge.url().includes('happy-animal-merge'), 'Happy Animal Merge loads in the first slide');
    check(await page.isVisible('.slide.active .cover'), 'Cover over the game before playing');
    await page.screenshot({ path: `${OUT}/feed-01.png` });

    await page.click('.slide.active .cover');
    check(await playing(), 'Tap Play enters play mode');
    check(await page.isHidden('.slide.active .cover'), 'Cover is gone while playing');
    await merge.evaluate(() => { window.__drops = 0; const spawn = spawnItem; spawnItem = (...a) => { if (!a[3]) window.__drops++; return spawn(...a); }; });
    const box = await (await merge.$('#board')).boundingBox();
    for (let k = 0; k < 8; k++) { await page.touchscreen.tap(box.x + box.width * (0.25 + 0.07 * k), box.y + box.height * 0.3); await wait(350); }
    await wait(1500);
    const drops = await merge.evaluate(() => window.__drops);
    check(drops === 8, `Each tap drops an animal (${drops} drops)`);
    await swipeUp();
    await wait(800);
    check(await activeIndex() === 0, 'Swiping during play stays on the game');
    await merge.click('#btn-size');
    await wait(1200);
    check((await activeFrame()).url().includes('size=reverse'), 'Reverse mode loads');
    await page.evaluate(() => history.back());
    await wait(600);
    check(!(await playing()), 'Back leaves play mode (even after Reverse)');
    const physicsPaused = await (await activeFrame()).evaluate(() => paused);
    check(physicsPaused, 'Back in the feed, its physics are paused');

    await swipeUp(); await wait(1200);
    check(await activeIndex() === 1, 'Swiping on the cover moves to the next slide');
    await flickDown(); await wait(1500);
    check(await activeIndex() === 0, 'A short quick flick down goes back one game');
    await flickUp(); await wait(1500);
    check(await activeIndex() === 1, 'A short quick flick up moves on one game');

    check((await page.textContent('.slide.active h2')) === 'Zombie Bomber', 'Second slide is Zombie Bomber');
    const bomber = await activeFrame();
    check(bomber.url() === 'https://sinadehesh.github.io/Happy-Fruit-merge/bomber/', 'It loads from GitHub Pages');
    await bomber.waitForFunction(() => typeof state !== 'undefined' && document.querySelector('canvas').width > 0, null, { timeout: 30000 });
    await wait(1500);
    check(await bomber.evaluate(() => state) === 'title', 'It waits on its title screen');
    await page.click('.slide.active .cover');
    const cv = await (await bomber.$('canvas')).boundingBox();
    await page.touchscreen.tap(cv.x + cv.width / 2, cv.y + cv.height / 2); await wait(1500);
    const st = await bomber.evaluate(() => state);
    check(st === 'merge' || st === 'bomb', `Tapping starts a level (state: ${st})`);
    await page.click('#btn-back'); await wait(500);

    await swipeUp(); await wait(1200);
    check(await activeIndex() === 2, 'Then the add screen');
    check(await page.isVisible('.add-slide .studio-cta'), 'which also offers the Creator Studio');

    // An HTML game pasted with chat text around it
    await page.click('.add-slide .big-add');
    await page.fill('#drop', HTML_GAME);
    check((await page.textContent('#detect')).includes('HTML game') && await page.isVisible('#made-with'), 'Sheet: HTML game, with a made-with picker');
    await page.click('#made-with label:has-text("Gemini")');
    check((await page.getAttribute('#name', 'placeholder')).includes('Tap Counter'), 'Name suggested from <title>');
    await page.click('#btn-save'); await wait(1500);
    check(await activeIndex() === 2 && (await page.textContent('.slide.active .chip')) === 'Made with Gemini', 'Feed jumps to the new game, chip shows its source');
    let f = await activeFrame();
    await f.waitForSelector('#b');
    await page.click('.slide.active .cover');
    for (let k = 0; k < 3; k++) await f.click('#b');
    check((await f.textContent('#c')) === '3', 'HTML game runs and counts taps');
    await wait(300);
    await page.click('#btn-restart'); await wait(1200);
    f = await activeFrame(); await f.waitForSelector('#b');
    check((await f.textContent('#c')) === '3', 'Its localStorage save survives a restart (kept by the app through the bridge)');
    await page.click('#btn-back'); await wait(400);

    const addCode = async (code, source) => {
        await page.click('#btn-add');
        await page.fill('#drop', code);
        if (source) await page.click(`#made-with label:has-text("${source}")`);
        await page.click('#btn-save'); await wait(1200);
        return activeFrame();
    };
    f = await addCode(REACT_GAME, 'Claude');
    await f.waitForSelector('#hit', { timeout: 30000 }).catch(() => {});
    if (check(!!(await f.$('#hit')), 'React + lucide-react game renders')) {
        await page.click('.slide.active .cover');
        await f.click('#hit'); await f.click('#hit');
        check((await f.textContent('#score')) === '2', 'React state updates on tap');
        const bg = await f.evaluate(() => getComputedStyle(document.getElementById('wrap')).backgroundColor);
        check(bg === 'rgb(79, 70, 229)', `Tailwind classes apply (${bg})`);
        check((await f.$$('svg')).length >= 3, 'lucide icons (incl. Github) render');
        await page.click('#btn-back'); await wait(400);
    }
    check((await page.textContent('.slide.active h2')) === 'Reaction Game', 'React title from the component name');
    f = await addCode(SHADCN_GAME);
    await f.waitForSelector('#go', { timeout: 30000 }).catch(() => {});
    check(!!(await f.$('#go')), 'shadcn/ui-style game renders with the stand-in components');
    f = await addCode(TS_GAME);
    await f.waitForSelector('#ts', { timeout: 30000 }).catch(() => {});
    check(((await f.$('#ts')) && (await f.textContent('#ts'))) === 'TS 5', 'TypeScript React game renders');
    f = await addCode(JS_GAME);
    await f.waitForSelector('#cv', { timeout: 10000 }).catch(() => {});
    check(await f.evaluate(() => window.drawn === true), 'Plain JavaScript game runs');
    f = await addCode(BROKEN_GAME);
    await wait(4000);
    const banner = await f.evaluate(() => document.documentElement.innerText);
    check(/hit an error/.test(banner) && /undefinedThing/.test(banner), 'Broken game shows an error banner');

    // Links
    await page.click('#btn-add');
    await page.fill('#drop', 'https://claude.ai/public/artifacts/0b6c7e7a-1111-2222-3333-444455556666');
    check((await page.textContent('#detect')).includes('Claude link') && await page.isHidden('#made-with'), 'Sheet recognises a Claude link');
    await page.fill('#name', 'Moon Jumper');
    await page.click('#btn-save'); await wait(1000);
    check(await page.isVisible('.slide.active .poster') && (await page.textContent('.slide.active .play-note')) === 'Opens in a new tab',
        'A Claude link is a poster that opens in a new tab on the website');
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.click('.slide.active .cover')]);
    check(!!popup && popup.url().includes('claude.ai/public/artifacts'), 'Play opens the Claude link');
    if (popup) await popup.close();

    await page.click('.slide.active .rail button[aria-label="Like"]');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.likes.v1')).length === 1), 'Like is saved');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.games.v1')).length);
    page.once('dialog', d => d.accept());
    await page.click('.slide.active .rail button[aria-label="Remove from the feed"]'); await wait(800);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pukytoon.games.v1')).length);
    check(after === before - 1, `Remove deletes the game (${before} -> ${after})`);
    const loaded = await page.evaluate(() => document.querySelectorAll('.stage iframe').length);
    check(loaded <= 3, `At most 3 games loaded at once (${loaded})`);
    await page.reload(); await wait(1500);
    const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
    check(count === 2 + after + 1, `Feed rebuilt after a reload (${count} slides)`);
    await ctx.close();
}

async function inApp({ browser, url, check }) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    await ctx.addInitScript(() => {
        window.__calls = [];
        window.Capacitor = {
            isNativePlatform: () => true,
            Plugins: {
                InAppBrowser: {
                    openInWebView: a => { window.__calls.push(['openInWebView', a]); return Promise.resolve(); },
                    openInExternalBrowser: a => { window.__calls.push(['openInExternalBrowser', a]); return Promise.resolve(); }
                },
                App: { addListener: () => Promise.resolve({ remove() {} }), minimizeApp: () => {} },
                Share: { share: a => { window.__calls.push(['share', a]); return Promise.resolve({}); } }
            }
        };
    });
    const maker = ctx.cloud.person('maker', 'Maker');
    const shared = ctx.cloud.studioGame(maker, 'Shared Merge', { spec: 1, mechanic: { key: 'drop-merge', version: '1.0.0' }, params: {}, theme: { pack: 'farm' } });
    const page = await ctx.newPage();
    const popups = [];
    ctx.on('page', p => popups.push(p.url()));
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await wait(1200);
    await page.click('#btn-add');
    await page.fill('#drop', GEMINI);
    check((await page.textContent('#detect')).includes('plays full screen in Pukytoon'), 'App: sheet says a Gemini link plays full screen in Pukytoon');
    await page.click('#btn-save'); await wait(900);
    check((await page.textContent('.slide.active .play-note')) === 'Plays full screen', 'App: its card says it plays full screen');
    await page.click('.slide.active .cover'); await wait(500);
    let calls = await page.evaluate(() => window.__calls);
    const [name, arg] = calls[0] || [];
    check(name === 'openInWebView' && arg.url === GEMINI && arg.options.showURL === false && arg.options.closeButtonText === 'Back to feed' &&
          arg.options.clearCache === false && arg.options.iOS.viewStyle === 2, 'App: Play opens it in the in-app web view, no address bar, saves kept');
    check(popups.length === 0, 'App: no new window or tab');
    await page.click('.slide.active .rail button[aria-label="Open in the browser"]'); await wait(300);
    calls = await page.evaluate(() => window.__calls);
    check(calls[1] && calls[1][0] === 'openInExternalBrowser' && calls[1][1].url === GEMINI, 'App: the arrow button still offers the phone browser');
    await page.evaluate(() => [...document.querySelectorAll('.slide')].find(s => s.querySelector('h2')?.textContent === 'Shared Merge').scrollIntoView());
    await wait(900);
    await page.click('.slide.active .rail button[aria-label="Share"]'); await wait(300);
    calls = await page.evaluate(() => window.__calls);
    check(calls[2] && calls[2][0] === 'share' && calls[2][1].url === `https://sinadehesh.github.io/pukytoon/?g=${shared.slug}`,
          'App: Share opens the phone’s share sheet, with the website’s link to the game');
    await ctx.close();
}
