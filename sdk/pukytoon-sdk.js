// The Pukytoon bridge, inside a game: how a game talks to the Pukytoon app around it.
// Load it before the game's own scripts. It is the game's only line to the app, through postMessage.
//
// Every message is { pukytoon: 1, type, payload }.
//   game -> app: hello, ready, save, score, event, error, haptic, pong
//   app -> game: init (save data, muted, embedded), start, pause, resume, mute, ping, spec.update
//
// For games:
//   Pukytoon.on('pause', fn)            also 'resume', 'mute' (payload: true/false), 'start', 'init', 'spec.update'
//   Pukytoon.ready()                    sent by itself on page load, unless window.PUKYTOON_MANUAL_READY is set
//   Pukytoon.save.get(key) / .set(key, value)   kept by the app per player (256 KB per game)
//   Pukytoon.score(value, final) / Pukytoon.event(name, data) / Pukytoon.haptic(ms)
(function () {
    'use strict';
    if (window.Pukytoon) return;

    var VERSION = 1;
    var inFrame = window.parent && window.parent !== window;
    var handlers = {};
    var saved = window.__PUKYTOON_SAVE || null;   // filled in directly for pasted-code games
    var initData = null;
    var initWaiters = [];
    var readySent = false;

    function send(type, payload) {
        if (!inFrame) return;
        try {
            window.parent.postMessage({ pukytoon: VERSION, type: type, payload: payload === undefined ? null : payload }, '*');
        } catch (e) {}
    }

    function fire(type, payload) {
        (handlers[type] || []).slice().forEach(function (fn) {
            try { fn(payload); } catch (e) { report(e && e.message || String(e)); }
        });
    }

    function report(message) {
        send('error', { message: String(message).slice(0, 2000) });
    }

    window.addEventListener('message', function (e) {
        if (!inFrame || e.source !== window.parent) return;
        var d = e.data;
        if (!d || d.pukytoon !== VERSION || typeof d.type !== 'string') return;
        if (d.type === 'ping') { send('pong'); return; }
        if (d.type === 'init') {
            initData = d.payload || {};
            if (!saved && initData.save && typeof initData.save === 'object') saved = initData.save;
            initWaiters.splice(0).forEach(function (fn) { fn(initData); });
        }
        // Remembered for handlers added later (a game still loading when the app paused or started it)
        if (d.type === 'pause') api.state.paused = true;
        if (d.type === 'resume') api.state.paused = false;
        if (d.type === 'start') api.state.started = true;
        if (d.type === 'mute') api.state.muted = !!d.payload;
        fire(d.type, d.payload);
    });

    var api = {
        version: VERSION,
        // The last pause/resume, start and mute the app sent
        state: { paused: false, started: false, muted: false },
        on: function (type, fn) {
            (handlers[type] = handlers[type] || []).push(fn);
            return api;
        },
        ready: function () {
            if (readySent) return;
            readySent = true;
            send('ready');
        },
        // Resolves with the app's init data, or {} when there is no app (opened on its own) or it is slow
        whenInit: function (timeoutMs) {
            return new Promise(function (resolve) {
                if (initData || !inFrame) return resolve(initData || {});
                initWaiters.push(resolve);
                setTimeout(function () { resolve(initData || {}); }, timeoutMs || 1000);
            });
        },
        score: function (value, final) {
            send('score', { value: Number(value) || 0, final: !!final });
        },
        event: function (name, data) {
            send('event', { name: String(name).slice(0, 40), data: data == null ? null : data });
        },
        haptic: function (ms) {
            send('haptic', { ms: Math.max(1, Math.min(200, Number(ms) || 20)) });
        },
        error: report,
        save: {
            all: function () { return saved || (saved = {}); },
            get: function (key) {
                var s = api.save.all();
                return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : null;
            },
            set: function (key, value) {
                api.save.all()[String(key)] = value;
                api.save.flush();
            },
            remove: function (key) {
                delete api.save.all()[String(key)];
                api.save.flush();
            },
            flush: function () { send('save', api.save.all()); }
        }
    };
    window.Pukytoon = api;

    // Uncaught errors reach the app too (its watchdog and crash counts use them)
    window.addEventListener('error', function (e) {
        if (e.target && e.target !== window && e.target.tagName) {
            report('Could not load ' + (e.target.src || e.target.href || 'a file'));
        } else {
            report(e.message || 'Unknown error');
        }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        var r = e.reason;
        report(r && r.message || String(r));
    });

    send('hello', { sdk: VERSION });
    function autoReady() { if (!window.PUKYTOON_MANUAL_READY) api.ready(); }
    if (document.readyState === 'complete') autoReady();
    else window.addEventListener('load', autoReady);
})();
