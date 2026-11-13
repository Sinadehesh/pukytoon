// --- ZOMBIE BOMBER ---
// 300 levels. Zombies walk at your base from the right and you blow them up.
//   Tap the bomb bay to drop a bomb in. Two of the same merge into a bigger bomb (Happy Fruit Merge rules).
//   Drag any bomb out of the bay onto the battlefield and let go: it lands right there and blows up.
//   Bigger bombs blast wider and harder, and the big ones have tricks of their own (cluster, napalm, nuke, ...).
// Soldiers on the base shoot the zombies too. A zombie that reaches the base pounds on it until it dies.
// Zombies come in waves and drop coins; between levels the coins buy upgrades (Soldiers, Weapons, Base, Bombs).
// Level, coins, upgrades and the bombs you've made are saved in the browser.

const { Engine, Bodies, Body, Composite, Events, Query } = Matter;

// ---------- HELPERS ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = t => Math.pow(clamp(t, 0, 1), 3);
const easeOutBack = t => { t = clamp(t, 0, 1); return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); };
const elastic = t => t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 14);
function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => clamp(Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt)), 0, 255);
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
const fmt = n => n >= 100000 ? `${Math.floor(n / 1000)}K` : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : `${Math.floor(n)}`;

// ---------- LAYOUT (logical pixels; the canvas is scaled to fit the screen) ----------
// The width is fixed. The height follows the screen's shape (800 to 980), so phones are filled edge to edge:
// the bomb bay sits at the bottom, the battlefield gets the rest.
const W = 450;
let H = 800;
const HUD_H = 56;
const BAY_LINE = 70;          // overflow line, in bay coordinates
const GROUND_DEPTH = 124;     // horizon to the bottom of the battlefield
const L = {};
function computeLayout() {
    const aspect = window.innerHeight / Math.max(1, window.innerWidth);
    H = Math.round(clamp(W * aspect, 800, 980));
    const bayH = Math.round(350 + (H - 800) * 0.35);
    L.bay = { x: 12, y: H - bayH - 10, w: 426, h: bayH };
    L.battleTop = HUD_H;
    L.battleBottom = L.bay.y - 16;
    L.groundY = L.battleBottom - GROUND_DEPTH;   // horizon
    L.laneTop = L.groundY + 34;                   // zombies walk between these
    L.laneBottom = L.groundY + 108;
    L.impactY = (L.laneTop + L.laneBottom) / 2;   // where bombs land
    L.baseBottom = L.laneTop + 22;                // the base stands on the back of the road
    L.stopX = 122;                                // zombies stop here and pound on the base
    L.planeY = L.battleTop + 54;
}
// things further down the road are closer to you, so they're drawn bigger
const depthOf = y => 0.84 + 0.3 * clamp((y - L.laneTop) / (L.laneBottom - L.laneTop), 0, 1);

// ---------- BOMBS ----------
// Art for each level (cut from assets/bomber/bombs/source_sheet.webp). If an image can't load,
// that bomb is drawn in code instead. Hitboxes come from the sprite outlines in shapes.js.
const BOMB_SPRITES = ['firecracker', 'cherry_bomb', 'grenade', 'dynamite', 'tnt', 'cluster_bomb', 'aerial_bomb',
    'napalm', 'bunker_buster', 'thermobaric', 'mega_nuke', 'black_hole']
    .map((name, i) => `../assets/bomber/bombs/${String(i + 1).padStart(2, '0')}_${name}.png`);
const SPRITE_SIZE = 256;   // sprite images are 256x256
const SPRITE_FIT = 1.08;   // draw slightly bigger than the hitbox so the art touches

// fx: what's special about the bomb when it goes off; desc: shown when you make one for the first time
const BOMBS = [
    { name: 'Firecracker',   body: '#ff4757', band: '#ffd32a', icon: 'band',   desc: 'A LITTLE POP' },
    { name: 'Cherry Bomb',   body: '#d63031', band: '#2ecc71', icon: 'leaf',   desc: 'A BIGGER POP' },
    { name: 'Grenade',       body: '#6ab04c', band: '#2f5d1e', icon: 'pin',    desc: 'NOW WE\'RE TALKING' },
    { name: 'Dynamite',      body: '#e17055', band: '#2d3436', icon: 'sticks', desc: 'TAKES DOWN BRUTES' },
    { name: 'TNT Barrel',    body: '#e84118', band: '#fbc531', icon: 'tnt',    desc: 'BIG BOOM' },
    { name: 'Cluster Bomb',  body: '#0984e3', band: '#dff9fb', icon: 'dots',   desc: 'SPLITS INTO 5 BOMBLETS', fx: 'cluster' },
    { name: 'Aerial Bomb',   body: '#57606f', band: '#fbc531', icon: 'rivets', desc: 'HUGE BLAST' },
    { name: 'Napalm',        body: '#ff9f1a', band: '#2d3436', icon: 'flame',  desc: 'LEAVES A WALL OF FIRE', fx: 'napalm' },
    { name: 'Bunker Buster', body: '#2f3542', band: '#ff6b35', icon: 'hazard', desc: 'DIGS IN, THEN ERUPTS', fx: 'buster' },
    { name: 'Thermobaric',   body: '#8e44ad', band: '#f5f6fa', icon: 'skull',  desc: 'TWO-STAGE MEGA BLAST', fx: 'thermo' },
    { name: 'Mega Nuke',     body: '#f9ca24', band: '#2d3436', icon: 'rad',    desc: 'MUSHROOM CLOUD!', fx: 'nuke' },
    { name: 'Black Hole',    body: '#1e1336', band: '#e056fd', icon: 'void',   desc: 'SWALLOWS THE HORDE', fx: 'hole' }
];
const BOMB_R = [22, 27, 33, 39, 46, 53, 61, 69, 78, 87, 97, 108];   // radius in the bay
const fieldR = t => 13 + t * 2.6;                                     // radius when flying over the battlefield
const blastRadius = t => (32 + 10 * t) * stats().blastMul * (BOMBS[t].fx === 'nuke' ? 1.4 : 1);
const blastDamage = t => 3 * Math.pow(1.7, t) * stats().bombDmg;

// ---------- ZOMBIES ----------
// Zombie art (cut from assets/bomber/zombies/source_sheet.webp and zombies2/); drawn in code if an image can't load
const ZOMBIE_SPRITES = {
    walker: '../assets/bomber/zombies/01_walker.png',
    runner: '../assets/bomber/zombies/02_runner.png',
    brute: '../assets/bomber/zombies/03_brute.png',
    boss: '../assets/bomber/zombies/04_boss.png',
    sprinter: '../assets/bomber/zombies2/01_sprinter.png',
    trooper: '../assets/bomber/zombies2/02_trooper.png',
    bloater: '../assets/bomber/zombies2/03_bloater.png',
    screamer: '../assets/bomber/zombies2/04_screamer.png',
    hulk: '../assets/bomber/zombies2/05_hulk.png',
    ghoul: '../assets/bomber/zombies2/06_ghoul.png',
    juggernaut: '../assets/bomber/zombies2/07_juggernaut.png',
    titan: '../assets/bomber/zombies2/08_titan.png'
};
const ZOMBIE_H = 62;   // a walker's height at the middle of the road
// 12 zombie types. The first four show up in the first 10 levels; after that a new type is discovered
// every 20 levels (20, 40, ... 160). `weight` = how common it is once discovered; `pts` also sets the coins it drops.
// speed in px/s, dmg = damage per hit on the base. armor: less damage from bullets.
// bursts: blows up when it dies and hurts the zombies around it. screams: makes the zombies near it faster.
// look: extra details for the drawn version (if the art can't load).
const ZOMBIES = {
    walker:     { name: 'Walker',      unlock: 1,   skin: '#7bd389', shirt: '#4a69bd', pants: '#353b48', size: 1.0,  hp: 3,   speed: 30, dmg: 1,  pts: 10,  weight: 3 },
    runner:     { name: 'Runner',      unlock: 2,   skin: '#badc58', shirt: '#eb4d4b', pants: '#2f3640', size: 0.9,  hp: 2,   speed: 58, dmg: 1,  pts: 15,  weight: 2 },
    brute:      { name: 'Brute',       unlock: 3,   skin: '#4b9e6b', shirt: '#6d214f', pants: '#1e272e', size: 1.45, hp: 16,  speed: 18, dmg: 3,  pts: 50,  weight: 1 },
    boss:       { name: 'Zombie King', unlock: 5,   skin: '#26de81', shirt: '#130f40', pants: '#000000', size: 2.2,  hp: 60,  speed: 13,  dmg: 8,  pts: 400, weight: 0, boss: true, look: 'crown' },
    trooper:    { name: 'Trooper',     unlock: 20,  skin: '#8fbc8f', shirt: '#556b2f', pants: '#3b3b2e', size: 1.05, hp: 10,  speed: 28, dmg: 2,  pts: 40,  weight: 1.2, look: 'helmet', armor: 0.35 },
    sprinter:   { name: 'Sprinter',    unlock: 40,  skin: '#c4e538', shirt: '#e84393', pants: '#2d3436', size: 0.9,  hp: 4,   speed: 85, dmg: 1,  pts: 35,  weight: 1, look: 'mohawk' },
    bloater:    { name: 'Bloater',     unlock: 60,  skin: '#a3cb38', shirt: '#ffbe76', pants: '#6d4c41', size: 1.4,  hp: 30,  speed: 19, dmg: 3,  pts: 80,  weight: 0.7, look: 'fat', bursts: true },
    screamer:   { name: 'Screamer',    unlock: 80,  skin: '#d6a2e8', shirt: '#5f27cd', pants: '#2c2c54', size: 1.1,  hp: 14,  speed: 46, dmg: 2,  pts: 70,  weight: 0.9, look: 'hood', screams: true },
    hulk:       { name: 'Hulk',        unlock: 100, skin: '#009432', shirt: '#2c2c54', pants: '#1e272e', size: 1.8,  hp: 50,  speed: 20, dmg: 5,  pts: 150, weight: 0.5, look: 'horns' },
    ghoul:      { name: 'Ghoul',       unlock: 120, skin: '#c8d6e5', shirt: '#222f3e', pants: '#10161e', size: 1.15, hp: 30,  speed: 64, dmg: 3,  pts: 140, weight: 0.7, look: 'glow' },
    juggernaut: { name: 'Juggernaut',  unlock: 140, skin: '#6ab04c', shirt: '#57606f', pants: '#2f3542', size: 2.0,  hp: 120, speed: 15, dmg: 6,  pts: 300, weight: 0.3, look: 'armor', armor: 0.5 },
    titan:      { name: 'Titan',       unlock: 160, skin: '#1dd1a1', shirt: '#341f97', pants: '#130f40', size: 2.5,  hp: 220, speed: 11,  dmg: 12, pts: 900, weight: 0.12, look: 'horns' }
};
for (const [kind, t] of Object.entries(ZOMBIES)) t.kind = kind;

const MAX_LEVEL = 300;

// Difficulty: the number, toughness, speed and crowding of zombies go up with the level
const levelZombieCount = level => Math.min(150, Math.round(12 + level * 1.5));
// toughness: gentle for the first 10 levels, steep up to 60, then slower so the last levels stay winnable
const levelHpMul = level => level <= 10 ? 1 + (level - 1) * 0.12 : level <= 60 ? 2.08 + (level - 10) * 0.3 : 17.08 + (level - 60) * 0.12;
const levelSpeedMul = level => Math.min(1.8, 1 + (level - 1) * 0.006);
const levelWaves = level => Math.min(5, 2 + Math.floor(level / 6));
const packSize = level => Math.min(9, 1 + Math.floor(Math.random() * (2 + level / 8)));   // zombies arriving together
const packEvery = level => Math.max(0.4, 1.6 - level * 0.018);

// ---------- SOLDIERS & SHOTS ----------
// Shots: each soldier look fires its own projectile with its own muzzle flash (assets/bomber/shots).
// tip / tipY = where the gun's muzzle is: right of the soldier's centre / above the feet, as fractions of the art's height.
// jet = the flash is a jet pointing forward (starts at the muzzle) instead of a star centred on it.
const SHOTS = [
    { name: 'pistol',  len: 20, flash: 12, speed: 650,  tip: 0.285 },
    { name: 'rifle',   len: 30, flash: 14, speed: 700,  tip: 0.33 },
    { name: 'grenade', len: 15, flash: 17, speed: 420,  tip: 0.33, spin: true, smoke: true },
    { name: 'tracer',  len: 34, flash: 19, speed: 750,  tip: 0.35 },
    { name: 'sniper',  len: 34, flash: 15, speed: 1000, tip: 0.32 },
    { name: 'flame',   len: 40, flash: 22, speed: 480,  tip: 0.31, tipY: 0.6, jet: true },
    { name: 'minigun', len: 28, flash: 18, speed: 750,  tip: 0.34, tipY: 0.42, jet: true },
    { name: 'energy',  len: 44, flash: 19, speed: 800,  tip: 0.335 }
];
const SHOT_SPRITES = SHOTS.map((sh, i) => `../assets/bomber/shots/proj_${i + 1}_${sh.name}.png`);
const FLASH_SPRITES = SHOTS.map((sh, i) => `../assets/bomber/shots/flash_${i + 1}.png`);
// Soldier art, one image per Soldiers upgrade level (cut from assets/bomber/soldiers/source_sheet.webp)
const SOLDIER_SPRITES = ['recruit', 'rifleman', 'grenadier', 'machine_gunner', 'sniper', 'flamethrower', 'heavy_gunner', 'elite']
    .map((n, i) => `../assets/bomber/soldiers/0${i + 1}_${n}.png`);
const SOLDIER_H = 46;      // soldier height at the middle of the road
const SOLDIER_RANGE = 250;
// Drawn soldiers if the art can't load: each upgrade level gets its own colors and a longer gun
const SOLDIER_LOOKS = [
    { body: '#7a8f4a', helmet: '#5b6e33', gun: 9,  gunColor: '#2d3436' },
    { body: '#5a7d3a', helmet: '#4b6b2f', gun: 13, gunColor: '#2d3436' },
    { body: '#c2a36b', helmet: '#8b7d4b', gun: 13, gunColor: '#2d3436' },
    { body: '#3d5229', helmet: '#2f3d1f', gun: 16, gunColor: '#1e272e' },
    { body: '#6d7f4f', helmet: '#3f4d2a', gun: 20, gunColor: '#1e272e' },
    { body: '#e67e22', helmet: '#7f8c8d', gun: 14, gunColor: '#d35400' },
    { body: '#2e86de', helmet: '#34495e', gun: 17, gunColor: '#576574' },
    { body: '#2d3436', helmet: '#c0392b', gun: 17, gunColor: '#48dbfb' }
];
// Where soldiers stand, in front of the base: x, and how far down the road (0 = back, 1 = front)
const SOLDIER_SPOTS = [[104, 0.2], [90, 0.95], [74, 0.5], [58, 1.0], [44, 0.3]];

// Base art, one image per stage (2 Base upgrade levels per stage), tight-cropped at sheet resolution
const BASE_SPRITES = ['outpost', 'bunker', 'fort', 'fortress'].map((n, i) => `../assets/bomber/base/0${i + 1}_${n}.png`);
const BASE_ART_SCALE = 0.5;     // canvas px per sheet px (keeps the stages' relative sizes)

// UI art (assets/bomber/ui); each falls back to a drawn look if it can't load
const UI_SPRITES = ['btn_green_long', 'btn_sound_on', 'btn_sound_off', 'btn_city', 'btn_play', 'ribbon',
    'icon_gift', 'icon_star', 'icon_heart', 'icon_zombie', 'icon_bomb', 'icon_trophy', 'icon_coin', 'panel', 'btn_purple_long'];
const PLANE_SPRITE = '../assets/bomber/plane.png';

// Battlefield skies, switched with the 🌆 button. groundRow = image row where the grass starts.
const BACKGROUNDS = [
    { src: '../assets/bomber/bg_city.webp', groundRow: 666 },
    { src: '../assets/bomber/bg_ruins.webp', groundRow: 806 },
    { src: null }  // drawn in code
];

// ---------- UPGRADE SHOP ----------
// Zombies drop coins; between levels the coins buy levels in 4 upgrade tracks.
// grow = how much dearer each level gets than the one before
const UPGRADES = {
    soldiers: { name: 'SOLDIERS', max: 8,  price: 60, grow: 1.9 },
    weapons:  { name: 'WEAPONS',  max: 12, price: 50, grow: 1.65 },
    base:     { name: 'BASE',     max: 20, price: 40, grow: 1.42 },
    bombs:    { name: 'BOMBS',    max: 16, price: 80, grow: 1.6 }
};
const upgradePrice = (key, lv) => Math.round(UPGRADES[key].price * Math.pow(UPGRADES[key].grow, lv - 1));  // from lv to lv + 1
const SOLDIER_COUNT = [1, 1, 2, 2, 3, 3, 4, 5];
const coinsFor = type => Math.max(1, Math.round(type.pts / 4));

// Progress saved in the browser
const SAVE_KEY = 'zombieBomber.save';
let save = { level: 1, coins: 0, up: { soldiers: 1, weapons: 1, base: 1, bombs: 1 }, bestScore: 0, won: false, tut: false, bestTier: 0 };
try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) save = { ...save, ...s, up: { ...save.up, ...(s.up || {}) } };
} catch (e) {}
save.level = clamp(Math.floor(save.level) || 1, 1, MAX_LEVEL);
save.coins = Math.max(0, Math.floor(save.coins) || 0);
save.bestTier = clamp(Math.floor(save.bestTier) || 0, 0, BOMBS.length - 1);
for (const k of Object.keys(UPGRADES)) save.up[k] = clamp(Math.floor(save.up[k]) || 1, 1, UPGRADES[k].max);
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

// What the current upgrade levels do. Soldiers only get stronger through upgrades (zombies get tougher
// every level), so the bombs you merge carry the later levels.
function stats(up = save.up) {
    return {
        soldiers: SOLDIER_COUNT[up.soldiers - 1],
        soldierLook: up.soldiers - 1,                                   // one look per level
        soldierDmg: 0.6 * (1 + 0.15 * (up.soldiers - 1)) * (1 + 0.18 * (up.weapons - 1)),
        fireRate: 1 + 0.05 * (up.weapons - 1),
        baseHp: 20 + 10 * (up.base - 1),
        baseStage: Math.min(3, Math.floor((up.base - 1) / 2)),          // which base art to draw
        dropMin: Math.floor((up.bombs - 1) / 3),                        // smallest bomb you drop
        bombDmg: 1 + 0.12 * (up.bombs - 1),
        blastMul: 1 + 0.03 * (up.bombs - 1)
    };
}

// What the next level of a track gives, for the shop card
function upgradeEffect(key) {
    const now = stats(), next = stats({ ...save.up, [key]: save.up[key] + 1 });
    switch (key) {
        case 'soldiers': return next.soldiers > now.soldiers ? '+1 SOLDIER' : 'STRONGER SOLDIERS';
        case 'weapons': return '+18% DAMAGE · FASTER';
        case 'base': return '+10 BASE HP';
        case 'bombs': return next.dropMin > now.dropMin ? 'BIGGER BOMB DROPS' : '+12% BOMB DAMAGE';
    }
}

// ---------- CANVAS ----------
const canvas = document.getElementById('game');
const mainCtx = canvas.getContext('2d');
let ctx = mainCtx;   // swapped while drawing into cached layers
function withCtx(g, fn) { const prev = ctx; ctx = g; try { fn(); } finally { ctx = prev; } }
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        r = Math.min(typeof r === 'number' ? r : (r && r[0]) || 0, w / 2, h / 2);
        this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
}
let viewScale = 1, RS = 1;   // RS = canvas pixels per logical pixel

const FONT = "'Luckiest Guy', 'Arial Black', system-ui, sans-serif";

// ---------- ART ----------
const imgReady = img => img && img.complete && img.naturalWidth > 0;
function loadImage(src, onload) { const img = new Image(); if (onload) img.onload = onload; img.src = src; return img; }
const bombImgs = BOMB_SPRITES.map(s => loadImage(s));
const zombieImgs = Object.fromEntries(Object.entries(ZOMBIE_SPRITES).map(([k, src]) => [k, loadImage(src)]));
const planeImg = loadImage(PLANE_SPRITE);
const shotImgs = SHOT_SPRITES.map(s => loadImage(s));
const flashImgs = FLASH_SPRITES.map(s => loadImage(s));
const soldierImgs = SOLDIER_SPRITES.map(s => loadImage(s));
const baseImgs = BASE_SPRITES.map(s => loadImage(s));
const uiImgs = Object.fromEntries(UI_SPRITES.map(n => [n, loadImage(`../assets/bomber/ui/${n}.png`)]));
const bgImgs = BACKGROUNDS.map(bg => bg.src ? loadImage(bg.src, () => { layers.dirty = true; }) : null);
let bgIndex = 0;
try { bgIndex = clamp(parseInt(localStorage.getItem('zombieBomber.bg'), 10) || 0, 0, BACKGROUNDS.length - 1); } catch (e) {}
function nextBackground() {
    bgIndex = (bgIndex + 1) % BACKGROUNDS.length;
    layers.dirty = true;
    try { localStorage.setItem('zombieBomber.bg', bgIndex); } catch (e) {}
}

// Draw a UI image fitted (keeping its shape) into a box centred on (cx, cy); returns false if not loaded
function drawUi(name, cx, cy, w, h) {
    const img = uiImgs[name];
    if (!imgReady(img)) return false;
    const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    ctx.drawImage(img, cx - img.naturalWidth * k / 2, cy - img.naturalHeight * k / 2, img.naturalWidth * k, img.naturalHeight * k);
    return true;
}

// A one-color copy of an image (white for hit flashes, red for "this one's in the blast"), made once
const silCache = new Map();
function silhouette(img, color) {
    if (!imgReady(img)) return null;
    const key = img.src + color;
    let c = silCache.get(key);
    if (!c) {
        c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
        silCache.set(key, c);
    }
    return c;
}

// Soft round glows, drawn scaled for fire, smoke, lights and dust
function makeGlow(rgb, mid = 0.45) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${rgb},1)`); grd.addColorStop(mid, `rgba(${rgb},0.55)`); grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return c;
}
const GLOW = {
    white: makeGlow('255,250,235', 0.35), yellow: makeGlow('255,214,90'), orange: makeGlow('255,138,32'), red: makeGlow('225,55,20'),
    smoke: makeGlow('66,56,62', 0.5), smokeLight: makeGlow('128,116,120', 0.5), dust: makeGlow('140,112,84', 0.55),
    smokeWarm: makeGlow('150,90,60', 0.5),
    purple: makeGlow('190,90,255'), green: makeGlow('140,240,80'), toxic: makeGlow('120,200,60', 0.55), cyan: makeGlow('120,240,255')
};
function glow(name, x, y, r, a) {
    if (a <= 0.003 || r <= 0.5) return;
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * Math.min(1, a);
    ctx.drawImage(GLOW[name], x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = a0;
}

// ---------- SOUND (synthesized, no files) ----------
const Sound = (() => {
    let ac = null, out = null, noiseBuf = null, muted = false;
    try { muted = localStorage.getItem('zombieBomber.muted') === '1'; } catch (e) {}
    const lastAt = {};
    function init() {
        if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
        try {
            ac = new (window.AudioContext || window.webkitAudioContext)();
            const comp = ac.createDynamicsCompressor();
            comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
            out = ac.createGain(); out.gain.value = 0.7;
            out.connect(comp); comp.connect(ac.destination);
            const len = Math.floor(ac.sampleRate * 2);
            noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            if (ac.state === 'suspended') ac.resume();
        } catch (e) { ac = null; }
    }
    // false while muted, before the first tap, or if this sound played less than `gap` seconds ago
    function can(name, gap = 0) {
        if (!ac || muted || ac.state !== 'running') return false;
        const now = ac.currentTime;
        if (gap && lastAt[name] !== undefined && now - lastAt[name] < gap) return false;
        lastAt[name] = now;
        return true;
    }
    function tone(type, f0, f1, dur, vol, at = 0, attack = 0.004) {
        const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
    function hiss(dur, vol, type, f0, f1, at = 0, q = 0.8, attack = 0.002) {
        const t = ac.currentTime + at, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        src.buffer = noiseBuf; src.loop = true;
        f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(out);
        src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }
    const midi = n => 440 * Math.pow(2, (n - 69) / 12);
    const PENTA = [0, 2, 4, 7, 9];
    const penta = (base, i) => base + PENTA[i % 5] + 12 * Math.floor(i / 5);
    return {
        init,
        isMuted: () => muted,
        toggle() { muted = !muted; try { localStorage.setItem('zombieBomber.muted', muted ? '1' : '0'); } catch (e) {} return muted; },
        click() { if (can('click', 0.03)) { tone('sine', 660, 990, 0.06, 0.14); } },
        error() { if (can('error', 0.15)) { tone('square', 220, 160, 0.12, 0.06); tone('square', 180, 120, 0.14, 0.06, 0.09); } },
        drop() { if (can('drop', 0.03)) { tone('sine', 620, 240, 0.1, 0.16); hiss(0.05, 0.04, 'highpass', 4000); } },
        land(k) { if (can('land', 0.05)) tone('sine', 190, 80, 0.09, 0.04 + 0.12 * k); },
        grab() { if (can('grab', 0.05)) { tone('square', 480, 900, 0.05, 0.05); tone('sine', 1200, 1700, 0.07, 0.07, 0.02); } },
        merge(tier, combo) {
            if (!can('merge', 0.02)) return;
            const f = midi(penta(60, Math.min(16, tier + combo * 2)));   // climbs with combos, up to a point
            tone('sine', f * 0.6, f * 1.6, 0.09, 0.22);
            tone('triangle', f, f, 0.26, 0.13, 0.035);
            tone('sine', f * 2, f * 2, 0.2, 0.05, 0.035);
        },
        whoosh() { if (can('whoosh', 0.05)) hiss(0.24, 0.13, 'bandpass', 450, 1900, 0, 1.6, 0.06); },
        whistle(dur) { if (can('whistle', 0.06)) tone('sine', 1500, 520, dur, 0.04, 0, 0.08); },
        boom(t) {
            if (!can('boom', 0.035)) return;
            hiss(0.1, 0.45, 'highpass', 2400, 700);                                       // crack
            hiss(0.45 + t * 0.12, 0.75 + t * 0.03, 'lowpass', 2600 - t * 140, 90, 0, 0.9); // blast
            tone('sine', 165 - t * 7, 34, 0.35 + t * 0.07, 0.95, 0, 0.002);                // thump
            if (t >= 5) hiss(1 + (t - 5) * 0.35, 0.3 + (t - 5) * 0.05, 'lowpass', 520, 45, 0.06, 1.1, 0.09);  // rumble
        },
        pop() { if (can('pop', 0.04)) { tone('sine', 300, 900, 0.07, 0.15); hiss(0.08, 0.1, 'bandpass', 1400, 600, 0, 2); } },
        toxic() { if (can('toxic', 0.06)) { hiss(0.5, 0.35, 'lowpass', 900, 120, 0, 2); tone('sine', 120, 50, 0.4, 0.3); } },
        sizzle(dur) { if (can('sizzle', 0.3)) hiss(dur, 0.12, 'bandpass', 2800, 1600, 0, 0.6, 0.15); },
        vortex() { if (can('vortex', 0.5)) { tone('sawtooth', 70, 30, 1.3, 0.12, 0, 0.3); tone('sine', 180, 1300, 1.2, 0.08, 0, 0.4); hiss(1.2, 0.18, 'bandpass', 300, 2200, 0, 3, 0.4); } },
        shot(look) {
            if (!can('shot', 0.07)) return;
            switch (look) {
                case 2: tone('sine', 210, 80, 0.12, 0.16); hiss(0.06, 0.06, 'lowpass', 900); break;               // grenade launcher
                case 4: hiss(0.14, 0.16, 'bandpass', 1500, 600, 0, 1); tone('square', 900, 200, 0.05, 0.04); break; // sniper
                case 5: hiss(0.22, 0.07, 'lowpass', 1300, 500, 0, 0.7, 0.03); break;                                 // flamethrower
                case 6: hiss(0.035, 0.08, 'bandpass', 2400, 1800, 0, 1.2); break;                                    // minigun
                case 7: tone('sawtooth', 1300, 300, 0.1, 0.04); tone('sine', 2000, 900, 0.08, 0.04); break;          // energy
                default: hiss(0.06, 0.11, 'bandpass', 2200 - look * 150, 900, 0, 1.1); tone('square', 320, 120, 0.04, 0.025);
            }
        },
        splat() { if (can('splat', 0.045)) { hiss(0.13, 0.16, 'bandpass', 800, 260, 0, 2.2); tone('sine', 170, 60, 0.1, 0.09); } },
        coin() { if (can('coin', 0.055)) { tone('triangle', 1976, 1976, 0.06, 0.07); tone('triangle', 2637, 2637, 0.16, 0.07, 0.05); } },
        baseHit() { if (can('baseHit', 0.1)) { tone('sine', 95, 40, 0.25, 0.4); hiss(0.16, 0.25, 'lowpass', 900, 200); } },
        groan() {
            if (!can('groan', 2.8)) return;
            const t = ac.currentTime, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
            const f0 = rand(85, 125);
            o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 0.75, t + 0.8);
            lfo.frequency.value = rand(5, 8); lg.gain.value = 6; lfo.connect(lg); lg.connect(o.frequency);
            f.type = 'bandpass'; f.frequency.setValueAtTime(rand(450, 700), t); f.Q.value = 3;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
            o.connect(f); f.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + 0.9); lfo.stop(t + 0.9);
        },
        roar() { if (can('roar', 1)) { tone('sawtooth', 70, 45, 1.2, 0.18, 0, 0.1); hiss(1.1, 0.25, 'bandpass', 380, 160, 0, 2, 0.1); } },
        alarm() { if (can('alarm', 0.8)) [0, 0.22, 0.44].forEach(at => { tone('square', 740, 740, 0.16, 0.05, at); tone('square', 990, 990, 0.08, 0.04, at + 0.11); }); },
        multi(n) { if (can('multi', 0.1)) [0, 4, 7, 12].slice(0, Math.min(4, n)).forEach((s, i) => tone('triangle', midi(72 + s), midi(72 + s), 0.18, 0.08, i * 0.06)); },
        buy() { if (can('buy', 0.05)) [0, 4, 7, 12, 16].forEach((s, i) => tone('triangle', midi(72 + s), midi(72 + s), 0.14, 0.12, i * 0.055)); },
        star(i) { if (can('star' + i, 0.05)) { tone('triangle', midi(76 + i * 4), midi(76 + i * 4), 0.3, 0.13); tone('sine', midi(88 + i * 4), midi(88 + i * 4), 0.25, 0.05); } },
        win() { if (can('win', 0.5)) [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone('triangle', midi(60 + s), midi(60 + s), 0.22 + (i === 6 ? 0.4 : 0), 0.14, i * 0.085)); },
        lose() { if (can('lose', 0.5)) [7, 3, 0, -5].forEach((s, i) => { tone('sawtooth', midi(55 + s), midi(54 + s), 0.32, 0.07, i * 0.22); tone('sine', midi(43 + s), midi(43 + s), 0.32, 0.12, i * 0.22); }); },
        newBomb() { if (can('newBomb', 0.3)) [0, 7, 12, 19, 24].forEach((s, i) => tone('sine', midi(67 + s), midi(67 + s), 0.25, 0.09, i * 0.07)); }
    };
})();

// ---------- VIBRATION (Android phones; iPhones don't let websites vibrate) ----------
const Haptics = (() => {
    const canVibrate = typeof navigator.vibrate === 'function';
    let busyUntil = 0;
    return {
        buzz(ms, important) {
            if (!canVibrate || document.hidden || Sound.isMuted()) return;
            if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
            const now = performance.now();
            if (now < busyUntil && !important) return;
            busyUntil = now + ms;
            try { navigator.vibrate(Math.round(ms)); } catch (e) {}
        }
    };
})();

// ---------- DRAWING HELPERS ----------
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); }
function ellipse(x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, Math.PI * 2); }
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
// Cartoon text: dark outline and, for bigger text, a soft drop shadow
function text(str, x, y, size, color, align = 'center', stroke = '#1a1026', strokeW = size * 0.2) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (stroke && size >= 17) {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.4; ctx.lineWidth = strokeW; ctx.strokeStyle = '#000'; ctx.strokeText(str, x, y + size * 0.09);
        ctx.globalAlpha = a;
    }
    if (stroke) { ctx.lineWidth = strokeW; ctx.strokeStyle = stroke; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function textWidth(str, size) { ctx.font = `${size}px ${FONT}`; return ctx.measureText(str).width; }
// A rounded button: fill, darker bottom lip, light top edge, outline
function button(x, y, w, h, top, bottom, label, size = 22, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(x, y + 4, w, h, h * 0.32); ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; rrect(x, y, w, h, h * 0.32); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; rrect(x + 4, y + 3, w - 8, h * 0.38, h * 0.2); ctx.fill();
    ctx.strokeStyle = '#1a1026'; ctx.lineWidth = 3; rrect(x, y, w, h, h * 0.32); ctx.stroke();
    if (label) text(label, x + w / 2, y + h / 2 + 2, size, '#fff');
    ctx.restore();
}
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// ---------- CACHED LAYERS (sky, ground, bay frame), redrawn when the size or background changes ----------
const layers = { dirty: true };
function makeLayer(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * RS)); c.height = Math.max(1, Math.round(h * RS));
    const g = c.getContext('2d'); g.setTransform(RS, 0, 0, RS, 0, 0);
    g.imageSmoothingQuality = 'high';
    return { c, g, w, h };
}
function ensureLayers() {
    if (!layers.dirty) return;
    layers.dirty = false;
    layers.sky = renderSkyLayer();
    layers.ground = renderGroundLayer();
    const old = layers.decals;
    layers.decals = makeLayer(W, layers.ground.h);
    layers.decals.top = layers.ground.top;
    if (old && old.h === layers.decals.h) layers.decals.g.drawImage(old.c, 0, 0, W, old.h);   // keep the scorch marks
    layers.bay = renderBayLayer();
    layers.vignette = renderVignetteLayer();
}
function clearDecals() { if (layers.decals) layers.decals.g.clearRect(0, 0, W, layers.decals.h); }
// Paint something permanent on the ground (scorch marks, goo) in screen coordinates
function paintDecal(fn) {
    const d = layers.decals;
    if (!d) return;
    withCtx(d.g, () => { ctx.save(); ctx.translate(0, -d.top); fn(); ctx.restore(); });
}

// Sky art, scaled to cover the sky and lined up so its grass starts at the horizon
function renderSkyLayer() {
    const bg = BACKGROUNDS[bgIndex], img = bgImgs[bgIndex];
    if (!bg.src || !imgReady(img)) return null;
    const lay = makeLayer(W, L.groundY + 12);
    withCtx(lay.g, () => {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const s = Math.max(W / iw, (L.groundY - L.battleTop + 6) / bg.groundRow);
        const dw = iw * s, dx = (W - dw) / 2, dy = L.groundY - bg.groundRow * s;
        ctx.drawImage(img, dx, dy, dw, ih * s);
        drawHorizonHaze();
    });
    return lay;
}
function drawHorizonHaze() {
    const hz = ctx.createLinearGradient(0, L.groundY - 70, 0, L.groundY + 6);
    hz.addColorStop(0, 'rgba(120, 50, 110, 0)'); hz.addColorStop(1, 'rgba(120, 50, 110, 0.38)');
    ctx.fillStyle = hz; ctx.fillRect(0, L.groundY - 70, W, 76);
}

// The ground: a dirt road the horde walks along, with grass verges. Drawn once.
function renderGroundLayer() {
    const top = L.groundY - 10, h = L.battleBottom - top + 2;
    const lay = makeLayer(W, h);
    lay.top = top;
    withCtx(lay.g, () => {
        ctx.translate(0, -top);
        const R = seeded(11), y0 = L.groundY, y1 = L.battleBottom + 2;
        // grass field, dark at the horizon
        const fg = ctx.createLinearGradient(0, y0, 0, y1);
        fg.addColorStop(0, '#1d2c1b'); fg.addColorStop(0.1, '#33502a'); fg.addColorStop(0.5, '#3b5c2b'); fg.addColorStop(1, '#26401c');
        ctx.fillStyle = fg; ctx.fillRect(0, y0, W, y1 - y0);
        // grass speckles
        for (let i = 0; i < 900; i++) {
            const x = R() * W, y = y0 + 3 + R() * (y1 - y0), d = depthOf(y);
            ctx.fillStyle = R() < 0.5 ? 'rgba(110, 160, 70, 0.25)' : 'rgba(15, 30, 10, 0.3)';
            ctx.fillRect(x, y, 1.5 * d, 1.2 * d);
        }
        // the road
        const r0 = L.laneTop - 17, r1 = L.laneBottom + 12;
        const edge = (base, amp, seed) => {
            const rr = seeded(seed), pts = [];
            for (let x = -12; x <= W + 12; x += 8) pts.push([x, base + (rr() - 0.5) * amp + Math.sin(x * 0.035 + seed) * amp * 0.5]);
            return pts;
        };
        const te = edge(r0, 5, 3), be = edge(r1, 7, 5);
        ctx.beginPath(); ctx.moveTo(te[0][0], te[0][1]);
        for (const p of te) ctx.lineTo(p[0], p[1]);
        for (let i = be.length - 1; i >= 0; i--) ctx.lineTo(be[i][0], be[i][1]);
        ctx.closePath();
        const rg = ctx.createLinearGradient(0, r0, 0, r1);
        rg.addColorStop(0, '#5c4431'); rg.addColorStop(0.45, '#77583c'); rg.addColorStop(1, '#66492f');
        ctx.fillStyle = rg; ctx.fill();
        ctx.save(); ctx.clip();
        for (let i = 0; i < 2600; i++) {
            const x = R() * W, y = r0 - 6 + R() * (r1 - r0 + 12), d = depthOf(y), s = (0.6 + R() * 1.6) * d;
            ctx.fillStyle = R() < 0.5 ? 'rgba(160, 126, 90, 0.4)' : 'rgba(45, 30, 18, 0.38)';
            ctx.fillRect(x, y, s, s * 0.7);
        }
        // wheel ruts
        for (const f of [0.3, 0.72]) {
            const ry = lerp(r0, r1, f), wob = x => ry + Math.sin(x * 0.018 + f * 9) * 2.2;
            ctx.strokeStyle = 'rgba(40, 26, 15, 0.3)'; ctx.lineWidth = 5 + f * 5;
            ctx.beginPath(); for (let x = -10; x <= W + 10; x += 10) x < 0 ? ctx.moveTo(x, wob(x)) : ctx.lineTo(x, wob(x)); ctx.stroke();
            ctx.strokeStyle = 'rgba(170, 136, 98, 0.18)'; ctx.lineWidth = 1.6;
            ctx.beginPath(); for (let x = -10; x <= W + 10; x += 10) x < 0 ? ctx.moveTo(x, wob(x) + 4 + f * 3) : ctx.lineTo(x, wob(x) + 4 + f * 3); ctx.stroke();
        }
        // pebbles
        for (let i = 0; i < 80; i++) {
            const x = R() * W, y = r0 + R() * (r1 - r0), d = depthOf(y), s = (1.3 + R() * 2.4) * d;
            ctx.fillStyle = 'rgba(25, 16, 10, 0.4)'; ellipse(x + 0.6, y + s * 0.35, s * 1.1, s * 0.5); ctx.fill();
            ctx.fillStyle = R() < 0.5 ? '#8a7866' : '#9d8975'; ellipse(x, y, s, s * 0.62); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ellipse(x - s * 0.3, y - s * 0.2, s * 0.4, s * 0.22); ctx.fill();
        }
        // the road darkens into the distance
        const dg = ctx.createLinearGradient(0, r0, 0, r0 + 26);
        dg.addColorStop(0, 'rgba(20, 12, 20, 0.35)'); dg.addColorStop(1, 'rgba(20, 12, 20, 0)');
        ctx.fillStyle = dg; ctx.fillRect(0, r0 - 6, W, 32);
        ctx.restore();
        // grass tufts on the verges and hanging over the road's edges
        const tuft = (x, y, s) => {
            ctx.lineCap = 'round';
            for (let i = 0; i < 5; i++) {
                const a = -Math.PI / 2 + (i - 2) * 0.33 + (R() - 0.5) * 0.25, len = (4 + R() * 6) * s;
                ctx.strokeStyle = i % 2 ? '#4f7a33' : '#2c4a1e'; ctx.lineWidth = 1.5 * s;
                ctx.beginPath(); ctx.moveTo(x + (i - 2) * 1.3 * s, y);
                ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.4, y + Math.sin(a) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len);
                ctx.stroke();
            }
        };
        for (let i = 0; i < 60; i++) { const y = lerp(y0 + 6, r0 - 1, R()); tuft(R() * W, y, 0.6 + (y - y0) / 40); }
        for (let i = 0; i < 46; i++) { const x = R() * W; tuft(x, r0 + 2 + R() * 3, 0.8); }
        for (let i = 0; i < 40; i++) { const x = R() * W; tuft(x, r1 + 3 + R() * 4, 1.1); }
        for (let i = 0; i < 30; i++) { const y = lerp(r1 + 6, y1, R()); tuft(R() * W, y, 1.25); }
        // grass fringe along the horizon
        ctx.fillStyle = '#1b2a18';
        ctx.beginPath(); ctx.moveTo(0, y0 + 4);
        for (let x = 0; x <= W; x += 3) ctx.lineTo(x, y0 + 2 - R() * 5 * (0.5 + 0.5 * Math.sin(x * 0.7)));
        ctx.lineTo(W, y0 + 6); ctx.closePath(); ctx.fill();
        // a little darker at the front edge, where the bay starts
        const bgr = ctx.createLinearGradient(0, y1 - 18, 0, y1);
        bgr.addColorStop(0, 'rgba(0,0,0,0)'); bgr.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = bgr; ctx.fillRect(0, y1 - 18, W, 18);
    });
    return lay;
}

// Battlefield vignette: darker corners pull the eye to the action
function renderVignetteLayer() {
    const h = L.battleBottom - L.battleTop;
    const lay = makeLayer(W, h);
    withCtx(lay.g, () => {
        const g = ctx.createRadialGradient(W / 2, h * 0.62, h * 0.35, W / 2, h * 0.62, W * 0.78);
        g.addColorStop(0, 'rgba(10, 0, 20, 0)'); g.addColorStop(1, 'rgba(10, 0, 20, 0.45)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
        const t = ctx.createLinearGradient(0, 0, 0, 30);
        t.addColorStop(0, 'rgba(0,0,0,0.45)'); t.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = t; ctx.fillRect(0, 0, W, 30);
    });
    return lay;
}

function bolt(x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, '#9aa0b8'); g.addColorStop(1, '#3a3e52');
    ctx.fillStyle = '#14151f'; circle(x, y + 0.8, r + 0.8); ctx.fill();
    ctx.fillStyle = g; circle(x, y, r); ctx.fill();
    ctx.strokeStyle = 'rgba(20, 20, 30, 0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - r * 0.55, y - r * 0.2); ctx.lineTo(x + r * 0.55, y + r * 0.2); ctx.stroke();
}

// The bomb bay: an armored box set into the ground below the battlefield. Drawn once.
function renderBayLayer() {
    const top = L.battleBottom - 4;
    const lay = makeLayer(W, H - top);
    lay.top = top;
    withCtx(lay.g, () => {
        ctx.translate(0, -top);
        const { x, y, w, h } = L.bay;
        // earth behind the frame
        ctx.fillStyle = '#1a1410'; ctx.fillRect(0, top, W, H - top);
        // outer steel frame
        const fx = 2, fy = top + 1, fw = W - 4, fh = H - top - 3;
        const fr = ctx.createLinearGradient(0, fy, 0, fy + fh);
        fr.addColorStop(0, '#6a6f86'); fr.addColorStop(0.035, '#4a4f66'); fr.addColorStop(0.5, '#353a4e'); fr.addColorStop(1, '#23263a');
        ctx.fillStyle = fr; rrect(fx, fy, fw, fh, 14); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; rrect(fx + 1.5, fy + 1.5, fw - 3, fh - 3, 13); ctx.stroke();
        ctx.strokeStyle = '#0d0e17'; ctx.lineWidth = 2; rrect(fx, fy, fw, fh, 14); ctx.stroke();
        // hazard stripes along the top lip
        ctx.save(); rrect(fx + 4, fy + 3, fw - 8, y - fy - 6, 6); ctx.clip();
        for (let sx = -20; sx < W + 20; sx += 22) {
            ctx.fillStyle = 'rgba(245, 190, 30, 0.85)';
            ctx.beginPath(); ctx.moveTo(sx, fy + 3 + (y - fy - 6)); ctx.lineTo(sx + 11, fy + 3); ctx.lineTo(sx + 22, fy + 3); ctx.lineTo(sx + 11, fy + 3 + (y - fy - 6)); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, y - 6, W, 3);
        ctx.restore();
        // bolts on the frame
        for (let by = y + 26; by < y + h - 10; by += 58) { bolt(7, by, 2.6); bolt(W - 7, by, 2.6); }
        for (let bx = 30; bx < W - 20; bx += 65) bolt(bx, H - 6, 2.4);
        // inner well
        ctx.save(); rrect(x, y, w, h, 10); ctx.clip();
        const ig = ctx.createLinearGradient(0, y, 0, y + h);
        ig.addColorStop(0, '#2b3046'); ig.addColorStop(1, '#171a28');
        ctx.fillStyle = ig; ctx.fillRect(x, y, w, h);
        // steel plates
        const cols = 4, pw = w / cols;
        for (let i = 1; i < cols; i++) {
            const px = x + i * pw;
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px - 1, y, 2, h);
            ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(px + 1, y, 1, h);
        }
        const rowY = [y + h * 0.42, y + h * 0.78];
        for (const ry of rowY) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, ry - 1, w, 2); ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(x, ry + 1, w, 1); }
        ctx.globalAlpha = 0.7;
        for (let i = 0; i <= cols; i++) for (const ry of [y + 14, ...rowY.map(v => v + 9), y + h - 10]) {
            const px = x + i * pw + (i === 0 ? 9 : i === cols ? -9 : 0);
            if (i > 0 && i < cols) { bolt(px - 8, ry, 1.8); bolt(px + 8, ry, 1.8); } else bolt(px, ry, 1.8);
        }
        ctx.globalAlpha = 1;
        // brushed-metal streaks
        const R = seeded(5);
        for (let i = 0; i < 140; i++) {
            ctx.fillStyle = `rgba(255,255,255,${0.012 + R() * 0.02})`;
            ctx.fillRect(x + R() * w, y + R() * h, 20 + R() * 60, 1);
        }
        // warm work light from the top, darker corners
        const lg = ctx.createRadialGradient(x + w / 2, y - 20, 10, x + w / 2, y - 20, w * 0.75);
        lg.addColorStop(0, 'rgba(255, 210, 150, 0.16)'); lg.addColorStop(1, 'rgba(255, 210, 150, 0)');
        ctx.fillStyle = lg; ctx.fillRect(x, y, w, h);
        const vg = ctx.createRadialGradient(x + w / 2, y + h * 0.45, h * 0.35, x + w / 2, y + h * 0.45, w * 0.72);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = vg; ctx.fillRect(x, y, w, h);
        // inner shadow along the top edge
        const sg = ctx.createLinearGradient(0, y, 0, y + 22);
        sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.fillRect(x, y, w, 22);
        // diamond-plate floor
        const fy0 = y + h - 18;
        ctx.fillStyle = '#20232f'; ctx.fillRect(x, fy0, w, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        for (let dx = x + 4; dx < x + w; dx += 12) for (let dy = fy0 + 4; dy < y + h; dy += 8) {
            ctx.save(); ctx.translate(dx + ((dy - fy0) / 8 % 2) * 6, dy); ctx.rotate(0.6); ctx.fillRect(-3, -0.8, 6, 1.6); ctx.restore();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x, fy0, w, 2);
        // the dropper rail
        const rg = ctx.createLinearGradient(0, y + 2, 0, y + 10);
        rg.addColorStop(0, '#7a8098'); rg.addColorStop(1, '#2f3346');
        ctx.fillStyle = rg; ctx.fillRect(x, y + 3, w, 7);
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x, y + 10, w, 2);
        ctx.restore();
        // rim
        ctx.strokeStyle = '#0b0c14'; ctx.lineWidth = 3; rrect(x, y, w, h, 10); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; rrect(x - 2.5, y - 2.5, w + 5, h + 5, 12); ctx.stroke();
    });
    return lay;
}

// ---------- STATE ----------
let state = 'title';        // title | play | cleared | over | shop | won
let time = 0, stateT = 0;   // real seconds (for UI animation), seconds in the current state
let level = 1, score = 0, baseHP = 20, baseMax = 20, baseFlash = 0, hpShown = 20;
let kills = 0, totalZombies = 0, bestMerge = 0, coinsThisLevel = 0, stars = 0, clearBonus = 0, leftoverCoins = 0;
let zombies = [], soldiers = [], bullets = [], thrown = [], explosions = [], lights = [], fires = [], vortexes = [], timers = [];
let fieldParts = [], topParts = [], floats = [], coins = [], leftovers = [];
let waves = [], waveIdx = -1, waveQueue = [], waveState = 'gap', waveGapT = 0, waveIdleT = 0, spawnT = 0;
let boss = null;
let currentTier = 0, nextTier = 0, dropCd = 0, dropperX = W / 2, dropperPop = 1, jammed = false, overT = 0, jamMsgT = 0;
let grabbed = null, gesture = null, hoverBay = false;
let mergeCombo = 0, mergeComboT = 0;
let shakeMag = 0, flashA = 0, flashColor = '255,255,255', hurtA = 0, hitstop = 0, slowT = 0;
let banner = null, popup = null, hudCoinBump = 0;
let predictedKills = 0;
let tut = null;
let attractT = 1.2, attractSpawnT = 0;
let pointer = { x: W / 2, y: 0 };
const plane = { x: -120, y: 0, vx: 78, wait: 1 };
const clouds = Array.from({ length: 4 }, (_, i) => ({ x: rand(0, W), f: rand(0.05, 0.6), s: rand(0.7, 1.3), v: rand(3, 9) }));
const skyline = [];
for (let x = -10; x < W + 20;) { const w = rand(18, 42); skyline.push({ x, w, h: rand(25, 85), broken: Math.random() < 0.4 }); x += w + rand(-4, 6); }
const stars_ = Array.from({ length: 40 }, () => ({ x: rand(0, W), f: rand(0, 0.6), r: rand(0.5, 1.5), p: rand(0, 6) }));

// ---------- BOMB BAY PHYSICS ----------
const engine = Engine.create({ positionIterations: 12, velocityIterations: 8 });
let bayFloor = null, bayWallL = null, bayWallR = null;
function buildBayWalls() {
    const { w, h } = L.bay;
    bayFloor = Bodies.rectangle(w / 2, h + 25, w * 2, 50, { isStatic: true });
    bayWallL = Bodies.rectangle(-25, h / 2 - h, 50, h * 4, { isStatic: true });
    bayWallR = Bodies.rectangle(w + 25, h / 2 - h, 50, h * 4, { isStatic: true });
    Composite.add(engine.world, [bayFloor, bayWallL, bayWallR]);
}
// the bay got taller or shorter (the phone turned): move the floor and everything resting on it
function fitBayPhysics(oldH) {
    const { w, h } = L.bay, dh = h - oldH;
    Body.setPosition(bayFloor, { x: w / 2, y: h + 25 });
    Body.setPosition(bayWallL, { x: -25, y: h / 2 - h });
    Body.setPosition(bayWallR, { x: w + 25, y: h / 2 - h });
    for (const b of bayBombs()) Body.translate(b, { x: 0, y: dh });
}

const bayBombs = () => engine.world.bodies.filter(b => b.tier !== undefined);
const spriteScale = r => (r * 2 * SPRITE_FIT) / SPRITE_SIZE;

function spawnBayBomb(x, y, tier, merged) {
    const r = BOMB_R[tier];
    const startR = merged ? Math.max(r * 0.4, 8) : r;
    const opts = { restitution: 0.12, friction: 0.4, density: 0.001 * (tier + 1) };
    const outline = typeof SHAPES !== 'undefined' && SHAPES[BOMB_SPRITES[tier]];
    let body, centre = null;
    if (outline) {
        // hitbox = the sprite's outline; Matter centres the body on the outline's centroid
        const pts = outline.map(([px, py]) => ({ x: px, y: py }));
        centre = Matter.Vertices.centre(pts);
        const s = spriteScale(startR);
        body = Bodies.fromVertices(x, y, [pts.map(p => ({ x: p.x * s, y: p.y * s }))], opts);
    } else {
        body = Bodies.circle(x, y, startR, opts);
    }
    body.centre = centre;
    body.tier = tier;
    body.currentRadius = startR;
    body.targetRadius = r;
    body.isGrowing = merged;
    body.isDropping = !merged;
    body.popT = merged ? -1 : 9;   // springy "pop" once a merged bomb has grown
    if (merged) Body.setVelocity(body, { x: 0, y: 2 });
    Body.setInertia(body, Infinity);  // bombs stay upright (fuse up) instead of tumbling
    Composite.add(engine.world, body);
    return body;
}

Events.on(engine, 'beforeUpdate', () => {
    for (const b of bayBombs()) {
        if (b.isGrowing) {
            const next = Math.min(b.targetRadius, b.currentRadius + b.targetRadius / 16);
            Body.scale(b, next / b.currentRadius, next / b.currentRadius);
            Body.setInertia(b, Infinity);  // scaling resets inertia; keep it upright
            b.currentRadius = next;
            if (next >= b.targetRadius) { b.isGrowing = false; b.popT = 0; }
        }
        if (b.popT >= 0 && b.popT < 9) b.popT += 1 / 60;
        if (b.isDropping) {
            b.dropAge = (b.dropAge || 0) + 1;
            if (b.dropAge > 60 && b.speed < 0.3) b.isDropping = false;
        }
    }
});
const popScale = b => b.popT >= 0 && b.popT < 0.7 ? 1 + 0.16 * Math.sin(b.popT * 18) * Math.exp(-b.popT * 7) : 1;

// Bombs only merge after landing (on the floor or on a landed bomb), like Happy Fruit Merge
const isLanded = b => b === bayFloor || (b.tier !== undefined && !b.isDropping);
function handleBayCollisions(e) {
    for (const pair of e.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        if (a.isDropping && isLanded(b)) landed(a);
        if (b.isDropping && isLanded(a)) landed(b);
        if (a.isDropping || b.isDropping) continue;
        if (a.tier === undefined || a.tier !== b.tier || a.tier >= BOMBS.length - 1) continue;
        if (a.isMerging || b.isMerging || state !== 'play') continue;
        a.isMerging = b.isMerging = true;
        mergeBombs(a, b);
    }
}
Events.on(engine, 'collisionStart', handleBayCollisions);
Events.on(engine, 'collisionActive', handleBayCollisions);

function landed(b) {
    b.isDropping = false;
    if (b.speed > 2) Sound.land(Math.min(1, b.speed / 12));
}

function mergeBombs(a, b) {
    const t = a.tier + 1;
    const x = (a.position.x + b.position.x) / 2, y = (a.position.y + b.position.y) / 2;
    Composite.remove(engine.world, [a, b]);
    spawnBayBomb(x, y, t, true);
    mergeCombo = mergeComboT > 0 ? mergeCombo + 1 : 0;
    mergeComboT = 1.1;
    score += Math.round(t * t * 2 * (1 + mergeCombo * 0.5));
    bestMerge = Math.max(bestMerge, t);
    Sound.merge(t, mergeCombo);
    Haptics.buzz(8 + t * 3);
    const sx = L.bay.x + x, sy = L.bay.y + y, r = BOMB_R[t];
    for (let i = 0; i < 10 + t * 3; i++) {
        const a2 = rand(0, Math.PI * 2), sp = rand(80, 220 + t * 10);
        topParts.push({ kind: 'sparkle', x: sx + Math.cos(a2) * r * 0.5, y: sy + Math.sin(a2) * r * 0.5, vx: Math.cos(a2) * sp, vy: Math.sin(a2) * sp, g: 0, drag: 4, life: rand(0.35, 0.7), t: 0, size: rand(2.5, 5), color: i % 3 ? BOMBS[t].light : '#fff6c0' });
    }
    topParts.push({ kind: 'ring', x: sx, y: sy, vx: 0, vy: 0, g: 0, drag: 0, life: 0.4, t: 0, size: r * 1.6, color: '255, 240, 190' });
    topParts.push({ kind: 'flash', x: sx, y: sy, vx: 0, vy: 0, g: 0, drag: 0, life: 0.18, t: 0, size: r * 1.5 });
    if (t >= 6) addShake(1.5 + (t - 6) * 0.5);
    if (mergeCombo >= 1) floatText(sx, sy - r - 14, `COMBO x${mergeCombo + 1}`, '#ffd32a', 17 + Math.min(mergeCombo, 5) * 2);
    if (t > save.bestTier) { save.bestTier = t; writeSave(); discoverBomb(t); }
    if (tut && tut.step <= 1) advanceTut(2);
}

function discoverBomb(t) {
    if (t < 2) return;   // the first two aren't worth a fanfare
    popup = { tier: t, t: 0, dur: 2.6 };
    Sound.newBomb();
}

// ---------- GAME FLOW ----------
function setupBase() {
    const st = stats();
    baseMax = st.baseHp; baseHP = baseMax; hpShown = baseHP;
    soldiers = Array.from({ length: st.soldiers }, (_, i) => {
        const [x, f] = SOLDIER_SPOTS[i % SOLDIER_SPOTS.length];
        return { x, y: lerp(L.baseBottom + 4, L.laneBottom, f), f, cd: rand(0.2, 1), recoil: 0, look: st.soldierLook };
    });
}

function clearBay() {
    for (const b of bayBombs()) Composite.remove(engine.world, b);
    grabbed = null;
    if (gesture) gesture = null;
}

function resetField() {
    // coins still flying to the counter are yours
    for (const c of coins) if (!c.done) save.coins += c.v;
    if (coins.length) writeSave();
    zombies = []; bullets = []; thrown = []; explosions = []; lights = []; fires = []; vortexes = []; timers = [];
    fieldParts = []; topParts = []; floats = []; coins = []; leftovers = [];
    boss = null; popup = null;
}

// The horde for a level, split into waves that grow; the new zombie type (if any) shows up in every wave
function buildHorde(lv) {
    const kinds = Object.values(ZOMBIES).filter(t => !t.boss && t.unlock <= lv);
    const weightOf = t => (t.kind === 'walker' ? Math.max(0.6, 3 - lv / 40) : t.weight);
    const total = kinds.reduce((s, t) => s + weightOf(t), 0);
    const pickKind = () => { let r = Math.random() * total; return (kinds.find(k => (r -= weightOf(k)) < 0) || kinds[0]).kind; };
    const n = levelZombieCount(lv), nw = levelWaves(lv);
    const ws = Array.from({ length: nw }, (_, i) => 1 + 0.35 * i), wsum = ws.reduce((a, b) => a + b, 0);
    let left = n;
    const out = ws.map((w, i) => {
        const c = i === nw - 1 ? left : Math.max(1, Math.round(n * w / wsum));
        left -= c;
        return Array.from({ length: c }, pickKind);
    });
    const fresh = Object.values(ZOMBIES).find(t => t.unlock === lv && lv > 1 && !t.boss);
    if (fresh) out.forEach(w => { w[Math.floor(w.length / 2)] = fresh.kind; });
    if (lv % 5 === 0) for (let i = 0; i < 1 + Math.floor(lv / 60); i++) out[nw - 1].push('boss');
    return out;
}

const TIPS = ['WAIT FOR THE HORDE TO BUNCH UP', 'MERGE BIG BOMBS FOR BIG BOOMS', 'DRAG BOMBS ONTO THE ZOMBIES',
    'BIG ZOMBIES NEED BIG BOMBS', 'MERGE FAST FOR COMBOS', 'BLOW UP LOTS AT ONCE FOR BONUS COINS'];

function startLevel(n) {
    clearBay();
    resetField();
    clearDecals();
    level = n; score = 0; kills = 0; bestMerge = 0; coinsThisLevel = 0;
    setupBase();
    waves = buildHorde(level); waveIdx = -1; waveQueue = []; waveState = 'gap'; waveGapT = 2.4; waveIdleT = 0;
    totalZombies = waves.reduce((s, w) => s + w.length, 0);
    currentTier = randomDropTier(); nextTier = randomDropTier();
    dropCd = 0; dropperPop = 0.6; jammed = false; overT = 0; mergeCombo = 0; mergeComboT = 0;
    state = 'play'; stateT = 0;
    reviveUsed = false;
    const fresh = Object.values(ZOMBIES).find(t => t.unlock === level && level > 1 && !t.boss);
    let sub = fresh ? `NEW ZOMBIE: ${fresh.name.toUpperCase()}!` : level % 5 === 0 ? 'THE ZOMBIE KING IS COMING!' : level === 1 ? 'STOP THE HORDE!' : TIPS[level % TIPS.length];
    if (boostTier >= 0) {   // the head start from the shop: a big bomb waiting in the bay
        spawnBayBomb(L.bay.w / 2, BOMB_R[boostTier] + 10, boostTier, false);
        sub = `HEAD START: ${BOMBS[boostTier].name.toUpperCase()}!`;
        boostTier = -1;
    }
    showBanner(`LEVEL ${level}`, sub, '#ffd32a', 2.4);
    tut = save.tut ? null : { step: 0, t: 0, drops: 0 };
}

// ---------- AD OFFERS (rewarded ads, always the player's choice; see ads.js) ----------
let reviveUsed = false, reviveT = 0;   // repair the base when it falls: once a level
let clearedOffer = null;               // double the level's coins: null until decided, then true/false
let coinsOfferUsed = false;            // free coins in the shop: once a visit
let boostTier = -1;                    // head start: the bomb waiting for the next level
const REVIVE_SECONDS = 9;
const freeCoinsAmount = lv => Math.round((20 + lv * 6) / 5) * 5;
const boostTierFor = lv => Math.min(BOMBS.length - 1, stats().dropMin + (lv % 5 === 0 ? 5 : 4));
const levelCoins = () => clearBonus + coinsThisLevel + leftoverCoins;

// The base has fallen: offer to repair it, else the level is lost
function baseFalls() {
    if (!reviveUsed && Ads.rewardedReady('revive')) {
        state = 'revive'; stateT = 0; reviveT = REVIVE_SECONDS;
        banner = null; popup = null;
        putBackGrabbed();
        Sound.alarm(); Haptics.buzz(120, true);
        return;
    }
    baseDestroyed();
}

function watchRevive() {
    Ads.showRewarded('revive', watched => {
        if (!watched) { baseDestroyed(); return; }
        reviveUsed = true;
        state = 'play'; stateT = 0;
        baseHP = Math.ceil(baseMax * 0.6); baseFlash = 0;
        // a blast from the repaired base throws back the zombies at the gate
        for (const z of zombies) {
            if (z.dead) continue;
            const d = Math.max(0, z.x - L.stopX);
            if (d > 180) continue;
            if (!hurtZombie(z, z.maxHp * 0.6, { kind: 'blast', x: 30, power: 1.3 })) { z.x += 80 * (1 - d / 180); z.stun = 1.2; }
        }
        explosionFx(L.stopX - 10, L.impactY, 120, 7, { noDecal: true });
        addShake(14); flashA = 0.45; flashColor = '170,230,255';
        Sound.boom(7); Sound.buy(); Haptics.buzz(60, true);
        showBanner('BASE REPAIRED!', 'KEEP FIGHTING!', '#7bed9f', 1.8);
    });
}

function watchDouble() {
    Ads.showRewarded('double', watched => {
        clearedOffer = false;   // taken or skipped: the shop opens once the coins have landed
        stateT = Math.max(stateT, 3.4);
        if (!watched) return;
        const extra = levelCoins();
        leftoverCoins += extra;   // the panel's total shows the doubled amount
        flyCoins(W / 2, L.battleTop + 150, extra, 0);
        floatText(W / 2, L.battleTop + 132, `x2!  +${extra}`, '#ffd32a', 30, 1.6, true);
        Sound.buy(); Haptics.buzz(40);
        stateT = Math.max(stateT, 3.4);
    });
}

function watchFreeCoins() {
    Ads.showRewarded('coins', watched => {
        if (!watched) return;
        coinsOfferUsed = true;
        const n = freeCoinsAmount(save.level), b = shopCoinsBtn();
        flyCoins(b.x + b.w / 2, b.y + b.h / 2, n, 0);
        floatText(b.x + b.w / 2, b.y + 50, `+${n} COINS`, '#ffd32a', 22);
        Sound.buy(); Haptics.buzz(30);
    });
}

function watchBoost() {
    Ads.showRewarded('boost', watched => {
        if (!watched) return;
        boostTier = boostTierFor(save.level);
        const b = shopBoostCard();
        floatText(b.x + b.w / 2, b.y - 6, 'HEAD START READY!', '#7bed9f', 20);
        Sound.newBomb(); Haptics.buzz(30);
    });
}

// a bomb in your hand when the level stops goes back into the bay
function putBackGrabbed() {
    if (grabbed) { spawnBayBomb(clamp(grabbed.x - L.bay.x, BOMB_R[grabbed.tier] + 2, L.bay.w - BOMB_R[grabbed.tier] - 2), BOMB_R[grabbed.tier] + 10, grabbed.tier, false); grabbed = null; }
    gesture = null;
}

function randomDropTier() { return Math.min(BOMBS.length - 1, stats().dropMin + Math.floor(Math.random() * 3)); }

function updateWaves(dt) {
    if (waveState === 'gap') {
        waveGapT -= dt;
        if (waveGapT > 0) return;
        waveIdx++;
        waveQueue = waves[waveIdx].slice();
        waveState = 'spawning'; spawnT = 0;
    } else if (waveState === 'spawning') {
        spawnT -= dt;
        if (spawnT <= 0) { spawnPack(); spawnT = packEvery(level) * rand(0.8, 1.2); }
        if (!waveQueue.length) { waveState = 'fighting'; waveIdleT = 0; }
    } else if (waveState === 'fighting') {
        waveIdleT += dt;
        if (waveIdx + 1 >= waves.length) { waveState = 'done'; return; }
        const alive = zombies.filter(z => !z.dead).length;
        if (alive <= Math.max(1, Math.round(waves[waveIdx].length * 0.25)) || waveIdleT > 9) {
            waveState = 'gap'; waveGapT = 3;
            const last = waveIdx + 1 === waves.length - 1;
            if (last) { showBanner('FINAL WAVE!', waves[waveIdx + 1].includes('boss') ? 'THE ZOMBIE KING LEADS IT!' : 'HERE THEY COME!', '#ff6b6b', 2); Sound.alarm(); }
            else showBanner(`WAVE ${waveIdx + 2}/${waves.length}`, 'GET READY…', '#ffb142', 1.6);
        }
    }
}

function spawnPack() {
    const n = Math.min(waveQueue.length, packSize(level));
    const y0 = rand(L.laneTop + 6, L.laneBottom - 6);
    for (let i = 0; i < n; i++) {
        const kind = waveQueue.shift();
        spawnZombie(kind, W + 30 + i * rand(24, 46), clamp(y0 + rand(-30, 30), L.laneTop, L.laneBottom));
    }
}

function spawnZombie(kind, x, y) {
    const type = ZOMBIES[kind], hp = type.hp * levelHpMul(state === 'title' ? 1 : level);
    const z = {
        kind, type, x, y, hp, maxHp: hp, walk: rand(0, 6), flash: 0, lunge: 0, stun: 0, burn: 0,
        speedMul: rand(0.8, 1.2) * levelSpeedMul(state === 'title' ? 1 : level),
        stopX: L.stopX + rand(0, 22) + (type.size - 1) * 16, attackT: rand(0.2, 0.7), screamT: rand(0, 1.5),
        dead: false, targeted: false
    };
    if (type.boss) {
        z.y = lerp(L.laneTop, L.laneBottom, 0.55);
        if (state === 'play') { boss = z; showBanner('ZOMBIE KING!', 'BLOW IT UP BEFORE IT REACHES THE BASE!', '#ff4757', 2.2); Sound.roar(); addShake(5); }
    }
    zombies.push(z);
    if (state === 'play' && Math.random() < 0.35) Sound.groan();
    return z;
}

function levelCleared() {
    state = 'cleared'; stateT = 0; popTimer = 0;
    drawCleared.rang = [];
    clearedOffer = null;
    const frac = baseHP / baseMax;
    stars = frac >= 0.75 ? 3 : frac >= 0.4 ? 2 : 1;
    clearBonus = 20 + level * 5;
    score += 100 * level;
    save.coins += clearBonus;
    save.bestScore = Math.max(save.bestScore, score);
    if (level >= MAX_LEVEL) save.won = true;
    save.level = Math.min(MAX_LEVEL, level + 1);
    if (tut) { save.tut = true; tut = null; }
    writeSave();
    // leftover bombs pop one by one into coins
    if (grabbed) { spawnBayBomb(clamp(grabbed.x - L.bay.x, 30, L.bay.w - 30), 40, grabbed.tier, false); grabbed = null; }
    gesture = null;
    leftovers = bayBombs().sort((a, b) => a.position.x - b.position.x);
    leftoverCoins = 0;
    Sound.win();
    hudCoinBump = 1;
}

let popTimer = 0, clearedOfferAt = 0;
// a leftover bomb pops into coins
function popLeftover() {
    while (leftovers.length) {
        const b = leftovers.shift();
        if (!engine.world.bodies.includes(b)) continue;
        const x = L.bay.x + b.position.x, y = L.bay.y + b.position.y, v = (b.tier + 1) * 2;
        Composite.remove(engine.world, b);
        leftoverCoins += v;
        Sound.pop();
        for (let i = 0; i < 12; i++) { const a = rand(0, Math.PI * 2), sp = rand(60, 200); topParts.push({ kind: 'sparkle', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, drag: 4, life: rand(0.3, 0.6), t: 0, size: rand(2, 4), color: BOMBS[b.tier].light }); }
        topParts.push({ kind: 'ring', x, y, vx: 0, vy: 0, g: 0, drag: 0, life: 0.35, t: 0, size: BOMB_R[b.tier] * 1.4, color: '255, 220, 120' });
        flyCoins(x, y, v, 2);
        return;
    }
}
function updateCleared(rdt) {
    // after the banner is up, the leftover bombs pop into coins one by one
    if (stateT > 1.1 && leftovers.length) {
        popTimer -= rdt;
        while (popTimer <= 0 && leftovers.length) { popLeftover(); popTimer += 0.16; }
    }
    // once they have: offer to double the level's coins, if an ad is ready
    if (clearedOffer === null && stateT > 1.6 && !leftovers.length) {
        clearedOffer = levelCoins() > 0 && Ads.rewardedReady('double');
        clearedOfferAt = stateT;
    }
    if (clearedOffer === false && stateT > 3.4 && !leftovers.length && !coins.length) openShop();
}

function openShop() {
    clearBay();
    coinsOfferUsed = false;   // a new visit: a new free-coins offer
    leftovers = []; coins.forEach(c => { if (!c.done) { save.coins += c.v; c.done = true; } }); coins = [];
    writeSave();
    zombies = []; bullets = []; thrown = []; vortexes = []; fires = []; timers = []; explosions = []; lights = [];
    state = level >= MAX_LEVEL && save.won ? 'won' : 'shop';
    stateT = 0; banner = null; popup = null;
    setupBase();
}

function buyUpgrade(card) {
    const key = card.key, lv = save.up[key];
    if (lv >= UPGRADES[key].max) return;
    const price = upgradePrice(key, lv);
    if (save.coins < price) { floatText(card.x + card.w / 2, card.y + card.h * 0.5, 'NOT ENOUGH COINS', '#ff6b81', 16); Sound.error(); return; }
    save.coins -= price;
    save.up[key]++;
    writeSave();
    setupBase();  // new soldiers / base HP show right away
    Sound.buy(); Haptics.buzz(20);
    for (let i = 0; i < 26; i++) { const a = rand(0, Math.PI * 2), sp = rand(80, 260); topParts.push({ kind: 'sparkle', x: card.x + card.w / 2, y: card.y + card.h * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, drag: 4, life: rand(0.4, 0.8), t: 0, size: rand(2.5, 5), color: '#ffd32a' }); }
    card.bump = 1;
    floatText(card.x + card.w / 2, card.y + card.h * 0.25, 'LEVEL UP!', '#7bed9f', 24);
}

function baseDestroyed() {
    state = 'over'; stateT = 0;
    banner = null; popup = null;
    if (grabbed) grabbed = null;
    gesture = null;
    slowT = 1.2;
    Sound.lose(); Sound.boom(8); Haptics.buzz(300, true);
    const bx = 50, by = L.baseBottom - 40;
    for (let i = 0; i < 3; i++) timers.push({ t: i * 0.18, fn: () => explosionFx(bx + rand(-30, 30), by + rand(-30, 20), 70, 6, { noDecal: true }) });
    addShake(22); flashA = 0.5; flashColor = '255,120,80';
    save.bestScore = Math.max(save.bestScore, score);
    writeSave();  // coins picked up this level are kept
}

function showBanner(title, sub, color, dur = 2.2) { banner = { title, sub, color, t: 0, dur }; }

// ---------- TUTORIAL (first play) ----------
function advanceTut(step) {
    if (!tut || step <= tut.step) return;
    tut.step = step; tut.t = 0;
    if (step === 4) { save.tut = true; writeSave(); }
}
function updateTutorial(rdt) {
    if (!tut) return;
    tut.t += rdt;
    if (tut.step === 1 && tut.t > 7) advanceTut(2);
    if (tut.step === 3 && tut.t > 2.6) { advanceTut(4); tut = null; }
}

// ---------- ACTIONS ----------
const clampDropX = (px, tier = currentTier) => clamp(px, L.bay.x + BOMB_R[tier] + 3, L.bay.x + L.bay.w - BOMB_R[tier] - 3);

function tryDrop() {
    if (state !== 'play') return;
    if (jammed) { jamMsgT = 1.2; Sound.error(); return; }
    if (dropCd > 0) return;
    const r = BOMB_R[currentTier];
    spawnBayBomb(clampDropX(dropperX) - L.bay.x, r + 10, currentTier, false);
    currentTier = nextTier; nextTier = randomDropTier();
    dropCd = 0.24; dropperPop = 0;
    Sound.drop(); Haptics.buzz(5);
    if (tut && tut.step === 0 && ++tut.drops >= 2) advanceTut(1);
}

function updateDropper(dt) {
    dropCd = Math.max(0, dropCd - dt);
    if (dropCd <= 0) dropperPop = Math.min(1, dropperPop + dt * 3.5);
    // overflow: a landed bomb sticking out above the line for a moment jams the dropper until you throw some
    const over = bayBombs().some(b => !b.isDropping && !b.isGrowing && b.bounds.min.y < BAY_LINE && b.speed < 1.2);
    overT = over ? overT + dt : Math.max(0, overT - dt * 3);
    if (!jammed && overT > 0.9) { jammed = true; jamMsgT = 1.6; Sound.alarm(); }
    if (jammed && !over) { jammed = false; dropperPop = 0; }
    jamMsgT = Math.max(0, jamMsgT - dt);
}

// the bomb (landed, not merging) under a point in the bay, with some slack for fingers
function bombAt(p) {
    const lx = p.x - L.bay.x, ly = p.y - L.bay.y;
    const bombs = bayBombs().filter(b => !b.isMerging && !b.isGrowing);
    let hit = Query.point(bombs, { x: lx, y: ly })[0];
    if (!hit) {
        let best = 16;
        for (const b of bombs) {
            const d = Math.hypot(b.position.x - lx, b.position.y - ly) - b.currentRadius;
            if (d < best) { best = d; hit = b; }
        }
    }
    return hit || null;
}

function beginGrab(p) {
    const b = gesture.body;
    if (!b || !engine.world.bodies.includes(b) || b.isMerging || state !== 'play') { gesture.kind = 'aim'; dropperX = clampDropX(p.x); return; }
    Composite.remove(engine.world, b);
    grabbed = { tier: b.tier, centre: b.centre, x: L.bay.x + b.position.x, y: L.bay.y + b.position.y, tx: p.x, ty: p.y, offY: gesture.touch ? -62 : -6, vx: 0, swing: 0, k: 0, t: 0 };
    gesture.kind = 'grab';
    moveGrab(p);
    Sound.grab(); Haptics.buzz(8);
}
function moveGrab(p) { grabbed.tx = p.x; grabbed.ty = p.y + grabbed.offY; }
const grabOverField = gb => gb.y < L.bay.y - 6;
function updateGrabbed(rdt) {
    const gb = grabbed, k = 1 - Math.exp(-rdt * 28);
    const nx = lerp(gb.x, gb.tx, k), ny = lerp(gb.y, gb.ty, k);
    gb.vx = lerp(gb.vx, (nx - gb.x) / Math.max(rdt, 0.001), 0.3);
    gb.x = nx; gb.y = ny; gb.t += rdt;
    gb.swing = lerp(gb.swing, clamp(-gb.vx * 0.0016, -0.6, 0.6), 0.25);
    gb.k = lerp(gb.k, clamp((L.bay.y + 24 - gb.y) / 56, 0, 1), 1 - Math.exp(-rdt * 14));
    if (Math.random() < rdt * 30) {   // the fuse is lit while you hold it
        const r = lerp(BOMB_R[gb.tier], fieldR(gb.tier), gb.k);
        topParts.push({ kind: 'spark', x: gb.x + r * 0.45, y: gb.y - r * 0.95, vx: rand(-80, 80), vy: rand(-140, -40), g: 300, drag: 1, life: rand(0.15, 0.35), t: 0, size: rand(1, 2) });
    }
}
function releaseGrab(cancelled) {
    const gb = grabbed; grabbed = null;
    if (!gb) return;
    if (!cancelled && state === 'play' && grabOverField(gb)) {
        throwBomb(gb.tier, gb.x, gb.y, clamp(gb.x, 24, W - 8));
        Sound.whoosh(); Haptics.buzz(10);
        if (tut && tut.step < 3) advanceTut(3);
    } else {
        // back into the bay, dropped from the top
        const r = BOMB_R[gb.tier];
        spawnBayBomb(clamp(gb.x - L.bay.x, r + 2, L.bay.w - r - 2), r + 10, gb.tier, false);
        Sound.drop();
    }
}

// A bomb lobbed onto the battlefield: a real arc that ends at (tx, impact line)
function throwBomb(tier, sx, sy, tx, opts = {}) {
    const ty = L.impactY + (opts.dy || 0);
    const dist = Math.hypot(tx - sx, ty - sy);
    const T = opts.T || clamp(0.44 + dist / 2000, 0.46, 0.62), g = 2600;
    const vy0 = (ty - sy - 0.5 * g * T * T) / T;
    thrown.push({ tier, sx, sy, tx, ty, T, g, vy0, t: 0, x: sx, y: sy, rot: 0, spin: rand(-1, 1) * 2.5, r: opts.r || fieldR(tier), small: !!opts.small, dmgMul: opts.dmgMul || 1 });
    if (!opts.small) Sound.whistle(T);
}

function updateThrown(dt) {
    for (const b of thrown) {
        b.t += dt;
        const t = Math.min(b.t, b.T);
        b.x = b.sx + (b.tx - b.sx) * (t / b.T);
        b.y = b.sy + b.vy0 * t + 0.5 * b.g * t * t;
        b.rot += b.spin * dt;
        if (Math.random() < (b.small ? 0.3 : 0.8)) fieldParts.push({ kind: 'smoke', light: true, x: b.x, y: b.y, vx: rand(-10, 10), vy: rand(-20, 0), g: 0, drag: 1, life: 0.4, t: 0, size: 3 + b.tier * 0.6, grow: 1.4, alpha: 0.4 });
        if (b.t >= b.T) { b.done = true; detonate(b.tx, b.tier, b); }
    }
    thrown = thrown.filter(b => !b.done);
}

// What happens when a bomb lands, per bomb
function detonate(x, tier, b = {}) {
    if (b.small) { explode(x, tier, { small: true, dmgMul: b.dmgMul }); return; }
    switch (BOMBS[tier].fx) {
        case 'cluster': {
            explode(x, tier, { scale: 0.8 });
            const R = blastRadius(tier);
            for (let i = 0; i < 5; i++) {
                const tx = clamp(x + (i - 2) * R * 0.75 + rand(-14, 14), 10, W - 6);
                throwBomb(tier, x, L.impactY - 20, tx, { small: true, r: 9, T: rand(0.4, 0.62), dmgMul: 0.4 });
            }
            break;
        }
        case 'napalm': {
            explode(x, tier);
            const R = blastRadius(tier);
            fires.push({ x, w: R * 2.4, t: 0, life: 4.5, dps: blastDamage(tier) * 0.12 });
            Sound.sizzle(4);
            break;
        }
        case 'buster':   // digs in, then erupts
            dirtBurst(x, 18);
            addShake(4); Sound.land(1);
            timers.push({ t: 0.32, fn: () => explode(x, tier, { scale: 1.1, geyser: true }) });
            break;
        case 'thermo':   // a fuel cloud spreads, then the whole cloud goes off
            for (let i = 0; i < 26; i++) fieldParts.push({ kind: 'smoke', toxicY: true, x: x + rand(-20, 20), y: L.impactY - rand(0, 30), vx: rand(-260, 260), vy: rand(-90, 10), g: 0, drag: 3.5, life: rand(0.5, 0.8), t: 0, size: rand(18, 30), grow: 1.6, alpha: 0.55, tint: 'smokeLight' });
            Sound.whoosh();
            timers.push({ t: 0.42, fn: () => explode(x, tier, { scale: 1.3 }) });
            break;
        case 'nuke':
            explode(x, tier, { nuke: true });
            break;
        case 'hole':
            vortexes.push({ x, t: 0, life: 1.4 });
            Sound.vortex(); addShake(3);
            break;
        default:
            explode(x, tier);
    }
}

function explode(x, tier, opts = {}) {
    const R = blastRadius(tier) * (opts.scale || 1) * (opts.small ? 0.55 : 1);
    const dmg = blastDamage(tier) * (opts.dmgMul || 1);
    const y = L.impactY;
    let killed = 0;
    const power = 0.75 + Math.min(1.3, tier * 0.13);
    for (const z of zombies) {
        if (z.dead) continue;
        const reach = R + 12 * z.type.size;
        const dx = z.x - x;
        if (Math.abs(dx) > reach) continue;
        const k = 1 - Math.abs(dx) / reach;
        if (hurtZombie(z, dmg, { kind: 'blast', x, power: power * (0.45 + 0.55 * k) })) killed++;
        else {
            z.x += Math.sign(dx || 1) * (5 + tier * 2) * k;
            z.stun = Math.max(z.stun, 0.22 + tier * 0.03);
            // damage numbers only on the big ones, so they don't pile up
            if (z.type.size >= 1.8 && state === 'play') floatText(z.x + rand(-14, 14), z.y - ZOMBIE_H * z.type.size * depthOf(z.y) - 4, `-${fmt(Math.round(dmg))}`, '#ffdd59', 16);
        }
    }
    explosionFx(x, y, R, tier, opts);
    if (!opts.noDecal) scorch(x, R);
    addShake(Math.min(24, (4 + tier * 2) * (opts.small ? 0.35 : 1)));
    if (!opts.small && tier >= 3) hitstop = Math.max(hitstop, Math.min(0.11, 0.025 + tier * 0.008));
    if (!opts.small && tier >= 6) { flashA = Math.max(flashA, 0.1 + (tier - 6) * 0.06); flashColor = '255,240,210'; }
    if (opts.nuke) { flashA = 0.85; flashColor = '255,255,240'; addShake(30); mushroom(x); }
    Sound.boom(opts.small ? Math.max(0, tier - 2) : tier);
    Haptics.buzz(opts.small ? 10 : 18 + tier * 6, tier >= 6);
    if (killed >= 2 && state === 'play') multiKill(x, killed, tier);
}

const KILL_WORDS = ['', '', 'DOUBLE KILL!', 'TRIPLE KILL!', 'QUAD KILL!', 'MULTI KILL!', 'MULTI KILL!', 'MEGA KILL!', 'MEGA KILL!'];
function multiKill(x, n, tier) {
    const word = n >= 15 ? 'ZOMBIEGEDDON!' : n >= 11 ? 'MONSTER KILL!' : n >= 9 ? 'ULTRA KILL!' : KILL_WORDS[n];
    const bonus = (n - 1) * 2;
    score += n * n * 5;
    const fx = clamp(x, 90, W - 90);
    floatText(fx, L.groundY - 36, word, n >= 7 ? '#ff4d6d' : n >= 4 ? '#ff9f1a' : '#ffd32a', Math.min(38, 22 + n * 1.6), 1.5, true);
    floatText(fx, L.groundY - 4, `x${n}  +${bonus}`, '#ffe066', 17, 1.3, false, true);
    flyCoins(fx + 30, L.groundY - 4, bonus, 3);
    Sound.multi(n);
}

function hurtZombie(z, dmg, src) {
    if (z.dead) return false;
    z.hp -= dmg;
    // a blast flashes it white; a bullet only gives it a quick blink
    if (src.kind === 'shot') z.flash = Math.max(z.flash, 0.045);
    else if (src.kind !== 'fire') z.flash = 0.12;
    if (z.hp <= 0) { killZombie(z, src); return true; }
    return false;
}

function killZombie(z, src = {}) {
    z.dead = true; z.deadT = 0; z.ay = 0; z.rot = 0; z.landed = false; z.landT = 0;
    const d = depthOf(z.y), s = z.type.size * d, h = ZOMBIE_H * s;
    if (state === 'play') { kills++; score += z.type.pts; }
    const dir = src.x !== undefined ? (Math.sign(z.x - src.x) || 1) : 1;
    if (src.kind === 'blast') {
        const pw = (src.power || 1) / Math.sqrt(z.type.size);
        z.vx = dir * rand(80, 200) * pw; z.vup = rand(280, 520) * pw; z.vr = dir * rand(4, 11) * (0.5 + pw * 0.5);
    } else if (src.kind === 'fire') {
        z.vx = 0; z.vup = 60; z.vr = 1.4; z.charred = true;
    } else if (src.kind === 'toxic') {
        z.vx = dir * rand(40, 100); z.vup = rand(150, 260); z.vr = dir * rand(2, 5);
    } else {   // shot from the base: falls over backwards
        z.vx = rand(20, 60); z.vup = rand(90, 150); z.vr = rand(2, 4);
    }
    // goo
    for (let i = 0; i < 8 + Math.round(z.type.size * 6); i++) {
        const a = rand(-Math.PI, 0);
        fieldParts.push({ kind: 'goo', x: z.x + rand(-6, 6) * s, y: z.y - h * rand(0.3, 0.7), vx: Math.cos(a) * rand(40, 200) + dir * 40, vy: Math.sin(a) * rand(80, 300), g: 900, drag: 0.4, life: 2, t: 0, size: rand(1.8, 3.6) * d, floor: z.y + rand(-6, 6), color: z.kind === 'ghoul' ? '#8ff3ff' : pick(['#7ed957', '#5fb83a', '#9be86b']) });
    }
    if (state === 'play') { Sound.splat(); flyCoins(z.x, z.y - h * 0.5, coinsFor(z.type), 0); }
    if (z.type.bursts) timers.push({ t: 0.12, fn: () => toxicBurst(z.x, z.y) });
    if (z === boss) {
        boss = null;
        slowT = 0.9; flashA = 0.35; flashColor = '255,255,220'; addShake(14);
        floatText(clamp(z.x, 110, W - 110), L.groundY - 60, 'KING DOWN!', '#ffd32a', 34, 1.8, true);
        explosionFx(z.x, z.y - h * 0.4, 70, 6, { noDecal: true });
    }
    // the last zombie of the level goes down in slow motion
    if (state === 'play' && waveState === 'done' && !zombies.some(o => !o.dead)) slowT = Math.max(slowT, 0.8);
}

// A dying Bloater bursts and hurts the zombies around it (they can chain)
function toxicBurst(x, y) {
    const R = 78, dmg = 12 * levelHpMul(level);
    for (let i = 0; i < 18; i++) { const a = rand(0, Math.PI * 2), sp = rand(40, 170); fieldParts.push({ kind: 'smoke', x: x + rand(-10, 10), y: y - rand(10, 40), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 30, g: -10, drag: 2.2, life: rand(0.8, 1.4), t: 0, size: rand(14, 24), grow: 1.3, alpha: 0.6, tint: 'toxic' }); }
    lights.push({ x, y: y - 30, r: 150, a: 0.5, t: 0, life: 0.4, color: 'green' });
    paintDecal(() => { ctx.fillStyle = 'rgba(110, 190, 50, 0.35)'; ellipse(x, y + 4, 46, 13); ctx.fill(); });
    Sound.toxic(); addShake(4);
    let killed = 0;
    for (const z of zombies) if (!z.dead && Math.abs(z.x - x) < R + 10 * z.type.size && hurtZombie(z, dmg, { kind: 'toxic', x })) killed++;
    if (killed >= 2 && state === 'play') multiKill(x, killed, 3);
}

function hitBase(z) {
    if (state !== 'play') return;
    baseHP = Math.max(0, baseHP - z.type.dmg);
    baseFlash = 0.22; hurtA = Math.min(0.7, hurtA + 0.35);
    addShake(3 + z.type.dmg * 0.7);
    Sound.baseHit(); Haptics.buzz(30);
    floatText(L.stopX - 30 + rand(-10, 10), L.baseBottom - 74, `-${z.type.dmg}`, '#ff4757', 22);
    for (let i = 0; i < 6; i++) fieldParts.push({ kind: 'debris', x: L.stopX - 14, y: z.y - 24, vx: rand(-160, -40), vy: rand(-260, -80), g: 1000, drag: 0.4, life: rand(0.6, 1), t: 0, size: rand(2, 4), rot: rand(0, 6), vr: rand(-10, 10), floor: z.y + rand(-4, 8), color: pick(['#a08b6b', '#7a6a50', '#c8a96e']) });
    if (baseHP <= 0) baseFalls();
}

function soldierShoot(s, target) {
    s.recoil = 1;
    const st = stats(), shot = SHOTS[s.look || 0], h = SOLDIER_H * depthOf(s.y);
    bullets.push({ x: s.x + h * shot.tip, y: s.y - h * (shot.tipY || 0.68), target, dmg: st.soldierDmg, look: s.look || 0, dy: rand(-6, 6), spin: 0, angle: 0 });
    Sound.shot(s.look || 0);
}

function updateSoldiers(dt) {
    const rate = stats().fireRate;
    for (const s of soldiers) {
        s.recoil = Math.max(0, s.recoil - dt * 8);
        s.cd -= dt;
        if (s.cd > 0 || (state !== 'play' && state !== 'title')) continue;
        let target = null;
        for (const z of zombies) if (!z.dead && z.x < s.x + SOLDIER_RANGE && z.x < W - 12 && (!target || z.x < target.x)) target = z;
        if (target) { soldierShoot(s, target); s.cd = 1.0 / rate * rand(0.85, 1.15); }
    }
}

function updateBullets(dt) {
    for (const b of bullets) {
        const z = b.target, d0 = depthOf(z.y);
        const tx = z.x, ty = z.y - ZOMBIE_H * z.type.size * d0 * 0.55 + b.dy;
        const shot = SHOTS[b.look];
        const d = Math.hypot(tx - b.x, ty - b.y), step = shot.speed * dt;
        b.angle = Math.atan2(ty - b.y, tx - b.x);
        if (shot.spin) b.spin += dt * 14;
        if (shot.smoke && Math.random() < 0.5) fieldParts.push({ kind: 'smoke', light: true, x: b.x, y: b.y, vx: 0, vy: -8, g: 0, drag: 1, life: 0.4, t: 0, size: 3, grow: 1, alpha: 0.5 });
        if (z.dead || d <= step) {
            b.done = true;
            if (!z.dead) {
                const dmg = b.dmg * (1 - (z.type.armor || 0));
                for (let i = 0; i < 2; i++) fieldParts.push({ kind: 'goo', x: tx, y: ty, vx: rand(20, 120), vy: rand(-120, -20), g: 800, drag: 0.5, life: 1, t: 0, size: rand(1.2, 2.2), floor: z.y + rand(-4, 4), color: '#6fcf47' });
                fieldParts.push({ kind: 'spark', x: tx, y: ty, vx: rand(-60, 60), vy: rand(-100, 0), g: 300, drag: 2, life: 0.15, t: 0, size: 1.5 });
                hurtZombie(z, dmg, { kind: 'shot', x: b.x });
            }
        } else { b.x += (tx - b.x) / d * step; b.y += (ty - b.y) / d * step; }
    }
    bullets = bullets.filter(b => !b.done);
}

function updateZombies(dt) {
    const screamers = zombies.filter(z => !z.dead && z.type.screams);
    for (const z of zombies) {
        if (z.dead) { updateCorpse(z, dt); continue; }
        z.flash = Math.max(0, z.flash - dt);
        z.lunge = Math.max(0, z.lunge - dt * 3.5);
        z.burn = Math.max(0, z.burn - dt);
        z.targeted = false;
        if (z.type.screams) {
            z.screamT -= dt;
            if (z.screamT <= 0) { z.screamT = 1.6; fieldParts.push({ kind: 'wave', x: z.x - 10, y: z.y - ZOMBIE_H * z.type.size * depthOf(z.y) * 0.85, vx: 0, vy: 0, g: 0, drag: 0, life: 0.7, t: 0, size: 60 }); }
        }
        if (z.stun > 0) { z.stun -= dt; continue; }
        let sp = z.type.speed * z.speedMul;
        if (screamers.length && !z.type.screams && screamers.some(s => Math.abs(s.x - z.x) < 90)) sp *= 1.35;
        if (z.x > z.stopX) {
            z.x = Math.max(z.stopX, z.x - sp * dt);
            z.walk += dt * (4 + sp * 0.14);
            z.attacking = false;
        } else {
            z.attacking = true;
            z.attackT -= dt;
            if (z.attackT <= 0) { z.attackT = 1.25; z.lunge = 1; hitBase(z); }
        }
    }
    zombies = zombies.filter(z => !z.gone);
}

// A dead zombie flies (ragdoll), bounces once, lies there and fades
function updateCorpse(z, dt) {
    z.deadT += dt;
    z.flash = Math.max(0, z.flash - dt);
    if (!z.landed) {
        z.vup -= 1500 * dt; z.ay += z.vup * dt; z.x += z.vx * dt; z.rot += z.vr * dt;
        if (z.ay <= 0 && z.vup < 0) {
            z.ay = 0;
            if (!z.bounced && z.vup < -220) {
                z.bounced = true; z.vup = -z.vup * 0.28; z.vx *= 0.45; z.vr *= 0.4;
                gooSplat(z.x, z.y, z.type.size);
                for (let i = 0; i < 4; i++) fieldParts.push({ kind: 'smoke', dust: true, x: z.x + rand(-10, 10), y: z.y, vx: rand(-40, 40), vy: rand(-20, 0), g: 0, drag: 3, life: 0.6, t: 0, size: 8 * z.type.size, grow: 1.4, alpha: 0.4 });
            } else { z.landed = true; z.landT = 0; }
        }
    } else {
        z.landT += dt;
        // settle lying on its side
        const flat = Math.round((z.rot - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
        z.rot = lerp(z.rot, flat, Math.min(1, dt * 8));
        if (z.landT > 0.9) z.gone = true;
    }
    if (z.deadT > 5) z.gone = true;
}

function updateFires(dt) {
    for (const f of fires) {
        f.t += dt;
        for (const z of zombies) if (!z.dead && Math.abs(z.x - f.x) < f.w / 2) { z.burn = 0.5; hurtZombie(z, f.dps * dt, { kind: 'fire', x: f.x }); }
        const fade = Math.min(1, (f.life - f.t) / 0.8);
        for (let i = 0; i < Math.round(f.w / 14 * fade); i++) if (Math.random() < dt * 5) {
            fieldParts.push({ kind: 'fire', x: f.x + rand(-f.w / 2, f.w / 2), y: L.impactY + rand(-34, 34), vx: rand(-10, 10), vy: rand(-90, -40), g: -60, drag: 1, life: rand(0.35, 0.7), t: 0, size: rand(9, 18), flame: true });
        }
    }
    fires = fires.filter(f => f.t < f.life);
}

function updateVortexes(dt) {
    for (const v of vortexes) {
        v.t += dt;
        const k = Math.min(1, v.t / 0.4);
        for (const z of zombies) {
            if (z.dead) continue;
            const dx = v.x - z.x, ad = Math.abs(dx);
            if (ad > 270) continue;
            z.x += Math.sign(dx) * Math.min(ad, (120 + 260 * (1 - ad / 270)) * k * dt);
            z.y = lerp(z.y, L.impactY, dt * 1.5 * k);
            z.stun = 0.1;
        }
        for (let i = 0; i < 3; i++) {
            const a = rand(0, Math.PI * 2), r = rand(90, 170);
            fieldParts.push({ kind: 'swirl', cx: v.x, cy: L.impactY - 34, a, r, x: v.x, y: L.impactY, vx: 0, vy: 0, g: 0, drag: 0, life: rand(0.5, 0.8), t: 0, size: rand(1.5, 3) });
        }
        if (v.t >= v.life) {
            v.done = true;
            explode(v.x, 11, { scale: 1.05, color: 'purple' });
        }
    }
    vortexes = vortexes.filter(v => !v.done);
}

function updateTimers(dt) {
    const due = [];
    for (const t of timers) { t.t -= dt; if (t.t <= 0) due.push(t); }
    if (!due.length) return;
    timers = timers.filter(t => t.t > 0);
    due.forEach(t => t.fn());
}

// coins pop out, bounce, then fly up to the coin counter
function flyCoins(x, y, amount, delayExtra) {
    if (amount <= 0) return;
    if (state === 'play') coinsThisLevel += amount;
    const pieces = Math.min(5, Math.max(1, Math.round(amount / 3)));
    const each = Math.floor(amount / pieces);
    for (let i = 0; i < pieces; i++) {
        const v = i === pieces - 1 ? amount - each * (pieces - 1) : each;
        coins.push({ x, y, vx: rand(-80, 80), vy: rand(-280, -160), floor: Math.min(y + rand(10, 30), L.battleBottom - 6), t: 0, v, delay: rand(0.35, 0.55) + i * 0.04 + delayExtra * 0.1, fly: false });
    }
}
const COIN_HUD = { x: 284, y: 28 };
function updateCoins(rdt) {
    for (const c of coins) {
        c.t += rdt;
        if (!c.fly) {
            c.vy += 900 * rdt; c.x += c.vx * rdt; c.y += c.vy * rdt;
            if (c.y > c.floor && c.vy > 0) { c.y = c.floor; c.vy *= -0.4; c.vx *= 0.6; }
            if (c.t >= c.delay) { c.fly = true; c.ft = 0; c.fx = c.x; c.fy = c.y; }
        } else {
            c.ft += rdt;
            const k = Math.min(1, c.ft / 0.5), e = easeIn(k);
            c.x = lerp(c.fx, COIN_HUD.x, e) + Math.sin(k * Math.PI) * 30;
            c.y = lerp(c.fy, COIN_HUD.y, e);
            if (k >= 1 && !c.done) { c.done = true; save.coins += c.v; hudCoinBump = 1; Sound.coin(); }
        }
    }
    if (coins.some(c => c.done)) { coins = coins.filter(c => !c.done); writeSave(); }
}

// Title screen: a little show with zombies and bombs dropped by the plane
function updateAttract(dt) {
    attractSpawnT -= dt;
    if (attractSpawnT <= 0 && zombies.filter(z => !z.dead).length < 12) {
        attractSpawnT = rand(0.5, 1.3);
        const kinds = Object.values(ZOMBIES).filter(t => !t.boss && t.unlock <= Math.max(3, save.level)).map(t => t.kind);
        spawnZombie(pick(kinds), W + 30, rand(L.laneTop, L.laneBottom));
    }
    attractT -= dt;
    if (attractT <= 0) {
        attractT = rand(1.4, 2.4);
        const alive = zombies.filter(z => !z.dead && z.x < W - 20 && z.x > 140);
        if (alive.length) {
            let best = alive[0], bestN = 0;
            for (const a of alive) { const n = alive.filter(o => Math.abs(o.x - a.x) < 50).length; if (n > bestN) { bestN = n; best = a; } }
            const tier = randInt(1, Math.max(4, Math.min(10, save.bestTier)));
            const fromPlane = plane.wait <= 0 && plane.x > 0 && plane.x < W;
            throwBomb(tier, fromPlane ? plane.x : best.x + rand(-40, 40), fromPlane ? plane.y + 12 : L.battleTop - 20, best.x - 12, { T: 0.75 });
        }
    }
}

function updateAmbient(dt) {
    if (plane.wait > 0) { plane.wait -= dt; if (plane.wait <= 0) plane.x = -90; }
    else { plane.x += plane.vx * dt; if (plane.x > W + 90) plane.wait = rand(4, 9); }
    plane.y = L.planeY + Math.sin(time * 1.6) * 5;
    for (const c of clouds) { c.x += c.v * dt; if (c.x > W + 90) c.x = -90; }
}

// ---------- EFFECTS ----------
function addShake(m) { shakeMag = Math.min(30, Math.max(shakeMag, m)); }
function floatText(x, y, str, color, size, life = 1.2, big = false, rise = false) { floats.push({ x, y, str, color, size, t: 0, life, big, rise }); }

function explosionFx(x, y, R, tier, opts = {}) {
    const n = opts.small ? 0.35 : 1, P = fieldParts;
    const purple = opts.color === 'purple';
    lights.push({ x, y: y - R * 0.3, r: Math.min(330, R * 2.4 + 60), a: Math.min(0.6, 0.3 + tier * 0.04), t: 0, life: 0.3 + tier * 0.025, color: purple ? 'purple' : 'orange' });
    explosions.push({ x, y, R, tier, t: 0, life: 0.45 + tier * 0.012, purple });
    const nf = Math.round((7 + tier * 3) * n);
    for (let i = 0; i < nf; i++) {
        const a = rand(Math.PI * 1.05, Math.PI * 1.95), sp = rand(0.15, 1) * R * 2.4;
        P.push({ kind: 'fire', x: x + rand(-R, R) * 0.3, y: y - rand(0, R * 0.35), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - R * 0.5, g: -R * 0.7, drag: 4, life: rand(0.32, 0.65) + tier * 0.02, t: 0, size: rand(0.32, 0.6) * R + 6, purple });
    }
    const ns = Math.round((4 + tier * 1.8) * n);
    for (let i = 0; i < ns; i++) {
        P.push({ kind: 'smoke', tint: i % 3 === 0 ? 'smokeWarm' : null, x: x + rand(-R, R) * 0.5, y: y - rand(0, R * 0.6), vx: rand(-40, 40), vy: -rand(20, 60) - R * 0.3, g: -12, drag: 1.4, life: rand(0.9, 1.6) + tier * 0.06, t: -rand(0, 0.15), size: rand(0.28, 0.45) * R + 8, grow: 1.1, alpha: 0.5 });
    }
    const nd = Math.round((8 + tier * 3) * n * (opts.geyser ? 2.2 : 1));
    for (let i = 0; i < nd; i++) {
        const a = opts.geyser ? rand(-Math.PI * 0.62, -Math.PI * 0.38) : rand(-Math.PI * 0.95, -Math.PI * 0.05);
        const sp = rand(200, 380 + tier * 30) * (opts.geyser ? 1.5 : 1);
        P.push({ kind: 'debris', x: x + rand(-8, 8), y: y - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1100, drag: 0.3, life: rand(0.9, 1.5), t: 0, size: rand(2, 4.5) + tier * 0.25, rot: rand(0, 6), vr: rand(-12, 12), floor: y + rand(-34, 36), color: pick(['#5a4030', '#6d5038', '#3d2a1d', '#7a6a5a']) });
    }
    const nk = Math.round((10 + tier * 3) * n);
    for (let i = 0; i < nk; i++) {
        const a = rand(-Math.PI, 0), sp = rand(250, 620 + tier * 40);
        P.push({ kind: 'spark', x, y: y - R * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 700, drag: 1.6, life: rand(0.25, 0.6), t: 0, size: rand(1.2, 2.6), purple });
    }
    for (let i = 0; i < Math.round((4 + tier * 2) * n); i++) {
        P.push({ kind: 'ember', x: x + rand(-R, R) * 0.6, y: y - rand(0, R), vx: rand(-30, 30), vy: -rand(30, 90), g: -15, drag: 0.8, life: rand(1, 2.2), t: 0, size: rand(1, 2.2), purple });
    }
    for (let i = 0; i < Math.round((8 + tier) * n); i++) {
        const dir = i % 2 ? 1 : -1;
        P.push({ kind: 'smoke', dust: true, x: x + dir * rand(0, R * 0.4), y: y + rand(-8, 14), vx: dir * rand(R * 1.4, R * 3), vy: rand(-20, 0), g: 0, drag: 3, life: rand(0.6, 1.1), t: 0, size: rand(10, 18) + tier, grow: 1.5, alpha: 0.5 });
    }
}

// The Mega Nuke's mushroom cloud: a column of smoke rising into a wide, glowing cap
function mushroom(x) {
    const y = L.impactY, capY = Math.max(L.battleTop + 50, y - 190);
    for (let i = 0; i < 22; i++) {
        const f = i / 22;
        fieldParts.push({ kind: 'smoke', tint: i % 2 ? 'smokeWarm' : 'smokeLight', x: x + rand(-10, 10), y: lerp(y - 10, capY + 30, f), vx: rand(-6, 6), vy: -rand(10, 25), g: 0, drag: 1, life: rand(2, 2.6), t: -0.15 - f * 0.3, size: rand(12, 18), grow: 0.8, alpha: 0.75 });
    }
    for (let i = 0; i < 28; i++) {
        const a = rand(0, Math.PI * 2), r = rand(10, 60);
        fieldParts.push({ kind: 'smoke', tint: i % 3 ? 'smokeWarm' : 'smokeLight', x: x + Math.cos(a) * r, y: capY + Math.sin(a) * r * 0.35, vx: Math.cos(a) * rand(20, 60), vy: -rand(5, 20), g: 0, drag: 1, life: rand(2.1, 2.8), t: -0.35 - rand(0, 0.25), size: rand(24, 34), grow: 1, alpha: 0.75 });
    }
    for (let i = 0; i < 26; i++) fieldParts.push({ kind: 'fire', x: x + rand(-50, 50), y: capY + rand(-20, 30), vx: rand(-40, 40), vy: rand(-30, 10), g: 0, drag: 1.5, life: rand(0.7, 1.2), t: -rand(0.3, 0.7), size: rand(22, 40) });
}

function dirtBurst(x, n) {
    for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI * 0.85, -Math.PI * 0.15), sp = rand(120, 300);
        fieldParts.push({ kind: 'debris', x, y: L.impactY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1100, drag: 0.3, life: rand(0.6, 1), t: 0, size: rand(2, 4), rot: rand(0, 6), vr: rand(-12, 12), floor: L.impactY + rand(-20, 20), color: pick(['#5a4030', '#6d5038', '#3d2a1d']) });
    }
}

// Scorch marks and goo stay on the ground until the level ends
function scorch(x, R) {
    paintDecal(() => {
        const y = L.impactY + 8, rx = Math.min(130, R * 0.85), ry = rx * 0.3;
        ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, 'rgba(18, 10, 6, 0.6)'); g.addColorStop(0.45, 'rgba(28, 18, 10, 0.42)'); g.addColorStop(1, 'rgba(28, 18, 10, 0)');
        ctx.fillStyle = g; circle(0, 0, rx); ctx.fill();
        ctx.strokeStyle = 'rgba(20, 12, 8, 0.25)'; ctx.lineWidth = 2;
        for (let i = 0; i < 10; i++) { const a = rand(0, Math.PI * 2); ctx.beginPath(); ctx.moveTo(Math.cos(a) * rx * 0.3, Math.sin(a) * rx * 0.3); ctx.lineTo(Math.cos(a) * rx * rand(0.7, 1.05), Math.sin(a) * rx * rand(0.7, 1.05)); ctx.stroke(); }
        ctx.fillStyle = 'rgba(10, 6, 4, 0.5)'; circle(0, 0, rx * 0.28); ctx.fill();
        ctx.restore();
    });
}
function gooSplat(x, y, size) {
    paintDecal(() => {
        ctx.fillStyle = 'rgba(95, 170, 50, 0.45)';
        for (let i = 0; i < 4; i++) { ellipse(x + rand(-12, 12) * size, y + rand(-2, 3), rand(5, 11) * size, rand(1.6, 3.2) * size); ctx.fill(); }
    });
}
function gooDecal(x, y, s) {
    paintDecal(() => { ctx.fillStyle = 'rgba(100, 180, 55, 0.5)'; ellipse(x, y, s * 1.8, s * 0.6); ctx.fill(); });
}

function updatePart(p, dt) {
    p.t += dt;
    if (p.t < 0) return;
    if (p.kind === 'swirl') {   // spirals into the black hole
        const k = p.t / p.life;
        p.a += dt * (5 + k * 10);
        const r = p.r * (1 - k);
        p.x = p.cx + Math.cos(p.a) * r; p.y = p.cy + Math.sin(p.a) * r * 0.45;
        return;
    }
    p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.vr) p.rot += p.vr * dt;
    if (p.floor !== undefined && p.y > p.floor && p.vy > 0) {
        if (p.kind === 'goo') { gooDecal(p.x, p.floor, p.size); p.t = p.life; return; }
        p.y = p.floor; p.vy *= -0.35; p.vx *= 0.6; p.vr = (p.vr || 0) * 0.5;
        if (Math.abs(p.vy) < 40) { p.vy = 0; p.g = 0; p.vx *= 0.5; p.drag = 4; }
    }
}

function drawPart(p) {
    if (p.t < 0) return;
    const k = p.t / p.life;
    switch (p.kind) {
        case 'fire': {
            const s = p.size * (0.55 + 0.75 * easeOut(k * 2.2)) * (1 - k * 0.45);
            const spr = p.purple ? (k < 0.25 ? 'white' : 'purple') : k < 0.16 ? 'white' : k < 0.38 ? 'yellow' : k < 0.68 ? 'orange' : 'red';
            ctx.globalCompositeOperation = 'lighter';
            glow(spr, p.x, p.y, s, (1 - k) * (p.flame ? 0.7 : 0.95));
            ctx.globalCompositeOperation = 'source-over';
            break;
        }
        case 'smoke': {
            const s = p.size * (0.7 + k * (p.grow || 1));
            const a = (p.alpha || 0.6) * (1 - k) * Math.min(1, k * 8);
            glow(p.tint || (p.dust ? 'dust' : p.light ? 'smokeLight' : 'smoke'), p.x, p.y, s, a);
            break;
        }
        case 'spark': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = p.purple ? `rgba(230, 160, 255, ${1 - k})` : `rgba(255, ${Math.round(240 - k * 90)}, ${Math.round(160 - k * 120)}, ${1 - k})`;
            ctx.lineWidth = p.size; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
            break;
        }
        case 'debris': {
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
            ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
            ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size * 0.38, p.size, p.size * 0.76);
            ctx.restore();
            break;
        }
        case 'goo':
            ctx.fillStyle = p.color; circle(p.x, p.y, p.size); ctx.fill();
            break;
        case 'ember': {
            ctx.globalCompositeOperation = 'lighter';
            const fl = 0.6 + 0.4 * Math.sin(p.t * 30 + p.x);
            glow(p.purple ? 'purple' : 'orange', p.x, p.y, p.size * 3, (1 - k) * fl);
            ctx.globalCompositeOperation = 'source-over';
            break;
        }
        case 'sparkle': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = p.color || '#fff'; ctx.globalAlpha = 1 - k;
            const s = p.size * (1 - k * 0.5);
            ctx.beginPath(); ctx.moveTo(p.x, p.y - s * 2); ctx.lineTo(p.x + s * 0.5, p.y); ctx.lineTo(p.x, p.y + s * 2); ctx.lineTo(p.x - s * 0.5, p.y); ctx.fill();
            ctx.beginPath(); ctx.moveTo(p.x - s * 2, p.y); ctx.lineTo(p.x, p.y + s * 0.5); ctx.lineTo(p.x + s * 2, p.y); ctx.lineTo(p.x, p.y - s * 0.5); ctx.fill();
            ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
            break;
        }
        case 'ring':
            ctx.strokeStyle = `rgba(${p.color}, ${1 - k})`; ctx.lineWidth = 4 * (1 - k) + 1;
            circle(p.x, p.y, p.size * (0.5 + easeOut(k) * 0.7)); ctx.stroke();
            break;
        case 'flash':
            ctx.globalCompositeOperation = 'lighter';
            glow('white', p.x, p.y, p.size * (0.8 + k * 0.6), (1 - k) * 0.8);
            ctx.globalCompositeOperation = 'source-over';
            break;
        case 'wave':   // a Screamer's scream
            ctx.strokeStyle = `rgba(214, 162, 232, ${0.6 * (1 - k)})`; ctx.lineWidth = 2;
            for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.15 + k * 0.6) + i * 8, Math.PI * 0.7, Math.PI * 1.3); ctx.stroke(); }
            break;
        case 'swirl':
            ctx.globalCompositeOperation = 'lighter';
            glow('purple', p.x, p.y, p.size * 3, 1 - k * 0.5);
            ctx.globalCompositeOperation = 'source-over';
            break;
    }
}

function updateEffects(dt, rdt) {
    for (const p of fieldParts) updatePart(p, dt);
    for (const p of topParts) updatePart(p, rdt);
    fieldParts = fieldParts.filter(p => p.t < p.life);
    topParts = topParts.filter(p => p.t < p.life);
    if (fieldParts.length > 1100) fieldParts.splice(0, fieldParts.length - 1100);
    for (const e of explosions) e.t += dt;
    explosions = explosions.filter(e => e.t < e.life);
    for (const l of lights) l.t += dt;
    lights = lights.filter(l => l.t < l.life);
    for (const f of floats) f.t += rdt;
    floats = floats.filter(f => f.t < f.life);
    updateCoins(rdt);
    if (banner) { banner.t += rdt; if (banner.t > banner.dur) banner = null; }
    else if (popup) { popup.t += rdt; if (popup.t > popup.dur) popup = null; }   // a new-bomb card waits for the banner
    flashA = Math.max(0, flashA - rdt * 2.4);
    hurtA = Math.max(0, hurtA - rdt * 1.6);
    baseFlash = Math.max(0, baseFlash - rdt);
    hudCoinBump = Math.max(0, hudCoinBump - rdt * 4);
    hpShown += (baseHP - hpShown) * Math.min(1, rdt * 5);
    shakeMag *= Math.exp(-rdt * 8);
    if (shakeMag < 0.05) shakeMag = 0;
    mergeComboT -= dt;
    for (const c of SHOP_CARDS()) if (c.ref.bump) c.ref.bump = Math.max(0, c.ref.bump - rdt * 3);
}

// zombies inside the blast you're aiming, and how many it would kill
function updateAim() {
    predictedKills = 0;
    if (!grabbed || !grabOverField(grabbed) || state !== 'play') return;
    const tx = clamp(grabbed.x, 24, W - 8), R = blastRadius(grabbed.tier), dmg = blastDamage(grabbed.tier);
    for (const z of zombies) {
        if (z.dead || Math.abs(z.x - tx) > R + 12 * z.type.size) continue;
        z.targeted = true;
        if (z.hp <= dmg) predictedKills++;
    }
}

// ---------- UPDATE ----------
let physicsAcc = 0;
function update(dt, rdt) {
    stateT += rdt;
    if (state === 'revive') {   // the field holds still while the player decides; the offer runs out
        reviveT -= rdt;
        updateEffects(0, rdt);
        if (reviveT <= 0) baseDestroyed();
        return;
    }
    updateAmbient(dt);
    if (state === 'play' || state === 'cleared' || state === 'over') {
        physicsAcc = Math.min(physicsAcc + dt, 0.1);
        while (physicsAcc >= 1 / 60) { Engine.update(engine, 1000 / 60); physicsAcc -= 1 / 60; }
    }
    if (state === 'play') { updateWaves(dt); updateDropper(dt); updateTutorial(rdt); }
    if (state === 'title') updateAttract(dt);
    if (state !== 'shop' && state !== 'won') {
        updateSoldiers(dt); updateZombies(dt); updateBullets(dt); updateThrown(dt);
        updateTimers(dt); updateFires(dt); updateVortexes(dt);
    } else {
        for (const s of soldiers) s.recoil = Math.max(0, s.recoil - dt * 8);
    }
    if (grabbed) updateGrabbed(rdt);
    updateAim();
    updateEffects(dt, rdt);
    if (state === 'play' && waveState === 'done' && !zombies.some(z => !z.dead) && !thrown.length && !vortexes.length && !timers.length) levelCleared();
    if (state === 'cleared') updateCleared(rdt);
}

// ---------- DRAW: BATTLEFIELD ----------
function drawBattlefield() {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, L.battleTop, W, L.battleBottom - L.battleTop); ctx.clip();
    if (layers.sky) ctx.drawImage(layers.sky.c, 0, 0, W, layers.sky.h);
    else drawDrawnSky();
    drawClouds();
    drawPlane();
    ctx.drawImage(layers.ground.c, 0, layers.ground.top, W, layers.ground.h);
    ctx.drawImage(layers.decals.c, 0, layers.decals.top, W, layers.decals.h);
    drawFires();
    drawAimRing();
    drawBase();
    drawEntities();
    for (const b of thrown) drawThrown(b);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) { const k = l.t / l.life; glow(l.color, l.x, l.y, l.r, l.a * (1 - k) * (1 - k)); }
    ctx.globalCompositeOperation = 'source-over';
    // smoke and dirt first, the glowing stuff on top
    for (const p of fieldParts) if (!GLOWING[p.kind]) drawPart(p);
    for (const e of explosions) drawExplosion(e);
    for (const v of vortexes) drawVortex(v);
    for (const p of fieldParts) if (GLOWING[p.kind]) drawPart(p);
    for (const b of bullets) drawBullet(b);
    ctx.drawImage(layers.vignette.c, 0, L.battleTop, W, layers.vignette.h);
    drawIncoming();
    if (boss && !boss.dead && state === 'play') drawBossBar();
    ctx.restore();
    drawAimLabel();
}
const GLOWING = { fire: 1, spark: 1, ember: 1, flash: 1, swirl: 1, sparkle: 1 };

// The original sky, drawn in code (the third background)
function drawDrawnSky() {
    const top = L.battleTop, gy = L.groundY, hgt = gy - top;
    const sky = ctx.createLinearGradient(0, top, 0, gy);
    sky.addColorStop(0, '#2c1b4d'); sky.addColorStop(0.55, '#b33771'); sky.addColorStop(1, '#ff9f43');
    ctx.fillStyle = sky; ctx.fillRect(0, top, W, hgt + 2);
    for (const s of stars_) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(time * 2 + s.p)})`; circle(s.x, top + s.f * hgt, s.r); ctx.fill(); }
    const mx = 340, my = top + hgt * 0.3;
    glow('orange', mx, my, 80, 0.5);
    ctx.fillStyle = '#ffd8b0'; circle(mx, my, 24); ctx.fill();
    ctx.fillStyle = '#3d1f45';
    for (const b of skyline) {
        ctx.beginPath(); ctx.moveTo(b.x, gy); ctx.lineTo(b.x, gy - b.h);
        if (b.broken) { ctx.lineTo(b.x + b.w * 0.4, gy - b.h + 10); ctx.lineTo(b.x + b.w * 0.7, gy - b.h - 6); }
        ctx.lineTo(b.x + b.w, gy - b.h + (b.broken ? 14 : 0)); ctx.lineTo(b.x + b.w, gy); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 200, 80, 0.5)';
    for (const b of skyline) for (let wy = gy - b.h + 12; wy < gy - 8; wy += 14) if ((b.x * 7 + wy) % 5 < 1.2) ctx.fillRect(b.x + 5, wy, 4, 5);
    drawHorizonHaze();
}

function drawClouds() {
    const top = L.battleTop, hgt = L.groundY - top;
    for (const c of clouds) {
        const y = top + 20 + c.f * hgt * 0.6;
        ctx.fillStyle = 'rgba(255, 190, 220, 0.12)';
        ellipse(c.x, y, 40 * c.s, 11 * c.s); ctx.fill();
        ellipse(c.x + 20 * c.s, y - 7 * c.s, 26 * c.s, 10 * c.s); ctx.fill();
        ellipse(c.x - 18 * c.s, y - 3 * c.s, 18 * c.s, 8 * c.s); ctx.fill();
    }
}

function drawBase() {
    const st = stats(), img = baseImgs[st.baseStage];
    ctx.save();
    if (baseFlash > 0) ctx.translate(rand(-2, 2), rand(-1, 1));
    if (imgReady(img)) {
        const w = img.naturalWidth * BASE_ART_SCALE, h = img.naturalHeight * BASE_ART_SCALE;
        const x = -6, y = L.baseBottom - h;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(x + w * 0.5, L.baseBottom - 2, w * 0.55, 8); ctx.fill();
        ctx.drawImage(img, x, y, w, h);
        if (baseFlash > 0) { const s = silhouette(img, '#ff5a4a'); if (s) { ctx.globalAlpha = baseFlash / 0.22 * 0.55; ctx.drawImage(s, x, y, w, h); ctx.globalAlpha = 1; } }
        if (state === 'over') {   // burnt out
            const s = silhouette(img, '#1c1410');
            if (s) { ctx.globalAlpha = Math.min(0.75, stateT * 1.5); ctx.drawImage(s, x, y, w, h); ctx.globalAlpha = 1; }
            if (Math.random() < 0.3) fieldParts.push({ kind: 'smoke', x: x + w * rand(0.2, 0.8), y: y + h * rand(0.2, 0.6), vx: rand(-5, 5), vy: -rand(25, 50), g: -5, drag: 0.5, life: rand(1.4, 2.2), t: 0, size: rand(8, 14), grow: 1.6, alpha: 0.6 });
            if (Math.random() < 0.3) fieldParts.push({ kind: 'fire', flame: true, x: x + w * rand(0.25, 0.75), y: y + h * rand(0.35, 0.8), vx: 0, vy: -rand(30, 60), g: -40, drag: 1, life: rand(0.3, 0.6), t: 0, size: rand(8, 14) });
        }
        // smoke rises from a badly damaged base
        if (state === 'play' && baseHP / baseMax < 0.5 && Math.random() < 0.15) fieldParts.push({ kind: 'smoke', x: x + w * rand(0.3, 0.7), y: y + h * 0.3, vx: rand(-5, 5), vy: -rand(20, 40), g: -5, drag: 0.5, life: rand(1.2, 2), t: 0, size: rand(6, 10), grow: 1.5, alpha: 0.5 });
        if (state === 'play' && baseHP / baseMax < 0.25 && Math.random() < 0.25) fieldParts.push({ kind: 'fire', flame: true, x: x + w * rand(0.35, 0.65), y: y + h * rand(0.3, 0.6), vx: rand(-5, 5), vy: -rand(30, 60), g: -40, drag: 1, life: rand(0.3, 0.6), t: 0, size: rand(6, 11) });
    } else drawDrawnBase();
    ctx.restore();
}

// watchtower and sandbags, drawn if the base art can't load
function drawDrawnBase() {
    const gy = L.baseBottom;
    ctx.fillStyle = '#5d4037'; ctx.fillRect(18, gy - 86, 7, 86); ctx.fillRect(46, gy - 86, 7, 86);
    ctx.fillStyle = '#795548'; rrect(10, gy - 100, 52, 18, 3); ctx.fill();
    ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 2.5; ctx.beginPath();
    ctx.moveTo(21, gy - 80); ctx.lineTo(49, gy - 30); ctx.moveTo(49, gy - 80); ctx.lineTo(21, gy - 30); ctx.stroke();
    ctx.fillStyle = '#ddd'; ctx.fillRect(35, gy - 132, 2, 34);
    ctx.fillStyle = baseFlash > 0 ? '#ff4757' : '#2ed573';
    ctx.beginPath(); ctx.moveTo(37, gy - 132); ctx.lineTo(37 + 20 + Math.sin(time * 6) * 2, gy - 125); ctx.lineTo(37, gy - 118); ctx.fill();
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) {
        ctx.fillStyle = (i + row) % 2 ? '#c8a96e' : '#b8955a';
        ellipse(16 + i * 15 + row * 7, gy - 6 - row * 10, 9, 6); ctx.fill();
        ctx.strokeStyle = '#7d6236'; ctx.lineWidth = 1; ctx.stroke();
    }
}

function drawEntities() {
    // shadows first, all on the ground
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    for (const s of soldiers) { const d = depthOf(s.y); ellipse(s.x, s.y + 1, 13 * d, 4 * d); ctx.fill(); }
    for (const z of zombies) {
        const s = depthOf(z.y) * z.type.size;
        let k = 1;
        if (z.dead) k = clamp(1 - z.ay / 260, 0.25, 1) * (z.landed ? clamp(1 - z.landT / 0.9, 0, 1) : 1);
        ctx.globalAlpha = k; ellipse(z.x, z.y + 1, 15 * s * k, 4.5 * s * k); ctx.fill(); ctx.globalAlpha = 1;
    }
    for (const b of thrown) {   // where each bomb will land
        const k = clamp(b.t / b.T, 0, 1);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.15 + 0.3 * k})`; ellipse(b.x, b.ty + 4, b.r * (0.5 + k * 0.6), b.r * 0.25 * (0.5 + k * 0.6)); ctx.fill();
    }
    const list = [];
    for (const z of zombies) list.push({ y: z.y + (z.dead ? -0.5 : 0), z });
    for (const s of soldiers) list.push({ y: s.y, s });
    list.sort((a, b) => a.y - b.y);
    for (const e of list) e.z ? drawZombie(e.z) : drawSoldier(e.s);
}

function drawSoldier(s, fixedH) {
    const look = s.look || 0;
    const h = fixedH || SOLDIER_H * depthOf(s.y);
    ctx.save();
    ctx.translate(s.x - s.recoil * 2.5 * h / SOLDIER_H, s.y);
    const img = soldierImgs[look];
    if (imgReady(img)) {
        const w = h * img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, -w / 2, -h, w, h);
        const shot = SHOTS[look], flash = flashImgs[look];
        if (s.recoil > 0.4 && imgReady(flash)) {  // muzzle flash at the gun's muzzle
            const fw = shot.flash * h / 34, fh = fw * flash.naturalHeight / flash.naturalWidth;
            const mx = h * shot.tip, my = -h * (shot.tipY || 0.68);
            ctx.globalAlpha = Math.min(1, s.recoil * 1.5);
            ctx.globalCompositeOperation = 'lighter';
            glow('yellow', mx + 4, my, fw * 0.9, 0.35 * s.recoil);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(flash, shot.jet ? mx - 1 : mx - fw * 0.3, my - fh / 2, fw, fh);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        return;
    }
    const L2 = SOLDIER_LOOKS[look], k = h / 34;
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(L2.body, -0.45); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-3, 0); ctx.moveTo(0, -9); ctx.lineTo(3, 0); ctx.stroke();
    ctx.fillStyle = L2.body; rrect(-4, -20, 8, 12, 2); ctx.fill();
    ctx.fillStyle = '#f5c6a5'; circle(0, -24, 4); ctx.fill();
    ctx.fillStyle = L2.helmet; ctx.beginPath(); ctx.arc(0, -25, 5, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -25.5, 12, 1.8);
    ctx.save(); ctx.translate(2, -16);
    ctx.fillStyle = L2.gunColor; ctx.fillRect(-2, -1.5, L2.gun, 3);
    if (s.recoil > 0.6) { ctx.fillStyle = '#fff3a0'; circle(L2.gun, 0, 3 * s.recoil); ctx.fill(); }
    ctx.restore();
    ctx.restore();
}

function drawBullet(b) {
    const img = shotImgs[b.look], len = SHOTS[b.look].len;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle + b.spin);
    if (imgReady(img)) ctx.drawImage(img, -len, -len * img.naturalHeight / img.naturalWidth / 2, len, len * img.naturalHeight / img.naturalWidth);
    else { ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, 0); ctx.stroke(); }
    ctx.restore();
}

function drawPlane() {
    if (plane.wait > 0) return;
    const { x, y } = plane;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(time * 1.6 + 1) * 0.04);
    if (imgReady(planeImg)) {
        const w = 92, h = w * planeImg.naturalHeight / planeImg.naturalWidth;
        ctx.drawImage(planeImg, -w / 2, -h / 2, w, h);
        ctx.fillStyle = 'rgba(230, 230, 240, 0.35)';   // spinning propeller blur
        ellipse(w * 0.43, 0, 3, h * 0.45 * Math.abs(Math.sin(time * 40))); ctx.fill();
        ctx.restore();
        return;
    }
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.moveTo(-26, -3); ctx.lineTo(-40, -22); ctx.lineTo(-33, -22); ctx.lineTo(-18, -5); ctx.fill();
    ellipse(-30, 1, 10, 3.5); ctx.fill();
    const fg = ctx.createLinearGradient(0, -12, 0, 12);
    fg.addColorStop(0, '#ff7675'); fg.addColorStop(0.5, '#e84118'); fg.addColorStop(1, '#a5281b');
    ctx.fillStyle = fg; ellipse(0, 0, 36, 12); ctx.fill();
    ctx.strokeStyle = '#6d1a10'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd32a'; ctx.fillRect(-14, -2, 20, 4);
    ctx.fillStyle = '#74b9ff'; ellipse(10, -8, 9, 6); ctx.fill();
    ctx.fillStyle = '#ff6b6b'; ellipse(-2, 5, 20, 5); ctx.fill(); ctx.strokeStyle = '#6d1a10'; ctx.stroke();
    ctx.fillStyle = '#dfe6e9'; circle(35, 0, 5); ctx.fill();
    ctx.fillStyle = 'rgba(40,40,40,0.8)'; ellipse(39, 0, 2.5, 14 * Math.abs(Math.sin(time * 40))); ctx.fill();
    ctx.restore();
}

function drawZombie(z) {
    const t = z.type, d = depthOf(z.y), s = t.size * d, h = ZOMBIE_H * s;
    const img = zombieImgs[z.kind];
    const w = imgReady(img) ? h * img.naturalWidth / img.naturalHeight : h;
    ctx.save();
    if (z.dead) {
        // spins around the middle of its body; lying down, that middle is close to the ground
        ctx.globalAlpha = z.landed ? clamp(1 - (z.landT - 0.3) / 0.6, 0, 1) : 1;
        ctx.translate(z.x, z.y - z.ay - h * lerp(0.5, 0.24, Math.abs(Math.sin(z.rot))));
        ctx.rotate(z.rot);
        ctx.translate(0, h * 0.5);
    } else {
        const bob = z.attacking ? 0 : -Math.abs(Math.sin(z.walk)) * 2.6 * s;
        const rock = z.attacking ? -z.lunge * 0.22 : Math.sin(z.walk) * 0.07;
        ctx.translate(z.x - (z.attacking ? z.lunge * 7 * s : 0), z.y + bob);
        ctx.rotate(rock);
        if (z.stun > 0) ctx.rotate(0.12);
    }
    if (imgReady(img)) {
        ctx.drawImage(img, -w / 2, -h, w, h);
        const tint = (color, a) => { const sil = silhouette(img, color); if (sil && a > 0) { ctx.globalAlpha *= a; ctx.drawImage(sil, -w / 2, -h, w, h); ctx.globalAlpha /= a; } };
        if (z.charred) tint('#1a1210', 0.75);
        else if (z.burn > 0) tint('#ff7a1a', 0.35 + 0.15 * Math.sin(time * 30));
        if (z.targeted && !z.dead) tint('#ff3b30', 0.3 + 0.2 * Math.sin(time * 12));
        if (z.flash > 0) tint('#ffffff', z.flash / 0.12 * 0.9);
    } else {
        ctx.scale(h / 48, h / 48);
        drawZombieDrawn(z);
    }
    ctx.restore();
    if (!z.dead && z.burn > 0 && Math.random() < 0.3) fieldParts.push({ kind: 'fire', flame: true, x: z.x + rand(-w, w) * 0.25, y: z.y - h * rand(0.2, 0.8), vx: 0, vy: -50, g: -40, drag: 1, life: 0.35, t: 0, size: rand(5, 9) * s });
    if (!z.dead && z.hp < z.maxHp && !t.boss) {
        const bw = 24 * Math.max(1, s * 0.75), y = z.y - h - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; rrect(z.x - bw / 2 - 1.5, y - 1.5, bw + 3, 6, 3); ctx.fill();
        const f = Math.max(0, z.hp / z.maxHp);
        ctx.fillStyle = f > 0.5 ? '#7bed9f' : f > 0.25 ? '#ffd32a' : '#ff4757'; rrect(z.x - bw / 2, y, bw * f, 3, 1.5); ctx.fill();
    }
}

// Zombie drawn in code (if its art can't load), about 48 px tall with the feet at 0
function drawZombieDrawn(z) {
    const t = z.type, step = Math.sin(z.walk || 0);
    ctx.lineCap = 'round';
    ctx.strokeStyle = t.pants; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-4 + step * 4, 0); ctx.moveTo(0, -14); ctx.lineTo(4 - step * 4, 0); ctx.stroke();
    ctx.strokeStyle = shade(t.skin, -0.25); ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(1, -25); ctx.lineTo(-12, -21 - step * 1.5); ctx.stroke();
    ctx.fillStyle = t.shirt;
    if (t.look === 'fat') { ellipse(0, -21, 10, 10); ctx.fill(); } else { rrect(-6, -30, 12, 17, 3); ctx.fill(); }
    ctx.fillStyle = shade(t.shirt, -0.3);
    ctx.beginPath(); ctx.moveTo(-6, -15); ctx.lineTo(-3, -18); ctx.lineTo(0, -14); ctx.lineTo(3, -17); ctx.lineTo(6, -14); ctx.lineTo(6, -13); ctx.lineTo(-6, -13); ctx.fill();
    ctx.strokeStyle = t.skin; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(-1, -26); ctx.lineTo(-14, -24 + step * 1.5); ctx.stroke();
    ctx.fillStyle = t.skin; circle(-1, -36, 7.5); ctx.fill();
    ctx.strokeStyle = shade(t.skin, -0.4); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#1e272e'; circle(-4.5, -37, 2.1); ctx.fill(); circle(0, -37.5, 2.1); ctx.fill();
    ctx.fillStyle = '#ffe66d'; circle(-4.5, -37, 1.1); ctx.fill(); circle(0, -37.5, 1.1); ctx.fill();
    ctx.strokeStyle = '#1e272e'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-6, -32); ctx.lineTo(-3, -33); ctx.lineTo(-1, -31.5); ctx.stroke();
    switch (t.look) {
        case 'crown':
            ctx.fillStyle = '#f9ca24';
            ctx.beginPath(); ctx.moveTo(-7, -42); ctx.lineTo(-6, -48); ctx.lineTo(-3, -44); ctx.lineTo(-1, -50); ctx.lineTo(1, -44); ctx.lineTo(4, -48); ctx.lineTo(5, -42); ctx.fill(); break;
        case 'helmet':
            ctx.fillStyle = '#4b5d2a'; ctx.beginPath(); ctx.arc(-1, -38, 8.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-10, -38.5, 18, 2.5); break;
        case 'mohawk':
            ctx.fillStyle = '#ff3f34';
            for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-5 + i * 3, -42); ctx.lineTo(-3.5 + i * 3, -49 + (i % 2) * 2); ctx.lineTo(-2 + i * 3, -42); ctx.fill(); } break;
        case 'hood':
            ctx.fillStyle = '#341f97'; ctx.beginPath(); ctx.arc(0, -36, 9.5, Math.PI * 1.05, Math.PI * 2.15); ctx.lineTo(8, -28); ctx.lineTo(6, -33); ctx.arc(-1, -36, 7, 0, Math.PI, true); ctx.fill(); break;
        case 'horns':
            ctx.fillStyle = '#dfe4ea';
            ctx.beginPath(); ctx.moveTo(-7, -40); ctx.quadraticCurveTo(-13, -46, -9, -52); ctx.lineTo(-4, -42); ctx.fill();
            ctx.beginPath(); ctx.moveTo(4, -41); ctx.quadraticCurveTo(10, -47, 7, -53); ctx.lineTo(1, -43); ctx.fill(); break;
        case 'glow':
            glow('cyan', -2, -37, 10, 0.6); break;
        case 'armor':
            ctx.fillStyle = '#a4b0be'; rrect(-7, -30, 14, 9, 2); ctx.fill();
            ctx.fillStyle = '#747d8c'; ctx.beginPath(); ctx.arc(-1, -38, 8.5, Math.PI, 0); ctx.fill(); break;
    }
}

function drawThrown(b) {
    drawBomb(b.x, b.y, b.r, b.tier, b.rot);
    if (!b.small) {   // lit fuse
        ctx.globalCompositeOperation = 'lighter';
        glow('yellow', b.x + Math.sin(b.rot) * b.r, b.y - Math.cos(b.rot) * b.r * 1.05, 6 + Math.random() * 3, 0.9);
        ctx.globalCompositeOperation = 'source-over';
    }
}

function drawExplosion(e) {
    const k = e.t / e.life;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (e.t < 0.1) { const f = 1 - e.t / 0.1; glow('white', e.x, e.y - e.R * 0.3, e.R * (1.1 + (1 - f) * 0.7), f); }
    const fr = e.R * (0.6 + easeOut(e.t / 0.14) * 0.55) * (1 - k * 0.35);
    glow(e.purple ? 'purple' : 'yellow', e.x, e.y - e.R * 0.32, fr * 1.15, (1 - k) * 0.95);
    glow(e.purple ? 'purple' : 'orange', e.x, e.y - e.R * 0.38, fr * 1.6, (1 - k) * 0.7);
    ctx.restore();
    // shockwave along the ground, and a ring in the air for the big ones
    const sk = easeOut(e.t / 0.32), sa = 1 - Math.min(1, e.t / 0.32);
    if (sa > 0) {
        ctx.strokeStyle = e.purple ? `rgba(230, 180, 255, ${0.8 * sa})` : `rgba(255, 245, 220, ${0.8 * sa})`;
        ctx.lineWidth = 2 + e.tier * 0.5;
        ellipse(e.x, e.y + 6, e.R * 1.35 * sk + 4, (e.R * 1.35 * sk + 4) * 0.28); ctx.stroke();
        if (e.tier >= 4) { ctx.lineWidth = 1.5 + e.tier * 0.3; ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * sa})`; circle(e.x, e.y - e.R * 0.35, e.R * 1.6 * sk); ctx.stroke(); }
    }
}

function drawVortex(v) {
    const k = Math.min(1, v.t / 0.35), y = L.impactY - 34, r = 30 * k + Math.sin(time * 20) * 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow('purple', v.x, y, r * 4, 0.7 * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05010a'; circle(v.x, y, r); ctx.fill();
    ctx.strokeStyle = 'rgba(224, 86, 253, 0.9)'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(v.x, y, r * (1.2 + i * 0.35), time * (6 + i * 2) + i * 2, time * (6 + i * 2) + i * 2 + Math.PI * 1.1); ctx.stroke(); }
    ctx.restore();
}

function drawFires() {
    for (const f of fires) {
        const fade = Math.min(1, (f.life - f.t) / 0.8, f.t / 0.15);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.translate(f.x, L.impactY + 6); ctx.scale(1, 0.3);
        glow('orange', 0, 0, f.w * 0.62, 0.5 * fade * (0.85 + 0.15 * Math.sin(time * 17)));
        ctx.restore();
    }
}

// The blast you're aiming: a ring on the ground under the bomb you're holding
function drawAimRing() {
    if (!grabbed || !grabOverField(grabbed) || state !== 'play') return;
    const tx = clamp(grabbed.x, 24, W - 8), R = blastRadius(grabbed.tier), y = L.impactY + 4;
    const pulse = 0.5 + 0.5 * Math.sin(time * 10), ry = Math.max(R * 0.34, 18);
    ctx.fillStyle = `rgba(255, 60, 30, ${0.14 + 0.08 * pulse})`; ellipse(tx, y, R, ry); ctx.fill();
    ctx.setLineDash([9, 6]); ctx.lineDashOffset = -time * 40;
    ctx.strokeStyle = `rgba(255, 225, 130, ${0.75 + 0.25 * pulse})`; ctx.lineWidth = 2.5; ellipse(tx, y, R, ry); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx - 9, y); ctx.lineTo(tx + 9, y); ctx.moveTo(tx, y - 5); ctx.lineTo(tx, y + 5); ctx.stroke();
    // the drop line from the bomb
    ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(grabbed.x, Math.min(grabbed.y + fieldR(grabbed.tier), y)); ctx.lineTo(tx, y); ctx.stroke();
    ctx.setLineDash([]);
}
// how many zombies the held bomb would kill, shown above it
function drawAimLabel() {
    if (!grabbed || !grabOverField(grabbed) || state !== 'play' || predictedKills <= 0) return;
    const r = lerp(BOMB_R[grabbed.tier], fieldR(grabbed.tier), grabbed.k) * 1.1;
    const tx = clamp(grabbed.x, 40, W - 40), y = Math.max(L.battleTop + 20, grabbed.y - r * 1.25 - 24) - Math.sin(time * 6) * 2;
    ctx.fillStyle = 'rgba(20, 8, 20, 0.75)'; rrect(tx - 34, y - 15, 68, 30, 15); ctx.fill();
    ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; rrect(tx - 34, y - 15, 68, 30, 15); ctx.stroke();
    if (!drawUi('icon_zombie', tx - 14, y, 20, 20)) text('☠', tx - 14, y + 1, 18, '#badc58', 'center', null);
    text(`x${predictedKills}`, tx + 10, y + 2, 19, '#fff');
}

// red arrows on the right edge while a wave is about to come in, or coming in
function drawIncoming() {
    if (state !== 'play') return;
    const soon = waveState === 'gap' && waveIdx >= 0 && waveGapT < 2.2, coming = waveState === 'spawning';
    if (!soon && !coming) return;
    const y = L.impactY;
    for (let i = 0; i < 3; i++) {
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(time * 7 - i * 0.9));
        const x = W - 12 - i * 13;
        ctx.fillStyle = `rgba(255, 70, 50, ${a * (coming ? 0.7 : 1)})`;
        ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x - 10, y); ctx.lineTo(x, y + 11); ctx.lineTo(x + 4, y + 11); ctx.lineTo(x - 6, y); ctx.lineTo(x + 4, y - 11); ctx.closePath(); ctx.fill();
    }
}

function drawBossBar() {
    const w = 240, x = W / 2 - w / 2, y = L.battleTop + 12;
    ctx.fillStyle = 'rgba(15, 5, 20, 0.7)'; rrect(x - 6, y - 6, w + 12, 30, 10); ctx.fill();
    ctx.fillStyle = '#3d1f2a'; rrect(x, y + 8, w, 10, 5); ctx.fill();
    ctx.fillStyle = '#ff4757'; rrect(x, y + 8, w * Math.max(0, boss.hp / boss.maxHp), 10, 5); ctx.fill();
    text(boss.type.name.toUpperCase(), W / 2, y + 1, 13, '#ffd32a');
}

// ---------- DRAW: BOMBS ----------
// centre: for bay bombs, the hitbox centroid in sprite pixels (the body's position), so art and hitbox line up
function drawBomb(x, y, r, tier, angle, alpha = 1, centre = null) {
    const b = BOMBS[tier];
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (imgReady(bombImgs[tier])) {
        const s = spriteScale(r), c = centre || { x: SPRITE_SIZE / 2, y: SPRITE_SIZE / 2 };
        ctx.drawImage(bombImgs[tier], -c.x * s, -c.y * s, SPRITE_SIZE * s, SPRITE_SIZE * s);
        ctx.restore();
        return;
    }
    if (b.icon === 'void') {
        glow('purple', 0, 0, r * 1.5, 0.6);
    } else {  // cap + fuse + spark
        ctx.fillStyle = '#4b4b5a'; rrect(-r * 0.24, -r * 1.12, r * 0.48, r * 0.32, r * 0.08); ctx.fill();
        ctx.strokeStyle = '#d9b26f'; ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -r * 1.08); ctx.quadraticCurveTo(r * 0.3, -r * 1.5, r * 0.5, -r * 1.32); ctx.stroke();
        const sp = r * 0.16 * (0.75 + 0.25 * Math.sin(time * 30 + tier * 2));
        ctx.fillStyle = 'rgba(255, 140, 0, 0.55)'; circle(r * 0.5, -r * 1.32, sp * 2); ctx.fill();
        ctx.fillStyle = '#fff7b0'; circle(r * 0.5, -r * 1.32, sp); ctx.fill();
    }
    const light = shade(b.body, 0.45), dark = shade(b.body, -0.45);
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, light); g.addColorStop(0.55, b.body); g.addColorStop(1, dark);
    ctx.fillStyle = g; circle(0, 0, r); ctx.fill();
    ctx.save(); circle(0, 0, r); ctx.clip();
    ctx.fillStyle = b.band; ctx.fillRect(-r, -r * 0.16, r * 2, r * 0.32);
    ctx.restore();
    ctx.strokeStyle = shade(b.body, -0.65); ctx.lineWidth = Math.max(1.5, r * 0.08); circle(0, 0, r); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ellipse(-r * 0.38, -r * 0.45, r * 0.3, r * 0.16, -0.6); ctx.fill();
    ctx.restore();
}
BOMBS.forEach(b => { b.light = shade(b.body, 0.45); });

// ---------- DRAW: BOMB BAY ----------
function drawBayArea() {
    const lay = layers.bay;
    ctx.drawImage(lay.c, 0, lay.top, W, lay.h);
    if (state === 'shop' || state === 'won') { drawShop(); return; }
    if (state === 'title') { drawTitleBay(); return; }
    const { x, y, w, h } = L.bay;
    ctx.save(); rrect(x, y, w, h, 10); ctx.clip();
    // the full line: stripes, red and flashing when the bay overflows
    const ly = y + BAY_LINE, warn = jammed || overT > 0.15;
    ctx.save(); ctx.beginPath(); ctx.rect(x, ly - 3, w, 6); ctx.clip();
    for (let sx = x - 20; sx < x + w + 20; sx += 16) {
        ctx.fillStyle = warn ? `rgba(255, 70, 60, ${0.6 + 0.35 * Math.sin(time * 18)})` : 'rgba(251, 197, 49, 0.4)';
        ctx.beginPath(); ctx.moveTo(sx, ly + 3); ctx.lineTo(sx + 8, ly - 3); ctx.lineTo(sx + 16, ly - 3); ctx.lineTo(sx + 8, ly + 3); ctx.fill();
    }
    ctx.restore();
    if (jammed) { ctx.fillStyle = `rgba(255, 40, 40, ${0.12 + 0.08 * Math.sin(time * 12)})`; ctx.fillRect(x, y, w, BAY_LINE); }
    // a hint while the bay is nearly empty
    const n = bayBombs().length;
    if (n < 4 && state === 'play' && !tut) {
        ctx.globalAlpha = 0.28 * (1 - n / 4);
        text('TAP TO DROP · DRAG A BOMB UP TO THROW', x + w / 2, y + h - 40, 14, '#cfd3ff', 'center', null);
        ctx.globalAlpha = 1;
    }
    for (const b of bayBombs()) drawBomb(x + b.position.x, y + b.position.y, b.currentRadius * popScale(b), b.tier, b.angle, 1, b.centre);
    drawDropper();
    drawNext();
    ctx.restore();
    for (const p of topParts) drawPart(p);
    if (jamMsgT > 0 || jammed) {
        const a = jammed ? 0.75 + 0.25 * Math.sin(time * 8) : Math.min(1, jamMsgT);
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(40, 0, 0, 0.75)'; rrect(W / 2 - 150, y + BAY_LINE + 12, 300, 34, 17); ctx.fill();
        text('BAY FULL! THROW SOME BOMBS!', W / 2, y + BAY_LINE + 30, 18, '#ff6b6b');
        ctx.globalAlpha = 1;
    }
}

function drawDropper() {
    if (state !== 'play') return;
    const { y } = L.bay, r = BOMB_R[currentTier], dx = clampDropX(dropperX);
    const aiming = (gesture && gesture.kind !== 'grab') || hoverBay;
    // where it will fall
    if (aiming && !jammed && dropCd <= 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([4, 7]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(dx, y + 18 + r * 2); ctx.lineTo(dx, y + L.bay.h); ctx.stroke(); ctx.setLineDash([]);
    }
    // the trolley on the rail, with its claw
    ctx.fillStyle = '#15161f'; rrect(dx - 17, y + 1, 34, 12, 4); ctx.fill();
    const tg = ctx.createLinearGradient(0, y + 1, 0, y + 13);
    tg.addColorStop(0, '#b8bdd6'); tg.addColorStop(1, '#575c75');
    ctx.fillStyle = tg; rrect(dx - 16, y + 1.5, 32, 10.5, 3.5); ctx.fill();
    ctx.fillStyle = jammed ? (Math.sin(time * 12) > 0 ? '#ff3b30' : '#661010') : dropCd > 0 ? '#ffb142' : '#2ed573';
    circle(dx, y + 6.8, 2.6); ctx.fill();
    const open = dropCd > 0 || jammed ? 1 : 0;
    ctx.strokeStyle = '#2a2d3d'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(dx - 7, y + 12); ctx.lineTo(dx - 9 - open * 5, y + 19);
    ctx.moveTo(dx + 7, y + 12); ctx.lineTo(dx + 9 + open * 5, y + 19);
    ctx.stroke();
    if (dropCd <= 0 && !jammed) {
        const s = elastic(dropperPop);
        drawBomb(dx, y + 12 + r * s, r * s, currentTier, Math.sin(time * 2.2) * 0.05);
    }
}

function drawNext() {
    if (state !== 'play') return;
    const cx = L.bay.x + L.bay.w - 28, cy = L.bay.y + 34;
    const near = Math.abs(clampDropX(dropperX) - cx) < BOMB_R[currentTier] + 24;
    ctx.globalAlpha = near ? 0.35 : 0.9;
    ctx.fillStyle = 'rgba(10, 10, 20, 0.6)'; circle(cx, cy, 19); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; circle(cx, cy, 19); ctx.stroke();
    drawBomb(cx, cy + 1, 12, nextTier, 0);
    text('NEXT', cx, cy + 27, 10, '#c8c3e6', 'center', '#120d22', 2.5);
    ctx.globalAlpha = 1;
}

// the bomb in your hand, drawn above everything
function drawGrabbed() {
    if (!grabbed) return;
    const gb = grabbed, r = lerp(BOMB_R[gb.tier], fieldR(gb.tier), gb.k) * (1.1 + 0.03 * Math.sin(time * 12));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(grabOverField(gb) ? 'orange' : 'yellow', gb.x, gb.y, r * 1.9, 0.35);
    ctx.globalCompositeOperation = 'source-over';
    drawBomb(gb.x, gb.y, r, gb.tier, gb.swing);
    if (!grabOverField(gb)) {
        ctx.globalAlpha = 0.85;
        text('▲ DRAG UP ONTO THE ZOMBIES', W / 2, L.bay.y - 2 + 30, 14, '#ffe08a', 'center', '#1a1026', 3);
        ctx.globalAlpha = 1;
    } else {
        text(BOMBS[gb.tier].name.toUpperCase(), gb.x, gb.y + r + 13, 12, '#fff', 'center', '#1a1026', 3);
    }
    ctx.restore();
}

// ---------- DRAW: HUD ----------
function drawHUD() {
    const g = ctx.createLinearGradient(0, 0, 0, HUD_H);
    g.addColorStop(0, '#2b1e4d'); g.addColorStop(1, '#17102b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = '#4b3c80'; ctx.fillRect(0, HUD_H - 2, W, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, HUD_H, W, 3);
    const lv = state === 'shop' || state === 'won' || state === 'title' ? save.level : level;
    if (state !== 'title') {
        // level badge
        const bg = ctx.createLinearGradient(0, 7, 0, 49);
        bg.addColorStop(0, '#ffcf3f'); bg.addColorStop(1, '#ff9500');
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(8, 10, 74, 42, 11); ctx.fill();
        ctx.fillStyle = bg; rrect(8, 7, 74, 42, 11); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; rrect(12, 9, 66, 14, 7); ctx.fill();
        ctx.strokeStyle = '#1a1026'; ctx.lineWidth = 2.5; rrect(8, 7, 74, 42, 11); ctx.stroke();
        text('LEVEL', 45, 17, 10, '#6b3600', 'center', null);
        text(`${lv}`, 45, 34, lv >= 100 ? 21 : 24, '#fff');
        // base health
        const hx = 112, hw = 152;
        const frac = clamp(baseHP / baseMax, 0, 1), shown = clamp(hpShown / baseMax, 0, 1);
        ctx.fillStyle = '#120b22'; rrect(hx - 2, 9, hw + 4, 18, 9); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; if (shown > frac) { rrect(hx, 11, hw * shown, 14, 7); ctx.fill(); }
        const col = frac > 0.5 ? ['#7bed9f', '#2ecc71'] : frac > 0.25 ? ['#ffe066', '#f0a500'] : ['#ff7b7b', '#e0242f'];
        const hg = ctx.createLinearGradient(0, 11, 0, 25); hg.addColorStop(0, col[0]); hg.addColorStop(1, col[1]);
        ctx.fillStyle = hg; if (frac > 0) { rrect(hx, 11, Math.max(10, hw * frac), 14, 7); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; if (frac > 0) { rrect(hx + 3, 12, Math.max(4, hw * frac - 6), 4, 2); ctx.fill(); }
        text(`${Math.ceil(baseHP)} / ${baseMax}`, hx + hw / 2, 19, 12, '#fff', 'center', '#1a1026', 3);
        const pulse = frac < 0.3 && state === 'play' ? 1 + 0.15 * Math.sin(time * 10) : 1;
        if (!drawUi('icon_heart', hx - 6, 18, 24 * pulse, 24 * pulse)) text('♥', hx - 6, 19, 18, '#ff4757');
        // wave progress
        const wy = 34, prog = state === 'play' || state === 'cleared' || state === 'over' ? clamp(kills / Math.max(1, totalZombies), 0, 1) : 0;
        ctx.fillStyle = '#120b22'; rrect(hx - 2, wy, hw + 4, 15, 7.5); ctx.fill();
        if (prog > 0) {
            const pg = ctx.createLinearGradient(0, wy, 0, wy + 13); pg.addColorStop(0, '#ffb86b'); pg.addColorStop(1, '#ff6b1a');
            ctx.fillStyle = pg; rrect(hx, wy + 2, Math.max(8, hw * prog), 11, 5.5); ctx.fill();
        }
        const label = state === 'play' ? `WAVE ${Math.max(1, Math.min(waves.length, waveIdx + 1))}/${waves.length}` : state === 'cleared' ? 'CLEARED!' : state === 'over' ? 'BASE LOST' : `${levelZombieCount(save.level)} ZOMBIES`;
        text(label, hx + hw / 2, wy + 8, 11, '#fff', 'center', '#1a1026', 3);
        if (!drawUi('icon_zombie', hx - 6, wy + 7, 19, 19)) text('🧟', hx - 6, wy + 8, 13, '#badc58', 'center', null);
    }
    // coins
    const bump = 1 + hudCoinBump * 0.25;
    ctx.save(); ctx.translate(COIN_HUD.x, COIN_HUD.y); ctx.scale(bump, bump);
    drawCoin(0, 0, 12);
    ctx.restore();
    text(fmt(save.coins), COIN_HUD.x + 17, COIN_HUD.y + 2, 20 * (1 + hudCoinBump * 0.12), '#ffd32a', 'left');
    // background switch + mute
    if (!drawUi('btn_city', W - 74, 28, 36, 36)) { ctx.fillStyle = '#3d3360'; rrect(W - 92, 10, 36, 36, 10); ctx.fill(); text('🌆', W - 74, 29, 18, '#fff', 'center', null); }
    if (!drawUi(Sound.isMuted() ? 'btn_sound_off' : 'btn_sound_on', W - 28, 28, 42, 36)) { ctx.fillStyle = '#3d3360'; rrect(W - 46, 10, 36, 36, 10); ctx.fill(); text(Sound.isMuted() ? '🔇' : '🔊', W - 28, 29, 18, '#fff', 'center', null); }
}

function drawCoin(x, y, r) {
    if (drawUi('icon_coin', x, y, r * 2, r * 2)) return;
    ctx.fillStyle = '#f9ca24'; circle(x, y, r); ctx.fill();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = Math.max(1, r * 0.15); ctx.stroke();
}

function drawFloats() {
    for (const f of floats) {
        const k = f.t / f.life;
        const pop = f.big ? (k < 0.12 ? 0.3 + easeOutBack(k / 0.12) * 0.7 : 1) : (k < 0.15 ? 0.6 + k / 0.15 * 0.4 : 1);
        ctx.save();
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        ctx.translate(f.x, f.y - (f.big ? k * 18 : k * 36));
        if (f.big) ctx.rotate(Math.sin(f.t * 9) * 0.04);
        ctx.scale(pop, pop);
        text(f.str, 0, 0, f.size, f.color);
        ctx.restore();
    }
}

function drawCoins() {
    for (const c of coins) {
        const s = 7 + Math.min(4, c.v / 4), spin = Math.abs(Math.cos(c.t * 9));
        ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.fly ? 1 : 0.35 + 0.65 * spin, 1);
        drawCoin(0, 0, s);
        ctx.restore();
    }
}

function drawBanner() {
    if (!banner) return;
    const b = banner, k = b.t;
    const pop = k < 0.25 ? 0.4 + easeOutBack(k / 0.25) * 0.6 : 1;
    const fade = b.t > b.dur - 0.35 ? (b.dur - b.t) / 0.35 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(fade, 0, 1);
    ctx.translate(W / 2, L.battleTop + Math.min(118, (L.groundY - L.battleTop) * 0.45));
    ctx.scale(pop, pop);
    if (!drawUi('ribbon', 0, 6, 420, 100)) { ctx.fillStyle = 'rgba(20, 10, 30, 0.7)'; rrect(-190, -32, 380, 70, 16); ctx.fill(); }
    text(b.title, 0, -2, b.title.length > 14 ? 32 : 40, b.color);
    if (b.sub) text(b.sub, 0, 42, b.sub.length > 28 ? 15 : 18, '#fff');
    ctx.restore();
}

function drawPopup() {
    if (!popup || banner) return;
    const p = popup, k = p.t, b = BOMBS[p.tier];
    const pop = k < 0.3 ? easeOutBack(k / 0.3) : 1, fade = p.t > p.dur - 0.3 ? (p.dur - p.t) / 0.3 : 1;
    const cx = W / 2, cy = L.battleTop + 64;
    ctx.save(); ctx.globalAlpha = clamp(fade, 0, 1);
    ctx.translate(cx, cy); ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(12, 8, 24, 0.88)'; rrect(-170, -36, 340, 72, 18); ctx.fill();
    ctx.strokeStyle = '#ffd32a'; ctx.lineWidth = 2.5; rrect(-170, -36, 340, 72, 18); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter'; glow('yellow', -126, 0, 46, 0.35 + 0.15 * Math.sin(time * 6)); ctx.globalCompositeOperation = 'source-over';
    drawBomb(-126, 2, 26, p.tier, Math.sin(time * 3) * 0.15);
    text('NEW BOMB!', 22, -16, 15, '#ffd32a', 'center', '#120d22', 3);
    text(b.name.toUpperCase(), 22, 4, 22, '#fff');
    text(b.desc, 22, 24, 12, '#9fe8ff', 'center', '#120d22', 3);
    ctx.restore();
}

// ---------- DRAW: TUTORIAL ----------
function fingerAt(x, y, press) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(x + 3, y + 4, 15 * (1 - press * 0.15)); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; circle(x, y, 15 * (1 - press * 0.15)); ctx.fill();
    ctx.strokeStyle = '#1a1026'; ctx.lineWidth = 3; circle(x, y, 15 * (1 - press * 0.15)); ctx.stroke();
    if (press > 0.5) { ctx.strokeStyle = `rgba(255,255,255,${(1 - press) * 2})`; ctx.lineWidth = 3; circle(x, y, 15 + press * 18); ctx.stroke(); }
    ctx.restore();
}
function hintPill(str, y, color = '#fff') {
    const w = textWidth(str, 17) + 34;
    ctx.fillStyle = 'rgba(12, 8, 24, 0.82)'; rrect(W / 2 - w / 2, y - 17, w, 34, 17); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 211, 42, 0.8)'; ctx.lineWidth = 2; rrect(W / 2 - w / 2, y - 17, w, 34, 17); ctx.stroke();
    text(str, W / 2, y + 1, 17, color);
}
function drawTutorial() {
    if (!tut || state !== 'play' || banner || popup) return;
    const by = L.bay.y;
    if (tut.step === 0) {
        hintPill('TAP THE BAY TO DROP A BOMB', by + BAY_LINE + 36);
        const k = (time % 1.2) / 1.2, x = L.bay.x + L.bay.w * (0.35 + 0.3 * Math.sin(Math.floor(time / 1.2) * 2.1) ** 2);
        fingerAt(x, by + BAY_LINE + 100, k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7);
    } else if (tut.step === 1) {
        hintPill('2 SAME BOMBS MERGE INTO A BIGGER ONE!', by + BAY_LINE + 36, '#ffd32a');
    } else if (tut.step === 2) {
        const bombs = bayBombs().filter(b => !b.isDropping && !b.isGrowing);
        const zs = zombies.filter(z => !z.dead && z.x < W - 30);
        if (!bombs.length || !zs.length) { hintPill(zs.length ? 'DROP SOME BOMBS FIRST' : 'MERGE WHILE THEY COME…', by + BAY_LINE + 36); return; }
        hintPill(grabbed ? 'NOW LET GO OVER THE ZOMBIES!' : 'DRAG A BOMB ONTO THE ZOMBIES!', by + BAY_LINE + 36, '#ff9f43');
        if (grabbed) return;
        const b = bombs.reduce((a, c) => (c.tier > a.tier ? c : a));
        const z = zs.reduce((a, c) => (c.x < a.x ? c : a));
        const k = (time % 1.8) / 1.8, m = easeOut(clamp((k - 0.15) / 0.6, 0, 1));
        const sx = L.bay.x + b.position.x, sy = L.bay.y + b.position.y, ex = z.x, ey = L.impactY;
        const fx = lerp(sx, ex, m), fy = lerp(sy, ey, m) - Math.sin(m * Math.PI) * 40;
        ctx.setLineDash([5, 7]); ctx.strokeStyle = 'rgba(255, 220, 140, 0.55)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + ex) / 2, Math.min(sy, ey) - 60, ex, ey); ctx.stroke(); ctx.setLineDash([]);
        if (m > 0) { ctx.globalAlpha = 0.6; drawBomb(fx, fy - 30, lerp(BOMB_R[b.tier], fieldR(b.tier), m), b.tier, 0); ctx.globalAlpha = 1; }
        fingerAt(fx, fy + 30, k < 0.15 ? k / 0.15 : k > 0.8 ? 0 : 1);
    } else if (tut.step === 3) {
        hintPill('BOOM! BIGGER BOMBS = BIGGER BLASTS', by + BAY_LINE + 36, '#7bed9f');
    }
}

// ---------- DRAW: SCREENS ----------
function SHOP_CARDS() {
    const { x, y, w, h } = L.bay, top = y + 42, gap = 8, cw = (w - 20 - gap) / 2, ch = (h - 42 - 8 - gap) / 2;
    return ['soldiers', 'weapons', 'base', 'bombs'].map((key, i) => {
        const c = { key, x: x + 10 + (i % 2) * (cw + gap), y: top + Math.floor(i / 2) * (ch + gap), w: cw, h: ch };
        c.ref = SHOP_STATE[key];
        return c;
    });
}
const SHOP_STATE = { soldiers: { bump: 0 }, weapons: { bump: 0 }, base: { bump: 0 }, bombs: { bump: 0 } };
const shopPlayBtn = () => ({ x: W / 2 - 125, y: L.laneBottom - 58, w: 250, h: 58 });

function drawShop() {
    const { x, y, w } = L.bay, st = stats();
    text('UPGRADES', x + w / 2, y + 24, 26, '#ffd32a');
    drawCoin(x + 24, y + 24, 12);
    text(fmt(save.coins), x + 41, y + 26, 19, '#ffd32a', 'left');
    drawFreeCoinsBtn();
    for (const c of SHOP_CARDS()) {
        const lv = save.up[c.key], up = UPGRADES[c.key], maxed = lv >= up.max;
        const price = maxed ? 0 : upgradePrice(c.key, lv), afford = !maxed && save.coins >= price;
        const bump = 1 + (c.ref.bump || 0) * 0.06;
        ctx.save();
        ctx.translate(c.x + c.w / 2, c.y + c.h / 2); ctx.scale(bump, bump); ctx.translate(-c.x - c.w / 2, -c.y - c.h / 2);
        const panel = uiImgs.panel;
        if (imgReady(panel)) ctx.drawImage(panel, c.x, c.y, c.w, c.h);
        else { ctx.fillStyle = '#2b2346'; rrect(c.x, c.y, c.w, c.h, 14); ctx.fill(); }
        if (afford) { ctx.strokeStyle = `rgba(123, 237, 159, ${0.55 + 0.4 * Math.sin(time * 5)})`; ctx.lineWidth = 3; rrect(c.x + 2, c.y + 2, c.w - 4, c.h - 4, 14); ctx.stroke(); }
        const px = c.x + c.w / 2, py = c.y + c.h * 0.24;
        const nextSt = maxed ? st : stats({ ...save.up, [c.key]: lv + 1 });   // cards show what you're buying
        if (c.key === 'soldiers') {
            drawSoldier({ x: px - 8, y: py + c.h * 0.17, recoil: 0, look: nextSt.soldierLook }, c.h * 0.36);
            text(`x${nextSt.soldiers}`, px + 46, py + 6, 18, '#fff');
        } else if (c.key === 'weapons') {
            const fl = flashImgs[st.soldierLook], sh = shotImgs[st.soldierLook];
            if (imgReady(fl)) { const k = Math.min(46 / fl.naturalWidth, 46 / fl.naturalHeight); ctx.drawImage(fl, px - 70, py - fl.naturalHeight * k / 2, fl.naturalWidth * k, fl.naturalHeight * k); }
            if (imgReady(sh)) { const k = Math.min(80 / sh.naturalWidth, 46 / sh.naturalHeight); ctx.drawImage(sh, px - 18, py - sh.naturalHeight * k / 2, sh.naturalWidth * k, sh.naturalHeight * k); }
        } else if (c.key === 'base') {
            const img = baseImgs[nextSt.baseStage];
            if (imgReady(img)) {
                const k = Math.min(100 / img.naturalWidth, c.h * 0.42 / img.naturalHeight);
                ctx.drawImage(img, px - 12 - img.naturalWidth * k / 2, py + c.h * 0.2 - img.naturalHeight * k, img.naturalWidth * k, img.naturalHeight * k);
            }
            drawUi('icon_heart', px + 54, py - 4, 32, 32);
            text(`${nextSt.baseHp}`, px + 54, py - 3, 12, '#fff', 'center', '#1a1026', 3);
        } else {
            drawBomb(px, py + 2, Math.min(28, c.h * 0.2), Math.min(BOMBS.length - 1, nextSt.dropMin + 2), Math.sin(time * 2) * 0.08);
        }
        text(up.name, px, c.y + c.h * 0.5, 17, '#fff');
        text(maxed ? 'MAX LEVEL' : `LV ${lv} → ${lv + 1}`, px, c.y + c.h * 0.61, 12, '#d6ccff', 'center', '#1a1026', 3);
        if (!maxed) text(upgradeEffect(c.key), px, c.y + c.h * 0.705, 11, '#7bed9f', 'center', '#1a1026', 3);
        if (!maxed) {
            const bx = c.x + 26, bw = c.w - 52, bh = 24, by = c.y + c.h - bh - 8;
            if (afford) button(bx, by, bw, bh, '#4cd964', '#1e9e46', null);
            else button(bx, by, bw, bh, '#7d6fb0', '#4a3f7a', null, 16, 0.7);
            drawCoin(bx + 24, by + bh / 2, 9);
            text(fmt(price), bx + 37, by + bh / 2 + 1, 15, '#fff', 'left');
        }
        ctx.restore();
    }
    for (const p of topParts) drawPart(p);
}

// the battlefield between levels: what's next, and the button to start it
function drawShopField() {
    const b = shopPlayBtn(), lv = save.level;
    const cy = L.battleTop + (L.groundY - L.battleTop) * 0.42;
    ctx.fillStyle = 'rgba(12, 8, 24, 0.6)'; rrect(W / 2 - 160, cy - 52, 320, 104, 20); ctx.fill();
    if (state === 'won') {
        drawUi('icon_trophy', W / 2 - 150, cy - 22, 34, 34);
        text('ALL 300 LEVELS CLEARED!', W / 2 + 12, cy - 22, 24, '#ffd32a');
        text('THE HORDE IS GONE. FOR NOW…', W / 2, cy + 12, 16, '#fff');
    } else {
        text(`NEXT: LEVEL ${lv}`, W / 2, cy - 26, 28, '#ffd32a');
        const fresh = Object.values(ZOMBIES).find(t => t.unlock === lv && lv > 1 && !t.boss);
        text(`${levelZombieCount(lv) + (lv % 5 === 0 ? 1 : 0)} ZOMBIES · ${levelWaves(lv)} WAVES`, W / 2, cy + 6, 17, '#fff');
        text(lv % 5 === 0 ? 'THE ZOMBIE KING IS COMING!' : fresh ? `NEW ZOMBIE: ${fresh.name.toUpperCase()}` : 'SPEND YOUR COINS ON UPGRADES', W / 2, cy + 32, 14, lv % 5 === 0 ? '#ff6b6b' : '#9fe8ff');
    }
    const pulse = 1 + Math.sin(time * 5) * 0.035;
    ctx.save(); ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(pulse, pulse);
    button(-b.w / 2, -b.h / 2, b.w, b.h, '#5ee87a', '#1f9e46', `▶ PLAY LEVEL ${lv}`, 24);
    ctx.restore();
    drawBoostCard();
    drawNoAdsBtn();
}

function drawTitle() {
    const cy = L.battleTop + Math.min(120, (L.groundY - L.battleTop) * 0.42);
    const bob = Math.sin(time * 2) * 5;
    ctx.save(); ctx.translate(W / 2, cy + bob);
    ctx.globalCompositeOperation = 'lighter'; glow('orange', 0, 10, 220, 0.25); ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(-0.04);
    text('ZOMBIE', 0, -30, 66, '#8cf06a', 'center', '#1a1026', 13);
    text('BOMBER', 0, 32, 76, '#ff7a2f', 'center', '#1a1026', 14);
    ctx.restore();
    drawBomb(W / 2 + 150, cy - 46 + bob, 24, Math.min(10, Math.max(4, save.bestTier)), Math.sin(time * 2) * 0.3);
    drawNoAdsBtn();
    drawPrivacyBtn();
}
function drawTitleBay() {
    const { x, y, w, h } = L.bay;
    const pulse = 1 + Math.sin(time * 5) * 0.05, py = y + h * 0.27;
    ctx.save(); ctx.translate(W / 2, py); ctx.scale(pulse, pulse);
    ctx.globalCompositeOperation = 'lighter'; glow('yellow', 0, 0, 80, 0.25); ctx.globalCompositeOperation = 'source-over';
    if (!drawUi('btn_play', 0, 0, 96, 96)) button(-48, -48, 96, 96, '#5ee87a', '#1f9e46', '▶', 40);
    ctx.restore();
    text(save.level > 1 ? `TAP TO PLAY · LEVEL ${save.level}` : 'TAP TO PLAY', W / 2, py + 70, 22, '#fff');
    // the bomb collection: what you've made so far
    const top = y + h * 0.6, n = save.bestTier + 1;
    text(`BOMBS DISCOVERED ${n}/${BOMBS.length}`, W / 2, top - 6, 14, '#c8c3e6', 'center', '#120d22', 3);
    for (let i = 0; i < BOMBS.length; i++) {
        const bx = x + 40 + (i % 6) * ((w - 80) / 5), by = top + 34 + Math.floor(i / 6) * 52;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; circle(bx, by, 22); ctx.fill();
        if (i <= save.bestTier) drawBomb(bx, by + 1, 17, i, Math.sin(time * 2 + i) * 0.08);
        else {
            const sil = silhouette(bombImgs[i], '#0e0b18');
            if (sil) { const s = spriteScale(17); ctx.drawImage(sil, bx - 128 * s, by + 1 - 128 * s, 256 * s, 256 * s); }
            text('?', bx, by + 3, 16, '#4a4466', 'center', null);
        }
    }
}

const OVER_BTNS = () => {
    const cy = H / 2 + 20;
    return { shop: { x: W / 2 - 172, y: cy + 74, w: 162, h: 56 }, retry: { x: W / 2 + 10, y: cy + 74, w: 162, h: 56 } };
};
function drawGameOver() {
    ctx.fillStyle = `rgba(12, 4, 18, ${Math.min(0.72, stateT * 0.7)})`; ctx.fillRect(0, 0, W, H);
    if (stateT < 1) return;
    const k = easeOutBack((stateT - 1) / 0.4), cy = H / 2 + 20;
    ctx.save(); ctx.translate(W / 2, cy); ctx.scale(k, k); ctx.translate(-W / 2, -cy);
    ctx.fillStyle = 'rgba(30, 16, 48, 0.96)'; rrect(W / 2 - 190, cy - 190, 380, 340, 24); ctx.fill();
    ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 3; rrect(W / 2 - 190, cy - 190, 380, 340, 24); ctx.stroke();
    text('THE BASE FELL!', W / 2, cy - 150, 40, '#ff4757');
    text(`LEVEL ${level}`, W / 2, cy - 104, 26, '#ffd32a');
    text(`${kills} OF ${totalZombies} ZOMBIES BLOWN UP`, W / 2, cy - 62, 17, '#badc58');
    if (bestMerge > 0) text(`BIGGEST BOMB: ${BOMBS[bestMerge].name.toUpperCase()}`, W / 2, cy - 34, 15, '#ff9f43');
    const kept = `${coinsThisLevel} COINS KEPT`, kw = textWidth(kept, 18);
    drawCoin(W / 2 - kw / 2 - 4, cy + 2, 12);
    text(kept, W / 2 + 12, cy + 3, 18, '#ffd32a');
    text('UPGRADE, THEN TRY AGAIN!', W / 2, cy + 36, 14, '#c8c3e6', 'center', '#120d22', 3);
    const b = OVER_BTNS();
    button(b.shop.x, b.shop.y, b.shop.w, b.shop.h, '#a98bff', '#5b3fc4', 'UPGRADE', 22);
    button(b.retry.x, b.retry.y, b.retry.w, b.retry.h, '#5ee87a', '#1f9e46', 'RETRY ↻', 22);
    ctx.restore();
}

function drawCleared() {
    const cy = L.battleTop + Math.min(118, (L.groundY - L.battleTop) * 0.45);
    const k = stateT, pop = k < 0.3 ? 0.4 + easeOutBack(k / 0.3) * 0.6 : 1;
    ctx.save(); ctx.translate(W / 2, cy); ctx.scale(pop, pop);
    if (!drawUi('ribbon', 0, 6, 430, 104)) { ctx.fillStyle = 'rgba(20, 10, 30, 0.7)'; rrect(-200, -34, 400, 74, 16); ctx.fill(); }
    text(`LEVEL ${level} CLEARED!`, 0, -2, level >= 100 ? 30 : 34, '#7bed9f');
    ctx.restore();
    // stars
    for (let i = 0; i < 3; i++) {
        const t0 = 0.45 + i * 0.25, sk = clamp((k - t0) / 0.3, 0, 1);
        if (sk > 0 && !drawCleared.rang[i] && i < stars) { drawCleared.rang[i] = true; Sound.star(i); }
        const sx = W / 2 + (i - 1) * 62, sy = cy + 58 + (i === 1 ? -8 : 0), sz = (i === 1 ? 52 : 44) * (sk > 0 ? easeOutBack(sk) : 0);
        if (sz <= 0) continue;
        ctx.save();
        if (i >= stars) ctx.globalAlpha = 0.3;
        if (!drawUi('icon_star', sx, sy, sz, sz)) text('★', sx, sy, sz * 0.8, i < stars ? '#ffd32a' : '#555');
        ctx.restore();
    }
    if (k > 1.2) {
        ctx.globalAlpha = Math.min(1, (k - 1.2) * 3);
        ctx.fillStyle = 'rgba(12, 8, 24, 0.7)'; rrect(W / 2 - 130, cy + 96, 260, 30, 15); ctx.fill();
        drawCoin(W / 2 - 100, cy + 111, 10);
        text(`+${levelCoins()} COINS`, W / 2 + 8, cy + 112, 18, '#ffd32a');
        ctx.globalAlpha = 1;
    }
    // the offer: watch an ad to double the coins
    if (clearedOffer === true) {
        const b = CLEARED_BTNS(), d = b.double, since = stateT - clearedOfferAt;
        const pop = easeOutBack(Math.min(1, since / 0.3)) * (1 + Math.sin(time * 5) * 0.03);
        ctx.save(); ctx.translate(d.x + d.w / 2, d.y + d.h / 2); ctx.scale(pop, pop); ctx.translate(-d.x - d.w / 2, -d.y - d.h / 2);
        button(d.x, d.y, d.w, d.h, '#ffcf3f', '#ff9500', null);
        drawCoin(d.x + 30, d.y + d.h / 2 + 1, 13);
        text(`x2  +${fmt(levelCoins())}`, d.x + 52, d.y + d.h / 2 + 2, 22, '#fff', 'left');
        adBadge(d.x + d.w - 60, d.y + d.h / 2 + 1, 22);
        ctx.restore();
        if (since > 1) button(b.skip.x, b.skip.y, b.skip.w, b.skip.h, '#7d6fb0', '#4a3f7a', 'NO THANKS', 15, Math.min(1, (since - 1) * 3) * 0.85);
    }
}
drawCleared.rang = [];
const clearedCy = () => L.battleTop + Math.min(118, (L.groundY - L.battleTop) * 0.45);
const CLEARED_BTNS = () => {
    const cy = clearedCy();
    return { double: { x: W / 2 - 130, y: cy + 140, w: 260, h: 58 }, skip: { x: W / 2 - 80, y: cy + 208, w: 160, h: 38 } };
};

// ---------- DRAW: AD OFFERS ----------
// "▶ AD" on a button means it plays a rewarded ad
function adBadge(x, y, h = 20) {
    const w = h * 1.9;
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; rrect(x, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = '#1a1026';
    ctx.beginPath(); ctx.moveTo(x + h * 0.36, y - h * 0.26); ctx.lineTo(x + h * 0.74, y); ctx.lineTo(x + h * 0.36, y + h * 0.26); ctx.closePath(); ctx.fill();
    text('AD', x + h * 1.3, y + 1, h * 0.55, '#1a1026', 'center', null);
    return w;
}

const REVIVE_BTNS = () => {
    const cy = H / 2 + 10;
    return { watch: { x: W / 2 - 145, y: cy + 34, w: 290, h: 62 }, giveUp: { x: W / 2 - 75, y: cy + 112, w: 150, h: 38 } };
};
// The base has fallen: repair it with a rewarded ad, before the countdown runs out
function drawRevive() {
    const cy = H / 2 + 10, k = easeOutBack(Math.min(1, stateT / 0.35));
    ctx.fillStyle = `rgba(14, 4, 20, ${Math.min(0.66, stateT * 2.5)})`; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2, cy); ctx.scale(k, k); ctx.translate(-W / 2, -cy);
    ctx.fillStyle = 'rgba(30, 16, 48, 0.97)'; rrect(W / 2 - 185, cy - 196, 370, 366, 24); ctx.fill();
    ctx.strokeStyle = '#ff9f1a'; ctx.lineWidth = 3; rrect(W / 2 - 185, cy - 196, 370, 366, 24); ctx.stroke();
    text('THE BASE IS FALLING!', W / 2, cy - 158, 32, '#ff4757');
    // the base inside a countdown ring
    const bx = W / 2, by = cy - 72, left = clamp(reviveT / REVIVE_SECONDS, 0, 1), img = baseImgs[stats().baseStage];
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 7; circle(bx, by, 52); ctx.stroke();
    ctx.strokeStyle = left > 0.35 ? '#ffd32a' : '#ff4757'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(bx, by, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke(); ctx.lineCap = 'butt';
    if (imgReady(img)) { const s = Math.min(68 / img.naturalWidth, 68 / img.naturalHeight); ctx.drawImage(img, bx - img.naturalWidth * s / 2, by - img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s); }
    text(`${Math.ceil(reviveT)}`, bx + 58, by - 44, 22, left > 0.35 ? '#ffd32a' : '#ff4757');
    text('REPAIR IT AND KEEP FIGHTING!', W / 2, cy + 4, 16, '#fff');
    const b = REVIVE_BTNS(), wb = b.watch, pulse = 1 + Math.sin(time * 6) * 0.03;
    ctx.save(); ctx.translate(wb.x + wb.w / 2, wb.y + wb.h / 2); ctx.scale(pulse, pulse); ctx.translate(-wb.x - wb.w / 2, -wb.y - wb.h / 2);
    button(wb.x, wb.y, wb.w, wb.h, '#5ee87a', '#1f9e46', null);
    text('REPAIR THE BASE', wb.x + 22, wb.y + wb.h / 2 + 2, 22, '#fff', 'left');
    adBadge(wb.x + wb.w - 62, wb.y + wb.h / 2 + 1, 22);
    ctx.restore();
    if (stateT > 0.8) button(b.giveUp.x, b.giveUp.y, b.giveUp.w, b.giveUp.h, '#7d6fb0', '#4a3f7a', 'GIVE UP', 16, 0.85);
    ctx.restore();
}

const noAdsBtn = () => state === 'title' ? { x: 10, y: 11, w: 112, h: 34 } : { x: W - 128, y: L.battleTop + 10, w: 118, h: 34 };
const privacyBtn = () => ({ x: 130, y: 11, w: 96, h: 34 });
// "No Ads" with its Google Play price, or a tick once it's bought
function drawNoAdsBtn() {
    if (!Ads.enabled()) return;
    const b = noAdsBtn();
    if (Ads.adFree()) { button(b.x, b.y, b.w, b.h, '#6b6680', '#45405a', 'AD-FREE ✓', 13, 0.8); return; }
    const price = Ads.noAdsPrice();
    button(b.x, b.y, b.w, b.h, '#ff6fb5', '#c2185b', null);
    text('NO ADS', b.x + b.w / 2, b.y + (price ? 13 : b.h / 2 + 1), 15, '#fff');
    if (price) text(price, b.x + b.w / 2, b.y + 26, 11, '#ffe3f1', 'center', '#1a1026', 2.5);
}
function drawPrivacyBtn() {
    if (!Ads.privacyRequired()) return;
    const b = privacyBtn();
    button(b.x, b.y, b.w, b.h, '#5b5675', '#3a3650', 'PRIVACY', 13, 0.9);
}

const shopCoinsBtn = () => ({ x: L.bay.x + L.bay.w - 130, y: L.bay.y + 8, w: 122, h: 30 });
// free coins in the shop, once a visit
function drawFreeCoinsBtn() {
    if (state !== 'shop' || coinsOfferUsed || !Ads.rewardedReady('coins')) return;
    const b = shopCoinsBtn(), pulse = 1 + Math.sin(time * 4) * 0.03;
    ctx.save(); ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(pulse, pulse); ctx.translate(-b.x - b.w / 2, -b.y - b.h / 2);
    button(b.x, b.y, b.w, b.h, '#ffcf3f', '#ff9500', null);
    drawCoin(b.x + 16, b.y + b.h / 2, 9);
    text(`+${fmt(freeCoinsAmount(save.level))}`, b.x + 28, b.y + b.h / 2 + 1, 15, '#fff', 'left');
    adBadge(b.x + b.w - 40, b.y + b.h / 2, 18);
    ctx.restore();
}

const shopBoostCard = () => {
    const panelBottom = L.battleTop + (L.groundY - L.battleTop) * 0.42 + 52, playTop = shopPlayBtn().y;
    return { x: W / 2 - 155, y: (panelBottom + playTop) / 2 - 28, w: 310, h: 56 };
};
// the head start: start the next level with a big bomb already in the bay
function drawBoostCard() {
    if (state !== 'shop' || save.level < 2) return;
    const ready = boostTier >= 0;
    if (!ready && !Ads.rewardedReady('boost')) return;
    const b = shopBoostCard(), tier = ready ? boostTier : boostTierFor(save.level);
    ctx.fillStyle = 'rgba(12, 8, 24, 0.8)'; rrect(b.x, b.y, b.w, b.h, 16); ctx.fill();
    ctx.strokeStyle = ready ? '#7bed9f' : `rgba(255, 211, 42, ${0.6 + 0.3 * Math.sin(time * 4)})`; ctx.lineWidth = 2; rrect(b.x, b.y, b.w, b.h, 16); ctx.stroke();
    drawBomb(b.x + 32, b.y + b.h / 2 + 2, 19, tier, Math.sin(time * 2) * 0.1);
    text(ready ? `READY FOR LEVEL ${save.level}` : 'START THE LEVEL WITH A', b.x + 62, b.y + 18, 12, ready ? '#7bed9f' : '#ffd32a', 'left', '#120d22', 3);
    text(BOMBS[tier].name.toUpperCase(), b.x + 62, b.y + 38, 17, '#fff', 'left');
    if (!ready) adBadge(b.x + b.w - 52, b.y + b.h / 2, 22);
}

function drawOverlays() {
    if (hurtA > 0 || (state === 'play' && baseHP / baseMax < 0.3)) {
        const low = state === 'play' && baseHP / baseMax < 0.3 ? 0.18 + 0.1 * Math.sin(time * 6) : 0;
        const a = Math.max(hurtA * 0.6, low);
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
        g.addColorStop(0, 'rgba(255, 0, 0, 0)'); g.addColorStop(1, `rgba(200, 0, 20, ${a})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (flashA > 0) { ctx.fillStyle = `rgba(${flashColor}, ${Math.min(0.9, flashA)})`; ctx.fillRect(0, 0, W, H); }
}

function draw() {
    ensureLayers();
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.fillStyle = '#120d22'; ctx.fillRect(0, 0, W, H);
    const t = time * 60, sx = shakeMag * (Math.sin(t * 0.83) * 0.6 + Math.sin(t * 1.71) * 0.4), sy = shakeMag * (Math.sin(t * 1.13 + 1) * 0.6 + Math.sin(t * 2.07) * 0.4);
    ctx.save(); ctx.translate(sx, sy);
    drawBattlefield();
    if (state === 'shop' || state === 'won') drawShopField();
    drawBayArea();
    drawFloats();
    ctx.restore();
    drawGrabbed();
    drawCoins();
    drawHUD();
    if (state === 'title') drawTitle();
    if (state === 'cleared') drawCleared();
    drawBanner();
    drawPopup();
    drawTutorial();
    drawOverlays();
    if (state === 'over') drawGameOver();
    if (state === 'revive') drawRevive();
}

// ---------- INPUT ----------
function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = toLogical(e);
    pointer = p;
    Sound.init();
    if (gesture || Ads.isShowing()) return;   // one finger at a time, and nothing while an ad is up
    if (p.y < HUD_H && p.x > W - 52) { Sound.toggle(); Sound.click(); return; }
    if (p.y < HUD_H && p.x > W - 96 && p.x <= W - 52) { nextBackground(); Sound.click(); return; }
    switch (state) {
        case 'title': {
            if (Ads.enabled() && inRect(p, noAdsBtn())) { Sound.click(); if (!Ads.adFree()) Ads.buyNoAds(); return; }
            if (Ads.privacyRequired() && inRect(p, privacyBtn())) { Sound.click(); Ads.showPrivacy(); return; }
            Sound.click(); startLevel(save.level); return;
        }
        case 'revive': {
            const b = REVIVE_BTNS();
            if (inRect(p, b.watch)) { Sound.click(); watchRevive(); }
            else if (stateT > 0.8 && inRect(p, b.giveUp)) { Sound.click(); baseDestroyed(); }
            return;
        }
        case 'cleared': {
            if (clearedOffer === true) {   // double the coins, or not
                const b = CLEARED_BTNS();
                if (inRect(p, b.double)) { Sound.click(); watchDouble(); }
                else if (stateT - clearedOfferAt > 1 && inRect(p, b.skip)) { Sound.click(); clearedOffer = false; stateT = Math.max(stateT, 3.4); }
                return;
            }
            if (clearedOffer === null) {   // hurry along: pop the leftover bombs now
                if (stateT > 0.8) { while (leftovers.length) popLeftover(); stateT = Math.max(stateT, 1.6); }
                return;
            }
            if (stateT > 1.2) openShop();
            return;
        }
        case 'over': {
            if (stateT < 1.3) return;
            const b = OVER_BTNS();
            if (inRect(p, b.retry)) { Sound.click(); startLevel(level); }
            else if (inRect(p, b.shop)) { Sound.click(); openShop(); }
            return;
        }
        case 'shop': case 'won': {
            if (inRect(p, shopPlayBtn())) { Sound.click(); Ads.betweenLevels(save.level, () => startLevel(save.level)); return; }
            if (Ads.enabled() && inRect(p, noAdsBtn())) { Sound.click(); if (!Ads.adFree()) Ads.buyNoAds(); return; }
            if (state === 'shop' && !coinsOfferUsed && inRect(p, shopCoinsBtn()) && Ads.rewardedReady('coins')) { Sound.click(); watchFreeCoins(); return; }
            if (state === 'shop' && boostTier < 0 && save.level >= 2 && inRect(p, shopBoostCard()) && Ads.rewardedReady('boost')) { Sound.click(); watchBoost(); return; }
            const card = SHOP_CARDS().find(c => inRect(p, c));
            if (card) buyUpgrade(card);
            return;
        }
    }
    if (state !== 'play' || !inRect(p, L.bay)) return;
    const body = bombAt(p);
    gesture = { id: e.pointerId, kind: body ? 'maybe' : 'aim', sx: p.x, sy: p.y, body, touch: e.pointerType !== 'mouse' };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (!body) dropperX = clampDropX(p.x);
});
canvas.addEventListener('pointermove', e => {
    const p = toLogical(e);
    pointer = p;
    if (gesture && e.pointerId === gesture.id) {
        if (gesture.kind === 'maybe' && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 9) beginGrab(p);
        if (gesture.kind === 'aim') dropperX = clampDropX(p.x);
        else if (gesture.kind === 'grab' && grabbed) moveGrab(p);
    }
    hoverBay = !gesture && e.pointerType === 'mouse' && state === 'play' && inRect(p, L.bay);
    if (hoverBay) dropperX = clampDropX(p.x);   // on a computer the dropper follows the mouse
});
function endGesture(e, cancelled) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    const p = toLogical(e);
    if (g.kind === 'grab') releaseGrab(cancelled);
    else if (!cancelled && state === 'play') { dropperX = clampDropX(p.x); tryDrop(); }
}
// phones only let sound start when the finger lifts, so unlock it there too
canvas.addEventListener('pointerup', e => { Sound.init(); endGesture(e, false); });
canvas.addEventListener('pointercancel', e => endGesture(e, true));
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hoverBay = false; });

// ---------- SIZE ----------
function resize() {
    const oldBayH = L.bay ? L.bay.h : null, oldLaneTop = L.laneTop;
    computeLayout();
    // the screen changed height (the app's banner came or went): keep everyone on the road
    if (oldLaneTop !== undefined && oldLaneTop !== L.laneTop) {
        const d = L.laneTop - oldLaneTop;
        for (const z of zombies) z.y += d;
        for (const b of thrown) { b.ty += d; b.sy += d; }
    }
    viewScale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);   // sharp enough, and keeps phones fast
    RS = viewScale * dpr;
    canvas.style.width = `${W * viewScale}px`;
    canvas.style.height = `${H * viewScale}px`;
    canvas.width = Math.round(W * RS);
    canvas.height = Math.round(H * RS);
    mainCtx.imageSmoothingQuality = 'high';
    layers.dirty = true;
    if (bayFloor && oldBayH !== null && oldBayH !== L.bay.h) fitBayPhysics(oldBayH);
    for (const s of soldiers) s.y = lerp(L.baseBottom + 4, L.laneBottom, s.f);
}
window.addEventListener('resize', resize);
resize();
buildBayWalls();
setupBase();

// ---------- LOOP ----------
let last = performance.now();
function frame(now) {
    const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (Ads.isShowing()) { requestAnimationFrame(frame); return; }   // everything waits while an ad is on screen
    time += rdt;
    let dt = rdt;
    if (hitstop > 0) { hitstop -= rdt; dt = 0; }
    else if (slowT > 0) { slowT -= rdt; dt *= 0.3; }
    update(dt, rdt);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
