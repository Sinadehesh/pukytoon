// --- ZOMBIE BOMBER: ADS ---
// Ads run in the Android app only: AdMob ads and the "No Ads" purchase are shown by the app
// (android/bomber, MainActivity) and reached through window.AndroidApp. On the website there are no
// ads and no ad offers. Add #adtest to the page's address to try every ad offer on the web, with
// stand-in ads and a pretend No Ads purchase.
//
// The plan: as many ads as players are happy to watch, and as few as possible they have to.
//   Rewarded ads, always the player's choice, at the moments they're worth the most:
//     revive  the base falls: repair it and keep fighting (once a level)
//     double  level cleared: double the coins from that level
//     coins   upgrade shop: free coins, once a visit
//     boost   upgrade shop: start the next level with a big bomb in the bay
//   A full-screen ad only between levels, when PLAY is pressed in the shop: not before level 4, at
//   most once every 2.5 minutes, and not within 2.5 minutes of a rewarded ad, so players who choose
//   rewarded ads see fewer of the ones they don't choose. Never during a level.
//   A banner across the top of the screen, away from the bomb bay where the fingers are.
//   "No Ads" (a one-time Google Play purchase, $4.99) turns the banner and the full-screen ads off for
//   good. The rewarded offers stay, since the player always chooses them.

const Ads = (() => {
    const App = window.AndroidApp || null;
    const TEST = !App && /(^|[#&])adtest(&|$)/.test(location.hash);
    const FULLSCREEN_FROM_LEVEL = 4;
    const FULLSCREEN_GAP_MS = 150 * 1000;
    const STUCK_MS = 180 * 1000;           // if the app never says an ad is over, carry on anyway
    const PLACEMENTS = ['revive', 'double', 'coins', 'boost'];

    let lastFullscreen = Date.now();       // the clock starts at launch: no full-screen ad straight away
    let showing = null;                    // { id, kind } while an ad is on screen
    let nextId = 1;
    let testAdFree = false;
    try { testAdFree = localStorage.getItem('zombieBomber.testAdFree') === '1'; } catch (e) {}

    // Calls into the app cross threads, so their answers are kept for a second instead of asked every frame
    const cache = { at: 0, adFree: false, price: '', privacy: false, ready: {} };
    const ask = (name, ...args) => { try { return App[name](...args); } catch (e) { return undefined; } };
    function refresh(force) {
        if (!App) return;
        const now = Date.now();
        if (!force && now - cache.at < 1000) return;
        cache.at = now;
        cache.adFree = !!ask('isAdFree');
        cache.price = ask('noAdsPrice') || '';
        cache.privacy = !!ask('privacyOptionsRequired');
        for (const p of PLACEMENTS) cache.ready[p] = !!ask('rewardedReady', p);
    }
    const listeners = [];
    // the app says: No Ads was bought, restored or refunded, or its price is known now
    window.onAdFreeChanged = () => { refresh(true); listeners.forEach(f => { try { f(); } catch (e) {} }); };

    function begin(kind, done) {
        const id = nextId++;
        showing = { id, kind };
        const end = result => {
            if (!showing || showing.id !== id) return;   // already over (the safety timer, or a late answer)
            showing = null;
            lastFullscreen = Date.now();
            refresh(true);
            done(result);
        };
        setTimeout(() => end(false), STUCK_MS);
        return end;
    }

    // ---------- the stand-in ad for #adtest ----------
    function testAd(kind, end) {
        const box = document.createElement('div');
        box.setAttribute('role', 'dialog');
        box.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;' +
            'background:#05040a;color:#fff;font:600 18px system-ui,sans-serif;text-align:center;padding:24px';
        const label = document.createElement('div');
        const close = document.createElement('button');
        close.style.cssText = 'font:600 16px system-ui,sans-serif;padding:10px 22px;border-radius:20px;border:1px solid #777;background:#222;color:#fff';
        box.append(label, close);
        document.body.appendChild(box);
        const rewarded = kind === 'rewarded', length = rewarded ? 5 : 3;
        let left = length;
        const paint = () => {
            label.textContent = `TEST AD · ${rewarded ? 'REWARDED' : 'BETWEEN LEVELS'} · ${left}s`;
            close.textContent = left > 0 ? (rewarded ? 'Skip (no reward)' : 'Close') : (rewarded ? 'Collect reward' : 'Close');
        };
        const shut = result => { clearInterval(timer); box.remove(); end(result); };
        const timer = setInterval(() => { left = Math.max(0, left - 1); paint(); }, 1000);
        close.onclick = () => shut(rewarded ? left === 0 : true);
        paint();
    }

    return {
        /** Are there ads here at all (the app, or #adtest on the web)? */
        enabled: () => !!App || TEST,
        isTest: () => TEST,
        /** No Ads bought: no banner, no full-screen ads. */
        adFree() { refresh(); return App ? cache.adFree : TEST && testAdFree; },
        isShowing: () => !!showing,
        /** Is a rewarded ad loaded for this placement, ready to offer? */
        rewardedReady(placement) {
            if (showing) return false;
            refresh();
            return App ? !!cache.ready[placement] : TEST;
        },
        /** Shows a rewarded ad; done(true) once the player has watched it through, done(false) otherwise. */
        showRewarded(placement, done) {
            if (!this.rewardedReady(placement)) { done(false); return; }
            const end = begin('rewarded', watched => done(!!watched));
            if (App) {
                window.onRewardedDone = watched => { window.onRewardedDone = null; end(!!watched); };
                ask('showRewardedAd', placement);
            } else testAd('rewarded', end);
        },
        /** Between levels: maybe a full-screen ad, then done() (straight away when none is due). */
        betweenLevels(level, done) {
            const due = level >= FULLSCREEN_FROM_LEVEL && Date.now() - lastFullscreen >= FULLSCREEN_GAP_MS;
            if (!this.enabled() || this.adFree() || showing || !due) { done(); return; }
            const end = begin('fullscreen', () => done());
            if (App) {
                window.onNativeAdDone = () => { window.onNativeAdDone = null; end(true); };
                ask('showFullscreenAd');
            } else testAd('fullscreen', end);
        },
        /** "No Ads" in the player's currency, from Google Play ("" until it has answered). */
        noAdsPrice() { refresh(); return App ? cache.price : TEST ? '$4.99' : ''; },
        buyNoAds() {
            if (App) { ask('buyNoAds'); return; }
            if (!TEST) return;
            testAdFree = true;
            try { localStorage.setItem('zombieBomber.testAdFree', '1'); } catch (e) {}
            window.onAdFreeChanged();
        },
        /** Where the law asks for it (EU, UK, some US states): a way to change the ad consent choice. */
        privacyRequired() { refresh(); return App ? cache.privacy : false; },
        showPrivacy() { if (App) ask('showPrivacyOptions'); },
        onChange(f) { listeners.push(f); }
    };
})();
