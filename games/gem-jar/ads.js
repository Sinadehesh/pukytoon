// --- ADS: repeating interstitial ad breaks ---
//
// An ad break shows every AD_EVERY_DROPS drops, or at the next drop once
// AD_EVERY_MS has passed since the last one, and again on "Play Again".
//
// If Google's H5 Games Ads (adBreak) is loaded on the page, real ads are shown.
// Otherwise a placeholder ad with a countdown is shown, so the flow can be
// tested before an ad account is set up. See README.md -> Ads.
//
// In the Android app (window.AndroidApp, from MainActivity) the ads are real AdMob ads shown
// by the app: a banner under the game, a full-screen ad only between games (on "Play Again"),
// never in the middle of one, as AdMob's rules ask, and when the jar fills up an offer to watch
// a rewarded ad to keep going. Buying "No Ads" switches off the banner and full-screen ads; the
// keep-going offer stays, since the player chooses to watch it.

const AD_EVERY_DROPS = 25;
const AD_EVERY_MS = 2 * 60 * 1000;
const AD_CLOSE_DELAY_S = 5;
const AD_MIN_GAP_MS = 60 * 1000;   // between-games ads at most once a minute (the app's own rule, kept on the web too)

const App = window.AndroidApp || null;

const Ads = (() => {
    let dropsSinceAd = 0;
    let lastAdAt = Date.now();
    let showing = false;
    let hooks = { onPause() {}, onResume() {} };

    const overlay = document.getElementById('ad-overlay');
    const closeBtn = document.getElementById('ad-close');

    function finish(onClose) {
        showing = false;
        dropsSinceAd = 0;
        lastAdAt = Date.now();
        overlay.style.display = 'none';
        hooks.onResume();
        if (onClose) onClose();
    }

    function showPlaceholder(onClose) {
        overlay.style.display = 'flex';
        let left = AD_CLOSE_DELAY_S;
        closeBtn.disabled = true;
        closeBtn.textContent = `Close in ${left}`;
        const timer = setInterval(() => {
            left--;
            if (left > 0) {
                closeBtn.textContent = `Close in ${left}`;
            } else {
                clearInterval(timer);
                closeBtn.disabled = false;
                closeBtn.textContent = 'Close ✕';
            }
        }, 1000);
        closeBtn.onclick = () => { if (!closeBtn.disabled) finish(onClose); };
    }

    function showInterstitial(onClose) {
        if (GAME.ads === false || (App && App.isAdFree())) { if (onClose) onClose(); return; }
        // the app keeps its own gap between full-screen ads; on the web, the same once-a-minute rule
        if (!App && Date.now() - lastAdAt < AD_MIN_GAP_MS) { if (onClose) onClose(); return; }
        if (showing) return;
        showing = true;
        hooks.onPause();

        if (App) {   // the app shows a real full-screen ad, then tells us it's over (or right away if there's none)
            window.onNativeAdDone = () => { window.onNativeAdDone = null; finish(onClose); };
            App.showFullscreenAd();
            return;
        }

        if (typeof window.adBreak === 'function') {
            window.adBreak({
                type: 'next',
                name: 'ad-break',
                adBreakDone: () => finish(onClose)
            });
        } else {
            showPlaceholder(onClose);
        }
    }

    return {
        init(h) { hooks = Object.assign(hooks, h); },
        isShowing() { return showing; },
        showInterstitial,
        // "Keep going" rewarded ad (Android app only; the player chooses to watch it)
        rewardedReady() { return !!(App && App.rewardedReady()); },
        canRevive() { return this.rewardedReady(); },
        showRewarded(done) {
            if (!App || showing) { done(false); return; }
            showing = true;
            hooks.onPause();
            window.onRewardedDone = watched => {
                window.onRewardedDone = null;
                showing = false;
                done(!!watched);      // the reward first (it may close a panel, like Keep Going)...
                hooks.onResume();     // ...then the game resumes, if nothing else is covering it
            };
            App.showRewardedAd();
        },
        onDrop() {
            if (GAME.ads === false || App) return;   // the app never shows ads in the middle of a game
            dropsSinceAd++;
            if (dropsSinceAd >= AD_EVERY_DROPS || Date.now() - lastAdAt >= AD_EVERY_MS) {
                // Let the item that was just dropped appear before the break
                setTimeout(() => showInterstitial(), 600);
            }
        }
    };
})();

// Android app: the "No Ads" purchase and the ad privacy settings, in the settings panel
if (App) {
    const row = document.getElementById('store-row');
    const buy = document.getElementById('btn-no-ads');
    const privacy = document.getElementById('btn-privacy');
    const refresh = () => {
        const owned = App.isAdFree();
        row.style.display = 'flex';
        buy.textContent = owned ? 'No Ads ✓' : ('No Ads ' + App.noAdsPrice()).trim();
        buy.classList.toggle('grey', owned);
        buy.disabled = owned;
        privacy.style.display = App.privacyOptionsRequired() ? '' : 'none';
    };
    buy.addEventListener('click', () => { if (!App.isAdFree()) App.buyNoAds(); });
    privacy.addEventListener('click', () => App.showPrivacyOptions());
    window.onAdFreeChanged = refresh;
    document.getElementById('btn-settings').addEventListener('click', refresh);
    refresh();
}
