# TankArena — 프로젝트 개요 및 구조

## 개요

TankArena는 웹 브라우저에서 실행되는 **실시간 멀티플레이어 2D 탑뷰 전차 전투 게임**이다.  
별도 프레임워크나 번들러 없이 **순수 Node.js + 브라우저 ES 모듈**로 구현되어 있다.

| 항목 | 내용 |
|---|---|
| 최대 인원 | 방당 10명 |
| 서버 틱레이트 | 30 Hz (33 ms/tick) |
| 맵 크기 | 2400 × 1600 px |
| 전차 타입 | Standard / Scout / Guardian |
| 통신 방식 | WebSocket (RFC 6455, 순수 Node.js 구현) |

---

## 게임 흐름

```
로그인 → 로비 → 방 생성/입장 → 전차 선택 → 레디 → 게임 → 결과 → 로비
```

1. **로그인**: 닉네임 입력 후 서버에 `login` 메시지 전송
2. **로비**: 방 목록 탐색, 방 생성 또는 참가
3. **대기실**: 전차 선택, 레디 설정, 방장이 시작 버튼 클릭
4. **게임**: 실시간 전차 이동/공격, 마지막 생존자가 승리
5. **종료**: 승자 이름 표시 후 로비로 복귀

---

## 키 조작

| 키 | 동작 |
|---|---|
| `Z` | 전진 (사망 시: 관전 대상 전환) |
| `X` | 제동 / 후진 |
| `←` `→` | 좌회전 / 우회전 |
| `C` | 근접 공격 |
| `V` | 원거리 공격 |
| `Space` | 특수(궁극기) 공격 |

---

## 전차 타입

| 타입 | 특징 |
|---|---|
| **Standard** | 균형형, 체력 100, 보호막 70, 속도 5.2 |
| **Scout** | 고속 경장갑, 체력 82, 보호막 54, 속도 6.8 |
| **Guardian** | 중장갑 근접특화, 체력 132, 보호막 92, 속도 4.2 |

---

## 전투 시스템

- **근접 공격 (C)**: 보호막 무시, 체력 직격 피해
- **원거리 공격 (V)**: 보호막 우선 소모 → 초과분이 체력 피해
- **특수 공격 (Space)**: 느리고 강력한 대구경 포탄, 보호막 우선 소모
- **방어율**: 모든 피해에 `damage × (1 - defense)` 공식 적용
- **보호막 재생**: 마지막 피격 후 1.9 초 경과 시 자동 회복

---

## 디렉토리 구조

```
TankArena/
├── server.js           # 게임 서버 (HTTP + WebSocket + 게임 루프)
├── package.json
├── data/
│   └── tanks.json      # 전차 타입 정의 (스탯, 이미지 경로 등)
├── resource/           # 이미지 파일 (전차 스프라이트, 이펙트)
├── scripts/
│   └── smoke.js        # 통합 테스트 (2인 클라이언트 시뮬레이션)
└── public/             # 브라우저에 서빙되는 정적 파일
    ├── index.html
    ├── styles.css
    └── js/             # ES 모듈 클라이언트 코드
        ├── main.js
        ├── state.js
        ├── utils.js
        ├── toast.js
        ├── images.js
        ├── socket.js
        ├── messages.js
        ├── ui.js
        ├── render.js
        └── input.js
```

---

## 클라이언트 모듈 구조

`public/js/` 하위 파일들은 **브라우저 네이티브 ES 모듈**(`type="module"`)로 동작한다.  
번들러(webpack/vite)를 사용하지 않으므로 각 파일이 직접 브라우저에 로드된다.

### 의존성 다이어그램

```
main.js
├── socket.js ──────────────────► state.js
│   └── toast.js ───────────────► state.js
├── messages.js ────────────────► state.js
│   └── ui.js ──────────────────► state.js
│       ├── socket.js            ├── utils.js
│       └── toast.js             └── toast.js ──► state.js
├── ui.js (위와 동일)
├── render.js ──────────────────► state.js
│   ├── images.js ──────────────► state.js
│   └── utils.js
└── input.js ───────────────────► state.js
    ├── socket.js                └── utils.js
    └── utils.js
```

> **순환 의존성 없음**: `socket.js` 는 메시지 핸들러를 `setMessageHandler()` 콜백으로  
> 주입받는 방식을 사용하여 `socket ↔ messages ↔ ui` 간 순환 import 를 방지한다.

---

## 모듈별 역할

| 파일 | 역할 |
|---|---|
| [`main.js`](public/js/main.js) | **진입점** — 모듈 초기화, 루프 시작 |
| [`state.js`](public/js/state.js) | **공유 상태** — `state` 객체, DOM 캐시(`el`), 캔버스 컨텍스트(`ctx`), 헬퍼 쿼리 |
| [`utils.js`](public/js/utils.js) | **순수 유틸리티** — 시간 포맷, 상태 레이블, 캔버스 크기, 입력 필드 감지 |
| [`toast.js`](public/js/toast.js) | **토스트 알림** — 2.4 초간 표시되는 알림 메시지 |
| [`images.js`](public/js/images.js) | **이미지 관리** — 스프라이트 캐싱, trimBounds 계산, 실루엣(아웃라인) 생성 |
| [`socket.js`](public/js/socket.js) | **WebSocket** — 연결 수립, 재접속, 메시지 송수신 |
| [`messages.js`](public/js/messages.js) | **메시지 라우터** — 서버 메시지 타입별 분기 및 UI 갱신 |
| [`ui.js`](public/js/ui.js) | **UI 렌더링** — 로비·대기실·HUD·채팅·전차 선택 모달, 이벤트 바인딩 |
| [`render.js`](public/js/render.js) | **캔버스 렌더링** — 60fps 렌더 루프, 지형·전차·포탄·이펙트·미니맵 |
| [`input.js`](public/js/input.js) | **입력 처리** — 키 상태 관리, 이동 입력 50ms 전송, 공격 즉시 전송 |

---

## 서버 아키텍처 (`server.js`)

서버는 단일 파일로 구성되며 세 가지 역할을 수행한다.

### 1. HTTP 정적 파일 서버
`public/` 및 `resource/` 디렉토리의 파일을 서빙한다.  
디렉토리 탐색 공격을 방지하기 위해 경로 정규화 및 검증을 수행한다.

### 2. WebSocket 서버
Node.js `http.Server` 의 `upgrade` 이벤트를 처리하여  
RFC 6455 핸드셰이크를 직접 구현(외부 라이브러리 미사용)한다.

**클라이언트 → 서버 메시지 타입**

| 타입 | 설명 |
|---|---|
| `login` | 닉네임으로 로그인 |
| `createRoom` | 새 방 생성 |
| `joinRoom` | 기존 방 참가 |
| `leaveRoom` | 방 퇴장 |
| `setReady` | 레디 상태 토글 |
| `selectTank` | 전차 타입 선택 |
| `startGame` | 게임 시작 (방장 전용) |
| `attack` | 공격 시도 (`melee` / `ranged` / `special`) |
| `input` | 이동 키 상태 전송 (50 ms 주기) |
| `chat` | 채팅 메시지 전송 |

**서버 → 클라이언트 메시지 타입**

| 타입 | 설명 |
|---|---|
| `hello` | 연결 직후 클라이언트 ID 발급 |
| `profile` | 로그인 성공, 닉네임·전차 카탈로그 |
| `lobbyState` | 로비 전체 상태 (방 목록, 유저 목록) |
| `joinedRoom` | 방 입장 완료 신호 |
| `roomState` | 대기실 상태 스냅샷 |
| `gameState` | 게임 틱 스냅샷 (30 fps) |
| `chatHistory` | 입장 시 이전 채팅 기록 |
| `chatMessage` | 실시간 채팅 메시지 |
| `error` | 오류 메시지 |

### 3. 게임 루프
30 Hz (33 ms/tick) 서버 사이드 게임 루프:

```
gameTick()
├── updateTanks()       — 물리 (속도, 가속, 회전, 경계 충돌)
├── updateProjectiles() — 포탄 이동, 명중 판정
├── updateMeleeAttacks()— 근접 공격 진행, 중복 피격 방지
├── checkWinner()       — 생존자 1명 이하 시 게임 종료
└── broadcastGame()     — 모든 플레이어에게 gameState 브로드캐스트
```

---

## 실행 방법

```bash
# 서버 시작
npm start

# 문법 검사
npm run check

# 통합 테스트 (서버 실행 상태에서)
npm run smoke
```

기본 포트: `3000`  
환경 변수 `PORT` 로 변경 가능 (`PORT=8080 npm start`)
