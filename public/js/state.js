/**
 * state.js — 공유 상태 및 DOM 캐시
 *
 * 애플리케이션 전역에서 공유되는 유일한 게임 상태 객체(state)와
 * DOM 요소 참조 캐시(el), 캔버스 2D 컨텍스트(ctx)를 정의한다.
 * 게임 상태를 직접 조회하는 단순 헬퍼 함수(myTank 등)도 여기에 둔다.
 *
 * 다른 모듈은 이 파일에서 state / el / ctx 를 import 하여 사용한다.
 * state 객체는 뮤터블(가변)이며, 각 모듈이 프로퍼티를 직접 수정한다.
 */

/** 게임 전체 런타임 상태 */
export const state = {
  /** 현재 WebSocket 인스턴스 */
  socket: null,
  /** 서버가 부여한 나의 클라이언트 UUID */
  clientId: "",
  /** 로그인 닉네임 */
  name: "",
  /** 현재 입장한 방 정보 (서버 roomState 스냅샷) */
  room: null,
  /** 로비 상태 (방 목록, 접속 유저 목록) */
  lobby: { rooms: [] },
  /** 게임 진행 중 서버에서 수신한 gameState 스냅샷 */
  game: null,
  /** 서버에서 받은 전차 타입 카탈로그 배열 */
  tankTypes: [],
  /** 내가 선택한 전차 타입 ID */
  selectedTankTypeId: "",
  /** 채팅 메시지 버퍼 (scope 별로 구분) */
  chat: {
    lobby: [],
    room: []
  },
  /** 현재 활성 화면: "login" | "lobby" | "room" | "game" */
  screen: "login",
  /** 현재 키 입력 상태 (매 50 ms 서버로 전송) */
  keys: {
    forward: false,
    brake: false,
    left: false,
    right: false
  },
  /** 중복 전송 방지용 직전 input JSON 문자열 */
  lastInputJson: "",
  /** 근접 공격 이미지 로드 완료 여부 */
  meleeImageLoaded: false,
  /** 관전 대상 인덱스 (생존 전차 배열 기준) */
  spectateIndex: 0
};

/**
 * DOM 요소 참조 캐시.
 * type="module" 스크립트는 defer 와 동일하게 DOM 완성 후 실행되므로
 * 모듈 최상위에서 querySelector 를 호출해도 안전하다.
 */
export const el = {
  // ── 화면 컨테이너
  loginView: document.querySelector("#loginView"),
  lobbyView: document.querySelector("#lobbyView"),
  roomView: document.querySelector("#roomView"),
  gameView: document.querySelector("#gameView"),

  // ── 로그인
  loginForm: document.querySelector("#loginForm"),
  nameInput: document.querySelector("#nameInput"),
  profileName: document.querySelector("#profileName"),

  // ── 로비
  createRoomForm: document.querySelector("#createRoomForm"),
  roomNameInput: document.querySelector("#roomNameInput"),
  refreshRoomsButton: document.querySelector("#refreshRoomsButton"),
  roomsList: document.querySelector("#roomsList"),
  onlineCount: document.querySelector("#onlineCount"),
  onlineUsersList: document.querySelector("#onlineUsersList"),

  // ── 대기실
  roomTitle: document.querySelector("#roomTitle"),
  roomMeta: document.querySelector("#roomMeta"),
  roomCount: document.querySelector("#roomCount"),
  playersList: document.querySelector("#playersList"),
  roomTankStats: document.querySelector("#roomTankStats"),
  readyButton: document.querySelector("#readyButton"),
  startButton: document.querySelector("#startButton"),
  leaveRoomButton: document.querySelector("#leaveRoomButton"),
  roomHint: document.querySelector("#roomHint"),

  // ── 전차 선택 모달
  tankSelectModal: document.querySelector("#tankSelectModal"),
  tankModalClose: document.querySelector("#tankModalClose"),
  tankGrid: document.querySelector("#tankGrid"),
  tankConfirmButton: document.querySelector("#tankConfirmButton"),
  tankCancelButton: document.querySelector("#tankCancelButton"),
  tankPreview: document.querySelector("#tankPreview"),

  // ── 게임 HUD
  gameCanvas: document.querySelector("#gameCanvas"),
  hudName: document.querySelector("#hudName"),
  healthBar: document.querySelector("#healthBar"),
  shieldBar: document.querySelector("#shieldBar"),
  cooldowns: document.querySelector("#cooldowns"),
  centerNotice: document.querySelector("#centerNotice"),
  spectateNotice: document.querySelector("#spectateNotice"),
  exitGameButton: document.querySelector("#exitGameButton"),

  // ── 채팅 (로비 / 대기실 / 게임 내)
  lobbyChatForm: document.querySelector("#lobbyChatForm"),
  lobbyChatInput: document.querySelector("#lobbyChatInput"),
  lobbyChatMessages: document.querySelector("#lobbyChatMessages"),
  roomChatForm: document.querySelector("#roomChatForm"),
  roomChatInput: document.querySelector("#roomChatInput"),
  roomChatMessages: document.querySelector("#roomChatMessages"),
  gameChatForm: document.querySelector("#gameChatForm"),
  gameChatInput: document.querySelector("#gameChatInput"),
  gameChatMessages: document.querySelector("#gameChatMessages"),

  // ── 기타
  toast: document.querySelector("#toast")
};

/** 게임 캔버스 2D 렌더링 컨텍스트 */
export const ctx = el.gameCanvas.getContext("2d");

// ── 공통 헬퍼 쿼리 ────────────────────────────────────────────

/**
 * state.game.tanks 에서 나(clientId)의 전차를 반환한다.
 * 게임이 시작되지 않았거나 내 전차가 없으면 null.
 */
export function myTank() {
  return state.game?.tanks.find((tank) => tank.id === state.clientId) || null;
}

/**
 * state.room.players 에서 나의 플레이어 정보를 반환한다.
 * 방 밖이면 null.
 */
export function currentRoomPlayer() {
  return state.room?.players.find((player) => player.id === state.clientId) || null;
}

/**
 * ID 로 전차 타입 정의 객체를 반환한다.
 * 존재하지 않으면 null.
 * @param {string} id - 전차 타입 UUID
 */
export function tankTypeById(id) {
  return state.tankTypes.find((tankType) => tankType.id === id) || null;
}
