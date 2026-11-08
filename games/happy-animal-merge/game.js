// --- HAPPY ANIMAL MERGE ---
// The Animals mode of Happy Fruit Merge, on its own for the Pukytoon feed.
// Drop animals, merge two of the same into the next one, and don't let the box fill up.

const Engine = Matter.Engine,
      Render = Matter.Render,
      Runner = Matter.Runner,
      Bodies = Matter.Bodies,
      Body = Matter.Body,
      Composite = Matter.Composite,
      Events = Matter.Events,
      Vertices = Matter.Vertices;

const GAME_WIDTH = 450;
const GAME_HEIGHT = 640;
const DANGER_Y = 150;      // keep in sync with .danger-line in index.html
const DROP_TIERS = 5;      // random drops come from the 5 smallest animals
const BACKGROUND = '#fdedec';

// Sprite index = tier: Egg → Chick → Chicken → Piglet → Pig → Calf → Cow → Horse → Alpaca → Bull → Unicorn.
// NORMAL_TIERS is the size (radius) of each tier.
const NORMAL_TIERS = [20, 30, 40, 55, 70, 85, 100, 120, 145, 170, 200];
const SPRITES = [
    'assets/barn/01_egg.png', 'assets/barn/02_chick.png', 'assets/barn/03_chicken.png',
    'assets/barn/04_piglet.png', 'assets/barn/05_pig.png', 'assets/barn/06_calf.png',
    'assets/barn/08_cow.png', 'assets/barn/09_horse.png', 'assets/barn/10_alpaca.png',
    'assets/barn/11_bull.png', 'assets/barn/12_unicorn.png'
];
const params = new URLSearchParams(location.search);

// Reverse size (?size=reverse): the higher the level, the smaller the animal.
// Not a plain flip of the normal sizes, which would make the dropped animals nearly box-wide:
// level 1 starts at a normal drop size and each level shrinks by the same ratio down to the last.
const REVERSE = params.get('size') === 'reverse';
const REVERSE_LARGEST = 80;
const REVERSE_SMALLEST = 18;
function reverseTiers(count) {
    return Array.from({ length: count }, (_, i) =>
        Math.round(REVERSE_LARGEST * Math.pow(REVERSE_SMALLEST / REVERSE_LARGEST, i / (count - 1))));
}
const TIERS = REVERSE ? reverseTiers(NORMAL_TIERS.length) : NORMAL_TIERS;
const SPRITE_SIZE = 256;   // px, every sprite is a 256x256 square
const SPRITE_FIT = 1.08;   // draw slightly bigger than the collider so art touches neighbours
SPRITES.forEach(src => { const img = new Image(); img.src = src; }); // preload

function spriteScale(radius) {
    return (radius * 2 * SPRITE_FIT) / SPRITE_SIZE;
}

// Game state
let isGameOver = false;
let currentTier = randomDropTier();
let nextTier = randomDropTier();
let dropX = GAME_WIDTH / 2;

// Score: Suika-style triangular points for every merge, best kept across games
const BEST_KEY = 'happyAnimalMerge.best' + (REVERSE ? '.reverse' : '');
let score = 0;
let bestScore = 0;
try { bestScore = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) {}
let isNewBest = false;

// UI Elements
const board = document.getElementById('board');
const scoreEl = document.getElementById('score-val');
const bestEl = document.getElementById('best-val');
const nextImg = document.getElementById('next-img');
const dropGuide = document.getElementById('drop-guide');

function randomDropTier() {
    return Math.floor(Math.random() * DROP_TIERS);
}

function addScore(tier) {
    score += (tier * (tier + 1) / 2) * 10;
    if (score > bestScore) {
        isNewBest = true;
        bestScore = score;
        try { localStorage.setItem(BEST_KEY, bestScore); } catch (e) {}
    }
}

function updateUI() {
    scoreEl.textContent = score;
    bestEl.textContent = bestScore;
    nextImg.src = SPRITES[nextTier];

    // The animal you're about to drop hangs at the top, following the pointer
    const scale = board.clientWidth / GAME_WIDTH;
    const r = TIERS[currentTier] * SPRITE_FIT;
    dropGuide.style.backgroundImage = `url('${SPRITES[currentTier]}')`;
    dropGuide.style.width = `${r * 2 * scale}px`;
    dropGuide.style.top = `${(spawnY(currentTier) - r) * scale}px`;
    dropGuide.style.left = `${dropX * scale}px`;
}

function spawnY(tier) {
    return TIERS[tier] + 10;
}

function clampX(x, tier) {
    return Math.max(TIERS[tier], Math.min(GAME_WIDTH - TIERS[tier], x));
}

// --- WORLD ---

// Extra solver iterations so heavy piles don't sink into each other
const engine = Engine.create({ positionIterations: 20, velocityIterations: 12 });
const render = Render.create({
    element: board,
    engine: engine,
    options: { width: GAME_WIDTH, height: GAME_HEIGHT, wireframes: false, background: BACKGROUND }
});
Render.run(render);

const runner = Runner.create();
Runner.run(runner, engine);

const wallOptions = { isStatic: true, render: { fillStyle: '#34495e' } };
const ground = Bodies.rectangle(GAME_WIDTH / 2, GAME_HEIGHT + 25, GAME_WIDTH, 50, wallOptions);
const leftWall = Bodies.rectangle(-25, GAME_HEIGHT / 2, 50, GAME_HEIGHT * 2, wallOptions);
const rightWall = Bodies.rectangle(GAME_WIDTH + 25, GAME_HEIGHT / 2, 50, GAME_HEIGHT * 2, wallOptions);
Composite.add(engine.world, [ground, leftWall, rightWall]);

let dangerTimer = 0;

Events.on(engine, 'beforeUpdate', () => {
    if (isGameOver) return;
    let isAnyBodyAboveLine = false;

    Composite.allBodies(engine.world).forEach(body => {
        if (body.isGrowing) {
            const growthStep = body.targetRadius / 30;
            let newRadius = body.currentRadius + growthStep;
            if (newRadius >= body.targetRadius) {
                const scale = body.targetRadius / body.currentRadius;
                Body.scale(body, scale, scale);
                body.currentRadius = body.targetRadius;
                body.isGrowing = false;
                syncSprite(body);
            } else {
                const scale = newRadius / body.currentRadius;
                Body.scale(body, scale, scale);
                body.currentRadius = newRadius;
                syncSprite(body);
            }
        }

        // Fallback for a drop wedged against a wall: once it has fallen for a second and stopped, it counts as landed
        if (body.isDropping) {
            body.dropAge = (body.dropAge || 0) + 1;
            if (body.dropAge > 60 && body.speed < 0.3) body.isDropping = false;
        }

        // Touching or crossing the line is fine; you lose only when a landed animal is
        // entirely above it (its lowest point is above the line)
        if (body.tier !== undefined && !body.isGrowing && !body.isDropping) {
            if (body.bounds.max.y < DANGER_Y) {
                if (Math.abs(body.velocity.y) < 2 && Math.abs(body.velocity.x) < 2) {
                    isAnyBodyAboveLine = true;
                }
            }
        }
    });

    if (isAnyBodyAboveLine) {
        dangerTimer++;
        if (dangerTimer > 180) {
            isGameOver = true;
            document.getElementById('gameover-text').textContent =
                `The box is full! Score: ${score}` + (isNewBest ? ' 🏆 New best!' : ` (Best: ${bestScore})`);
            document.getElementById('gameover').style.display = 'flex';
        }
    } else {
        dangerTimer = 0;
    }
});

// --- INPUT ---

function pointerToGameX(e) {
    const rect = board.getBoundingClientRect();
    return (e.clientX - rect.left) * (GAME_WIDTH / rect.width);
}

board.addEventListener('pointermove', (e) => {
    dropX = clampX(pointerToGameX(e), currentTier);
    updateUI();
});

board.addEventListener('pointerdown', (e) => {
    if (isGameOver) return;

    dropX = clampX(pointerToGameX(e), currentTier);
    spawnItem(dropX, spawnY(currentTier), currentTier, false);

    currentTier = nextTier;
    nextTier = randomDropTier();
    dropX = clampX(dropX, currentTier);
    updateUI();
});

// --- MERGING ---

// A dropped animal lands when it touches the floor or an animal that has already landed.
// Only landed animals may merge, so spamming drops can't merge them in mid-air at the top.
function isLanded(body) {
    return body === ground || (body.tier !== undefined && !body.isDropping);
}

function handleCollisions(event) {
    if (isGameOver) return;
    const pairs = event.pairs;

    for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA;
        const bodyB = pairs[i].bodyB;

        if (bodyA.isDropping && isLanded(bodyB)) bodyA.isDropping = false;
        if (bodyB.isDropping && isLanded(bodyA)) bodyB.isDropping = false;
        if (bodyA.isDropping || bodyB.isDropping) continue;

        if (bodyA.tier === undefined || bodyB.tier === undefined) continue;
        if (bodyA.tier !== bodyB.tier || bodyA.tier >= TIERS.length - 1) continue;
        if (bodyA.isMerging || bodyB.isMerging) continue;
        bodyA.isMerging = true;
        bodyB.isMerging = true;

        const mergedTier = bodyA.tier + 1;
        addScore(mergedTier);
        updateUI();

        const midX = (bodyA.position.x + bodyB.position.x) / 2;
        const midY = (bodyA.position.y + bodyB.position.y) / 2;

        Composite.remove(engine.world, [bodyA, bodyB]);
        spawnItem(midX, midY, mergedTier, true);
    }
}
// collisionActive too: two drops that met in mid-air may merge once they're resting on the pile
Events.on(engine, 'collisionStart', handleCollisions);
Events.on(engine, 'collisionActive', handleCollisions);

function spawnItem(x, y, tier, animateGrowth) {
    const targetRadius = TIERS[tier];
    const startRadius = animateGrowth ? Math.max(targetRadius * 0.3, 10) : targetRadius;
    const scale = spriteScale(startRadius);

    // Hitbox = the sprite's own outline (shapes.js), so animals touch where the art touches.
    // Matter centres the body on the outline's centroid; offset the sprite to match.
    const outline = SHAPES[SPRITES[tier]].map(([px, py]) => ({ x: px, y: py }));
    const centre = Vertices.centre(outline);
    const body = Bodies.fromVertices(x, y, [outline.map(p => ({ x: p.x * scale, y: p.y * scale }))], {
        restitution: 0.15,
        friction: 0.5,
        density: 0.001 * (tier + 1),
        slop: 0.01,
        render: { sprite: { texture: SPRITES[tier], xScale: scale, yScale: scale } },
        tier: tier
    });
    // Set after creation: Matter rewrites sprite offsets from the hitbox bounds while creating the body
    body.render.sprite.xOffset = centre.x / SPRITE_SIZE;
    body.render.sprite.yOffset = centre.y / SPRITE_SIZE;

    if (animateGrowth) Body.setVelocity(body, { x: 0, y: 2 }); // slight downward push
    body.isDropping = !animateGrowth; // merge results are already in the pile
    body.isGrowing = animateGrowth;
    body.currentRadius = startRadius;
    body.targetRadius = targetRadius;

    Composite.add(engine.world, body);
}

function syncSprite(body) {
    const scale = spriteScale(body.currentRadius);
    body.render.sprite.xScale = scale;
    body.render.sprite.yScale = scale;
}

// --- RESTART, SIZE, FEED ---

document.getElementById('btn-restart').addEventListener('click', () => location.reload());

// The size button flips Reverse
const sizeBtn = document.getElementById('btn-size');
sizeBtn.classList.toggle('active', REVERSE);
sizeBtn.href = REVERSE ? '?' : '?size=reverse';
// Replace the page rather than add a history entry, so Back still takes you from the game to the feed
sizeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    location.replace(sizeBtn.href);
});

// The Pukytoon feed pauses the physics while the game waits under its Play cover (the bridge,
// sdk/pukytoon-sdk.js). Runner.run starts a new loop each call, so only resume when actually paused.
let paused = false;
function pause() { if (!paused) { Runner.stop(runner); paused = true; } }
function resume() { if (paused) { Runner.run(runner, engine); paused = false; } }
if (window.Pukytoon) {
    Pukytoon.on('pause', pause).on('resume', resume);
    if (Pukytoon.state.paused) pause();
}

window.addEventListener('resize', updateUI);
updateUI();
