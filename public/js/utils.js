/**
 * utils.js — 순수 유틸리티 함수
 *
 * 외부 상태나 DOM 에 의존하지 않는 순수(pure) 헬퍼 함수 모음.
 * 어디서든 안전하게 import 할 수 있으며 사이드 이펙트가 없다.
 */

/**
 * Unix 타임스탬프를 한국식 "HH:MM" 형식 문자열로 변환한다.
 * 채팅 메시지의 발신 시각 표시에 사용된다.
 * @param {number} timestamp - Date.now() 형식의 밀리초 타임스탬프
 * @returns {string} 예: "오후 03:47"
 */
export function formatChatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * 방 상태 코드를 사용자에게 표시할 한국어 레이블로 변환한다.
 * @param {"waiting"|"playing"} status
 * @returns {string} "대기 중" 또는 "전투 중"
 */
export function statusLabel(status) {
  return status === "playing" ? "전투 중" : "대기 중";
}

/**
 * 현재 브라우저 뷰포트 크기를 반환한다.
 * devicePixelRatio 보정 전의 CSS 픽셀 기준이다.
 * @returns {{ width: number, height: number }}
 */
export function canvasSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * 주어진 DOM 요소가 텍스트 입력 필드인지 확인한다.
 * 입력 필드에 포커스된 상태에서 게임 키 이벤트를 무시하기 위해 사용한다.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
export function isTypingField(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
}
