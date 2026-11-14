// The mechanics the Creator Studio offers, by key. A spec can only name one of these, so a game link can
// never load code of its own.
export const MECHANICS = {
    'drop-merge': () => import('./drop-merge.js'),
    'endless-runner': () => import('./endless-runner.js'),
    'match-3': () => import('./match-3.js'),
    'whack-a-mole': () => import('./whack-a-mole.js'),
    'snake': () => import('./snake.js'),
    'platformer': () => import('./platformer.js'),
    'space-shooter': () => import('./space-shooter.js'),
    'tap-clicker': () => import('./tap-clicker.js'),
    'memory-pairs': () => import('./memory-pairs.js'),
    'quiz': () => import('./quiz.js')
};

// Every mechanic module ({ manifest, create }), in the Studio's order
export async function loadAll() {
    return Promise.all(Object.values(MECHANICS).map(load => load()));
}
