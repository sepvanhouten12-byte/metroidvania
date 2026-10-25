const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

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

const TICK_RATE = 40;
const step = 1 / TICK_RATE;
const MAX_FRAME_TIME = 0.1;

const GRAVITY = 1400;
const JUMP_SPEED = 600;
const DASH_SPEED = 1000;
const DASH_DURATION = 0.3;
const DASH_COOLDOWN = 0.22;
const DASH_GRAVITY_SCALE = 0.35;
const ATTACK_DURATION = 0.18;
const ATTACK_COOLDOWN = 0.3;
const DOOR_COOLDOWN = 0.5;
const GAMEPAD_DEADZONE = 0.25;
const XBOX_DEADZONE = 0.22;
const XBOX_DOWN_TRESHOLD = 0.35;
const XBOX_DIAG_TRESHOLD = 0.2;
const FLOOR_TILE_SIZE = 128;
const FLOOR_VISIBLE_TOP = 96;
const FLOOR_DRAW_Y = VIRTUAL_HEIGHT - FLOOR_TILE_SIZE;
const FLOOR_COLLISION_Y = FLOOR_DRAW_Y + FLOOR_VISIBLE_TOP;

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
    onGround: false,
    canDash: false,
    isDashing: false,
    dashTimer: 0,
    facing: 1,
    dashDirection: 0,
    attackType: 'none',
};

let doorCooldown = 0;
let doorExitLock = null;

function damagePlayer(amount) {
    player.health = Math.max(0, player.health - amount );

}

function healPlayer(amount) {
    player.health = Math.min(player.maxHealth, player.health + amount);

}

function getHealthRatio() {
    return player.health / player.maxHealth;
}

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

function createRoom(name, background = null) {
    if (!name || rooms.has(name)) {
        throw new Error(`Cannot create room "${name}": room names must be unique and non-empty.`);
    }

    const room = { name, background, platforms: [], doors: [] };
    rooms.set(name, room);
    return room;
}

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
        if (door.linkedDoor && playerTouchesDoor(door)) {
            const destination = door.linkedDoor;
            currentRoomName = destination.roomName;
            player.x = Math.max(0, Math.min(
                VIRTUAL_WIDTH - player.width,
                destination.x + (destination.width - player.width) / 2
            ));
            player.y = Math.max(0, Math.min(
                VIRTUAL_HEIGHT - player.height,
                destination.y + (destination.height - player.height) / 2
            ));
            player.velocityY = 0;
            player.onGround = false;
            player.canDash = false;
            player.isDashing = false;
            player.dashTimer = 0;
            doorCooldown = DOOR_COOLDOWN;
            doorExitLock = destination;
            return true;
        }
    }
    return false;
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
            { x: 0, y: FLOOR_COLLISION_Y, width: VIRTUAL_WIDTH, height: VIRTUAL_HEIGHT - FLOOR_COLLISION_Y },
            { x: 180, y: 330, width: 190, height: 20 },
            { x: 580, y: 285, width: 210, height: 20 },
        ],
        doors: [
            { x: 30, y: 330, width: 42, height: 90, target: 'roomB' },
        ],
    },
    roomB: {
        background: '#3b2d27',
        platforms: [
            { x: 0, y: FLOOR_COLLISION_Y, width: VIRTUAL_WIDTH, height: VIRTUAL_HEIGHT - FLOOR_COLLISION_Y },
            { x: 160, y: 345, width: 200, height: 20 },
            { x: 610, y: 300, width: 180, height: 20 },
        ],
        doors: [
            { x: 868, y: 330, width: 42, height: 90, target: 'roomA' },
        ],
    },
};

for (const [roomName, spec] of Object.entries(roomDefs)) {
    createRoom(roomName, spec.background || null);
}
for (const [roomName, spec] of Object.entries(roomDefs)) {
    buildRoomFromSpec(roomName, spec);
}

window.createRoom = createRoom;
window.buildRoomFromSpec = buildRoomFromSpec;
window.createDoor = createDoor;
window.addPlatform = addPlatform;

player.x = 110;
player.y = 330;

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

const playerRight = new Image();
playerRight.src = '../shro cap .png';

const playerLeft = new Image();
playerLeft.src = '../shro cap  (1).png';

const attackDown = new Image();
attackDown.src = '../straight down pogo.png';

const attackRightDown = new Image();
attackRightDown.src = '../right down pogo.png';

const attackLeftDown = new Image();
attackLeftDown.src = '../left down pogo.png';

const floorTile = new Image();
floorTile.src = '../New Piskel.png';

window.addEventListener('gamepadconnected', (event) => {
    console.log(`Controller connected: ${event.gamepad.id}`);
    console.log(
        `Vibration actuator: ${
            event.gamepad.vibrationActuator ? 'available' : 'not exposed'
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

    const actuator = gamepad.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') {
        console.warn(`Controller detected (${gamepad.id}), but vibration is not supported.`);
        return;
    }

    try {
        const result = await actuator.playEffect('dual-rumble', {
            duration: 300,
            strongMagnitude: 0.7,
            weakMagnitude: 0.5,
        });

        if (result === 'complete') {
            console.log(`Rumble test completed: ${gamepad.id}`);
        } else {
            console.warn(`Rumble test did not complete: ${result}`);
        }
    } catch (error) {
        console.error('Could not vibrate the controller:', error);
    }
}

function getConnectedGamepad() {
    if (typeof navigator.getGamepads !== 'function') {
        return null;
    }

    return Array.from(navigator.getGamepads()).find((gamepad) => gamepad?.connected) ?? null;
}

function update(dt) {
    doorCooldown = Math.max(0, doorCooldown - dt);

    let moveX = 0;
    let moveY = 0;
    const gamepad = getConnectedGamepad();
    
    if (gamepad) {
        const stickX = gamepad.axes[0] ?? 0;
        const stickY = gamepad.axes[1] ?? 0;
        const dpadLeft = gamepad.buttons[14]?.pressed ?? false;
        const dpadRight = gamepad.buttons[15]?.pressed ?? false;
        const dpadUp = gamepad.buttons[12]?.pressed ?? false;
        const dpadDown = gamepad.buttons[13]?.pressed ?? false;

        if (dpadLeft !== dpadRight) {
            moveX = dpadLeft ? -1 : 1;
        } else if (Math.abs(stickX) > XBOX_DEADZONE) {
            moveX += stickX;
        }

        if (dpadUp !== dpadDown) {
            moveY += dpadUp ? -1 : 1;
        } else if (Math.abs(stickY) > XBOX_DEADZONE) {
            moveY += stickY;
        }

        const jumpButtonDown = gamepad.buttons[0]?.pressed ?? false;
        const attackButtonDown = gamepad.buttons[2]?.pressed ?? false;
        const dashButtonDown = gamepad.buttons[1]?.pressed ?? false;

        if (jumpButtonDown && !jumpButtonWasDown) jumpPressed = true;
        if (attackButtonDown && !attackButtonWasDown) attackPressed = true;
        if (dashButtonDown && !dashButtonWasDown) dashPressed = true;

        jumpButtonWasDown = jumpButtonDown;
        attackButtonWasDown = attackButtonDown;
        dashButtonWasDown = dashButtonDown;
    } else {
        jumpButtonWasDown = false;
        attackButtonWasDown = false;
        dashButtonWasDown = false;

    }

    moveX = Math.max(-1, Math.min(1, moveX));
    moveY = Math.max(-1, Math.min(1, moveY));
    
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
        dashCooldown = DASH_COOLDOWN;
    }
    dashPressed = false;

    if (attackPressed && attackCooldown === 0) {
        if (moveY > XBOX_DOWN_TRESHOLD) {
            if (moveX > XBOX_DIAG_TRESHOLD) {
                player.attackType = 'attackRightDown';
            } else if (moveX < -XBOX_DIAG_TRESHOLD) {
                player.attackType = 'attackLeftDown';
            } else {
                player.attackType = 'attackDown';
            }
        } else {
            player.attackType = 'none';
        }
        attackTimer = ATTACK_DURATION;
        attackCooldown = ATTACK_COOLDOWN;
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
        player.x += moveX * player.speed * dt;
    }


    const room = getCurrentRoom();
    player.x = Math.max(0, Math.min(VIRTUAL_WIDTH - player.width, player.x));

    const previousBottom = player.y + player.height;
    player.onGround = false;

    if (!dashingThisTick) {
        player.velocityY += GRAVITY * dt;
        player.y += player.velocityY * dt;
    }
    if (player.y < 0) {
        player.y = 0;
        player.velocityY = Math.max(0, player.velocityY);
    }

    if (!dashingThisTick && player.velocityY >= 0) {
        for (const platform of room.platforms) {
            const wasAbovePlatform = previousBottom <= platform.y;
            const crossedPlatformTop = player.y + player.height >= platform.y;
            const overlapsPlatform = player.x < platform.x + platform.width
                && player.x + player.width > platform.x;

            if (wasAbovePlatform && crossedPlatformTop && overlapsPlatform) {
                player.y = platform.y - player.height;
                player.velocityY = 0;
                player.onGround = true;
                player.canDash = false;
                break;
            }
        }
    }

    if (player.y + player.height >= FLOOR_COLLISION_Y) {
        player.y = FLOOR_COLLISION_Y - player.height;
        player.velocityY = 0;
        player.onGround = true;
        player.canDash = false;
    }

    if (teleportPlayerThroughDoor(room)) {
        return;
    }
}

function draw() {
    ctx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    const room = getCurrentRoom();
    ctx.fillStyle = room.background || '#2f3d52';
    ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

    if (floorTile.complete && floorTile.naturalWidth > 0) {
        for (let worldX = 0; worldX < VIRTUAL_WIDTH; worldX += FLOOR_TILE_SIZE) {
            ctx.drawImage(
                floorTile,
                worldX,
                FLOOR_DRAW_Y,
                FLOOR_TILE_SIZE,
                FLOOR_TILE_SIZE
            );
        }
    }

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

    const playerSprite = player.facing < 0 ? playerLeft : playerRight;
    if (playerSprite.complete && playerSprite.naturalWidth > 0) {
        ctx.drawImage(playerSprite, player.x, player.y, player.width, player.height);
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
            ctx.drawImage(attackSprite, player.x, player.y, player.width, player.height);
        }
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

let previousTime = 0;
let accumulator = 0;

function gameLoop(currentTime) {
    if (previousTime === 0) previousTime = currentTime;

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
