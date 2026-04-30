/**
 * main.js — 진입점 (Entry Point)
 *
 * 모든 모듈을 import 하고 애플리케이션을 초기화한다.
 * 이 파일 외에는 직접 초기화 코드를 실행하지 않는다.
 *
 * 초기화 순서:
 *   1. setMessageHandler — 서버 메시지 수신 시 handleServerMessage 가 호출되도록 등록
 *   2. connect           — 서버와 WebSocket 연결 수립
 *   3. bindUi            — 모든 버튼/폼 이벤트 리스너 등록
 *   4. resizeCanvas      — 초기 캔버스 크기 설정
 *   5. requestAnimationFrame(draw) — 렌더 루프 시작
 *   6. setInterval(sendInput, 50)  — 이동 입력 50 ms 주기 전송 시작
 *   7. keydown/keyup 이벤트 등록   — 전체 창에서 키 입력 감지
 */

import { connect, setMessageHandler } from "./socket.js";
import { handleServerMessage } from "./messages.js";
import { bindUi, resizeCanvas } from "./ui.js";
import { draw } from "./render.js";
import { onKeyChange, sendInput } from "./input.js";

// 메시지 핸들러를 먼저 등록한 뒤 연결한다
setMessageHandler(handleServerMessage);
connect();

// UI 이벤트 리스너 등록 및 캔버스 초기화
bindUi();
resizeCanvas();

// 렌더 루프 시작 (requestAnimationFrame 내부에서 재귀 호출)
requestAnimationFrame(draw);

// 이동 입력을 50 ms 마다 서버로 전송
setInterval(sendInput, 50);

// 키보드 이벤트는 전체 창(window) 에서 감지
window.addEventListener("keydown", onKeyChange);
window.addEventListener("keyup", onKeyChange);
