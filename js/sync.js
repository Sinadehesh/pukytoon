// Saves of the games everyone shares are kept online as well as on the phone while someone is signed in, so
// their progress and best scores follow them to another phone. The last one written wins. A save made on
// this phone and not sent yet (offline, or signed out) is the newest there is, so it goes up rather than
// being replaced. Games keep their saves through Pukytoon.save (sdk/pukytoon-sdk.js); the bridge tells us.
import * as store from './store.js';
import * as cloud from './cloud.js';

const WAIT = 2000;          // a burst of saves goes up once, this long after the last
const timers = new Map();   // game id on this phone -> its pending send

// A game kept a save: localId is its id on this phone (the save's key), cloudId its id online
export function saved(localId, cloudId) {
    store.setSyncInfo(localId, { cloudId, dirty: true });
    if (!cloud.signedIn()) return;   // goes up once they sign in
    clearTimeout(timers.get(localId));
    timers.set(localId, setTimeout(() => send(localId), WAIT));
}

async function send(localId) {
    timers.delete(localId);
    const info = store.syncInfo()[localId];
    if (!info || !info.dirty || !info.cloudId || !cloud.signedIn()) return;
    try {
        const at = await cloud.putSave(info.cloudId, store.loadSave(localId));
        // Saved again while this was on its way: that one goes next, and stays unsent until then
        store.setSyncInfo(localId, timers.has(localId) ? { seen: at } : { dirty: false, seen: at });
    } catch (e) {
        // Too big for the database, or the game is gone: don't keep trying. Anything else (no connection)
        // stays unsent, for the next save or sign-in.
        if (/check constraint|foreign key|violates/.test(e.message)) store.setSyncInfo(localId, { dirty: false });
    }
}

// After signing in, and at the start when they're signed in: the online saves this phone hasn't got come
// down, and this phone's unsent ones go up. localIdFor maps a game's online id to its id here. Resolves with
// the ids of the games whose save changed, so a game already loaded can be loaded again with it.
export async function sync(localIdFor) {
    if (!cloud.signedIn()) return [];
    let rows;
    try { rows = await cloud.cloudSaves(); } catch (e) { return []; }
    const info = store.syncInfo();
    const changed = [];
    for (const row of rows) {
        const id = localIdFor(row.game_id);
        const mine = info[id];
        if (mine && mine.dirty) continue;                    // played here since: goes up below
        if (mine && mine.seen === row.updated_at) continue;  // this phone has it already
        store.writeSave(id, row.data);
        store.setSyncInfo(id, { cloudId: row.game_id, dirty: false, seen: row.updated_at });
        changed.push(id);
    }
    for (const [id, mine] of Object.entries(store.syncInfo())) if (mine.dirty) send(id);
    return changed;
}
