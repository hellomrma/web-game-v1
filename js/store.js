/**
 * store.js — 점수 저장소
 *
 * Supabase 설정 완료 시: 서버 DB 사용
 * 미설정 시: localStorage fallback (개발/테스트용)
 */

// ── 설정 확인 ────────────────────────────────────────────────
function isConfigured() {
  return (
    window.SUPABASE_URL &&
    window.SUPABASE_URL !== 'https://YOUR_PROJECT_ID.supabase.co' &&
    window.SUPABASE_ANON_KEY &&
    window.SUPABASE_ANON_KEY !== 'your-anon-key-here'
  );
}

function apiUrl() {
  return `${window.SUPABASE_URL}/rest/v1/scores`;
}

function headers(extra = {}) {
  return {
    'apikey':        window.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
    'Content-Type':  'application/json',
    ...extra,
  };
}

// ── Supabase 저장소 ──────────────────────────────────────────
const RemoteStore = {

  async save(name, score) {
    const res = await fetch(apiUrl(), {
      method:  'POST',
      headers: headers({ 'Prefer': 'return=minimal' }),
      body:    JSON.stringify({ name, score }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`점수 저장 실패: ${msg}`);
    }
    return await this.getRank(score);
  },

  async getTop(n = 20) {
    const res = await fetch(
      `${apiUrl()}?select=name,score,created_at&order=score.desc&limit=${n}`,
      { headers: headers(), cache: 'no-store' }
    );
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.map(e => ({
      name:  e.name,
      score: e.score,
      date:  new Date(e.created_at).getTime(),
    }));
  },

  async getPersonalBest(name) {
    const res = await fetch(
      `${apiUrl()}?name=eq.${encodeURIComponent(name)}&select=name,score,created_at&order=score.desc&limit=1`,
      { headers: headers(), cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    return { name: data[0].name, score: data[0].score, date: new Date(data[0].created_at).getTime() };
  },

  async getRank(score) {
    const res = await fetch(
      `${apiUrl()}?score=gt.${score}&select=id`,
      { headers: headers({ 'Prefer': 'count=exact' }), cache: 'no-store' }
    );
    // Content-Range: 0-N/TOTAL 또는 */TOTAL
    const range = res.headers.get('Content-Range');
    const total = parseInt(range?.split('/')[1] ?? '0');
    return (isNaN(total) ? 0 : total) + 1;
  },

  async getTotal() {
    const res = await fetch(
      `${apiUrl()}?select=id&limit=1`,
      { headers: headers({ 'Prefer': 'count=exact' }), cache: 'no-store' }
    );
    const range = res.headers.get('Content-Range');
    const total = parseInt(range?.split('/')[1] ?? '0');
    return isNaN(total) ? 0 : total;
  },
};

// ── localStorage Fallback ────────────────────────────────────
const SCORES_KEY = 'wg-scores';

const LocalStore = {
  _get() {
    try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '[]'); }
    catch { return []; }
  },
  _set(list) {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list));
  },

  async save(name, score) {
    const list = this._get();
    list.push({ name, score, date: Date.now() });
    list.sort((a, b) => b.score - a.score);
    this._set(list.slice(0, 200));
    return await this.getRank(score);
  },

  async getTop(n = 20) {
    return this._get().slice(0, n);
  },

  async getPersonalBest(name) {
    return this._get().find(e => e.name === name) || null;
  },

  async getRank(score) {
    return this._get().filter(e => e.score > score).length + 1;
  },

  async getTotal() {
    return this._get().length;
  },
};

// ── 공개 API ─────────────────────────────────────────────────
const ScoreStore = {
  get _impl() {
    return isConfigured() ? RemoteStore : LocalStore;
  },
  get usingRemote() {
    return isConfigured();
  },

  save(name, score)       { return this._impl.save(name, score); },
  getTop(n)               { return this._impl.getTop(n); },
  getPersonalBest(name)   { return this._impl.getPersonalBest(name); },
  getRank(score)          { return this._impl.getRank(score); },
  getTotal()              { return this._impl.getTotal(); },
};

window.ScoreStore = ScoreStore;
