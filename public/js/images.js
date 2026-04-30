/**
 * images.js — 이미지 캐시 및 그래픽 자산 관리
 *
 * 전차 스프라이트 이미지를 비동기로 로드하고 캐싱한다.
 * 또한 이미지의 불투명 영역 경계(trimBounds)를 계산하고,
 * 단색 실루엣(silhouette)을 생성하여 아웃라인 효과에 사용한다.
 *
 * 모든 이미지는 최초 요청 시 한 번만 로드되며 Map 에 저장된다.
 */

import { state } from "./state.js";

/** 전차 이미지 캐시: src URL → Image 객체 */
export const imageCache = new Map();

/** 실루엣 캐시: "src::color" 키 → OffscreenCanvas */
export const silhouetteCache = new Map();

/**
 * 근접 공격 이펙트 이미지.
 * 로드 완료 시 state.meleeImageLoaded 를 true 로 설정한다.
 * 로드 전에는 render.js 가 폴백 도형을 그린다.
 */
export const meleeImage = new Image();
meleeImage.src = "/resource/Melee%20Attack.png";
meleeImage.onload = () => {
  state.meleeImageLoaded = true;
};

/**
 * 주어진 src 의 이미지를 캐시에서 반환한다.
 * 캐시에 없으면 새 Image 를 생성하고 비동기 로드를 시작한다.
 * image.loaded 가 true 일 때만 완전히 사용 가능하다.
 * @param {string} src - 이미지 URL (예: "/resource/tank_green.png")
 * @returns {HTMLImageElement}
 */
export function getImage(src) {
  if (!imageCache.has(src)) {
    const image = new Image();
    image.loaded = false;
    image.trimBounds = null;
    image.onload = () => {
      image.loaded = true;
      image.trimBounds = computeTrimBounds(image);
    };
    image.src = src;
    imageCache.set(src, image);
  }

  return imageCache.get(src);
}

/**
 * 이미지에서 불투명 픽셀(알파 > 8)이 존재하는 최소 경계 사각형을 계산한다.
 * 스프라이트 주변의 투명 여백을 제거해 렌더링 크기를 최적화하기 위해 사용한다.
 * OffscreenCanvas 로 픽셀 데이터를 읽으므로 로드 완료 후에만 호출해야 한다.
 * @param {HTMLImageElement} image
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
function computeTrimBounds(image) {
  const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
  const imgCtx = canvas.getContext("2d");
  imgCtx.drawImage(image, 0, 0);
  const { data } = imgCtx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      // RGBA 배열에서 알파 채널은 4번째 바이트
      if (data[(y * canvas.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // 불투명 픽셀이 없으면 전체 이미지를 경계로 반환
  if (minX > maxX || minY > maxY) {
    return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 이미지의 불투명 영역을 지정 색상으로 채운 실루엣 캔버스를 반환한다.
 * 아군(초록)·적군(빨강) 아웃라인 렌더링에 사용된다.
 * 동일한 src + color 조합은 캐시에서 반환한다.
 * @param {HTMLImageElement} image
 * @param {string} color - CSS 색상 문자열 (예: "#22c55e")
 * @returns {OffscreenCanvas}
 */
export function getSilhouette(image, color) {
  const key = `${image.src}::${color}`;
  if (silhouetteCache.has(key)) {
    return silhouetteCache.get(key);
  }

  const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
  const imgCtx = canvas.getContext("2d");

  // 색상으로 전체를 채운 뒤, destination-in 으로 원본 알파를 마스크로 적용
  imgCtx.fillStyle = color;
  imgCtx.fillRect(0, 0, canvas.width, canvas.height);
  imgCtx.globalCompositeOperation = "destination-in";
  imgCtx.drawImage(image, 0, 0);

  silhouetteCache.set(key, canvas);
  return canvas;
}
