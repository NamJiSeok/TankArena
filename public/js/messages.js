/**
 * messages.js — 서버 메시지 라우터
 *
 * 서버에서 수신한 WebSocket 메시지를 타입별로 분기하고
 * 적절한 상태 갱신 및 UI 렌더링 함수를 호출한다.
 *
 * 처리하는 메시지 타입:
 *   hello       - 최초 연결 시 클라이언트 ID와 전차 카탈로그 수신
 *   profile     - 로그인 성공, 프로필 및 로비 진입
 *   lobbyState  - 로비 전체 상태 갱신 (방 목록, 유저 목록)
 *   joinedRoom  - 방 입장 완료 신호
 *   roomState   - 대기실 상태 갱신 (플레이어, 레디 여부 등)
 *   gameState   - 게임 진행 중 매 틱(30 fps) 수신되는 게임 스냅샷
 *   chatHistory - 방/로비 입장 시 이전 채팅 기록
 *   chatMessage - 실시간 채팅 수신
 *   error       - 서버 오류 메시지 (토스트로 표시)
 */

import { state, el } from "./state.js";
import {
  showView,
  showToast,
  renderLobby,
  renderRoom,
  renderHud,
  renderChat,
  updateTankCatalog
} from "./ui.js";

/**
 * 서버 메시지를 타입에 따라 처리한다.
 * socket.js 의 onMessage 콜백으로 등록된다.
 * @param {string} type - 서버가 보낸 메시지 타입
 * @param {object} data - 메시지 페이로드
 */
export function handleServerMessage(type, data) {
  // 최초 연결 확인 — 서버가 클라이언트 ID를 발급
  if (type === "hello") {
    state.clientId = data.id;
    updateTankCatalog(data.tankTypes, data.tankTypeId);
  }

  // 로그인 성공 — 닉네임·카탈로그를 갱신하고 로비로 이동
  if (type === "profile") {
    state.clientId = data.id;
    state.name = data.name;
    updateTankCatalog(data.tankTypes, data.tankTypeId);
    el.profileName.textContent = data.name;
    if (state.screen !== "room" && state.screen !== "game") {
      showView("lobby");
    }
  }

  // 로비 상태 갱신 — 방 목록과 접속자 목록을 다시 그린다
  if (type === "lobbyState") {
    state.lobby = data;
    updateTankCatalog(data.tankTypes, state.selectedTankTypeId);
    renderLobby();
  }

  // 방 입장 완료 — 채팅 초기화 후 대기실 화면으로 전환
  if (type === "joinedRoom") {
    state.chat.room = [];
    renderChat("room");
    showView("room");
  }

  // 대기실 상태 갱신 — 게임 시작 여부에 따라 화면 전환
  if (type === "roomState") {
    state.room = data;
    renderRoom();
    if (data.status === "playing") {
      showView("game");
    } else if (state.screen === "game" && data.winnerName) {
      // 게임 종료 후 승자 이름을 중앙에 표시
      el.centerNotice.textContent = `${data.winnerName} 승리`;
    }
  }

  // 게임 틱 수신 — 전차/포탄/근접 공격 위치를 갱신하고 HUD를 업데이트
  if (type === "gameState") {
    const wasPlaying = state.game?.status === "playing";
    state.game = data;

    // 게임이 막 시작된 경우 관전 인덱스를 초기화
    if (data.status === "playing" && !wasPlaying) {
      state.spectateIndex = 0;
    }

    if (data.status === "playing" || state.screen === "game") {
      showView("game");
    }
    renderHud();
  }

  // 채팅 기록 — 방/로비 입장 직후 서버가 최근 메시지를 일괄 전송
  if (type === "chatHistory") {
    state.chat[data.scope] = data.messages || [];
    renderChat(data.scope);
  }

  // 실시간 채팅 메시지 — 최대 60개를 유지하며 렌더링
  if (type === "chatMessage") {
    const list = state.chat[data.scope] || [];
    list.push(data.message);
    state.chat[data.scope] = list.slice(-60);
    renderChat(data.scope);
  }

  // 서버 오류 — 토스트로 사용자에게 알림
  if (type === "error") {
    showToast(data.message);
  }
}
