// The GameSpec: everything a Creator Studio game is, as data (no code). It travels in the player's URL
// after "#", so a published game is a link to studio/play.html.
//
// { spec: 1,
//   mechanic: { key: 'endless-runner', version: '1.0.0' },
//   params:   { speed: 7, lives: 1 },                      // checked against the mechanic's manifest
//   theme:    { pack: 'sweets', overrides: { player: 'pets/07_fox', music: 'easy_lemon' } },
//   rules:    { win: 'distance >= 500', lose: 'lives <= 0' },
//   meta:     { title: 'Gummy Dash' } }

export function encodeSpec(spec) {
    const bytes = new TextEncoder().encode(JSON.stringify(spec));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Returns null for anything that isn't a spec
export function decodeSpec(text) {
    try {
        const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
        const spec = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
        return spec && typeof spec === 'object' && spec.spec === 1 && spec.mechanic && typeof spec.mechanic.key === 'string' ? spec : null;
    } catch (e) {
        return null;
    }
}
