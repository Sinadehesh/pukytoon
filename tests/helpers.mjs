// Shared by the tests: a static server for the site, a browser, and checks that are counted.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

// Loaded through require so a Playwright installed globally (NODE_PATH) works as well as one in node_modules
const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');

export const root = path.resolve(import.meta.dirname, '..');
export const OUT = path.join(root, 'tests/output');   // screenshots, kept by CI when a test fails
fs.mkdirSync(OUT, { recursive: true });

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json'
};

// Serves the repository root on a free local port
export function serve() {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            let p = decodeURIComponent(new URL(req.url, 'http://local').pathname);
            if (p.endsWith('/')) p += 'index.html';
            const file = path.join(root, p);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
    });
}

// Outside requests go through the sandbox's proxy when there is one (not in CI)
export function launch() {
    return chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {});
}

export function counter() {
    let passed = 0, failed = 0;
    return {
        check(ok, message) {
            console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
            if (ok) passed++; else failed++;
            return ok;
        },
        get passed() { return passed; },
        get failed() { return failed; }
    };
}

export const wait = ms => new Promise(r => setTimeout(r, ms));
export const encodeSpec = spec => Buffer.from(JSON.stringify(spec)).toString('base64url');
