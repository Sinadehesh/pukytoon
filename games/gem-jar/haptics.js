// --- VIBRATION ---
// Small buzzes you can feel: picking up and dropping a fruit, landing, every merge (stronger for bigger
// items and longer combos), praise words, the biggest item, a new best and game over.
// Android phones support buzz patterns (navigator.vibrate). iPhones don't let websites vibrate; on
// iOS 18 or newer a hidden "switch" checkbox gives one light tick, and iOS may only allow it at the
// moment your finger touches or lifts. Can be switched off in the settings; the choice is remembered.

const Haptics = (() => {
    const KEY = `${GAME.id}.vibration`;
    let on = true;
    try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}

    const canVibrate = typeof navigator.vibrate === 'function';
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // iOS: clicking the label of a hidden switch makes the phone tick
    let tickLabel = null;
    function iosTick() {
        try {
            if (!tickLabel) {
                tickLabel = document.createElement('label');
                tickLabel.setAttribute('aria-hidden', 'true');
                tickLabel.style.display = 'none';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.setAttribute('switch', '');
                tickLabel.appendChild(input);
                document.head.appendChild(tickLabel);
            }
            tickLabel.click();
        } catch (e) {}
    }

    // A new buzz replaces the one playing, so a small one (a landing) must not cut off a bigger one
    // (a praise word) that is still going. Higher priority wins until the bigger one has finished.
    let busyUntil = 0, busyPriority = 0;
    function buzz(pattern, priority) {
        if (!on || document.hidden) return;
        // Chrome ignores (and warns about) vibration before the first tap
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        const now = performance.now();
        if (now < busyUntil && priority < busyPriority) return;
        const steps = Array.isArray(pattern) ? pattern.map(Math.round) : [Math.round(pattern)];
        busyUntil = now + steps.reduce((a, b) => a + b, 0);
        busyPriority = priority;
        if (canVibrate) {
            try { navigator.vibrate(steps); } catch (e) {}
        } else if (isIOS && priority >= 1) {
            // one tick per pulse in the pattern (landings are skipped: too many, and outside a touch)
            let t = 0;
            steps.forEach((ms, i) => {
                if (i % 2 === 0) { if (t === 0) iosTick(); else setTimeout(iosTick, t); }
                t += ms;
            });
        }
    }

    // Patterns are in milliseconds: buzz, pause, buzz, ...
    const feel = {
        pickup() { buzz(10, 1); },
        drop() { buzz(14, 1); },
        land(tier) { buzz(Math.min(24, 10 + tier * 1.5), 0); },
        // stronger for bigger items; from a 3-merge combo on, a second pulse that grows with the combo
        merge(tier, combo) {
            const d = Math.min(60, 18 + tier * 4);
            buzz(combo >= 3 ? [d, 35, Math.min(70, d * 0.6 + combo * 3)] : d, 2);
        },
        praise(level) { buzz([30, 40, 30, 40, 40 + GAME.strength(level) * 15], 3); },
        maxMerge() { buzz([60, 40, 60, 40, 140], 4); },
        newBest() { buzz([25, 50, 25, 50, 80], 3); },
        gameOver() { buzz([120, 80, 250], 5); },
        tap() { buzz(8, 1); },
        // Gem Mine: a crate cracking (one knock) or breaking (a crunchy triple)
        crate(broke) { buzz(broke ? [26, 30, 22, 30, 34] : 16, broke ? 2 : 1); },
        outOfDrops() { buzz([70, 60, 110], 4); }
    };

    function play(name, ...args) { if (feel[name]) feel[name](...args); }
    function setOn(value) {
        on = value;
        try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
        if (!on && canVibrate) { try { navigator.vibrate(0); } catch (e) {} }
    }

    return { play, setOn, isOn: () => on, supported: canVibrate || isIOS };
})();
