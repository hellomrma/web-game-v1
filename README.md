# SNAP RUSH

[![GitHub last commit](https://img.shields.io/github/last-commit/hellomrma/web-game-v1)](https://github.com/hellomrma/web-game-v1/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/hellomrma/web-game-v1?style=social)](https://github.com/hellomrma/web-game-v1/stargazers)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://vercel.com)
[![License](https://img.shields.io/github/license/hellomrma/web-game-v1)](https://github.com/hellomrma/web-game-v1/blob/main/LICENSE)

> 40초 안에 최대한 많은 타깃을 잡아라! 레트로 아케이드 스타일 순발력 게임

## 게임 방법

1. 닉네임 입력 후 **게임 시작**
2. 화면에 나타나는 원형 타깃을 클릭/탭
3. 작은 타깃일수록 높은 점수, 연속 히트 시 콤보 배율 적용
4. 40초 후 게임 종료 — 랭킹에 점수 자동 저장

### 점수 규칙

| 타깃 | 색상 | 기본 점수 |
|------|------|-----------|
| 대 (반지름 46px) | 청록 | 1점 |
| 중 (반지름 28px) | 노랑 | 3점 |
| 소 (반지름 16px) | 핑크 | 5점 |

**콤보 배율**: 연속 5회 ×2 / 10회 ×3 / 15회 ×4 MAX

### 특수 공격 이벤트

게임 중 랜덤 타이밍으로 각 1회 발동:

- **흑술사 Attack!** — 먹물이 화면을 뒤덮어 타깃이 안 보임
- **폭풍귀 Attack!** — 타깃이 좌우로 빠르게 진동
- **시간도둑 Attack!** — 타이머가 2배속으로 가속

## 기술 스택

- **프론트엔드**: 순수 HTML / CSS / JavaScript (빌드 없음)
- **데이터베이스**: Supabase (PostgreSQL REST API)
- **배포**: Vercel (정적 파일 + 서버리스 함수)

## 로컬 실행

```bash
# 아무 정적 서버로 실행
npx serve .
```

`js/config.js`에 placeholder 값이 있으면 자동으로 `localStorage` 모드로 동작 — Supabase 없이 즉시 테스트 가능.

## Supabase 연동

### 1. 테이블 생성

Supabase 대시보드 → SQL Editor에서 실행:

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

### 2. `js/config.js` 수정

```js
window.SUPABASE_URL      = 'https://xxxxxxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGci...';
```

### 3. Vercel 환경변수 설정

Vercel 대시보드 → Settings → Environment Variables:

| 변수 | 값 |
|------|----|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 |
| `ADMIN_PASSWORD` | 어드민 비밀번호 (자유롭게 지정) |

> `service_role` 키와 `ADMIN_PASSWORD`는 절대 클라이언트 코드에 포함하지 마세요.

## 배포

```bash
vercel --prod
```

## 어드민 기능

랭킹 페이지 하단 **기록 초기화** 버튼 → 비밀번호 입력 → 전체 기록 삭제.
비밀번호 검증은 서버(`/api/admin/clear`)에서 처리 — 클라이언트에 비밀번호 노출 없음.

## 파일 구조

```
web-game-v1/
├── index.html          # 닉네임 입력 화면
├── game.html           # 게임 캔버스
├── ranking.html        # 랭킹 리더보드
├── style.css           # 전체 스타일
├── js/
│   ├── config.js       # Supabase URL + anon key
│   ├── store.js        # 점수 저장소 (Supabase / localStorage)
│   ├── game.js         # 게임 로직
│   └── ranking.js      # 랭킹 페이지 로직
├── api/
│   └── admin/
│       └── clear.js    # 어드민 기록 초기화 (Vercel 서버리스)
├── vercel.json         # 라우팅 + 보안 헤더
└── SETUP.md            # 상세 설정 가이드
```
