/**
 * input.js — 키보드 입력 처리
 *
 * 게임 화면에서 발생하는 키보드 이벤트를 처리한다.
 * 이동 키 상태(state.keys)를 관리하고, 공격 키는 즉시 서버로 전송한다.
 * 이동 입력은 50 ms 마다 서버로 전송한다 (sendInput).
 *
 * 키 매핑:
 *   Z          — 전진 (사망 시: 관전 대상 전환)
 *   X          — 제동 / 후진
 *   ArrowLeft  — 좌회전
 *   ArrowRight — 우회전
 *   C          — 근접 공격 (즉시 서버 전송)
 *   V          — 원거리 공격 (즉시 서버 전송)
 *   Space      — 특수 공격 (즉시 서버 전송)
 */

import { state, el, myTank } from "./state.js";
import { send } from "./socket.js";
import { isTypingField } from "./utils.js";

/**
 * keydown / keyup 이벤트 핸들러.
 * 텍스트 입력 필드에 포커스된 상태이거나 게임 화면이 아니면 무시한다.
 * @param {KeyboardEvent} event
 */
export function onKeyChange(event) {
  if (isTypingField(event.target) || state.screen !== "game") {
    return;
  }

  const active = event.type === "keydown";
  const key = event.code;

  // 스크롤 등 브라우저 기본 동작 방지
  if (["ArrowLeft", "ArrowRight", "Space"].includes(key)) {
    event.preventDefault();
  }

  // Z키: 생존 시 전진, 사망 시 관전 대상 순환
  if (key === "KeyZ") {
    const mine = myTank();
    if (!mine?.alive && active && !event.repeat) {
      // 사망 상태: Z를 누를 때마다 다음 생존 전차로 관전 대상 변경
      const aliveTanks = (state.game?.tanks || []).filter((t) => t.alive);
      if (aliveTanks.length > 0) {
        state.spectateIndex = (state.spectateIndex + 1) % aliveTanks.length;
        const spectated = aliveTanks[state.spectateIndex];
        el.spectateNotice.textContent = `👁 ${spectated.name} 관전 중  ·  Z키로 전환`;
      }
    } else if (mine?.alive) {
      state.keys.forward = active;
    }
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

  // 아래 공격 키는 keydown 최초 1회만 처리 (키 반복 이벤트 무시)
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

/**
 * 현재 키 상태를 서버에 전송한다. (50 ms 인터벌)
 * 이전 전송값과 동일하면 전송하지 않아 불필요한 트래픽을 줄인다.
 */
export function sendInput() {
  if (state.screen !== "game") {
    return;
  }

  const json = JSON.stringify(state.keys);
  // 변경이 없으면 재전송하지 않음
  if (json === state.lastInputJson) {
    return;
  }

  state.lastInputJson = json;
  send("input", state.keys);
}
