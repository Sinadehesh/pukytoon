// The Pukytoon runtime: what every Creator Studio game runs on. It owns the fixed-step game loop, input
// turned into named actions, drawing, sound, the win/lose rules and the title and end screens. A mechanic
// (runtime/mechanics/) only holds its game's state and logic, and asks for its pictures and sounds by slot,
// so a theme can change every one of them without touching the mechanic's code.
import { SPRITES } from '../assets/library/sprites.js';
import { PACKS, SFX, MUSIC } from '../assets/library/packs.js';
import { compileRule, describeRule } from './rules.js';

export const RUNTIME_VERSION = 1;
const STEP = 1 / 60;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const sdk = () => window.Pukytoon || null;

// --- The spec, checked against the mechanic's manifest ---

export function clampParam(p, value) {
    if (p.type === 'boolean') return typeof value === 'boolean' ? value : !!p.default;
    if (p.enum) return p.enum.includes(value) ? value : p.default;
    let n = Number(value);
    if (value === undefined || value === null || value === '' || !Number.isFinite(n)) n = p.default;
    n = Math.min(p.maximum, Math.max(p.minimum, n));
    return p.type === 'integer' ? Math.round(n) : n;
}

export function ruleNames(manifest) {
    return [...new Set([...(manifest.vars || []), 'score', 'time'])];
}

export function resolveSpec(manifest, spec = {}) {
    const params = {};
    for (const [key, p] of Object.entries(manifest.params.properties)) {
        params[key] = clampParam(p, spec.params ? spec.params[key] : undefined);
    }
    const pack = PACKS.find(p => p.key === (spec.theme && spec.theme.pack)) || PACKS[0];
    const overrides = (spec.theme && spec.theme.overrides) || {};
    const slots = {};
    for (const [name, slot] of Object.entries(manifest.slots)) {
        slots[name] = resolveSlot(slot, pack, overrides[name], Object.prototype.hasOwnProperty.call(overrides, name));
    }
    const rules = {
        win: spec.rules && 'win' in spec.rules ? spec.rules.win : manifest.rules.win,
        lose: spec.rules && 'lose' in spec.rules ? spec.rules.lose : manifest.rules.lose
    };
    const title = String((spec.meta && spec.meta.title) || manifest.name).slice(0, 60);
    return { params, pack, slots, rules, title };
}

// Only library ids are accepted, so a spec can never point a game at an outside file
function resolveSlot(slot, pack, override, overridden) {
    if (slot.kind === 'music') {
        if (overridden) return override && MUSIC[override] ? override : null;
        return pack.music && MUSIC[pack.music] ? pack.music : null;
    }
    if (slot.many) {
        const own = Array.isArray(override) ? override.filter(id => SPRITES[id]) : [];
        if (own.length >= (slot.min || 1)) return own;
        return (pack.roles[slot.role] || pack.roles.chain || []).filter(id => SPRITES[id]);
    }
    if (typeof override === 'string' && SPRITES[override]) return override;
    return SPRITES[pack.roles[slot.role]] ? pack.roles[slot.role] : null;
}

// --- Pictures and sounds ---

const pictures = new Map();

function loadPicture(id, base) {
    if (pictures.has(id)) return pictures.get(id);
    const meta = SPRITES[id];
    const loading = new Promise(resolve => {
        if (!meta) return resolve(placeholder(id));
        const img = new Image();
        img.onload = () => resolve({ id, img, w: img.naturalWidth, h: img.naturalHeight, name: meta.name, hitbox: meta.hitbox || null, ok: true });
        img.onerror = () => resolve(placeholder(id, meta));
        img.src = new URL(base + meta.url, location.href).href;
    });
    pictures.set(id, loading);
    return loading;
}

// A picture that couldn't load still draws, as a grey "?" disc of the same size
function placeholder(id, meta) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#c9c4d6';
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5b5670';
    g.font = `700 64px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', 64, 68);
    return { id, img: c, w: 128, h: 128, name: (meta && meta.name) || '?', hitbox: null, ok: false };
}

async function loadSlots(manifestSlots, ids, base) {
    const out = {};
    await Promise.all(Object.entries(manifestSlots).map(async ([name, slot]) => {
        if (slot.kind === 'music') { out[name] = ids[name]; return; }
        if (slot.many) out[name] = await Promise.all((ids[name].length ? ids[name] : [null]).map(id => id ? loadPicture(id, base) : placeholder('none')));
        else out[name] = ids[name] ? await loadPicture(ids[name], base) : placeholder('none');
    }));
    return out;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load ' + src));
        document.head.appendChild(s);
    });
}

// Sound starts at the player's first touch inside the game (browsers allow no sound before one)
class Sound {
    constructor(base, enabled) {
        this.base = base;
        this.enabled = enabled;
        this.muted = false;
        this.ctx = null;
        this.raw = {};
        this.buffers = {};
        this.music = null;
        this.musicKey = null;
        this.musicWanted = false;
    }
    fetchAll() {
        if (!this.enabled) return;
        for (const name of new Set(Object.values(SFX))) {
            fetch(new URL(`${this.base}assets/library/sfx/${name}.wav`, location.href))
                .then(r => (r.ok ? r.arrayBuffer() : null))
                .then(buf => { if (buf) { this.raw[name] = buf; this.decode(name); } })
                .catch(() => {});
        }
    }
    decode(name) {
        if (!this.ctx || !this.raw[name]) return;
        const buf = this.raw[name];
        delete this.raw[name];
        this.ctx.decodeAudioData(buf, decoded => { this.buffers[name] = decoded; }, () => {});
    }
    unlock() {
        if (!this.enabled) return;
        if (!this.ctx) {
            try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.enabled = false; return; }
            Object.keys(this.raw).forEach(name => this.decode(name));
        }
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        if (this.musicWanted) this.playMusic();
    }
    play(role, volume = 1, rate = 1) {
        if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
        const buf = this.buffers[SFX[role] || role];
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.7 * volume;
        src.connect(gain).connect(this.ctx.destination);
        src.start();
    }
    startMusic(key) {
        if (!this.enabled || !key || !MUSIC[key]) return;
        this.musicKey = key;
        this.musicWanted = true;
        this.playMusic();
    }
    playMusic() {
        if (this.muted || !this.musicKey) return;
        if (!this.music) {
            this.music = new Audio(new URL(this.base + MUSIC[this.musicKey].url, location.href).href);
            this.music.loop = true;
            this.music.volume = 0.35;
        }
        this.music.play().catch(() => {});
    }
    pauseMusic() {
        if (this.music) this.music.pause();
    }
    setMuted(muted) {
        this.muted = muted;
        if (muted) this.pauseMusic();
        else if (this.musicWanted) this.playMusic();
    }
}

// --- Drawing ---

export function shade(hex, amount) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const mix = c => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `rgb(${r},${g},${b})`;
}

function makeGfx(g) {
    const path = (x, y, w, h, r) => {
        g.beginPath();
        if (r > 0 && g.roundRect) g.roundRect(x, y, w, h, r);
        else g.rect(x, y, w, h);
    };
    return {
        ctx: g,
        rect(x, y, w, h, color, r = 0) { g.fillStyle = color; path(x, y, w, h, r); g.fill(); },
        frame(x, y, w, h, color, width = 2, r = 0) { g.strokeStyle = color; g.lineWidth = width; path(x, y, w, h, r); g.stroke(); },
        circle(x, y, r, color) { g.fillStyle = color; g.beginPath(); g.arc(x, y, Math.max(0, r), 0, Math.PI * 2); g.fill(); },
        ellipse(x, y, rx, ry, color) { g.fillStyle = color; g.beginPath(); g.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); g.fill(); },
        line(x1, y1, x2, y2, color, width = 2, dash = null) {
            g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
            g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
        },
        // A picture centred on (x, y) at w x h; anchorX/anchorY (0-1) move the centre, as for a physics body's centroid
        sprite(s, x, y, w, h, o = {}) {
            if (!s) return;
            g.save();
            g.translate(x, y);
            if (o.rotation) g.rotate(o.rotation);
            if (o.alpha != null) g.globalAlpha *= o.alpha;
            g.scale((o.flipX ? -1 : 1) * (o.scaleX || 1), o.scaleY || 1);
            g.drawImage(s.img, -w * (o.anchorX ?? 0.5), -h * (o.anchorY ?? 0.5), w, h);
            g.restore();
        },
        text(str, x, y, o = {}) {
            const size = o.size || 24;
            g.font = `${o.weight || 700} ${size}px ${FONT}`;
            g.textAlign = o.align || 'center';
            g.textBaseline = o.baseline || 'middle';
            if (o.maxWidth) {
                const w = g.measureText(str).width;
                if (w > o.maxWidth) g.font = `${o.weight || 700} ${Math.floor(size * o.maxWidth / w)}px ${FONT}`;
            }
            if (o.outline) { g.lineWidth = o.outlineWidth || 4; g.strokeStyle = o.outline; g.lineJoin = 'round'; g.strokeText(str, x, y); }
            g.fillStyle = o.color || '#fff';
            g.fillText(str, x, y);
        },
        gradient(x0, y0, x1, y1, stops) {
            const gr = g.createLinearGradient(x0, y0, x1, y1);
            stops.forEach(([at, color]) => gr.addColorStop(at, color));
            return gr;
        },
        alpha(a, fn) { g.save(); g.globalAlpha *= a; fn(); g.restore(); }
    };
}

// --- Input: touches and keys, turned into the actions a manifest names ---
// Bindings: 'tap' (finger down), 'release' (finger up), 'swipe-up' / -down / -left / -right, or a key code.

class Input {
    constructor(canvas, view, actions, layout) {
        this.view = view;
        this.actions = actions;
        this.layout = layout;
        this.queue = [];
        this.pointer = { x: view.width / 2, y: view.height / 2, down: false, startX: 0, startY: 0 };
        this.keys = new Set();
        const toView = e => {
            const L = layout();
            return { x: (e.clientX - L.offX) / L.scale, y: (e.clientY - L.offY) / L.scale };
        };
        canvas.addEventListener('pointerdown', e => {
            try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
            this.queue.push({ type: 'down', ...toView(e) });
        });
        canvas.addEventListener('pointermove', e => {
            const last = this.queue[this.queue.length - 1];
            const ev = { type: 'move', ...toView(e) };
            if (last && last.type === 'move') this.queue[this.queue.length - 1] = ev; else this.queue.push(ev);
        });
        const up = e => this.queue.push({ type: 'up', ...toView(e) });
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        window.addEventListener('keydown', e => {
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
            if (!e.repeat) this.queue.push({ type: 'key', key: e.code, down: true });
        });
        window.addEventListener('keyup', e => this.queue.push({ type: 'key', key: e.code, down: false }));
    }
    inject(ev) { this.queue.push(ev); }
    step() {
        const p = this.pointer;
        const state = {
            pointer: { x: p.x, y: p.y, down: p.down, pressed: false, released: false, startX: p.startX, startY: p.startY },
            pressed: new Set(), held: new Set(), swipe: null, anyKey: false
        };
        const keysPressed = new Set();
        for (const ev of this.queue.splice(0)) {
            if (ev.type === 'key') {
                if (ev.down) { this.keys.add(ev.key); keysPressed.add(ev.key); state.anyKey = true; } else this.keys.delete(ev.key);
                continue;
            }
            p.x = ev.x; p.y = ev.y;
            if (ev.type === 'down') { p.down = true; p.startX = ev.x; p.startY = ev.y; state.pointer.pressed = true; }
            if (ev.type === 'up' && p.down) {
                p.down = false;
                state.pointer.released = true;
                const dx = ev.x - p.startX, dy = ev.y - p.startY;
                if (Math.hypot(dx, dy) > 40) {
                    state.swipe = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
                }
            }
        }
        Object.assign(state.pointer, { x: p.x, y: p.y, down: p.down, startX: p.startX, startY: p.startY });
        for (const [name, bindings] of Object.entries(this.actions)) {
            const now = bindings.some(b =>
                (b === 'tap' && state.pointer.pressed) || (b === 'release' && state.pointer.released) ||
                (b.startsWith('swipe-') && state.swipe === b.slice(6)) || keysPressed.has(b));
            const hold = bindings.some(b => ((b === 'tap' || b === 'release') && p.down) || this.keys.has(b));
            if (now) state.pressed.add(name);
            if (hold) state.held.add(name);
        }
        return state;
    }
}

// --- Seeded randomness, so a game (and its tests) can be replayed exactly ---

function makeRng(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        range: (a, b) => a + (b - a) * next(),
        int: (a, b) => a + Math.floor(next() * (b - a + 1)),
        pick: list => list[Math.floor(next() * list.length)],
        chance: p => next() < p
    };
}

// --- The game: scenes, loop, rules ---

class Game {
    constructor(o) {
        Object.assign(this, o);
        this.errors = [];
        this.scene = 'title';
        this.sceneTime = 0;
        this.round = 0;
        this.best = o.best || 0;
        this.newBest = false;
        this.paused = false;
        this.layout = { k: 1, ox: 0, oy: 0, scale: 1, offX: 0, offY: 0 };
        this.gfx = makeGfx(this.canvas.getContext('2d'));
        this.input = new Input(this.canvas, this.view, this.manifest.actions || {}, () => this.layout);
        this.compileRules();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.guard(() => this.newRound());
    }

    compileRules() {
        const names = ruleNames(this.manifest);
        this.names = names;
        this.ruleError = null;
        const safe = text => {
            try { return compileRule(text, names); } catch (e) { this.ruleError = e.message; return null; }
        };
        this.win = safe(this.resolved.rules.win);
        this.lose = safe(this.resolved.rules.lose);
    }

    newRound() {
        if (this.instance && this.instance.destroy) this.instance.destroy();
        this.vars = Object.fromEntries(this.names.map(n => [n, 0]));
        const ctx = {
            view: this.view,
            params: this.resolved.params,
            vars: this.vars,
            palette: this.resolved.pack.palette,
            rng: makeRng((this.seed >>> 0) + this.round * 7919),
            slot: name => this.sprites[name],
            best: () => this.best,
            sfx: (role, volume, rate) => this.sound.play(role, volume, rate),
            haptic: ms => { const s = sdk(); if (s) s.haptic(ms); },
            emit: (type, data) => {
                if (type === 'win' || type === 'lose') this.end(type);
                else { const s = sdk(); if (s) s.event(type, data); }
            },
            physics: window.Matter || null,
            shade
        };
        this.instance = this.mechanic.create(ctx, { ...this.resolved.params });
        this.instance.start();
    }

    // A crash inside a mechanic stops the game with a message instead of leaving a frozen canvas
    guard(fn) {
        try { fn(); return true; } catch (e) {
            const message = e && e.message ? e.message : String(e);
            this.errors.push(message);
            this.crashed = message;
            const s = sdk();
            if (s) s.error(message);
            this.stop();
            return false;
        }
    }

    startPlay() {
        if (this.scene !== 'title') return;
        this.scene = 'play';
        this.sceneTime = 0;
        this.sound.unlock();
        if (this.resolved.slots.music) this.sound.startMusic(this.resolved.slots.music);
        const s = sdk();
        if (s) s.event('level_start');
    }

    end(result) {
        if (this.scene !== 'play') return;
        this.scene = 'end';
        this.result = result;
        this.sceneTime = 0;
        const score = Math.floor(this.vars.score || 0);
        this.newBest = score > this.best;
        const s = sdk();
        if (this.newBest) {
            this.best = score;
            if (s) s.save.set('best', score);
        }
        this.sound.play(result === 'win' ? 'win' : 'lose');
        if (s) { s.score(score, true); s.event(result === 'win' ? 'level_complete' : 'game_over', { score }); }
    }

    restart() {
        this.round++;
        this.newRound();
        this.scene = 'play';
        this.sceneTime = 0;
    }

    step() {
        const input = this.input.step();
        if (input.pointer.pressed) this.sound.unlock();
        if (this.scene === 'play') {
            this.instance.update(STEP, input);
            this.vars.time += STEP;
            for (const name of this.names) {
                if (!Number.isFinite(this.vars[name])) throw new Error(`The game's "${name}" stopped being a number`);
            }
            if (this.win && this.win(this.vars)) this.end('win');
            else if (this.lose && this.lose(this.vars)) this.end('lose');
        } else if (this.scene === 'title') {
            if (input.pointer.released || input.anyKey) this.startPlay();
        } else if (this.scene === 'end') {
            if (this.sceneTime > 0.7 && (input.pointer.released || input.anyKey)) this.restart();
        }
        this.sceneTime += STEP;
    }

    resize() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
        this.canvas.width = Math.round(cw * dpr);
        this.canvas.height = Math.round(ch * dpr);
        const scale = Math.min(cw / this.view.width, ch / this.view.height);
        const offX = (cw - this.view.width * scale) / 2, offY = (ch - this.view.height * scale) / 2;
        this.layout = { k: dpr * scale, ox: dpr * offX, oy: dpr * offY, scale, offX, offY };
        if (!this.running && this.instance && !this.crashed) this.guard(() => this.render(0));
    }

    render(alpha) {
        const g = this.gfx.ctx, L = this.layout, W = this.view.width, H = this.view.height;
        const pal = this.resolved.pack.palette;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = pal.bg;
        g.fillRect(0, 0, this.canvas.width, this.canvas.height);
        g.setTransform(L.k, 0, 0, L.k, L.ox, L.oy);
        g.save();
        g.beginPath(); g.rect(0, 0, W, H); g.clip();
        this.instance.render(this.gfx, alpha, this.scene);
        if (this.scene === 'title') this.drawTitle();
        else if (this.scene === 'play' && this.sceneTime < 3) this.drawGoal();
        else if (this.scene === 'end') this.drawEnd();
        g.restore();
    }

    // A preset rule is shown by its label ("The box overflows"); a custom one in readable symbols
    goalLines() {
        const presets = this.manifest.rulePresets || {};
        const say = (kind, rule) => {
            const preset = (presets[kind] || []).find(p => p.value === rule);
            return preset ? preset.label : describeRule(rule);
        };
        const lines = [];
        if (this.resolved.rules.win) lines.push(`Win: ${say('win', this.resolved.rules.win)}`);
        if (this.resolved.rules.lose) lines.push(`Lose: ${say('lose', this.resolved.rules.lose)}`);
        if (!lines.length) lines.push('Play as long as you like');
        return lines;
    }

    // In the feed the game sits under the app's Play cover, which shows the title: draw nothing over it
    drawTitle() {
        if (this.embedded) return;
        const x = this.gfx, W = this.view.width, H = this.view.height, pal = this.resolved.pack.palette;
        x.rect(0, 0, W, H, 'rgba(10, 8, 20, 0.5)');
        x.text(this.resolved.title, W / 2, H * 0.36, { size: 42, weight: 800, color: '#fff', maxWidth: W - 48, outline: 'rgba(0,0,0,0.35)', outlineWidth: 6 });
        x.text(this.manifest.name, W / 2, H * 0.36 + 44, { size: 18, weight: 600, color: 'rgba(255,255,255,0.8)' });
        this.goalLines().forEach((line, i) =>
            x.text(line, W / 2, H * 0.36 + 92 + i * 26, { size: 17, weight: 600, color: '#fff', maxWidth: W - 48 }));
        if (this.best > 0) x.text(`Best: ${this.best}`, W / 2, H * 0.36 + 160, { size: 18, color: pal.accent });
        if (!this.embedded) {
            const pulse = 0.75 + 0.25 * Math.sin(this.sceneTime * 4);
            x.alpha(pulse, () => x.text('Tap to play', W / 2, H * 0.72, { size: 26, weight: 800, color: '#fff' }));
        }
        const music = this.resolved.slots.music && MUSIC[this.resolved.slots.music];
        if (music) x.text(music.credit, W / 2, H - 22, { size: 11, weight: 500, color: 'rgba(255,255,255,0.75)', maxWidth: W - 24 });
    }

    // The goal, for the first seconds of play
    drawGoal() {
        const x = this.gfx, W = this.view.width, lines = this.goalLines();
        const fade = Math.min(1, (3 - this.sceneTime) / 0.6);
        x.alpha(fade, () => {
            x.rect(24, 132, W - 48, 22 + lines.length * 26, 'rgba(10, 8, 20, 0.72)', 16);
            lines.forEach((line, i) => x.text(line, W / 2, 156 + i * 26, { size: 17, weight: 700, color: '#fff', maxWidth: W - 72 }));
        });
    }

    drawEnd() {
        const x = this.gfx, W = this.view.width, H = this.view.height, pal = this.resolved.pack.palette;
        const won = this.result === 'win';
        x.rect(0, 0, W, H, 'rgba(10, 8, 20, 0.55)');
        x.rect(40, H * 0.3, W - 80, 260, 'rgba(255,255,255,0.96)', 24);
        x.text(won ? 'You win!' : 'Game over', W / 2, H * 0.3 + 56, { size: 38, weight: 800, color: won ? pal.accent : '#2b2238' });
        x.text(`Score ${Math.floor(this.vars.score || 0)}`, W / 2, H * 0.3 + 116, { size: 28, weight: 700, color: '#2b2238' });
        x.text(this.newBest ? 'New best!' : `Best ${this.best}`, W / 2, H * 0.3 + 156, { size: 20, weight: 700, color: this.newBest ? pal.accent : '#6b6478' });
        if (this.sceneTime > 0.7) x.text('Tap to play again', W / 2, H * 0.3 + 214, { size: 20, weight: 800, color: '#2b2238' });
        const music = this.resolved.slots.music && MUSIC[this.resolved.slots.music];
        if (music) x.text(music.credit, W / 2, H - 22, { size: 11, weight: 500, color: 'rgba(255,255,255,0.8)', maxWidth: W - 24 });
    }

    run() {
        if (this.crashed) return;
        this.running = true;
        let acc = 0, last = performance.now();
        const frame = now => {
            if (!this.running) return;
            acc += Math.min(now - last, 250);
            last = now;
            let ok = true;
            while (ok && acc >= STEP * 1000) {
                ok = this.guard(() => this.step());
                acc -= STEP * 1000;
            }
            if (ok) ok = this.guard(() => this.render(acc / (STEP * 1000)));
            if (ok) this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
    }

    stop() {
        this.running = false;
        cancelAnimationFrame(this.raf);
        this.sound.pauseMusic();
        if (this.crashed) this.drawCrash();
    }

    pause() {
        if (this.paused || this.crashed) return;
        this.paused = true;
        this.stop();
    }

    resume() {
        if (!this.paused || this.crashed || this.harness) return;
        this.paused = false;
        if (this.scene === 'play' && this.sound.musicWanted) this.sound.playMusic();
        this.run();
    }

    drawCrash() {
        const g = this.gfx.ctx, x = this.gfx, W = this.view.width, H = this.view.height;
        g.setTransform(this.layout.k, 0, 0, this.layout.k, this.layout.ox, this.layout.oy);
        x.rect(24, H * 0.35, W - 48, 150, 'rgba(185, 28, 28, 0.95)', 16);
        x.text('This game hit a problem', W / 2, H * 0.35 + 40, { size: 22, color: '#fff' });
        x.text(String(this.crashed).slice(0, 60), W / 2, H * 0.35 + 82, { size: 14, weight: 500, color: '#fff', maxWidth: W - 72 });
        x.text('Reload to try again', W / 2, H * 0.35 + 116, { size: 15, weight: 600, color: '#fff' });
    }

    // From the Studio: new parameter values or rules for the same mechanic and theme
    applySpec(spec) {
        const next = resolveSpec(this.manifest, spec);
        const changed = {};
        for (const [k, v] of Object.entries(next.params)) if (v !== this.resolved.params[k]) changed[k] = v;
        const rulesChanged = next.rules.win !== this.resolved.rules.win || next.rules.lose !== this.resolved.rules.lose;
        this.resolved = { ...next, slots: this.resolved.slots };
        if (rulesChanged) this.compileRules();
        if (!Object.keys(changed).length) return;
        const props = this.manifest.params.properties;
        const live = Object.keys(changed).every(k => props[k]['x-live']);
        const kept = live && this.instance.onParams ? this.instance.onParams(changed) !== false : false;
        if (!kept) this.guard(() => { this.round++; this.newRound(); });
        if (!this.running) this.guard(() => this.render(0));
    }
}

// Boots a mechanic with a spec onto a canvas. base = the path from this page to the site root.
// harness: no clock; tests step the game themselves through window.__puky (see tests/mechanics.test.mjs).
export async function boot({ mechanic, spec, canvas, base = '', harness = false, seed = null }) {
    const manifest = mechanic.manifest;
    const view = manifest.view || { width: 450, height: 800 };
    const resolved = resolveSpec(manifest, spec || {});
    if ((manifest.requires || []).includes('matter') && !window.Matter) await loadScript(base + 'runtime/vendor/matter.min.js');
    const sprites = await loadSlots(manifest.slots, resolved.slots, base);
    const sound = new Sound(base, !harness);
    sound.fetchAll();
    const s = sdk();
    const init = s ? await s.whenInit(harness ? 50 : 800) : {};
    const fixedSeed = spec && spec.meta && Number.isInteger(spec.meta.seed) ? spec.meta.seed : null;
    const game = new Game({
        manifest, mechanic, resolved, sprites, sound, canvas, view, harness,
        embedded: !!init.embedded,
        seed: seed ?? fixedSeed ?? Math.floor(Math.random() * 2 ** 31),
        best: Number(s && s.save.get('best')) || 0
    });
    if (s) {
        s.on('pause', () => game.pause());
        s.on('resume', () => game.resume());
        s.on('mute', m => game.sound.setMuted(!!m));
        s.on('start', () => game.startPlay());
        s.on('spec.update', next => { if (next && next.mechanic && next.mechanic.key === manifest.key) game.applySpec(next); });
    }
    document.addEventListener('visibilitychange', () => (document.hidden ? game.pause() : game.resume()));
    expose(game);
    if (!harness) {
        game.run();
        // What the app asked for while the game was still loading
        if (s && s.state.started) game.startPlay();
        if (s && s.state.muted) game.sound.setMuted(true);
        if (s && s.state.paused) {
            requestAnimationFrame(() => game.pause());   // after one frame, so the title is on screen
        }
    }
    if (s) s.ready();
    return game;
}

// What tests can see, and in harness mode drive (step); in normal play the clock steps the game
function expose(game) {
    if (game.harness) game.guard(() => game.render(0));
    window.__puky = {
        ready: true,
        harness: game.harness,
        errors: game.errors,
        get scene() { return game.scene; },
        get crashed() { return game.crashed || null; },
        vars: () => ({ ...game.vars }),
        params: () => ({ ...game.resolved.params }),
        manifest: game.manifest,
        start: () => game.startPlay(),
        restart: () => game.guard(() => game.restart()),
        // events: [{ at: step, type: 'down' | 'move' | 'up', x, y } or { at, type: 'key', key, down }]
        step(n, events = []) {
            if (!game.harness) throw new Error('step() is for ?harness pages');
            for (let i = 0; i < n && !game.crashed; i++) {
                for (const ev of events) if (ev.at === i) game.input.inject(ev);
                game.guard(() => game.step());
            }
            game.guard(() => game.render(0));
            return game.scene;
        },
        serialize: () => (game.instance.serialize ? game.instance.serialize() : null)
    };
}
