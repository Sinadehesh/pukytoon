// Snake (arcade family): steer a growing snake to the food on a grid; don't run into a wall, a rock or
// yourself. Swipe, use the arrow keys, or tap the side of the snake you want it to turn to.

export const manifest = {
    key: 'snake', version: '1.0.0', runtime: 1, family: 'arcade',
    name: 'Snake', emoji: '🐍', short: 'Snake',
    summary: 'Steer to the food and grow longer, without running into a wall, a rock or yourself.',
    view: { width: 450, height: 800 },
    actions: {
        up: ['swipe-up', 'ArrowUp', 'KeyW'],
        down: ['swipe-down', 'ArrowDown', 'KeyS'],
        left: ['swipe-left', 'ArrowLeft', 'KeyA'],
        right: ['swipe-right', 'ArrowRight', 'KeyD']
    },
    params: {
        type: 'object',
        properties: {
            grid: { type: 'integer', enum: [10, 14, 18], default: 14, title: 'Board', 'x-labels': { 10: 'Small', 14: 'Medium', 18: 'Large' } },
            speed: { type: 'number', minimum: 3, maximum: 12, default: 6, title: 'Speed (moves a second)', 'x-step': 0.5, 'x-live': true },
            speedUp: { type: 'number', minimum: 0, maximum: 0.4, default: 0.1, title: 'Faster with each bite', 'x-step': 0.02, 'x-live': true },
            growth: { type: 'integer', minimum: 1, maximum: 4, default: 1, title: 'Growth per bite' },
            rocks: { type: 'integer', minimum: 0, maximum: 10, default: 0, title: 'Rocks' },
            wrap: { type: 'boolean', default: false, title: 'Go through the walls', 'x-live': true },
            lives: { type: 'integer', minimum: 1, maximum: 5, default: 3, title: 'Lives' }
        }
    },
    slots: {
        player: { kind: 'sprite', role: 'player', title: 'Head' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Food' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Rock' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'length', 'eaten', 'lives'],
    rules: { win: 'eaten >= 20', lose: 'lives <= 0' },
    rulePresets: {
        win: [
            { label: 'Eat 20', value: 'eaten >= 20' },
            { label: 'Grow to 40', value: 'length >= 40' },
            { label: 'Score 1,000', value: 'score >= 1000' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: 'Out of lives', value: 'lives <= 0' },
            { label: '60 seconds', value: 'time >= 60' },
            { label: 'Out of lives or 90 s', value: 'lives <= 0 || time >= 90' }
        ]
    }
};

const W = 450, TOP = 128, AREA_W = 424, AREA_H = 640, START_LEN = 3, PAUSE = 0.7;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const head = ctx.slot('player'), food = ctx.slot('collectible'), rock = ctx.slot('hazard');
    const cols = p.grid, rows = Math.round(p.grid * 1.45);
    const cell = Math.floor(Math.min(AREA_W / cols, AREA_H / rows));
    const x0 = (W - cell * cols) / 2, y0 = TOP + (AREA_H - cell * rows) / 2;
    const startX = Math.floor(cols / 2), startY = rows - 3;
    const key = (x, y) => y * cols + x;

    let snake = [], before = [], dir = [0, -1], turns = [], grow = 0;
    let rocks = new Set(), meal = null, clock = 0, timer = 0, pause = 0, shake = 0, flash = 0, bites = 0, moves = 0;
    let pops = [];

    const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !rocks.has(key(x, y));
    const speed = () => Math.min(16, p.speed + p.speedUp * bites);

    // Rocks never wall anything off: every open cell keeps two open neighbours, so food is never in a dead
    // end, and all open cells stay joined up. The start column stays clear, for coming back after a crash.
    function placeRocks() {
        let tries = 0;
        while (rocks.size < p.rocks && tries++ < 400) {
            const x = ctx.rng.int(0, cols - 1), y = ctx.rng.int(0, rows - 1);
            if (Math.abs(x - startX) <= 1 || rocks.has(key(x, y))) continue;
            rocks.add(key(x, y));
            if (!stillOpen()) rocks.delete(key(x, y));
        }
    }
    function stillOpen() {
        let total = 0, first = -1;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            if (!free(x, y)) continue;
            total++;
            if (first < 0) first = key(x, y);
            let n = 0;
            for (const [dx, dy] of Object.values(DIRS)) if (free(x + dx, y + dy)) n++;
            if (n < 2) return false;
        }
        const seen = new Set([first]), todo = [first];
        while (todo.length) {
            const k = todo.pop(), x = k % cols, y = Math.floor(k / cols);
            for (const [dx, dy] of Object.values(DIRS)) {
                const nk = key(x + dx, y + dy);
                if (free(x + dx, y + dy) && !seen.has(nk)) { seen.add(nk); todo.push(nk); }
            }
        }
        return seen.size === total;
    }

    function placeFood() {
        const body = new Set(snake.map(s => key(s[0], s[1])));
        const open = [];
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            if (free(x, y) && !body.has(key(x, y))) open.push([x, y]);
        }
        meal = open.length ? ctx.rng.pick(open) : null;
    }

    // In the start column, heading up, with a moment to get ready
    function reset() {
        snake = [];
        for (let i = 0; i < START_LEN; i++) snake.push([startX, startY + i < rows ? startY + i : rows - 1]);
        before = snake.map(s => s.slice());
        dir = [0, -1]; turns = []; grow = 0; timer = 0; pause = PAUSE;
        ctx.vars.length = snake.length;
        if (meal && snake.some(s => s[0] === meal[0] && s[1] === meal[1])) placeFood();
    }

    function turn(name) {
        const d = DIRS[name];
        const last = turns.length ? turns[turns.length - 1] : dir;
        if (turns.length < 2 && d[0] !== last[0] && d[1] !== last[1] && !(d[0] === -last[0] && d[1] === -last[1])) turns.push(d);
    }

    function crash() {
        ctx.vars.lives = Math.max(0, ctx.vars.lives - 1);
        ctx.sfx('hit');
        ctx.haptic(60);
        shake = 0.35; flash = 0.4;
        pops.push({ x: x0 + (snake[0][0] + 0.5) * cell, y: y0 + snake[0][1] * cell, text: 'Ouch!', color: pal.danger, t: 0 });
        if (ctx.vars.lives > 0) reset();
        else pause = 1e9;   // the lose rule ends it; with no lose rule it just stops
    }

    function move() {
        before = snake.map(s => s.slice());
        if (turns.length) dir = turns.shift();
        let nx = snake[0][0] + dir[0], ny = snake[0][1] + dir[1];
        if (p.wrap) { nx = (nx + cols) % cols; ny = (ny + rows) % rows; }
        const tailMoves = grow === 0;
        const hitsBody = snake.some((s, i) => s[0] === nx && s[1] === ny && !(tailMoves && i === snake.length - 1));
        if (!free(nx, ny) || hitsBody) { crash(); return; }
        snake.unshift([nx, ny]);
        if (grow > 0) grow--; else snake.pop();
        moves++;
        if (meal && nx === meal[0] && ny === meal[1]) {
            bites++;
            grow += p.growth;
            ctx.vars.eaten += 1;
            const gain = 10 * (1 + Math.floor(ctx.vars.eaten / 5));
            ctx.vars.score += gain;
            ctx.sfx('collect', 0.8, 1 + Math.min(ctx.vars.eaten, 20) * 0.02);
            ctx.haptic(15);
            pops.push({ x: x0 + (nx + 0.5) * cell, y: y0 + ny * cell, text: `+${gain}`, color: pal.accent, t: 0 });
            placeFood();
        }
        ctx.vars.length = snake.length + grow;
    }

    return {
        start() {
            ctx.vars.lives = p.lives;
            placeRocks();
            reset();
            placeFood();
            pause = PAUSE * 1.5;
        },

        update(dt, input) {
            clock += dt;
            shake = Math.max(0, shake - dt);
            flash = Math.max(0, flash - dt);
            for (const name of Object.keys(DIRS)) if (input.pressed.has(name)) turn(name);
            // A tap turns toward it: above or below the head while going sideways, left or right while going up or down
            if (input.pointer.released && !input.swipe) {
                const hx = x0 + (snake[0][0] + 0.5) * cell, hy = y0 + (snake[0][1] + 0.5) * cell;
                const last = turns.length ? turns[turns.length - 1] : dir;
                if (last[0] !== 0) turn(input.pointer.y < hy ? 'up' : 'down');
                else turn(input.pointer.x < hx ? 'left' : 'right');
            }
            if (pause > 0) { pause -= dt; return; }
            timer += dt;
            const every = 1 / speed();
            while (timer >= every && pause <= 0) { timer -= every; move(); }
            for (const o of pops) o.t += dt;
            pops = pops.filter(o => o.t < 0.8);
        },

        render(g) {
            const c = g.ctx;
            const k = pause > 0 ? 1 : Math.min(1, timer * speed());
            c.save();
            if (shake > 0) c.translate(Math.sin(clock * 90) * shake * 14, 0);
            g.rect(x0 - 8, y0 - 8, cell * cols + 16, cell * rows + 16, ctx.shade(pal.ground, -0.25), 18);
            g.rect(x0, y0, cell * cols, cell * rows, pal.board, 10);
            for (let y = 0; y < rows; y++) for (let x = (y % 2); x < cols; x += 2) {
                g.rect(x0 + x * cell, y0 + y * cell, cell, cell, ctx.shade(pal.board, -0.05));
            }
            for (const r of rocks) {
                const x = r % cols, y = Math.floor(r / cols);
                g.sprite(rock, x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell, cell * 0.95, cell * 0.95);
            }
            if (meal) {
                const bob = 1 + 0.08 * Math.sin(clock * 6);
                g.sprite(food, x0 + (meal[0] + 0.5) * cell, y0 + (meal[1] + 0.5) * cell, cell * 0.9 * bob, cell * 0.9 * bob);
            }

            // The body slides from where it was to where it is, so it moves smoothly between steps
            const at = i => {
                const now = snake[i], was = before[i] || now;
                const jump = Math.abs(now[0] - was[0]) + Math.abs(now[1] - was[1]) > 1;   // through a wall
                const fx = jump ? now[0] : was[0] + (now[0] - was[0]) * k, fy = jump ? now[1] : was[1] + (now[1] - was[1]) * k;
                return [x0 + (fx + 0.5) * cell, y0 + (fy + 0.5) * cell];
            };
            const pts = snake.map((_, i) => at(i));
            const blink = pause > 0 && pause < 1e8 && Math.floor(pause * 10) % 2 === 0;
            g.alpha(blink ? 0.45 : 1, () => {
                c.lineCap = 'round'; c.lineJoin = 'round';
                for (let i = pts.length - 1; i > 0; i--) {
                    const [ax, ay] = pts[i], [bx, by] = pts[i - 1];
                    if (Math.hypot(ax - bx, ay - by) > cell * 1.5) continue;
                    const t = i / Math.max(1, pts.length - 1);
                    g.line(ax, ay, bx, by, ctx.shade(pal.accent, -0.1 - t * 0.25), cell * (0.78 - t * 0.2));
                }
                for (let i = pts.length - 1; i >= 1; i--) {
                    const t = i / Math.max(1, pts.length - 1);
                    g.circle(pts[i][0], pts[i][1], cell * (0.39 - t * 0.1), ctx.shade(pal.accent, -0.05 - t * 0.25));
                }
                g.circle(pts[0][0], pts[0][1], cell * 0.46, pal.accent);
                g.sprite(head, pts[0][0], pts[0][1], cell * 1.15, cell * 1.15);
            });
            for (const o of pops) {
                g.alpha(1 - o.t / 0.8, () => g.text(o.text, o.x, o.y - o.t * 50, { size: 24, weight: 800, color: o.color, outline: 'rgba(0,0,0,0.25)' }));
            }
            c.restore();
            if (flash > 0) g.rect(0, 0, W, 800, `rgba(231, 76, 60, ${flash * 0.35})`);

            g.text(String(ctx.vars.score), W / 2, 62, { size: 46, weight: 800, color: pal.text });
            g.text('Length', 56, 44, { size: 14, color: pal.text });
            g.text(String(ctx.vars.length), 56, 70, { size: 24, weight: 800, color: pal.accent });
            g.text('Lives', W - 56, 44, { size: 14, color: pal.text });
            g.text('♥'.repeat(Math.min(5, ctx.vars.lives)) || '–', W - 56, 70, { size: 20, weight: 800, color: pal.danger, maxWidth: 100 });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            return {
                cols, rows, moves, dir: dir.join(','), snake: snake.map(s => s.join(',')).join(' '),
                meal: meal ? meal.join(',') : '', rocks: [...rocks].sort((a, b) => a - b).join(' '),
                eaten: ctx.vars.eaten, lives: ctx.vars.lives, ready: pause <= 0
            };
        }
    };
}
