# 서버 설정 가이드

## 1. Supabase 프로젝트 생성

1. [supabase.com](https://supabase.com) 에서 무료 계정 생성
2. **New Project** 클릭 → 프로젝트 이름/비밀번호 입력
3. 프로젝트 생성 완료까지 약 1분 대기

## 2. 테이블 생성

**Supabase 대시보드 → SQL Editor** 에서 아래 SQL 실행:

```sql
-- scores 테이블 생성
CREATE TABLE scores (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 12),
  score      INTEGER NOT NULL CHECK (score >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 (랭킹 조회 성능)
CREATE INDEX idx_scores_score ON scores (score DESC);

-- RLS 활성화
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 가능
CREATE POLICY "public read"   ON scores FOR SELECT USING (true);
-- 누구나 점수 추가 가능 (anon key로 INSERT)
CREATE POLICY "public insert" ON scores FOR INSERT WITH CHECK (true);
-- 삭제는 service_role 키로만 (API 서버에서만 실행)
```

## 3. API 키 복사

**Supabase 대시보드 → Settings → API** 에서:

| 항목 | 위치 | 용도 |
|------|------|------|
| `Project URL` | API Settings | js/config.js |
| `anon public` 키 | API Settings | js/config.js |
| `service_role` 키 | API Settings | Vercel 환경변수 (노출 금지!) |

## 4. js/config.js 수정

```js
window.SUPABASE_URL      = 'https://xxxxxxxx.supabase.co';   // Project URL
window.SUPABASE_ANON_KEY = 'eyJhbGci...';                     // anon public 키
```

## 5. Vercel 환경변수 설정

**Vercel 대시보드 → 프로젝트 → Settings → Environment Variables** 에서 추가:

| 변수명 | 값 | 노출 |
|--------|-----|------|
| `SUPABASE_URL` | Supabase Project URL | 서버만 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 | 서버만 |
| `ADMIN_PASSWORD` | 원하는 비밀번호 | 서버만 |

> ⚠️ `service_role` 키와 `ADMIN_PASSWORD` 는 절대 클라이언트 코드에 넣지 마세요.

## 6. Vercel 배포

```bash
vercel --prod
```

## 로컬 개발 (Supabase 없이)

`js/config.js` 에 placeholder 값이 있으면 자동으로 **localStorage fallback** 모드로 동작합니다.
로컬에서 게임 테스트는 정상적으로 가능하며, 배포 후 Supabase가 연결됩니다.
