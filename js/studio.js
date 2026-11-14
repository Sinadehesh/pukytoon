// The Creator Studio: pick a mechanic and a theme, swap any picture, tune the mechanic's parameters, set how
// to win and lose, and watch it in a live preview. Publish puts the game in the feed as a GameSpec: a few
// hundred bytes of data that studio/play.html turns back into the game.
import { loadAll } from '../runtime/mechanics/index.js';
import { PACKS, MUSIC } from '../assets/library/packs.js';
import { SPRITES } from '../assets/library/sprites.js';
import { encodeSpec } from '../runtime/spec.js';
import { compileRule, RuleError } from '../runtime/rules.js';
import { clampParam, ruleNames } from '../runtime/runtime.js';
import * as bridge from './bridge.js';

const SETS = [...new Set(Object.keys(SPRITES).map(id => id.split('/')[0]))];
const setChain = set => Object.keys(SPRITES).filter(id => id.startsWith(set + '/') && !id.includes('/00_')).sort();

const $ = id => document.getElementById(id);
let mechanics = null;   // every mechanic module, loaded on first open
let state = null;       // what's being made
let callbacks = {};
let reloads = 0;
let liveTimer = 0;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

const thumb = (id, className = 'thumb') => {
    const img = el('img', className);
    img.alt = SPRITES[id] ? SPRITES[id].name : '';
    img.loading = 'lazy';
    if (SPRITES[id]) img.src = SPRITES[id].url;
    return img;
};

export const isOpen = () => !$('studio').hidden;

// game: an existing studio game to edit (or one to start from, without an id), or null for a new one.
// share: who it's for at first, 'everyone' or 'me'.
// onPublish({ id?, title, spec, blurb, share }) when it's published; onClose() whenever the Studio closes.
export async function openStudio(game, { onPublish, onClose, share = 'everyone' } = {}) {
    mechanics = mechanics || await loadAll();
    callbacks = { onPublish, onClose };
    const spec = game ? game.spec : null;
    const m = (spec && mechanics.find(x => x.manifest.key === spec.mechanic.key)) || mechanics[0];
    const pack = (spec && PACKS.find(p => p.key === spec.theme.pack)) || PACKS[0];
    state = {
        id: game ? game.id : null,
        m, pack,
        params: defaults(m, spec && spec.params),
        overrides: { ...((spec && spec.theme.overrides) || {}) },
        win: spec && spec.rules && 'win' in spec.rules ? spec.rules.win : m.manifest.rules.win,
        lose: spec && spec.rules && 'lose' in spec.rules ? spec.rules.lose : m.manifest.rules.lose,
        title: game ? game.title : '',
        titleEdited: !!game,
        share,
        dirty: !!game && !game.id   // a remix is new work
    };
    $('studio-publish').textContent = game && game.id ? 'Save' : 'Publish';
    freshFrame();
    $('studio').hidden = false;
    $('studio-panel').scrollTop = 0;
    renderAll();
    reloadPreview();
}

export function closeStudio(force) {
    if (!isOpen()) return true;
    if (!force && state && state.dirty && !confirm('Leave the Studio? Your changes are not published.')) return false;
    $('studio').hidden = true;
    const frame = $('studio-frame');
    bridge.unregister(frame);
    frame.removeAttribute('src');
    if (callbacks.onClose) callbacks.onClose();
    return true;
}

function defaults(m, given) {
    const out = {};
    for (const [k, p] of Object.entries(m.manifest.params.properties)) out[k] = clampParam(p, given ? given[k] : undefined);
    return out;
}

function autoTitle() {
    return `${state.pack.name} ${state.m.manifest.short || state.m.manifest.name}`;
}

function title() {
    return (state.titleEdited ? state.title : autoTitle()).trim().slice(0, 60) || autoTitle();
}

export function currentSpec() {
    const overrides = {};
    for (const [k, v] of Object.entries(state.overrides)) if (k in state.m.manifest.slots) overrides[k] = v;
    return {
        spec: 1,
        mechanic: { key: state.m.manifest.key, version: state.m.manifest.version },
        params: { ...state.params },
        theme: { pack: state.pack.key, overrides },
        rules: { win: state.win, lose: state.lose },
        meta: { title: title() }
    };
}

// A new frame each time the Studio opens: changing a frame's address adds to the browser's history
function freshFrame() {
    const old = $('studio-frame');
    bridge.unregister(old);
    const frame = old.cloneNode(false);
    frame.removeAttribute('src');
    old.replaceWith(frame);
}

// A new mechanic, theme or picture means a fresh page; parameters and rules go to the running game.
// The page is replaced rather than navigated, so Back leaves the Studio instead of stepping through previews.
function reloadPreview() {
    const frame = $('studio-frame');
    const url = `studio/play.html?v=${++reloads}#${encodeSpec(currentSpec())}`;
    bridge.unregister(frame);
    if (frame.dataset.loaded) frame.contentWindow.location.replace(url);
    else { frame.src = url; frame.dataset.loaded = '1'; }
    bridge.register(frame, 'studio-preview', { persist: false });
}

function updatePreview(soon) {
    clearTimeout(liveTimer);
    const send = () => bridge.send($('studio-frame'), 'spec.update', currentSpec());
    if (soon) liveTimer = setTimeout(send, 60); else send();
}

function changed() {
    state.dirty = true;
}

function renderAll() {
    renderMechanics();
    renderThemes();
    renderPictures();
    renderParams();
    renderRules();
    renderMusic();
    renderShare();
    const input = $('studio-title');
    input.value = title();
    input.oninput = () => {
        state.title = input.value;
        state.titleEdited = input.value.trim() !== '';
        changed();
        updatePreview(true);
    };
}

function choice(button, selected) {
    button.type = 'button';
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
    return button;
}

function renderMechanics() {
    const box = $('studio-mechanics');
    box.replaceChildren(...mechanics.map(mod => {
        const mm = mod.manifest;
        const b = choice(el('button', 'card'), mod === state.m);
        b.append(el('span', 'card-emoji', mm.emoji), el('span', 'card-name', mm.name), el('span', 'card-text', mm.summary));
        b.addEventListener('click', () => {
            if (mod === state.m) return;
            state.m = mod;
            state.params = defaults(mod);
            state.win = mod.manifest.rules.win;
            state.lose = mod.manifest.rules.lose;
            changed();
            renderAll();
            reloadPreview();
        });
        return b;
    }));
}

function renderThemes() {
    const box = $('studio-themes');
    box.replaceChildren(...PACKS.map(pack => {
        const b = choice(el('button', 'card theme'), pack === state.pack);
        b.style.setProperty('--sw', pack.palette.board);
        b.style.setProperty('--sw2', pack.palette.bg);
        const art = el('span', 'theme-art');
        art.append(thumb(pack.roles.chain[2]), thumb(pack.roles.player), thumb(pack.roles.chain[8]));
        b.append(art, el('span', 'card-name', pack.name));
        b.addEventListener('click', () => {
            if (pack === state.pack) return;
            state.pack = pack;
            state.overrides = state.overrides.music !== undefined ? { music: state.overrides.music } : {};
            changed();
            renderAll();
            reloadPreview();
        });
        return b;
    }));
}

// Each picture slot: what the theme puts there, and a picker to swap it
function renderPictures() {
    const box = $('studio-pictures');
    const rows = [];
    for (const [name, slot] of Object.entries(state.m.manifest.slots)) {
        if (slot.kind === 'music') continue;
        const row = el('div', 'slot');
        const head = el('button', 'slot-head');
        head.type = 'button';
        const current = slotValue(name, slot);
        const shown = el('span', 'slot-art');
        (slot.many ? current.slice(0, 5) : [current]).forEach(id => id && shown.append(thumb(id)));
        head.append(el('span', 'slot-name', slot.title || name), shown, el('span', 'slot-change', 'Change'));
        const picker = el('div', 'picker');
        picker.hidden = true;
        head.addEventListener('click', () => {
            if (!picker.childElementCount) fillPicker(picker, name, slot);
            picker.hidden = !picker.hidden;
        });
        row.append(head, picker);
        rows.push(row);
    }
    box.replaceChildren(...rows);
}

function slotValue(name, slot) {
    const o = state.overrides[name];
    if (slot.many) return Array.isArray(o) && o.length ? o : (state.pack.roles[slot.role] || state.pack.roles.chain);
    return typeof o === 'string' ? o : state.pack.roles[slot.role];
}

function pickSlot(name, value) {
    if (value == null) delete state.overrides[name]; else state.overrides[name] = value;
    changed();
    renderPictures();
    reloadPreview();
}

function fillPicker(picker, name, slot) {
    const reset = el('button', 'chip', 'From the theme');
    reset.type = 'button';
    reset.addEventListener('click', () => pickSlot(name, null));
    picker.append(reset);
    if (slot.many) {
        // A whole chain from any set
        for (const set of SETS) {
            const list = setChain(set);
            if (list.length < (slot.min || 1)) continue;
            const b = el('button', 'set-pick');
            b.type = 'button';
            b.setAttribute('aria-label', `Use the ${set} set`);
            list.slice(0, 6).forEach(id => b.append(thumb(id)));
            b.addEventListener('click', () => pickSlot(name, list));
            picker.append(b);
        }
    } else {
        const grid = el('div', 'pic-grid');
        for (const id of Object.keys(SPRITES)) {
            const b = el('button', 'pic');
            b.type = 'button';
            b.title = SPRITES[id].name;
            b.append(thumb(id));
            b.addEventListener('click', () => pickSlot(name, id));
            grid.append(b);
        }
        picker.append(grid);
    }
}

function renderParams() {
    const box = $('studio-params');
    const props = state.m.manifest.params.properties;
    box.replaceChildren(...Object.entries(props).map(([key, p]) => {
        const row = el('div', 'param');
        const label = el('label', 'param-name', p.title || key);
        const id = `param-${key}`;
        label.htmlFor = id;
        if (p.type === 'boolean') {
            const input = el('input');
            input.type = 'checkbox';
            input.id = id;
            input.className = 'toggle';
            input.checked = !!state.params[key];
            input.addEventListener('change', () => setParam(key, input.checked, p));
            row.classList.add('param-bool');
            row.append(label, input);
            return row;
        }
        if (p.enum) {
            const chips = el('div', 'chips');
            p.enum.forEach(v => {
                const label = p['x-labels'] && p['x-labels'][v] != null ? p['x-labels'][v] : String(v);   // a manifest may name its choices
                const b = choice(el('button', 'chip', label), state.params[key] === v);
                b.addEventListener('click', () => { setParam(key, v, p); renderParams(); });
                chips.append(b);
            });
            row.append(label, chips);
            return row;
        }
        const value = el('output', 'param-value', format(state.params[key], p));
        const input = el('input');
        input.type = 'range';
        input.id = id;
        input.min = p.minimum;
        input.max = p.maximum;
        input.step = p.type === 'integer' ? 1 : (p['x-step'] || (p.maximum - p.minimum) / 50);
        input.value = state.params[key];
        // Live parameters change the running game as the slider moves; the rest restart it on release
        input.addEventListener('input', () => {
            value.textContent = format(Number(input.value), p);
            if (p['x-live']) setParam(key, Number(input.value), p, true);
        });
        input.addEventListener('change', () => setParam(key, Number(input.value), p));
        const top = el('div', 'param-top');
        top.append(label, value);
        row.append(top, input);
        return row;
    }));
}

function format(v, p) {
    if (p.type === 'integer') return String(v);
    const step = p['x-step'] || 0.01;
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return Number(v).toFixed(digits);
}

function setParam(key, value, p, soon) {
    const v = clampParam(p, value);
    if (state.params[key] === v && !soon) return;
    state.params[key] = v;
    changed();
    updatePreview(soon);
}

function renderRules() {
    renderRule('win', $('studio-win'));
    renderRule('lose', $('studio-lose'));
    $('studio-vars').textContent = `You can use: ${ruleNames(state.m.manifest).join(', ')}`;
}

function renderRule(kind, box) {
    const presets = (state.m.manifest.rulePresets && state.m.manifest.rulePresets[kind]) || [];
    const value = state[kind];
    const isPreset = presets.some(pr => pr.value === value);
    const chips = el('div', 'chips');
    for (const pr of presets) {
        const b = choice(el('button', 'chip', pr.label), pr.value === value);
        b.addEventListener('click', () => setRule(kind, pr.value));
        chips.append(b);
    }
    const custom = choice(el('button', 'chip', 'Custom…'), !isPreset);
    chips.append(custom);
    const input = el('input', 'rule-input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.placeholder = kind === 'win' ? 'e.g. score >= 1000' : 'e.g. time >= 90';
    input.value = value || '';
    input.hidden = isPreset;
    const note = el('div', 'rule-note');
    custom.addEventListener('click', () => { input.hidden = false; custom.classList.add('selected'); input.focus(); });
    input.addEventListener('input', () => {
        try {
            compileRule(input.value, ruleNames(state.m.manifest));
            note.textContent = input.value.trim() ? '' : (kind === 'win' ? 'Empty: no way to win, play on' : 'Empty: you never lose');
            note.classList.remove('bad');
            state[kind] = input.value.trim() || null;
            changed();
            updatePreview(true);
        } catch (e) {
            note.textContent = e instanceof RuleError ? e.message : String(e);
            note.classList.add('bad');
        }
    });
    box.replaceChildren(chips, input, note);
}

function setRule(kind, value) {
    state[kind] = value;
    changed();
    renderRules();
    updatePreview();
}

function renderMusic() {
    const box = $('studio-music');
    const current = state.overrides.music ?? null;
    const options = [[null, 'None'], ...Object.entries(MUSIC).map(([k, mu]) => [k, mu.name])];
    box.replaceChildren(...options.map(([key, name]) => {
        const b = choice(el('button', 'chip', name), current === key);
        b.addEventListener('click', () => {
            state.overrides.music = key;
            changed();
            renderMusic();
            reloadPreview();
        });
        return b;
    }));
    $('studio-credit').textContent = current && MUSIC[current] ? MUSIC[current].credit : '';
}

// Who can play it: everyone (in the Pukytoon feed, needs an account) or only this phone
function renderShare() {
    const options = [['everyone', 'Everyone'], ['me', 'Only on this phone']];
    $('studio-share').replaceChildren(...options.map(([key, name]) => {
        const b = choice(el('button', 'chip', name), state.share === key);
        b.addEventListener('click', () => {
            state.share = key;
            changed();
            renderShare();
        });
        return b;
    }));
    $('studio-share-note').textContent = state.share === 'everyone'
        ? 'It goes in everyone’s feed, with your name on it. You can take it down any time.'
        : 'Only you can play it, on this phone.';
}

function publish() {
    const names = ruleNames(state.m.manifest);
    for (const kind of ['win', 'lose']) {
        try { compileRule(state[kind], names); } catch (e) {
            alert(`The ${kind === 'win' ? 'win' : 'lose'} rule needs fixing: ${e.message}`);
            return;
        }
    }
    const result = {
        id: state.id,
        title: title(),
        spec: currentSpec(),
        blurb: `${state.m.manifest.name} · ${state.pack.name}`,
        share: state.share
    };
    state.dirty = false;
    closeStudio(true);
    if (callbacks.onPublish) callbacks.onPublish(result);
}

$('studio-publish').addEventListener('click', publish);
$('studio-close').addEventListener('click', () => closeStudio());
$('studio-reset').addEventListener('click', () => {
    state.params = defaults(state.m);
    changed();
    renderParams();
    updatePreview();
});
