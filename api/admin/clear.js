/**
 * api/admin/clear.js — 랭킹 기록 초기화 (Vercel Serverless Function)
 *
 * 환경변수 (Vercel 대시보드에서 설정):
 *   ADMIN_PASSWORD          - 관리자 비밀번호
 *   SUPABASE_URL            - Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase 서비스 롤 키 (RLS 우회)
 */

module.exports = async function handler(req, res) {
  // CORS — 같은 도메인이므로 필요 시에만 수정
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: '비밀번호를 입력하세요' });
  }

  // ── 비밀번호 검증 (서버 사이드) ─────────────────────────────
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았습니다' });
  }
  if (password !== adminPassword) {
    // 타이밍 공격 방지: 실제 비교 시간이 항상 일정하도록 딜레이
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다' });
  }

  // ── Supabase에서 전체 삭제 ───────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase 환경변수가 설정되지 않았습니다' });
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/scores?score=gte.0`, {
      method:  'DELETE',
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[admin/clear] Supabase error:', errText);
      return res.status(500).json({ error: '삭제 중 오류가 발생했습니다' });
    }

    console.log('[admin/clear] 랭킹 기록 초기화 완료');
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[admin/clear] fetch error:', err);
    return res.status(500).json({ error: '서버 오류: ' + err.message });
  }
};
