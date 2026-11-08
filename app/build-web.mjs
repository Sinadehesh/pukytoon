// Copies the Pukytoon site into www/ for the app: the feed, its code, the built-in games, the Creator
// Studio's runtime, player and asset library, the bridge SDK and the icons.
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(import.meta.dirname, 'www');
fs.rmSync(out, { recursive: true, force: true });

for (const rel of ['index.html', 'manifest.webmanifest', 'css', 'js', 'games', 'icons', 'runtime', 'studio', 'sdk', 'assets']) {
    fs.cpSync(path.join(root, rel), path.join(out, rel), { recursive: true });
}
console.log('www: copied the feed and', fs.readdirSync(path.join(out, 'games')).length, 'built-in game(s)');
