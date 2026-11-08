// Turns what people drop into Pukytoon (a share link, or a game's code) into something the feed can play.
//
// Links: Claude, Gemini and Kimi refuse to be shown inside another app's frame, so their games open full
// screen in the in-app browser. Any other link is tried inside the feed.
// Code: HTML pages run as they are; React components (what Claude and Gemini artifacts usually are) get
// React, Tailwind and their imports from a CDN; plain JavaScript gets an empty page to draw on.
// Every code game runs in a sandboxed frame with its own storage, so it can't reach the app or other games.

export const SOURCES = {
    pukytoon: { name: 'Pukytoon', colors: ['#ff5fa2', '#7b5cff'] },
    claude: { name: 'Claude', colors: ['#d97757', '#f0b38a'] },
    gemini: { name: 'Gemini', colors: ['#4f7cff', '#a66bff'] },
    kimi: { name: 'Kimi', colors: ['#1f2937', '#3b82f6'] },
    web: { name: 'Web', colors: ['#0ea5a4', '#22d3ee'] },
    studio: { name: 'the Studio', colors: ['#7b5cff', '#ff5fa2'] },
    other: { name: 'Other', colors: ['#475569', '#94a3b8'] }
};

const REACT_VERSION = '18.3.1';
const BABEL = 'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js';
const TAILWIND = 'https://cdn.tailwindcss.com/3.4.16';

// --- What was dropped ---

const URL_RE = /https?:\/\/[^\s"'<>`]+/i;

// Returns { kind: 'link', url, source, embeddable } or { kind: 'code', code, format }, or null for nothing.
export function detectInput(text) {
    const raw = (text || '').trim();
    if (!raw) return null;

    // Claude's "embed code" is an <iframe> pointing at the artifact: treat it as its link
    const frame = raw.match(/^<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*(<\/iframe>)?$/i);
    if (frame) return linkInfo(frame[1]);

    const url = raw.match(URL_RE);
    if (url && !raw.includes('```')) {
        // A link with at most a few words around it ("check out my game https://…") is a link;
        // a URL inside a page of code is just part of the code.
        const rest = raw.replace(url[0], '');
        if (rest.length < 200 && !/[<>{};]|=>/.test(rest)) return linkInfo(url[0].replace(/[).,!?]+$/, ''));
    }

    const code = stripFences(raw);
    return { kind: 'code', code, format: detectFormat(code) };
}

function linkInfo(url) {
    const source = sourceOfUrl(url);
    return { kind: 'link', url, source, embeddable: source === 'web' };
}

export function sourceOfUrl(url) {
    let u;
    try { u = new URL(url); } catch (e) { return 'web'; }
    const host = u.hostname.toLowerCase();
    const is = domain => host === domain || host.endsWith('.' + domain);
    if (is('claude.ai') || is('claude.site') || is('claude.com') || is('claudeusercontent.com')) return 'claude';
    if (is('gemini.google.com') || is('gemini.google') || is('aistudio.google.com') ||
        (host === 'g.co' && u.pathname.startsWith('/gemini'))) return 'gemini';
    if (is('kimi.com') || is('kimi.ai') || is('moonshot.cn')) return 'kimi';
    return 'web';
}

// Chat apps wrap code in ``` fences, often with a sentence before and after: keep the biggest block.
function stripFences(text) {
    if (!text.includes('```')) return text;
    const blocks = [...text.matchAll(/```[\w+-]*[^\n]*\n([\s\S]*?)```/g)].map(m => m[1]);
    if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0].trim();
    // An opening fence with no closing one (copied halfway)
    return text.replace(/^[\s\S]*?```[\w+-]*[^\n]*\n/, '').replace(/```\s*$/, '').trim();
}

export function detectFormat(code) {
    const c = code.trim();
    if (/^<!doctype html|^<html[\s>]/i.test(c) || /<\/(html|body|head)>/i.test(c)) return 'html';
    const react = /\bfrom\s+['"]react['"]|\bimport\s+React\b|\bexport\s+default\b|\buse(State|Effect|Ref|Reducer|Callback|Memo)\s*\(/;
    if (!c.startsWith('<') && react.test(c)) return 'react';
    if (c.startsWith('<')) return 'html';
    if (/return\s*\(?\s*<[A-Za-z]/.test(c)) return 'react'; // JSX with no imports
    return 'js';
}

export const FORMAT_NAMES = { html: 'HTML game', react: 'React game', js: 'JavaScript game' };

// A name for the feed: the page's <title>, the React component's name, or the source.
export function guessTitle(info) {
    if (!info) return '';
    if (info.kind === 'link') return `${SOURCES[info.source].name} game`;
    const c = info.code;
    const title = c.match(/<title[^>]*>([^<]{1,80})<\/title>/i) || c.match(/<h1[^>]*>([^<]{1,80})<\/h1>/i);
    if (title && title[1].trim()) return title[1].trim();
    const comp = c.match(/export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/) ||
                 c.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m);
    if (comp && !/^(App|Main|Game|Component|Index)$/.test(comp[1])) {
        return comp[1].replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
    }
    return 'My game';
}

// --- Building the page a code game runs in ---

// Inside the sandbox there is no real localStorage (the frame has no origin of its own), so games get a
// stand-in that starts with what they saved last time and sends every change to the app through the
// bridge SDK (sdk/pukytoon-sdk.js, loaded from the app). Errors show in a banner, so a broken game says why
// instead of staying blank.
function preamble(saved) {
    return `<script>window.__PUKYTOON_SAVE=${json(saved || {})};<\/script>
<script src="sdk/pukytoon-sdk.js"><\/script>
<script>(function(){
var P=window.Pukytoon,data=P?P.save.all():{};
function send(){if(P)P.save.flush()}
function store(keep){var d=keep?data:{};return{
getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},
setItem:function(k,v){d[String(k)]=String(v);if(keep)send()},
removeItem:function(k){delete d[String(k)];if(keep)send()},
clear:function(){for(var k in d)delete d[k];if(keep)send()},
key:function(i){var ks=Object.keys(d);return i<ks.length?ks[i]:null},
get length(){return Object.keys(d).length}}}
var ok=false;try{ok=!!window.localStorage}catch(e){}
if(!ok){try{Object.defineProperty(window,'localStorage',{value:store(true),configurable:true})}catch(e){}
try{Object.defineProperty(window,'sessionStorage',{value:store(false),configurable:true})}catch(e){}}
var shown=false;
function showError(msg){if(shown)return;shown=true;
function add(){var b=document.createElement('div');
b.setAttribute('style','position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;background:#b91c1c;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 36px 10px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);user-select:text;-webkit-user-select:text;white-space:pre-wrap;word-break:break-word');
b.textContent='This game hit an error:\\n'+msg+'\\n\\nPaste this message into the AI that made the game to fix it.';
var x=document.createElement('button');x.textContent='\\u2715';
x.setAttribute('style','position:absolute;top:6px;right:8px;background:none;border:0;color:#fff;font-size:16px');
x.onclick=function(){b.remove()};b.appendChild(x);document.documentElement.appendChild(b)}
if(document.body)add();else document.addEventListener('DOMContentLoaded',add)}
window.__pukytoonError=showError;
window.addEventListener('error',function(e){var t=e.target;
if(t&&t!==window&&t.tagName){if(t.tagName==='SCRIPT')showError(t.src?'Could not load '+t.src:'Could not load a library this game uses (are you online?)');return}
showError(e.message||'Unknown error')},true);
window.addEventListener('unhandledrejection',function(e){var r=e.reason;showError(String(r&&r.message||r))});
})();<\/script>`;
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">';

export function buildDocument(game, saved) {
    const head = preamble(saved);
    if (game.format === 'react') return reactPage(game.code, head);
    if (game.format === 'js') return jsPage(game.code, head);
    return htmlPage(game.code, head);
}

function htmlPage(code, head) {
    let html = code;
    if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) {
        html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    }
    if (!/<meta[^>]+name=["']?viewport/i.test(html)) head = VIEWPORT + head;
    // Functions as replacements, so a "$" in the game's code is left alone
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + head);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + '<head>' + head + '</head>');
    return head + html;
}

function jsPage(code, head) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${VIEWPORT}${head}
<style>html,body{margin:0;height:100%;background:#111;color:#eee;font-family:system-ui,sans-serif}</style>
</head><body><script>${code.replace(/<\/script/gi, '<\\/script')}<\/script></body></html>`;
}

function reactPage(code, head) {
    const source = prepareReact(code);
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${VIEWPORT}${head}
<script src="${TAILWIND}"><\/script>
<script type="importmap">${json({ imports: importMap(source) })}<\/script>
<style>html,body{margin:0;min-height:100%}#root{min-height:100vh}</style>
</head><body><div id="root"></div>
<script src="${BABEL}"><\/script>
<script>(function(){
if(typeof Babel==='undefined'){window.__pukytoonError('Could not load the React runtime (are you online?)');return}
var out;try{out=Babel.transform(${json(source)},{filename:'game.tsx',presets:[['react',{runtime:'automatic'}],['typescript',{isTSX:true,allExtensions:true}]]}).code}
catch(e){window.__pukytoonError(e.message);return}
var s=document.createElement('script');s.type='module';s.textContent=out;document.body.appendChild(s)})();<\/script>
</body></html>`;
}

// Find the game's component and mount it. Artifacts export it as default; some paste only the component.
function prepareReact(code) {
    let src = code;
    let app = null;
    let m;
    if ((m = src.match(/export\s+default\s+(?:async\s+)?(?:function\s*\*?|class)\s*([A-Za-z_$][\w$]*)?/))) {
        if (m[1] && m[1] !== 'extends') { src = src.replace(m[0], m[0].replace(/export\s+default\s+/, '')); app = m[1]; }
        else src = src.replace(/export\s+default\s+/, 'const __PukyApp = ');
    } else if ((m = src.match(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\}\s*;?/))) {
        src = src.replace(m[0], ''); app = m[1];
    } else if (/export\s+default\s+/.test(src)) {
        src = src.replace(/export\s+default\s+/, 'const __PukyApp = ');
    } else {
        // Components are Capitalized; ALL_CAPS names are constants
        const names = [...src.matchAll(/(?:^|\n)\s*(?:function\s+([A-Z][\w$]*)\s*\(|(?:const|let|var)\s+([A-Z][\w$]*)\s*=)/g)]
            .map(x => x[1] || x[2]).filter(name => /[a-z]/.test(name));
        app = names.includes('App') ? 'App' : names[names.length - 1] || null;
    }

    // Code written for a page that already has React as a global
    if (/\bReact\b/.test(src) && !/import\s+(?:\*\s+as\s+)?React\b/.test(src)) src = `import React from 'react';\n${src}`;
    if (/\bReactDOM\b/.test(src) && !/import\s+(?:\*\s+as\s+)?ReactDOM\b/.test(src)) src = `import ReactDOM from 'react-dom';\n${src}`;

    const mountsItself = /\bcreateRoot\s*\(|\bReactDOM\.render\s*\(/.test(code);
    if (app) src += `\nconst __PukyApp = ${app};`;
    if (!mountsItself) {
        src += `
import { createRoot as __pukyCreateRoot } from 'react-dom/client';
import { createElement as __pukyH } from 'react';
if (typeof __PukyApp === 'undefined' || !__PukyApp) window.__pukytoonError("Couldn't find the game's main component (export default function ...).");
else __pukyCreateRoot(document.getElementById('root')).render(__pukyH(__PukyApp));`;
    }
    return src;
}

// Versions for packages whose newest release dropped things AI-written games use
// (lucide-react 1.x removed the brand icons and some old names).
const PINNED = { 'lucide-react': '0.577.0' };

// Every package the game imports comes from esm.sh, with React left as a bare import that the import map
// points at one copy of React for the whole page.
function importMap(src) {
    const react = `https://esm.sh/react@${REACT_VERSION}`;
    const reactDom = `https://esm.sh/react-dom@${REACT_VERSION}`;
    const imports = {
        'react': react, 'react/': react + '/',
        'react-dom': reactDom, 'react-dom/': reactDom + '/'
    };
    const specs = new Set();
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g)) {
        specs.add(m[1] || m[2]);
    }
    for (const spec of specs) {
        if (/^(\.|\/|https?:|data:)/.test(spec) || imports[spec]) continue;
        if (/^react(-dom)?(\/|$)/.test(spec)) continue;
        if (spec.startsWith('@/components/ui')) imports[spec] = moduleUrl(UI_SHIM);
        else if (spec.startsWith('@/lib/utils')) imports[spec] = moduleUrl(UTILS_SHIM);
        else imports[spec] = `https://esm.sh/${withVersion(spec)}?external=react,react-dom`;
    }
    return imports;
}

// "lucide-react" -> "lucide-react@0.577.0"; a spec that names its own version keeps it
function withVersion(spec) {
    const m = spec.match(/^(@[^/]+\/[^/@]+|[^/@]+)(@[^/]+)?(\/.*)?$/);
    if (!m || m[2] || !PINNED[m[1]]) return spec;
    return `${m[1]}@${PINNED[m[1]]}${m[3] || ''}`;
}

function moduleUrl(source) {
    return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source);
}

// JSON that is safe inside a <script> tag
function json(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));
}

// Claude artifacts often use shadcn/ui ("@/components/ui/card", …). These are small look-alikes of the
// common ones, so those games run; anything missing shows up in the error banner.
const UTILS_SHIM = `export const cn = (...a) => a.flat().filter(Boolean).join(' ');`;
const UI_SHIM = String.raw`
import { createElement as h, forwardRef, createContext, useContext, useState } from 'react';
const cx = (...a) => a.flat().filter(Boolean).join(' ');
const make = (tag, base) => forwardRef(({ className, ...p }, ref) => h(tag, { ref, className: cx(base, className), ...p }));
export const cn = cx;
export const Card = make('div', 'rounded-xl border border-slate-200 bg-white text-slate-900 shadow');
export const CardHeader = make('div', 'flex flex-col space-y-1.5 p-6');
export const CardTitle = make('h3', 'text-xl font-semibold leading-none tracking-tight');
export const CardDescription = make('p', 'text-sm text-slate-500');
export const CardContent = make('div', 'p-6 pt-0');
export const CardFooter = make('div', 'flex items-center p-6 pt-0');
const VARIANTS = { default: 'bg-slate-900 text-white hover:bg-slate-800', destructive: 'bg-red-600 text-white hover:bg-red-500',
  outline: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100', secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  ghost: 'hover:bg-slate-100', link: 'text-slate-900 underline-offset-4 hover:underline' };
const SIZES = { default: 'h-9 px-4 py-2', sm: 'h-8 rounded-md px-3 text-xs', lg: 'h-10 rounded-md px-8', icon: 'h-9 w-9' };
export const Button = forwardRef(({ className, variant = 'default', size = 'default', asChild, ...p }, ref) => h('button', { ref,
  className: cx('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant] || VARIANTS.default, SIZES[size] || SIZES.default, className), ...p }));
const BADGES = { default: 'border-transparent bg-slate-900 text-white', secondary: 'border-transparent bg-slate-100 text-slate-900',
  destructive: 'border-transparent bg-red-600 text-white', outline: 'text-slate-900' };
export const Badge = ({ className, variant = 'default', ...p }) => h('span', {
  className: cx('inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold', BADGES[variant] || BADGES.default, className), ...p });
export const Input = make('input', 'flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm');
export const Textarea = make('textarea', 'flex min-h-[60px] w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm shadow-sm');
export const Label = make('label', 'text-sm font-medium leading-none');
export const Alert = make('div', 'relative w-full rounded-lg border border-slate-200 px-4 py-3 text-sm');
export const AlertTitle = make('h5', 'mb-1 font-medium leading-none tracking-tight');
export const AlertDescription = make('div', 'text-sm');
export const Separator = ({ className, orientation = 'horizontal', ...p }) => h('div', {
  className: cx('shrink-0 bg-slate-200', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className), ...p });
export const Progress = ({ className, value = 0, ...p }) => h('div', { className: cx('relative h-2 w-full overflow-hidden rounded-full bg-slate-200', className), ...p },
  h('div', { className: 'h-full bg-slate-900 transition-all', style: { width: Math.max(0, Math.min(100, value)) + '%' } }));
export const Switch = ({ className, checked, defaultChecked, onCheckedChange, ...p }) => h('input', { type: 'checkbox', role: 'switch',
  checked, defaultChecked, onChange: e => onCheckedChange && onCheckedChange(e.target.checked), className: cx('h-5 w-9 accent-slate-900', className), ...p });
export const Slider = ({ className, value, defaultValue, min = 0, max = 100, step = 1, onValueChange, ...p }) => h('input', { type: 'range',
  min, max, step, value: value ? value[0] : undefined, defaultValue: defaultValue ? defaultValue[0] : undefined,
  onChange: e => onValueChange && onValueChange([Number(e.target.value)]), className: cx('w-full accent-slate-900', className), ...p });
const TabsCtx = createContext(null);
export const Tabs = ({ value, defaultValue, onValueChange, className, children, ...p }) => {
  const [own, setOwn] = useState(defaultValue);
  const current = value !== undefined ? value : own;
  const set = v => { setOwn(v); onValueChange && onValueChange(v); };
  return h(TabsCtx.Provider, { value: { current, set } }, h('div', { className, ...p }, children));
};
export const TabsList = make('div', 'inline-flex h-9 items-center justify-center rounded-lg bg-slate-100 p-1 text-slate-500');
export const TabsTrigger = ({ value, className, ...p }) => { const t = useContext(TabsCtx);
  return h('button', { type: 'button', onClick: () => t.set(value), className: cx('inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium',
    t.current === value && 'bg-white text-slate-900 shadow', className), ...p }); };
export const TabsContent = ({ value, className, ...p }) => { const t = useContext(TabsCtx);
  return t.current === value ? h('div', { className: cx('mt-2', className), ...p }) : null; };
`;
