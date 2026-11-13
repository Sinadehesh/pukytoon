// --- SOUND ---
// Recorded sound effects (assets/sfx, CC0: Kenney + OpenGameArt pops, see assets/sfx/CREDITS.txt),
// narrator voice lines (assets/voice, see assets/voice/CREDITS.txt), and background songs by Kevin MacLeod
// (assets/music, CC BY 4.0, credited in the settings and assets/music/CREDITS.txt).
// Sound can be switched off and the song picked (or switched off) in the settings; the choice is remembered.

const Sound = (() => {
    const KEY = `${GAME.id}.audio`;
    // music = index into SONGS, or -1 for off
    let prefs = { sfx: true, music: 0, voice: true };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY)) }; } catch (e) {}
    if (typeof prefs.music !== 'number') prefs.music = prefs.music === false ? -1 : 0;   // older saves stored true/false
    const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} };

    // ---------- recordings ----------

    const SAMPLES = ['drop', 'land', 'pop_1', 'pop_2', 'pop_3', 'pop_4', 'pop_5', 'pop_6', 'bubble_1', 'bubble_2', 'bubble_3',
        'bubble_big', 'chime', 'praise', 'fanfare', 'gameover', 'tap',
        ...(GAME.mine ? ['crate_break_1', 'crate_break_2', 'crate_bits', 'crate_hit'] : [])]   // Gem Mine crates
        .map(n => [n, `assets/sfx/${n}.wav`]);
    // The narrator (assets/voice): the combo words in ladder order, matching the words on screen,
    // plus the lines for the biggest item, a new best and game over.
    const PRAISE_VOICES = GAME.praise;   // config.js
    PRAISE_VOICES.forEach(n => SAMPLES.push([`praise_${n}`, `assets/voice/${n}.mp3`]));
    ['congratulations', 'new_highscore', 'game_over'].forEach(n => SAMPLES.push([`voice_${n}`, `assets/voice/${n}.mp3`]));

    // download everything now; decode once audio is unlocked
    const raw = {}, buffers = {};
    SAMPLES.forEach(([name, url]) => {
        raw[name] = fetch(url).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
    });
    function decodeAll() {
        SAMPLES.forEach(([name]) => raw[name].then(data => {
            if (!data || buffers[name]) return;
            ac.decodeAudioData(data.slice(0), b => { buffers[name] = b; }, () => {});
        }));
    }

    let ac = null, sfxBus = null;

    // Start audio on the first tap (browsers block sound until then)
    function unlock() {
        if (!ac) {
            try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
            sfxBus = ac.createGain(); sfxBus.gain.value = prefs.sfx ? 1 : 0;
            sfxBus.connect(ac.destination);
            decodeAll();
        }
        if (ac.state === 'suspended') ac.resume();
        Music.play();
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (ac) ac.suspend(); Music.pause(); }
        else { if (ac) ac.resume(); Music.play(); }
    });

    // play a recording; rate < 1 is lower and slower, > 1 higher and quicker
    function sample(name, { gain = 1, rate = 1, when = 0, out = sfxBus } = {}) {
        const b = buffers[name];
        if (!ac || !b) return;
        const src = ac.createBufferSource(), g = ac.createGain();
        src.buffer = b; src.playbackRate.value = rate; g.gain.value = gain;
        src.connect(g); g.connect(out);
        src.start(ac.currentTime + when);
    }
    const pick = (...names) => names[Math.floor(Math.random() * names.length)];
    const jitter = (r, amount = 0.04) => r * (1 + (Math.random() * 2 - 1) * amount);   // so repeats don't sound identical
    const semitones = n => Math.pow(2, n / 12);
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // combo chime climbs a pentatonic scale

    // ---------- narrator: one line at a time ----------
    // He never talks over himself. A line that comes in while he is talking waits until he is done.
    // If more lines come in meanwhile, only the most important one waits (game over, then
    // congratulations, then new high score, then the higher combo word; the newest on a tie) and the
    // others are dropped. Each line's word, sparkle and buzz (onStart) happen when its voice starts,
    // so the screen always matches what he says.
    const GAP = 0.12;          // short breath between two lines, seconds
    let talkingUntil = 0, queued = null, queueTimer = 0;

    // He also speaks a quarter less than the game asks: every 4th of the lines that come up all the time
    // (combo words, game over; marked often) stays silent, and with Voice off he is silent. The word on
    // screen, its sparkle and its buzz still come.
    let oftenCount = 0;
    function say(line) {   // { name, level, rank, when (delay after the event), extra(delay), onStart(), often }
        const quiet = !prefs.voice || (line.often && ++oftenCount % 4 === 0);
        const b = quiet ? null : buffers[line.name];
        if (!b) { if (line.extra) line.extra(0); if (line.onStart) line.onStart(); return; }   // not loaded yet: no voice
        const at = ac.currentTime + (line.when || 0);
        if (at >= talkingUntil && !queued) { speak(line, at); return; }
        if (!queued || line.rank >= queued.rank) queued = line;
        clearTimeout(queueTimer);
        queueTimer = setTimeout(() => {
            const next = queued; queued = null;
            if (next) speak(next, Math.max(ac.currentTime, talkingUntil) + (next.when ? 0.05 : 0));
        }, Math.max(0, (talkingUntil - ac.currentTime) * 1000));
    }

    // The recording as it is (no pitch change), a little warmer, louder and punchier the higher up
    // the combo ladder; the music dips while he talks
    function speak(line, at) {
        const b = buffers[line.name], level = line.level || 0, delay = Math.max(0, at - ac.currentTime);
        talkingUntil = at + b.duration + GAP;
        const warm = ac.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 200; warm.gain.value = 1 + level * 1.2;
        const punch = ac.createDynamicsCompressor();
        punch.threshold.value = -18 - level * 2.5; punch.ratio.value = 2.5 + level; punch.attack.value = 0.004; punch.release.value = 0.18;
        warm.connect(punch); punch.connect(sfxBus);
        sample(line.name, { gain: 1 + level * 0.08, when: delay, out: warm });
        if (line.extra) line.extra(delay);
        Music.duck(delay + b.duration);
        // the word shows with the event (a line that waited shows when he starts it)
        const show = Math.max(0, delay - (line.when || 0)) * 1000;
        if (line.onStart) { if (show < 20) line.onStart(); else setTimeout(line.onStart, show); }
    }
    const praiseName = level => `praise_${PRAISE_VOICES[Math.min(level, PRAISE_VOICES.length - 1)]}`;

    // ---------- game sounds ----------

    const sfx = {
        // releasing a fruit
        drop() { sample('drop', { gain: 0.35, rate: jitter(1) }); },
        // landing on the pile: soft thud, bigger items a little deeper
        land(tier) { sample('land', { gain: 0.3, rate: jitter(Math.max(0.6, 1.15 - tier * 0.05)) }); },
        // merging: a mouth pop plus a bubble, lower for bigger items; big ones get a deep bubble
        pop(tier) {
            const r = Math.max(0.6, 1.25 - tier * 0.06);
            sample(pick('pop_1', 'pop_2', 'pop_3', 'pop_4', 'pop_5', 'pop_6'), { gain: 0.7, rate: jitter(r) });
            if (tier >= 5) sample('bubble_big', { gain: 0.55, rate: jitter(Math.max(0.7, 1.15 - (tier - 5) * 0.06)) });
            else sample(pick('bubble_1', 'bubble_2', 'bubble_3'), { gain: 0.45, rate: jitter(r * 1.05), when: 0.015 });
        },
        // each step of a combo: a glassy chime, one note higher each time
        combo(step) { sample('chime', { gain: 0.4, rate: semitones(PENTA[Math.min(step, PENTA.length - 1)]) }); },
        // praise word (SWEET! ... INCREDIBLE!) with a soft sparkle under it; onStart shows the word
        praise(level, onStart) {
            const strength = GAME.strength(level);
            say({ name: praiseName(level), level: strength, rank: level, onStart, often: true,
                extra: d => sample('praise', { gain: 0.3, rate: semitones(strength), when: d }) });
        },
        // biggest item made: fanfare right away, then CONGRATULATIONS!
        maxMerge(onStart) { sample('fanfare', { gain: 0.45 }); say({ name: 'voice_congratulations', level: 4, rank: 7, when: 0.25, onStart }); },
        newBest() {
            say({ name: 'voice_new_highscore', level: 2, rank: 6,
                extra: d => sample('praise', { gain: 0.3, rate: semitones(7), when: d + 1.8 }) });
        },
        gameOver() { sample('gameover', { gain: 0.45 }); say({ name: 'voice_game_over', level: 0, rank: 9, when: 0.3, often: true }); },
        tap() { sample('tap', { gain: 0.35 }); },
        // levels, quests and Gem Rush (meta.js): soft fanfares and rising glassy chimes
        levelUp() {
            sample('fanfare', { gain: 0.38 });
            [0, 4, 7, 12].forEach((n, i) => sample('chime', { gain: 0.28, rate: semitones(n + 12), when: 0.32 + i * 0.09 }));
        },
        claim() { [0, 4, 7, 12, 16].forEach((n, i) => sample('chime', { gain: 0.26, rate: semitones(n + 7), when: i * 0.07 })); },
        star(i) { sample('chime', { gain: 0.38, rate: semitones([12, 16, 19][i] || 12) }); sample('praise', { gain: 0.22, rate: semitones(i * 2) }); },
        tick(urgent) { sample('tap', { gain: urgent ? 0.4 : 0.22, rate: urgent ? 1.55 : 1.25 }); },
        // Gem Mine (mine.js): a crate cracking (a knock), or breaking (a crisp crack and falling splinters)
        crate(broke) {
            if (broke) {
                sample(pick('crate_break_1', 'crate_break_2'), { gain: 0.6, rate: jitter(1, 0.08) });
                sample('crate_bits', { gain: 0.32, rate: jitter(1.05, 0.1), when: 0.06 });
                sample(pick('bubble_1', 'bubble_2', 'bubble_3'), { gain: 0.2, rate: jitter(1.3), when: 0.02 });
            } else sample('crate_hit', { gain: 0.5, rate: jitter(1.1, 0.06) });
        },
        stageClear() {
            sample('fanfare', { gain: 0.45 });
            [0, 4, 7, 12, 16].forEach((n, i) => sample('chime', { gain: 0.28, rate: semitones(n + 12), when: 0.3 + i * 0.08 }));
            say({ name: 'voice_congratulations', level: 4, rank: 7, when: 0.4, often: true });
        },
        outOfDrops() { sample('gameover', { gain: 0.3, rate: 1.12 }); },
        fill(k) { sample('chime', { gain: 0.12, rate: semitones(PENTA[Math.min(k, PENTA.length - 1)] + 12) }); }
    };

    // ---------- music: songs by Kevin MacLeod, one plays on repeat ----------

    const SONGS = [
        { title: 'Carefree', file: 'carefree' },
        { title: 'Easy Lemon', file: 'easy_lemon' },
        { title: 'Wallpaper', file: 'wallpaper' },
        { title: 'Monkeys Spinning Monkeys', file: 'monkeys_spinning_monkeys' }
    ];
    const MUSIC_VOLUME = 0.35;

    const Music = (() => {
        let audio = null, loaded = -1, started = false;
        return {
            play() {
                if (prefs.music < 0) return;
                if (!audio) { audio = new Audio(); audio.loop = true; audio.volume = MUSIC_VOLUME; }
                if (loaded !== prefs.music) { audio.src = `assets/music/${SONGS[prefs.music].file}.mp3`; loaded = prefs.music; }
                started = true;
                audio.play().catch(() => {});   // blocked until the first tap; unlock() calls this again then
            },
            pause() { if (audio) audio.pause(); },
            // dip the song for a few seconds so the narrator is clear
            duck(seconds) {
                if (!audio) return;
                clearTimeout(this.unduck);
                audio.volume = MUSIC_VOLUME * 0.4;
                this.unduck = setTimeout(() => { audio.volume = MUSIC_VOLUME; }, (seconds + 0.25) * 1000);
            },
            stop() { if (audio) { audio.pause(); audio.currentTime = 0; } }
        };
    })();

    // Play a game sound. With sound off (or before the first tap) nothing plays, but a callback
    // (the praise word on screen) still runs right away.
    function play(name, ...args) {
        if (ac && prefs.sfx && sfx[name]) sfx[name](...args);
        else args.forEach(a => { if (typeof a === 'function') a(); });
    }

    function setSfx(on) { prefs.sfx = on; savePrefs(); if (sfxBus) sfxBus.gain.value = on ? 1 : 0; }
    // next song, and after the last one: off
    function nextMusic() {
        prefs.music = prefs.music + 1 >= SONGS.length ? -1 : prefs.music + 1;
        savePrefs();
        if (prefs.music < 0) Music.stop(); else Music.play();
    }
    const songTitle = () => prefs.music < 0 ? null : SONGS[prefs.music].title;

    function setVoice(on) { prefs.voice = on; savePrefs(); }

    return { unlock, play, setSfx, setVoice, nextMusic, songTitle, prefs: () => ({ ...prefs }) };
})();
