// For games that weren't written for Pukytoon (Gem Jar, Zombie Bomber): makes a game built for its own page
// behave in the feed, without changing its code. Load it right after pukytoon-sdk.js and before everything
// else on the page, libraries included (Matter.js keeps its own reference to requestAnimationFrame).
//
// While the app has the game paused (under its Play cover in the feed, or after Back):
//   - its animation frames wait and its clock (performance.now) stands still, so it carries on later exactly
//     where it was, with no jump;
//   - its sound is off: audio contexts are suspended and playing audio elements paused;
//   - the page reads as hidden (document.hidden, visibilitychange), so the game's own "tab is hidden"
//     handling runs too: saving, stopping music, stopping timers.
// Before the first play a frame is still let through now and then, so the game's title screen shows up under
// the cover even when its pictures arrive late.
//
// And a game that moves between pages of its own (Gem Jar's Daily Challenge, Gem Rush and Gem Mine each have
// an address) replaces its page instead of adding one to the phone's Back history, so Back always leaves the
// game for the feed at once.
// Opened on its own, outside the app, the game is left exactly as it is.
(function () {
    'use strict';
    var P = window.Pukytoon;
    if (!P || !window.parent || window.parent === window || window.__pukytoonEmbed) return;

    var frozen = false;      // paused by the app, and standing still
    var muted = false;       // the app's mute
    var played = false;      // the player has started it at least once
    var loaded = document.readyState === 'complete';
    var state = window.__pukytoonEmbed = { frozen: false, frames: 0 };   // for the tests, and for anyone curious

    // --- Time: animation frames and the clock ---

    var perf = window.performance;
    var realNow = perf.now.bind(perf);
    var raf = window.requestAnimationFrame.bind(window);
    var caf = window.cancelAnimationFrame.bind(window);
    var offset = 0;          // how far the game's clock is behind the real one (all the time it stood still)
    var frozenNow = 0;       // the game's clock while it stands still
    var held = {};           // frames asked for while frozen: our id -> callback
    var heldCount = 0;
    var real = {};           // our id -> the browser's id, once a held frame is on its way
    var nextId = 1e9;        // our ids, far above the browser's

    function now() { return frozen ? frozenNow : realNow() - offset; }
    try { perf.now = now; } catch (e) {}

    function deliver(id, cb) {
        real[id] = raf(function (t) {
            delete real[id];
            state.frames++;
            cb(frozen ? frozenNow : t - offset);
        });
    }

    window.requestAnimationFrame = function (cb) {
        var id = nextId++;
        if (frozen) { held[id] = cb; heldCount++; }
        else deliver(id, cb);
        return id;
    };
    window.cancelAnimationFrame = function (id) {
        if (held[id]) { delete held[id]; heldCount--; }
        else if (real[id] !== undefined) { caf(real[id]); delete real[id]; }
    };

    function release() {
        var waiting = held;
        held = {};
        heldCount = 0;
        for (var id in waiting) deliver(id, waiting[id]);
    }

    // One frame while frozen: the clock moves on by a frame, the picture is drawn, and it stands still again
    function peek() {
        if (!frozen || !heldCount) return;
        frozenNow += 1000 / 60;
        release();
    }

    // --- Sound ---

    var contexts = [];       // every audio context the game made
    var silenced = [];       // the ones we suspended, or that asked to resume meanwhile
    var playing = [];        // audio and video elements playing now
    var stopped = [];        // the ones we paused, or that asked to play meanwhile
    var quiet = function () { return frozen || muted; };
    var noop = function () {};
    function suspend(ctx) {
        add(silenced, ctx);
        try { var p = ctx.suspend(); if (p && p.catch) p.catch(noop); } catch (e) {}
    }

    function add(list, item) { if (list.indexOf(item) < 0) list.push(item); }
    function drop(list, item) { var i = list.indexOf(item); if (i >= 0) list.splice(i, 1); }

    function track(ctx) {
        contexts.push(ctx);
        var resume = ctx.resume.bind(ctx);
        ctx.__pukytoonResume = resume;
        ctx.resume = function () {
            if (!quiet()) return resume();
            add(silenced, ctx);          // it carries on when the game does
            return Promise.resolve();
        };
        if (quiet() && ctx.state === 'running') suspend(ctx);
        return ctx;
    }
    ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
        var Real = window[name];
        if (!Real) return;
        var Tracked = function (options) { return track(options === undefined ? new Real() : new Real(options)); };
        Tracked.prototype = Real.prototype;
        window[name] = Tracked;
    });

    var Media = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (Media) {
        var realPlay = Media.play, realPause = Media.pause;
        Media.play = function () {
            var el = this;
            if (!el.__pukytoon) {
                el.__pukytoon = true;
                el.addEventListener('pause', function () { drop(playing, el); });
                el.addEventListener('ended', function () { drop(playing, el); });
            }
            if (quiet()) { add(stopped, el); return Promise.resolve(); }
            add(playing, el);
            return realPlay.apply(el, arguments);
        };
        Media.pause = function () {
            drop(stopped, this);         // the game stopped it itself: it stays stopped
            return realPause.apply(this, arguments);
        };
    }

    // How many things are making sound right now (the tests ask)
    state.sound = function () {
        return contexts.filter(function (ctx) { return ctx.state === 'running'; }).length + playing.length;
    };

    function soundOff() {
        contexts.forEach(function (ctx) {
            if (ctx.state === 'running') suspend(ctx);
        });
        playing.slice().forEach(function (el) {
            if (!el.paused) { add(stopped, el); realPause.call(el); }
        });
    }

    function soundOn() {
        silenced.splice(0).forEach(function (ctx) {
            if (ctx.state !== 'closed') ctx.__pukytoonResume().catch(noop);
        });
        stopped.splice(0).forEach(function (el) {
            add(playing, el);
            var p = realPlay.call(el);
            if (p && p.catch) p.catch(function () { drop(playing, el); });
        });
    }

    // --- The page reads as hidden while the game is paused ---

    var proto = window.Document && window.Document.prototype;
    var hiddenGetter = proto && (Object.getOwnPropertyDescriptor(proto, 'hidden') || {}).get;
    function reallyHidden() { return hiddenGetter ? !!hiddenGetter.call(document) : false; }
    try {
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return frozen || reallyHidden(); } });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true, get: function () { return frozen || reallyHidden() ? 'hidden' : 'visible'; }
        });
    } catch (e) {}
    // The phone's own "hidden" changes nothing for a game that is paused anyway
    document.addEventListener('visibilitychange', function (e) {
        if (e.isTrusted && frozen) e.stopImmediatePropagation();
    }, true);
    function tellVisibility() {
        if (reallyHidden()) return;      // hidden either way: nothing changed for the game
        try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
    }

    // --- Pausing and carrying on ---

    function freeze() {
        if (frozen) return;
        frozenNow = now();
        frozen = state.frozen = true;
        tellVisibility();                // the game's own handling first (it may stop its music itself)...
        soundOff();                      // ...then whatever is still making sound
    }

    function thaw() {
        if (!frozen) return;
        offset = realNow() - frozenNow;
        frozen = state.frozen = false;
        release();
        if (!muted) soundOn();
        tellVisibility();
    }

    // Before the first play the game is only a picture under the Play cover. It gets a second to draw its
    // title screen, then stands still, with a frame now and then for pictures that arrive late.
    var settle = 0, trickle = 0;
    function pause() {
        if (frozen || settle) return;
        if (played) { freeze(); return; }
        var begin = function () {
            settle = setTimeout(function () {
                settle = 0;
                if (!P.state.paused) return;
                freeze();
                var left = 12;
                trickle = setInterval(function () {
                    if (!frozen || --left < 0) { clearInterval(trickle); trickle = 0; return; }
                    peek();
                }, 1000);
            }, 1000);
        };
        if (loaded) begin();
        else window.addEventListener('load', function () { loaded = true; if (P.state.paused && !frozen && !settle) begin(); });
    }

    function resume() {
        played = true;
        if (settle) { clearTimeout(settle); settle = 0; }
        if (trickle) { clearInterval(trickle); trickle = 0; }
        thaw();
    }

    // A new size while standing still: draw it again
    window.addEventListener('resize', function () {
        if (!frozen) return;
        setTimeout(peek, 60);
        setTimeout(peek, 400);
    });
    window.addEventListener('load', function () { loaded = true; });

    // --- The game's own pages don't pile up behind Back ---

    try {
        // history.pushState, for games that keep their screens in the address
        var push = window.history.pushState;
        if (push) window.history.pushState = function () { return window.history.replaceState.apply(window.history, arguments); };
        // links and location.href = ..., where the browser lets a page see its own navigations (the
        // Navigation API; without it they add to the history, and the app steps back over them on the way out)
        var nav = window.navigation;
        if (nav && nav.addEventListener) {
            nav.addEventListener('navigate', function (e) {
                if (e.navigationType !== 'push' || !e.cancelable || e.downloadRequest || e.formData) return;
                var to = e.destination && e.destination.url;
                if (!to) return;
                e.preventDefault();
                setTimeout(function () { window.location.replace(to); }, 0);
            });
        }
    } catch (e) {}

    P.on('pause', pause).on('resume', resume).on('mute', function (on) {
        muted = !!on;
        if (muted) soundOff();
        else if (!frozen) soundOn();
    });
    if (P.state.paused) pause();
})();
