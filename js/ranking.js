/**
 * ranking.js — 랭킹 페이지 로직
 *
 * 어드민 비밀번호 검증은 /api/admin/clear (서버)에서 처리합니다.
 * 클라이언트 코드에 비밀번호가 노출되지 않습니다.
 */

// ── DOM 참조 ─────────────────────────────────────────────────
const rankBody  = document.getElementById('rank-body');
const rankEmpty = document.getElementById('rank-empty');
const rankTable = document.getElementById('rank-table');
const pbCard    = document.getElementById('pb-card');
const pbName    = document.getElementById('pb-name');
const pbScore   = document.getElementById('pb-score');
const subtitle  = document.getElementById('ranking-subtitle');
const btnClear  = document.getElementById('btn-clear');
const toast     = document.getElementById('toast');

// 모달
const backdrop     = document.getElementById('modal-backdrop');
const modal        = backdrop.querySelector('.modal');
const modalClose   = document.getElementById('modal-close');
const modalCancel  = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const pwInput      = document.getElementById('pw-input');
const pwToggle     = document.getElementById('pw-toggle');
const pwEye        = document.getElementById('pw-eye');
const modalError   = document.getElementById('modal-error');

const MEDALS = ['🥇', '🥈', '🥉'];
const myName  = localStorage.getItem('wg-player-name') || '';

// ── 날짜 포맷 ────────────────────────────────────────────────
function formatDate(ts) {
  const d  = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

// ── 랭킹 렌더링 ──────────────────────────────────────────────
async function render() {
  subtitle.textContent = '// 불러오는 중...';
  rankBody.innerHTML   = '';

  let top, total;
  try {
    [top, total] = await Promise.all([
      ScoreStore.getTop(20),
      ScoreStore.getTotal(),
    ]);
  } catch (err) {
    console.error('[ranking] 데이터 로딩 실패:', err);
    subtitle.textContent = '// 불러오기 실패';
    showToast('데이터를 불러오지 못했습니다', 'error');
    return;
  }

  subtitle.textContent = `// 전체 ${total}회 플레이 기록`;

  if (top.length === 0) {
    rankEmpty.style.display = 'block';
    rankTable.style.display = 'none';
    pbCard.style.display    = 'none';
    return;
  }

  rankEmpty.style.display = 'none';
  rankTable.style.display = '';

  top.forEach((entry, i) => {
    const rank    = i + 1;
    const isMe    = myName && entry.name === myName;
    const isMedal = rank <= 3;

    const tr = document.createElement('tr');
    tr.className           = `rank-row rank-${rank}${isMe ? ' highlight' : ''}`;
    tr.style.animationDelay = `${i * 0.04}s`;

    tr.innerHTML = `
      <td>
        ${isMedal
          ? `<span class="rank-medal">${MEDALS[rank - 1]}</span>`
          : `<span class="rank-num">#${rank}</span>`
        }
      </td>
      <td class="rank-name">${escHtml(entry.name)}</td>
      <td>
        <span class="rank-score">${entry.score}</span>
        <span class="rank-date">${formatDate(entry.date)}</span>
      </td>
    `;
    rankBody.appendChild(tr);
  });

  // 내 최고 기록
  if (myName) {
    try {
      const pb = await ScoreStore.getPersonalBest(myName);
      if (pb) {
        pbCard.style.display = 'flex';
        pbName.textContent   = myName;
        pbScore.textContent  = pb.score;
      }
    } catch { /* 무시 */ }
  }
}

// ── 모달 열기 / 닫기 ─────────────────────────────────────────
function openModal() {
  pwInput.value = '';
  modalError.classList.add('hidden');
  backdrop.classList.add('open');
  backdrop.removeAttribute('aria-hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => pwInput.focus()));
}

function closeModal() {
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
  pwInput.value             = '';
  pwInput.type              = 'password';
  pwEye.textContent         = '👁';
  modalError.classList.add('hidden');
  modalConfirm.disabled     = false;
  modalConfirm.textContent  = '확인';
}

backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
modalClose.addEventListener('click',  closeModal);
modalCancel.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
});

pwToggle.addEventListener('click', () => {
  const isText        = pwInput.type === 'text';
  pwInput.type        = isText ? 'password' : 'text';
  pwEye.textContent   = isText ? '👁' : '🙈';
});

// ── 비밀번호 확인 & 초기화 실행 ─────────────────────────────
async function handleConfirm() {
  const password = pwInput.value;
  if (!password) { pwInput.focus(); return; }

  modalConfirm.disabled    = true;
  modalConfirm.textContent = '확인 중...';
  modalError.classList.add('hidden');

  try {
    const res = await fetch('/api/admin/clear', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok) {
      // 비밀번호 틀림 또는 서버 오류
      modalError.textContent = data.error || '오류가 발생했습니다';
      modalError.classList.remove('hidden');
      shakeModal();
      pwInput.select();
      modalConfirm.disabled    = false;
      modalConfirm.textContent = '확인';
      return;
    }

    // 성공
    closeModal();
    pbCard.style.display = 'none';
    await render();
    showToast('기록이 초기화되었습니다', 'info');

  } catch (err) {
    modalError.textContent = '네트워크 오류가 발생했습니다';
    modalError.classList.remove('hidden');
    modalConfirm.disabled    = false;
    modalConfirm.textContent = '확인';
  }
}

function shakeModal() {
  modal.style.animation = 'none';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    modal.style.animation = '';
    modal.classList.add('shake');
    modal.addEventListener('animationend', () => modal.classList.remove('shake'), { once: true });
  }));
}

modalConfirm.addEventListener('click', handleConfirm);
pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConfirm(); });
btnClear.addEventListener('click', openModal);

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className   = `toast ${type} show`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2800);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── 초기 렌더 ────────────────────────────────────────────────
render();
