// Themes: which library pictures fill each slot role, and the colours around them. A mechanic asks for roles
// (a merge "chain", a "player", a "hazard", a "collectible"...), so any theme dresses any mechanic.
// Pictures are the art sets from Happy-Fruit-merge; sounds are CC0 (see CREDITS.md); music is CC BY 4.0.
import { SPRITES } from './sprites.js';

// The numbered pictures of a set, in order: a ready-made merge chain (00_ pictures are spares)
const chain = set => Object.keys(SPRITES).filter(id => id.startsWith(set + '/') && !id.includes('/00_')).sort();

// role -> file in assets/library/sfx/
export const SFX = {
    tap: 'tap', drop: 'drop', land: 'land', merge: 'pop_2', pop: 'pop_1', collect: 'chime', hit: 'crate_hit',
    jump: 'pop_5', win: 'fanfare', lose: 'gameover', praise: 'praise', bubble: 'bubble_1', miss: 'pop_3'
};

export const MUSIC = {
    easy_lemon: {
        name: 'Easy Lemon', url: 'assets/library/music/easy_lemon.mp3',
        credit: 'Music: "Easy Lemon" by Kevin MacLeod (incompetech.com), CC BY 4.0'
    },
    monkeys: {
        name: 'Monkeys Spinning Monkeys', url: 'assets/library/music/monkeys_spinning_monkeys.mp3',
        credit: 'Music: "Monkeys Spinning Monkeys" by Kevin MacLeod (incompetech.com), CC BY 4.0'
    }
};

// palette: bg = around the play area, board = the play area, sky/ground for side views, ui = frames and
// panels, text = words on the board, accent = highlights, danger = warnings
export const PACKS = [
    {
        key: 'barnyard', name: 'Barnyard',
        palette: { bg: '#f3d9cf', board: '#fff6f1', sky: '#bfe4ff', ground: '#8fcf6b', ui: '#6b4430', text: '#3b2417', accent: '#ff7aa8', danger: '#e74c3c' },
        roles: { chain: chain('barn'), player: 'barn/04_piglet', collectible: 'barn/01_egg', hazard: 'barn/00_feed_bush' }
    },
    {
        key: 'pets', name: 'Pet Pals',
        palette: { bg: '#d9e8fb', board: '#f5f9ff', sky: '#cfe6ff', ground: '#9bd38a', ui: '#34507a', text: '#1f2f4a', accent: '#ffb547', danger: '#e5484d' },
        roles: { chain: chain('pets'), player: 'pets/07_fox', collectible: 'farm/03_strawberry', hazard: 'barn/00_feed_bush' }
    },
    {
        key: 'farm', name: 'Farm Fresh',
        palette: { bg: '#d3efe5', board: '#f2fbf7', sky: '#d4f1ff', ground: '#9ccf5f', ui: '#2f6b4f', text: '#173a2a', accent: '#ff6b4a', danger: '#e5484d' },
        roles: { chain: chain('farm'), player: 'farm/04_tomato', collectible: 'farm/10_golden_apple', hazard: 'farm/08_pumpkin' }
    },
    {
        key: 'sweets', name: 'Sweet Shop',
        palette: { bg: '#fbd9e8', board: '#fff5fa', sky: '#ffe0f0', ground: '#f3a6c6', ui: '#8a3566', text: '#4f1d3b', accent: '#ff4fa3', danger: '#d6336c' },
        roles: { chain: chain('sweets'), player: 'sweets/02_gummy_bear', collectible: 'sweets/01_jelly_bean', hazard: 'sweets/03_peppermint' }
    },
    {
        key: 'gems', name: 'Gem Mine',
        palette: { bg: '#15111f', board: '#2a2340', sky: '#2e2650', ground: '#5b4636', ui: '#f2c94c', text: '#f7f1ff', accent: '#ffd54a', danger: '#ff5c5c' },
        roles: { chain: chain('rocks'), player: 'rocks/05_rose_quartz', collectible: 'rocks/08_gold_nugget', hazard: 'mine/crate' }
    },
    {
        key: 'pixel', name: 'Pixel Treasure',
        palette: { bg: '#141b38', board: '#222d5c', sky: '#29366f', ground: '#38b764', ui: '#ffcd75', text: '#f4f4f4', accent: '#ef7d57', danger: '#ff5c5c' },
        roles: { chain: chain('pixel'), player: 'pixel/03_slime', collectible: 'pixel/06_gold_coin', hazard: 'mine/crate' }
    }
];
