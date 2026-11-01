const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Display
const VIRTUAL_WIDTH = 940;
const VIRTUAL_HEIGHT = 540;

function resizeGame() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    const scaleX = windowWidth / VIRTUAL_WIDTH;
    const scaleY = windowHeight / VIRTUAL_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (windowWidth - VIRTUAL_WIDTH * scale) / 2;
    const offsetY = (windowHeight - VIRTUAL_HEIGHT * scale) / 2;

    canvas.width = Math.round(windowWidth * dpr);
    canvas.height = Math.round(windowHeight * dpr);
    canvas.style.width = `${windowWidth}px`;
    canvas.style.height = `${windowHeight}px`;

    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);
    ctx.imageSmoothingEnabled = false;
}

window.addEventListener('resize', resizeGame);
resizeGame();

// Fixed-step timing
const TICK_RATE = 40;
const step = 1 / TICK_RATE;
const MAX_FRAME_TIME = 0.1;

// Movement and combat tuning
const GRAVITY = 1400;
const JUMP_SPEED = 600;
const DASH_SPEED = 1000;
const DASH_DURATION = 0.3;
const DASH_COOLDOWN = 0.22;
const ATTACK_DURATION = 0.18;
const ATTACK_COOLDOWN = 0.3;
const DOOR_COOLDOWN = 0.5;

// Standard gamepad axis thresholds
const GAMEPAD_STICK_DEADZONE = 0.22;
const GAMEPAD_VERTICAL_AIM_THRESHOLD = 0.18;
const GAMEPAD_DIAGONAL_AIM_THRESHOLD = 0.2;

// World geometry
const POGO_DOWN_SPEED = 720;
const POGO_DIAGONAL_SPEED = 520;
const POGO_HORIZONTAL_DRAG = 1600;
const FLOOR_TILE_SIZE = 128;
const FLOOR_VISIBLE_TOP = 96;
const FLOOR_DRAW_Y = VIRTUAL_HEIGHT - FLOOR_TILE_SIZE;
const FLOOR_COLLISION_Y = FLOOR_DRAW_Y + FLOOR_VISIBLE_TOP;
const DOOR_WIDTH = 42;
const DOOR_HEIGHT = 90;
const DOOR_FLOOR_Y = FLOOR_COLLISION_Y - DOOR_HEIGHT;

// Player and input state
let jumpPressed = false;
let dashPressed = false;
let attackPressed = false;
let attackTimer = 0;
let attackCooldown = 0;
let jumpButtonWasDown = false;
let dashButtonWasDown = false;
let attackButtonWasDown = false;
let dashCooldown = 0;

const player = {
    x: 100,
    y: 100,
    width: 96,
    height: 96,
    speed: 500,
    health: 100,
    maxHealth: 100,
    velocityY: 0,
    pogoVelocityX: 0,
    pogoDirectionX: 0,
    isDiagonalPogo: false,
    onGround: false,
    canDash: false,
    isDashing: false,
    dashTimer: 0,
    facing: 1,
    dashDirection: 0,
    attackType: 'none',
};

// Health, benches, and death state
const hpSprites = [];
const benches = [];
let blackoutTimer = 0;
let blackoutActive = false;
let deathRespawned = false;
let blackoutRespawnAt = 0;
let benchInteractPressed = false;
let benchButtonWasDown = false;
let restingBench = null;

// Keyboard input
const keys = Object.create(null);
window.keys = keys;

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ([' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        event.preventDefault();
    }
    keys[key] = true;
    if (key === 'e' && !event.repeat) {
        benchInteractPressed = true;
    }
});

window.addEventListener('keyup', (event) => {
    delete keys[event.key.toLowerCase()];
});

window.addEventListener('blur', () => {
    for (const key of Object.keys(keys)) {
        delete keys[key];
    }
    benchInteractPressed = false;
    jumpButtonWasDown = false;
    dashButtonWasDown = false;
    attackButtonWasDown = false;
    benchButtonWasDown = false;
});

// Feedback and boss timing
const DEATH_FADE_DURATION = 0.45;
const DEATH_BLACK_DELAY = 0.5;
const BOSS_PHASE_TWO_SWEEP_FIRST_PASS_DURATION = 0.68;
const BOSS_PHASE_TWO_SWEEP_SECOND_PASS_DURATION = 0.93;
const BOSS_PHASE_TWO_SWEEP_PAUSE_DURATION = 0.14;
const BOSS_PHASE_TWO_RECOVERY_SCALE = 0.9;
const BOSS_PHASE_TRANSITION_RECOVERY = 0.7;
const PLAYER_HIT_FLASH_DURATION = 0.36;

let playerHitFlashTimer = 0;
let playerHitVibrationCooldown = 0;

// Player health and movement helpers
function landPlayer(surfaceY) {
    player.y = surfaceY - player.height;
    player.velocityY = 0;
    player.pogoVelocityX = 0;
    player.pogoDirectionX = 0;
    player.isDiagonalPogo = false;
    player.onGround = true;
    player.canDash = false;
}

function damagePlayer(amount) {
    if (blackoutActive || player.health <= 0) {
        return;
    }

    const previousHealth = player.health;
    player.health = Math.max(0, player.health - amount);
    if (player.health < previousHealth) {
        playerHitFlashTimer = PLAYER_HIT_FLASH_DURATION;
        vibrateControllerOnHit(previousHealth - player.health);
    }
}

// Health display
function healPlayer(amount) {
    player.health = Math.min(player.maxHealth, player.health + amount);
}

function getHealthRatio() {
    return player.health / player.maxHealth;
}

function getHpSpriteIndex() {
    const ratio = Math.max(0, Math.min(1, getHealthRatio()));
    return Math.max(0, Math.min(5, Math.ceil(ratio * 6) - 1));
}

function drawPlayerHp() {
    const index = getHpSpriteIndex();
    const sprite = hpSprites[index];
    const scale = 3;
    const x = 14;
    const y = 12;
    const panelWidth = 218;
    const panelHeight = 78;

    ctx.save();
    ctx.fillStyle = 'rgba(17, 22, 32, 0.88)';
    ctx.fillRect(x, y, panelWidth, panelHeight);
    ctx.strokeStyle = playerHitFlashTimer > 0 ? '#ff746c' : '#d8c59d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, panelWidth - 2, panelHeight - 2);

    if (sprite?.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, x + 7, y + 4, sprite.naturalWidth * scale, sprite.naturalHeight * scale);
    } else {
        const barX = x + 12;
        const barY = y + 23;
        const barWidth = panelWidth - 24;
        const barHeight = 18;
        ctx.fillStyle = '#30252c';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.fillStyle = player.health > player.maxHealth * 0.25 ? '#65d66e' : '#ff4d4d';
        ctx.fillRect(barX, barY, barWidth * getHealthRatio(), barHeight);
        ctx.strokeStyle = '#f1ead4';
        ctx.lineWidth = 2;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
    }

    ctx.fillStyle = '#fff1c4';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`HEALTH  ${Math.ceil(player.health)} / ${player.maxHealth}`, x + 12, y + 66);
    ctx.restore();
}

function createBench(x, y, width, height, roomName = 'roomA') {
    const bench = {
        roomName,
        x,
        y,
        width,
        height,
        nearby: false,
        resting: false,
        healTimer: 0,
    };
    benches.push(bench);
    return bench;
}

function isPlayerNearBench(bench) {
    return bench.roomName === currentRoomName &&
        (restingBench === bench || (
            Math.abs(player.x + player.width / 2 - (bench.x + bench.width / 2)) <= bench.width / 2 + 48 &&
            Math.abs(player.y + player.height - bench.y) <= 80
        ));
}

function stopRestingAtBench() {
    if (!restingBench) {
        return false;
    }

    restingBench.resting = false;
    restingBench.healTimer = 0;
    restingBench = null;
    return true;
}

// Bench interaction and healing
function drawBenches() {
    for (const bench of benches) {
        if (bench.roomName !== currentRoomName) {
            continue;
        }

        const seatY = bench.y - 22;
        const centerX = bench.x + bench.width / 2;

        ctx.save();
        if (bench.resting) {
            const glow = 0.12 + (Math.sin(performance.now() / 300) + 1) * 0.06;
            ctx.globalAlpha = glow;
            ctx.fillStyle = '#8fffd0';
            ctx.beginPath();
            ctx.ellipse(centerX, seatY + 12, bench.width * 0.8, 24, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.fillStyle = '#352820';
        ctx.fillRect(bench.x + 6, seatY + 18, 8, 12);
        ctx.fillRect(bench.x + bench.width - 14, seatY + 18, 8, 12);
        ctx.fillStyle = '#493328';
        ctx.fillRect(bench.x + 8, seatY + 10, 8, 12);
        ctx.fillRect(bench.x + bench.width - 16, seatY + 10, 8, 12);
        ctx.fillStyle = '#8a6045';
        ctx.fillRect(bench.x + 2, seatY + 2, bench.width - 4, 4);
        ctx.fillStyle = '#6f4935';
        ctx.fillRect(bench.x, seatY + 5, bench.width, 8);
        ctx.strokeStyle = '#30241f';
        ctx.lineWidth = 2;
        ctx.strokeRect(bench.x + 1, seatY + 4, bench.width - 2, 10);
        ctx.fillStyle = '#d6ae6e';
        ctx.fillRect(bench.x + 7, seatY + 7, 3, 3);
        ctx.fillRect(bench.x + bench.width - 10, seatY + 7, 3, 3);

        if (bench.nearby || bench.resting) {
            const prompt = bench.resting
                ? (player.health >= player.maxHealth ? 'RESTING - FULL' : 'RESTING - HEALING')
                : 'E / X + UP: REST';
            const promptWidth = bench.resting ? 148 : 138;
            const promptX = centerX - promptWidth / 2;
            const promptY = seatY - 25;

            ctx.fillStyle = 'rgba(16, 20, 27, 0.9)';
            ctx.fillRect(promptX, promptY, promptWidth, 20);
            ctx.strokeStyle = bench.resting ? '#8fffd0' : '#d8c59d';
            ctx.lineWidth = 1;
            ctx.strokeRect(promptX + 0.5, promptY + 0.5, promptWidth - 1, 19);
            ctx.fillStyle = '#fff1c4';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(prompt, centerX, promptY + 10);
        }
        ctx.restore();
    }
}

function updateBenches(dt, moveX, moveY, jumpRequested, dashRequested) {
    let nearbyBench = null;
    let stoppedResting = false;

    for (const bench of benches) {
        bench.nearby = isPlayerNearBench(bench);
        if (bench.nearby) {
            nearbyBench = bench;
        }
    }

    if (restingBench && (
        restingBench.roomName !== currentRoomName ||
        !restingBench.nearby ||
        moveX !== 0 ||
        moveY !== 0 ||
        jumpRequested ||
        dashRequested
    )) {
        stopRestingAtBench();
        stoppedResting = true;
        player.onGround = false;
    }

    if (benchInteractPressed && restingBench) {
        stopRestingAtBench();
        stoppedResting = true;
        player.onGround = false;
    } else if (!restingBench && !stoppedResting && benchInteractPressed && nearbyBench) {
        restingBench = nearbyBench;
        restingBench.resting = true;
        restingBench.healTimer = 0;
        player.x = restingBench.x + (restingBench.width - player.width) / 2;
        player.y = restingBench.y - 22 - player.height * 0.72;
        player.velocityY = 0;
        player.pogoVelocityX = 0;
        player.pogoDirectionX = 0;
        player.isDiagonalPogo = false;
        player.isDashing = false;
        player.dashTimer = 0;
        player.onGround = true;
        player.attackType = 'none';
        attackTimer = 0;
    }

    benchInteractPressed = false;

    if (!restingBench) {
        return false;
    }

    if (player.health < player.maxHealth) {
        restingBench.healTimer += dt;
        if (restingBench.healTimer >= 0.12) {
            healPlayer(2);
            restingBench.healTimer = 0;
        }
    } else {
        restingBench.healTimer = 0;
    }

    player.x = restingBench.x + (restingBench.width - player.width) / 2;
    player.y = restingBench.y - 22 - player.height * 0.72;
    player.velocityY = 0;
    player.onGround = true;
    return true;
}

function getBlackoutAlpha() {
    if (!blackoutActive) {
        return 0;
    }

    if (!deathRespawned) {
        return Math.min(1, blackoutTimer / DEATH_FADE_DURATION);
    }

    return Math.max(0, 1 - (blackoutTimer - blackoutRespawnAt) / DEATH_FADE_DURATION);
}

function drawDeathOverlay(alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    ctx.fillStyle = '#fff1c4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#e84938';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(deathRespawned ? 'BACK ON YOUR FEET' : 'YOU FELL', VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 - 12);
    ctx.shadowBlur = 0;
    ctx.font = '15px sans-serif';
    ctx.fillText(deathRespawned ? 'Health restored' : 'Returning to the safe room', VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 + 20);
    ctx.restore();
}

// Death and respawn
function triggerDeathBlackout() {
    if (blackoutActive) {
        return;
    }

    blackoutActive = true;
    blackoutTimer = 0;
    deathRespawned = false;
    blackoutRespawnAt = 0;
    stopRestingAtBench();
}

function respawnPlayer() {
    player.health = player.maxHealth;
    player.x = 120;
    player.y = 100;
    player.velocityY = 0;
    player.pogoVelocityX = 0;
    player.pogoDirectionX = 0;
    player.isDiagonalPogo = false;
    player.onGround = false;
    player.canDash = false;
    player.isDashing = false;
    player.dashTimer = 0;
    player.attackType = 'none';
    playerHitFlashTimer = 0;
    attackTimer = 0;
    attackCooldown = 0;
    dashCooldown = 0;
    currentRoomName = 'roomA';
    doorCooldown = DOOR_COOLDOWN;
    doorExitLock = null;
    jumpPressed = false;
    dashPressed = false;
    attackPressed = false;
    updateBossRoomState();
}

function handleDeathAndRespawn(dt) {
    if (!blackoutActive) {
        if (player.health <= 0) {
            triggerDeathBlackout();
        }
        return blackoutActive;
    }

    blackoutTimer += dt;
    if (
        !deathRespawned &&
        blackoutTimer >= DEATH_FADE_DURATION + DEATH_BLACK_DELAY
    ) {
        respawnPlayer();
        deathRespawned = true;
        blackoutRespawnAt = blackoutTimer;
    }

    if (
        deathRespawned &&
        blackoutTimer - blackoutRespawnAt >= DEATH_FADE_DURATION
    ) {
        blackoutActive = false;
        blackoutTimer = 0;
        deathRespawned = false;
        blackoutRespawnAt = 0;
    }

    return true;
}

// Room and door system
function playerTouchesDoor(door) {
    return (
        player.x < door.x + door.width &&
        player.x + player.width > door.x &&
        player.y < door.y + door.height &&
        player.y + player.height > door.y
    );
}

const rooms = new Map();
const platforms = [];
const doors = [];
let currentRoomName = 'roomA';
let doorCooldown = 0;
let doorExitLock = null;

function createRoom(name, background = null) {
    if (!name || rooms.has(name)) {
        throw new Error(`Cannot create room "${name}": room names must be unique and non-empty.`);
    }

    const room = { name, background, platforms: [], doors: [] };
    rooms.set(name, room);
    return room;
}

// Room construction and transitions
function getCurrentRoom() {
    const room = rooms.get(currentRoomName);
    if (!room) {
        throw new Error(`Current room "${currentRoomName}" does not exist.`);
    }
    return room;
}

function addPlatform(x, y, width, height, sprite = null, roomName = currentRoomName) {
    const room = rooms.get(roomName);
    if (!room) {
        throw new Error(`Cannot add platform: room "${roomName}" does not exist.`);
    }

    const platform = { roomName, x, y, width, height, sprite };
    room.platforms.push(platform);
    platforms.push(platform);
    return platform;
}

function createDoor(roomName, targetRoomName, x, y, width, height, sprite = null) {
    const room = rooms.get(roomName);
    if (!room) {
        throw new Error(`Cannot create door: room "${roomName}" does not exist.`);
    }

    const door = {
        roomName,
        targetRoomName,
        x,
        y,
        width,
        height,
        sprite,
        linkedDoor: null,
        hidden: false,
    };

    room.doors.push(door);
    doors.push(door);


    for (const other of doors) {
        if (other !== door && other.linkedDoor === null) {
            const isMatchingPair = other.roomName === targetRoomName
                && other.targetRoomName === roomName;

            if (isMatchingPair) {
                door.linkedDoor = other;
                other.linkedDoor = door;
                break;
            }
        }
    }
    return door;
}

function teleportPlayerThroughDoor(room) {
    if (doorCooldown > 0) {
        return false;
    }

    if (doorExitLock && playerTouchesDoor(doorExitLock)) {
        return false;
    }
    doorExitLock = null;

    for (const door of room.doors) {
        if (door.hidden || !door.linkedDoor || !playerTouchesDoor(door)) {
            continue;
        }

        const destination = door.linkedDoor;
        stopRestingAtBench();
        currentRoomName = destination.roomName;

        if (destination.roomName === 'bossroom') {
            player.x = 100;
            player.y = FLOOR_COLLISION_Y - player.height;
            player.onGround = true;
        } else {
            player.x = Math.max(0, Math.min(
                VIRTUAL_WIDTH - player.width,
                destination.x + (destination.width - player.width) / 2
            ));
            player.onGround = false;
        }
        player.velocityY = 0;
        player.canDash = false;
        player.isDashing = false;
        player.dashTimer = 0;
        player.isDiagonalPogo = false;
        player.pogoVelocityX = 0;
        player.pogoDirectionX = 0;
        player.attackType = 'none';
        attackTimer = 0;
        doorCooldown = DOOR_COOLDOWN;
        doorExitLock = destination;
        updateBossRoomState();
        return true;
    }
    return false;
}

createBench(340, FLOOR_COLLISION_Y, 80, 24, 'roomA');

function createRoomFloor() {
    return {
        x: 0,
        y: FLOOR_COLLISION_Y,
        width: VIRTUAL_WIDTH,
        height: VIRTUAL_HEIGHT - FLOOR_COLLISION_Y,
    };
}

function buildRoomFromSpec(roomName, spec) {
    const room = rooms.get(roomName);
    if (!room) {
        throw new Error(`Cannot build room: room "${roomName}" does not exist.`);
    }

    room.background = spec.background ?? null;
    for (const platform of spec.platforms || []) {
        addPlatform(
            platform.x,
            platform.y,
            platform.width,
            platform.height,
            platform.sprite || null,
            roomName
        );
    }

    for (const door of spec.doors || []) {
        createDoor(
            roomName,
            door.target,
            door.x,
            door.y,
            door.width,
            door.height,
            door.sprite || null
        );
    }

    return room;
}

const roomDefs = {
    roomA: {
        background: '#2f3d52',
        platforms: [
            createRoomFloor(),
            { x: 180, y: 330, width: 190, height: 20 },
            { x: 580, y: 285, width: 210, height: 20 },
        ],
        doors: [
            { x: 30, y: DOOR_FLOOR_Y, width: DOOR_WIDTH, height: DOOR_HEIGHT, target: 'roomB' },
            {
                x: VIRTUAL_WIDTH / 2 - DOOR_WIDTH / 2,
                y: DOOR_FLOOR_Y,
                width: DOOR_WIDTH,
                height: DOOR_HEIGHT,
                target: 'bossroom',
            },
        ],
    },
    roomB: {
        background: '#3b2d27',
        platforms: [
            createRoomFloor(),
            { x: 160, y: 345, width: 200, height: 20 },
            { x: 610, y: 300, width: 180, height: 20 },
        ],
        doors: [
            {
                x: VIRTUAL_WIDTH - 30 - DOOR_WIDTH,
                y: DOOR_FLOOR_Y,
                width: DOOR_WIDTH,
                height: DOOR_HEIGHT,
                target: 'roomA',
            },
        ],
    },
    bossroom: {
        background: '#1e1414',
        platforms: [
            {
                x: 145,
                y: FLOOR_COLLISION_Y,
                width: 650,
                height: VIRTUAL_HEIGHT - FLOOR_COLLISION_Y,
            },
        ],
        doors: [
            {
                x: VIRTUAL_WIDTH / 2 - DOOR_WIDTH / 2,
                y: DOOR_FLOOR_Y,
                width: DOOR_WIDTH,
                height: DOOR_HEIGHT,
                target: 'roomA',
            },
        ],
    },
};

for (const [roomName, spec] of Object.entries(roomDefs)) {
    createRoom(roomName, spec.background || null);
}
for (const [roomName, spec] of Object.entries(roomDefs)) {
    buildRoomFromSpec(roomName, spec);
}

// Keep the room-building helpers available to the existing browser tools.
window.createRoom = createRoom;
window.buildRoomFromSpec = buildRoomFromSpec;
window.createDoor = createDoor;
window.addPlatform = addPlatform;

player.x = 110;
player.y = 330;

// Boss state and room activation
const boss = {
    active: false,
    roomActive: false,
    x: 260,
    y: 72,
    width: 360,
    height: 340,
    health: 600,
    maxHealth: 600,
    phase: 1,
    state: 'idle',
    stateTimer: 0,
    attackCooldown: 0,
    invuln: 0,
    flash: 0,
    playerHitTimer: 0,
    projectiles: [],
    projectileTimer: 0,
    projectileHandIndex: 0,
    projectileShotsRemaining: 0,
    flames: [],
    slamTargetX: VIRTUAL_WIDTH / 2,
    slamFired: false,
    slamFollowupFired: false,
    nextSlamHand: 0,
    sweepHandIndex: 0,
    nextSweepHand: 0,
    sweepDirection: 1,
    sweepStartX: -60,
    sweepEndX: VIRTUAL_WIDTH + 60,
    hands: [
        {
            x: VIRTUAL_WIDTH * 0.25,
            y: FLOOR_COLLISION_Y - 300,
            homeX: VIRTUAL_WIDTH * 0.25,
            homeY: FLOOR_COLLISION_Y - 300,
            groundY: FLOOR_COLLISION_Y - 24,
            hitActive: false,
            charging: false,
            chargeType: '',
        },
        {
            x: VIRTUAL_WIDTH * 0.75,
            y: FLOOR_COLLISION_Y - 300,
            homeX: VIRTUAL_WIDTH * 0.75,
            homeY: FLOOR_COLLISION_Y - 300,
            groundY: FLOOR_COLLISION_Y - 24,
            hitActive: false,
            charging: false,
            chargeType: '',
        },
    ],
};

function resetBoss() {
    boss.active = true;
    boss.x = (VIRTUAL_WIDTH - boss.width) / 2;
    boss.y = FLOOR_COLLISION_Y - boss.height;
    boss.health = boss.maxHealth;
    boss.phase = 1;
    boss.state = 'idle';
    boss.stateTimer = 0;
    boss.attackCooldown = 0.6;
    boss.invuln = 0;
    boss.flash = 0;
    boss.playerHitTimer = 0;
    boss.projectiles = [];
    boss.projectileTimer = 0;
    boss.projectileHandIndex = 0;
    boss.projectileShotsRemaining = 0;
    boss.flames = [];
    boss.slamTargetX = VIRTUAL_WIDTH / 2;
    boss.slamFired = false;
    boss.slamFollowupFired = false;
    boss.nextSlamHand = 0;
    boss.sweepHandIndex = 0;
    boss.nextSweepHand = 0;
    boss.sweepDirection = 1;
    boss.sweepStartX = -60;
    boss.sweepEndX = VIRTUAL_WIDTH + 60;
    boss.hands.forEach((hand) => {
        hand.hitActive = false;
        hand.charging = false;
        hand.chargeType = '';
        hand.x = hand.homeX;
        hand.y = hand.homeY;
    });
}

function setBossRoomDoorState() {
    const bossDoorPair = doors.filter((door) =>
        door.roomName === 'bossroom' || door.targetRoomName === 'bossroom'
    );

    for (const door of bossDoorPair) {
        door.hidden = boss.active;
    }
}

function updateBossRoomState() {
    const enteredBossRoom = currentRoomName === 'bossroom' && !boss.roomActive;
    const leftBossRoom = currentRoomName !== 'bossroom' && boss.roomActive;

    if (enteredBossRoom) {
        boss.roomActive = true;
        resetBoss();
    } else if (leftBossRoom) {
        boss.roomActive = false;
        boss.active = false;
        boss.projectiles = [];
        boss.flames = [];
    }

    setBossRoomDoorState();
}

// Boss hitboxes and attack logic
function getBossHitbox() {
    return {
        x: boss.x + boss.width / 2 - 35,
        y: boss.y + 8,
        width: 70,
        height: 48,
    };
}

function rectsOverlap(a, b) {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

function easeInOut(progress) {
    const t = Math.max(0, Math.min(1, progress));
    return t * t * (3 - 2 * t);
}

function getBossHandRect(hand) {
    return {
        x: hand.x - 42,
        y: hand.y - 32,
        width: 84,
        height: 64,
    };
}

function getBossSweepHitbox(hand, movingRight) {
    const spriteOffsetX = movingRight ? 26 : 16;
    const spriteWidth = 22;
    const spriteOffsetY = 32;
    const spriteHeight = 10;
    const scale = 2;
    const drawX = hand.x - 64;
    const drawY = hand.y - 64;

    return {
        x: drawX + spriteOffsetX * scale,
        y: drawY + spriteOffsetY * scale,
        width: spriteWidth * scale,
        height: spriteHeight * scale,
    };
}

function isBossSweepMovingRight() {
    const returning = boss.phase === 2 &&
        boss.stateTimer <= BOSS_PHASE_TWO_SWEEP_SECOND_PASS_DURATION;
    return returning ? boss.sweepDirection < 0 : boss.sweepDirection > 0;
}

// Boss attack selection and hitboxes
function getPlayerAttackHitbox() {
    if (player.attackType === 'attackUp') {
        return {
            x: player.x + player.width / 2 - 42,
            y: player.y - 112,
            width: 84,
            height: 112,
        };
    }

    if (player.attackType === 'attackDown') {
        return {
            x: player.x + player.width * 0.2,
            y: player.y + player.height * 0.55,
            width: player.width * 0.6,
            height: 100,
        };
    }

    if (player.attackType === 'attackRightDown') {
        return {
            x: player.x + player.width * 0.55,
            y: player.y + player.height * 0.35,
            width: 100,
            height: 90,
        };
    }

    if (player.attackType === 'attackLeftDown') {
        return {
            x: player.x - 55,
            y: player.y + player.height * 0.35,
            width: 100,
            height: 90,
        };
    }

    return {
        x: player.facing > 0 ? player.x + player.width * 0.35 : player.x - 55,
        y: player.y + 15,
        width: 110,
        height: 70,
    };
}

function startBossAttack() {
    const closeToPlayer = Math.abs(player.x + player.width / 2 - (boss.x + boss.width / 2)) < 240;
    const roll = Math.random();

    if (closeToPlayer && roll < 0.4) {
        boss.state = 'sweep';
        boss.stateTimer = boss.phase === 2
            ? 0.25 + BOSS_PHASE_TWO_SWEEP_FIRST_PASS_DURATION +
                BOSS_PHASE_TWO_SWEEP_PAUSE_DURATION + BOSS_PHASE_TWO_SWEEP_SECOND_PASS_DURATION
            : 1.25;
        boss.sweepHandIndex = boss.nextSweepHand;
        boss.nextSweepHand = 1 - boss.nextSweepHand;
        boss.sweepDirection = boss.sweepHandIndex === 0 ? 1 : -1;
        boss.sweepStartX = boss.sweepDirection > 0 ? -60 : VIRTUAL_WIDTH + 60;
        boss.sweepEndX = boss.sweepDirection > 0 ? VIRTUAL_WIDTH + 60 : -60;
        const sweepingHand = boss.hands[boss.sweepHandIndex];
        sweepingHand.x = sweepingHand.homeX;
        sweepingHand.y = sweepingHand.homeY;
    } else if (closeToPlayer && roll < 0.7) {
        boss.state = 'slam';
        boss.stateTimer = boss.phase === 2 ? 1.05 : 0.75;
        boss.slamTargetX = Math.max(100, Math.min(
            VIRTUAL_WIDTH - 100,
            player.x + player.width / 2 + (boss.phase === 2
                ? 0
                : player.x + player.width / 2 < VIRTUAL_WIDTH / 2 ? 150 : -150)
        ));
        boss.slamFired = false;
        boss.slamFollowupFired = false;
        const slammingHand = boss.hands[boss.nextSlamHand];
        slammingHand.x = boss.slamTargetX;
        slammingHand.y = slammingHand.homeY;
        boss.nextSlamHand = 1 - boss.nextSlamHand;
    } else {
        boss.state = 'projectile';
        boss.stateTimer = 0.75;
        boss.projectileTimer = 0.25;
        boss.projectileShotsRemaining = boss.phase === 2 ? 2 : 1;
        boss.projectileHandIndex = Math.random() < 0.5 ? 0 : 1;
        const firingHand = boss.hands[boss.projectileHandIndex];
        firingHand.x = firingHand.homeX;
        firingHand.y = firingHand.homeY;
    }
}

function finishBossAttack(cooldown) {
    boss.state = 'idle';
    boss.stateTimer = 0;
    boss.attackCooldown = boss.phase === 2
        ? cooldown * BOSS_PHASE_TWO_RECOVERY_SCALE
        : cooldown;
    boss.hands.forEach((hand) => {
        hand.hitActive = false;
        hand.charging = false;
        hand.chargeType = '';
    });
}

// Boss attack simulation and collision
function createBossFlameWave(x, direction, speed, spawnInterval) {
    return {
        x,
        direction,
        life: 1.8,
        distance: 0,
        spawnTimer: 0,
        speed,
        spawnInterval,
        isWave: true,
    };
}

function updateBoss(dt) {
    if (!boss.active || currentRoomName !== 'bossroom') {
        return;
    }

    boss.invuln = Math.max(0, boss.invuln - dt);
    boss.flash = Math.max(0, boss.flash - dt);
    boss.playerHitTimer = Math.max(0, boss.playerHitTimer - dt);
    boss.projectileTimer = Math.max(0, boss.projectileTimer - dt);

    if (boss.state === 'idle') {
        boss.hands.forEach((hand) => {
            const returnEase = 1 - Math.exp(-dt * 7);
            hand.x += (hand.homeX - hand.x) * returnEase;
            hand.y += (hand.homeY - hand.y) * returnEase;
            hand.hitActive = false;
            hand.charging = false;
            hand.chargeType = '';
        });
        boss.attackCooldown = Math.max(0, boss.attackCooldown - dt);
        if (boss.attackCooldown === 0) {
            startBossAttack();
        }
    } else {
        boss.stateTimer = Math.max(0, boss.stateTimer - dt);
    }

    const playerHitbox = {
        x: player.x,
        y: player.y,
        width: player.width,
        height: player.height,
    };

    if (boss.state === 'sweep') {
        const phaseTwo = boss.phase === 2;
        const chargeDuration = 0.25;
        const firstPassDuration = phaseTwo
            ? BOSS_PHASE_TWO_SWEEP_FIRST_PASS_DURATION
            : 1;
        const pauseDuration = phaseTwo ? BOSS_PHASE_TWO_SWEEP_PAUSE_DURATION : 0;
        const secondPassDuration = phaseTwo ? BOSS_PHASE_TWO_SWEEP_SECOND_PASS_DURATION : 0;
        const firstPassEnd = chargeDuration + firstPassDuration;
        const secondPassStart = firstPassEnd + pauseDuration;
        const totalDuration = secondPassStart + secondPassDuration;
        const elapsed = totalDuration - boss.stateTimer;
        const hand = boss.hands[boss.sweepHandIndex];
        let sweepAmount;
        if (phaseTwo && elapsed >= secondPassStart) {
            sweepAmount = easeInOut(
                (elapsed - secondPassStart) / secondPassDuration
            );
        } else {
            sweepAmount = easeInOut((elapsed - chargeDuration) / firstPassDuration);
        }
        hand.charging = elapsed < chargeDuration ||
            (phaseTwo && elapsed >= firstPassEnd && elapsed < secondPassStart);
        hand.chargeType = hand.charging ? 'sweep' : '';
        hand.hitActive = phaseTwo
            ? (elapsed >= chargeDuration && elapsed < firstPassEnd) || elapsed >= secondPassStart
            : elapsed >= chargeDuration && elapsed < totalDuration;

        if (elapsed < chargeDuration) {
            const chargeProgress = easeInOut(elapsed / chargeDuration);
            hand.x = hand.homeX + (boss.sweepStartX - hand.homeX) * chargeProgress;
            hand.y = hand.homeY + (hand.groundY - hand.homeY) * chargeProgress;
        } else if (phaseTwo && elapsed >= firstPassEnd && elapsed < secondPassStart) {
            hand.x = boss.sweepEndX;
            hand.y = hand.groundY;
        } else if (phaseTwo && elapsed >= secondPassStart) {
            hand.x = boss.sweepEndX + (boss.sweepStartX - boss.sweepEndX) * sweepAmount;
            hand.y = hand.groundY - Math.sin(Math.PI * sweepAmount) * 8;
        } else {
            hand.x = boss.sweepStartX + (boss.sweepEndX - boss.sweepStartX) * sweepAmount;
            hand.y = hand.groundY - Math.sin(Math.PI * sweepAmount) * 8;
        }

        const movingRight = isBossSweepMovingRight();
        const sweepHitbox = getBossSweepHitbox(hand, movingRight);
        const canPogoSweep = hand.hitActive &&
            attackTimer > 0 &&
            ['attackDown', 'attackLeftDown', 'attackRightDown'].includes(player.attackType) &&
            player.velocityY >= 0 &&
            rectsOverlap(getPlayerAttackHitbox(), sweepHitbox);

        if (canPogoSweep) {
            player.velocityY = -JUMP_SPEED * 0.85;
            player.onGround = false;
            player.canDash = true;
            player.pogoVelocityX = player.attackType === 'attackRightDown'
                ? 180
                : player.attackType === 'attackLeftDown'
                    ? -180
                    : 0;
            player.isDiagonalPogo = false;
            player.pogoDirectionX = 0;
            player.attackType = 'none';
            attackTimer = 0;
            boss.playerHitTimer = Math.max(boss.playerHitTimer, 0.2);
        } else if (hand.hitActive && boss.playerHitTimer <= 0) {
            if (rectsOverlap(sweepHitbox, playerHitbox)) {
                damagePlayer(18);
                boss.playerHitTimer = 0.35;
            }
        }

        if (boss.stateTimer === 0) {
            finishBossAttack(0.9);
        }
    } else if (boss.state === 'slam') {
        const totalDuration = boss.phase === 2 ? 1.05 : 0.75;
        const elapsed = totalDuration - boss.stateTimer;
        const hand = boss.hands[boss.nextSlamHand === 0 ? 1 : 0];
        hand.charging = elapsed < 0.25 ||
            (boss.phase === 2 && elapsed >= 0.60 && elapsed < 0.78);
        hand.chargeType = hand.charging ? 'slam' : '';
        if (elapsed < 0.25) {
            const chargeProgress = easeInOut(elapsed / 0.25);
            hand.x = hand.homeX + (boss.slamTargetX - hand.homeX) * chargeProgress;
            hand.y = hand.homeY;
        } else if (elapsed < 0.36) {
            hand.x = boss.slamTargetX;
            hand.y = hand.homeY - 120 * easeInOut((elapsed - 0.25) / 0.11);
        } else if (elapsed < 0.48) {
            hand.x = boss.slamTargetX;
            hand.y = hand.homeY - 120 + (hand.groundY - hand.homeY + 120)
                * easeInOut((elapsed - 0.36) / 0.12);
        } else {
            hand.x = boss.slamTargetX;
            hand.y = hand.groundY;
        }
        hand.hitActive = elapsed >= 0.48 && elapsed < 0.58;

        if (elapsed >= 0.48 && !boss.slamFired) {
            boss.slamFired = true;
            boss.flames.push(
                createBossFlameWave(
                    boss.slamTargetX,
                    -1,
                    boss.phase === 2 ? 430 : 360,
                    0.09
                ),
                createBossFlameWave(
                    boss.slamTargetX,
                    1,
                    boss.phase === 2 ? 430 : 360,
                    0.09
                )
            );
            const slamHitbox = getBossHandRect(hand);
            if (rectsOverlap(slamHitbox, playerHitbox) && boss.playerHitTimer <= 0) {
                damagePlayer(24);
                boss.playerHitTimer = 0.45;
            }
        }

        if (boss.phase === 2 && elapsed >= 0.78 && !boss.slamFollowupFired) {
            boss.slamFollowupFired = true;
            boss.flames.push(
                createBossFlameWave(boss.slamTargetX, -1, 470, 0.075),
                createBossFlameWave(boss.slamTargetX, 1, 470, 0.075)
            );
        }

        if (boss.stateTimer === 0) {
            hand.hitActive = false;
            finishBossAttack(1);
        }
    } else if (boss.state === 'projectile') {
        const hand = boss.hands[boss.projectileHandIndex];
        hand.charging = boss.projectileShotsRemaining > 0 && boss.projectileTimer > 0;
        hand.chargeType = hand.charging ? 'projectile' : '';
        hand.y = hand.homeY - Math.sin(Math.PI * boss.projectileTimer / 0.25) * 22;

        if (boss.projectileShotsRemaining > 0 && boss.projectileTimer === 0 && boss.stateTimer > 0) {
            const handRect = getBossHandRect(hand);
            const originX = handRect.x + handRect.width / 2;
            const originY = handRect.y + handRect.height / 2;
            const targetX = player.x + player.width * 0.5 +
                (boss.phase === 2 ? (boss.projectileHandIndex === 0 ? 70 : -70) : 0);
            const targetY = player.y + player.height * 0.5;
            const dx = targetX - originX;
            const dy = targetY - originY;
            const length = Math.hypot(dx, dy) || 1;
            const projectileSpeed = (boss.phase === 2 ? 290 : 260) * 1.5;

            boss.projectiles.push({
                x: originX,
                y: originY,
                vx: (dx / length) * projectileSpeed,
                vy: (dy / length) * projectileSpeed,
                targetX,
                targetY,
                homingTime: boss.phase === 2 ? 0.25 : 0.3,
                radius: boss.phase === 2 ? 16 : 14,
                life: 4.5,
                damage: 12,
            });
            boss.projectileShotsRemaining -= 1;
            boss.projectileHandIndex = 1 - boss.projectileHandIndex;
            boss.projectileTimer = 0.28;
        }

        if (boss.stateTimer === 0) {
            finishBossAttack(1.6);
        }
    }

    for (let i = boss.flames.length - 1; i >= 0; i -= 1) {
        const flame = boss.flames[i];
        flame.life -= dt;
        if (flame.isWave) {
            const distance = (flame.speed || 360) * dt;
            flame.x += flame.direction * distance;
            flame.distance += distance;
            flame.spawnTimer -= dt;
            while (flame.spawnTimer <= 0 && flame.life > 0) {
                const scale = Math.max(0.35, 1 - flame.distance / 700);
                boss.flames.push({
                    x: flame.x,
                    y: FLOOR_COLLISION_Y - 30 * scale,
                    direction: flame.direction,
                    life: 0.3,
                    scale,
                    isWave: false,
                });
                flame.spawnTimer += flame.spawnInterval || 0.09;
            }
        } else {
            flame.x += flame.direction * 15 * dt;
            const scale = flame.scale;
            const flameHitbox = {
                x: flame.x - 26 * scale,
                y: flame.y + 8 * scale,
                width: 52 * scale,
                height: 22 * scale,
            };

            if (boss.playerHitTimer <= 0 && rectsOverlap(flameHitbox, playerHitbox)) {
                damagePlayer(14);
                boss.playerHitTimer = 0.4;
            }
        }

        if (flame.life <= 0 || flame.x < -40 || flame.x > VIRTUAL_WIDTH + 40) {
            boss.flames.splice(i, 1);
        }
    }

    for (let i = boss.projectiles.length - 1; i >= 0; i -= 1) {
        const projectile = boss.projectiles[i];
        projectile.life -= dt;

        if (projectile.homingTime > 0) {
            const dx = projectile.targetX - projectile.x;
            const dy = projectile.targetY - projectile.y;
            const length = Math.hypot(dx, dy) || 1;
            projectile.vx += (dx / length) * 6 * dt;
            projectile.vy += (dy / length) * 6 * dt;
            projectile.homingTime = Math.max(0, projectile.homingTime - dt);
        }

        projectile.x += projectile.vx * dt;
        projectile.y += projectile.vy * dt;

        const projectileRect = {
            x: projectile.x - projectile.radius,
            y: projectile.y - projectile.radius,
            width: projectile.radius * 2,
            height: projectile.radius * 2,
        };

        const canPogoFireball = attackTimer > 0 &&
            ['attackDown', 'attackLeftDown', 'attackRightDown'].includes(player.attackType) &&
            player.velocityY >= 0 &&
            rectsOverlap(getPlayerAttackHitbox(), projectileRect);

        if (canPogoFireball) {
            boss.projectiles.splice(i, 1);
            player.velocityY = -JUMP_SPEED * 0.85;
            player.onGround = false;
            player.canDash = true;
            player.pogoVelocityX = player.attackType === 'attackRightDown'
                ? 180
                : player.attackType === 'attackLeftDown'
                    ? -180
                    : 0;
            player.isDiagonalPogo = false;
            player.pogoDirectionX = 0;
            player.attackType = 'none';
            attackTimer = 0;
            continue;
        }

        if (rectsOverlap(projectileRect, playerHitbox)) {
            damagePlayer(projectile.damage);
            boss.projectiles.splice(i, 1);
            continue;
        }

        if (
            projectile.life <= 0 ||
            projectile.x < -50 ||
            projectile.y < -50 ||
            projectile.x > VIRTUAL_WIDTH + 50 ||
            projectile.y > VIRTUAL_HEIGHT + 50
        ) {
            boss.projectiles.splice(i, 1);
        }
    }

    if (attackTimer > 0 && player.attackType === 'attackUp' && boss.invuln <= 0) {
        if (rectsOverlap(getPlayerAttackHitbox(), getBossHitbox())) {
            boss.health = Math.max(0, boss.health - 10);
            boss.invuln = 0.25;
            boss.flash = 0.18;

            if (boss.phase === 1 && boss.health <= boss.maxHealth / 2) {
                boss.phase = 2;
                boss.state = 'phaseTransition';
                boss.stateTimer = 0.85;
                boss.projectiles = [];
                boss.flames = [];
                boss.hands.forEach((hand) => {
                    hand.hitActive = false;
                    hand.charging = false;
                    hand.chargeType = '';
                });
            }

            if (boss.health === 0) {
                boss.active = false;
                boss.state = 'defeated';
                boss.projectiles = [];
                boss.flames = [];
                boss.hands.forEach((hand) => {
                    hand.hitActive = false;
                });
                setBossRoomDoorState();
            }
        }

    }

    if (boss.active && boss.state === 'phaseTransition' && boss.stateTimer === 0) {
        boss.state = 'idle';
        boss.attackCooldown = BOSS_PHASE_TRANSITION_RECOVERY;
    }
}

// Boss rendering
function drawBossProjectile(projectile) {
    const sprite = bossSprites.fireProjectile;
    if (sprite.complete && sprite.naturalWidth > 0) {
        const size = projectile.radius * 9;
        ctx.save();
        ctx.translate(projectile.x, projectile.y);
        ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
        return;
    }

    const pulse = 1 + Math.sin((4.5 - projectile.life) * 12) * 0.12;
    ctx.save();
    ctx.fillStyle = '#ff6b45';
    ctx.shadowColor = '#ff3d24';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffe49a';
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawBossFlame(flame) {
    if (flame.isWave) {
        return;
    }

    const scale = flame.scale;
    const flicker = Math.sin((0.3 - flame.life) * 24) * 5;
    ctx.save();
    ctx.translate(flame.x, flame.y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#d53b24';
    ctx.beginPath();
    ctx.moveTo(-26, 28);
    ctx.lineTo(-18, 8 + flicker);
    ctx.lineTo(-7, 17);
    ctx.lineTo(2, flicker);
    ctx.lineTo(12, 17);
    ctx.lineTo(20, 7 - flicker);
    ctx.lineTo(27, 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffbd54';
    ctx.beginPath();
    ctx.moveTo(-12, 28);
    ctx.lineTo(-3, 13);
    ctx.lineTo(4, 21);
    ctx.lineTo(12, 11);
    ctx.lineTo(17, 28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawBossBackground() {
    if (currentRoomName !== 'bossroom' || !boss.active) {
        return;
    }

    ctx.save();
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = '#381f28';
    ctx.fillRect(boss.x + 18, boss.y + 94, boss.width - 36, boss.height - 70);
    ctx.fillStyle = '#4c2933';
    ctx.fillRect(boss.x + 42, boss.y + 114, boss.width - 84, boss.height - 105);
    ctx.globalAlpha = 1;

    ctx.restore();
}

function drawBossSprite(sprite, x, y, width, height, fallbackColor = '#a66b70') {
    if (sprite.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, x, y, width, height);
    } else {
        ctx.fillStyle = fallbackColor;
        ctx.fillRect(x, y, width, height);
    }
}

function drawBossHead() {
    const head = getBossHitbox();
    const width = bossSprites.head.naturalWidth * 2 || 256;
    const height = bossSprites.head.naturalHeight * 2 || 256;
    const x = head.x + (head.width - width) / 2;
    const y = head.y + (head.height - height) / 2;

    ctx.save();
    if (boss.flash > 0) {
        ctx.shadowColor = '#fff1c4';
        ctx.shadowBlur = 20;
    }
    drawBossSprite(bossSprites.head, x, y, width, height, '#c16b72');
    ctx.restore();
}

function drawBossHands(chargePulse) {
    boss.hands.forEach((hand, index) => {
        const handRect = getBossHandRect(hand);
        const charging = hand.charging || hand.hitActive;
        const isLeftHand = index === 0;
        const spriteSize = 128;
        let sprite = isLeftHand ? bossSprites.handIdleLeft : bossSprites.handIdleRight;

        if (hand.chargeType === 'projectile' && hand.charging) {
            sprite = isLeftHand ? bossSprites.fireChargeLeft : bossSprites.fireChargeRight;
        }

        if (boss.state === 'sweep' && index === boss.sweepHandIndex) {
            return;
        }
        if (boss.state === 'slam' && index === (boss.nextSlamHand === 0 ? 1 : 0)) {
            return;
        }

        const handScale = charging ? 1 + chargePulse * 0.15 : 1;
        const drawWidth = spriteSize * handScale;
        const drawHeight = spriteSize * handScale;
        const drawX = hand.x - drawWidth / 2;
        const drawY = hand.y - drawHeight / 2;

        ctx.save();
        if (charging) {
            const chargeColor = hand.chargeType === 'projectile'
                ? '#47c9ef'
                : hand.chargeType === 'slam'
                    ? '#ff8b38'
                    : '#ff443b';
            ctx.shadowColor = chargeColor;
            ctx.shadowBlur = 24 + chargePulse * 14;
        }
        drawBossSprite(sprite, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();

        if (hand.chargeType === 'projectile' && hand.charging) {
            ctx.save();
            ctx.strokeStyle = `rgba(71, 201, 239, ${0.45 + chargePulse * 0.4})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(hand.x, hand.y, 36 + chargePulse * 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    });
}

function drawBossSweep() {
    if (boss.state !== 'sweep') {
        return;
    }

    const movingRight = isBossSweepMovingRight();
    const hand = boss.hands[boss.sweepHandIndex];
    const sprite = movingRight ? bossSprites.sweepLeft : bossSprites.sweepRight;
    const size = 128;
    drawBossSprite(sprite, hand.x - size / 2, hand.y - size / 2, size, size);
}

function drawBossSlam() {
    if (boss.state !== 'slam') {
        return;
    }

    const slamHandIndex = boss.nextSlamHand === 0 ? 1 : 0;
    const hand = boss.hands[slamHandIndex];
    const size = 128;
    drawBossSprite(
        bossSprites.slam,
        hand.x - size / 2,
        hand.y - size / 2,
        size,
        size
    );
}

function drawBoss() {
    if (currentRoomName !== 'bossroom' || !boss.active) {
        return;
    }

    ctx.save();
    const chargePulse = 0.5 + Math.sin(performance.now() / 55) * 0.5;

    if (boss.state === 'sweep' && boss.hands.some((hand) => hand.charging)) {
        ctx.fillStyle = `rgba(255, 48, 40, ${0.22 + chargePulse * 0.2})`;
        ctx.fillRect(0, FLOOR_COLLISION_Y - 8, VIRTUAL_WIDTH, 8);
    }

    if (boss.state === 'slam') {
        const chargedHand = boss.hands.find((hand) => hand.chargeType === 'slam');
        if (chargedHand?.charging) {
            ctx.strokeStyle = `rgba(255, 95, 40, ${0.35 + chargePulse * 0.45})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(chargedHand.x, chargedHand.y + 32);
            ctx.lineTo(chargedHand.x, FLOOR_COLLISION_Y);
            ctx.stroke();
        }
    }

    drawBossHead();
    drawBossHands(chargePulse);
    drawBossSweep();
    drawBossSlam();
    ctx.shadowBlur = 0;

    boss.flames.forEach(drawBossFlame);

    boss.projectiles.forEach(drawBossProjectile);

    if (boss.state === 'phaseTransition') {
        ctx.fillStyle = '#fff1d2';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#f04b38';
        ctx.shadowBlur = 18;
        ctx.fillText('THE FIRE RISES', VIRTUAL_WIDTH / 2, 72);
    }
    ctx.restore();
}

// Boss arena floor effects
function drawBossLava(room) {
    if (currentRoomName !== 'bossroom') {
        return;
    }

    const floorPlatform = room.platforms.find((platform) => platform.y === FLOOR_COLLISION_Y);
    if (!floorPlatform) {
        return;
    }

    const lavaY = FLOOR_COLLISION_Y;
    const gaps = [
        { x: 0, width: floorPlatform.x },
        { x: floorPlatform.x + floorPlatform.width, width: VIRTUAL_WIDTH - floorPlatform.x - floorPlatform.width },
    ];
    const animationTime = performance.now() / 1000;

    ctx.save();
    for (const gap of gaps) {
        if (gap.width <= 0) {
            continue;
        }
        const lavaGradient = ctx.createLinearGradient(0, lavaY, 0, VIRTUAL_HEIGHT);
        lavaGradient.addColorStop(0, '#ff6735');
        lavaGradient.addColorStop(0.18, '#b72b25');
        lavaGradient.addColorStop(1, '#3c1019');
        ctx.fillStyle = lavaGradient;
        ctx.fillRect(gap.x, lavaY, gap.width, VIRTUAL_HEIGHT - lavaY);

        ctx.beginPath();
        ctx.moveTo(gap.x, lavaY + 3);
        for (let x = gap.x; x <= gap.x + gap.width; x += 8) {
            const waveY = lavaY + Math.sin(x * 0.045 + animationTime * 4) * 4;
            ctx.lineTo(x, waveY);
        }
        ctx.strokeStyle = '#ffb248';
        ctx.lineWidth = 5;
        ctx.shadowColor = '#ff4b27';
        ctx.shadowBlur = 14;
        ctx.stroke();
    }
    ctx.restore();
}

// Platform compatibility helpers
function loadPlatformsFromSpec(spec, roomName = currentRoomName) {
    const room = rooms.get(roomName);
    if (!room) {
        throw new Error(`Cannot load platforms: room "${roomName}" does not exist.`);
    }
    const parsedPlatforms = [];

    spec.split(';').map((entry) => entry.trim()).filter(Boolean).forEach((entry) => {
        const parts = entry.split(',').map(p => p.trim());
        if (parts.length !== 4) {
            throw new Error(`Invalid platform spec "${entry}": expected x,y,width,height.`);
        }

        const [xToken, yToken, widthToken, heightToken] = parts;
        const x = Number(xToken);
        const width = Number(widthToken);
        const height = Number(heightToken);
        const y = yToken.toLowerCase() === 'floor'
            ? FLOOR_COLLISION_Y - height
            : /^[+-]/.test(yToken)
                ? FLOOR_COLLISION_Y + Number(yToken)
                : Number(yToken);

        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
            throw new Error(`Invalid platform spec "${entry}": values must be finite and size must be positive.`);
        }

        parsedPlatforms.push({ x, y, width, height });
    });

    room.platforms.length = 0;
    for (let index = platforms.length - 1; index >= 0; index -= 1) {
        if (platforms[index].roomName === room.name) {
            platforms.splice(index, 1);
        }
    }
    for (const platform of parsedPlatforms) {
        addPlatform(platform.x, platform.y, platform.width, platform.height, null, room.name);
    }
}

window.loadPlatformsFromSpec = loadPlatformsFromSpec;


function plat(x, yToken, w, h, roomName = currentRoomName) {
    const yText = String(yToken).toLowerCase();
    const yValue = Number(yToken);
    const y = yText === 'floor'
        ? FLOOR_COLLISION_Y - Number(h)
        : typeof yToken === 'string' && /^[+-]/.test(yToken) || yValue < 0
            ? FLOOR_COLLISION_Y + yValue
            : yValue;

    addPlatform(Number(x), y, Number(w), Number(h), null, roomName);
}

window.plat = plat;
window.pl = plat;

// Asset loading
const playerRight = new Image();
playerRight.src = 'shro cap .png';

const playerLeft = new Image();
playerLeft.src = 'shro cap  (1).png';

const attackDown = new Image();
attackDown.src = 'straight down pogo.png';

const attackRightDown = new Image();
attackRightDown.src = 'right down pogo.png';

const attackLeftDown = new Image();
attackLeftDown.src = 'left down pogo.png';

const floorTile = new Image();
floorTile.src = 'New Piskel.png';

function loadImage(src) {
    const image = new Image();
    image.src = src;
    return image;
}

const bossSprites = {
    head: loadImage('boss head.png'),
    handIdleLeft: loadImage('boss hand left.png'),
    handIdleRight: loadImage('boss hand right.png'),
    fireChargeLeft: loadImage('boss hand left fireball.png'),
    fireChargeRight: loadImage('boss hand right fireball.png'),
    fireProjectile: loadImage('fire shot.png'),
    slam: loadImage('boss hand slam down.png'),
    sweepLeft: loadImage('boss hand sweep left.png'),
    sweepRight: loadImage('boss hand sweep right.png'),
};

[
    'basic hp bar 1hp new.png',
    'basic hp bar 2hp new.png',
    'basic hp bar 3hp new.png',
    'basic hp bar 4hp new.png',
    'basic hp bar 5hp new.png',
    'basic hp bar 6hp new.png',
].forEach((src) => {
    hpSprites.push(loadImage(src));
});

// Controller support and rumble feedback
window.addEventListener('gamepadconnected', (event) => {
    console.log(`Controller connected: ${event.gamepad.id}`);
    console.log(
        `Vibration actuator: ${
            getGamepadVibrationActuator(event.gamepad) ? 'available' : 'not exposed'
        }`
    );
});

window.addEventListener('gamepaddisconnected', (event) => {
    console.log(`Controller disconnected: ${event.gamepad.id}`);
});

async function testControllerVibration() {
    const gamepad = getConnectedGamepad();

    if (!gamepad) {
        console.warn('No controller detected. Check the cable and browser permissions.');
        return;
    }

    const actuator = getGamepadVibrationActuator(gamepad);
    if (!actuator) {
        console.warn(`Controller detected (${gamepad.id}), but vibration is not supported.`);
        return;
    }

    if (await playControllerRumble(actuator, 0.7, 300)) {
        console.log(`Rumble test completed: ${gamepad.id}`);
    }
}

window.testControllerVibration = testControllerVibration;

function getConnectedGamepad() {
    if (typeof navigator.getGamepads !== 'function') {
        return null;
    }

    return Array.from(navigator.getGamepads()).find((gamepad) => gamepad?.connected) ?? null;
}

function getGamepadVibrationActuator(gamepad) {
    const isSupported = (actuator) =>
        typeof actuator?.playEffect === 'function' ||
        typeof actuator?.pulse === 'function';
    const primaryActuator = gamepad?.vibrationActuator;
    if (isSupported(primaryActuator)) {
        return primaryActuator;
    }

    for (const actuator of gamepad?.hapticActuators ?? []) {
        if (isSupported(actuator)) {
            return actuator;
        }
    }
    return null;
}

async function playControllerRumble(actuator, intensity, duration) {
    if (typeof actuator.playEffect === 'function') {
        try {
            const result = await actuator.playEffect('dual-rumble', {
                duration,
                startDelay: 0,
                strongMagnitude: intensity,
                weakMagnitude: intensity * 0.85,
            });
            if (result === 'complete') {
                return true;
            }
        } catch (error) {
            if (typeof actuator.pulse !== 'function') {
                console.warn('Could not vibrate the controller:', error);
                return false;
            }
        }
    }

    if (typeof actuator.pulse === 'function') {
        try {
            const result = await actuator.pulse(intensity, duration);
            if (result !== false) {
                return true;
            }
            console.warn('The controller did not accept the vibration request.');
        } catch (error) {
            console.warn('Could not vibrate the controller:', error);
        }
    } else {
        console.warn('The controller vibration request did not complete.');
    }
    return false;
}

function vibrateControllerOnHit(damage) {
    if (playerHitVibrationCooldown > 0) {
        return;
    }

    playerHitVibrationCooldown = 0.18;
    if (typeof navigator.getGamepads !== 'function') {
        return;
    }

    const lostHearts = damage / (player.maxHealth / 6);
    const intensity = Math.max(0.8, Math.min(1, 0.8 + Math.max(0, lostHearts - 1) * 0.2));
    const duration = Math.round(180 + intensity * 120);

    for (const gamepad of Array.from(navigator.getGamepads())) {
        if (!gamepad?.connected) {
            continue;
        }

        const actuator = getGamepadVibrationActuator(gamepad);
        if (actuator) {
            playControllerRumble(actuator, intensity, duration);
        }
    }
}

// Main gameplay update
function update(dt) {
    doorCooldown = Math.max(0, doorCooldown - dt);
    playerHitFlashTimer = Math.max(0, playerHitFlashTimer - dt);
    playerHitVibrationCooldown = Math.max(0, playerHitVibrationCooldown - dt);
    updateBossRoomState();
    if (handleDeathAndRespawn(dt)) {
        return;
    }

    const keyboardLeft = Boolean(keys.a || keys.arrowleft);
    const keyboardRight = Boolean(keys.d || keys.arrowright);
    const keyboardUp = Boolean(keys.w || keys.arrowup);
    const keyboardDown = Boolean(keys.s || keys.arrowdown);
    let moveX = Number(keyboardRight) - Number(keyboardLeft);
    let moveY = Number(keyboardDown) - Number(keyboardUp);
    let aimX = moveX;
    let aimY = moveY;
    let jumpButtonDown = Boolean(keys[' ']);
    let dashButtonDown = Boolean(keys.shift);
    let attackButtonDown = Boolean(keys.j);
    let benchUseDown = false;
    const gamepad = getConnectedGamepad();

    if (gamepad) {
        const stickX = gamepad.axes[0] ?? 0;
        const stickY = gamepad.axes[1] ?? 0;
        const dpadLeft = gamepad.buttons[14]?.pressed ?? false;
        const dpadRight = gamepad.buttons[15]?.pressed ?? false;
        const dpadUp = gamepad.buttons[12]?.pressed ?? false;
        const dpadDown = gamepad.buttons[13]?.pressed ?? false;
        const xButton = gamepad.buttons[2];
        const xButtonDown = Boolean(xButton?.pressed || (xButton?.value ?? 0) > 0.5);

        const gamepadMoveX = dpadLeft !== dpadRight
            ? (dpadLeft ? -1 : 1)
            : Math.abs(stickX) > GAMEPAD_STICK_DEADZONE ? stickX : 0;
        const gamepadMoveY = dpadUp !== dpadDown
            ? (dpadUp ? -1 : 1)
            : Math.abs(stickY) > GAMEPAD_STICK_DEADZONE ? stickY : 0;
        const gamepadAimX = dpadLeft !== dpadRight ? (dpadLeft ? -1 : 1) : stickX;
        const gamepadAimY = dpadUp !== dpadDown ? (dpadUp ? -1 : 1) : stickY;

        moveX = keyboardLeft || keyboardRight ? moveX : gamepadMoveX;
        moveY = keyboardUp || keyboardDown ? moveY : gamepadMoveY;
        aimX = keyboardLeft || keyboardRight ? moveX : gamepadAimX;
        aimY = keyboardUp || keyboardDown ? moveY : gamepadAimY;

        const nearbyBenchForInput = benches.some(isPlayerNearBench);
        benchUseDown = nearbyBenchForInput &&
            xButtonDown &&
            aimY < -GAMEPAD_VERTICAL_AIM_THRESHOLD;
        if (benchUseDown && !benchButtonWasDown) {
            benchInteractPressed = true;
        }
        benchButtonWasDown = benchUseDown;

        jumpButtonDown ||= gamepad.buttons[0]?.pressed ?? false;
        attackButtonDown ||= xButtonDown && !benchUseDown;
        const dashButton = gamepad.buttons[7] ?? gamepad.buttons[1];
        dashButtonDown ||= Boolean(dashButton?.pressed || (dashButton?.value ?? 0) > 0.5);
    }

    if (jumpButtonDown && !jumpButtonWasDown) jumpPressed = true;
    if (attackButtonDown && !attackButtonWasDown) attackPressed = true;
    if (dashButtonDown && !dashButtonWasDown) dashPressed = true;

    jumpButtonWasDown = jumpButtonDown;
    attackButtonWasDown = attackButtonDown;
    dashButtonWasDown = dashButtonDown;
    if (!gamepad) {
        benchButtonWasDown = false;
    }

    moveX = Math.max(-1, Math.min(1, moveX));
    moveY = Math.max(-1, Math.min(1, moveY));

    const resting = updateBenches(
        dt,
        moveX,
        benchUseDown ? 0 : moveY,
        jumpPressed,
        dashPressed
    );
    if (resting) {
        moveX = 0;
        moveY = 0;
        aimX = 0;
        aimY = 0;
        jumpPressed = false;
        dashPressed = false;
        attackPressed = false;
    }

    if (moveX !== 0) {
        player.facing = Math.sign(moveX);
    }

    dashCooldown = Math.max(0, dashCooldown - dt);
    attackTimer = Math.max(0, attackTimer - dt);
    attackCooldown = Math.max(0, attackCooldown - dt);

    if (jumpPressed && player.onGround) {
        player.velocityY = -JUMP_SPEED;
        player.onGround = false;
        player.canDash = true;
    }
    jumpPressed = false;

    if (dashPressed && player.canDash && dashCooldown === 0 && !player.isDashing) {
        player.isDashing = true;
        player.dashTimer = DASH_DURATION;
        player.dashDirection = player.facing;
        player.canDash = false;
        player.velocityY = 0;
        player.pogoVelocityX = 0;
        player.pogoDirectionX = 0;
        player.isDiagonalPogo = false;
        dashCooldown = DASH_COOLDOWN;
    }
    dashPressed = false;

    if (attackPressed && attackCooldown === 0) {
        if (aimY < -GAMEPAD_VERTICAL_AIM_THRESHOLD) {
            player.attackType = 'attackUp';
            attackTimer = ATTACK_DURATION;
            attackCooldown = ATTACK_COOLDOWN;
        } else if (aimY > GAMEPAD_VERTICAL_AIM_THRESHOLD) {
            if (!player.onGround && !player.isDashing) {
                const isDiagonalPogo = Math.abs(aimX) > GAMEPAD_DIAGONAL_AIM_THRESHOLD;
                if (aimX > GAMEPAD_DIAGONAL_AIM_THRESHOLD) {
                    player.attackType = 'attackRightDown';
                } else if (aimX < -GAMEPAD_DIAGONAL_AIM_THRESHOLD) {
                    player.attackType = 'attackLeftDown';
                } else {
                    player.attackType = 'attackDown';
                }
                player.velocityY = Math.max(
                    player.velocityY,
                    isDiagonalPogo ? POGO_DIAGONAL_SPEED : POGO_DOWN_SPEED
                );
                player.pogoVelocityX = isDiagonalPogo
                    ? Math.sign(aimX) * POGO_DIAGONAL_SPEED
                    : 0;
                player.pogoDirectionX = isDiagonalPogo ? Math.sign(aimX) : 0;
                player.isDiagonalPogo = isDiagonalPogo;
                attackTimer = ATTACK_DURATION;
                attackCooldown = ATTACK_COOLDOWN;
            }
        } else {
            player.attackType = 'none';
            attackTimer = ATTACK_DURATION;
            attackCooldown = ATTACK_COOLDOWN;
        }
    }
    attackPressed = false;

    if (attackTimer <= 0) {
        attackTimer = 0;
        player.attackType = 'none';
    }

    const dashingThisTick = player.isDashing;

    if (dashingThisTick) {
        const dashTime = Math.min(dt, player.dashTimer);
        player.x += player.dashDirection * DASH_SPEED * dashTime;
        player.dashTimer -= dashTime;

        player.velocityY *= 0.55;

        if (player.dashTimer <= 0) {
            player.dashTimer = 0;
            player.isDashing = false;
        }
    } else {
        if (player.isDiagonalPogo) {
            const downwardSpeed = Math.max(0, player.velocityY + GRAVITY * dt);
            player.pogoVelocityX = player.pogoDirectionX * downwardSpeed;
            player.x += player.pogoVelocityX * dt;
        } else {
            player.x += moveX * player.speed * dt + player.pogoVelocityX * dt;
            player.pogoVelocityX = Math.sign(player.pogoVelocityX)
                * Math.max(0, Math.abs(player.pogoVelocityX) - POGO_HORIZONTAL_DRAG * dt);
        }
    }


    const room = getCurrentRoom();
    player.x = Math.max(0, Math.min(VIRTUAL_WIDTH - player.width, player.x));

    const previousBottom = player.y + player.height;
    if (!resting) {
        player.onGround = false;
    }

    if (!resting && !dashingThisTick) {
        player.velocityY += GRAVITY * dt;
        player.y += player.velocityY * dt;
    }
    if (player.y < 0) {
        player.y = 0;
        player.velocityY = Math.max(0, player.velocityY);
    }

    if (!resting && !dashingThisTick && player.velocityY >= 0) {
        for (const platform of room.platforms) {
            const wasAbovePlatform = previousBottom <= platform.y;
            const crossedPlatformTop = player.y + player.height >= platform.y;
            const overlapsPlatform = player.x < platform.x + platform.width
                && player.x + player.width > platform.x;

            if (wasAbovePlatform && crossedPlatformTop && overlapsPlatform) {
                landPlayer(platform.y);
                break;
            }
        }
    }

    const hasBossRoomFloorSupport = currentRoomName !== 'bossroom' || room.platforms.some((platform) =>
        platform.y === FLOOR_COLLISION_Y &&
        player.x < platform.x + platform.width &&
        player.x + player.width > platform.x
    );

    if (
        player.velocityY >= 0 &&
        player.y + player.height >= FLOOR_COLLISION_Y &&
        hasBossRoomFloorSupport
    ) {
        landPlayer(FLOOR_COLLISION_Y);
    } else if (
        currentRoomName === 'bossroom' &&
        player.velocityY >= 0 &&
        player.y + player.height >= FLOOR_COLLISION_Y &&
        !hasBossRoomFloorSupport
    ) {
        damagePlayer(25);
        player.x = (VIRTUAL_WIDTH - player.width) / 2;
        player.y = FLOOR_COLLISION_Y - player.height;
        player.velocityY = 0;
        player.pogoVelocityX = 0;
        player.pogoDirectionX = 0;
        player.isDiagonalPogo = false;
        player.isDashing = false;
        player.dashTimer = 0;
        player.onGround = true;
    }

    updateBoss(dt);

    if (handleDeathAndRespawn(dt)) {
        return;
    }

    if (teleportPlayerThroughDoor(room)) {
        return;
    }
}

// Room rendering
function drawRoom(room) {
    if (floorTile.complete && floorTile.naturalWidth > 0) {
        const bossFloor = currentRoomName === 'bossroom'
            ? room.platforms.find((platform) => platform.y === FLOOR_COLLISION_Y)
            : null;
        if (bossFloor) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(bossFloor.x, FLOOR_DRAW_Y, bossFloor.width, FLOOR_TILE_SIZE);
            ctx.clip();
        }
        for (let worldX = 0; worldX < VIRTUAL_WIDTH; worldX += FLOOR_TILE_SIZE) {
            ctx.drawImage(
                floorTile,
                worldX,
                FLOOR_DRAW_Y,
                FLOOR_TILE_SIZE,
                FLOOR_TILE_SIZE
            );
        }
        if (bossFloor) {
            ctx.restore();
        }
    }

    drawBossLava(room);

    for (const platform of room.platforms) {
        const screenX = platform.x;
        if (platform.sprite?.complete && platform.sprite.naturalWidth > 0) {
            ctx.drawImage(platform.sprite, screenX, platform.y, platform.width, platform.height);
        } else {
            ctx.fillStyle = '#6d4c35';
            ctx.strokeStyle = '#34251d';
            ctx.lineWidth = 3;
            ctx.fillRect(screenX, platform.y, platform.width, platform.height);
            ctx.strokeRect(screenX, platform.y, platform.width, platform.height);
        }
    }

    for (const door of room.doors) {
        if (door.hidden) {
            continue;
        }

        const screenX = door.x;
        if (door.sprite?.complete && door.sprite.naturalWidth > 0) {
            ctx.drawImage(door.sprite, screenX, door.y, door.width, door.height);
        } else {
            ctx.fillStyle = door.linkedDoor ? '#397c77' : '#6b6260';
            ctx.strokeStyle = '#172c2a';
            ctx.lineWidth = 3;
            ctx.fillRect(screenX, door.y, door.width, door.height);
            ctx.strokeRect(screenX, door.y, door.width, door.height);
        }
    }

    drawBenches();
}

// Player rendering
function drawPlayer() {
    const playerSprite = player.facing < 0 ? playerLeft : playerRight;
    if (playerSprite.complete && playerSprite.naturalWidth > 0) {
        const playerDrawHeight = restingBench ? player.height * 0.72 : player.height;
        ctx.save();
        if (
            playerHitFlashTimer > 0 &&
            Math.floor(playerHitFlashTimer / 0.06) % 2 === 0
        ) {
            ctx.filter = 'brightness(0) invert(1)';
        }
        ctx.drawImage(playerSprite, player.x, player.y, player.width, playerDrawHeight);
        ctx.restore();
    }

    if (attackTimer > 0 && [
        'attackDown',
        'attackRightDown',
        'attackLeftDown',
    ].includes(player.attackType)) {
        const attackSprite = player.attackType === 'attackDown'
            ? attackDown
            : player.attackType === 'attackRightDown'
                ? attackRightDown
                : player.attackType === 'attackLeftDown'
                    ? attackLeftDown
                    : attackDown;

        if (attackSprite?.complete && attackSprite.naturalWidth > 0) {
            const straightDown = player.attackType === 'attackDown';
            const drawHeight = straightDown ? player.height * 2 : player.height;
            const drawWidth = drawHeight * (attackSprite.naturalWidth / attackSprite.naturalHeight);
            let drawX = player.x + (player.width - drawWidth) / 2;
            let drawY = player.y + player.height - 8;

            if (player.attackType === 'attackRightDown') {
                drawX = player.x + player.width * 0.65;
                drawY = player.y + player.height * 0.4;
            } else if (player.attackType === 'attackLeftDown') {
                drawX = player.x - drawWidth * 0.65;
                drawY = player.y + player.height * 0.4;
            }

            ctx.drawImage(attackSprite, drawX, drawY, drawWidth, drawHeight);
        }
    }

    if (attackTimer > 0 && player.attackType === 'attackUp') {
        ctx.save();
        ctx.globalAlpha = attackTimer / ATTACK_DURATION;
        ctx.strokeStyle = '#fff2a6';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(player.x + player.width / 2, player.y + 18, 54, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
        ctx.restore();
    }

    if (attackTimer > 0 && player.attackType === 'none') {
        ctx.save();
        ctx.globalAlpha = attackTimer / ATTACK_DURATION;
        ctx.strokeStyle = '#fff2a6';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();

        const centerX = player.x + player.width / 2;
        const centerY = player.y + player.height / 2;
        const startAngle = player.facing > 0 ? -0.85 : Math.PI - 0.85;
        const endAngle = player.facing > 0 ? 0.85 : Math.PI + 0.85;
        ctx.arc(centerX, centerY, 58, startAngle, endAngle);
        ctx.stroke();
        ctx.restore();
    }
}

// Scene composition and interface
function draw() {
    ctx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    const room = getCurrentRoom();
    ctx.fillStyle = room.background || '#2f3d52';
    ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

    drawBossBackground();
    drawRoom(room);
    drawPlayer();
    drawBoss();
    drawPlayerHp();

    const blackoutAlpha = getBlackoutAlpha();
    if (blackoutAlpha > 0) {
        drawDeathOverlay(blackoutAlpha);
    }
}

// Fixed-step game loop
let previousTime = 0;
let accumulator = 0;

function gameLoop(currentTime) {
    if (previousTime === 0) {
        previousTime = currentTime;
    }

    const frameTime = Math.min(
        (currentTime - previousTime) / 1000,
        MAX_FRAME_TIME
    );
    previousTime = currentTime;

    accumulator += frameTime;

    while (accumulator >= step) {
        update(step);
        accumulator -= step;
    }
    draw();
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
