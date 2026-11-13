// --- GEM MINE: stages (GAME.mine; Gem Jar) ---
// Stage N opens with ?mine=N. A stage is a goal, a number of drops and a starting jar: wooden crates to
// break (a merge touching a crate breaks it; strong crates take two merges), a jar shape (shelves, pegs,
// a divider, a slope, a funnel, a bowl), and sometimes gems already waiting in the jar.
// Fair by design, in the open:
// - every try of a stage drops the same gems in the same order (seeded), and the next two are shown
// - nothing changes with how well or badly you play: no hidden help and no hidden difficulty
// - 1 star for clearing a stage, 2 and 3 for clearing it with drops to spare; the drops and star lines
//   were measured by letting a bot play every stage many times (tools/calibrate_mine.js)
// - in the app, an ad for 5 more drops is offered once a try when the drops run out; the player chooses
// The map goes down, deeper into the mine: 20 stages for now, a boss on every 10th.
// This file loads before game.js: the stages and the hooks game.js calls. The screens (map, stage card,
// the stage's top bar) start once the page has loaded, after game.js and meta.js.
const Mine = (() => {
    const on = !!GAME.mine;
    const KEY = `${GAME.id}.mine`;
    const MAP_NEXT = `${GAME.id}.mapNext`, MENU_NEXT = `${GAME.id}.menuNext`;
    const ART = { crate: 'assets/mine/crate.png', strong: 'assets/mine/crate_strong.png', cracked: 'assets/mine/crate_cracked.png',
        beam: 'assets/mine/beam.png', peg: 'assets/mine/peg.png', icon: 'assets/mine/icon_pickaxe.png', lantern: 'assets/mine/lantern.png' };
    const STAR_XP = 1000;    // XP for each new star
    const S = 60;            // crate size
    const BEAM = 16;         // beam thickness
    const FLOOR = 640;

    // ---------- building blocks for the stages ----------
    const box = (x, level = 0, hp = 1) => ({ crate: hp, x, y: FLOOR - S / 2 - level * S, a: 0 });
    // a spot on top of a beam: the point above x, lifted along the beam's normal by `up`
    function onTop([x1, y1, x2, y2], x, up) {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const t = (x - x1) / (x2 - x1);
        let nx = Math.sin(a), ny = -Math.cos(a);
        if (ny > 0) { nx = -nx; ny = -ny; }
        let ang = a;
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        return { x: x1 + (x2 - x1) * t + nx * up, y: y1 + (y2 - y1) * t + ny * up, a: ang };
    }
    const onBeam = (beam, x, hp = 1, level = 0) => Object.assign({ crate: hp }, onTop(beam, x, BEAM / 2 + S / 2 + 1 + level * S));
    const gemOn = (beam, tier, x) => Object.assign({ gem: tier }, onTop(beam, x, BEAM / 2 + 2 + [20, 28, 37, 48, 60, 73, 87, 102, 118, 136, 156, 178][tier]));
    const gemAtFloor = (tier, x) => ({ gem: tier, x, y: FLOOR - 2 - [20, 28, 37, 48, 60, 73, 87, 102, 118, 136, 156, 178][tier] });

    // jar shapes: wooden beams [x1, y1, x2, y2] (rounded ends, a little into the walls) and pegs [x, y]
    const SHELF_L = [-12, 410, 168, 424];
    const SHELF_R = [462, 410, 240, 426];
    const SHELF_L2 = [-12, 390, 160, 402], SHELF_R2 = [462, 490, 290, 502];
    const SLOPE = [-12, 552, 462, 628];
    const JARS = {
        plain: { name: 'Plain jar' },
        shelfL: { name: 'Shelf', beams: [SHELF_L] },
        shelfR: { name: 'Shelf', beams: [SHELF_R] },
        shelves: { name: 'Two shelves', beams: [SHELF_L2, SHELF_R2] },
        pegs: { name: 'Pegs', pegs: [[112, 548], [225, 492], [338, 548]] },
        divider: { name: 'Divider', beams: [[225, 662, 225, 482]] },
        slope: { name: 'Slope', beams: [SLOPE] },
        funnel: { name: 'Funnel', beams: [[-12, 420, 115, 650], [462, 420, 335, 650]] },
        bowl: { name: 'Bowl', beams: [[-12, 520, 125, 660], [462, 520, 325, 660]] }
    };

    // ---------- the stages ----------
    // goals: make (t = gem level, n = how many), crates (n to break), score (n points); all must be met.
    // drops and stars ([drops left for 2 stars, for 3 stars]) are from tools/calibrate_mine.js.
    const STAGES = [
        // 1-3: the idea, then crates
        { jar: 'plain', goals: [{ k: 'make', t: 5, n: 1 }], drops: 20, stars: [4, 5],
          tip: 'Make the gem shown at the top before your drops run out!' },
        { jar: 'plain', goals: [{ k: 'crates', n: 4 }], drops: 13, stars: [5, 6],
          layout: [box(60), box(170), box(280), box(390)], tip: 'Merge gems right next to a crate to break it.' },
        { jar: 'plain', goals: [{ k: 'make', t: 5, n: 3 }], drops: 21, stars: [5, 8] },
        // 4-6: a shelf, then pegs
        { jar: 'shelfL', goals: [{ k: 'crates', n: 4 }], drops: 31, stars: [12, 15],
          layout: [onBeam(SHELF_L, 70), box(135), box(280), box(390)], tip: 'Gems roll off the shelf. Crates under it are harder to reach!' },
        { jar: 'plain', goals: [{ k: 'make', t: 6, n: 1 }], drops: 22, stars: [3, 7] },
        { jar: 'pegs', goals: [{ k: 'crates', n: 5 }], drops: 23, stars: [12, 14],
          layout: [box(38), box(150), box(225), box(300), box(412)], tip: 'Pegs catch big gems. Small ones slip through.' },
        // 7-9: a slope: let gems roll into each other
        { jar: 'slope', goals: [{ k: 'make', t: 6, n: 2 }], drops: 20, stars: [8, 9],
          layout: [gemOn(SLOPE, 5, 80), onBeam(SLOPE, 210), onBeam(SLOPE, 210, 1, 1), gemOn(SLOPE, 5, 372)],
          tip: 'Break the crates and let the two gems roll together!' },
        { jar: 'slope', goals: [{ k: 'crates', n: 5 }], drops: 21, stars: [10, 13],
          layout: [onBeam(SLOPE, 40), onBeam(SLOPE, 40, 1, 1), onBeam(SLOPE, 100), onBeam(SLOPE, 360), onBeam(SLOPE, 420)] },
        { jar: 'shelves', goals: [{ k: 'make', t: 6, n: 2 }], drops: 36, stars: [15, 17] },
        // 10: strong crates, the first boss
        { jar: 'plain', goals: [{ k: 'crates', n: 4 }, { k: 'make', t: 6, n: 1 }], drops: 27, stars: [4, 11], boss: { zaps: 2 },
          layout: [box(75, 0, 2), box(175, 0, 2), box(275, 0, 2), box(375, 0, 2)], tip: 'Strong crates need two merges to break.' },
        // 11-14: a divider, a funnel
        { jar: 'divider', goals: [{ k: 'make', t: 5, n: 3 }], drops: 24, stars: [2, 3], tip: 'The post splits the bottom of the jar in two.' },
        { jar: 'divider', goals: [{ k: 'crates', n: 2 }, { k: 'make', t: 5, n: 3 }], drops: 25, stars: [2, 3],
          layout: [box(184), box(266)] },
        { jar: 'pegs', goals: [{ k: 'score', n: 3500 }], drops: 46, stars: [13, 22] },
        { jar: 'funnel', goals: [{ k: 'make', t: 6, n: 2 }, { k: 'crates', n: 3 }], drops: 24, stars: [2, 4],
          layout: [box(165), box(225), box(285)], tip: 'The funnel makes the bottom of the jar narrow.' },
        // 15-19: everything together
        { jar: 'shelfR', goals: [{ k: 'make', t: 6, n: 2 }], drops: 26, stars: [5, 6],
          layout: [gemOn(SHELF_R, 5, 390), onBeam(SHELF_R, 272)], tip: 'Free the gem on the shelf!' },
        { jar: 'shelves', goals: [{ k: 'crates', n: 6 }], drops: 34, stars: [12, 15],
          layout: [onBeam(SHELF_L2, 40, 2), onBeam(SHELF_L2, 105), box(200), box(260), onBeam(SHELF_R2, 420), onBeam(SHELF_R2, 355)] },
        { jar: 'bowl', goals: [{ k: 'make', t: 6, n: 2 }], drops: 37, stars: [11, 13] },
        { jar: 'plain', goals: [{ k: 'crates', n: 6 }, { k: 'make', t: 6, n: 1 }], drops: 26, stars: [2, 3],
          layout: [box(195, 0, 2), box(255, 0, 2), box(195, 1), box(255, 1), box(195, 2), box(255, 2)] },
        { jar: 'funnel', goals: [{ k: 'make', t: 7, n: 1 }], drops: 35, stars: [3, 12] },
        // 20: the boss at the bottom of the first part of the mine
        { jar: 'shelves', goals: [{ k: 'crates', n: 6 }, { k: 'make', t: 6, n: 2 }], drops: 42, stars: [10, 13], boss: { zaps: 3, stars: 1, theme: 'copper' },
          layout: [onBeam(SHELF_L2, 45, 2), onBeam(SHELF_L2, 110), box(195, 0, 2), box(255), onBeam(SHELF_R2, 420, 2), onBeam(SHELF_R2, 355)],
          tip: 'The boss stage: break every crate and make the gems!' }
    ];
    const seedOf = n => n * 7919 + 17;

    // ---------- progress: stars per stage ----------
    const progress = (() => {
        let p = {};
        try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
        return { stars: Array.isArray(p.stars) ? p.stars.map(s => s | 0) : [], seen: p.seen | 0 };
    })();
    const saveProgress = () => { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) {} };
    const starsOf = n => progress.stars[n - 1] | 0;
    function cleared() { let n = 0; while (n < STAGES.length && starsOf(n + 1) > 0) n++; return n; }
    const current = () => Math.min(STAGES.length, cleared() + 1);    // the first stage not cleared yet
    const isOpen = n => n >= 1 && n <= STAGES.length && n <= cleared() + 1;
    const totalStars = () => progress.stars.reduce((a, b) => a + (b | 0), 0);

    // which stage this page plays (a stage that isn't open yet: the one you're on)
    const params = new URLSearchParams(location.search);
    let N = 0;
    if (on && params.has('mine') && !(GAME.daily && params.has('daily')) && !(GAME.rush && params.has('rush'))) {
        N = parseInt(params.get('mine'), 10) || 1;
        if (!isOpen(N)) {
            N = current();
            try { history.replaceState(null, '', `${location.pathname}?mine=${N}`); } catch (e) {}
        }
    }
    const stage = N ? STAGES[N - 1] : null;

    // ---------- this try ----------
    let dropsLeft = stage ? stage.drops : 0;
    let extraUsed = false, broken = 0, ended = false, winIn = -1, idle = 0;
    let made = [];               // gems made this try, per level
    let crateList = [];

    const have = g => g.k === 'crates' ? broken : g.k === 'make' ? (made[g.t] | 0) : g.k === 'score' ? score : 0;
    const goalsMet = () => stage.goals.every(g => have(g) >= g.n);
    const starsFor = left => 1 + (left >= stage.stars[0] ? 1 : 0) + (left >= stage.stars[1] ? 1 : 0);

    // ---------- the jar: beams, pegs, crates, gems ----------
    const wood = new Image();
    wood.src = ART.beam;
    const beams = [];
    function roundRect(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }
    // the beam's picture: the plank's wood (assets/mine/beam.png) repeated along it, with a chocolate outline
    function beamTexture(b) {
        const pad = 3, len = b.len, th = BEAM;
        const c = document.createElement('canvas');
        c.width = Math.ceil(len + pad * 2);
        c.height = th + pad * 2;
        const g = c.getContext('2d');
        roundRect(g, pad, pad, len, th, th / 2);
        if (wood.complete && wood.naturalWidth) {
            const pat = g.createPattern(wood, 'repeat');
            const k = th / wood.naturalHeight;
            if (pat.setTransform) pat.setTransform(new DOMMatrix([k, 0, 0, k, pad, pad]));
            g.fillStyle = pat;
        } else {
            const grad = g.createLinearGradient(0, pad, 0, pad + th);
            grad.addColorStop(0, '#f6c172');
            grad.addColorStop(1, '#c97a33');
            g.fillStyle = grad;
        }
        g.fill();
        g.lineWidth = 2.5;
        g.strokeStyle = '#4a210f';
        g.stroke();
        b.render.sprite.texture = c.toDataURL();
        b.render.sprite.xScale = b.render.sprite.yScale = 1;
    }
    wood.onload = () => beams.forEach(beamTexture);

    function beamBody([x1, y1, x2, y2]) {
        const len = Math.hypot(x2 - x1, y2 - y1);
        const b = Matter.Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, BEAM, {
            isStatic: true, angle: Math.atan2(y2 - y1, x2 - x1), chamfer: { radius: BEAM / 2 - 0.5 }, friction: 0.35,
            render: { fillStyle: '#d98a3c', strokeStyle: '#4a210f', lineWidth: 2 }
        });
        b.jarPart = true;
        b.len = len;
        beams.push(b);
        beamTexture(b);
        return b;
    }
    function pegBody([x, y]) {
        const k = 26 / 96;
        const b = Matter.Bodies.circle(x, y, 10, { isStatic: true, friction: 0.2, render: { sprite: { texture: ART.peg, xScale: k, yScale: k } } });
        b.jarPart = true;
        return b;
    }
    function addCrate(x, y, hp, a) {
        const k = S * 1.04 / 150;   // the crate pictures: the crate is 150 px tall on a 172 px square
        const c = Matter.Bodies.rectangle(x, y, S, S, {
            isStatic: true, angle: a || 0, chamfer: { radius: 7 }, friction: 0.5,
            render: { sprite: { texture: hp > 1 ? ART.strong : ART.crate, xScale: k, yScale: k } }
        });
        c.crate = true;
        c.hp = hp;
        crateList.push(c);
        Matter.Composite.add(engine.world, c);
        return c;
    }
    function placeLayout() {
        crateList = [];
        for (const it of stage.layout || []) {
            if (it.crate) addCrate(it.x, it.y, it.crate, it.a);
            else if (it.gem !== undefined) {
                const g = spawnItem(it.x, it.y, it.gem, false);
                g.isDropping = false;   // already resting in the jar
                g.seeded = true;        // a gem the stage gave: what it makes doesn't count for gem sets or quests
            }
        }
    }
    // called by game.js once its walls are up
    function setupWorld() {
        if (!stage) return;
        const jar = JARS[stage.jar] || JARS.plain;
        Matter.Composite.add(engine.world, [...(jar.beams || []).map(beamBody), ...(jar.pegs || []).map(pegBody)]);
        placeLayout();
        [ART.crate, ART.strong, ART.cracked].forEach(src => { const im = new Image(); im.src = src; });
    }

    // how far (x, y) is from a crate's edge (0 inside it)
    function distTo(c, x, y) {
        const cos = Math.cos(-c.angle), sin = Math.sin(-c.angle);
        const dx = x - c.position.x, dy = y - c.position.y;
        const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos, h = S / 2;
        return Math.hypot(lx - Math.max(-h, Math.min(h, lx)), ly - Math.max(-h, Math.min(h, ly)));
    }
    function hitCrate(c) {
        if (c.gone) return;
        c.hp--;
        if (c.hp > 0) {
            c.render.sprite.texture = ART.cracked;
            FX.splinters(c.position.x, c.position.y, S, false);
            Sound.play('crate', false);
            Haptics.play('crate', false);
            return;
        }
        breakCrate(c);
    }
    function breakCrate(c) {
        if (c.gone) return;
        c.gone = true;
        Matter.Composite.remove(engine.world, c);
        crateList = crateList.filter(k => k !== c);
        broken++;
        idle = 0;
        FX.splinters(c.position.x, c.position.y, S, true);
        Sound.play('crate', true);
        Haptics.play('crate', true);
        progressUI();
        checkGoals();
        emitGame('crate');
    }

    // ---------- hooks game.js calls ----------
    const canDrop = () => !stage || (dropsLeft > 0 && !ended);
    function afterDrop() {
        if (!stage) return;
        dropsLeft = Math.max(0, dropsLeft - 1);
        idle = 0;
        dropsUI();
        if (dropsLeft <= 5 && dropsLeft > 0) Sound.play('tick', dropsLeft <= 2);
        if (dropsLeft === 0) showTip('Last drop! Let it settle...', 1800);
    }
    // a merge at (x, y) making a gem of `tier` from bodies a and b: count it, and every crate touching
    // the two gems (or the new one about to grow there) takes a hit
    function onMerge(x, y, tier, a, b) {
        if (!stage) return;
        idle = 0;
        made[tier] = (made[tier] | 0) + 1;
        if (crateList.length) {
            const hit = new Set();
            for (const p of engine.pairs.list) {
                if (!p.isActive) continue;
                const A = p.bodyA.parent, B = p.bodyB.parent;
                if ((A === a || A === b) && B.crate) hit.add(B);
                if ((B === a || B === b) && A.crate) hit.add(A);
            }
            const reach = TIERS[tier] * 1.35 + 14;   // bigger merges shake crates further away
            for (const c of crateList) if (distTo(c, x, y) <= reach) hit.add(c);
            hit.forEach(hitCrate);
        }
        progressUI();
        checkGoals();
    }
    function checkGoals() {
        if (stage && !ended && winIn < 0 && goalsMet()) winIn = 40;   // a short moment to enjoy the last merge
    }
    // every physics step (frames, not clock time, so the bot can play fast-forward)
    function tick() {
        if (!stage || isGameOver || ended) return;
        if (winIn >= 0) {
            if (--winIn < 0) { ended = true; gameOver('win'); }
            return;
        }
        if (dropsLeft > 0) return;
        idle++;
        if (idle > 30 && Matter.Composite.allBodies(engine.world).some(b => b.isDropping || b.isGrowing)) idle = 30;
        if (idle >= 100) { ended = true; gameOver('drops'); }
    }

    // ---------- the end of a try: game.js calls this from gameOver, before the panel's other parts ----------
    const $ = id => document.getElementById(id);
    const img = (src, cls) => { const i = document.createElement('img'); i.src = src; i.alt = ''; if (cls) i.className = cls; return i; };
    const short = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
    function goalIcon(g) { return g.k === 'crates' ? ART.crate : g.k === 'make' ? SPRITES[g.t] : 'assets/ui/icon_coin.png'; }
    function chip(g, haveN) {
        const s = document.createElement('span');
        s.className = 'goal-chip' + (haveN >= g.n ? ' done' : '');
        const n = Math.min(haveN, g.n);
        s.append(img(goalIcon(g)), g.k === 'score' ? `${short(n)}/${short(g.n)}` : `${n}/${g.n}`);
        return s;
    }
    let lastWin = false;
    function end(reason) {
        if (!stage) return;
        ended = true;
        winIn = -1;
        const win = reason === 'win';
        lastWin = win;
        ['go-score-label', 'go-score', 'go-best', 'go-new'].forEach(id => { $(id).style.display = 'none'; });
        const word = $('go-word');
        word.style.display = win || reason === 'drops' ? '' : 'none';
        word.src = win ? 'assets/fx/word_stageclear.png' : 'assets/fx/word_outofdrops.png';
        $('go-title').textContent = reason === 'full' ? $('go-title').textContent : `Stage ${N}`;
        // the goals: how close it was
        const goal = $('go-goal');
        goal.innerHTML = '';
        stage.goals.forEach(g => goal.append(chip(g, have(g))));
        goal.style.display = win ? 'none' : 'flex';
        const reward = $('go-reward');
        reward.innerHTML = '';
        reward.style.display = 'none';
        const box = $('go-stars');
        box.style.display = win ? 'flex' : 'none';
        [...box.children].forEach(st => st.classList.remove('on'));
        if (win) {
            const got = starsFor(dropsLeft), before = starsOf(N), totalBefore = totalStars();
            if (got > before) { progress.stars[N - 1] = got; saveProgress(); }
            // gem sets that open with Gem Mine stars (GAME.skins mineStars) and just did
            const opened = (GAME.skins || []).filter(sk => sk.mineStars && totalBefore < sk.mineStars && totalStars() >= sk.mineStars && MODES[sk.id]);
            [...box.children].forEach((st, i) => {
                if (i < got) setTimeout(() => { st.classList.add('on'); Sound.play('star', i); Haptics.play('merge', 4 + i, 0); }, 450 + i * 380);
            });
            const newStars = Math.max(0, got - before);
            const r = [];
            if (newStars) { if (window.Meta) Meta.addXP(newStars * STAR_XP); r.push([null, `+${short(newStars * STAR_XP)} XP for ${newStars === 1 ? 'a new star' : `${newStars} new stars`}`]); }
            if (before === 0 && stage.boss) {
                const b = stage.boss;
                if (b.zaps) { addZaps(b.zaps); r.push(['assets/ui/icon_bolt.png', `×${b.zaps}`]); }
                if (b.stars) { addStars(b.stars); r.push(['assets/ui/icon_star.png', `×${b.stars}`]); }
                if (b.theme) r.push(['theme', 'Copper colours']);
            }
            for (const sk of opened) r.push([MODES[sk.id].sprites[11], `New gems: ${sk.name}!`]);
            if (opened.length) setTimeout(() => Sound.play('maxMerge', () => Haptics.play('maxMerge')), 1700);
            if (r.length) {
                reward.style.display = 'flex';
                for (const [src, text] of r) {
                    const s = document.createElement('span');
                    if (src === 'theme') { const sw = document.createElement('i'); sw.className = 'swatch copper'; s.append(sw); }
                    else if (src) s.append(img(src));
                    s.append(text);
                    reward.append(s);
                }
            }
            $('go-unlock').style.display = 'none';
            Sound.play('stageClear');
            Haptics.play('maxMerge');
        } else if (reason === 'drops') {
            Sound.play('outOfDrops');
            Haptics.play('outOfDrops');
        }
        $('more-drops').style.display = reason === 'drops' && !extraUsed && Ads.rewardedReady() ? '' : 'none';
        $('btn-restart').textContent = win ? (N < STAGES.length ? 'Next ▶' : 'Play again') : 'Retry';
        $('btn-go-home').textContent = 'Map';
    }

    // after the panel: the next stage, or the same one again (the full-screen ad between, from stage 4 on)
    function again() {
        const go = () => { location.href = `${location.pathname}?mine=${lastWin && N < STAGES.length ? N + 1 : N}`; };
        if (N <= 3) go(); else Ads.showInterstitial(go);
    }
    function toMap() {
        try { sessionStorage.setItem(MENU_NEXT, '1'); sessionStorage.setItem(MAP_NEXT, '1'); } catch (e) {}
        location.href = location.pathname;
    }

    // ---------- the stage's top bar: goals, drops left, the stars still possible ----------
    function progressUI() {
        if (!stage) return;
        const box = $('mine-chips');
        if (!box) return;
        box.innerHTML = '';
        stage.goals.forEach(g => box.append(chip(g, have(g))));
    }
    function dropsUI() {
        if (!stage || !$('mine-drops-n')) return;
        $('mine-drops-n').textContent = dropsLeft;
        $('mine-drops').classList.toggle('low', dropsLeft <= 5);
        const st = [...document.querySelectorAll('#mine-drops .mine-stars img')];
        st.forEach((s, i) => s.classList.toggle('off', i > 0 && dropsLeft < stage.stars[i - 1]));
    }
    function showTip(text, ms) {
        const bubble = $('tut-bubble');
        if (!bubble || !text) return;
        $('tut-text').textContent = text;
        $('tut-skip').style.display = 'none';
        bubble.style.display = 'block';
        clearTimeout(showTip.t);
        showTip.t = setTimeout(() => { bubble.style.display = 'none'; }, ms || 4200);
    }
    function initStage() {
        document.body.classList.add('in-mine');
        $('best-box').style.display = 'none';
        $('mine-goal').style.display = '';
        $('mine-drops').style.display = '';
        $('mine-stage').textContent = `STAGE ${N}`;
        $('next2-img').style.display = '';
        const exit = $('btn-exit-daily');
        exit.style.display = '';
        exit.onclick = () => toMap();
        progressUI();
        dropsUI();
        setTimeout(() => showTip(stage.tip || goalLine()), 500);
        onGame('drop', () => { if ($('tut-bubble').style.display === 'block' && dropsLeft < stage.drops - 1) $('tut-bubble').style.display = 'none'; });
        // Keep Going (the jar was full, the player watched an ad): the same try goes on
        onGame('revive', () => { ended = false; idle = 0; winIn = -1; checkGoals(); });
        $('btn-more-drops').onclick = () => Ads.showRewarded(watched => {
            if (!watched) return;
            extraUsed = true;
            dropsLeft += 5;
            ended = false;
            idle = 0;
            isGameOver = false;
            dangerTimer = 0;
            ['go-stars', 'go-xp', 'more-drops', 'revive', 'go-unlock', 'go-goal', 'go-reward'].forEach(id => { $(id).style.display = 'none'; });
            $('gameover').classList.remove('show');
            dropsUI();
            showTip('+5 drops. You can do it!', 1800);
        });
        $('btn-go-home').onclick = () => Ads.showInterstitial(toMap);
    }
    function goalLine() {
        return stage.goals.map(g => g.k === 'crates' ? `Break ${g.n} crates` : g.k === 'score' ? `Score ${g.n.toLocaleString()}` : `Make ${g.n} of the gem shown`).join(' and ') + '!';
    }

    // ---------- the map: down into the mine ----------
    // the entrance picture is square and as wide as the map: the trail leaves the tunnel at 60% of its
    // height, and the first stage sits on the earth below the grass (which ends at 67%)
    const ROW = 118;
    let top0 = 210, trail0 = 90;
    const nodeX = i => 50 + 17 * Math.sin(i * 1.1 + 0.4);   // % across, a gentle zigzag along the shaft's middle
    const nodeY = i => top0 + i * ROW;
    let mapBuilt = false;
    function buildMap() {
        const path = $('map-path');
        path.innerHTML = '';
        const w = path.clientWidth || Math.min(innerWidth, 480);
        trail0 = Math.round(w * 0.6);
        top0 = Math.round(w * 0.72 + 55);
        const height = nodeY(STAGES.length) + 340;   // room for the signpost at the bottom
        path.style.height = height + 'px';
        // the entrance: a mine in a grassy hill, its sign saying what it is
        const gate = document.createElement('div');
        gate.className = 'mine-gate';
        gate.innerHTML = '<img src="assets/mine/map_entrance.jpg" alt=""><span>GEM<br>MINE</span>';
        path.append(gate);
        // a depth sign every 5 stages (10 m a stage)
        for (let i = 5; i <= STAGES.length; i += 5) {
            const sign = document.createElement('div');
            sign.className = 'depth-sign';
            sign.style.top = (nodeY(i - 1) + ROW / 2) + 'px';
            sign.textContent = `${i * 10} m`;
            path.append(sign);
        }
        // the trail between the stages
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'map-trail');
        svg.setAttribute('viewBox', `0 0 100 ${height}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        let d = `M 50 ${trail0}`;
        for (let i = 0; i < STAGES.length; i++) {
            const x0 = i ? nodeX(i - 1) : 50, y0 = i ? nodeY(i - 1) : trail0;
            d += ` C ${x0} ${y0 + ROW * 0.5}, ${nodeX(i)} ${nodeY(i) - ROW * 0.5}, ${nodeX(i)} ${nodeY(i)}`;
        }
        d += ` C ${nodeX(STAGES.length - 1)} ${nodeY(STAGES.length - 1) + ROW * 0.5}, 50 ${nodeY(STAGES.length) - ROW * 0.4}, 50 ${nodeY(STAGES.length) + 20}`;
        for (const [cls, w] of [['trail-edge', 2.4], ['trail', 1.5]]) {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', d);
            p.setAttribute('class', cls);
            p.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.append(p);
        }
        path.append(svg);
        // the stages (each boss between two swinging lanterns)
        STAGES.forEach((st, i) => {
            const n = i + 1;
            const b = document.createElement('button');
            b.className = 'stage-node' + (st.boss ? ' boss' : '');
            b.dataset.n = n;
            b.style.left = nodeX(i) + '%';
            b.style.top = nodeY(i) + 'px';
            b.innerHTML = `<b>${n}</b><span class="node-stars"></span>`;
            b.onclick = () => {
                Sound.play('tap');
                if (!isOpen(n)) { mapToast(`Clear stage ${n - 1} first`); return; }
                openCard(n);
            };
            path.append(b);
            if (st.boss) for (const side of [-1, 1]) lantern(path, `calc(${nodeX(i)}% + ${side * 70}px)`, nodeY(i) - 58, i + side);
        });
        const soon = document.createElement('div');
        soon.className = 'mine-soon';
        soon.style.top = (nodeY(STAGES.length) + 30) + 'px';
        soon.innerHTML = '<img src="assets/mine/sign.png" alt=""><div class="soon-text"><b>Deeper soon</b><span>More of the mine opens in the next update</span></div>';
        path.append(soon);
        lantern(path, '12%', nodeY(STAGES.length) + 10, 3);
        mapBuilt = true;
    }
    function lantern(path, left, top, k) {
        const l = img(ART.lantern, 'map-lantern');
        l.style.left = left;
        l.style.top = top + 'px';
        l.style.animationDelay = `-${(k * 0.83) % 3}s`;
        path.append(l);
    }
    function updateMap() {
        const cur = current(), all = cleared() >= STAGES.length;
        document.querySelectorAll('.stage-node').forEach(b => {
            const n = +b.dataset.n, s = starsOf(n);
            b.classList.toggle('done', s > 0);
            b.classList.toggle('current', n === cur && !all);
            b.classList.toggle('locked', !isOpen(n));
            const st = b.querySelector('.node-stars');
            st.innerHTML = '';
            if (s > 0) for (let k = 0; k < 3; k++) st.append(img('assets/ui/icon_star.png', k < s ? 'on' : ''));
        });
        $('map-stars').textContent = `${totalStars()}/${STAGES.length * 3}`;
        // the next gem set that opens with stars here: how many it needs, and its best gem
        const next = (GAME.skins || []).find(sk => sk.mineStars && totalStars() < sk.mineStars && MODES[sk.id]);
        const box = $('map-next');
        box.innerHTML = '';
        box.style.display = next ? '' : 'none';
        if (next) box.append(img('assets/ui/icon_star.png'), `${totalStars()}/${next.mineStars} opens`, img(MODES[next.id].sprites[11], 'big'), next.name);
    }
    function mapToast(text) {
        const t = $('map-toast');
        t.textContent = text;
        t.classList.remove('show');
        void t.offsetWidth;
        t.classList.add('show');
    }
    function openMap() {
        if (!on) return;
        const map = $('mine-map');
        map.style.display = 'flex';
        if (!mapBuilt) buildMap();
        updateMap();
        progress.seen = current();
        saveProgress();
        const node = document.querySelector(`.stage-node[data-n="${current()}"]`);
        const scroll = $('map-scroll');
        if (node) scroll.scrollTop = Math.max(0, node.offsetTop - scroll.clientHeight * 0.45);
    }
    function closeMap() {
        $('mine-map').style.display = 'none';
        if (window.Meta && Meta.menuOpen) Meta.refreshMenu();
    }

    // ---------- the stage card: what the stage asks, then Play ----------
    let cardN = 0;
    function openCard(n) {
        const st = STAGES[n - 1];
        cardN = n;
        $('sc-title').textContent = `Stage ${n}`;
        $('sc-boss').style.display = st.boss ? '' : 'none';
        const stars = [...document.querySelectorAll('#sc-stars img')];
        stars.forEach((s, i) => s.classList.toggle('on', i < starsOf(n)));
        const goal = $('sc-goal');
        goal.innerHTML = '';
        st.goals.forEach(g => {
            const s = document.createElement('span');
            s.className = 'goal-chip big';
            s.append(img(goalIcon(g)), g.k === 'score' ? short(g.n) : `×${g.n}`);
            goal.append(s);
        });
        $('sc-info').textContent = `${st.drops} drops · ${(JARS[st.jar] || JARS.plain).name}`;
        $('sc-tip').textContent = st.tip || '';
        const reward = $('sc-reward');
        reward.innerHTML = '';
        reward.style.display = 'none';
        if (st.boss && starsOf(n) === 0) {
            reward.style.display = 'flex';
            reward.append('First clear:');
            if (st.boss.zaps) { const s = document.createElement('span'); s.append(img('assets/ui/icon_bolt.png'), `×${st.boss.zaps}`); reward.append(s); }
            if (st.boss.stars) { const s = document.createElement('span'); s.append(img('assets/ui/icon_star.png'), `×${st.boss.stars}`); reward.append(s); }
            if (st.boss.theme) { const s = document.createElement('span'); const sw = document.createElement('i'); sw.className = 'swatch copper'; s.append(sw, 'Copper'); reward.append(s); }
        }
        // in the app, before a boss: an ad for a free Zap to start with
        const zap = $('sc-zap');
        zap.style.display = st.boss && window.AndroidApp && Ads.rewardedReady() ? '' : 'none';
        zap.disabled = false;
        zap.textContent = '▶ +1 Zap';
        zap.onclick = () => Ads.showRewarded(w => { if (!w) return; addZaps(1); zap.disabled = true; zap.textContent = 'Got it ✓'; Sound.play('claim'); });
        $('stage-card').classList.add('show');
    }
    function play(n) {
        try { sessionStorage.setItem(`${GAME.id}.session`, '1'); } catch (e) {}
        if (typeof saveGame === 'function') saveGame();
        location.href = `${location.pathname}?mine=${n}`;
    }
    function initMapUI() {
        $('map-close').onclick = () => { Sound.play('tap'); closeMap(); };
        $('btn-close-stage').onclick = () => $('stage-card').classList.remove('show');
        $('stage-card').addEventListener('click', e => { if (e.target === $('stage-card')) $('stage-card').classList.remove('show'); });
        $('sc-play').onclick = () => { Sound.unlock(); Sound.play('tap'); play(cardN); };
    }

    // ---------- for the menu tile (meta.js) ----------
    function tileText() {
        const c = cleared();
        return c >= STAGES.length ? `All ${STAGES.length} cleared · ★ ${totalStars()}` : `Stage ${current()} · ★ ${totalStars()}`;
    }
    const hasNews = () => current() > progress.seen && cleared() < STAGES.length;

    // tests and the stage calibration (tools/calibrate_mine.js): the same stage again, in place, without a reload
    function restart(opts = {}) {
        if (!stage) return;
        Matter.Composite.allBodies(engine.world).filter(b => b.tier !== undefined || b.crate).forEach(b => Matter.Composite.remove(engine.world, b));
        isGameOver = false; dangerTimer = 0; score = 0; combo = 0; dropsWithoutMerge = 0; revived = false;
        $('gameover').classList.remove('show');
        dropRandom.setState(seedOf(N));
        currentTier = randomDropTier(); nextTier = randomDropTier(); afterTier = randomDropTier();
        dropsLeft = opts.drops || stage.drops;
        extraUsed = false; broken = 0; ended = false; winIn = -1; idle = 0; made = [];
        placeLayout();
        progressUI(); dropsUI(); updateUI();
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!on) return;
        initMapUI();
        if (stage) initStage();
        let mapNext = false;
        try { mapNext = !!sessionStorage.getItem(MAP_NEXT); sessionStorage.removeItem(MAP_NEXT); } catch (e) {}
        if (mapNext && !stage) openMap();
    });

    return {
        on, N, stage, STAGES, JARS, seed: N ? seedOf(N) : 0,
        setupWorld, canDrop, afterDrop, onMerge, tick, end, again, breakCrate,
        openMap, closeMap, tileText, hasNews, cleared, current, starsOf, totalStars, restart,
        get dropsLeft() { return dropsLeft; }, set dropsLeft(v) { dropsLeft = v; dropsUI(); },
        get broken() { return broken; }, get crates() { return crateList.length; }, get ended() { return ended; },
        get made() { return made; }, goalsMet: () => !!stage && goalsMet(), starsFor: left => starsFor(left)
    };
})();
