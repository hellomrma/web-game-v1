# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**SNAP RUSH** — 40초 아케이드 스타일 클릭/탭 게임. 플레이어는 `index.html`에서 닉네임을 입력하고, `game.html`에서 게임을 플레이하며, `ranking.html`에서 리더보드를 확인한다. 빌드 단계 없음 — 순수 HTML/CSS/JS, Vercel에 배포.

## 로컬 개발

```bash
npx serve .
# 또는
python -m http.server 8080
```

설치할 의존성 없음. `js/config.js`에 placeholder 값이 있으면 `ScoreStore`가 자동으로 `localStorage`로 폴백 — Supabase 없이 로컬 테스트 가능.

서버리스 함수(`api/admin/clear.js`)를 로컬에서 테스트하려면:

```bash
vercel dev
```

Vercel CLI와 `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 담긴 `.env` 파일 필요.

## 아키텍처

### 페이지 흐름
`index.html` → `?name=` 쿼리 파라미터 + `wg-player-name` localStorage 저장 → `game.html` → `ranking.html`

`game.html`을 `?name=` 없이 직접 열면 `index.html`로 리다이렉트됨.

### 스크립트 로딩 순서 (game.html / ranking.html)
`config.js`가 전역변수를 설정하고, `store.js`가 이를 읽으므로 순서가 중요:
1. `js/config.js` — `window.SUPABASE_URL`, `window.SUPABASE_ANON_KEY` 설정
2. `js/store.js` — `window.ScoreStore` 정의 (전역변수 확인 후 Remote/Local 결정)
3. `js/game.js` 또는 `js/ranking.js`

### 점수 저장 (`js/store.js`)
`ScoreStore`는 얇은 파사드: `config.js`에 실제 값이 있으면 `RemoteStore`(Supabase REST API, SDK 없이 raw `fetch`), 아니면 `LocalStore`(localStorage) 사용. 순위는 Supabase의 `Content-Range` 헤더로 서버 사이드 계산.

### 게임 루프 (`js/game.js`)
- `state` 객체가 모든 가변 게임 상태를 보유
- `gameLoop(ts)`는 `requestAnimationFrame`으로 실행; 탭 비활성화 시 루프 폭주 방지를 위해 `dt`를 50ms로 캡
- 타이머는 `setInterval` 대신 `state.timerAccum` 누적기를 사용 — `SHINBI.timerMult`로 배속 적용 가능
- 세 특수 공격 객체(`MABAKSA`, `HONGSOO`, `SHINBI`)는 모듈 레벨 싱글톤으로 상태 머신 구현 (`idle → announce → active/spread/hold → clear → idle`)
- `initAttacks()`는 게임 시작 시 세 공격을 세 시간 구간에 셔플 배정 — 구간당 1회, 겹침 없음 보장

### 특수 공격 이벤트
| 공격 | 효과 | 지속시간 |
|------|------|---------|
| 흑술사 | 먹물이 화면을 뒤덮어 타깃이 안 보임 | 약 6초 |
| 폭풍귀 | 타깃이 좌우로 빠르게 진동 | 약 7초 |
| 시간도둑 | 타이머가 2배속으로 가속 | 약 6초 |

각 공격의 `.tick(elapsedMs, now)`은 매 프레임 호출되고, `.draw(now)`는 게임 요소 위에 오버레이를 렌더링.

### 어드민 초기화 (`api/admin/clear.js`)
Vercel 서버리스 함수. `ADMIN_PASSWORD` 환경변수를 서버에서 검증(타이밍 공격 방지를 위해 300ms 고정 지연), 이후 `service_role` 키로 Supabase의 전체 행 삭제(RLS 우회). 성공 시 `{ ok: true }` 반환.

## 난이도 페이즈 (40초)

| 페이즈 | 시간 | 최대 타깃 | 스폰 간격 | 버스트 확률 |
|--------|------|-----------|-----------|------------|
| 1 | 0~13초 | 3개 | 900ms | 0% |
| 2 | 13~26초 | 5개 | 600ms | 15% |
| 3 | 26~40초 | 7개 | 380ms | 30% |

## Supabase 테이블 스키마

```sql
CREATE TABLE scores (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 12),
  score      INTEGER NOT NULL CHECK (score >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_scores_score ON scores (score DESC);
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read"   ON scores FOR SELECT USING (true);
CREATE POLICY "public insert" ON scores FOR INSERT WITH CHECK (true);
```

## 디자인 시스템

- 폰트: `'Press Start 2P'`(타이틀/HUD 레이블) + `'Share Tech Mono'`(본문/점수) — Google Fonts
- CSS 변수: `--cyan: #00e5cc`, `--pink: #ff1a6c`, `--yellow: #ffe600`, `--bg: #07070f`
- 타깃 색상은 점수와 대응: 청록(cyan)=1pt, 노랑(yellow)=3pt, 핑크(pink)=5pt
- 비주얼: 레트로 아케이드 네온 / 다크 터미널 — 스캔라인, CRT 노이즈, 그리드 배경

## Vercel 환경변수

Vercel 대시보드에서 설정 (클라이언트 코드에 절대 포함 금지):

| 변수 | 용도 |
|------|------|
| `SUPABASE_URL` | 서버리스 함수에서 사용 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLS 우회 어드민 삭제 |
| `ADMIN_PASSWORD` | `api/admin/clear.js`에서 검증 |

`SUPABASE_URL`과 `SUPABASE_ANON_KEY`는 `js/config.js`에 커밋해도 안전 — RLS 정책으로 보호되는 공개 키.
