// --- META: levels, quests, Gem Rush, home menu, tutorial (GAME.meta; Gem Jar) ---
//
// Built to be fair: every timer is real, nothing in the game is rigged, rewards are exactly what they say,
// and the only ads are ones the player chooses to watch (plus the full-screen ad between games, at most
// once a minute in the app). The engagement ideas used, in the open:
// - endowed progress and early wins: Level 2 comes in the first game, the first levels are quick
// - goal gradient: the XP bar is always in sight, glows when a level is close, and the game-over panel
//   says how close it is
// - progressive disclosure: the Daily Challenge (Level 2), Quests (3), Gem Rush (4) and the Star booster (6)
//   open one at a time, each a small event
// - variable rewards: a level up sometimes brings a lucky bonus Zap
// - Zeigarnik effect: unfinished quests and the next gem set stay in view
// - peak-end rule: a game ends on the XP gained and the best gem made, then the level-up card if one came
// - streaks and time windows: the Daily streak, quests that change every 8 hours, a 90-second Rush
// - flow: calm Classic play and fast Gem Rush to switch between; soft sounds and buzzes for every reward
(() => {
    if (!GAME.meta) return;
    const $ = id => document.getElementById(id);
    const fmt = n => Math.round(n).toLocaleString();
    const short = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
    const inApp = !!window.AndroidApp;
    const ICON = { zap: 'assets/ui/icon_bolt.png', star: 'assets/ui/icon_star.png', daily: 'assets/ui/icon_coin.png', quests: 'assets/ui/btn_check.png', gem: 'assets/ui/icon_gem.png', mine: 'assets/mine/icon_pickaxe.png' };
    const img = (src, cls) => { const i = document.createElement('img'); i.src = src; i.alt = ''; if (cls) i.className = cls; return i; };
    const watch = () => document.querySelector('#tile-rush .icon-watch').cloneNode(true);

    // ---------- profile ----------
    const PROFILE_KEY = `${GAME.id}.profile`;
    const P = Object.assign({ xp: 0, level: 1, tutorial: false, quests: 0, rushStars: 0, bestStreak: 0, theme: 'default', seen: -1 },
        (() => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch (e) { return {}; } })());
    const saveProfile = () => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(P)); } catch (e) {} };

    // ---------- 200 levels ----------
    // Total XP to reach a level, 1 XP per point scored plus bonuses. About 250,000 points are scored in an
    // hour (measured), so Level 2 comes in the first minute or two, Level 10 after about an hour, Level 50
    // after about 22 hours and Level 200 after about 300.
    const MAX_LEVEL = 200;
    const xpFor = n => n <= 1 ? 0 : Math.round(250000 * Math.pow((n - 1) / 9, 1.84) / 100) * 100;
    const levelOf = xp => { let n = 1; while (n < MAX_LEVEL && xpFor(n + 1) <= xp) n++; return n; };
    const TITLES = [[1, 'Pebble Picker'], [10, 'Rock Hound'], [20, 'Stone Polisher'], [30, 'Crystal Seeker'], [40, 'Gem Hunter'],
        [50, 'Jewel Crafter'], [60, 'Treasure Finder'], [70, 'Geode Cracker'], [80, 'Opal Charmer'], [90, 'Ruby Royal'],
        [100, 'Sapphire Sage'], [110, 'Emerald Expert'], [120, 'Topaz Titan'], [130, 'Amethyst Ace'], [140, 'Prism Master'],
        [150, 'Star Gazer'], [160, 'Moonstone Mystic'], [170, 'Crown Keeper'], [180, 'Diamond Duke'], [190, 'Gem Grandmaster'], [200, 'Gem Legend']];
    const titleFor = n => TITLES.filter(([l]) => l <= n).pop()[1];
    // what opens at which level
    const FEATURES = { daily: 2, mine: 2, quests: 3, rush: 4, star: 6 };
    const FEATURE_NAME = { daily: 'Daily Challenge', mine: 'Gem Mine', quests: 'Quests', rush: 'Gem Rush', star: 'Star booster' };
    const featureOpen = f => P.level >= FEATURES[f];
    // jar colours: most open with levels, three with challenges (colours match index.html)
    const THEMES = [
        { id: 'default', name: 'Amethyst', c: ['#6a46c2', '#4b2f9c'] },
        { id: 'ocean', name: 'Ocean', level: 5, c: ['#2f86de', '#1b4f9c'] },
        { id: 'mint', name: 'Mint', level: 8, c: ['#2bbf9f', '#137565'] },
        { id: 'sunset', name: 'Sunset', level: 12, c: ['#ff8a5c', '#c2456e'] },
        { id: 'rose', name: 'Rose', level: 16, c: ['#ff74ac', '#b83b78'] },
        { id: 'midnight', name: 'Midnight', level: 22, c: ['#2c3f86', '#111a42'] },
        { id: 'gold', name: 'Gold', level: 30, c: ['#f0b232', '#b06a12'] },
        { id: 'aurora', name: 'Aurora', level: 40, c: ['#27c7a8', '#6a3fc8'] },
        { id: 'candy', name: 'Candy', level: 55, c: ['#ff7ac6', '#8b5cf6'] },
        { id: 'cosmos', name: 'Cosmos', level: 75, c: ['#3d1f72', '#0c0a2c'] },
        { id: 'lava', name: 'Lava', level: 100, c: ['#d0362a', '#4c0d0d'] },
        { id: 'royal', name: 'Royal', level: 140, c: ['#7b22a6', '#3a0c5a'] },
        { id: 'diamond', name: 'Diamond', level: 200, c: ['#8fcdf2', '#4f74b8'] },
        { id: 'ember', name: 'Ember', rush3: true, c: ['#ffa34a', '#e04848'] },     // 3 stars in a Gem Rush
        { id: 'frost', name: 'Frost', streak: 7, c: ['#a5e9ff', '#4a8fd9'] },       // the Daily Challenge 7 days in a row
        { id: 'lagoon', name: 'Lagoon', quests: 25, c: ['#22d6c4', '#1f6fbf'] },    // 25 quests done
        { id: 'copper', name: 'Copper', mine: 20, c: ['#e08a4c', '#8f4a24'] }       // the Gem Mine's stage 20 cleared
    ];
    const themeOpen = t => t.level ? P.level >= t.level : t.rush3 ? P.rushStars >= 3 : t.streak ? P.bestStreak >= t.streak
        : t.quests ? P.quests >= t.quests : t.mine ? Mine.cleared() >= t.mine : true;
    const themeNeed = t => t.level ? `Opens at Level ${t.level}` : t.rush3 ? 'Get 3 stars in Gem Rush' : t.streak ? `Finish the Daily Challenge ${t.streak} days in a row`
        : t.mine ? `Clear stage ${t.mine} of the Gem Mine` : `Finish ${t.quests} quests`;
    function applyTheme(id) {
        if (id && id !== 'default') document.documentElement.dataset.theme = id;
        else delete document.documentElement.dataset.theme;
    }

    // a level's rewards: Zaps every level (more every 5th and 10th), a Star every 10th once Stars are open,
    // a new title every 10th, and the features and colours that open there
    function rewardsFor(n) {
        const r = { zaps: n % 10 === 0 ? 3 : n % 5 === 0 ? 2 : 1, stars: 0, opens: [] };
        if (n === FEATURES.star) r.stars++;
        if (n > FEATURES.star && n % 10 === 0) r.stars++;
        for (const [f, l] of Object.entries(FEATURES)) if (l === n) r.opens.push({ feature: f });
        for (const t of THEMES) if (t.level === n) r.opens.push({ theme: t });
        const title = TITLES.find(([l]) => l === n && l > 1);
        if (title) r.title = title[1];
        return r;
    }

    let pending = null;   // levels gained since the last level-up card
    function addXP(n) {
        if (!(n > 0)) return;
        P.xp += Math.round(n);
        const target = levelOf(P.xp);
        while (P.level < target) {
            P.level++;
            const r = rewardsFor(P.level);
            const lucky = Math.random() < 0.25 ? 1 : 0;   // a lucky bonus Zap, now and then
            addZaps(r.zaps + lucky);
            if (r.stars) addStars(r.stars);
            pending = pending || { zaps: 0, stars: 0, opens: [], lucky: 0 };
            pending.to = P.level;
            pending.zaps += r.zaps;
            pending.stars += r.stars;
            pending.lucky += lucky;
            pending.opens.push(...r.opens);
            if (r.title) pending.title = r.title;
            levelUpNow(P.level, r.zaps + lucky);
        }
        saveProfile();
        updateChip();
    }
    function levelUpNow(n, zapsGot) {
        if (n >= FEATURES.star) setStarOpen(true);
        if (!menuOpen && !isGameOver) {
            FX.banner('word_levelup');
            Sound.play('levelUp');
            Haptics.play('maxMerge');
        }
        showToast(`Level ${n}! +${zapsGot} Zap${zapsGot > 1 ? 's' : ''}`);
        const chip = $('lvl-chip');
        chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    }

    function updateChip() {
        const n = P.level, lo = xpFor(n), hi = xpFor(n + 1);
        const pct = n >= MAX_LEVEL ? 100 : Math.min(100, (P.xp - lo) / (hi - lo) * 100);
        $('lvl-num').textContent = n;
        $('lvl-fill').style.width = pct + '%';
        $('lvl-chip').querySelector('.xp-bar').classList.toggle('near', pct >= 80 && n < MAX_LEVEL);
    }

    // the level-up card: shown after a game or on the menu, once for all the levels gained since the last one
    function showLevelCard(then) {
        if (!pending) { if (then) then(); return; }
        const p = pending;
        pending = null;
        $('lu-level').textContent = p.to;
        $('lu-rank').textContent = p.title ? `New title: ${p.title}` : titleFor(p.to);
        const list = $('lu-rewards');
        list.innerHTML = '';
        const chip = (icon, text) => { const s = document.createElement('span'); s.append(icon, text); list.append(s); };
        chip(img(ICON.zap), `×${p.zaps}`);
        if (p.stars) chip(img(ICON.star), `×${p.stars}`);
        for (const o of p.opens) {
            if (o.theme) { const sw = document.createElement('i'); sw.className = 'swatch'; sw.style.background = `linear-gradient(${o.theme.c[0]}, ${o.theme.c[1]})`; chip(sw, `${o.theme.name} colours`); }
            else chip(o.feature === 'rush' ? watch() : img(ICON[o.feature] || ICON.star), FEATURE_NAME[o.feature]);
        }
        $('lu-lucky').textContent = p.lucky ? `Lucky bonus! +${p.lucky} Zap${p.lucky > 1 ? 's' : ''}` : '';
        const dbl = $('lu-double');
        dbl.style.display = inApp && Ads.rewardedReady() ? '' : 'none';
        dbl.disabled = false;
        dbl.textContent = '▶ Double';
        dbl.onclick = () => Ads.showRewarded(watched => {
            if (!watched) return;
            addZaps(p.zaps);
            if (p.stars) addStars(p.stars);
            Sound.play('claim');
            dbl.disabled = true;
            dbl.textContent = 'Doubled!';
        });
        $('lu-collect').onclick = () => { $('levelup').classList.remove('show'); Sound.play('claim'); if (then) then(); };
        $('levelup').classList.add('show');
        Sound.play('levelUp');
        Haptics.play('maxMerge');
    }

    // ---------- this game: XP gained, best gem, the game-over panel ----------
    let gameStartXP = P.xp, gameStartLevel = P.level, bestTier = -1;
    function gameOverXP() {
        const n = P.level, lo = xpFor(n), hi = xpFor(n + 1);
        const from = gameStartLevel < n ? 0 : Math.max(0, (gameStartXP - lo) / (hi - lo) * 100);
        const to = n >= MAX_LEVEL ? 100 : Math.min(100, (P.xp - lo) / (hi - lo) * 100);
        $('go-xp').style.display = '';
        $('go-level').textContent = n;
        $('go-xp-gain').textContent = `+${fmt(P.xp - gameStartXP)} XP`;
        const fill = $('go-xp-fill');
        fill.style.transition = 'none';
        fill.style.width = from + '%';
        void fill.offsetWidth;
        fill.style.transition = 'width 1.3s cubic-bezier(0.22, 1, 0.36, 1)';
        fill.style.width = to + '%';
        for (let k = 0; k < 8; k++) setTimeout(() => Sound.play('fill', k), 120 + k * 140);   // soft rising chimes as it fills
        fill.parentNode.classList.toggle('near', to >= 80 && n < MAX_LEVEL);
        const hint = $('go-xp-hint');
        hint.innerHTML = '';
        if (bestTier >= 0) { hint.append('Best gem '); const g = img(SPRITES[bestTier]); g.style.cssText = 'width:24px;height:24px;vertical-align:middle;margin:0 6px 0 2px'; hint.append(g); }
        if (n >= MAX_LEVEL) hint.append('Max level!');
        else {
            const b = document.createElement('b');
            b.textContent = `${fmt(hi - P.xp)} XP`;
            hint.append(b, ` to Level ${n + 1}${(hi - P.xp) / (hi - lo) < 0.25 ? '. Almost there!' : ''}`);
        }
    }

    // ---------- quests: three at a time, new ones every 8 hours ----------
    const QUEST_KEY = `${GAME.id}.quests`;
    const QUEST_HOURS = 8;
    const tzMs = () => new Date().getTimezoneOffset() * 60000;
    const periodNow = () => Math.floor((Date.now() - tzMs()) / (QUEST_HOURS * 3600000));
    const periodEnds = p => (p + 1) * QUEST_HOURS * 3600000 + tzMs();
    // targets from measured play: a game scores about 12,000 (1 in 10 beats 17,000, 1 in 30 beats 21,000),
    // the best combo in a game is about 15, and an hour makes about 131 Turquoise, 49 Gold Nuggets,
    // 13 Rubies and 1 Opal. Easy is about 10 minutes, medium about half an hour, hard about an hour or more.
    const QUEST_POOL = {
        easy: [{ k: 'make', t: 6, n: 30 }, { k: 'make', t: 7, n: 10 }, { k: 'games', n: 4 }, { k: 'score1', n: 12000 }, { k: 'combo', n: 15 }],
        medium: [{ k: 'make', t: 7, n: 25 }, { k: 'make', t: 8, n: 6 }, { k: 'score1', n: 17000 }, { k: 'total', n: 120000 }, { k: 'combo', n: 21 }, { k: 'rush', n: 2 }],
        hard: [{ k: 'make', t: 8, n: 14 }, { k: 'make', t: 9, n: 1 }, { k: 'total', n: 300000 }, { k: 'score1', n: 21000 }, { k: 'combo', n: 29 }, { k: 'rush', n: 3 }, { k: 'games', n: 20 }]
    };
    const QUEST_REWARD = { easy: { xp: 3000, zaps: 1, stars: 0 }, medium: { xp: 8000, zaps: 2, stars: 0 }, hard: { xp: 20000, zaps: 2, stars: 1 } };
    let Q = (() => { try { return JSON.parse(localStorage.getItem(QUEST_KEY)); } catch (e) { return null; } })();
    const saveQuests = () => { try { localStorage.setItem(QUEST_KEY, JSON.stringify(Q)); } catch (e) {} };
    const poolFor = d => QUEST_POOL[d].filter(q => (q.k !== 'rush' || featureOpen('rush')) && (q.k !== 'make' || q.t < TIERS.length - 1));
    function newQuests(period) {
        const pick = seededRandom(period * 7919 + 101);
        return { period, list: ['easy', 'medium', 'hard'].map(d => {
            const pool = poolFor(d);
            return { d, q: pool[Math.floor(pick() * pool.length)], have: 0, claimed: false, swapped: false, told: false };
        }) };
    }
    function grantQuest(s, times) {
        const r = QUEST_REWARD[s.d];
        addZaps(r.zaps * times);
        if (r.stars) addStars(r.stars * times);
        addXP(r.xp);
        s.claimed = true;
        P.quests++;
        if (P.quests === 25) showToast('Lagoon colours opened!');
        saveProfile();
    }
    function ensureQuests() {
        const now = periodNow();
        if (Q && Q.period === now && Array.isArray(Q.list)) return;
        // quests finished but not collected before the change still pay out
        let paid = 0;
        if (Q && Array.isArray(Q.list)) for (const s of Q.list) if (!s.claimed && s.have >= s.q.n) { grantQuest(s, 1); paid++; }
        Q = newQuests(now);
        saveQuests();
        if (paid) showToast(`Quest rewards collected (${paid})`);
    }
    function questDone(s) { return s.have >= s.q.n; }
    function questUpdate(fn) {
        if (!featureOpen('quests')) return;
        ensureQuests();
        let changed = false;
        for (const s of Q.list) {
            if (s.claimed || questDone(s)) continue;
            const before = s.have;
            fn(s.q, s);
            if (s.have !== before) changed = true;
            if (questDone(s) && !s.told) {
                s.told = true;
                showToast('Quest complete!');
                Sound.play('claim');
            }
        }
        if (changed) saveQuests();
    }
    function questText(q) {
        if (q.k === 'make') return [img(SPRITES[q.t]), `Make ${q.n}`];
        if (q.k === 'games') return [img(ICON.quests), `Play ${q.n} games`];
        if (q.k === 'score1') return [img(ICON.daily), `Score ${fmt(q.n)} in one game`];
        if (q.k === 'total') return [img(ICON.daily), `Score ${fmt(q.n)} in all`];
        if (q.k === 'combo') return [img(ICON.zap), `Get a ${q.n}x combo`];
        return [watch(), `Get ${q.n} stars in Gem Rush`];
    }
    function timeLeft(ms) {
        const m = Math.max(0, Math.floor(ms / 60000));
        return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    }
    function renderQuests() {
        ensureQuests();
        $('quests-timer').textContent = `New quests in ${timeLeft(periodEnds(Q.period) - Date.now())}`;
        const list = $('quest-list');
        list.innerHTML = '';
        for (const s of Q.list) {
            const q = s.q, done = questDone(s), r = QUEST_REWARD[s.d];
            const card = document.createElement('div');
            card.className = 'quest' + (done ? ' done' : '') + (s.claimed ? ' claimed' : '');
            const head = document.createElement('div');
            head.className = 'quest-head';
            const [icon, text] = questText(q);
            const label = document.createElement('span');
            label.textContent = text;
            const diff = document.createElement('span');
            diff.className = 'diff';
            diff.textContent = s.d.toUpperCase();
            head.append(icon, label, diff);
            const bar = document.createElement('span');
            bar.className = 'xp-bar';
            const fill = document.createElement('i');
            fill.style.width = Math.min(100, s.have / q.n * 100) + '%';
            bar.append(fill);
            const foot = document.createElement('div');
            foot.className = 'quest-foot';
            const reward = (icon2, t) => { const e = document.createElement('span'); e.className = 'reward'; e.append(icon2, t); foot.append(e); };
            reward(img(ICON.zap), `×${r.zaps}`);
            if (r.stars) reward(img(ICON.star), `×${r.stars}`);
            reward('', `+${short(r.xp)} XP`);
            const button = (cls, t, fn) => { const b = document.createElement('button'); b.className = `pill small ${cls}`; b.textContent = t; b.onclick = fn; foot.append(b); return b; };
            if (s.claimed) button('grey', 'Done ✓').disabled = true;
            else if (done) {
                if (inApp && Ads.rewardedReady()) button('yellow', '▶ ×2', () => Ads.showRewarded(w => { if (w && !s.claimed) { grantQuest(s, 2); afterClaim(); } }));
                button('green', 'Claim', () => { if (!s.claimed) { grantQuest(s, 1); afterClaim(); } });
            } else {
                const prog = document.createElement('span');
                prog.textContent = q.k === 'total' || q.k === 'score1' ? `${short(Math.min(s.have, q.n))}/${short(q.n)}` : `${Math.min(s.have, q.n)}/${q.n}`;
                foot.append(prog);
                if (inApp && !s.swapped && Ads.rewardedReady()) button('', '▶ Swap', () => Ads.showRewarded(w => {
                    if (!w) return;
                    const pool = poolFor(s.d).filter(x => JSON.stringify(x) !== JSON.stringify(q));
                    s.q = pool[(pool.indexOf(q) + 1 + Math.floor(Math.random() * pool.length)) % pool.length];
                    s.have = 0; s.swapped = true; s.told = false;
                    saveQuests(); renderQuests();
                }));
            }
            card.append(head, bar, foot);
            list.append(card);
        }
    }
    function afterClaim() {
        saveQuests();
        Sound.play('claim');
        Haptics.play('praise', 2);
        renderQuests();
        updateMenu();
        if (pending && !menuOpen) showLevelCard();
    }
    const claimable = () => featureOpen('quests') && (ensureQuests(), Q.list.some(s => questDone(s) && !s.claimed));

    // ---------- Gem Rush: 90 seconds, stars for the score ----------
    const RUSH_MS = 90000;
    const RUSH_STARS = [8000, 11500, 14000];   // measured 90-second runs: about 1 in 5 below 8,000, half above 11,000, 1 in 12 above 14,000
    const RUSH_REWARD = [{ xp: 1000 }, { xp: 3000, zaps: 1 }, { xp: 6000, zaps: 1, stars: 1 }];   // for each star reached
    let rushLeft = RUSH_MS, rushStarted = false, rushExtended = false, rushPaid = 0, lastTick = 0, last = performance.now();
    const rushStarsFor = sc => RUSH_STARS.filter(t => sc >= t).length;
    function rushUI() {
        const sec = Math.ceil(rushLeft / 1000);
        $('rush-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        $('rush-fill').style.width = (rushLeft / RUSH_MS * 100) + '%';
        $('rush-timer').classList.toggle('urgent', rushStarted && sec <= 10);
    }
    function rushTick() {
        const now = performance.now(), dt = now - last;
        last = now;
        if (!rushStarted || isGameOver || menuOpen || document.hidden || Ads.isShowing() || document.querySelector('.overlay.show')) return;
        rushLeft -= dt;
        if (rushLeft <= 0) { rushLeft = 0; rushUI(); gameOver('time'); return; }
        const sec = Math.ceil(rushLeft / 1000);
        if (sec <= 10 && sec !== lastTick) { lastTick = sec; Sound.play('tick', sec <= 5); Haptics.play('tap'); }
        rushUI();
    }
    function rushEnd(reason, sc) {
        const stars = rushStarsFor(sc);
        const box = $('go-stars');
        box.style.display = 'flex';
        [...box.children].forEach((st, i) => {
            st.classList.remove('on');
            if (i < stars) setTimeout(() => { st.classList.add('on'); Sound.play('star', i); Haptics.play('merge', 4 + i, 0); }, 350 + i * 380);
        });
        // rewards for the stars reached that weren't paid yet (an extended run can reach more)
        for (let i = rushPaid; i < stars; i++) {
            const r = RUSH_REWARD[i];
            if (r.zaps) addZaps(r.zaps);
            if (r.stars) addStars(r.stars);
            addXP(r.xp);
        }
        rushPaid = Math.max(rushPaid, stars);
        if (stars >= 3 && P.rushStars < 3) setTimeout(() => showToast('Ember colours opened!'), 1600);
        P.rushStars = Math.max(P.rushStars, stars);
        saveProfile();
        questUpdate((q, s) => { if (q.k === 'rush') s.have = Math.max(s.have, stars); });
        $('more-time').style.display = reason === 'time' && inApp && !rushExtended && Ads.rewardedReady() ? '' : 'none';
    }
    function initRush() {
        document.getElementById('best-box').style.display = 'none';
        $('rush-timer').style.display = '';
        const exit = $('btn-exit-daily');
        exit.style.display = '';
        exit.onclick = () => goHome();
        rushUI();
        setTimeout(() => showToast('Hold to start the clock!'), 400);
        onGame('pickup', () => { if (!rushStarted) { rushStarted = true; last = performance.now(); } });
        setInterval(rushTick, 100);
        $('btn-more-time').onclick = () => Ads.showRewarded(watched => {
            if (!watched) return;
            rushExtended = true;
            rushLeft = 15000;
            lastTick = 0;
            isGameOver = false;
            dangerTimer = 0;
            ['go-stars', 'go-xp', 'more-time', 'revive', 'go-unlock'].forEach(id => { $(id).style.display = 'none'; });
            $('gameover').classList.remove('show');
            rushUI();
        });
    }

    // ---------- home menu ----------
    const SESSION = `${GAME.id}.session`, MENU_NEXT = `${GAME.id}.menuNext`;
    let menuOpen = false;
    function openedCount() { return THEMES.filter(themeOpen).length + SKINS.filter((sk, i) => skinOpen(i)).length; }
    function tile(id, feature, sub, news) {
        const t = $(id);
        const locked = feature && !featureOpen(feature);
        t.classList.toggle('locked', !!locked);
        t.classList.toggle('has-news', !locked && !!news);
        t.querySelector('small').textContent = locked ? `Level ${FEATURES[feature]}` : sub;
    }
    function updateMenu() {
        const n = P.level, lo = xpFor(n), hi = xpFor(n + 1);
        $('menu-level').textContent = n;
        $('menu-rank-name').textContent = titleFor(n);
        const pct = n >= MAX_LEVEL ? 100 : Math.min(100, (P.xp - lo) / (hi - lo) * 100);
        $('menu-xp-fill').style.width = pct + '%';
        $('menu-xp-fill').parentNode.classList.toggle('near', pct >= 80 && n < MAX_LEVEL);
        $('menu-xp-text').textContent = n >= MAX_LEVEL ? 'Max level' : `${fmt(P.xp - lo)} / ${fmt(hi - lo)} XP`;
        let best = 0, rushBest = 0;
        try { best = parseInt(localStorage.getItem(`${GAME.id}.best`), 10) || 0; rushBest = parseInt(localStorage.getItem(`${GAME.id}.best.rush`), 10) || 0; } catch (e) {}
        $('menu-best-val').textContent = fmt(best);
        const daily = doneToday();
        tile('tile-daily', 'daily', daily ? 'Done today ✓' : goalText(GOAL), !daily);
        tile('tile-rush', 'rush', rushBest ? `Best ${fmt(rushBest)}` : '90 seconds', false);
        $('tile-mine').style.display = GAME.mine ? '' : 'none';
        if (GAME.mine) tile('tile-mine', 'mine', Mine.tileText(), Mine.hasNews());
        ensureQuests();
        tile('tile-quests', 'quests', `New in ${timeLeft(periodEnds(Q.period) - Date.now())}`, claimable());
        tile('tile-gems', null, 'Gems & colours', openedCount() > P.seen);
        // what opens next (anticipation): a feature or a jar colour, with its level
        const nextF = Object.entries(FEATURES).filter(([, l]) => l > n).sort((a, c) => a[1] - c[1])[0];
        const nextT = THEMES.filter(t => t.level > n).sort((a, c) => a.level - c.level)[0];
        const box = $('menu-next');
        box.innerHTML = '';
        if (nextF && (!nextT || nextF[1] <= nextT.level)) {
            box.append(nextF[0] === 'rush' ? watch() : img(ICON[nextF[0]] || ICON.star), `${FEATURE_NAME[nextF[0]]} at Level ${nextF[1]}`);
        } else if (nextT) {
            const sw = document.createElement('i');
            sw.className = 'swatch';
            sw.style.background = `linear-gradient(${nextT.c[0]}, ${nextT.c[1]})`;
            box.append(sw, `${nextT.name} colours at Level ${nextT.level}`);
        }
        box.style.display = box.childNodes.length ? '' : 'none';
    }
    function floaters() {
        const box = $('menu-floaters');
        box.innerHTML = '';
        const spots = [[6, 12], [78, 8], [86, 30], [3, 40], [88, 47], [8, 91], [78, 93]];   // % positions, clear of the buttons
        spots.forEach(([x, y], i) => {
            const g = img(SPRITES[(i * 3 + 1) % SPRITES.length]);
            const size = 34 + (i % 3) * 21;
            g.style.cssText = `left:${x}%;top:${y}%;width:${size}px;height:${size}px;--dur:${6 + (i % 4) * 1.618}s;animation-delay:-${i * 1.3}s`;
            box.append(g);
        });
    }
    function openMenu() {
        menuOpen = true;
        Runner.stop(runner);
        updateMenu();
        floaters();
        $('menu').style.display = 'flex';
        if (pending) setTimeout(() => { if (menuOpen) showLevelCard(); }, 500);
    }
    function closeMenu() {
        menuOpen = false;
        $('menu').style.display = 'none';
        if (!document.querySelector('.overlay.show')) Runner.run(runner, engine);
    }
    function lockedTap(feature) {
        if (!feature || featureOpen(feature)) return false;
        showToastMenu(`${FEATURE_NAME[feature]} opens at Level ${FEATURES[feature]}`);
        return true;
    }
    // the board's message bubble is behind the menu; show menu messages on the menu itself
    function showToastMenu(text) {
        let t = $('menu-toast');
        if (!t) { t = document.createElement('div'); t.id = 'menu-toast'; t.style.cssText = 'position:absolute;left:50%;bottom:13%;transform:translateX(-50%);z-index:2;padding:8px 18px;border-radius:18px;background:rgba(20,12,50,.85);font-weight:800;font-size:14px;white-space:nowrap;opacity:0;transition:opacity .25s'; $('menu').append(t); }
        t.textContent = text;
        t.style.opacity = 1;
        clearTimeout(showToastMenu.timer);
        showToastMenu.timer = setTimeout(() => { t.style.opacity = 0; }, 2000);
    }
    function initMenu() {
        $('menu-play').onclick = () => { Sound.unlock(); Sound.play('tap'); closeMenu(); maybeTutorial(); };
        $('menu-settings').onclick = () => { Sound.play('tap'); settings.classList.add('show'); };
        $('tile-daily').onclick = () => { Sound.play('tap'); if (lockedTap('daily')) return; saveGame(); location.href = location.pathname + '?daily'; };
        $('tile-rush').onclick = () => { Sound.play('tap'); if (lockedTap('rush')) return; saveGame(); location.href = location.pathname + '?rush'; };
        $('tile-mine').onclick = () => { Sound.unlock(); Sound.play('tap'); if (lockedTap('mine')) return; Mine.openMap(); };
        $('tile-quests').onclick = () => { Sound.play('tap'); if (lockedTap('quests')) return; renderQuests(); $('quests').classList.add('show'); };
        $('tile-gems').onclick = () => { Sound.play('tap'); openCollection(true); };
        $('btn-close-quests').onclick = () => { $('quests').classList.remove('show'); updateMenu(); if (!menuOpen) Runner.run(runner, engine); };
        // the settings panel opened from the menu: keep the game paused behind the menu when it closes
        $('btn-close-settings').addEventListener('click', () => { if (menuOpen) Runner.stop(runner); });
        setInterval(() => { if (menuOpen) updateMenu(); if ($('quests').classList.contains('show')) $('quests-timer').textContent = `New quests in ${timeLeft(periodEnds(Q.period) - Date.now())}`; }, 30000);
    }
    goHome = () => {
        if (DAILY || RUSH || MINE) {
            try { sessionStorage.setItem(MENU_NEXT, '1'); if (MINE) sessionStorage.setItem(`${GAME.id}.mapNext`, '1'); } catch (e) {}   // a stage: back to the map
            location.href = location.pathname;
        } else {
            settings.classList.remove('show');
            openMenu();
        }
    };

    // the Collection (gem sets and jar colours), from the menu or the settings
    function openCollection(fromMenu) {
        renderSets();
        renderThemes();
        P.seen = openedCount();
        saveProfile();
        const c = $('collection');
        c.dataset.from = fromMenu ? 'menu' : 'settings';
        if (!fromMenu) settings.classList.remove('show');
        c.classList.add('show');
    }
    function renderThemes() {
        $('themes-title').style.display = '';
        const box = $('themes');
        box.innerHTML = '';
        for (const t of THEMES) {
            const open = themeOpen(t);
            const b = document.createElement('button');
            b.className = 'theme' + (open ? '' : ' locked') + ((P.theme || 'default') === t.id ? ' on' : '');
            const sw = document.createElement('i');
            sw.style.background = `linear-gradient(${t.c[0]}, ${t.c[1]})`;
            const label = document.createElement('span');
            if (open) label.textContent = t.name;
            else {
                label.className = 'need-chip';
                if (t.level) label.append(img(ICON.star), String(t.level));
                else if (t.rush3) label.append(watch(), '3★');
                else if (t.streak) label.append(img(ICON.daily), String(t.streak));
                else if (t.mine) label.append(img(ICON.mine), String(t.mine));
                else label.append(img(ICON.quests), String(t.quests));
            }
            b.append(sw, label);
            b.onclick = () => {
                if (!open) { showToast(themeNeed(t)); if (menuOpen) showToastMenu(themeNeed(t)); return; }
                P.theme = t.id;
                saveProfile();
                applyTheme(t.id);
                Sound.play('tap');
                renderThemes();
            };
            box.append(b);
        }
    }

    // ---------- first-time tutorial ----------
    let tut = 0;
    const ring = $('tut-ring'), bubble = $('tut-bubble');
    function tutShow(text, at, slide) {
        $('tut-text').textContent = text;
        bubble.style.display = 'block';
        ring.style.display = at ? 'block' : 'none';
        if (at) { ring.style.left = (at.x / GAME_WIDTH * 100) + '%'; ring.style.top = (at.y / GAME_HEIGHT * 100) + '%'; }
        ring.classList.toggle('slide', !!slide);
    }
    function sameGemSpot() {
        const g = Composite.allBodies(engine.world).filter(b => b.tier === currentTier && !b.isDropping).sort((a, c) => a.bounds.min.y - c.bounds.min.y)[0];
        return g ? { x: g.position.x, y: Math.max(60, g.bounds.min.y - 34) } : { x: 225, y: 420 };
    }
    function maybeTutorial() {
        if (P.tutorial || DAILY || RUSH || MINE) return;
        if (Composite.allBodies(engine.world).some(b => b.tier !== undefined) || score > 0) { P.tutorial = true; saveProfile(); return; }   // a returning player
        tut = 1;
        currentTier = 0;
        nextTier = 1;
        updateUI();
        tutShow('Hold anywhere on the jar to pick up the gem', { x: 225, y: 420 });
    }
    function endTutorial() {
        tut = 0;
        P.tutorial = true;
        saveProfile();
        ring.style.display = bubble.style.display = 'none';
        document.querySelector('.danger-line').classList.remove('highlight');
    }
    function initTutorial() {
        $('tut-skip').onclick = endTutorial;
        onGame('pickup', () => { if (tut === 1) { tut = 2; tutShow('Slide to aim, then let go to drop it', { x: 225, y: 420 }, true); } });
        onGame('drop', (tier) => {
            if (tut === 2 || tut === 3) {
                tut = 3;
                // the next gem is the same kind, so it can merge with the one on the board
                setTimeout(() => {
                    if (tut !== 3) return;
                    currentTier = tier;
                    updateUI();
                    tutShow('Two of the same gem merge into a better one. Drop it on its twin!', sameGemSpot());
                }, 650);
            }
        });
        onGame('merge', () => {
            if (tut !== 3) return;
            tut = 4;
            tutShow('Merges in a row make combos and big points!');
            setTimeout(() => {
                if (tut !== 4) return;
                tut = 5;
                document.querySelector('.danger-line').classList.add('highlight');
                tutShow('Keep the gems under this line, or the jar fills up!');
                setTimeout(() => { if (tut === 5) { endTutorial(); showToast("You're ready. Have fun!"); } }, 3800);
            }, 3200);
        });
    }

    // ---------- listening to the game ----------
    onGame('merge', (tier, points, comboNow, seeded) => {
        bestTier = Math.max(bestTier, tier);
        addXP(points);
        questUpdate((q, s) => {
            if (q.k === 'make' && q.t === tier) { if (!seeded) s.have++; }   // (not gems made from ones a stage gave)
            else if (q.k === 'total') s.have += points;
            else if (q.k === 'score1') s.have = Math.max(s.have, score);
            else if (q.k === 'combo') s.have = Math.max(s.have, comboNow);
        });
    });
    onGame('gameOver', (reason, sc) => {
        questUpdate((q, s) => { if (q.k === 'games') s.have++; });
        if (RUSH) rushEnd(reason, sc);
        gameOverXP();
        $('btn-go-home').style.display = '';
        setTimeout(() => { if ($('gameover').classList.contains('show')) showLevelCard(); }, 1500);
    });
    onGame('revive', () => { $('go-xp').style.display = 'none'; $('go-stars').style.display = 'none'; });
    onGame('daily', streak => {
        addXP(10000);
        if (streak >= 7 && P.bestStreak < 7) setTimeout(() => showToast('Frost colours opened!'), 2600);
        P.bestStreak = Math.max(P.bestStreak, streak);
        saveProfile();
    });

    // ---------- start ----------
    if (P.seen < 0) { P.seen = openedCount(); saveProfile(); }   // a new player: nothing new to see yet
    applyTheme(themeOpen(THEMES.find(t => t.id === P.theme) || THEMES[0]) ? P.theme : 'default');
    if (levelOf(P.xp) > P.level) addXP(0.0001);   // catch up on levels from an older save
    setStarOpen(featureOpen('star'));
    $('btn-go-home').onclick = () => Ads.showInterstitial(() => {
        clearSave();
        try { sessionStorage.setItem(MENU_NEXT, '1'); } catch (e) {}
        location.href = location.pathname;
    });
    if (GAME.menu) {
        $('btn-home').style.display = '';
        $('btn-home').onclick = () => goHome();
        initMenu();
    }
    // the Collection from the settings also shows the jar colours
    $('btn-gems').addEventListener('click', () => { renderThemes(); P.seen = openedCount(); saveProfile(); });
    initTutorial();
    if (RUSH) initRush();
    else if (!DAILY && !MINE) {
        $('lvl-chip').style.display = '';
        $('lvl-chip').onclick = () => { Sound.play('tap'); goHome(); };
        updateChip();
    }
    let showMenu = false;
    try {
        showMenu = GAME.menu && !DAILY && !RUSH && !MINE && (!sessionStorage.getItem(SESSION) || !!sessionStorage.getItem(MENU_NEXT));
        sessionStorage.setItem(SESSION, '1');
        sessionStorage.removeItem(MENU_NEXT);
    } catch (e) {}
    if (showMenu) openMenu();
    else if (!DAILY && !RUSH && !MINE) setTimeout(maybeTutorial, 300);

    // for tests, the console and the Gem Mine (mine.js)
    window.Meta = { P, xpFor, levelOf, addXP, openMenu, renderQuests, get quests() { ensureQuests(); return Q; }, rushStarsFor, THEMES, applyTheme,
        refreshMenu: () => updateMenu(), featureOpen,
        get tutorialStep() { return tut; }, get rushLeft() { return rushLeft; }, set rushLeft(v) { rushLeft = v; }, get menuOpen() { return menuOpen; } };
})();
