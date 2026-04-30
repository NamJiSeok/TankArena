/**
 * render.js — 게임 캔버스 렌더링
 *
 * requestAnimationFrame 기반 60fps 렌더 루프와
 * 게임 월드의 모든 시각 요소를 그리는 함수를 담당한다.
 *
 * 렌더링 순서 (draw 호출 시):
 *   1. drawWorld       — 배경(지형, 그리드, 경계선, 장애물)
 *   2. drawProjectiles — 포탄(원거리/특수)
 *   3. drawTanks       — 전차 스프라이트, 이름, 체력/보호막 바
 *   4. drawMeleeAttacks— 근접 공격 이펙트
 *   5. drawMinimap     — 우하단 미니맵
 *
 * 카메라는 내 전차(생존 시) 또는 관전 대상(사망 시)을 따라간다.
 * 서버 권한 방식(server-authoritative)이므로 클라이언트는 렌더만 담당한다.
 */

import { state, ctx, myTank } from "./state.js";
import { getImage, getSilhouette, meleeImage } from "./images.js";
import { canvasSize } from "./utils.js";

/**
 * 메인 렌더 루프. requestAnimationFrame 으로 재귀 호출된다.
 * game 화면이 아닐 때는 빈 그리드만 그리고 반환한다.
 */
export function draw() {
  requestAnimationFrame(draw);

  if (state.screen !== "game") {
    return;
  }

  const { width, height } = canvasSize();
  ctx.clearRect(0, 0, width, height);

  if (!state.game) {
    // 게임 데이터 수신 전 빈 그리드 표시
    drawGrid(0, 0, width, height, 80);
    return;
  }

  // 카메라 원점: 추적 대상의 중심이 화면 중앙에 오도록 계산
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

// ── 배경 ───────────────────────────────────────────────────────────────────

/**
 * 맵 배경(지형 색, 그리드, 경계선, 장애물 사각형)을 그린다.
 * ctx.translate 로 카메라 오프셋을 적용한 뒤 그린다.
 * @param {{ x: number, y: number }} camera - 카메라 좌상단 좌표
 */
function drawWorld(camera) {
  const { width, height } = state.game.map;
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // 맵 배경색
  ctx.fillStyle = "#2d352e";
  ctx.fillRect(0, 0, width, height);

  drawGrid(0, 0, width, height, 80);

  // 맵 경계선
  ctx.strokeStyle = "#d6c37d";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  // 결정론적 의사난수 배치 장애물 (서버와 동일한 패턴)
  for (let index = 0; index < 18; index += 1) {
    const x = 240 + ((index * 311) % (width - 480));
    const y = 190 + ((index * 227) % (height - 380));
    ctx.fillStyle = index % 2 ? "#47513f" : "#3c4939";
    ctx.fillRect(x, y, 120, 34);
  }

  ctx.restore();
}

/**
 * 지정 영역에 균등 간격 격자선을 그린다.
 * 배경 그리드와 로딩 화면 그리드에 공통으로 사용한다.
 * @param {number} x - 시작 X
 * @param {number} y - 시작 Y
 * @param {number} width - 영역 너비
 * @param {number} height - 영역 높이
 * @param {number} size - 격자 간격(px)
 */
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

// ── 전차 ───────────────────────────────────────────────────────────────────

/**
 * 모든 전차를 그린다.
 * 각 전차마다:
 *   - 아웃라인 실루엣(아군 초록 / 적군 빨강)
 *   - 전차 스프라이트 (trimBounds 로 여백 제거)
 *   - 이름 텍스트
 *   - 체력·보호막 바
 * 사망한 전차는 반투명으로 표시한다.
 * @param {{ x: number, y: number }} camera
 */
function drawTanks(camera) {
  for (const tank of state.game.tanks) {
    const x = tank.x - camera.x;
    const y = tank.y - camera.y;

    ctx.save();
    ctx.translate(x, y);
    // 서버의 angle 은 수학적 0도(오른쪽)가 기준이므로 π/2 를 더해 위쪽을 앞방향으로 보정
    ctx.rotate(tank.angle + Math.PI / 2);
    ctx.globalAlpha = tank.alive ? 1 : 0.36;

    const tankImage = getImage(tank.image || "/resource/tank.png");
    if (tankImage.loaded && tankImage.trimBounds) {
      const b = tankImage.trimBounds;
      const isMe = tank.id === state.clientId;
      // 아군(나): 초록 아웃라인, 적군: 빨강 아웃라인
      const outlineColor = isMe ? "#22c55e" : "#ef4444";
      const silhouette = getSilhouette(tankImage, outlineColor);
      // 실루엣을 3px 크게 그려 아웃라인 효과를 낸다
      ctx.drawImage(silhouette, b.x, b.y, b.w, b.h, -33, -39, 66, 78);
      ctx.drawImage(tankImage, b.x, b.y, b.w, b.h, -30, -36, 60, 72);
    }

    ctx.restore();

    // 이름·체력·보호막은 회전 없이 항상 위쪽에 표시
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

// ── 포탄 ───────────────────────────────────────────────────────────────────

/**
 * 모든 포탄(원거리·특수)을 원형으로 그린다.
 * 특수 포탄은 금색 glow, 일반 포탄은 흰색 glow 로 구분한다.
 * @param {{ x: number, y: number }} camera
 */
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

// ── 근접 공격 이펙트 ───────────────────────────────────────────────────────

/**
 * 모든 근접 공격 이펙트를 그린다.
 * 이펙트는 전차 앞방향으로 확장(extending)되다가 수축한다.
 * 이미지가 로드되지 않은 경우 빨간 사각형으로 폴백한다.
 * @param {{ x: number, y: number }} camera
 */
function drawMeleeAttacks(camera) {
  for (const attack of state.game.meleeAttacks || []) {
    const x = attack.x - camera.x;
    const y = attack.y - camera.y;
    // progress(0~1) 에 따라 크기를 58~92px 사이로 보간
    const size = 58 + attack.progress * 34;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(attack.angle + Math.PI / 2);
    // 확장 중에는 불투명, 수축 중에는 반투명
    ctx.globalAlpha = attack.extending ? 0.98 : 0.72;

    if (state.meleeImageLoaded) {
      ctx.drawImage(meleeImage, -size / 2, -size / 2, size, size);
    } else {
      // 이미지 로드 전 폴백 도형
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

// ── 미니맵 ─────────────────────────────────────────────────────────────────

/**
 * 화면 우하단에 미니맵을 그린다.
 * 전차 위치를 맵 비율에 맞게 축소해 점으로 표시한다.
 * 나는 초록 4px, 적군은 빨강 3px, 사망자는 반투명 흰색으로 구분한다.
 */
function drawMinimap() {
  if (!state.game) {
    return;
  }

  const { width, height } = canvasSize();
  /** 미니맵 너비(px) */
  const mapW = 150;
  /** 미니맵 높이(px) */
  const mapH = 100;
  /** 미니맵 좌상단 X (화면 우하단에서 18px 여백) */
  const x = width - mapW - 18;
  /** 미니맵 좌상단 Y */
  const y = height - mapH - 18;

  ctx.save();
  ctx.fillStyle = "rgba(16, 19, 23, 0.74)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, mapW, mapH, 8);
  ctx.fill();
  ctx.stroke();

  for (const tank of state.game.tanks) {
    const isMe = tank.id === state.clientId;
    ctx.fillStyle = tank.alive
      ? (isMe ? "#22c55e" : "#ef4444")
      : "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(
      x + (tank.x / state.game.map.width) * mapW,
      y + (tank.y / state.game.map.height) * mapH,
      isMe ? 4 : 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

// ── 캔버스 유틸리티 ────────────────────────────────────────────────────────

/**
 * 배경과 전경 두 레이어로 체력/보호막 바를 그린다.
 * @param {number} x - 바 시작 X
 * @param {number} y - 바 시작 Y
 * @param {number} width - 바 전체 너비
 * @param {number} height - 바 높이
 * @param {number} ratio - 채움 비율 (0 ~ 1)
 * @param {string} color - 채움 색상
 */
function drawBar(x, y, width, height, ratio, color) {
  // 배경 (어두운 반투명)
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y, width, height);
  // 전경 (실제 값)
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, ratio)) * width, height);
}

/**
 * 둥근 모서리 사각형 패스를 생성한다. (fill/stroke 는 호출자가 수행)
 * CanvasRenderingContext2D.roundRect() 의 구형 브라우저 폴백 대신 직접 구현한다.
 * @param {CanvasRenderingContext2D} context
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} radius - 모서리 반지름
 */
function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

// ── 카메라 ─────────────────────────────────────────────────────────────────

/**
 * 카메라가 추적해야 할 좌표를 반환한다.
 * 내 전차가 살아있으면 내 전차를 추적한다.
 * 사망 시 spectateIndex 가 가리키는 생존 전차를 추적한다.
 * 생존자가 없으면 맵 중앙을 반환한다.
 * @returns {{ x: number, y: number }}
 */
function cameraTarget() {
  const mine = myTank();
  if (mine?.alive) {
    return mine;
  }

  const aliveTanks = (state.game?.tanks || []).filter((t) => t.alive);
  if (!aliveTanks.length) {
    return { x: state.game.map.width / 2, y: state.game.map.height / 2 };
  }

  // 인덱스가 생존자 수를 벗어나지 않도록 보정
  state.spectateIndex = Math.min(state.spectateIndex, aliveTanks.length - 1);
  return aliveTanks[state.spectateIndex];
}
