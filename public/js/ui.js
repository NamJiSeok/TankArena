/**
 * ui.js — UI 렌더링 및 이벤트 바인딩
 *
 * 게임 캔버스를 제외한 모든 DOM 렌더링과 사용자 입력 이벤트 핸들러를 담당한다.
 *
 * 담당 영역:
 *   - 화면 전환 (login → lobby → room → game)
 *   - 로비: 방 목록, 접속 유저 목록
 *   - 대기실: 플레이어 목록, 레디/시작 버튼
 *   - 게임 HUD: 체력·보호막 바, 쿨다운 표시기, 관전 안내
 *   - 전차 선택 모달: 그리드, 스탯 표시, 선택 확인
 *   - 채팅: 로비·방·게임 내 채팅 렌더링 및 전송
 *   - 캔버스 크기 조정 (devicePixelRatio 보정)
 *   - 모든 버튼/폼 이벤트 리스너 등록 (bindUi)
 */

import { state, el, ctx, myTank, currentRoomPlayer, tankTypeById } from "./state.js";
import { send } from "./socket.js";
import { showToast } from "./toast.js";
import { formatChatTime, statusLabel, canvasSize } from "./utils.js";

// showToast 를 messages.js 가 이 모듈을 통해 re-import 할 수 있도록 재내보낸다
export { showToast };

/**
 * 전차 선택 모달에서 "확인" 전까지 임시로 선택된 전차 타입 ID.
 * 확인을 눌러야 state.selectedTankTypeId 가 변경된다.
 */
let pendingTankTypeId = "";

// ── 화면 전환 ──────────────────────────────────────────────────────────────

/**
 * 지정한 이름의 화면을 활성화하고 나머지를 숨긴다.
 * game 이외의 화면으로 전환할 때는 중앙 공지·관전 안내를 초기화한다.
 * @param {"login"|"lobby"|"room"|"game"} name
 */
export function showView(name) {
  state.screen = name;
  for (const view of [el.loginView, el.lobbyView, el.roomView, el.gameView]) {
    view.classList.remove("active");
  }
  document.querySelector(`#${name}View`).classList.add("active");

  if (name !== "game") {
    el.centerNotice.textContent = "";
    el.spectateNotice.textContent = "";
  }
}

// ── 로비 렌더링 ────────────────────────────────────────────────────────────

/**
 * 로비 전체를 다시 그린다.
 * 접속 유저 목록과 방 목록을 갱신한다.
 */
export function renderLobby() {
  renderOnlineUsers();

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
    // 전투 중이거나 정원이 찬 방은 참가 버튼 비활성화
    button.disabled = room.status !== "waiting" || room.players >= room.maxPlayers;
    button.addEventListener("click", () => send("joinRoom", { roomId: room.id }));
    el.roomsList.append(item);
  }
}

/**
 * 현재 로비에 접속 중인 유저 목록을 렌더링한다.
 * 방 안에 있는 유저는 "게임 중" 배지를 표시한다.
 */
function renderOnlineUsers() {
  const users = state.lobby.users || [];
  el.onlineCount.textContent = `${users.length}명`;
  el.onlineUsersList.innerHTML = "";

  if (!users.length) {
    el.onlineUsersList.innerHTML = `<div class="empty">접속 중인 인원이 없습니다.</div>`;
    return;
  }

  for (const user of users) {
    const item = document.createElement("div");
    item.className = "onlineUserItem";

    const name = document.createElement("span");
    name.textContent = user.name;

    const status = document.createElement("span");
    status.className = "userStatus" + (user.inRoom ? " inRoom" : "");
    status.textContent = user.inRoom ? "게임 중" : "로비";

    item.append(name, status);
    el.onlineUsersList.append(item);
  }
}

// ── 대기실 렌더링 ──────────────────────────────────────────────────────────

/**
 * 대기실 화면 전체를 다시 그린다.
 * 방장/참가자 여부에 따라 버튼 표시를 다르게 한다.
 * 모든 비방장 플레이어가 레디 상태여야 시작 버튼이 활성화된다.
 */
export function renderRoom() {
  if (!state.room) {
    return;
  }

  const isOwner = state.room.ownerId === state.clientId;
  const me = currentRoomPlayer();
  const nonOwners = state.room.players.filter((p) => !p.owner);
  // 비방장 플레이어가 1명 이상이고 전원 레디일 때만 시작 가능
  const allReady = nonOwners.length > 0 && nonOwners.every((p) => p.ready);

  el.roomTitle.textContent = state.room.name;
  el.roomMeta.textContent = `${state.room.ownerName}의 방 · ${statusLabel(state.room.status)}`;
  el.roomCount.textContent = `${state.room.players.length}/10`;

  el.readyButton.hidden = isOwner;
  el.readyButton.textContent = me?.ready ? "레디 취소" : "레디";

  el.startButton.hidden = !isOwner;
  el.startButton.disabled =
    !allReady || state.room.players.length < 2 || state.room.status !== "waiting";

  el.roomHint.textContent = isOwner
    ? "모든 인원이 레디하면 시작할 수 있습니다."
    : "레디 후 방장의 시작을 기다립니다.";

  // 플레이어 목록 렌더링
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

// ── 게임 HUD 렌더링 ────────────────────────────────────────────────────────

/**
 * 화면 좌상단 HUD(체력·보호막 바, 쿨다운, 관전 안내)를 갱신한다.
 * 내 전차가 없으면(사망 또는 게임 전) 빈 상태로 표시한다.
 */
export function renderHud() {
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

  // 쿨다운 인디케이터: [키 레이블, 상태 키, 최대 쿨다운(ms)]
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
    // CSS 변수 --fill 로 쿨다운 진행률을 표현 (CSS 에서 원형 애니메이션에 사용)
    item.style.setProperty("--fill", `${Math.min(100, (value / max) * 100)}%`);
    // 쿨다운 중에는 남은 초 표시, 준비됐을 때는 키 레이블 표시
    item.innerHTML = `<span>${value ? Math.ceil(value / 1000) : label}</span>`;
    el.cooldowns.append(item);
  }

  if (!tank.alive && state.game?.status === "playing") {
    // 사망 후 관전 안내 표시
    const aliveTanks = state.game.tanks.filter((t) => t.alive);
    const spectated = aliveTanks[Math.min(state.spectateIndex, aliveTanks.length - 1)];
    el.spectateNotice.textContent = spectated
      ? `👁 ${spectated.name} 관전 중  ·  Z키로 전환`
      : "관전 중";
    el.centerNotice.textContent = "";
  } else if (state.game?.status === "playing") {
    el.spectateNotice.textContent = "";
    el.centerNotice.textContent = "";
  }
}

// ── 전차 카탈로그 ──────────────────────────────────────────────────────────

/**
 * 서버에서 받은 전차 타입 목록과 선택된 전차 ID를 state에 반영하고
 * 대기실의 전차 미리보기 카드를 갱신한다.
 * @param {Array} tankTypes - 서버 전차 타입 배열
 * @param {string} selectedTankTypeId - 현재 선택된 전차 타입 ID
 */
export function updateTankCatalog(tankTypes, selectedTankTypeId) {
  if (Array.isArray(tankTypes) && tankTypes.length) {
    state.tankTypes = tankTypes;
  }

  if (selectedTankTypeId) {
    state.selectedTankTypeId = selectedTankTypeId;
  }

  // 선택값이 없으면 첫 번째 전차를 기본값으로 설정
  if (!state.selectedTankTypeId && state.tankTypes[0]) {
    state.selectedTankTypeId = state.tankTypes[0].id;
  }

  renderTankPreview();
}

/**
 * 대기실의 전차 미리보기 카드(이미지 + 이름 + 변경 힌트)를 렌더링한다.
 */
function renderTankPreview() {
  if (!el.tankPreview) {
    return;
  }

  const tankType = tankTypeById(state.selectedTankTypeId);
  el.tankPreview.innerHTML = "";
  if (!tankType) {
    return;
  }

  if (tankType.image) {
    const img = document.createElement("img");
    img.src = tankType.image;
    img.alt = tankType.name;
    el.tankPreview.append(img);
  }

  const name = document.createElement("strong");
  name.textContent = tankType.name;
  el.tankPreview.append(name);

  const hint = document.createElement("small");
  hint.textContent = "클릭하여 전차 변경";
  el.tankPreview.append(hint);
}

/**
 * 전차 선택 모달 내 전차 그리드를 렌더링한다.
 * pendingTankTypeId 와 일치하는 카드에 "selected" 클래스를 적용한다.
 * 게임 진행 중에는 전차 변경이 불가하므로 카드를 비활성화한다.
 */
function renderTankGrid() {
  if (!el.tankGrid) {
    return;
  }

  // 대기 중인 방 또는 방 밖에서만 변경 가능
  const canChange = !state.room || state.room.status === "waiting";
  el.tankGrid.innerHTML = "";

  for (const tankType of state.tankTypes) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tankCard" + (tankType.id === pendingTankTypeId ? " selected" : "");
    card.disabled = !canChange;
    card.dataset.tankId = tankType.id;

    if (tankType.image) {
      const img = document.createElement("img");
      img.src = tankType.image;
      img.alt = tankType.name;
      card.append(img);
    }

    const name = document.createElement("span");
    name.textContent = tankType.name;
    card.append(name);

    el.tankGrid.append(card);
  }
}

/**
 * 전차 선택 모달의 스탯 영역을 렌더링한다.
 * 체력·보호막·가속·속도·근접/원거리/특수 대미지·방어율을 표시한다.
 * @param {HTMLElement} container - 스탯을 렌더링할 DOM 컨테이너
 * @param {string} tankTypeId - 표시할 전차 타입 ID
 */
function renderTankStats(container, tankTypeId) {
  if (!container) {
    return;
  }

  const tankType = tankTypeById(tankTypeId || state.selectedTankTypeId);
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
    // 방어율만 백분율(%)로 표기
    value.textContent =
      key === "defense"
        ? `${Math.round((tankType.stats[key] || 0) * 100)}%`
        : tankType.stats[key];
    item.append(name, value);
    container.append(item);
  }
}

/**
 * 선택한 전차 타입을 서버에 전송하고 미리보기 카드를 갱신한다.
 * 유효하지 않은 ID면 아무것도 하지 않는다.
 * @param {string} tankTypeId
 */
function selectTankType(tankTypeId) {
  if (!tankTypeById(tankTypeId)) {
    return;
  }
  state.selectedTankTypeId = tankTypeId;
  renderTankPreview();
  send("selectTank", { tankTypeId });
}

// ── 채팅 렌더링 ────────────────────────────────────────────────────────────

/**
 * 지정 스코프의 채팅 메시지를 관련 DOM 컨테이너에 렌더링한다.
 * room 스코프는 대기실 채팅과 게임 내 채팅 두 곳을 모두 갱신한다.
 * @param {"lobby"|"room"} scope
 */
export function renderChat(scope) {
  if (scope === "lobby") {
    renderChatMessages(el.lobbyChatMessages, state.chat.lobby);
    return;
  }

  // 방 채팅은 대기실과 게임 화면 모두에서 공유
  renderChatMessages(el.roomChatMessages, state.chat.room);
  renderChatMessages(el.gameChatMessages, state.chat.room);
}

/**
 * 메시지 배열을 DOM 컨테이너에 렌더링하고 최하단으로 스크롤한다.
 * @param {HTMLElement|null} container
 * @param {Array} messages - 채팅 메시지 객체 배열
 */
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

  // 새 메시지가 항상 보이도록 스크롤을 최하단으로 이동
  container.scrollTop = container.scrollHeight;
}

/**
 * 채팅 입력 필드의 값을 서버로 전송하고 필드를 비운다.
 * 공백만 있는 메시지는 무시한다.
 * @param {"lobby"|"room"} scope
 * @param {HTMLInputElement} input
 */
function sendChat(scope, input) {
  const text = input.value.trim();
  if (!text) {
    return;
  }
  send("chat", { scope, text });
  input.value = "";
}

// ── 캔버스 크기 조정 ───────────────────────────────────────────────────────

/**
 * 브라우저 창 크기에 맞게 캔버스 해상도를 조정한다.
 * devicePixelRatio 를 반영하여 Retina/고DPI 디스플레이에서도 선명하게 표시된다.
 * window resize 이벤트와 초기화 시 호출된다.
 */
export function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvasSize();
  el.gameCanvas.width = Math.floor(width * ratio);
  el.gameCanvas.height = Math.floor(height * ratio);
  // 논리 픽셀과 물리 픽셀의 비율을 ctx 변환 행렬로 보정
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

// ── UI 이벤트 바인딩 ───────────────────────────────────────────────────────

/**
 * 모든 버튼·폼·모달에 이벤트 리스너를 등록한다.
 * main.js 에서 페이지 로드 직후 한 번만 호출한다.
 */
export function bindUi() {
  // 로그인 폼 제출
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

  // 방 생성 폼 제출
  el.createRoomForm.addEventListener("submit", (event) => {
    event.preventDefault();
    send("createRoom", { name: el.roomNameInput.value.trim() });
    el.roomNameInput.value = "";
  });

  // 방 목록 새로고침
  el.refreshRoomsButton.addEventListener("click", () => {
    send("listRooms");
  });

  // 전차 미리보기 카드 클릭 → 선택 모달 열기
  el.tankPreview.addEventListener("click", () => {
    pendingTankTypeId = state.selectedTankTypeId;
    renderTankGrid();
    renderTankStats(el.roomTankStats, pendingTankTypeId);
    el.tankSelectModal.hidden = false;
  });

  // 모달 내 전차 카드 클릭 → pendingTankTypeId 변경 (아직 확정 아님)
  el.tankGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".tankCard");
    if (!card || card.disabled) {
      return;
    }
    pendingTankTypeId = card.dataset.tankId;
    renderTankGrid();
    renderTankStats(el.roomTankStats, pendingTankTypeId);
  });

  // 모달 닫기 (X 버튼 / 취소 버튼 / 배경 클릭)
  el.tankModalClose.addEventListener("click", () => {
    el.tankSelectModal.hidden = true;
  });

  el.tankCancelButton.addEventListener("click", () => {
    el.tankSelectModal.hidden = true;
  });

  el.tankSelectModal.addEventListener("click", (event) => {
    if (event.target === el.tankSelectModal) {
      el.tankSelectModal.hidden = true;
    }
  });

  // 전차 선택 확정 → 서버에 전송
  el.tankConfirmButton.addEventListener("click", () => {
    selectTankType(pendingTankTypeId);
    el.tankSelectModal.hidden = true;
  });

  // 레디 토글 (현재 레디 상태의 반전값을 전송)
  el.readyButton.addEventListener("click", () => {
    const player = currentRoomPlayer();
    send("setReady", { ready: !player?.ready });
  });

  // 게임 시작 (방장 전용)
  el.startButton.addEventListener("click", () => {
    send("startGame");
  });

  // 방 나가기 (대기실 → 로비)
  el.leaveRoomButton.addEventListener("click", () => {
    send("leaveRoom");
    state.chat.room = [];
    renderChat("room");
    showView("lobby");
  });

  // 게임 중 나가기 (게임 → 로비)
  el.exitGameButton.addEventListener("click", () => {
    send("leaveRoom");
    state.game = null;
    state.chat.room = [];
    renderChat("room");
    showView("lobby");
  });

  // 채팅 폼 제출 (로비 / 방 / 게임 내)
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

  // 창 크기 변경 시 캔버스 해상도 재조정
  window.addEventListener("resize", resizeCanvas);
}
