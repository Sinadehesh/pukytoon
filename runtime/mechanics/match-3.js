// Match-3 (grid-puzzle family): swap two neighbouring tiles to line up three or more of a kind; they clear,
// the tiles above fall, and chains of new matches score more. Moves count once a swap's cascade settles,
// so a last move that reaches the score target wins.

export const manifest = {
    key: 'match-3', version: '1.0.0', runtime: 1, family: 'grid-puzzle',
    name: 'Match-3', emoji: '💎', short: 'Match',
    summary: 'Swap neighbours to line up three or more of a kind.',
    view: { width: 450, height: 800 },
    actions: {},
    params: {
        type: 'object',
        properties: {
            kinds: { type: 'integer', minimum: 4, maximum: 7, default: 5, title: 'Kinds of tile' },
            cols: { type: 'integer', minimum: 5, maximum: 8, default: 7, title: 'Columns' },
            rows: { type: 'integer', minimum: 5, maximum: 9, default: 8, title: 'Rows' },
            speed: { type: 'number', minimum: 0.5, maximum: 2, default: 1, title: 'Animation speed', 'x-step': 0.1, 'x-live': true },
            hints: { type: 'boolean', default: true, title: 'Show a hint after 5 s', 'x-live': true }
        }
    },
    slots: {
        tiles: { kind: 'sprite', role: 'chain', many: true, min: 4, title: 'Tiles' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'moves', 'cleared', 'combo'],
    rules: { win: 'score >= 3000', lose: 'moves >= 25' },
    rulePresets: {
        win: [
            { label: 'Score 3,000', value: 'score >= 3000' },
            { label: 'Score 6,000', value: 'score >= 6000' },
            { label: 'Clear 120 tiles', value: 'cleared >= 120' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: '25 moves', value: 'moves >= 25' },
            { label: '90 seconds', value: 'time >= 90' },
            { label: 'Never', value: null }
        ]
    }
};

const W = 450, TOP = 150, AREA = 590;
const SWAP = 0.16, CLEAR = 0.22, FALL = 14;   // seconds, seconds, cells per second (at speed 1)

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const all = ctx.slot('tiles');
    const K = Math.min(p.kinds, all.length);
    // Spread the picks along the chain, so the kinds look as different as possible
    const art = Array.from({ length: K }, (_, i) => all[Math.round(i * (all.length - 1) / Math.max(1, K - 1))]);
    const cols = p.cols, rows = p.rows;
    const cell = Math.floor(Math.min((W - 28) / cols, AREA / rows));
    const x0 = (W - cell * cols) / 2, y0 = TOP + (AREA - cell * rows) / 2;
    const rng = ctx.rng;

    let grid = [];            // grid[r][c] = { kind, x, y, fromX, fromY, clearing }
    let phase = 'idle', t = 0, swap = null, sel = null, drag = null, combo = 0, idle = 0, hint = null, settled = true;

    const inside = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
    const kindAt = (g, r, c) => (inside(r, c) && g[r][c] ? g[r][c].kind : -1);

    // Is (r, c) part of a run of three in the kinds matrix?
    function matchAt(g, r, c) {
        const k = kindAt(g, r, c);
        if (k < 0) return false;
        let h = 1, v = 1;
        for (let i = c - 1; kindAt(g, r, i) === k; i--) h++;
        for (let i = c + 1; kindAt(g, r, i) === k; i++) h++;
        for (let i = r - 1; kindAt(g, i, c) === k; i--) v++;
        for (let i = r + 1; kindAt(g, i, c) === k; i++) v++;
        return h >= 3 || v >= 3;
    }

    function findMatches() {
        const hit = new Set();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (matchAt(grid, r, c)) hit.add(r * cols + c);
        return hit;
    }

    function swapCells(g, a, b) {
        const tmp = g[a.r][a.c];
        g[a.r][a.c] = g[b.r][b.c];
        g[b.r][b.c] = tmp;
    }

    function findMove() {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            for (const [dr, dc] of [[0, 1], [1, 0]]) {
                const a = { r, c }, b = { r: r + dr, c: c + dc };
                if (!inside(b.r, b.c)) continue;
                swapCells(grid, a, b);
                const ok = matchAt(grid, a.r, a.c) || matchAt(grid, b.r, b.c);
                swapCells(grid, a, b);
                if (ok) return [a, b];
            }
        }
        return null;
    }

    const tile = (kind, r, c) => ({ kind, x: c, y: r, fromX: c, fromY: r, clearing: false });

    // A fresh board: no ready-made matches, and at least one move
    function fill() {
        for (let tries = 0; tries < 100; tries++) {
            grid = [];
            for (let r = 0; r < rows; r++) {
                grid.push([]);
                for (let c = 0; c < cols; c++) {
                    let kind;
                    do kind = rng.int(0, K - 1);
                    while ((c >= 2 && grid[r][c - 1].kind === kind && grid[r][c - 2].kind === kind) ||
                           (r >= 2 && grid[r - 1][c].kind === kind && grid[r - 2][c].kind === kind));
                    grid[r].push(tile(kind, r, c));
                }
            }
            if (findMove()) return;
        }
    }

    function trySwap(a, b) {
        swapCells(grid, a, b);
        for (const s of [a, b]) {
            const tl = grid[s.r][s.c];
            tl.fromX = tl.x; tl.fromY = tl.y;
        }
        swap = { a, b };
        phase = 'swap';
        t = 0;
        idle = 0;
        hint = null;
        ctx.sfx('tap', 0.5);
    }

    function clear(matches) {
        for (const i of matches) grid[Math.floor(i / cols)][i % cols].clearing = true;
        ctx.vars.score += matches.size * 10 * combo + Math.max(0, matches.size - 3) * 20;
        ctx.vars.cleared += matches.size;
        ctx.vars.combo = Math.max(ctx.vars.combo, combo);
        ctx.sfx('merge', 0.7, 1 + Math.min(combo, 6) * 0.07);
        if (combo === 3) ctx.sfx('praise', 0.7);
        phase = 'clear';
        t = 0;
    }

    // Tiles fall into the gaps; new ones drop in from above the board
    function collapse() {
        for (let c = 0; c < cols; c++) {
            let write = rows - 1;
            for (let r = rows - 1; r >= 0; r--) {
                const tl = grid[r][c];
                if (tl && !tl.clearing) {
                    grid[r][c] = null;
                    grid[write][c] = tl;
                    write--;
                } else grid[r][c] = null;
            }
            for (let r = write, above = 1; r >= 0; r--, above++) {
                const tl = tile(rng.int(0, K - 1), r, c);
                tl.y = -above;
                grid[r][c] = tl;
            }
        }
        phase = 'fall';
    }

    function settle() {
        ctx.vars.moves += 1;
        phase = 'idle';
        if (!findMove()) {
            // No move left: shuffle the kinds until there is one (and no ready-made match)
            const kinds = grid.flat().map(tl => tl.kind);
            for (let tries = 0; tries < 60; tries++) {
                for (let i = kinds.length - 1; i > 0; i--) { const j = rng.int(0, i); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
                grid.forEach((row, r) => row.forEach((tl, c) => { tl.kind = kinds[r * cols + c]; }));
                if (!findMatches().size && findMove()) return;
            }
            fill();
        }
    }

    function cellAt(x, y) {
        const c = Math.floor((x - x0) / cell), r = Math.floor((y - y0) / cell);
        return inside(r, c) ? { r, c } : null;
    }

    const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

    return {
        start() { fill(); },

        update(dt, input) {
            const step = dt * p.speed;
            const ptr = input.pointer;
            if (phase === 'idle') {
                idle += dt;
                if (ptr.pressed) {
                    const at = cellAt(ptr.x, ptr.y);
                    if (at && sel && adjacent(sel, at)) { trySwap(sel, at); sel = null; drag = null; }
                    else { sel = at; drag = at; }
                }
                if (phase === 'idle' && drag && ptr.down) {
                    const dx = ptr.x - (x0 + (drag.c + 0.5) * cell), dy = ptr.y - (y0 + (drag.r + 0.5) * cell);
                    if (Math.max(Math.abs(dx), Math.abs(dy)) > cell * 0.45) {
                        const to = Math.abs(dx) > Math.abs(dy) ? { r: drag.r, c: drag.c + Math.sign(dx) } : { r: drag.r + Math.sign(dy), c: drag.c };
                        if (inside(to.r, to.c)) trySwap(drag, to);
                        drag = null;
                        sel = null;
                    }
                }
                if (ptr.released) drag = null;
                if (p.hints && idle > 5 && !hint) hint = findMove();
            } else if (phase === 'swap' || phase === 'unswap') {
                t += step;
                const k = Math.min(1, t / SWAP), e = k * k * (3 - 2 * k);
                for (const s of [swap.a, swap.b]) {
                    const tl = grid[s.r][s.c];
                    tl.x = tl.fromX + (s.c - tl.fromX) * e;
                    tl.y = tl.fromY + (s.r - tl.fromY) * e;
                }
                if (k >= 1) {
                    if (phase === 'unswap') { phase = 'idle'; }
                    else {
                        const matches = findMatches();
                        if (matches.size) { combo = 1; clear(matches); }
                        else {
                            swapCells(grid, swap.a, swap.b);
                            for (const s of [swap.a, swap.b]) { const tl = grid[s.r][s.c]; tl.fromX = tl.x; tl.fromY = tl.y; }
                            phase = 'unswap';
                            t = 0;
                            ctx.sfx('miss', 0.4);
                        }
                    }
                }
            } else if (phase === 'clear') {
                t += step;
                if (t >= CLEAR) collapse();
            } else if (phase === 'fall') {
                settled = true;
                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                    const tl = grid[r][c];
                    tl.x = c;
                    if (tl.y < r) { tl.y = Math.min(r, tl.y + FALL * step); settled = false; }
                }
                if (settled) {
                    const matches = findMatches();
                    if (matches.size) { combo++; clear(matches); }
                    else settle();
                }
            }
        },

        render(g) {
            g.text(String(ctx.vars.score), W / 2, 62, { size: 46, weight: 800, color: pal.text });
            g.text('Moves', 52, 44, { size: 14, color: pal.text });
            g.text(String(ctx.vars.moves), 52, 70, { size: 24, weight: 800, color: pal.accent });
            g.text('Cleared', W - 56, 44, { size: 14, color: pal.text });
            g.text(String(ctx.vars.cleared), W - 56, 70, { size: 24, weight: 800, color: pal.accent });

            const bw = cell * cols, bh = cell * rows;
            g.rect(x0 - 10, y0 - 10, bw + 20, bh + 20, pal.board, 18);
            g.frame(x0 - 10, y0 - 10, bw + 20, bh + 20, pal.ui, 3, 18);
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                if ((r + c) % 2) g.rect(x0 + c * cell, y0 + r * cell, cell, cell, 'rgba(0,0,0,0.05)', 6);
            }
            const c2 = g.ctx;
            c2.save();
            c2.beginPath(); c2.rect(x0 - 10, y0 - 10, bw + 20, bh + 20); c2.clip();
            const pulse = 1 + 0.08 * Math.sin(idle * 8);
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const tl = grid[r] && grid[r][c];
                if (!tl) continue;
                const cx = x0 + (tl.x + 0.5) * cell, cy = y0 + (tl.y + 0.5) * cell;
                let s = 0.84;
                if (tl.clearing) s *= Math.max(0, 1 - t / CLEAR);
                if (hint && ((hint[0].r === r && hint[0].c === c) || (hint[1].r === r && hint[1].c === c))) s *= pulse;
                if (sel && sel.r === r && sel.c === c) {
                    g.rect(x0 + c * cell + 2, y0 + r * cell + 2, cell - 4, cell - 4, 'rgba(255,255,255,0.6)', 10);
                    g.frame(x0 + c * cell + 2, y0 + r * cell + 2, cell - 4, cell - 4, pal.accent, 3, 10);
                }
                const a = art[tl.kind];
                g.sprite(a, cx, cy, cell * s, cell * s * a.h / a.w);
            }
            c2.restore();
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            return { kinds: grid.map(row => row.map(tl => tl.kind).join('')).join('/'), score: ctx.vars.score, moves: ctx.vars.moves, phase };
        }
    };
}
