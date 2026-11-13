#!/usr/bin/env python3
# Brings Gem Jar and Zombie Bomber into games/ from a checkout of Happy-Fruit-merge, where they are made:
#
#   python3 tools/import-games.py ../Happy-Fruit-merge
#
# Each game is packed by its own build script there (tools/build_gem_android.py, build_bomber_android.py):
# the same files its Android app gets, set up to play offline. So this needs what those scripts need:
# Python 3 with Pillow, and the internet the first time (Matter.js and the games' fonts are downloaded).
#
# Then each page gets Pukytoon's bridge (sdk/pukytoon-sdk.js) and the adapter that pauses a ready-made game
# in the feed (sdk/pukytoon-embed.js), and Gem Jar's ad breaks are switched off. Nothing in the games' own
# code is changed: to change a game, change it in its repository and run this again.
# Each folder's SOURCE.txt says which version it holds.
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
GAMES = HERE / 'games'

if len(sys.argv) != 2 or not (Path(sys.argv[1]) / 'tools' / 'build_gem_android.py').exists():
    sys.exit('usage: python3 tools/import-games.py <path to a Happy-Fruit-merge checkout>')
SRC = Path(sys.argv[1]).resolve()

# The games' build scripts read a version from the command line and keep their downloads under ANDROID_SDK
# (only its web-cache folder is used here: nothing of the Android SDK is installed)
sys.argv = sys.argv[:1]
os.environ.setdefault('ANDROID_SDK', str(Path.home() / '.cache' / 'pukytoon-import'))
sys.path.insert(0, str(SRC / 'tools'))
import build_gem_android as gem_jar          # noqa: E402
import build_bomber_android as zombie_bomber  # noqa: E402


def git(*args):
    return subprocess.run(['git', '-C', str(SRC), *args], capture_output=True, text=True, check=True).stdout.strip()


def bridge(depth):
    """The two scripts that tie a page to Pukytoon; they must come before every other script on it."""
    up = '../' * depth
    return (f'<script src="{up}sdk/pukytoon-sdk.js"></script>\n'
            f'    <script src="{up}sdk/pukytoon-embed.js"></script>\n    ')


def edit(page, changes):
    html = page.read_text()
    for old, new in changes:
        if html.count(old) != 1:
            sys.exit(f'{page}: expected exactly one\n  {old}\nThe game\'s page has changed: update tools/import-games.py to match.')
        html = html.replace(old, new)
    page.write_text(html)


def stamp(folder, name, page):
    files = [f for f in folder.rglob('*') if f.is_file()]
    size = sum(f.stat().st_size for f in files) / 1e6
    (folder / 'SOURCE.txt').write_text(
        f'{name}, brought in by tools/import-games.py. Don\'t edit it here: change the game in its own\n'
        f'repository and import it again.\n\n'
        f'From:    {git("remote", "get-url", "origin")}\n'
        f'Version: {git("rev-parse", "HEAD")}\n'
        f'         {git("log", "-1", "--format=%cs  %s")}\n'
        f'Page:    {page}\n')
    print(f'{name}: {len(files)} files, {size:.1f} MB, from {git("rev-parse", "--short", "HEAD")}')


if git('status', '--porcelain'):
    print('note: that checkout has changes that are not committed; they are imported too')

# Gem Jar: one flat folder (its packer drops the page's <base href="../">)
out = GAMES / 'gem-jar'
gem_jar.build_www(out)
MATTER = '<script src="matter.min.js"></script>'
CONFIG = '<script src="config.js"></script>'
edit(out / 'index.html', [
    (MATTER, bridge(2) + MATTER),
    # no ad breaks inside Pukytoon (the page's own switch, read by its ads.js)
    (CONFIG, '<script>window.GAME_SETUP.ads = false;</script>\n    ' + CONFIG),
])
stamp(out, 'Gem Jar', 'index.html')

# Zombie Bomber: the website's folders (bomber/ and assets/bomber/), so its own paths work unchanged
out = GAMES / 'zombie-bomber'
zombie_bomber.build_www(out)
MATTER = '<script src="vendor/matter.min.js"></script>'
edit(out / 'bomber' / 'index.html', [(MATTER, bridge(3) + MATTER)])
stamp(out, 'Zombie Bomber', 'bomber/index.html')
