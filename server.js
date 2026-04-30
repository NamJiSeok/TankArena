const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const RESOURCE = path.join(ROOT, "resource");
const DATA = path.join(ROOT, "data");

const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1600;
const TICK_RATE = 30;
const FRAME_MS = 1000 / TICK_RATE;
const MAX_PLAYERS = 10;
const CHAT_LIMIT = 60;
const CHAT_TEXT_LIMIT = 180;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const clients = new Map();
const rooms = new Map();

let nextRoomNumber = 1;
let nextProjectileId = 1;
let nextMeleeAttackId = 1;
let nextChatId = 1;

const MELEE_TOTAL_TICKS = 14;
const MELEE_EXTEND_TICKS = 7;
const MELEE_BASE_OFFSET = 52;
const MELEE_EXTENSION = 82;
const MELEE_HIT_RADIUS = 44;
const TANK_HIT_RADIUS = 38;

const tankCatalog = loadTankCatalog();
const tankTypesById = new Map(tankCatalog.types.map((type) => [type.id, type]));
const DEFAULT_TANK_TYPE_ID = tankTypesById.has(tankCatalog.defaultTankTypeId)
  ? tankCatalog.defaultTankTypeId
  : tankCatalog.types[0].id;
const lobbyChat = [];

const spawnPoints = [
  { x: 260, y: 240 },
  { x: 2140, y: 240 },
  { x: 260, y: 1360 },
  { x: 2140, y: 1360 },
  { x: 1200, y: 210 },
  { x: 1200, y: 1390 },
  { x: 420, y: 800 },
  { x: 1980, y: 800 },
  { x: 760, y: 520 },
  { x: 1640, y: 1080 }
];

const server = http.createServer((req, res) => {
  const safeUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(safeUrl.pathname);

  let filePath;
  if (pathname === "/") {
    filePath = path.join(PUBLIC, "index.html");
  } else if (pathname === "/tank.png") {
    filePath = path.join(RESOURCE, "tank.png");
  } else if (pathname.startsWith("/resource/")) {
    filePath = path.normalize(path.join(RESOURCE, pathname.slice("/resource/".length)));
    if (!isInsideDirectory(filePath, RESOURCE)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
  } else {
    filePath = path.normalize(path.join(PUBLIC, pathname));
    if (!isInsideDirectory(filePath, PUBLIC)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade !== "websocket") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n")
  );

  const client = {
    id: crypto.randomUUID(),
    socket,
    name: "",
    roomId: null,
    tankTypeId: DEFAULT_TANK_TYPE_ID,
    ready: false,
    input: blankInput(),
    lastInputAt: Date.now()
  };

  clients.set(client.id, client);
  send(client, "hello", {
    id: client.id,
    tankTypes: tankTypeSummaries(),
    tankTypeId: client.tankTypeId
  });

  socket.on("data", (buffer) => {
    for (const message of decodeFrames(buffer)) {
      handleMessage(client, message);
    }
  });

  socket.on("close", () => disconnect(client));
  socket.on("error", () => disconnect(client));
});

server.listen(PORT, () => {
  console.log(`Tank Arena running at http://localhost:${PORT}`);
});

setInterval(gameTick, FRAME_MS);

function blankInput() {
  return {
    forward: false,
    brake: false,
    left: false,
    right: false
  };
}

function handleMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    send(client, "error", { message: "잘못된 메시지입니다." });
    return;
  }

  const data = message.data || {};

  switch (message.type) {
    case "login":
      login(client, data.name);
      break;
    case "createRoom":
      createRoom(client, data.name);
      break;
    case "joinRoom":
      joinRoom(client, data.roomId);
      break;
    case "leaveRoom":
      leaveRoom(client);
      break;
    case "setReady":
      setReady(client, Boolean(data.ready));
      break;
    case "selectTank":
      selectTankType(client, data.tankTypeId);
      break;
    case "chat":
      postChat(client, data.scope, data.text);
      break;
    case "startGame":
      startGame(client);
      break;
    case "input":
      client.input = {
        forward: Boolean(data.forward),
        brake: Boolean(data.brake),
        left: Boolean(data.left),
        right: Boolean(data.right)
      };
      client.lastInputAt = Date.now();
      break;
    case "attack":
      attemptAttack(client, data.kind);
      break;
    case "listRooms":
      sendLobby(client);
      break;
    default:
      send(client, "error", { message: "알 수 없는 명령입니다." });
  }
}

function login(client, name) {
  const cleanName = String(name || "")
    .trim()
    .slice(0, 16);

  if (!cleanName) {
    send(client, "error", { message: "이름을 입력해 주세요." });
    return;
  }

  client.name = cleanName;
  sendProfile(client);
  send(client, "chatHistory", {
    scope: "lobby",
    messages: lobbyChat
  });
  sendLobby(client);
  broadcastLobby();
}

function createRoom(client, roomName) {
  if (!client.name) {
    send(client, "error", { message: "먼저 로그인해 주세요." });
    return;
  }

  leaveRoom(client);

  const id = crypto.randomUUID().slice(0, 8);
  const cleanRoomName =
    String(roomName || "").trim().slice(0, 22) || `전차전 ${nextRoomNumber++}`;
  const room = {
    id,
    name: cleanRoomName,
    ownerId: client.id,
    playerIds: new Set(),
    status: "waiting",
    winnerId: null,
    projectiles: [],
    meleeAttacks: [],
    chatMessages: [],
    startedAt: 0,
    endedAt: 0
  };

  rooms.set(id, room);
  joinRoom(client, id);
  broadcastLobby();
}

function joinRoom(client, roomId) {
  const room = rooms.get(String(roomId || ""));
  if (!room) {
    send(client, "error", { message: "방을 찾을 수 없습니다." });
    return;
  }

  if (room.playerIds.size >= MAX_PLAYERS) {
    send(client, "error", { message: "방 인원이 가득 찼습니다." });
    return;
  }

  if (room.status === "playing") {
    send(client, "error", { message: "진행 중인 방에는 참가할 수 없습니다." });
    return;
  }

  leaveRoom(client);

  room.playerIds.add(client.id);
  client.roomId = room.id;
  client.ready = false;
  client.input = blankInput();
  send(client, "joinedRoom", { roomId: room.id });
  send(client, "chatHistory", {
    scope: "room",
    roomId: room.id,
    messages: room.chatMessages
  });
  broadcastRoom(room);
  broadcastLobby();
}

function leaveRoom(client) {
  if (!client.roomId) {
    return;
  }

  const room = rooms.get(client.roomId);
  client.roomId = null;
  client.ready = false;
  client.input = blankInput();

  if (!room) {
    return;
  }

  room.playerIds.delete(client.id);

  if (room.playerIds.size === 0) {
    rooms.delete(room.id);
  } else {
    if (room.ownerId === client.id) {
      room.ownerId = room.playerIds.values().next().value;
    }
    if (room.status === "playing") {
      const tank = room.tanks?.get(client.id);
      if (tank) {
        tank.alive = false;
        tank.health = 0;
      }
      checkWinner(room);
    }
    broadcastRoom(room);
  }

  broadcastLobby();
}

function setReady(client, ready) {
  const room = getClientRoom(client);
  if (!room || room.status !== "waiting") {
    return;
  }

  client.ready = ready;
  broadcastRoom(room);
}

function selectTankType(client, tankTypeId) {
  const room = getClientRoom(client);
  if (!room) {
    send(client, "error", { message: "방에 참가한 뒤 전차를 변경할 수 있습니다." });
    return;
  }

  if (room.status !== "waiting") {
    send(client, "error", { message: "대기실에서만 전차를 변경할 수 있습니다." });
    return;
  }

  const tankType = getTankType(tankTypeId);
  if (!tankType) {
    send(client, "error", { message: "알 수 없는 전차 종류입니다." });
    return;
  }

  client.tankTypeId = tankType.id;
  client.ready = false;
  sendProfile(client);

  if (room) {
    broadcastRoom(room);
  }
}

function postChat(client, scope, text) {
  if (!client.name) {
    send(client, "error", { message: "먼저 로그인해 주세요." });
    return;
  }

  const cleanText = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_TEXT_LIMIT);

  if (!cleanText) {
    return;
  }

  if (scope === "room") {
    const room = getClientRoom(client);
    if (!room) {
      send(client, "error", { message: "방에 참가해야 방 채팅을 사용할 수 있습니다." });
      return;
    }

    const message = createChatMessage(client, cleanText, "room", room.id);
    pushLimited(room.chatMessages, message, CHAT_LIMIT);
    broadcast(room, "chatMessage", {
      scope: "room",
      roomId: room.id,
      message
    });
    return;
  }

  const message = createChatMessage(client, cleanText, "lobby", null);
  pushLimited(lobbyChat, message, CHAT_LIMIT);
  for (const target of clients.values()) {
    if (target.name) {
      send(target, "chatMessage", {
        scope: "lobby",
        message
      });
    }
  }
}

function startGame(client) {
  const room = getClientRoom(client);
  if (!room) {
    return;
  }

  if (room.ownerId !== client.id) {
    send(client, "error", { message: "방장만 시작할 수 있습니다." });
    return;
  }

  if (room.status !== "waiting") {
    send(client, "error", { message: "이미 게임이 진행 중입니다." });
    return;
  }

  const players = getRoomClients(room);
  if (players.length < 2) {
    send(client, "error", { message: "2명 이상부터 시작할 수 있습니다." });
    return;
  }

  const nonOwners = players.filter((p) => p.id !== room.ownerId);
  if (nonOwners.length === 0 || !nonOwners.every((player) => player.ready)) {
    send(client, "error", { message: "모든 인원이 레디해야 시작할 수 있습니다." });
    return;
  }

  const shuffledSpawns = shuffle(spawnPoints).slice(0, players.length);
  room.status = "playing";
  room.winnerId = null;
  room.projectiles = [];
  room.meleeAttacks = [];
  room.startedAt = Date.now();
  room.endedAt = 0;
  room.tanks = new Map();

  players.forEach((player, index) => {
    const tankType = getTankType(player.tankTypeId) || getTankType(DEFAULT_TANK_TYPE_ID);
    const stats = { ...tankType.stats };
    player.input = blankInput();
    room.tanks.set(player.id, {
      id: player.id,
      name: player.name,
      tankTypeId: tankType.id,
      tankTypeName: tankType.name,
      image: tankType.image,
      color: colorForIndex(index),
      x: shuffledSpawns[index].x,
      y: shuffledSpawns[index].y,
      angle: Math.random() * Math.PI * 2,
      speed: 0,
      alive: true,
      health: stats.maxHealth,
      shield: stats.maxShield,
      stats,
      cooldownDurations: { ...tankType.cooldowns },
      projectile: { ...tankType.projectile },
      melee: { ...tankType.melee },
      cooldowns: {
        melee: 0,
        ranged: 0,
        special: 0
      },
      lastDamagedAt: 0,
      lastAttackAt: 0
    });
  });

  broadcastRoom(room);
  broadcastLobby();
  broadcastGame(room);
}

function attemptAttack(client, kind) {
  const room = getClientRoom(client);
  if (!room || room.status !== "playing" || !room.tanks) {
    return;
  }

  const tank = room.tanks.get(client.id);
  if (!tank || !tank.alive) {
    return;
  }

  const now = Date.now();
  if (kind === "melee" && tank.cooldowns.melee <= now) {
    tank.cooldowns.melee = now + tank.cooldownDurations.melee;
    tank.lastAttackAt = now;
    spawnMeleeAttack(room, tank);
  }
  if (kind === "ranged" && tank.cooldowns.ranged <= now) {
    tank.cooldowns.ranged = now + tank.cooldownDurations.ranged;
    tank.lastAttackAt = now;
    spawnProjectile(room, tank, "ranged");
  }
  if (kind === "special" && tank.cooldowns.special <= now) {
    tank.cooldowns.special = now + tank.cooldownDurations.special;
    tank.lastAttackAt = now;
    spawnProjectile(room, tank, "special");
  }
}

function spawnMeleeAttack(room, tank) {
  room.meleeAttacks.push({
    id: nextMeleeAttackId++,
    ownerId: tank.id,
    angle: tank.angle,
    tick: 0,
    totalTicks: tank.melee.totalTicks,
    extendTicks: tank.melee.extendTicks,
    baseOffset: tank.melee.baseOffset,
    extension: tank.melee.extension,
    hitRadius: tank.melee.hitRadius,
    hitIds: new Set()
  });
}

function spawnProjectile(room, tank, kind) {
  const special = kind === "special";
  const radius = special ? tank.projectile.specialRadius : tank.projectile.rangedRadius;
  const speed = special ? tank.projectile.specialSpeed : tank.projectile.rangedSpeed;
  const offset = 62;

  room.projectiles.push({
    id: nextProjectileId++,
    ownerId: tank.id,
    kind,
    x: tank.x + Math.cos(tank.angle) * offset,
    y: tank.y + Math.sin(tank.angle) * offset,
    vx: Math.cos(tank.angle) * speed,
    vy: Math.sin(tank.angle) * speed,
    radius,
    damage: special ? tank.stats.specialDamage : tank.stats.rangedDamage,
    ttl: special ? tank.projectile.specialTtl : tank.projectile.rangedTtl
  });
}

function gameTick() {
  for (const room of rooms.values()) {
    if (room.status !== "playing" || !room.tanks) {
      continue;
    }

    updateTanks(room);
    updateMeleeAttacks(room);
    updateProjectiles(room);
    checkWinner(room);
    broadcastGame(room);
  }
}

function updateTanks(room) {
  const now = Date.now();

  for (const tank of room.tanks.values()) {
    const client = clients.get(tank.id);
    if (!tank.alive || !client) {
      continue;
    }

    const input = client.input || blankInput();
    if (input.left) {
      tank.angle -= 0.075;
    }
    if (input.right) {
      tank.angle += 0.075;
    }

    if (input.forward) {
      tank.speed = Math.min(
        tank.stats.maxSpeed,
        tank.speed + tank.stats.acceleration
      );
    } else if (input.brake) {
      if (tank.speed > 0) {
        tank.speed = Math.max(0, tank.speed - tank.stats.acceleration * 1.8);
      } else {
        tank.speed = Math.max(
          tank.stats.maxSpeed * -0.48,
          tank.speed - tank.stats.acceleration * 0.6
        );
      }
    } else {
      tank.speed *= 0.94;
      if (Math.abs(tank.speed) < 0.04) {
        tank.speed = 0;
      }
    }

    tank.x += Math.cos(tank.angle) * tank.speed;
    tank.y += Math.sin(tank.angle) * tank.speed;
    tank.x = clamp(tank.x, 70, MAP_WIDTH - 70);
    tank.y = clamp(tank.y, 70, MAP_HEIGHT - 70);

    if (now - tank.lastDamagedAt > 1900 && tank.shield < tank.stats.maxShield) {
      tank.shield = Math.min(tank.stats.maxShield, tank.shield + 0.18);
    }
  }
}

function updateProjectiles(room) {
  for (const projectile of room.projectiles) {
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    if (projectile.kind !== "ranged") {
      projectile.ttl -= 1;
    }

    if (
      projectile.x < 0 ||
      projectile.x > MAP_WIDTH ||
      projectile.y < 0 ||
      projectile.y > MAP_HEIGHT
    ) {
      projectile.ttl = 0;
      continue;
    }

    for (const target of room.tanks.values()) {
      if (target.id === projectile.ownerId || !target.alive) {
        continue;
      }

      const hitDistance = projectile.radius + (projectile.kind === "special" ? 48 : 38);
      if (Math.hypot(target.x - projectile.x, target.y - projectile.y) <= hitDistance) {
        damageTank(target, projectile.damage, false);
        projectile.ttl = 0;
        break;
      }
    }
  }

  room.projectiles = room.projectiles.filter((projectile) => projectile.ttl > 0);
}

function updateMeleeAttacks(room) {
  for (const attack of room.meleeAttacks) {
    const owner = room.tanks.get(attack.ownerId);
    if (!owner || !owner.alive) {
      attack.tick = attack.totalTicks + 1;
      continue;
    }

    const snapshot = meleeAttackSnapshot(room, attack);
    if (attack.tick <= attack.extendTicks) {
      for (const target of room.tanks.values()) {
        if (
          target.id === attack.ownerId ||
          !target.alive ||
          attack.hitIds.has(target.id)
        ) {
          continue;
        }

        const distance = Math.hypot(target.x - snapshot.x, target.y - snapshot.y);
        if (distance <= attack.hitRadius + TANK_HIT_RADIUS) {
          attack.hitIds.add(target.id);
          damageTank(target, owner.stats.meleeDamage, true);
        }
      }
    }

    attack.tick += 1;
  }

  room.meleeAttacks = room.meleeAttacks.filter(
    (attack) => attack.tick <= attack.totalTicks
  );
}

function damageTank(target, rawDamage, bypassShield) {
  const damage = rawDamage * (1 - target.stats.defense);
  target.lastDamagedAt = Date.now();

  if (!bypassShield && target.shield > 0) {
    const blocked = Math.min(target.shield, damage);
    target.shield -= blocked;
    const remaining = damage - blocked;
    if (remaining > 0) {
      target.health -= remaining;
    }
  } else {
    target.health -= damage;
  }

  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.speed = 0;
  }
}

function checkWinner(room) {
  if (room.status !== "playing" || !room.tanks) {
    return;
  }

  const alive = [...room.tanks.values()].filter((tank) => tank.alive);
  if (alive.length > 1) {
    return;
  }

  room.status = "waiting";
  room.winnerId = alive[0]?.id || null;
  room.endedAt = Date.now();
  room.projectiles = [];
  room.meleeAttacks = [];

  for (const player of getRoomClients(room)) {
    player.ready = false;
    player.input = blankInput();
  }

  broadcastRoom(room);
  broadcastLobby();
  broadcastGame(room);
}

function broadcastGame(room) {
  const payload = {
    roomId: room.id,
    status: room.status,
    winnerId: room.winnerId,
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT
    },
    tanks: [...(room.tanks || new Map()).values()].map((tank) => ({
      id: tank.id,
      name: tank.name,
      tankTypeId: tank.tankTypeId,
      tankTypeName: tank.tankTypeName,
      image: tank.image,
      color: tank.color,
      x: round(tank.x),
      y: round(tank.y),
      angle: round(tank.angle),
      speed: round(tank.speed),
      alive: tank.alive,
      health: round(tank.health),
      maxHealth: tank.stats.maxHealth,
      shield: round(tank.shield),
      maxShield: tank.stats.maxShield,
      cooldowns: cooldownSnapshot(tank),
      cooldownDurations: tank.cooldownDurations
    })),
    projectiles: room.projectiles.map((projectile) => ({
      id: projectile.id,
      ownerId: projectile.ownerId,
      kind: projectile.kind,
      x: round(projectile.x),
      y: round(projectile.y),
      radius: projectile.radius
    })),
    meleeAttacks: (room.meleeAttacks || []).map((attack) =>
      meleeAttackSnapshot(room, attack)
    )
  };

  broadcast(room, "gameState", payload);
}

function meleeAttackSnapshot(room, attack) {
  const owner = room.tanks.get(attack.ownerId);
  const progress = meleeProgress(attack);
  const reach = attack.baseOffset + attack.extension * progress;
  const x = owner ? owner.x + Math.cos(attack.angle) * reach : 0;
  const y = owner ? owner.y + Math.sin(attack.angle) * reach : 0;

  return {
    id: attack.id,
    ownerId: attack.ownerId,
    x: round(x),
    y: round(y),
    angle: round(attack.angle),
    progress: round(progress),
    extending: attack.tick <= attack.extendTicks,
    radius: attack.hitRadius
  };
}

function meleeProgress(attack) {
  if (attack.tick <= attack.extendTicks) {
    return clamp(attack.tick / attack.extendTicks, 0, 1);
  }

  return clamp(
    1 - (attack.tick - attack.extendTicks) / (attack.totalTicks - attack.extendTicks),
    0,
    1
  );
}

function cooldownSnapshot(tank) {
  const now = Date.now();
  return {
    melee: Math.max(0, tank.cooldowns.melee - now),
    ranged: Math.max(0, tank.cooldowns.ranged - now),
    special: Math.max(0, tank.cooldowns.special - now)
  };
}

function sendProfile(client) {
  send(client, "profile", {
    id: client.id,
    name: client.name,
    tankTypeId: client.tankTypeId,
    tankTypes: tankTypeSummaries()
  });
}

function tankTypeSummaries() {
  return tankCatalog.types.map((type) => ({
    id: type.id,
    name: type.name,
    description: type.description,
    image: type.image,
    stats: { ...type.stats },
    cooldowns: { ...type.cooldowns }
  }));
}

function getTankType(tankTypeId) {
  return tankTypesById.get(String(tankTypeId || "")) || null;
}

function createChatMessage(client, text, scope, roomId) {
  return {
    id: nextChatId++,
    scope,
    roomId,
    senderId: client.id,
    senderName: client.name,
    text,
    createdAt: Date.now()
  };
}

function pushLimited(list, item, limit) {
  list.push(item);
  while (list.length > limit) {
    list.shift();
  }
}

function broadcastRoom(room) {
  const payload = roomSnapshot(room);
  broadcast(room, "roomState", payload);
}

function broadcastLobby() {
  const payload = lobbySnapshot();
  for (const client of clients.values()) {
    if (client.name) {
      send(client, "lobbyState", payload);
    }
  }
}

function sendLobby(client) {
  send(client, "lobbyState", lobbySnapshot());
}

function lobbySnapshot() {
  return {
    tankTypes: tankTypeSummaries(),
    users: [...clients.values()]
      .filter((c) => c.name)
      .map((c) => ({ id: c.id, name: c.name, inRoom: !!c.roomId })),
    rooms: [...rooms.values()].map((room) => ({
      id: room.id,
      name: room.name,
      status: room.status,
      players: room.playerIds.size,
      maxPlayers: MAX_PLAYERS,
      ownerName: clients.get(room.ownerId)?.name || "방장 없음"
    }))
  };
}

function roomSnapshot(room) {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    ownerName: clients.get(room.ownerId)?.name || "방장 없음",
    status: room.status,
    winnerId: room.winnerId,
    winnerName: room.winnerId ? clients.get(room.winnerId)?.name || "승자" : "",
    players: getRoomClients(room).map((client) => ({
      id: client.id,
      name: client.name,
      tankTypeId: client.tankTypeId,
      tankTypeName: getTankType(client.tankTypeId)?.name || "전차",
      ready: client.ready,
      owner: client.id === room.ownerId
    }))
  };
}

function broadcast(room, type, data) {
  for (const client of getRoomClients(room)) {
    send(client, type, data);
  }
}

function getRoomClients(room) {
  return [...room.playerIds]
    .map((id) => clients.get(id))
    .filter(Boolean);
}

function getClientRoom(client) {
  if (!client.roomId) {
    return null;
  }
  return rooms.get(client.roomId) || null;
}

function disconnect(client) {
  if (!clients.has(client.id)) {
    return;
  }
  leaveRoom(client);
  clients.delete(client.id);
  broadcastLobby();
}

function send(client, type, data) {
  if (client.socket.destroyed) {
    return;
  }

  try {
    client.socket.write(encodeFrame(JSON.stringify({ type, data })));
  } catch {
    disconnect(client);
  }
}

function encodeFrame(message) {
  const payload = Buffer.from(message);
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset++];
    const second = buffer[offset++];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;

    if (length === 126) {
      if (offset + 2 > buffer.length) break;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (offset + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    let mask;
    if (masked) {
      if (offset + 4 > buffer.length) break;
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (offset + length > buffer.length) break;
    const payload = buffer.subarray(offset, offset + length);
    offset += length;

    if (opcode === 0x8) {
      return messages;
    }
    if (opcode !== 0x1) {
      continue;
    }

    if (masked) {
      const unmasked = Buffer.alloc(length);
      for (let index = 0; index < length; index += 1) {
        unmasked[index] = payload[index] ^ mask[index % 4];
      }
      messages.push(unmasked.toString("utf8"));
    } else {
      messages.push(payload.toString("utf8"));
    }
  }

  return messages;
}

function colorForIndex(index) {
  return [
    "#e45757",
    "#48a868",
    "#4d7ee8",
    "#f2b134",
    "#9b6be8",
    "#2fb8b8",
    "#ef7d3c",
    "#d85ba7",
    "#7f9842",
    "#5d7f99"
  ][index % 10];
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function loadTankCatalog() {
  const filePath = path.join(DATA, "tanks.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rawTypes = Array.isArray(parsed.types) ? parsed.types : [];

  if (rawTypes.length === 0) {
    throw new Error("data/tanks.json must contain at least one tank type.");
  }

  const ids = new Set();
  const types = rawTypes.map((type, index) => {
    const normalized = normalizeTankType(type, index);
    if (ids.has(normalized.id)) {
      throw new Error(`Duplicate tank type id: ${normalized.id}`);
    }
    ids.add(normalized.id);
    return normalized;
  });

  return {
    defaultTankTypeId: parsed.defaultTankTypeId,
    types
  };
}

function normalizeTankType(type, index) {
  const fallbackId = `tank-${index + 1}`;
  const id = String(type.id || fallbackId).trim() || fallbackId;
  const stats = type.stats || {};
  const cooldowns = type.cooldowns || {};
  const projectile = type.projectile || {};
  const melee = type.melee || {};

  return {
    id,
    name: String(type.name || id).trim(),
    description: String(type.description || "").trim(),
    image: String(type.image || "/resource/tank.png").trim(),
    stats: {
      maxHealth: numberOr(stats.maxHealth, 100),
      maxShield: numberOr(stats.maxShield, 70),
      acceleration: numberOr(stats.acceleration, 0.34),
      maxSpeed: numberOr(stats.maxSpeed, 5.2),
      meleeDamage: numberOr(stats.meleeDamage, 25),
      rangedDamage: numberOr(stats.rangedDamage, 17),
      specialDamage: numberOr(stats.specialDamage, 46),
      defense: clamp(numberOr(stats.defense, 0.15), 0, 0.9)
    },
    cooldowns: {
      melee: numberOr(cooldowns.melee, 650),
      ranged: numberOr(cooldowns.ranged, 820),
      special: numberOr(cooldowns.special, 6500)
    },
    projectile: {
      rangedSpeed: numberOr(projectile.rangedSpeed, 13),
      rangedRadius: numberOr(projectile.rangedRadius, 10),
      rangedTtl: numberOr(projectile.rangedTtl, 54),
      specialSpeed: numberOr(projectile.specialSpeed, 10),
      specialRadius: numberOr(projectile.specialRadius, 24),
      specialTtl: numberOr(projectile.specialTtl, 76)
    },
    melee: {
      totalTicks: numberOr(melee.totalTicks, MELEE_TOTAL_TICKS),
      extendTicks: numberOr(melee.extendTicks, MELEE_EXTEND_TICKS),
      baseOffset: numberOr(melee.baseOffset, MELEE_BASE_OFFSET),
      extension: numberOr(melee.extension, MELEE_EXTENSION),
      hitRadius: numberOr(melee.hitRadius, MELEE_HIT_RADIUS)
    }
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isInsideDirectory(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
