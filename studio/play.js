// Plays a Creator Studio game. The GameSpec after "#" names its mechanic, theme, parameters and rules.
// ?harness for tests (no clock: they step the game), &seed=N for a fixed random sequence.
import { boot } from '../runtime/runtime.js';
import { MECHANICS } from '../runtime/mechanics/index.js';
import { decodeSpec } from '../runtime/spec.js';

const query = new URLSearchParams(location.search);
const harness = query.has('harness');
const seed = query.has('seed') ? Number(query.get('seed')) : harness ? 1 : null;
const spec = decodeSpec(location.hash.slice(1)) || { spec: 1, mechanic: { key: 'drop-merge' }, theme: { pack: 'barnyard' } };

function problem(text) {
    const el = document.getElementById('problem');
    el.textContent = text;
    el.style.display = 'grid';
    if (window.Pukytoon) window.Pukytoon.error(text);
}

const load = MECHANICS[spec.mechanic.key];
if (!load) {
    problem('This game was made with a newer version of Pukytoon. Update the app to play it.');
} else {
    try {
        const mechanic = await load();
        await boot({ mechanic, spec, canvas: document.getElementById('game'), base: '../', harness, seed });
    } catch (e) {
        problem(`This game couldn't start: ${e && e.message ? e.message : e}`);
    }
}
