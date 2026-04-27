const state = {
  socket: null,
  clientId: "",
  name: "",
  room: null,
  lobby: { rooms: [] },
  game: null,
  tankTypes: [],
  selectedTankTypeId: "",
  chat: {
    lobby: [],
    room: []
  },
  screen: "login",
  keys: {
    forward: false,
    brake: false,
    left: false,
    right: false
  },
  lastInputJson: "",
  meleeImageLoaded: false
};

const imageCache = new Map();

const meleeImage = new Image();
meleeImage.src = "/resource/Melee%20Attack.png";
meleeImage.onload = () => {
  state.meleeImageLoaded = true;
};

const el = {
  loginView: document.querySelector("#loginView"),
  lobbyView: document.querySelector("#lobbyView"),
  roomView: document.querySelector("#roomView"),
  gameView: document.querySelector("#gameView"),
  loginForm: document.querySelector("#loginForm"),
  nameInput: document.querySelector("#nameInput"),
  profileName: document.querySelector("#profileName"),
  createRoomForm: document.querySelector("#createRoomForm"),
  roomNameInput: document.querySelector("#roomNameInput"),
  refreshRoomsButton: document.querySelector("#refreshRoomsButton"),
  roomsList: document.querySelector("#roomsList"),
  roomTitle: document.querySelector("#roomTitle"),
  roomMeta: document.querySelector("#roomMeta"),
  roomCount: document.querySelector("#roomCount"),
  playersList: document.querySelector("#playersList"),
  roomTankTypeSelect: document.querySelector("#roomTankTypeSelect"),
  roomTankStats: document.querySelector("#roomTankStats"),
  readyButton: document.querySelector("#readyButton"),
  startButton: document.querySelector("#startButton"),
  leaveRoomButton: document.querySelector("#leaveRoomButton"),
  roomHint: document.querySelector("#roomHint"),
  gameCanvas: document.querySelector("#gameCanvas"),
  hudName: document.querySelector("#hudName"),
  healthBar: document.querySelector("#healthBar"),
  shieldBar: document.querySelector("#shieldBar"),
  cooldowns: document.querySelector("#cooldowns"),
  centerNotice: document.querySelector("#centerNotice"),
  exitGameButton: document.querySelector("#exitGameButton"),
  lobbyChatForm: document.querySelector("#lobbyChatForm"),
  lobbyChatInput: document.querySelector("#lobbyChatInput"),
  lobbyChatMessages: document.querySelector("#lobbyChatMessages"),
  roomChatForm: document.querySelector("#roomChatForm"),
  roomChatInput: document.querySelector("#roomChatInput"),
  roomChatMessages: document.querySelector("#roomChatMessages"),
  gameChatForm: document.querySelector("#gameChatForm"),
  gameChatInput: document.querySelector("#gameChatInput"),
  gameChatMessages: document.querySelector("#gameChatMessages"),
  toast: document.querySelector("#toast")
};

const ctx = el.gameCanvas.getContext("2d");

connect();
bindUi();
resizeCanvas();
requestAnimationFrame(draw);
setInterval(sendInput, 50);

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}`);

  state.socket.addEventListener("open", () => {
    if (state.name) {
      send("login", { name: state.name });
    }
  });

  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message.type, message.data);
  });

  state.socket.addEventListener("close", () => {
    showToast("연결이 끊겼습니다. 재접속을 시도합니다.");
    setTimeout(connect, 900);
  });
}

function bindUi() {
  el.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = el.nameInput.value.trim();
    if (!name) {
      showToast("닉네임을 입력해 주세요.");
      return;
    }
    state.name = name;
    send("login", { name });
  });

  el.createRoomForm.addEventListener("submit", (event) => {
    event.preventDefault();
    send("createRoom", { name: el.roomNameInput.value.trim() });
    el.roomNameInput.value = "";
  });

  el.refreshRoomsButton.addEventListener("click", () => {
    send("listRooms");
  });

  el.roomTankTypeSelect.addEventListener("change", () => {
    selectTankType(el.roomTankTypeSelect.value);
  });

  el.readyButton.addEventListener("click", () => {
    const player = currentRoomPlayer();
    send("setReady", { ready: !player?.ready });
  });

  el.startButton.addEventListener("click", () => {
    send("startGame");
  });

  el.leaveRoomButton.addEventListener("click", () => {
    send("leaveRoom");
    state.chat.room = [];
    renderChat("room");
    showView("lobby");
  });

  el.exitGameButton.addEventListener("click", () => {
    send("leaveRoom");
    state.game = null;
    state.chat.room = [];
    renderChat("room");
    showView("lobby");
  });

  el.lobbyChatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat("lobby", el.lobbyChatInput);
  });

  el.roomChatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat("room", el.roomChatInput);
  });

  el.gameChatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat("room", el.gameChatInput);
  });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", onKeyChange);
  window.addEventListener("keyup", onKeyChange);
}

function handleServerMessage(type, data) {
  if (type === "hello") {
    state.clientId = data.id;
    updateTankCatalog(data.tankTypes, data.tankTypeId);
  }
  if (type === "profile") {
    state.clientId = data.id;
    state.name = data.name;
    updateTankCatalog(data.tankTypes, data.tankTypeId);
    el.profileName.textContent = data.name;
    if (state.screen !== "room" && state.screen !== "game") {
      showView("lobby");
    }
  }
  if (type === "lobbyState") {
    state.lobby = data;
    updateTankCatalog(data.tankTypes, state.selectedTankTypeId);
    renderLobby();
  }
  if (type === "joinedRoom") {
    state.chat.room = [];
    renderChat("room");
    showView("room");
  }
  if (type === "roomState") {
    state.room = data;
    renderRoom();
    if (data.status === "playing") {
      showView("game");
    } else if (state.screen === "game" && data.winnerName) {
      el.centerNotice.textContent = `${data.winnerName} 승리`;
    }
  }
  if (type === "gameState") {
    state.game = data;
    if (data.status === "playing" || state.screen === "game") {
      showView("game");
    }
    renderHud();
  }
  if (type === "chatHistory") {
    state.chat[data.scope] = data.messages || [];
    renderChat(data.scope);
  }
  if (type === "chatMessage") {
    const list = state.chat[data.scope] || [];
    list.push(data.message);
    state.chat[data.scope] = list.slice(-60);
    renderChat(data.scope);
  }
  if (type === "error") {
    showToast(data.message);
  }
}

function showView(name) {
  state.screen = name;
  for (const view of [el.loginView, el.lobbyView, el.roomView, el.gameView]) {
    view.classList.remove("active");
  }
  document.querySelector(`#${name}View`).classList.add("active");

  if (name !== "game") {
    el.centerNotice.textContent = "";
  }
}

function renderLobby() {
  if (!state.lobby.rooms.length) {
    el.roomsList.innerHTML = `<div class="empty">열린 방이 없습니다.</div>`;
    return;
  }

  el.roomsList.innerHTML = "";
  for (const room of state.lobby.rooms) {
    const item = document.createElement("article");
    item.className = "roomItem";
    item.innerHTML = `
      <div>
        <strong></strong>
        <small></small>
      </div>
      <button type="button"></button>
    `;
    item.querySelector("strong").textContent = room.name;
    item.querySelector("small").textContent =
      `${room.ownerName} · ${room.players}/${room.maxPlayers} · ${statusLabel(room.status)}`;
    const button = item.querySelector("button");
    button.textContent = room.status === "waiting" ? "참가" : "진행 중";
    button.disabled = room.status !== "waiting" || room.players >= room.maxPlayers;
    button.addEventListener("click", () => send("joinRoom", { roomId: room.id }));
    el.roomsList.append(item);
  }
}

function renderRoom() {
  if (!state.room) {
    return;
  }

  const isOwner = state.room.ownerId === state.clientId;
  const me = currentRoomPlayer();
  const allReady = state.room.players.length > 0 && state.room.players.every((player) => player.ready);

  el.roomTitle.textContent = state.room.name;
  el.roomMeta.textContent = `${state.room.ownerName}의 방 · ${statusLabel(state.room.status)}`;
  el.roomCount.textContent = `${state.room.players.length}/10`;
  el.readyButton.textContent = me?.ready ? "레디 취소" : "레디";
  el.roomTankTypeSelect.disabled = state.room.status !== "waiting";
  el.startButton.disabled = !isOwner || !allReady || state.room.players.length < 2 || state.room.status !== "waiting";
  el.roomHint.textContent = isOwner
    ? "모든 인원이 레디하면 시작할 수 있습니다."
    : "레디 후 방장의 시작을 기다립니다.";

  el.playersList.innerHTML = "";
  for (const player of state.room.players) {
    const item = document.createElement("article");
    item.className = "playerItem";
    item.innerHTML = `
      <div>
        <strong></strong>
        <small></small>
      </div>
      <span class="badge"></span>
    `;
    item.querySelector("strong").textContent = player.name;
    item.querySelector("small").textContent =
      `${player.owner ? "방장" : "참가자"} · ${player.tankTypeName || "전차"}`;
    const badge = item.querySelector(".badge");
    badge.textContent = player.owner ? "방장" : player.ready ? "레디" : "대기";
    badge.classList.toggle("owner", player.owner);
    badge.classList.toggle("ready", player.ready && !player.owner);
    el.playersList.append(item);
  }
}

function renderHud() {
  const tank = myTank();
  if (!tank) {
    el.hudName.textContent = state.name;
    el.healthBar.style.width = "0%";
    el.shieldBar.style.width = "0%";
    return;
  }

  el.hudName.textContent = tank.alive
    ? `${tank.name} · ${tank.tankTypeName || "전차"}`
    : `${tank.name} · 관전`;
  el.healthBar.style.width = `${Math.max(0, (tank.health / tank.maxHealth) * 100)}%`;
  el.shieldBar.style.width = `${Math.max(0, (tank.shield / tank.maxShield) * 100)}%`;

  const specs = [
    ["C", "melee", tank.cooldownDurations?.melee || 650],
    ["V", "ranged", tank.cooldownDurations?.ranged || 820],
    ["Space", "special", tank.cooldownDurations?.special || 6500]
  ];

  el.cooldowns.innerHTML = "";
  for (const [label, key, max] of specs) {
    const value = tank.cooldowns?.[key] || 0;
    const item = document.createElement("div");
    item.className = "cooldown";
    item.style.setProperty("--fill", `${Math.min(100, (value / max) * 100)}%`);
    item.innerHTML = `<span>${value ? Math.ceil(value / 1000) : label}</span>`;
    el.cooldowns.append(item);
  }

  if (!tank.alive && state.game?.status === "playing") {
    el.centerNotice.textContent = "파괴됨 · 남은 전투 관전 중";
  } else if (state.game?.status === "playing") {
    el.centerNotice.textContent = "";
  }
}

function updateTankCatalog(tankTypes, selectedTankTypeId) {
  if (Array.isArray(tankTypes) && tankTypes.length) {
    state.tankTypes = tankTypes;
  }

  if (selectedTankTypeId) {
    state.selectedTankTypeId = selectedTankTypeId;
  }

  if (!state.selectedTankTypeId && state.tankTypes[0]) {
    state.selectedTankTypeId = state.tankTypes[0].id;
  }

  renderTankSelectors();
}

function renderTankSelectors() {
  renderTankSelect(el.roomTankTypeSelect);
  renderTankStats(el.roomTankStats);
}

function renderTankSelect(select) {
  if (!select) {
    return;
  }

  select.innerHTML = "";
  for (const tankType of state.tankTypes) {
    const option = document.createElement("option");
    option.value = tankType.id;
    option.textContent = tankType.name;
    select.append(option);
  }

  select.value = state.selectedTankTypeId;
}

function renderTankStats(container) {
  if (!container) {
    return;
  }

  const tankType = tankTypeById(state.selectedTankTypeId);
  container.innerHTML = "";
  if (!tankType) {
    return;
  }

  const description = document.createElement("p");
  description.textContent = tankType.description || "";
  container.append(description);

  const statLabels = [
    ["체력", "maxHealth"],
    ["보호막", "maxShield"],
    ["가속", "acceleration"],
    ["속도", "maxSpeed"],
    ["근접", "meleeDamage"],
    ["원거리", "rangedDamage"],
    ["특수", "specialDamage"],
    ["방어", "defense"]
  ];

  for (const [label, key] of statLabels) {
    const item = document.createElement("span");
    const name = document.createElement("em");
    const value = document.createElement("b");
    name.textContent = label;
    value.textContent =
      key === "defense"
        ? `${Math.round((tankType.stats[key] || 0) * 100)}%`
        : tankType.stats[key];
    item.append(name, value);
    container.append(item);
  }
}

function renderChat(scope) {
  if (scope === "lobby") {
    renderChatMessages(el.lobbyChatMessages, state.chat.lobby);
    return;
  }

  renderChatMessages(el.roomChatMessages, state.chat.room);
  renderChatMessages(el.gameChatMessages, state.chat.room);
}

function renderChatMessages(container, messages) {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  for (const message of messages || []) {
    const item = document.createElement("article");
    item.className = "chatMessage";

    const meta = document.createElement("small");
    meta.textContent = `${message.senderName} · ${formatChatTime(message.createdAt)}`;

    const text = document.createElement("p");
    text.textContent = message.text;

    item.append(meta, text);
    container.append(item);
  }

  container.scrollTop = container.scrollHeight;
}

function selectTankType(tankTypeId) {
  if (!tankTypeById(tankTypeId)) {
    return;
  }

  state.selectedTankTypeId = tankTypeId;
  renderTankSelectors();
  send("selectTank", { tankTypeId });
}

function sendChat(scope, input) {
  const text = input.value.trim();
  if (!text) {
    return;
  }

  send("chat", { scope, text });
  input.value = "";
}

function tankTypeById(id) {
  return state.tankTypes.find((tankType) => tankType.id === id) || null;
}

function getImage(src) {
  if (!imageCache.has(src)) {
    const image = new Image();
    image.loaded = false;
    image.onload = () => {
      image.loaded = true;
    };
    image.src = src;
    imageCache.set(src, image);
  }

  return imageCache.get(src);
}

function formatChatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function draw() {
  requestAnimationFrame(draw);

  if (state.screen !== "game") {
    return;
  }

  const { width, height } = canvasSize();
  ctx.clearRect(0, 0, width, height);

  if (!state.game) {
    drawGrid(0, 0, width, height, 80);
    return;
  }

  const focus = cameraTarget();
  const camera = {
    x: focus.x - width / 2,
    y: focus.y - height / 2
  };

  drawWorld(camera);
  drawProjectiles(camera);
  drawTanks(camera);
  drawMeleeAttacks(camera);
  drawMinimap();
}

function drawWorld(camera) {
  const { width, height } = state.game.map;
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  ctx.fillStyle = "#2d352e";
  ctx.fillRect(0, 0, width, height);

  drawGrid(0, 0, width, height, 80);

  ctx.strokeStyle = "#d6c37d";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  for (let index = 0; index < 18; index += 1) {
    const x = 240 + ((index * 311) % (width - 480));
    const y = 190 + ((index * 227) % (height - 380));
    ctx.fillStyle = index % 2 ? "#47513f" : "#3c4939";
    ctx.fillRect(x, y, 120, 34);
  }

  ctx.restore();
}

function drawGrid(x, y, width, height, size) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let gx = x; gx <= x + width; gx += size) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
    ctx.stroke();
  }
  for (let gy = y; gy <= y + height; gy += size) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTanks(camera) {
  for (const tank of state.game.tanks) {
    const x = tank.x - camera.x;
    const y = tank.y - camera.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tank.angle + Math.PI / 2);
    ctx.globalAlpha = tank.alive ? 1 : 0.36;

    ctx.fillStyle = tank.color;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 4;
    roundRect(ctx, -34, -40, 68, 82, 8);
    ctx.fill();
    ctx.stroke();

    const tankImage = getImage(tank.image || "/resource/tank.png");
    if (tankImage.loaded) {
      ctx.drawImage(tankImage, -30, -36, 60, 72);
    }

    ctx.restore();

    ctx.save();
    ctx.globalAlpha = tank.alive ? 1 : 0.55;
    ctx.fillStyle = "#fff";
    ctx.font = "700 13px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(tank.name, x, y - 58);
    drawBar(x - 34, y - 48, 68, 6, tank.health / tank.maxHealth, "#d64b43");
    drawBar(x - 34, y - 39, 68, 5, tank.shield / tank.maxShield, "#4e98dd");
    ctx.restore();
  }
}

function drawProjectiles(camera) {
  for (const projectile of state.game.projectiles) {
    const x = projectile.x - camera.x;
    const y = projectile.y - camera.y;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, projectile.radius, 0, Math.PI * 2);
    ctx.fillStyle = projectile.kind === "special" ? "#f0c44e" : "#f4f1e7";
    ctx.shadowColor = projectile.kind === "special" ? "#f0c44e" : "#fff";
    ctx.shadowBlur = projectile.kind === "special" ? 16 : 8;
    ctx.fill();
    ctx.restore();
  }
}

function drawMeleeAttacks(camera) {
  for (const attack of state.game.meleeAttacks || []) {
    const x = attack.x - camera.x;
    const y = attack.y - camera.y;
    const size = 58 + attack.progress * 34;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(attack.angle + Math.PI / 2);
    ctx.globalAlpha = attack.extending ? 0.98 : 0.72;

    if (state.meleeImageLoaded) {
      ctx.drawImage(meleeImage, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = "#f01e2c";
      ctx.strokeStyle = "#101010";
      ctx.lineWidth = 4;
      roundRect(ctx, -size / 2, -size / 2, size, size * 0.82, 14);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}

function drawMinimap() {
  if (!state.game) {
    return;
  }

  const { width, height } = canvasSize();
  const mapW = 150;
  const mapH = 100;
  const x = width - mapW - 18;
  const y = height - mapH - 18;

  ctx.save();
  ctx.fillStyle = "rgba(16, 19, 23, 0.74)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, mapW, mapH, 8);
  ctx.fill();
  ctx.stroke();

  for (const tank of state.game.tanks) {
    ctx.fillStyle = tank.alive ? tank.color : "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(
      x + (tank.x / state.game.map.width) * mapW,
      y + (tank.y / state.game.map.height) * mapH,
      tank.id === state.clientId ? 4 : 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawBar(x, y, width, height, ratio, color) {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, ratio)) * width, height);
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function cameraTarget() {
  const mine = myTank();
  if (mine) {
    return mine;
  }

  const alive = state.game.tanks.find((tank) => tank.alive);
  if (alive) {
    return alive;
  }

  return {
    x: state.game.map.width / 2,
    y: state.game.map.height / 2
  };
}

function myTank() {
  return state.game?.tanks.find((tank) => tank.id === state.clientId) || null;
}

function currentRoomPlayer() {
  return state.room?.players.find((player) => player.id === state.clientId) || null;
}

function isTypingField(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
}

function onKeyChange(event) {
  if (isTypingField(event.target)) {
    return;
  }

  if (state.screen !== "game") {
    return;
  }

  const active = event.type === "keydown";
  const key = event.code;

  if (["ArrowLeft", "ArrowRight", "Space"].includes(key)) {
    event.preventDefault();
  }

  if (key === "KeyZ") {
    state.keys.forward = active;
  }
  if (key === "KeyX") {
    state.keys.brake = active;
  }
  if (key === "ArrowLeft") {
    state.keys.left = active;
  }
  if (key === "ArrowRight") {
    state.keys.right = active;
  }

  if (!active || event.repeat) {
    return;
  }

  if (key === "KeyC") {
    send("attack", { kind: "melee" });
  }
  if (key === "KeyV") {
    send("attack", { kind: "ranged" });
  }
  if (key === "Space") {
    send("attack", { kind: "special" });
  }
}

function sendInput() {
  if (state.screen !== "game") {
    return;
  }

  const json = JSON.stringify(state.keys);
  if (json === state.lastInputJson) {
    return;
  }

  state.lastInputJson = json;
  send("input", state.keys);
}

function send(type, data = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(JSON.stringify({ type, data }));
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  el.gameCanvas.width = Math.floor(window.innerWidth * ratio);
  el.gameCanvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function canvasSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function statusLabel(status) {
  return status === "playing" ? "전투 중" : "대기 중";
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    el.toast.classList.remove("show");
  }, 2400);
}
