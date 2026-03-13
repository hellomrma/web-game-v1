/**
 * game.js — SNAP RUSH 게임 로직
 *
 * ── 점수 규칙 ────────────────────────────────────────────────
 *  타깃 기본 점수: 대(cyan)=1  중(yellow)=3  소(pink)=5
 *
 *  콤보 배율 (연속 히트 수)
 *    1~4   : ×1  (기본)
 *    5~9   : ×2  🔥
 *    10~14 : ×3  🔥🔥
 *    15+   : ×4  🔥🔥🔥  MAX
 *
 *  타깃 놓치면 콤보 즉시 리셋
 *
 * ── 난이도 페이즈 ────────────────────────────────────────────
 *  Phase 1  0~10s : 최대 3개,  0.9s 간격, 기본 속도
 *  Phase 2 10~20s : 최대 5개,  0.6s 간격, 순간 2개 스폰 15%
 *  Phase 3 20~30s : 최대 7개,  0.38s 간격, 순간 2개 스폰 30%, 수명 短
 */

// ── URL 파라미터 ─────────────────────────────────────────────
const params     = new URLSearchParams(window.location.search);
const playerName = params.get('name') || localStorage.getItem('wg-player-name') || '익명';

if (!params.get('name')) window.location.href = 'index.html';

// ── DOM ──────────────────────────────────────────────────────
const canvas    = document.getElementById('game-canvas');
const ctx       = canvas.getContext('2d');
const wrap      = document.getElementById('canvas-wrap');

const hudScore  = document.getElementById('hud-score');
const hudTimer  = document.getElementById('hud-timer');
const hudPlayer = document.getElementById('hud-player');
const hudCombo  = document.getElementById('hud-combo');

const startOverlay  = document.getElementById('start-overlay');
const endOverlay    = document.getElementById('end-overlay');
const countdownOv   = document.getElementById('countdown-overlay');
const countdownNum  = document.getElementById('countdown-number');
const endScore      = document.getElementById('end-score');
const endRank       = document.getElementById('end-rank');
const endPb         = document.getElementById('end-pb');

const btnStartGame  = document.getElementById('btn-start-game');
const btnRetry      = document.getElementById('btn-retry');
const btnRanking    = document.getElementById('btn-ranking');
const btnHome       = document.getElementById('btn-home');

hudPlayer.textContent = playerName;

// ════════════════════════════════════════════════════════════
// 게임 설정 상수
// ════════════════════════════════════════════════════════════

// 타깃 종류: [반지름, 기본점수, 색상, 기본수명ms]
const TARGET_TYPES = [
  { r: 46, pts: 1, color: '#00e5cc', lifespan: 2000 }, // 대 (cyan)
  { r: 28, pts: 3, color: '#ffe600', lifespan: 1350 }, // 중 (yellow)
  { r: 16, pts: 5, color: '#ff1a6c', lifespan: 850  }, // 소 (pink)
];

// 페이즈별 설정
const PHASES = [
  //  종료시각  동시최대  스폰ms  수명배율  가중치[대,중,소]  버스트확률
  { until: 10, max: 3, spawnMs: 900,  lifeMult: 1.00, w: [60, 30, 10], burst: 0.00 },
  { until: 20, max: 5, spawnMs: 600,  lifeMult: 0.85, w: [45, 40, 15], burst: 0.15 },
  { until: 30, max: 7, spawnMs: 380,  lifeMult: 0.70, w: [30, 45, 25], burst: 0.30 },
];

// 콤보 배율 테이블
const COMBO_TIERS = [
  { min: 15, multi: 4, label: '×4 MAX', color: '#ff1a6c' },
  { min: 10, multi: 3, label: '×3',     color: '#ffe600' },
  { min:  5, multi: 2, label: '×2',     color: '#00e5cc' },
  { min:  0, multi: 1, label: '',       color: '#8890b0' },
];

function getComboTier(combo) {
  return COMBO_TIERS.find(t => combo >= t.min);
}

function getPhase(elapsed) {
  return PHASES.find(p => elapsed < p.until) ?? PHASES[PHASES.length - 1];
}

// ════════════════════════════════════════════════════════════
// 게임 상태
// ════════════════════════════════════════════════════════════
let state = {
  phase:          'idle',
  score:          0,
  combo:          0,
  maxCombo:       0,
  timeLeft:       30,
  targets:        [],
  particles:      [],
  floatTexts:     [],   // 히트 시 떠오르는 점수 텍스트
  spawnTimer:     0,
  lastTimestamp:  0,
  timerAccum:     0,
  raf:            null,
};

// ── 캔버스 크기 ──────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
  if (state.phase === 'idle') drawIdleBg();
});

// ════════════════════════════════════════════════════════════
// 타깃 생성
// ════════════════════════════════════════════════════════════
function weightedRandom(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 0;
}

function spawnTarget(phase) {
  const idx  = weightedRandom(phase.w);
  const type = TARGET_TYPES[idx];
  const margin = type.r + 12;

  // 다른 타깃과 겹치지 않도록 최대 8번 시도
  let x, y, tries = 0;
  do {
    x = margin + Math.random() * (canvas.width  - margin * 2);
    y = margin + Math.random() * (canvas.height - margin * 2);
    tries++;
  } while (tries < 8 && state.targets.some(t => {
    const dx = t.x - x, dy = t.y - y;
    return Math.sqrt(dx * dx + dy * dy) < t.r + type.r + 10;
  }));

  state.targets.push({
    x, y,
    r:        type.r,
    pts:      type.pts,
    color:    type.color,
    lifespan: type.lifespan * phase.lifeMult,
    born:     performance.now(),
  });
}

// ════════════════════════════════════════════════════════════
// 파티클 & 플로팅 텍스트
// ════════════════════════════════════════════════════════════
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
    const speed = 2.5 + Math.random() * 4.5;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      alpha: 1,
      size: 2.5 + Math.random() * 3,
      life: 0,
      maxLife: 450 + Math.random() * 200,
    });
  }
}

function spawnFloatText(x, y, text, color) {
  state.floatTexts.push({
    x, y,
    text, color,
    alpha: 1,
    vy: -1.8,
    life: 0,
    maxLife: 700,
  });
}

// ════════════════════════════════════════════════════════════
// 메인 루프
// ════════════════════════════════════════════════════════════
function gameLoop(ts) {
  if (state.phase !== 'playing') return;

  const dt = state.lastTimestamp ? Math.min(ts - state.lastTimestamp, 50) : 0;
  state.lastTimestamp = ts;

  // ── 타이머 ───────────────────────────────────────────────
  state.timerAccum += dt;
  if (state.timerAccum >= 1000) {
    state.timerAccum -= 1000;
    state.timeLeft--;
    updateHudTimer();
    if (state.timeLeft <= 0) { endGame(); return; }
  }

  const elapsed = 30 - state.timeLeft;
  const phase   = getPhase(elapsed);

  // ── 스폰 ─────────────────────────────────────────────────
  state.spawnTimer += dt;
  if (state.spawnTimer >= phase.spawnMs) {
    state.spawnTimer = 0;
    if (state.targets.length < phase.max) {
      spawnTarget(phase);
      // 버스트: 2개 동시 스폰
      if (Math.random() < phase.burst && state.targets.length < phase.max) {
        spawnTarget(phase);
      }
    }
  }

  // ── 타깃 만료 ─────────────────────────────────────────────
  const now = performance.now();
  let missed = false;
  state.targets = state.targets.filter(t => {
    if (now - t.born >= t.lifespan) {
      missed = true;
      // 만료 파티클 (회색)
      spawnParticles(t.x, t.y, '#333355', 5);
      return false;
    }
    return true;
  });
  if (missed && state.combo > 0) {
    state.combo = 0;
    updateHudCombo();
  }

  // ── 파티클 업데이트 ──────────────────────────────────────
  state.particles.forEach(p => {
    p.life += dt;
    p.x   += p.vx;
    p.y   += p.vy;
    p.vy  += 0.12;
    p.vx  *= 0.96;
    p.alpha = 1 - p.life / p.maxLife;
  });
  state.particles = state.particles.filter(p => p.alpha > 0.01);

  // ── 플로팅 텍스트 업데이트 ───────────────────────────────
  state.floatTexts.forEach(f => {
    f.life += dt;
    f.y    += f.vy;
    f.alpha = Math.max(0, 1 - f.life / f.maxLife);
  });
  state.floatTexts = state.floatTexts.filter(f => f.alpha > 0);

  draw(now);
  state.raf = requestAnimationFrame(gameLoop);
}

// ════════════════════════════════════════════════════════════
// 렌더링
// ════════════════════════════════════════════════════════════
function draw(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  state.targets.forEach(t  => drawTarget(t, now));
  state.particles.forEach(p => drawParticle(p));
  state.floatTexts.forEach(f => drawFloatText(f));
}

function drawTarget(t, now) {
  const progress = Math.min((now - t.born) / t.lifespan, 1);
  const urgency  = progress > 0.6 ? (progress - 0.6) / 0.4 : 0; // 0~1 (마지막 40%부터)

  ctx.save();
  ctx.globalAlpha = 1 - progress * 0.25;
  ctx.translate(t.x, t.y);

  const r = t.r;

  // 배경 원 (희미)
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = t.color + '18';
  ctx.fill();

  // 외부 타이머 링 (남은 시간 표시)
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + (1 - progress) * Math.PI * 2);
  ctx.strokeStyle = urgency > 0
    ? lerpColor(t.color, '#ff3333', urgency)  // 마감 임박 시 빨갛게
    : t.color;
  ctx.lineWidth   = 3.5;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // 내부 원
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle   = t.color + '22';
  ctx.fill();
  ctx.strokeStyle = t.color + '88';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // 점수 텍스트
  ctx.fillStyle    = urgency > 0.5 ? '#ffffff' : t.color;
  ctx.font         = `bold ${Math.round(r * 0.5)}px 'Share Tech Mono'`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`+${t.pts}`, 0, 0);

  ctx.restore();
}

function drawParticle(p) {
  ctx.save();
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle   = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFloatText(f) {
  ctx.save();
  ctx.globalAlpha  = f.alpha;
  ctx.fillStyle    = f.color;
  ctx.font         = `bold 15px 'Share Tech Mono'`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = f.color;
  ctx.shadowBlur   = 8;
  ctx.fillText(f.text, f.x, f.y);
  ctx.restore();
}

function drawIdleBg() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle    = 'rgba(0,229,204,0.05)';
  ctx.font         = "13px 'Share Tech Mono'";
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('// 시작 버튼을 눌러 게임을 시작하세요', canvas.width / 2, canvas.height / 2);
}

// ── 색상 보간 헬퍼 ────────────────────────────────────────────
function lerpColor(hex1, hex2, t) {
  const p = (h, o) => parseInt(h.slice(o, o + 2), 16);
  const r1 = p(hex1, 1), g1 = p(hex1, 3), b1 = p(hex1, 5);
  const r2 = p(hex2, 1), g2 = p(hex2, 3), b2 = p(hex2, 5);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

// ════════════════════════════════════════════════════════════
// HUD
// ════════════════════════════════════════════════════════════
function updateHudScore() {
  hudScore.textContent = state.score;
}

function updateHudTimer() {
  hudTimer.textContent = state.timeLeft;
  hudTimer.className   = 'hud-value';
  if      (state.timeLeft <= 5)  hudTimer.className += ' danger';
  else if (state.timeLeft <= 10) hudTimer.className += ' warning';
}

function updateHudCombo() {
  const tier = getComboTier(state.combo);
  if (state.combo < 2) {
    hudCombo.classList.remove('active');
    return;
  }
  hudCombo.textContent  = `${state.combo} COMBO  ${tier.label}`;
  hudCombo.style.color  = tier.color;
  hudCombo.classList.add('active');
}

// ════════════════════════════════════════════════════════════
// 클릭 / 탭 처리
// ════════════════════════════════════════════════════════════
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * (canvas.width  / rect.width),
    y: (src.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

function handleHit(e) {
  if (state.phase !== 'playing') return;
  e.preventDefault();

  const { x, y } = getCanvasPos(e);

  // 반지름이 작은 타깃 우선 (역순 탐색)
  for (let i = state.targets.length - 1; i >= 0; i--) {
    const t  = state.targets[i];
    const dx = x - t.x, dy = y - t.y;
    if (Math.sqrt(dx * dx + dy * dy) > t.r) continue;

    // 콤보 증가 → 배율 계산
    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;

    const tier   = getComboTier(state.combo);
    const gained = t.pts * tier.multi;
    state.score += gained;

    state.targets.splice(i, 1);

    // 파티클
    spawnParticles(t.x, t.y, t.color, 6 + t.pts * 3);

    // 플로팅 점수 텍스트
    const label = tier.multi > 1
      ? `+${gained} (×${tier.multi})`
      : `+${gained}`;
    spawnFloatText(t.x, t.y - t.r - 6, label, tier.color);

    updateHudScore();
    updateHudCombo();
    return;
  }

  // 빈 곳 클릭 — 패널티 없음, 콤보는 유지
}

canvas.addEventListener('click',      handleHit);
canvas.addEventListener('touchstart', handleHit, { passive: false });

// ════════════════════════════════════════════════════════════
// 게임 흐름
// ════════════════════════════════════════════════════════════
function startCountdown(cb) {
  let count = 3;
  countdownNum.textContent = count;
  countdownOv.classList.add('active');

  const tick = () => {
    count--;
    if (count <= 0) {
      countdownOv.classList.remove('active');
      cb();
    } else {
      countdownNum.textContent     = count;
      countdownNum.style.animation = 'none';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        countdownNum.style.animation = '';
      }));
      setTimeout(tick, 700);
    }
  };
  setTimeout(tick, 700);
}

function startGame() {
  startOverlay.classList.add('hidden');
  endOverlay.classList.add('hidden');

  startCountdown(() => {
    state.phase         = 'playing';
    state.score         = 0;
    state.combo         = 0;
    state.maxCombo      = 0;
    state.timeLeft      = 30;
    state.targets       = [];
    state.particles     = [];
    state.floatTexts    = [];
    state.spawnTimer    = 0;
    state.lastTimestamp = 0;
    state.timerAccum    = 0;

    updateHudScore();
    updateHudTimer();
    hudCombo.classList.remove('active');

    // 시작과 동시에 타깃 2개 즉시 스폰
    spawnTarget(PHASES[0]);
    spawnTarget(PHASES[0]);

    state.raf = requestAnimationFrame(gameLoop);
  });
}

async function endGame() {
  state.phase = 'ended';
  cancelAnimationFrame(state.raf);
  draw(performance.now());

  endScore.textContent = state.score;
  endRank.innerHTML    = `<span style="font-size:11px;color:var(--text-muted)">저장 중...</span>`;
  endPb.classList.add('hidden');

  // 최대 콤보 표시 (end-rank 아래에 추가)
  let comboEl = document.getElementById('end-max-combo');
  if (!comboEl) {
    comboEl = document.createElement('p');
    comboEl.id        = 'end-max-combo';
    comboEl.className = 'end-rank';
    comboEl.style.cssText = 'font-size:12px; color:var(--text-dim); margin-bottom:6px;';
    endRank.insertAdjacentElement('afterend', comboEl);
  }
  comboEl.textContent = `최대 콤보  ${state.maxCombo}회`;

  endOverlay.classList.remove('hidden');

  try {
    const prevBest = await ScoreStore.getPersonalBest(playerName);
    const isNew    = !prevBest || state.score > prevBest.score;
    const rank     = await ScoreStore.save(playerName, state.score);

    endRank.innerHTML = `순위 <span>#${rank}</span>`;
    endPb.classList.toggle('hidden', !isNew);
  } catch (err) {
    console.error('[endGame] 저장 실패:', err);
    endRank.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">저장 실패</span>`;
  }
}

// ── 버튼 ─────────────────────────────────────────────────────
btnStartGame.addEventListener('click', startGame);
btnRetry.addEventListener('click',     startGame);
btnRanking.addEventListener('click',   () => { window.location.href = 'ranking.html'; });
btnHome.addEventListener('click',      () => { window.location.href = 'index.html'; });

// ── 초기 ─────────────────────────────────────────────────────
drawIdleBg();
