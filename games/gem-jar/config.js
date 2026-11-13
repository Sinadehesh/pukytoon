// --- WHICH GAME ---
// The same engine runs more than one game. This page is Happy Fruit Merge unless the page sets
// window.GAME_SETUP before this script (the gem game in gems/ does).
const GAME = Object.assign({
    id: 'happyFruitMerge',          // prefix for everything saved in the browser (best, game in progress, settings)
    mode: null,                     // a fixed item set (see MODES in game.js), or null to pick one with ?mode=
    // combo praise ladder: the word art (assets/fx/word_<name>.png) and narrator line (assets/voice/<name>.mp3)
    // for each step, and the combo count that shows it; after the last step it repeats every 5 merges
    praise: ['sweet', 'juicy', 'delicious', 'amazing', 'incredible'],
    praiseAt: [3, 5, 7, 10, 15],
    daily: false,                   // the Daily Challenge (game.js)
    boosters: false,                // the Zap and Star boosters (game.js)
    rush: false,                    // Gem Rush, the 90-second race (game.js, meta.js)
    meta: false,                    // levels, quests, jar colours, tutorial (meta.js)
    menu: false                     // the home menu (meta.js)
}, window.GAME_SETUP || {});
// how big a praise step is, 0 (the first word) to 4 (the last), whatever the ladder's length
GAME.strength = level => level * 4 / Math.max(1, GAME.praise.length - 1);
