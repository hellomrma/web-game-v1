/**
 * game.js — SNAP RUSH 게임 로직
 *
 * ── 점수 규칙 ────────────────────────────────────────────────
 *  타깃 기본 점수: 대(cyan)=1  중(yellow)=3  소(pink)=5
 *  콤보 배율: 1~4 ×1 / 5~9 ×2 / 10~14 ×3 / 15+ ×4 MAX
 *
 * ── 난이도 페이즈 (40초) ────────────────────────────────────
 *  Phase 1  0~13s : 최대 3개,  0.9s 간격
 *  Phase 2 13~26s : 최대 5개,  0.6s 간격, 버스트 스폰 15%
 *  Phase 3 26~40s : 최대 7개, 0.38s 간격, 버스트 스폰 30%, 수명 短
 *
 * ── 특수 공격 이벤트 (게임 중 각 1번, 랜덤 타이밍) ──────────
 *  마박사 Attack! — 먹물이 화면을 뒤덮어 타깃이 보이지 않음
 *  홍수조 Attack! — 타깃이 빠르게 좌우로 진동
 *  신비   Attack! — 타이머가 2배속으로 빨라짐
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
// 상수
// ════════════════════════════════════════════════════════════

const GAME_DURATION = 40; // 초

const TARGET_TYPES = [
  { r: 46, pts: 1, color: '#00e5cc', lifespan: 2000 },
  { r: 28, pts: 3, color: '#ffe600', lifespan: 1350 },
  { r: 16, pts: 5, color: '#ff1a6c', lifespan: 850  },
];

const PHASES = [
  { until: 13, max: 3, spawnMs: 900,  lifeMult: 1.00, w: [60, 30, 10], burst: 0.00 },
  { until: 26, max: 5, spawnMs: 600,  lifeMult: 0.85, w: [45, 40, 15], burst: 0.15 },
  { until: 40, max: 7, spawnMs: 380,  lifeMult: 0.70, w: [30, 45, 25], burst: 0.30 },
];

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
// 공격 이벤트 공통 헬퍼
// ════════════════════════════════════════════════════════════

// 세 공격의 트리거 타이밍을 각 구간에서 랜덤 선택 후 무작위 배정
function initAttacks() {
  // 5~13s / 14~24s / 25~35s 구간에서 각 1회 — 겹침 방지 (40초 게임 전체 커버)
  const zones = [[5000, 13000], [14000, 24000], [25000, 35000]];
  const times = zones.map(([lo, hi]) => lo + Math.random() * (hi - lo));

  // 어떤 공격이 어느 타이밍에 발동할지 랜덤 셔플
  const attacks = [MABAKSA, HONGSOO, SHINBI];
  for (let i = attacks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [attacks[i], attacks[j]] = [attacks[j], attacks[i]];
  }
  attacks.forEach((atk, i) => atk.init(times[i]));
}

// ════════════════════════════════════════════════════════════
// 마박사 Attack! — 먹물이 화면을 뒤덮음
// ════════════════════════════════════════════════════════════
const MABAKSA = {
  phase:      'idle',  // 'idle' | 'announce' | 'spread' | 'hold' | 'clear'
  triggered:  false,
  phaseStart: 0,
  triggerAt:  0,
  drops:      [],

  D: { announce: 1000, spread: 1600, hold: 2400, clear: 900 },

  get isActive() { return this.phase !== 'idle'; },

  init(triggerAt) {
    this.phase     = 'idle';
    this.triggered = false;
    this.drops     = [];
    this.triggerAt = triggerAt;
  },

  tick(elapsedMs, now) {
    if (this.triggered) return;
    if (elapsedMs >= this.triggerAt) {
      this.triggered  = true;
      this.phase      = 'announce';
      this.phaseStart = now;
      this._spawnDrops();
    }
  },

  _spawnDrops() {
    const count = 5 + Math.floor(Math.random() * 3);
    const diag  = Math.sqrt(canvas.width ** 2 + canvas.height ** 2);
    for (let i = 0; i < count; i++) {
      this.drops.push({
        x:      Math.random() * canvas.width,
        y:      Math.random() * canvas.height,
        maxR:   diag * (0.5 + Math.random() * 0.35),
        scaleX: 0.85 + Math.random() * 0.3,
        scaleY: 0.85 + Math.random() * 0.3,
        angle:  Math.random() * Math.PI,
        delay:  Math.random() * 0.35,
      });
    }
  },

  draw(now) {
    if (!this.isActive) return;
    const elapsed = now - this.phaseStart;

    switch (this.phase) {
      case 'announce': {
        const t = elapsed / this.D.announce;
        this._drawAnnounce(Math.min(t, 1));
        if (elapsed >= this.D.announce) { this.phase = 'spread'; this.phaseStart = now; }
        break;
      }
      case 'spread': {
        const t = elapsed / this.D.spread;
        this._drawInk(Math.min(t, 1));
        this._drawAttackText(1, false);
        if (elapsed >= this.D.spread) { this.phase = 'hold'; this.phaseStart = now; }
        break;
      }
      case 'hold': {
        this._drawInk(1);
        this._drawAttackText(1, true, elapsed / this.D.hold);
        if (elapsed >= this.D.hold) { this.phase = 'clear'; this.phaseStart = now; }
        break;
      }
      case 'clear': {
        const t = 1 - elapsed / this.D.clear;
        this._drawInk(Math.max(t, 0));
        if (elapsed >= this.D.clear) { this.phase = 'idle'; }
        break;
      }
    }
  },

  _drawAnnounce(t) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${t * 0.55})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (t > 0.25) {
      const textT = (t - 0.25) / 0.75;
      const scale = 0.4 + textT * 0.6;
      ctx.globalAlpha = textT;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      this._renderText();
    }
    ctx.restore();
  },

  _drawAttackText(alpha, pulse, holdT = 0) {
    ctx.save();
    const p = pulse ? 0.5 + 0.5 * Math.sin(holdT * Math.PI * 5) : 1;
    ctx.globalAlpha = alpha * p * 0.55;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    this._renderText();
    ctx.restore();
  },

  _renderText() {
    const size = Math.max(14, Math.min(canvas.width * 0.045, 32));
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `bold ${size}px 'Press Start 2P'`;
    ctx.shadowColor  = 'rgba(255,0,0,0.9)';
    ctx.shadowBlur   = 24;
    ctx.fillStyle    = '#ff2020';
    ctx.fillText('마박사 Attack!', 0, 0);
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'rgba(255,160,160,0.4)';
    ctx.fillText('마박사 Attack!', 0, 0);
  },

  _drawInk(progress) {
    if (progress <= 0) return;
    ctx.save();
    this.drops.forEach(drop => {
      const localT = Math.min(Math.max((progress - drop.delay) / (1 - drop.delay), 0), 1);
      if (localT <= 0) return;
      const baseR = drop.maxR * localT;
      ctx.save();
      ctx.translate(drop.x, drop.y);
      ctx.rotate(drop.angle);
      ctx.scale(drop.scaleX, drop.scaleY);
      const innerR = baseR * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, innerR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(2, 2, 10, ${Math.min(progress * 1.4, 1)})`;
      ctx.fill();
      const grad = ctx.createRadialGradient(0, 0, innerR * 0.8, 0, 0, baseR);
      grad.addColorStop(0,   `rgba(2, 2, 10, ${Math.min(progress * 1.2, 0.98)})`);
      grad.addColorStop(0.6, `rgba(2, 2, 10, ${Math.min(progress * 0.9, 0.85)})`);
      grad.addColorStop(1,   'rgba(2, 2, 10, 0)');
      ctx.beginPath();
      ctx.arc(0, 0, baseR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  },
};

// ════════════════════════════════════════════════════════════
// 홍수조 Attack! — 타깃이 빠르게 좌우로 진동
// ════════════════════════════════════════════════════════════
const HONGSOO = {
  phase:      'idle',  // 'idle' | 'announce' | 'active' | 'clear'
  triggered:  false,
  phaseStart: 0,
  triggerAt:  0,

  D: { announce: 800, active: 5500, clear: 600 },

  get isActive()   { return this.phase !== 'idle'; },
  get isWiggling() { return this.phase === 'active'; },

  init(triggerAt) {
    this.phase     = 'idle';
    this.triggered = false;
    this.triggerAt = triggerAt;
  },

  _assignWiggle(t) {
    const spd = 4 + Math.random() * 5; // px per 60fps frame
    t.wiggleVx = (Math.random() < 0.5 ? 1 : -1) * spd;
  },

  // gameLoop 에서 매 프레임 호출 — 타깃 위치 갱신
  updateTargets(dt) {
    if (this.phase !== 'active') return;
    const fac = dt / 16.667; // 60fps 정규화
    state.targets.forEach(t => {
      if (!t.wiggleVx) this._assignWiggle(t);
      t.x += t.wiggleVx * fac;
      const m = t.r + 10;
      if (t.x < m)                { t.x = m;                t.wiggleVx =  Math.abs(t.wiggleVx); }
      if (t.x > canvas.width - m) { t.x = canvas.width - m; t.wiggleVx = -Math.abs(t.wiggleVx); }
    });
  },

  tick(elapsedMs, now) {
    if (this.triggered) return;
    if (elapsedMs >= this.triggerAt) {
      this.triggered  = true;
      this.phase      = 'announce';
      this.phaseStart = now;
    }
  },

  draw(now) {
    if (!this.isActive) return;
    const elapsed = now - this.phaseStart;

    switch (this.phase) {
      case 'announce': {
        const t = Math.min(elapsed / this.D.announce, 1);
        this._drawAnnounce(t);
        if (elapsed >= this.D.announce) {
          this.phase = 'active'; this.phaseStart = now;
          state.targets.forEach(t => this._assignWiggle(t));
        }
        break;
      }
      case 'active': {
        this._drawBanner(elapsed / this.D.active);
        if (elapsed >= this.D.active) {
          this.phase = 'clear'; this.phaseStart = now;
          state.targets.forEach(t => { t.wiggleVx = 0; });
        }
        break;
      }
      case 'clear': {
        if (elapsed >= this.D.clear) this.phase = 'idle';
        break;
      }
    }
  },

  _drawAnnounce(t) {
    ctx.save();
    ctx.fillStyle = `rgba(255,100,0,${t * 0.45})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (t > 0.2) {
      const tt = (t - 0.2) / 0.8;
      ctx.globalAlpha = tt;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(0.4 + tt * 0.6, 0.4 + tt * 0.6);
      this._renderText();
    }
    ctx.restore();
  },

  _drawBanner(t) {
    const pulse = 0.60 + 0.40 * Math.sin(t * Math.PI * 14);
    ctx.save();
    ctx.globalAlpha = pulse;
    const sz = Math.max(9, Math.min(canvas.width * 0.025, 15));
    ctx.font         = `bold ${sz}px 'Press Start 2P'`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = '#ff6400';
    ctx.shadowBlur   = 20;
    ctx.fillStyle    = '#ff8c00';
    ctx.fillText('홍수조 Attack!', canvas.width / 2, 10);
    ctx.restore();
  },

  _renderText() {
    const sz = Math.max(14, Math.min(canvas.width * 0.045, 32));
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `bold ${sz}px 'Press Start 2P'`;
    ctx.shadowColor  = 'rgba(255,100,0,0.95)';
    ctx.shadowBlur   = 28;
    ctx.fillStyle    = '#ff6400';
    ctx.fillText('홍수조 Attack!', 0, 0);
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'rgba(255,200,80,0.45)';
    ctx.fillText('홍수조 Attack!', 0, 0);
  },
};

// ════════════════════════════════════════════════════════════
// 신비 Attack! — 타이머가 2배속으로 빨라짐
// ════════════════════════════════════════════════════════════
const SHINBI = {
  phase:      'idle',  // 'idle' | 'announce' | 'active' | 'clear'
  triggered:  false,
  phaseStart: 0,
  triggerAt:  0,
  MULT:       2,       // 타이머 배속 (2 = 2배 빠름)

  D: { announce: 800, active: 5000, clear: 500 },

  get isActive()    { return this.phase !== 'idle'; },
  get isTimerFast() { return this.phase === 'active'; },
  get timerMult()   { return this.phase === 'active' ? this.MULT : 1; },

  init(triggerAt) {
    this.phase     = 'idle';
    this.triggered = false;
    this.triggerAt = triggerAt;
  },

  tick(elapsedMs, now) {
    if (this.triggered) return;
    if (elapsedMs >= this.triggerAt) {
      this.triggered  = true;
      this.phase      = 'announce';
      this.phaseStart = now;
    }
  },

  draw(now) {
    if (!this.isActive) return;
    const elapsed = now - this.phaseStart;

    switch (this.phase) {
      case 'announce': {
        const t = Math.min(elapsed / this.D.announce, 1);
        this._drawAnnounce(t);
        if (elapsed >= this.D.announce) { this.phase = 'active'; this.phaseStart = now; }
        break;
      }
      case 'active': {
        this._drawBanner(elapsed / this.D.active);
        if (elapsed >= this.D.active) { this.phase = 'clear'; this.phaseStart = now; }
        break;
      }
      case 'clear': {
        if (elapsed >= this.D.clear) this.phase = 'idle';
        break;
      }
    }
  },

  _drawAnnounce(t) {
    ctx.save();
    ctx.fillStyle = `rgba(130,0,255,${t * 0.42})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (t > 0.2) {
      const tt = (t - 0.2) / 0.8;
      ctx.globalAlpha = tt;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(0.4 + tt * 0.6, 0.4 + tt * 0.6);
      this._renderText();
    }
    ctx.restore();
  },

  _drawBanner(t) {
    const pulse = 0.60 + 0.40 * Math.sin(t * Math.PI * 14);
    ctx.save();
    ctx.globalAlpha = pulse;
    const sz = Math.max(9, Math.min(canvas.width * 0.025, 15));
    ctx.font         = `bold ${sz}px 'Press Start 2P'`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor  = '#c800ff';
    ctx.shadowBlur   = 20;
    ctx.fillStyle    = '#d040ff';
    ctx.fillText('신비 Attack!  타이머 가속 중', canvas.width / 2, canvas.height - 10);
    ctx.restore();
  },

  _renderText() {
    const sz = Math.max(14, Math.min(canvas.width * 0.045, 32));
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `bold ${sz}px 'Press Start 2P'`;
    ctx.shadowColor  = 'rgba(160,0,255,0.95)';
    ctx.shadowBlur   = 28;
    ctx.fillStyle    = '#c800ff';
    ctx.fillText('신비 Attack!', 0, 0);
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'rgba(200,120,255,0.45)';
    ctx.fillText('신비 Attack!', 0, 0);
  },
};

// ════════════════════════════════════════════════════════════
// 게임 상태
// ════════════════════════════════════════════════════════════
let state = {
  phase:         'idle',
  score:         0,
  combo:         0,
  maxCombo:      0,
  timeLeft:      GAME_DURATION,
  elapsedMs:     0,
  targets:       [],
  particles:     [],
  floatTexts:    [],
  spawnTimer:    0,
  lastTimestamp: 0,
  timerAccum:    0,
  raf:           null,
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
  const idx    = weightedRandom(phase.w);
  const type   = TARGET_TYPES[idx];
  const margin = type.r + 12;
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
    wiggleVx: 0,
  });

  // 홍수조 진행 중이면 신규 타깃도 즉시 진동
  if (HONGSOO.isWiggling) {
    HONGSOO._assignWiggle(state.targets[state.targets.length - 1]);
  }
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
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color, alpha: 1, size: 2.5 + Math.random() * 3,
      life: 0, maxLife: 450 + Math.random() * 200,
    });
  }
}

function spawnFloatText(x, y, text, color) {
  state.floatTexts.push({
    x, y, text, color,
    alpha: 1, vy: -1.8,
    life: 0, maxLife: 700,
  });
}

// ════════════════════════════════════════════════════════════
// 메인 루프
// ════════════════════════════════════════════════════════════
function gameLoop(ts) {
  if (state.phase !== 'playing') return;

  const dt = state.lastTimestamp ? Math.min(ts - state.lastTimestamp, 50) : 0;
  state.lastTimestamp = ts;
  state.elapsedMs    += dt;

  // ── 타이머 (신비 Attack 시 배속 적용) ───────────────────
  state.timerAccum += dt * SHINBI.timerMult;
  if (state.timerAccum >= 1000) {
    state.timerAccum -= 1000;
    state.timeLeft--;
    updateHudTimer();
    if (state.timeLeft <= 0) { endGame(); return; }
  }
  // 신비 Attack 활성 중이면 매 프레임 HUD 색상 갱신
  if (SHINBI.isActive) updateHudTimer();

  const elapsed = GAME_DURATION - state.timeLeft;
  const phase   = getPhase(elapsed);

  // ── 특수 공격 타이밍 체크 ─────────────────────────────
  MABAKSA.tick(state.elapsedMs, ts);
  HONGSOO.tick(state.elapsedMs, ts);
  SHINBI.tick(state.elapsedMs, ts);

  // ── 홍수조: 타깃 진동 업데이트 ───────────────────────
  HONGSOO.updateTargets(dt);

  // ── 스폰 ─────────────────────────────────────────────
  state.spawnTimer += dt;
  if (state.spawnTimer >= phase.spawnMs) {
    state.spawnTimer = 0;
    if (state.targets.length < phase.max) {
      spawnTarget(phase);
      if (Math.random() < phase.burst && state.targets.length < phase.max) {
        spawnTarget(phase);
      }
    }
  }

  // ── 타깃 만료 ─────────────────────────────────────────
  const now = performance.now();
  let missed = false;
  state.targets = state.targets.filter(t => {
    if (now - t.born >= t.lifespan) {
      missed = true;
      spawnParticles(t.x, t.y, '#333355', 5);
      return false;
    }
    return true;
  });
  if (missed && state.combo > 0) {
    state.combo = 0;
    updateHudCombo();
  }

  // ── 파티클 업데이트 ──────────────────────────────────
  state.particles.forEach(p => {
    p.life += dt; p.x += p.vx; p.y += p.vy;
    p.vy += 0.12; p.vx *= 0.96;
    p.alpha = 1 - p.life / p.maxLife;
  });
  state.particles = state.particles.filter(p => p.alpha > 0.01);

  // ── 플로팅 텍스트 업데이트 ───────────────────────────
  state.floatTexts.forEach(f => {
    f.life += dt; f.y += f.vy;
    f.alpha = Math.max(0, 1 - f.life / f.maxLife);
  });
  state.floatTexts = state.floatTexts.filter(f => f.alpha > 0);

  // ── 렌더 ─────────────────────────────────────────────
  draw(ts);
  state.raf = requestAnimationFrame(gameLoop);
}

// ════════════════════════════════════════════════════════════
// 렌더링
// ════════════════════════════════════════════════════════════
function draw(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  state.targets.forEach(t   => drawTarget(t, now));
  state.particles.forEach(p => drawParticle(p));
  state.floatTexts.forEach(f => drawFloatText(f));

  // 특수 공격 오버레이 (게임 요소 위에 덮음)
  MABAKSA.draw(now); // 먹물 — 최상위
  HONGSOO.draw(now); // 배너 (상단)
  SHINBI.draw(now);  // 배너 (하단)
}

function drawTarget(t, now) {
  const progress = Math.min((now - t.born) / t.lifespan, 1);
  const urgency  = progress > 0.6 ? (progress - 0.6) / 0.4 : 0;

  ctx.save();
  ctx.globalAlpha = 1 - progress * 0.25;
  ctx.translate(t.x, t.y);

  const r = t.r;

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = t.color + '18';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + (1 - progress) * Math.PI * 2);
  ctx.strokeStyle = urgency > 0 ? lerpColor(t.color, '#ff3333', urgency) : t.color;
  ctx.lineWidth   = 3.5;
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle   = t.color + '22';
  ctx.fill();
  ctx.strokeStyle = t.color + '88';
  ctx.lineWidth   = 1;
  ctx.stroke();

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

function lerpColor(hex1, hex2, t) {
  const p = (h, o) => parseInt(h.slice(o, o + 2), 16);
  const r1 = p(hex1, 1), g1 = p(hex1, 3), b1 = p(hex1, 5);
  const r2 = p(hex2, 1), g2 = p(hex2, 3), b2 = p(hex2, 5);
  return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

// ════════════════════════════════════════════════════════════
// HUD
// ════════════════════════════════════════════════════════════
function updateHudScore() {
  hudScore.textContent = state.score;
}

function updateHudTimer() {
  hudTimer.textContent = state.timeLeft;
  if (SHINBI.isTimerFast) {
    hudTimer.className = 'hud-value shinbi-fast';
  } else {
    hudTimer.className = 'hud-value';
    if      (state.timeLeft <= 5)  hudTimer.className += ' danger';
    else if (state.timeLeft <= 10) hudTimer.className += ' warning';
  }
}

function updateHudCombo() {
  const tier = getComboTier(state.combo);
  if (state.combo < 2) { hudCombo.classList.remove('active'); return; }
  hudCombo.textContent = `${state.combo} COMBO  ${tier.label}`;
  hudCombo.style.color = tier.color;
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

  for (let i = state.targets.length - 1; i >= 0; i--) {
    const t  = state.targets[i];
    const dx = x - t.x, dy = y - t.y;
    if (Math.sqrt(dx * dx + dy * dy) > t.r) continue;

    state.combo++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;

    const tier   = getComboTier(state.combo);
    const gained = t.pts * tier.multi;
    state.score += gained;
    state.targets.splice(i, 1);

    spawnParticles(t.x, t.y, t.color, 6 + t.pts * 3);
    const label = tier.multi > 1 ? `+${gained} (×${tier.multi})` : `+${gained}`;
    spawnFloatText(t.x, t.y - t.r - 6, label, tier.color);

    updateHudScore();
    updateHudCombo();
    return;
  }
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
    state.timeLeft      = GAME_DURATION;
    state.elapsedMs     = 0;
    state.targets       = [];
    state.particles     = [];
    state.floatTexts    = [];
    state.spawnTimer    = 0;
    state.lastTimestamp = 0;
    state.timerAccum    = 0;

    initAttacks();

    updateHudScore();
    updateHudTimer();
    hudCombo.classList.remove('active');

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

  let comboEl = document.getElementById('end-max-combo');
  if (!comboEl) {
    comboEl = document.createElement('p');
    comboEl.id = 'end-max-combo';
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
