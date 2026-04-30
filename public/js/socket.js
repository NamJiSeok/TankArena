/**
 * socket.js — WebSocket 연결 계층
 *
 * 서버와의 WebSocket 연결 수립·유지 및 메시지 송수신을 담당한다.
 * 연결이 끊기면 900 ms 후 자동 재접속을 시도한다.
 *
 * 메시지 수신 핸들러는 setMessageHandler() 로 주입받는다.
 * 이렇게 하면 socket.js ↔ messages.js 간의 순환 import 를 피할 수 있다.
 */

import { state } from "./state.js";
import { showToast } from "./toast.js";

/** 수신 메시지 라우팅 핸들러 (main.js 에서 주입) */
let onMessage = null;

/**
 * 서버 메시지 수신 시 호출할 핸들러를 등록한다.
 * connect() 호출 전에 반드시 설정해야 한다.
 * @param {(type: string, data: any) => void} handler
 */
export function setMessageHandler(handler) {
  onMessage = handler;
}

/**
 * 서버와 WebSocket 연결을 수립한다.
 * HTTPS 환경에서는 wss://, HTTP 에서는 ws:// 를 사용한다.
 * 이미 로그인 상태(state.name 있음)라면 재연결 즉시 login 을 재전송한다.
 */
export function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}`);

  state.socket.addEventListener("open", () => {
    // 재접속 시 서버 세션이 초기화되므로 이름을 다시 전송하여 상태를 복원한다
    if (state.name) {
      send("login", { name: state.name });
    }
  });

  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    onMessage?.(message.type, message.data);
  });

  state.socket.addEventListener("close", () => {
    showToast("연결이 끊겼습니다. 재접속을 시도합니다.");
    setTimeout(connect, 900);
  });
}

/**
 * 서버에 JSON 메시지를 전송한다.
 * 소켓이 열려 있지 않으면 아무것도 하지 않는다.
 * @param {string} type - 메시지 타입 (예: "login", "attack")
 * @param {object} [data={}] - 페이로드 객체
 */
export function send(type, data = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(JSON.stringify({ type, data }));
}
