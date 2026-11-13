// --- COMBO EFFECTS ---
// Draws merge bursts, flying candy pieces, "COMBO xN" labels and praise words on a transparent
// canvas layered over the board. All art is from assets/fx (cut from the combo sheets).

const FX = (() => {
    const W = 450, H = 640;   // same logical size as the board

    const NAMES = ['burst_yellow', 'burst_pink', 'ring', 'sparkle', 'star', 'heart', 'drop_orange', 'drop_red',
        'sprinkle_blue', 'sprinkle_purple', 'jellybean', 'lollipop',
        'word_combo', 'word_congratulations', 'word_levelup', 'word_timesup', ...GAME.praise.map(w => `word_${w}`),
        ...(GAME.mine ? ['word_stageclear', 'word_outofdrops'] : [])];
    const img = {};
    NAMES.forEach(n => { img[n] = new Image(); img[n].src = `assets/fx/${n}.png`; });
    const digit = {};
    ['x', ...'0123456789'].forEach(d => { digit[d] = new Image(); digit[d].src = `assets/fx/digit_${d}.png`; });
    const ready = i => i && i.complete && i.naturalWidth > 0;

    // Pieces that fly out of a merge, with how often each shows up
    const PIECES = [['sparkle', 3], ['star', 3], ['heart', 2], ['drop_orange', 2], ['drop_red', 2],
        ['sprinkle_blue', 2], ['sprinkle_purple', 2], ['jellybean', 1], ['lollipop', 0.4]];
    const pieceTotal = PIECES.reduce((s, p) => s + p[1], 0);
    function randomPiece() {
        let r = Math.random() * pieceTotal;
        return (PIECES.find(p => (r -= p[1]) < 0) || PIECES[0])[0];
    }

    // the combo ladder (config.js), matching the narrator: SWEET! JUICY! DELICIOUS! AMAZING! INCREDIBLE!
    const PRAISE = GAME.praise.map(w => `word_${w}`);

    let canvas, ctx, effects = [], last = performance.now();
    const rand = (a, b) => a + Math.random() * (b - a);
    const easeOutBack = t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
    // springy pop: overshoots, wobbles and settles at 1
    const elastic = t => t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 16);

    function init(board) {
        canvas = document.createElement('canvas');
        canvas.className = 'fx-layer';
        board.appendChild(canvas);
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
        requestAnimationFrame(loop);
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const r = canvas.getBoundingClientRect();
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
        ctx.imageSmoothingQuality = 'high';
    }

    // draw an image centred at (x, y) with its larger side `size` px
    function draw(im, x, y, size, rot = 0, alpha = 1) {
        if (!ready(im) || alpha <= 0) return;
        const k = size / Math.max(im.naturalWidth, im.naturalHeight);
        const w = im.naturalWidth * k, h = im.naturalHeight * k;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.translate(x, y); ctx.rotate(rot);
        ctx.drawImage(im, -w / 2, -h / 2, w, h);
        ctx.restore();
    }

    // ---------- what the game calls ----------

    // Two items merged at (x, y); r = size of the new item, combo = merges in a row so far
    function merge(x, y, r, combo) {
        const big = Math.min(1, r / 120);
        effects.push({ kind: 'burst', x, y, size: r * 2.6, t: 0, dur: 0.45, name: Math.random() < 0.5 ? 'burst_yellow' : 'burst_pink', rot: rand(0, 6.3) });
        effects.push({ kind: 'ring', x, y, size: r * 2.2, t: 0, dur: 0.55 });
        const n = Math.min(26, 7 + Math.round(big * 6) + combo * 2);
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), sp = rand(140, 320) * (0.7 + big * 0.6);
            effects.push({
                kind: 'piece', name: randomPiece(), x: x + Math.cos(a) * r * 0.4, y: y + Math.sin(a) * r * 0.4,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, rot: rand(0, 6.3), vr: rand(-8, 8),
                size: rand(16, 28) * (0.8 + big * 0.5), t: 0, dur: rand(0.7, 1.1)
            });
        }
        if (combo >= 2) {
            // one COMBO label at a time: the one before fades out fast
            effects.forEach(e => { if (e.kind === 'combo') e.t = Math.max(e.t, e.dur * 0.88); });
            const ly = Math.max(70, y - r - 28);
            effects.push({ kind: 'combo', x: Math.max(120, Math.min(W - 120, x)), y: ly, count: combo, t: 0, dur: 1.1, off: 0 });
        }
    }

    // Praise word for a long combo: 0 = the first word of the ladder (SWEET!) and up; bigger words for
    // higher steps. big = CONGRATULATIONS! for the biggest item
    function praise(level, big = false) {
        const name = big ? 'word_congratulations' : PRAISE[Math.min(level, PRAISE.length - 1)];
        effects = effects.filter(e => e.kind !== 'praise');   // one at a time
        effects.push({ kind: 'praise', name, x: W / 2, y: 270, size: big ? W - 40 : 200 + GAME.strength(level) * 45, big, t: 0, dur: big ? 2.2 : 1.5 });
        for (let i = 0; i < (big ? 40 : 18); i++) {
            const a = rand(0, Math.PI * 2), sp = rand(160, 300);
            effects.push({ kind: 'piece', name: ['sparkle', 'star', 'heart'][i % 3], x: W / 2, y: 270,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, rot: rand(0, 6.3), vr: rand(-6, 6), size: rand(18, 30), t: 0, dur: rand(0.8, 1.2) });
        }
    }

    // Any word art from assets/fx (LEVEL UP!, TIME'S UP!), popped in the middle like the biggest praise
    function banner(name) {
        if (!img[name]) { img[name] = new Image(); img[name].src = `assets/fx/${name}.png`; }
        effects = effects.filter(e => e.kind !== 'praise');
        effects.push({ kind: 'praise', name, x: W / 2, y: 270, size: W - 60, big: true, t: 0, dur: 2.0 });
        for (let i = 0; i < 30; i++) {
            const a = rand(0, Math.PI * 2), sp = rand(160, 320);
            effects.push({ kind: 'piece', name: ['sparkle', 'star', 'heart'][i % 3], x: W / 2, y: 270,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, rot: rand(0, 6.3), vr: rand(-6, 6), size: rand(18, 30), t: 0, dur: rand(0.8, 1.3) });
        }
    }

    // Zap booster: a lightning bolt from the top of the board down to the gem, then a burst where it was
    function zap(x, y, r) {
        const pts = [];
        const startX = Math.max(30, Math.min(W - 30, x + rand(-60, 60)));
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const k = i / steps;
            const along = startX + (x - startX) * k;
            pts.push([i === steps ? x : along + rand(-22, 22) * (1 - k * 0.6), k * y]);
        }
        effects.push({ kind: 'bolt', pts, t: 0, dur: 0.42 });
        effects.push({ kind: 'ring', x, y, size: r * 3, t: 0, dur: 0.5 });
        merge(x, y, r, 0);
    }

    // Gem Mine: wood splinters flying off a crate at (x, y) (assets/mine/splinter_*.png, or plain chips until they
    // load); broke = it broke apart, otherwise it only cracked
    const WOOD = ['#f3b65f', '#d9893a', '#a85a22', '#ecaa52'];
    const SPLINTERS = GAME.mine ? [1, 2, 3, 4, 5, 6].map(k => { const i = new Image(); i.src = `assets/mine/splinter_${k}.png`; return i; }) : [];
    function splinters(x, y, size, broke) {
        const n = broke ? 14 : 6;
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), sp = rand(120, broke ? 360 : 210);
            effects.push({ kind: 'chip', x: x + rand(-size / 3, size / 3), y: y + rand(-size / 3, size / 3),
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 170, rot: rand(0, 6.3), vr: rand(-12, 12),
                w: rand(6, broke ? 16 : 10), h: rand(3, 6), color: WOOD[i % WOOD.length], t: 0, dur: rand(0.6, 1.05),
                im: SPLINTERS[i % (SPLINTERS.length || 1)], size: broke ? rand(18, 30) : rand(12, 19) });
        }
        if (broke) {
            effects.push({ kind: 'ring', x, y, size: size * 2.2, t: 0, dur: 0.45 });
            effects.push({ kind: 'burst', x, y, size: size * 1.7, t: 0, dur: 0.35, name: 'burst_yellow', rot: rand(0, 6.3) });
            for (let i = 0; i < 5; i++) {
                const a = rand(0, Math.PI * 2), sp = rand(100, 220);
                effects.push({ kind: 'piece', name: i % 2 ? 'sparkle' : 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
                    rot: rand(0, 6.3), vr: rand(-6, 6), size: rand(14, 22), t: 0, dur: rand(0.6, 0.9) });
            }
        }
    }
    function drawChip(e, dt, k) {
        e.vy += 900 * dt; e.vx *= 1 - 1.5 * dt;
        e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt;
        const alpha = k > 0.6 ? Math.max(0, 1 - (k - 0.6) / 0.4) : 1;
        if (ready(e.im)) { draw(e.im, e.x, e.y, e.size * Math.min(1, e.t / 0.08), e.rot, alpha); return; }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(e.x, e.y); ctx.rotate(e.rot);
        ctx.fillStyle = e.color;
        ctx.strokeStyle = '#4a210f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(-e.w / 2, -e.h / 2, e.w, e.h);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawBolt(e) {
        const k = e.t / e.dur;
        const alpha = k < 0.55 ? (Math.sin(e.t * 95) > -0.3 ? 1 : 0.45) : 1 - (k - 0.55) / 0.45;
        ctx.save();
        ctx.lineJoin = ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(255, 225, 110, 0.95)';
        ctx.shadowBlur = 22;
        for (const [width, color] of [[12, `rgba(255, 214, 79, ${alpha * 0.85})`], [5, `rgba(255, 255, 255, ${alpha})`]]) {
            ctx.beginPath();
            e.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
            ctx.lineWidth = width;
            ctx.strokeStyle = color;
            ctx.stroke();
        }
        ctx.restore();
    }

    // ---------- animation ----------

    function drawCombo(e, dt) {
        const k = e.t / e.dur;
        const s = elastic(Math.min(1, e.t / 0.45));
        const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        // slide out of the way of a praise word in the middle, so the two never overlap
        const pr = effects.find(p => p.kind === 'praise');
        const base = e.y - k * 30;
        let goal = 0;
        if (pr && Math.abs(base - pr.y) < 78) goal = (base < pr.y ? pr.y - 78 : pr.y + 78) - base;
        e.off += (goal - e.off) * Math.min(1, dt * 14);
        const y = base + e.off;
        // "COMBO" word, then "x" and the digits, side by side
        const wordH = 34, digH = 40;
        const word = img.word_combo;
        const wordW = ready(word) ? word.naturalWidth * wordH / word.naturalHeight : 0;
        const chars = ['x', ...String(e.count)];
        const charW = chars.map(c => ready(digit[c]) ? digit[c].naturalWidth * digH / digit[c].naturalHeight * 0.92 : 0);
        const total = wordW - 4 + charW.reduce((a, b) => a + b, 0);
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.translate(e.x, y); ctx.scale(s, s); ctx.rotate(-0.06);
        let cx = -total / 2;
        if (ready(word)) ctx.drawImage(word, cx, -wordH / 2, wordW, wordH);
        cx += wordW - 4;
        chars.forEach((c, i) => {
            const im = digit[c];
            if (ready(im)) {
                const w = im.naturalWidth * digH / im.naturalHeight;
                ctx.drawImage(im, cx - (w - charW[i]) / 2, -digH / 2 - 2, w, digH);
            }
            cx += charW[i];
        });
        ctx.restore();
    }

    function loop(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        ctx.clearRect(0, 0, W, H);
        for (const e of effects) {
            e.t += dt;
            const k = e.t / e.dur;
            if (e.kind === 'burst') {
                draw(img[e.name], e.x, e.y, e.size * (0.35 + 0.75 * easeOutBack(Math.min(1, k * 1.6))), e.rot + k * 0.6, 1 - k * k);
            } else if (e.kind === 'ring') {
                draw(img.ring, e.x, e.y, e.size * (0.5 + 1.2 * Math.sqrt(k)), 0, 0.9 * (1 - k));
            } else if (e.kind === 'piece') {
                e.vy += 700 * dt; e.vx *= 1 - 1.2 * dt;
                e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt;
                const pop = Math.min(1, e.t / 0.12);
                draw(img[e.name], e.x, e.y, e.size * pop * (k > 0.6 ? 1 - (k - 0.6) / 0.4 * 0.6 : 1), e.rot, k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
            } else if (e.kind === 'combo') {
                drawCombo(e, dt);
            } else if (e.kind === 'bolt') {
                drawBolt(e);
            } else if (e.kind === 'chip') {
                drawChip(e, dt, k);
            } else if (e.kind === 'praise') {
                // the long CONGRATULATIONS! pops with a smaller overshoot so it stays inside the board
                const s = e.big ? easeOutBack(Math.min(1, e.t / 0.5)) : elastic(Math.min(1, e.t / 0.6));
                const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
                const im = img[e.name];
                const size = Math.min(e.size, W - 30);
                draw(im, e.x, e.y - Math.max(0, k - 0.75) * 120, size * s, Math.sin(e.t * 5) * 0.03, fade);
            }
        }
        effects = effects.filter(e => e.t < e.dur);
        requestAnimationFrame(loop);
    }

    return { init, merge, praise, zap, banner, splinters };
})();
