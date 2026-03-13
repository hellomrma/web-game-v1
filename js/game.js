/**
 * game.js — Target Rush 게임 로직
 *
 * 규칙:
 *   - 30초 안에 화면에 나타나는 타깃을 클릭/탭
 *   - 타깃 크기별 점수: 대(50px)=1점, 중(32px)=3점, 소(20px)=5점
 *   - 연속으로 맞히면 콤보 배율 증가 (최대 ×4)
 *   - 타깃이 사라지기 전에 못 치면 콤보 리셋
 *   - 게임 종료 시 점수 저장 → 순위 표시
 */

// ── URL 파라미터 ─────────────────────────────────────────────
const params     = new URLSearchParams(window.location.search);
const playerName = params.get('name') || localStorage.getItem('wg-player-name') || '익명';

if (!params.get('name')) {
  window.location.href = 'index.html';
}

// ── DOM ──────────────────────────────────────────────────────
const canvas      = document.getElementById('game-canvas');
const ctx         = canvas.getContext('2d');
const wrap        = document.getElementById('canvas-wrap');

const hudScore    = document.getElementById('hud-score');
const hudTimer    = document.getElementById('hud-timer');
const hudPlayer   = document.getElementById('hud-player');
const hudCombo    = document.getElementById('hud-combo');

const startOverlay   = document.getElementById('start-overlay');
const endOverlay     = document.getElementById('end-overlay');
const countdownOv    = document.getElementById('countdown-overlay');
const countdownNum   = document.getElementById('countdown-number');
const endScore       = document.getElementById('end-score');
const endRank        = document.getElementById('end-rank');
const endPb          = document.getElementById('end-pb');

const btnStartGame   = document.getElementById('btn-start-game');
const btnRetry       = document.getElementById('btn-retry');
const btnRanking     = document.getElementById('btn-ranking');
const btnHome        = document.getElementById('btn-home');

hudPlayer.textContent = playerName;

// ── 타깃 설정 ────────────────────────────────────────────────
const TARGET_TYPES = [
  { r: 50, pts: 1,  color: '#00e5cc', lifespan: 1800, label: '대' },
  { r: 32, pts: 3,  color: '#ffe600', lifespan: 1300, label: '중' },
  { r: 20, pts: 5,  color: '#ff1a6c', lifespan: 900,  label: '소' },
];
// 가중치: 대 50%, 중 35%, 소 15%
const WEIGHTS = [50, 35, 15];

// ── 게임 상태 ────────────────────────────────────────────────
let state = {
  phase:     'idle',  // 'idle' | 'countdown' | 'playing' | 'ended'
  score:     0,
  combo:     0,
  timeLeft:  30,
  targets:   [],
  particles: [],
  spawnTimer:      0,
  spawnInterval:   1200,  // ms
  lastTimestamp:   0,
  timerAccum:      0,
  raf:             null,
  timerInterval:   null,
};

// ── 캔버스 크기 조정 ─────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
  if (state.phase === 'idle') drawIdleBg();
});

// ── 타깃 생성 ────────────────────────────────────────────────
function weightedRandom() {
  const total = WEIGHTS.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < WEIGHTS.length; i++) {
    r -= WEIGHTS[i];
    if (r <= 0) return i;
  }
  return 0;
}

function spawnTarget() {
  const type = TARGET_TYPES[weightedRandom()];
  const margin = type.r + 10;
  const x = margin + Math.random() * (canvas.width  - margin * 2);
  const y = margin + Math.random() * (canvas.height - margin * 2);

  state.targets.push({
    x, y,
    r:        type.r,
    pts:      type.pts,
    color:    type.color,
    lifespan: type.lifespan,
    born:     performance.now(),
    alive:    true,
    popScale: 1,   // hit scale animation
  });
}

// ── 파티클 ───────────────────────────────────────────────────
function spawnParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.4;
    const speed = 2 + Math.random() * 4;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      alpha: 1,
      size: 3 + Math.random() * 3,
      life: 0,
      maxLife: 400 + Math.random() * 200,
    });
  }
}

// ── 메인 루프 ────────────────────────────────────────────────
function gameLoop(ts) {
  if (state.phase !== 'playing') return;

  const dt = state.lastTimestamp ? ts - state.lastTimestamp : 0;
  state.lastTimestamp = ts;

  // 타이머 (초 단위)
  state.timerAccum += dt;
  if (state.timerAccum >= 1000) {
    state.timerAccum -= 1000;
    state.timeLeft--;
    updateHudTimer();
    if (state.timeLeft <= 0) {
      endGame();
      return;
    }
  }

  // 난이도: 시간 지날수록 스폰 빨라짐
  const elapsed = 30 - state.timeLeft;
  state.spawnInterval = Math.max(550, 1200 - elapsed * 28);

  // 타깃 스폰
  state.spawnTimer += dt;
  if (state.spawnTimer >= state.spawnInterval) {
    state.spawnTimer = 0;
    if (state.targets.length < 5) spawnTarget();
  }

  // 타깃 만료 처리
  const now = performance.now();
  state.targets.forEach(t => {
    if (t.alive && now - t.born >= t.lifespan) {
      t.alive = false;
      // 놓치면 콤보 리셋
      if (state.combo > 0) {
        state.combo = 0;
        updateHudCombo();
      }
    }
  });
  state.targets = state.targets.filter(t => t.alive);

  // 파티클 업데이트
  state.particles.forEach(p => {
    p.life += dt;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;         // gravity
    p.vx *= 0.95;
    p.alpha = 1 - p.life / p.maxLife;
  });
  state.particles = state.particles.filter(p => p.alpha > 0.01);

  draw(now);
  state.raf = requestAnimationFrame(gameLoop);
}

// ── 렌더링 ───────────────────────────────────────────────────
function draw(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 타깃
  state.targets.forEach(t => drawTarget(t, now));

  // 파티클
  state.particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawTarget(t, now) {
  const age      = now - t.born;
  const progress = Math.min(age / t.lifespan, 1); // 0 → 1
  const alpha    = 1 - progress * 0.35;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(t.x, t.y);

  const r = t.r;

  // 외부 원 (타이머 링)
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + (1 - progress) * Math.PI * 2);
  ctx.strokeStyle = t.color;
  ctx.lineWidth   = 3;
  ctx.stroke();

  // 내부 채움
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2);
  ctx.fillStyle = t.color + '28';
  ctx.fill();
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 점수 텍스트
  ctx.fillStyle    = t.color;
  ctx.font         = `bold ${Math.round(r * 0.52)}px 'Share Tech Mono'`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`+${t.pts}`, 0, 0);

  ctx.restore();
}

function drawIdleBg() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle    = 'rgba(0,229,204,0.06)';
  ctx.font         = "13px 'Share Tech Mono'";
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('// 시작 버튼을 눌러 게임을 시작하세요', canvas.width / 2, canvas.height / 2);
}

// ── HUD 업데이트 ──────────────────────────────────────────────
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
  if (state.combo <= 1) {
    hudCombo.classList.remove('active');
  } else {
    hudCombo.textContent = `COMBO ×${Math.min(state.combo, 4)}`;
    hudCombo.classList.add('active');
  }
}

// ── 클릭/탭 처리 ─────────────────────────────────────────────
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
  let hit = false;

  // 뒤에 그려진(작은) 타깃 우선 — 역순 탐색
  for (let i = state.targets.length - 1; i >= 0; i--) {
    const t = state.targets[i];
    const dx = x - t.x, dy = y - t.y;
    if (Math.sqrt(dx * dx + dy * dy) <= t.r) {
      // 콤보 배율 (1~4)
      state.combo++;
      const multi = Math.min(Math.ceil(state.combo / 3), 4);
      const gained = t.pts * multi;

      state.score += gained;
      state.targets.splice(i, 1);
      spawnParticles(t.x, t.y, t.color, 8 + t.pts * 2);
      hit = true;

      updateHudScore();
      updateHudCombo();
      break;
    }
  }

  if (!hit) {
    // 빈 곳 클릭 → 콤보만 리셋 (감점 없음)
    if (state.combo > 2) {
      state.combo = 0;
      updateHudCombo();
    }
  }
}

canvas.addEventListener('click',     handleHit);
canvas.addEventListener('touchstart', handleHit, { passive: false });

// ── 게임 흐름 ─────────────────────────────────────────────────
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
      countdownNum.textContent = count;
      countdownNum.style.animation = 'none';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          countdownNum.style.animation = '';
        });
      });
      setTimeout(tick, 700);
    }
  };
  setTimeout(tick, 700);
}

function startGame() {
  startOverlay.classList.add('hidden');
  endOverlay.classList.add('hidden');

  startCountdown(() => {
    // 상태 초기화
    state.phase       = 'playing';
    state.score       = 0;
    state.combo       = 0;
    state.timeLeft    = 30;
    state.targets     = [];
    state.particles   = [];
    state.spawnTimer  = 0;
    state.lastTimestamp = 0;
    state.timerAccum  = 0;

    updateHudScore();
    updateHudTimer();
    hudCombo.classList.remove('active');

    state.raf = requestAnimationFrame(gameLoop);
  });
}

async function endGame() {
  state.phase = 'ended';
  cancelAnimationFrame(state.raf);
  draw(performance.now());

  // 결과 화면 즉시 표시 (저장 중 상태)
  endScore.textContent  = state.score;
  endRank.innerHTML     = `<span style="font-size:11px;color:var(--text-muted)">저장 중...</span>`;
  endPb.classList.add('hidden');
  endOverlay.classList.remove('hidden');

  try {
    const prevBest = await ScoreStore.getPersonalBest(playerName);
    const isNew    = !prevBest || state.score > prevBest.score;
    const rank     = await ScoreStore.save(playerName, state.score);

    endRank.innerHTML = `순위 <span>#${rank}</span>`;
    endPb.classList.toggle('hidden', !isNew);
  } catch (err) {
    console.error('[endGame] 점수 저장 실패:', err);
    endRank.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">저장 실패 (오프라인?)</span>`;
  }
}

// ── 버튼 이벤트 ──────────────────────────────────────────────
btnStartGame.addEventListener('click', startGame);

btnRetry.addEventListener('click', startGame);

btnRanking.addEventListener('click', () => {
  window.location.href = 'ranking.html';
});

btnHome.addEventListener('click', () => {
  window.location.href = 'index.html';
});

// ── 초기 ─────────────────────────────────────────────────────
drawIdleBg();
