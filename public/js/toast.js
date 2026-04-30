/**
 * toast.js — 토스트 알림
 *
 * 화면 하단에 짧게 표시되는 토스트 메시지를 담당한다.
 * socket.js 와 ui.js 양쪽에서 필요하므로 순환 의존성을 피하기 위해
 * 별도 모듈로 분리하였다.
 */

import { el } from "./state.js";

/**
 * 토스트 메시지를 2.4 초간 표시한다.
 * 이전 메시지가 표시 중이면 즉시 교체한다.
 * @param {string} message - 표시할 텍스트
 */
export function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");

  // 이전 타이머를 취소하고 새 타이머를 시작하여 메시지가 누적되지 않게 한다
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.toast.classList.remove("show");
  }, 2400);
}
