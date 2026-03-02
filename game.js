// ============================================================
//  FARM DRONE GAME  —  game.js
//  C++ code editor + 20x20 grid + drone simulation
// ============================================================

'use strict';

// ────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────
let GRID_W = 10, GRID_H = 10;
let CELL   = 60; // px per cell (recalculated on grid resize)

const State    = { EMPTY: 0, TILLED: 1, PLANTED: 2, GROWING: 3, READY: 4, BASE: 5 };
const Dir      = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 };
const CropType = { WHEAT: 0, POTATO: 1, PUMPKIN: 2 };

// Per-crop config: growth ticks, harvest gold, seed cost, visual colors
const CROPS = [
  // WHEAT  — fast, cheap
  { name: 'Wheat',    time1: 8,  time2: 12, value: 2,  seedCost: 1,
    colors: { planted: '#70cc30', growing: '#c8d830', ready: '#ffd000' } },
  // POTATO — medium
  { name: 'Potato',   time1: 14, time2: 20, value: 6,  seedCost: 2,
    colors: { planted: '#50bc40', growing: '#38a828', ready: '#d8a840' } },
  // PUMPKIN — slow, expensive
  { name: 'Pumpkin',  time1: 25, time2: 40, value: 10, seedCost: 5,
    colors: { planted: '#40b030', growing: '#e86820', ready: '#ff5500' } },
];

// Non-crop cell base colors
const BASE_COLORS = { EMPTY: '#2d1808', TILLED: '#3d2210' };

// Water config
const WATER_MAX      = 100; // max cell water level
const WATER_START    = 50;  // water level when planted
const WATER_DRAIN    = 2;   // per tick while planted/growing
const TANK_MAX_BASE  = 50;  // base drone tank capacity
let   TANK_MAX       = 50;  // effective capacity (raised by upgrades)
const WATER_COST     = 15;  // tank units per water() call
const WATER_GIVE     = 50;  // cell water units added by water()
const WATER_BUY_PACK = 50;  // tank units per buy_water(1)
const WATER_BUY_COST = 10;  // gold per buy_water(1) — slight profit if used on pumpkins (~1.28x ROI)

// Energy config
const ENERGY_MAX_BASE     = 120; // base drone battery capacity
let   ENERGY_MAX          = 120; // effective capacity (raised by upgrades)
const ENERGY_START        = 120; // energy on reset
const ENERGY_ACTION_COST  = 1;   // energy spent per tick-action (move/till/plant/water/harvest)
const ENERGY_CHARGE_RATE  = 10;  // energy recharged per tick when at base
const WATER_REFILL_RATE   = 8;   // tank units refilled per tick when at base

// Upgrade config
const UPG_MAX             = 10;   // max upgrade level for each stat
const UPG_TANK_STEP       = 10;   // +10/level (+20% of base 50) → max 150 (3× base)
const UPG_ENERGY_STEP     = 24;   // +24/level (+20% of base 120) → max 360 (3× base)
const UPG_TANK_BASE_COST  = 60;   // cheaper start — tank only matters for watering
const UPG_ENERGY_BASE_COST= 100;  // pricier — battery affects every action (×1.65 per level)
const UPG_COST_MULT       = 1.65; // cost multiplier per upgrade level

let upgTank   = 0; // current tank upgrade level (0–10)
let upgEnergy = 0; // current energy upgrade level (0–10)

function upgCost(baseCost, level) {
  return Math.floor(baseCost * Math.pow(UPG_COST_MULT, level));
}

// ────────────────────────────────────────────────────────────
// GAME STATE
// ────────────────────────────────────────────────────────────
const game = {
  grid: [],          // [y][x] = { state, growTimer, cropType, waterLevel }
  drone: { x: 0, y: 0 },
  score: 0,
  ticks: 0,
  running: false,
  speed: 5,
};

// Economy — lives outside game{} so Reset doesn't wipe it (optional design choice)
const eco = {
  gold:  50,
  seeds: [10, 5, 2],  // [WHEAT, POTATO, PUMPKIN]
  tank:   TANK_MAX,
  energy: ENERGY_START,
};

function initGrid() {
  game.grid = [];
  for (let y = 0; y < GRID_H; y++) {
    game.grid[y] = [];
    for (let x = 0; x < GRID_W; x++) {
      game.grid[y][x] = { state: State.EMPTY, growTimer: 0, cropType: -1, waterLevel: 0 };
    }
  }
  // Mark the base tile — always at (0,0)
  game.grid[0][0].state = State.BASE;
  game.drone = { x: 0, y: 0 };
  game.score = 0;
  game.ticks = 0;
  upgTank   = 0;
  upgEnergy = 0;
  TANK_MAX   = TANK_MAX_BASE;
  ENERGY_MAX = ENERGY_MAX_BASE;
  eco.gold  = 50;
  eco.seeds = [10, 5, 2];
  eco.tank   = TANK_MAX;
  eco.energy = ENERGY_START;
}

function isDroneOnBase() {
  return game.grid[game.drone.y][game.drone.x].state === State.BASE;
}

function growTick() {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const cell = game.grid[y][x];
      if (cell.state === State.BASE) continue; // base tile is not farmland
      const crop = cell.cropType >= 0 ? CROPS[cell.cropType] : null;

      // Growth and drain: check water BEFORE draining so a plant can grow on its last tick of water
      if ((cell.state === State.PLANTED || cell.state === State.GROWING) && crop) {
        if (cell.waterLevel > 0) {
          if (cell.state === State.PLANTED) {
            cell.growTimer++;
            if (cell.growTimer >= crop.time1) {
              cell.state = State.GROWING;
              cell.growTimer = 0;
            }
          } else {
            cell.growTimer++;
            if (cell.growTimer >= crop.time2) {
              cell.state = State.READY;
              cell.growTimer = 0;
            }
          }
        }
        cell.waterLevel = Math.max(0, cell.waterLevel - WATER_DRAIN);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// RENDERER
// ────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

// Drone visual animation state
let droneAnim = { x: 0, y: 0, tx: 0, ty: 0, progress: 1.0,
                  propAngle: 0, bobPhase: 0, tiltX: 0, tiltY: 0 };

function lerp(a, b, t) { return a + (b - a) * Math.min(t, 1); }

function render(animProgress) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid background
  ctx.fillStyle = '#2a1a0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw cells
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const cell = game.grid[y][x];
      const px = x * CELL, py = y * CELL;
      const crop = cell.cropType >= 0 ? CROPS[cell.cropType] : null;

      // ── BASE tile ───────────────────────────────────────────
      if (cell.state === State.BASE) {
        drawBaseTile(px, py);
        continue;
      }

      // ── Base soil fill (always dark brown) ─────────────────
      ctx.fillStyle = cell.state === State.EMPTY ? '#2d1808' : '#3d2210';
      ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);

      // ── Furrow texture for tilled+ states ──────────────────
      if (cell.state !== State.EMPTY) {
        ctx.strokeStyle = 'rgba(20,10,2,0.5)';
        ctx.lineWidth = 1;
        for (let fy = 7; fy < CELL; fy += 9) {
          ctx.beginPath();
          ctx.moveTo(px + 3, py + fy);
          ctx.lineTo(px + CELL - 3, py + fy);
          ctx.stroke();
        }
      }

      // ── Water tint ─────────────────────────────────────────
      if (cell.waterLevel > 0 && cell.state >= State.PLANTED) {
        const alpha = (cell.waterLevel / WATER_MAX) * 0.18;
        ctx.fillStyle = `rgba(40,120,255,${alpha.toFixed(2)})`;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      }

      // ── Dry warning ────────────────────────────────────────
      if (cell.waterLevel <= 0 && (cell.state === State.PLANTED || cell.state === State.GROWING)) {
        ctx.fillStyle = 'rgba(255,60,0,0.22)';
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      }

      // ── Ready state: golden glow border ────────────────────
      if (cell.state === State.READY) {
        ctx.fillStyle = 'rgba(255,220,0,0.07)';
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        ctx.strokeStyle = 'rgba(255,200,20,0.75)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
      }

      // ── Grid line ──────────────────────────────────────────
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);

      // ── Growth progress bar ────────────────────────────────
      if (crop && (cell.state === State.PLANTED || cell.state === State.GROWING)) {
        const total = cell.state === State.PLANTED ? crop.time1 : crop.time2;
        const pct   = cell.growTimer / total;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(px + 2, py + CELL - 5, CELL - 4, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(px + 2, py + CELL - 5, (CELL - 4) * pct, 3);
      }

      // ── Water level bar ────────────────────────────────────
      if (cell.state === State.PLANTED || cell.state === State.GROWING) {
        const wpct = cell.waterLevel / WATER_MAX;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px + 2, py + CELL - 9, CELL - 4, 3);
        ctx.fillStyle = wpct > 0.3 ? 'rgba(60,160,255,0.85)' : 'rgba(255,80,0,0.85)';
        ctx.fillRect(px + 2, py + CELL - 9, (CELL - 4) * wpct, 3);
      }

      // ── Crop sprite ────────────────────────────────────────
      if (cell.state >= State.PLANTED && crop) {
        const scale = cell.state === State.PLANTED ? 0.38 : cell.state === State.GROWING ? 0.68 : 1.0;
        drawCrop(px + CELL / 2, py + CELL / 2, scale, cell.state, cell.cropType);
      }
    }
  }

  // Drone (animated)
  const t  = animProgress !== undefined ? animProgress : 1.0;
  const dx = lerp(droneAnim.x, droneAnim.tx, t) * CELL + CELL / 2;
  const dy = lerp(droneAnim.y, droneAnim.ty, t) * CELL + CELL / 2;

  // Charging glow ring when drone is on base
  if (isDroneOnBase()) {
    const pulse = 0.22 + 0.12 * Math.sin(droneAnim.bobPhase * 2);
    ctx.beginPath();
    ctx.arc(dx, dy, CELL * 0.40, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(56, 213, 140, ${pulse.toFixed(2)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  drawDrone(dx, dy, t);
}

function drawBaseTile(px, py) {
  const cx = px + CELL / 2, cy = py + CELL / 2;

  // Steel-plate background
  ctx.fillStyle = '#141e2c';
  ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);

  // Subtle metal sheen gradient
  const grad = ctx.createLinearGradient(px, py, px + CELL, py + CELL);
  grad.addColorStop(0, 'rgba(70, 100, 150, 0.22)');
  grad.addColorStop(1, 'rgba(20, 40,  80, 0.10)');
  ctx.fillStyle = grad;
  ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);

  // Landing pad circle
  const circR = CELL * 0.36;
  ctx.beginPath();
  ctx.arc(cx, cy, circR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(56, 213, 140, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cross marker
  const arm = CELL * 0.18;
  ctx.strokeStyle = 'rgba(56, 213, 140, 0.40)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  // Corner brackets
  const m = CELL * 0.12, p = px + 2, q = py + 2, r = px + CELL - 2, s = py + CELL - 2;
  ctx.strokeStyle = 'rgba(96, 184, 255, 0.38)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // TL
  ctx.moveTo(p + m, q); ctx.lineTo(p, q); ctx.lineTo(p, q + m);
  // TR
  ctx.moveTo(r - m, q); ctx.lineTo(r, q); ctx.lineTo(r, q + m);
  // BL
  ctx.moveTo(p + m, s); ctx.lineTo(p, s); ctx.lineTo(p, s - m);
  // BR
  ctx.moveTo(r - m, s); ctx.lineTo(r, s); ctx.lineTo(r, s - m);
  ctx.stroke();

  // Border
  ctx.strokeStyle = 'rgba(56, 213, 140, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
}

function drawCrop(cx, cy, scale, state, cropType) {
  const s = scale * CELL * 0.45;
  ctx.save();
  ctx.translate(cx, cy);

  // Helper: fill then stroke the current path
  function fo(fillC, strokeC = 'rgba(0,0,0,0.65)', lw = 1.1) {
    ctx.fillStyle   = fillC;
    ctx.fill();
    ctx.strokeStyle = strokeC;
    ctx.lineWidth   = lw;
    ctx.stroke();
  }

  if (cropType === CropType.WHEAT) {

    if (state === State.PLANTED) {
      // Tiny sprout: stem + two small leaves
      ctx.strokeStyle = '#70cc30'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, s*0.55); ctx.lineTo(0, -s*0.15); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-s*0.27, s*0.12, s*0.22, s*0.1, -0.6, 0, Math.PI*2);
      fo('#88d840', 'rgba(25,60,0,0.6)', 0.7);
      ctx.beginPath(); ctx.ellipse(s*0.27, -s*0.04, s*0.22, s*0.1, 0.6, 0, Math.PI*2);
      fo('#88d840', 'rgba(25,60,0,0.6)', 0.7);

    } else if (state === State.GROWING) {
      // 3 stalks with developing heads
      const xs = [-s*0.36, 0, s*0.36];
      for (let i = 0; i < 3; i++) {
        const sx = xs[i], side = i % 2 === 0 ? -1 : 1;
        ctx.strokeStyle = '#90c838'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx, s*0.65); ctx.lineTo(sx, -s*0.38); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(sx + side*s*0.28, s*0.12, s*0.25, s*0.1, side*0.5, 0, Math.PI*2);
        fo('#70c028', 'rgba(20,50,0,0.5)', 0.7);
        ctx.beginPath(); ctx.ellipse(sx, -s*0.52, s*0.15, s*0.28, 0, 0, Math.PI*2);
        fo('#d8d030', 'rgba(80,70,0,0.6)', 0.8);
      }

    } else { // READY
      // 4 stalks, curved, golden drooping heads with bristles
      const xs = [-s*0.42, -s*0.14, s*0.14, s*0.42];
      for (let i = 0; i < 4; i++) {
        const sx = xs[i], lean = i < 2 ? -0.28 : 0.28;
        ctx.strokeStyle = '#c8b830'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sx, s*0.7);
        ctx.quadraticCurveTo(sx + lean*s*0.3, s*0.1, sx + lean*s*0.55, -s*0.3);
        ctx.stroke();
        ctx.beginPath(); ctx.ellipse(sx + lean*s*0.15, s*0.28, s*0.21, s*0.09, lean*0.8, 0, Math.PI*2);
        fo('#a0c020', 'rgba(40,50,0,0.5)', 0.6);
        ctx.beginPath(); ctx.ellipse(sx + lean*s*0.55, -s*0.52, s*0.17, s*0.36, lean*0.3, 0, Math.PI*2);
        fo('#ffd000', 'rgba(100,70,0,0.8)', 1.0);
        // Bristles
        ctx.strokeStyle = '#e8a000'; ctx.lineWidth = 0.8;
        for (let b = -2; b <= 2; b++) {
          ctx.beginPath();
          ctx.moveTo(sx + lean*s*0.55 + b*s*0.06, -s*0.52 - s*0.36);
          ctx.lineTo(sx + lean*s*0.55 + b*s*0.1, -s*0.52 - s*0.36 - s*0.12);
          ctx.stroke();
        }
      }
    }

  } else if (cropType === CropType.POTATO) {

    if (state === State.PLANTED) {
      for (const side of [-1, 1]) {
        ctx.strokeStyle = '#50bc40'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(side*s*0.1, s*0.5);
        ctx.quadraticCurveTo(side*s*0.32, s*0.1, side*s*0.2, -s*0.2);
        ctx.stroke();
        ctx.beginPath(); ctx.ellipse(side*s*0.27, -s*0.3, s*0.19, s*0.12, side*0.6, 0, Math.PI*2);
        fo('#68d050', 'rgba(10,50,10,0.6)', 0.7);
      }

    } else if (state === State.GROWING) {
      const circles = [{x:-s*0.28,y:s*0.06,r:s*0.34},{x:s*0.28,y:s*0.06,r:s*0.32},{x:0,y:-s*0.28,r:s*0.37},{x:-s*0.12,y:-s*0.04,r:s*0.26}];
      for (let i = 0; i < circles.length; i++) {
        const {x, y, r} = circles[i];
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
        fo(i < 2 ? '#35a028' : '#48b835', 'rgba(10,40,5,0.5)', 0.7);
      }

    } else { // READY
      // Tan potato body
      ctx.beginPath(); ctx.ellipse(s*0.06, s*0.24, s*0.54, s*0.38, 0.15, 0, Math.PI*2);
      fo('#d8a840', 'rgba(90,55,10,0.85)', 1.5);
      // Spots
      ctx.fillStyle = 'rgba(160,100,30,0.45)';
      ctx.beginPath(); ctx.ellipse(-s*0.2, s*0.18, s*0.1, s*0.08, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s*0.22, s*0.32, s*0.09, s*0.07, 0.5, 0, Math.PI*2); ctx.fill();
      // Sprout eyes
      ctx.fillStyle = '#88c850';
      ctx.beginPath(); ctx.arc(-s*0.35, s*0.04, s*0.07, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(s*0.3, s*0.08, s*0.06, 0, Math.PI*2); ctx.fill();
      // Green bush on top
      for (const [bx, by, br] of [[-s*0.2,-s*0.14,s*0.28],[s*0.18,-s*0.1,s*0.25],[0,-s*0.3,s*0.3]]) {
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2);
        fo('#50bc40', 'rgba(10,50,5,0.5)', 0.8);
      }
    }

  } else if (cropType === CropType.PUMPKIN) {

    if (state === State.PLANTED) {
      ctx.strokeStyle = '#40b030'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, s*0.55); ctx.quadraticCurveTo(s*0.2, s*0.1, 0, -s*0.18); ctx.stroke();
      for (const [lx, ly, ang] of [[-s*0.34, s*0.02, -0.5],[s*0.3, -s*0.04, 0.5]]) {
        ctx.beginPath(); ctx.ellipse(lx, ly, s*0.3, s*0.2, ang, 0, Math.PI*2);
        fo('#52c840', 'rgba(10,50,5,0.6)', 0.8);
        ctx.strokeStyle = 'rgba(20,80,10,0.35)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(lx, ly+s*0.15); ctx.lineTo(lx, ly-s*0.15); ctx.stroke();
      }

    } else if (state === State.GROWING) {
      ctx.strokeStyle = '#40b030'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-s*0.5, s*0.35); ctx.quadraticCurveTo(-s*0.1, s*0.1, s*0.22, -s*0.08); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-s*0.28, s*0.09, s*0.29, s*0.19, -0.4, 0, Math.PI*2);
      fo('#44bc34', 'rgba(10,50,5,0.6)', 0.8);
      // Small pumpkin
      const pr = s*0.37;
      ctx.beginPath(); ctx.arc(s*0.3, -s*0.2, pr, 0, Math.PI*2);
      fo('#e86820', 'rgba(100,35,0,0.8)', 1.2);
      ctx.strokeStyle = 'rgba(100,35,0,0.4)'; ctx.lineWidth = 1;
      for (const rx of [-pr*0.38, pr*0.38]) {
        ctx.beginPath();
        ctx.moveTo(s*0.3+rx, -s*0.2-pr);
        ctx.bezierCurveTo(s*0.3+rx*1.5,-s*0.2, s*0.3+rx*1.5,-s*0.2, s*0.3+rx,-s*0.2+pr);
        ctx.stroke();
      }
      ctx.strokeStyle = '#226611'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s*0.3, -s*0.2-pr); ctx.lineTo(s*0.36, -s*0.2-pr-s*0.16); ctx.stroke();

    } else { // READY
      const pr = s * 0.6, pcx = 0, pcy = s*0.06;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(pcx, pcy+pr*0.88, pr*0.82, pr*0.2, 0, 0, Math.PI*2); ctx.fill();
      // Body
      ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, Math.PI*2);
      fo('#ff5500', 'rgba(110,35,0,0.9)', 1.8);
      // Ribs
      ctx.strokeStyle = 'rgba(120,40,0,0.45)'; ctx.lineWidth = 1.5;
      for (const rx of [-pr*0.4, 0, pr*0.4]) {
        ctx.beginPath();
        ctx.moveTo(pcx+rx, pcy-pr);
        ctx.bezierCurveTo(pcx+rx+pr*0.18, pcy-pr*0.3, pcx+rx+pr*0.18, pcy+pr*0.3, pcx+rx, pcy+pr);
        ctx.stroke();
      }
      // Highlight
      ctx.fillStyle = 'rgba(255,200,80,0.32)';
      ctx.beginPath(); ctx.ellipse(pcx-pr*0.26, pcy-pr*0.28, pr*0.28, pr*0.18, -0.5, 0, Math.PI*2); ctx.fill();
      // Stem
      ctx.strokeStyle = '#1e6010'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pcx, pcy-pr); ctx.quadraticCurveTo(pcx+s*0.16, pcy-pr-s*0.18, pcx+s*0.1, pcy-pr-s*0.3); ctx.stroke();
      // Leaf
      ctx.beginPath(); ctx.ellipse(pcx+s*0.24, pcy-pr-s*0.2, s*0.26, s*0.17, 0.5, 0, Math.PI*2);
      fo('#33aa22', 'rgba(10,50,5,0.55)', 0.8);
      ctx.lineCap = 'butt';
    }
  }

  ctx.restore();
}

function drawDrone(cx, cy, t) {
  const r      = Math.min(CELL * 0.33, 20);
  const armLen = r * 1.65;
  const propR  = r * 0.62;

  // Tilt: lean in movement direction as animation starts (lean=1 at t=0, lean=0 at t=1)
  const lean   = 1.0 - Math.min(t, 1.0);
  const tiltOX = droneAnim.tiltX * lean * r * 0.55;
  const tiltOY = droneAnim.tiltY * lean * r * 0.35;

  // Hover bob
  const bob = Math.sin(droneAnim.bobPhase) * 2.0;
  const dcx = cx + tiltOX;
  const dcy = cy + tiltOY + bob;

  // ── Thruster downwash glow ──────────────────────────────────
  const gGrad = ctx.createRadialGradient(cx, cy + r*0.4, 0, cx, cy + r*0.4, r * 2.4);
  gGrad.addColorStop(0, 'rgba(56,213,140,0.18)');
  gGrad.addColorStop(1, 'rgba(56,213,140,0)');
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.5, r * 2.0, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fillStyle = gGrad;
  ctx.fill();

  // ── Ground shadow ───────────────────────────────────────────
  ctx.beginPath();
  ctx.ellipse(cx - tiltOX*0.3, cy + r * 0.9, r * (1.05 + lean*0.22), r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${(0.28 + lean*0.1).toFixed(2)})`;
  ctx.fill();

  // ── Arms at 45°/135°/225°/315° ─────────────────────────────
  const armAngles = [Math.PI*0.25, Math.PI*0.75, Math.PI*1.25, Math.PI*1.75];
  const ledColors = ['#ff3333', '#3399ff', '#33ff88', '#ffdd00'];

  for (let i = 0; i < 4; i++) {
    const ang = armAngles[i];
    const ex  = dcx + Math.cos(ang) * armLen;
    const ey  = dcy + Math.sin(ang) * armLen;

    // Arm beam (dark with highlight)
    ctx.beginPath(); ctx.moveTo(dcx, dcy); ctx.lineTo(ex, ey);
    ctx.strokeStyle = '#111e2a'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = '#1e3a52'; ctx.lineWidth = 1.5; ctx.stroke();

    // Spinning propeller blur (two orthogonal thin ellipses)
    const pa = droneAnim.propAngle + i * (Math.PI * 0.5);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(ex, ey, propR, propR*0.11, pa, 0, Math.PI*2);
    ctx.fillStyle = '#4ecca3'; ctx.fill();
    ctx.globalAlpha = 0.38;
    ctx.beginPath(); ctx.ellipse(ex, ey, propR, propR*0.11, pa + Math.PI/2, 0, Math.PI*2);
    ctx.fillStyle = '#9af5dc'; ctx.fill();
    ctx.restore();

    // Motor hub
    ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI*2);
    ctx.fillStyle = '#0e1820'; ctx.fill();
    ctx.strokeStyle = '#38d58c'; ctx.lineWidth = 1.2; ctx.stroke();

    // LED dot
    ctx.beginPath(); ctx.arc(ex, ey, 2, 0, Math.PI*2);
    ctx.fillStyle = ledColors[i]; ctx.fill();
  }

  // ── Body ─────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(dcx, dcy);

  // Radial gradient body
  const bGrad = ctx.createRadialGradient(-r*0.3, -r*0.35, r*0.03, 0, 0, r);
  bGrad.addColorStop(0,   '#80fce0');
  bGrad.addColorStop(0.5, '#38d58c');
  bGrad.addColorStop(1,   '#12673e');
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = bGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();

  // Decorative inner ring
  ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();

  // Camera lens
  const lGrad = ctx.createRadialGradient(-r*0.1, -r*0.11, 0, 0, 0, r*0.32);
  lGrad.addColorStop(0,   '#5577cc');
  lGrad.addColorStop(0.5, '#101c40');
  lGrad.addColorStop(1,   '#040810');
  ctx.beginPath(); ctx.arc(0, 0, r*0.32, 0, Math.PI*2);
  ctx.fillStyle = lGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(80,130,220,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();

  // Lens flare highlight
  ctx.beginPath(); ctx.arc(-r*0.1, -r*0.1, r*0.1, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();

  // Top body shine stripe
  ctx.beginPath(); ctx.ellipse(0, -r*0.38, r*0.38, r*0.11, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();

  ctx.restore();
}

// ────────────────────────────────────────────────────────────
// DRONE ACTIONS (called by interpreter)
// ────────────────────────────────────────────────────────────
const droneActions = {
  move(dir) {
    const d = game.drone;
    let nx = d.x, ny = d.y;
    if      (dir === Dir.NORTH && d.y > 0)          ny--;
    else if (dir === Dir.SOUTH && d.y < GRID_H - 1) ny++;
    else if (dir === Dir.EAST  && d.x < GRID_W - 1) nx++;
    else if (dir === Dir.WEST  && d.x > 0)          nx--;
    droneAnim.x      = d.x;   droneAnim.y  = d.y;
    droneAnim.tx     = nx;    droneAnim.ty = ny;
    droneAnim.tiltX  = nx - d.x;
    droneAnim.tiltY  = ny - d.y;
    droneAnim.progress = 0;
    d.x = nx; d.y = ny;
  },
  till() {
    const cell = game.grid[game.drone.y][game.drone.x];
    if (cell.state === State.BASE) return; // no-op on base
    if (cell.state === State.EMPTY) {
      cell.state    = State.TILLED;
      cell.cropType = -1;
      cell.waterLevel = 0;
    }
  },
  plant(cropTypeArg) {
    const cell = game.grid[game.drone.y][game.drone.x];
    if (cell.state === State.BASE) return; // no-op on base
    if (cell.state !== State.TILLED) return;
    const ct = (cropTypeArg !== undefined && cropTypeArg >= 0 && cropTypeArg < CROPS.length)
      ? cropTypeArg : CropType.WHEAT;
    if (eco.seeds[ct] <= 0) return; // no seeds
    eco.seeds[ct]--;
    cell.state      = State.PLANTED;
    cell.cropType   = ct;
    cell.growTimer  = 0;
    cell.waterLevel = WATER_START;
  },
  harvest() {
    const cell = game.grid[game.drone.y][game.drone.x];
    if (cell.state === State.BASE) return; // no-op on base
    if (cell.state !== State.READY) return;
    const value = cell.cropType >= 0 ? CROPS[cell.cropType].value : 1;
    eco.gold += value;
    cell.state      = State.EMPTY;
    cell.cropType   = -1;
    cell.growTimer  = 0;
    cell.waterLevel = 0;
    game.score++;
    updateStats();
  },
  water() {
    const cell = game.grid[game.drone.y][game.drone.x];
    if (cell.state === State.BASE) return; // no-op on base
    if (eco.tank < WATER_COST) return; // not enough water in tank
    eco.tank -= WATER_COST;
    cell.waterLevel = Math.min(WATER_MAX, cell.waterLevel + WATER_GIVE);
  },
  get_state_at(x, y) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return -1;
    return game.grid[y][x].state;
  },
  get_state() {
    return game.grid[game.drone.y][game.drone.x].state;
  },
  get_crop_type_at(x, y) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return -1;
    return game.grid[y][x].cropType;
  },
  get_crop_type() {
    return game.grid[game.drone.y][game.drone.x].cropType;
  },
  get_water_level_at(x, y) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return -1;
    return game.grid[y][x].waterLevel;
  },
  get_water_level() {
    return game.grid[game.drone.y][game.drone.x].waterLevel;
  },
  get_tank()          { return eco.tank; },
  get_max_tank()      { return TANK_MAX; },
  get_energy()        { return eco.energy; },
  get_max_energy()    { return ENERGY_MAX; },
  is_at_base()        { return (game.drone.x === 0 && game.drone.y === 0) ? 1 : 0; },
  get_gold()          { return eco.gold; },
  get_seeds(ct)       { return (ct >= 0 && ct < CROPS.length) ? eco.seeds[ct] : 0; },
  buy_seeds(ct, cnt) {
    if (ct < 0 || ct >= CROPS.length) return;
    const count = Math.trunc(cnt);
    if (!Number.isFinite(count) || count <= 0) return;
    const cost = CROPS[ct].seedCost * count;
    if (eco.gold < cost) return;
    eco.gold -= cost;
    eco.seeds[ct] += count;
    updateStats();
  },
  buy_water(cnt) {
    const packs = Math.trunc(cnt);
    if (!Number.isFinite(packs) || packs <= 0) return;
    const cost = WATER_BUY_COST * packs;
    if (eco.gold < cost) return;
    eco.gold -= cost;
    eco.tank = Math.min(TANK_MAX, eco.tank + WATER_BUY_PACK * packs);
    updateStats();
  },
  get_x()     { return game.drone.x; },
  get_y()     { return game.drone.y; },
  get_ticks() { return game.ticks; },
  get_score() { return game.score; },
};

// ────────────────────────────────────────────────────────────
// UI HELPERS
// ────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('score-val').textContent  = game.score;
  document.getElementById('tick-val').textContent   = game.ticks;
  document.getElementById('gold-val').textContent   = eco.gold;
  document.getElementById('tank-val').textContent   = eco.tank;
  document.getElementById('tank-max-disp').textContent   = '/' + TANK_MAX;
  document.getElementById('energy-val').textContent = eco.energy;
  document.getElementById('energy-max-disp').textContent = '/' + ENERGY_MAX;
  // Seeds mini-display
  document.getElementById('seeds-wheat').textContent  = eco.seeds[0];
  document.getElementById('seeds-potato').textContent = eco.seeds[1];
  document.getElementById('seeds-pumpkin').textContent = eco.seeds[2];
}

const consoleArea = document.getElementById('console-area');
function consolePrint(msg, cls = 'console-out') {
  const div = document.createElement('div');
  div.className = `console-line ${cls}`;
  div.textContent = msg;
  consoleArea.appendChild(div);
  consoleArea.scrollTop = consoleArea.scrollHeight;
}

function setStatus(txt, color = '#38d58c') {
  const el = document.getElementById('status-stat');
  el.textContent = txt;
  el.style.color = color;
}

let saveIndicatorTimer = null;
function showSaveIndicator() {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  el.textContent = '● saved';
  el.style.color = '#38d58c';
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => { el.style.color = ''; }, 2000);
}

// ────────────────────────────────────────────────────────────
//  EXECUTION ENGINE
// ────────────────────────────────────────────────────────────
let rafHandle   = null;  // requestAnimationFrame handle
let lastTick    = 0;
let energyWarned = false;

function ensureEnergy() {
  if (eco.energy >= ENERGY_ACTION_COST) return true;
  if (!energyWarned) {
    consolePrint('// Out of energy: drone is stranded! Return to base (0,0) to recharge.', 'console-warn');
    energyWarned = true;
  }
  return false;
}

function spendEnergyForAction() {
  if (!ensureEnergy()) return false;
  eco.energy = Math.max(0, eco.energy - ENERGY_ACTION_COST);
  if (eco.energy > 0) energyWarned = false;
  return true;
}


function stopExecution(msg) {
  game.running = false;
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  stopWasmWorker();
  setRunUI(false);
  setCompileUI('idle');
  if (msg) consolePrint(msg, msg.startsWith('Error') ? 'console-error' : 'console-info');
  render(1.0);
}

function setRunUI(running) {
  document.getElementById('run-btn').disabled   = running;
  document.getElementById('run-btn2').disabled  = running;
  document.getElementById('stop-btn').disabled  = !running;
  document.getElementById('stop-btn2').disabled = !running;
  setStatus(running ? '▶ Running' : '⏹ Stopped', running ? '#f0b84a' : '#38d58c');
}


let tickAccum = 0;

function gameLoop(now) {
  if (!game.running) return;

  const elapsed = now - lastTick;
  lastTick = now;

  const msPerTick = 1000 / game.speed;
  tickAccum += elapsed;

  let ticksDone = 0;
  while (tickAccum >= msPerTick && ticksDone < 5) {
    tickAccum -= msPerTick;
    ticksDone++;
    doTick();
    if (!game.running) break;
  }

  // Animate drone smoothly — cap elapsed to msPerTick so multi-tick frames don't teleport
  const animDt = Math.min(elapsed, msPerTick);
  droneAnim.progress = Math.min(1.0, droneAnim.progress + animDt / msPerTick * 0.8);

  // Propeller spin (faster while moving) + hover bob
  const isMoving = droneAnim.progress < 0.97;
  droneAnim.propAngle = (droneAnim.propAngle + (isMoving ? 0.48 : 0.22)) % (Math.PI * 4);
  droneAnim.bobPhase  = (droneAnim.bobPhase  + 0.04) % (Math.PI * 2);

  render(droneAnim.progress);
  updateStats();

  if (game.running) rafHandle = requestAnimationFrame(gameLoop);
}

function doTick() {
  game.ticks++;
  growTick();

  // Base services — energy + water refill, one increment per tick
  if (isDroneOnBase()) {
    eco.energy = Math.min(ENERGY_MAX, eco.energy + ENERGY_CHARGE_RATE);
    eco.tank   = Math.min(TANK_MAX,   eco.tank   + WATER_REFILL_RATE);
    if (eco.energy > 0) energyWarned = false;
  }

  // WASM mode
  if (wasmMode) { doWasmTick(); return; }
}

// ────────────────────────────────────────────────────────────
//  WASM EXECUTION ENGINE
// ────────────────────────────────────────────────────────────

// Action codes — must match wasm-worker.js
const ACT = {
  MOVE:1, MOVE_NORTH:2, MOVE_SOUTH:3, MOVE_EAST:4, MOVE_WEST:5,
  TILL:6, PLANT:7, HARVEST:8, WATER:9, DRONE_WAIT:10,
  GET_STATE:11, GET_STATE_AT:12, GET_CROP_TYPE:13, GET_CROP_TYPE_AT:14,
  GET_WATER_LEVEL:15, GET_WATER_LEVEL_AT:16, GET_TANK:17,
  GET_GOLD:18, GET_SEEDS:19, BUY_SEEDS:20,
  GET_X:21, GET_Y:22, GET_TICKS:23, GET_SCORE:24,
  PRINT_INT:25, BUY_WATER:26, GET_ENERGY:27, GET_MAX_ENERGY:28, IS_AT_BASE:29, GET_MAX_TANK:30,
};

// Actions that do NOT consume a tick (queries)
const QUERY_ACTIONS = new Set([
  ACT.GET_STATE, ACT.GET_STATE_AT, ACT.GET_CROP_TYPE, ACT.GET_CROP_TYPE_AT,
  ACT.GET_WATER_LEVEL, ACT.GET_WATER_LEVEL_AT, ACT.GET_TANK,
  ACT.GET_ENERGY, ACT.GET_MAX_ENERGY, ACT.GET_MAX_TANK, ACT.IS_AT_BASE,
  ACT.GET_GOLD, ACT.GET_SEEDS, ACT.GET_X, ACT.GET_Y,
  ACT.GET_TICKS, ACT.GET_SCORE, ACT.PRINT_INT,
]);

const SAB_SIZE = 8;
const IDX = { ACTION:0, ARG0:1, ARG1:2, RESULT:3, RESPONSE:4, READY:5 };

let wasmMode      = false;
let wasmWorker    = null;
let wasmSAB       = null;
let wasmCtrl      = null;   // Int32Array view
let pendingWasm   = false;  // a tick-action is waiting to be processed
let droneWaitLeft = 0;      // remaining ticks for drone_wait()
let wasmLoopGen   = 0;      // generation counter — old loop exits when incremented

// Execute a WASM action and return the result
function execWasmAction() {
  const action = Atomics.load(wasmCtrl, IDX.ACTION);
  const arg0   = Atomics.load(wasmCtrl, IDX.ARG0);
  const arg1   = Atomics.load(wasmCtrl, IDX.ARG1);
  let result   = 0;

  switch (action) {
    case ACT.MOVE:              if (spendEnergyForAction()) droneActions.move(arg0);      break;
    case ACT.MOVE_NORTH:        if (spendEnergyForAction()) droneActions.move(Dir.NORTH); break;
    case ACT.MOVE_SOUTH:        if (spendEnergyForAction()) droneActions.move(Dir.SOUTH); break;
    case ACT.MOVE_EAST:         if (spendEnergyForAction()) droneActions.move(Dir.EAST);  break;
    case ACT.MOVE_WEST:         if (spendEnergyForAction()) droneActions.move(Dir.WEST);  break;
    case ACT.TILL:              if (!isDroneOnBase() && spendEnergyForAction()) droneActions.till();          break;
    case ACT.PLANT:             if (!isDroneOnBase() && spendEnergyForAction()) droneActions.plant(arg0);     break;
    case ACT.HARVEST:           if (!isDroneOnBase() && spendEnergyForAction()) droneActions.harvest();       break;
    case ACT.WATER:             if (!isDroneOnBase() && spendEnergyForAction()) droneActions.water();         break;
    case ACT.GET_STATE:         result = droneActions.get_state();                    break;
    case ACT.GET_STATE_AT:      result = droneActions.get_state_at(arg0, arg1);       break;
    case ACT.GET_CROP_TYPE:     result = droneActions.get_crop_type();                break;
    case ACT.GET_CROP_TYPE_AT:  result = droneActions.get_crop_type_at(arg0, arg1);   break;
    case ACT.GET_WATER_LEVEL:   result = droneActions.get_water_level();              break;
    case ACT.GET_WATER_LEVEL_AT:result = droneActions.get_water_level_at(arg0, arg1); break;
    case ACT.GET_TANK:          result = droneActions.get_tank();                     break;
    case ACT.GET_MAX_TANK:      result = droneActions.get_max_tank();                 break;
    case ACT.GET_ENERGY:        result = droneActions.get_energy();                   break;
    case ACT.GET_MAX_ENERGY:    result = droneActions.get_max_energy();               break;
    case ACT.IS_AT_BASE:        result = droneActions.is_at_base();                   break;
    case ACT.GET_GOLD:          result = droneActions.get_gold();                     break;
    case ACT.GET_SEEDS:         result = droneActions.get_seeds(arg0);                break;
    case ACT.BUY_SEEDS:         droneActions.buy_seeds(arg0, arg1);                   break;
    case ACT.BUY_WATER:         droneActions.buy_water(arg0);                         break;
    case ACT.GET_X:             result = droneActions.get_x();                        break;
    case ACT.GET_Y:             result = droneActions.get_y();                        break;
    case ACT.GET_TICKS:         result = droneActions.get_ticks();                    break;
    case ACT.GET_SCORE:         result = droneActions.get_score();                    break;
    case ACT.PRINT_INT:         consolePrint(String(arg0), 'console-out');             break;
  }
  return result;
}

// Reply to worker (unblock it)
function wasmReply(result = 0) {
  Atomics.store(wasmCtrl, IDX.RESULT,   result);
  Atomics.store(wasmCtrl, IDX.ACTION,   0);
  Atomics.store(wasmCtrl, IDX.RESPONSE, 1);
  Atomics.notify(wasmCtrl, IDX.RESPONSE, 1);
}

// Async loop waiting for the next action from WASM.
// Takes gen — generation number; old loop exits automatically on restart.
async function wasmActionLoop(gen) {
  while (game.running && wasmMode && wasmLoopGen === gen) {
    const ctrl = wasmCtrl;
    if (!ctrl) return; // SAB not set yet (should not happen)

    // Wait until ACTION != 0 (without blocking the main thread)
    const r = await Atomics.waitAsync(ctrl, IDX.ACTION, 0).value;

    // Check generation after await — a restart may have happened while waiting
    if (wasmLoopGen !== gen) return;
    if (r === 'timed-out') continue;

    const action = Atomics.load(ctrl, IDX.ACTION);
    if (!action) continue; // spurious wakeup

    if (action === ACT.DRONE_WAIT) {
      droneWaitLeft = Math.max(0, Atomics.load(ctrl, IDX.ARG0) - 1);
      Atomics.store(ctrl, IDX.ACTION, 0);
      if (droneWaitLeft === 0) {
        wasmReply(0);
        continue;
      }
      return; // wait for ticks in doTick()
    }

    if (QUERY_ACTIONS.has(action)) {
      const result = execWasmAction();
      wasmReply(result);
    } else {
      pendingWasm = true;
      return;
    }
  }
}

// Process a WASM tick (called from doTick)
function doWasmTick() {
  // Count down drone_wait
  if (droneWaitLeft > 0) {
    droneWaitLeft--;
    if (droneWaitLeft === 0) {
      wasmReply(0);
      wasmActionLoop(wasmLoopGen);
    }
    return;
  }

  if (!pendingWasm) return;
  pendingWasm = false;

  const result = execWasmAction();
  wasmReply(result);
  wasmActionLoop(wasmLoopGen); // start waiting for the next action
}

// Spawns and connects a new worker (does not touch game.running / wasmMode).
// Used both on first launch and on silent restart after done.
async function _spawnWasmWorker(bytes) {
  wasmSAB  = new SharedArrayBuffer(SAB_SIZE * Int32Array.BYTES_PER_ELEMENT);
  wasmCtrl = new Int32Array(wasmSAB);

  wasmWorker = new Worker('wasm-worker.js');

  wasmWorker.onmessage = (e) => {
    if (e.data.type === 'done') {
      // Terminate worker directly — do NOT touch wasmMode/game.running,
      // so doTick stays on the WASM path during restart.
      wasmWorker.terminate();
      wasmWorker = null;
      pendingWasm   = false;
      droneWaitLeft = 0;
      wasmLoopGen++;           // kill old wasmActionLoop
      _spawnWasmWorker(bytes); // silent restart
    } else if (e.data.type === 'error') {
      stopExecution('WASM error: ' + e.data.message);
    }
  };

  wasmWorker.onerror = (e) => {
    stopExecution('Worker error: ' + e.message);
  };

  wasmWorker.postMessage({ type: 'start', sab: wasmSAB, wasm: bytes });

  try {
    await Atomics.waitAsync(wasmCtrl, IDX.READY, 0).value;
  } catch (_) {}

  if (!game.running || !wasmMode) return; // stopped while waiting for READY

  pendingWasm   = false;
  droneWaitLeft = 0;
  wasmActionLoop(wasmLoopGen); // start loop with current generation
}

// First launch: compilation done, initialise all game state
async function launchWasm(wasmBytes) {
  wasmMode     = true;
  game.running = true;
  lastTick     = performance.now();
  tickAccum    = 0;
  wasmLoopGen++;

  setRunUI(true);
  setCompileUI('running');
  if (!rafHandle) rafHandle = requestAnimationFrame(gameLoop);

  await _spawnWasmWorker(wasmBytes);
}

// Compile C++ and run
async function compileAndRun(code) {
  if (game.running) return;

  setCompileUI('compiling');
  consolePrint('// Compiling C++...', 'console-info');

  let wasmBytes;
  try {
    const resp = await fetch('/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, gridW: GRID_W, gridH: GRID_H }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Compiler error');
    }

    wasmBytes = await resp.arrayBuffer();
  } catch (e) {
    setCompileUI('idle');
    const lines = e.message.split('\n');
    consolePrint('Compilation error:', 'console-error');
    lines.forEach(l => { if (l.trim()) consolePrint(l, 'console-error'); });
    return;
  }

  consolePrint('// Compilation successful — launching WASM', 'console-info');
  await launchWasm(wasmBytes);
}

// Stop the WASM worker
function stopWasmWorker() {
  if (wasmWorker) {
    wasmWorker.terminate();
    wasmWorker = null;
  }
  wasmMode      = false;
  wasmSAB       = null;
  wasmCtrl      = null;
  pendingWasm   = false;
  droneWaitLeft = 0;
}

function setCompileUI(state) {
  const btns = [
    document.getElementById('run-btn'),
    document.getElementById('run-btn2'),
  ];
  for (const btn of btns) {
    if (!btn) continue;
    if (state === 'compiling') {
      btn.textContent       = '⏳ Compiling...';
      btn.disabled          = true;
      btn.style.background  = 'rgba(167,139,250,0.15)';
      btn.style.color       = '#a78bfa';
      btn.style.borderColor = 'rgba(167,139,250,0.3)';
    } else {
      // idle or running — setRunUI handles the disabled state and label
      btn.textContent       = '▶ Run';
      btn.style.background  = '';
      btn.style.color       = '';
      btn.style.borderColor = '';
    }
  }
}

// ────────────────────────────────────────────────────────────
//  SAMPLE CODE
// ────────────────────────────────────────────────────────────
const SAMPLES = {
  'Snake sweep': `// ── Infinite snake sweep of the field ───────────────────────
// Wheat is the fastest crop (8+12 ticks, 2 gold).
// while(1) keeps the drone running forever without restarts.

void process_cell() {
    CellState s = get_cell_state();
    if (s == CellState::EMPTY)  till();
    if (s == CellState::TILLED) plant(CropType::WHEAT);
    if (s == CellState::READY)  harvest();
}

int main() {
    Direction dir = Direction::EAST;
    while (1) {
        process_cell();
        if (dir == Direction::EAST) {
            if (get_x() < GRID_W - 1) move(Direction::EAST);
            else { move(Direction::SOUTH); dir = Direction::WEST; }
        } else {
            if (get_x() > 0) move(Direction::WEST);
            else { move(Direction::SOUTH); dir = Direction::EAST; }
        }
    }
}`,

  'Zone farming': `// ── Zone-based farming ───────────────────────────────────────
// Field split into three horizontal zones:
//   y 0..3  — Wheat   (fast,   2💰, 1🌱)
//   y 4..6  — Potato  (medium, 5💰, 2🌱)
//   y 7..9  — Pumpkin (slow,  12💰, 4🌱)

void process_cell(CropType crop) {
    CellState s = get_cell_state();
    if (s == CellState::EMPTY)  till();
    if (s == CellState::TILLED) {
        if (get_seeds(crop) == 0) buy_seeds(crop, 5);
        plant(crop);
    }
    if (s == CellState::READY)  harvest();
}

int main() {
    Direction dir = Direction::EAST;
    while (1) {
        int y = get_y();
        CropType crop;
        if      (y < 4) crop = CropType::WHEAT;
        else if (y < 7) crop = CropType::POTATO;
        else            crop = CropType::PUMPKIN;

        process_cell(crop);

        if (dir == Direction::EAST) {
            if (get_x() < GRID_W - 1) move(Direction::EAST);
            else { move(Direction::SOUTH); dir = Direction::WEST; }
        } else {
            if (get_x() > 0) move(Direction::WEST);
            else { move(Direction::SOUTH); dir = Direction::EAST; }
        }
    }
}`,

  'Watering & economy': `// ── Smart farmer ─────────────────────────────────────────────
// — Picks crop based on current gold
// — Buys seeds automatically when out
// — Waters cells when water_level < 30

void ensure_seeds(CropType crop, int min_count) {
    if (get_seeds(crop) < min_count)
        buy_seeds(crop, 10);
}

void tend_cell() {
    CellState s = get_cell_state();

    if (s == CellState::EMPTY) { till(); return; }

    if (s == CellState::TILLED) {
        CropType crop = CropType::WHEAT;
        if (get_gold() >= 20) crop = CropType::POTATO;
        if (get_gold() >= 60) crop = CropType::PUMPKIN;
        ensure_seeds(crop, 2);
        plant(crop);
        return;
    }

    if (s == CellState::PLANTED || s == CellState::GROWING) {
        if (get_water_level() < 30 && get_tank() >= 15)
            water();
        return;
    }

    if (s == CellState::READY) harvest();
}

int main() {
    Direction dir = Direction::EAST;
    while (1) {
        tend_cell();

        if (dir == Direction::EAST) {
            if (get_x() < GRID_W - 1) move(Direction::EAST);
            else { move(Direction::SOUTH); dir = Direction::WEST; }
        } else {
            if (get_x() > 0) move(Direction::WEST);
            else { move(Direction::SOUTH); dir = Direction::EAST; }
        }
    }
}`,

  'Full auto farmer': `// ── Infinite non-stop farmer ─────────────────────────────────
// Flow: till → plant → water (if needed) → harvest
// Snake traversal, never stops.

int main() {
    Direction dir = Direction::EAST;
    while (1) {
        CellState s = get_cell_state();

        if (s == CellState::EMPTY)  till();
        if (s == CellState::TILLED) plant(CropType::WHEAT);
        if (s == CellState::PLANTED || s == CellState::GROWING) {
            if (get_water_level() < 25 && get_tank() >= 15)
                water();
        }
        if (s == CellState::READY)  harvest();

        if (dir == Direction::EAST) {
            if (get_x() < GRID_W - 1) move(Direction::EAST);
            else { move(Direction::SOUTH); dir = Direction::WEST; }
        } else {
            if (get_x() > 0) move(Direction::WEST);
            else { move(Direction::SOUTH); dir = Direction::EAST; }
        }
    }
}`,
};

// ────────────────────────────────────────────────────────────
//  LOCALSTORAGE  — autosave
// ────────────────────────────────────────────────────────────
const LS_KEY = 'farm_drone_code';
const LS_SETTINGS_KEY = 'farm_drone_settings';
const DEFAULT_SETTINGS = {
  gridW: 10,
  gridH: 10,
  speed: 5,
  uiScale: 1,
  editorFontSize: 14,
  editorTheme: 'vs-dark',
};

function lsSave(code) {
  try { localStorage.setItem(LS_KEY, code); } catch (_) {}
}

function lsLoad() {
  try { return localStorage.getItem(LS_KEY); } catch (_) { return null; }
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeSettings(s = {}) {
  const theme = s.editorTheme === 'vs' || s.editorTheme === 'vs-dark'
    ? s.editorTheme
    : DEFAULT_SETTINGS.editorTheme;
  const rawScale = Number(s.uiScale);
  const uiScale = Number.isFinite(rawScale) ? Math.max(0.9, Math.min(1.25, rawScale)) : DEFAULT_SETTINGS.uiScale;

  return {
    gridW: clampInt(s.gridW, 3, 30, DEFAULT_SETTINGS.gridW),
    gridH: clampInt(s.gridH, 3, 30, DEFAULT_SETTINGS.gridH),
    speed: clampInt(s.speed, 1, 20, DEFAULT_SETTINGS.speed),
    uiScale,
    editorFontSize: clampInt(s.editorFontSize, 11, 24, DEFAULT_SETTINGS.editorFontSize),
    editorTheme: theme,
  };
}

function loadSettingsLS() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsLS(settings) {
  try { localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function applyUiScale(scale) {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

let appSettings = loadSettingsLS();
applyUiScale(appSettings.uiScale);

// ────────────────────────────────────────────────────────────
//  MONACO EDITOR INIT
// ────────────────────────────────────────────────────────────
let monacoEditor = null;
let saveTimer    = null;   // debounce handle

function getInitialCode() {
  return lsLoad() ?? SAMPLES['Snake sweep'];
}

require.config({
  paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }
});

require(['vs/editor/editor.main'], function () {
  monacoEditor = monaco.editor.create(
    document.getElementById('editor-container'),
    {
      value:           getInitialCode(),
      language:        'cpp',
      theme:           appSettings.editorTheme,
      fontSize:        appSettings.editorFontSize,
      lineNumbers:     'on',
      minimap:         { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize:         4,
      wordWrap:        'off',
      fontFamily:      "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      fontLigatures:   true,
    }
  );

  // Autosave: debounced 1 s after last keystroke
  monacoEditor.onDidChangeModelContent(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      lsSave(monacoEditor.getValue());
      showSaveIndicator();
    }, 1000);
  });

  // Ctrl+Enter / Cmd+Enter → Run
  monacoEditor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
    () => runCode()
  );

  // Show indicator if code was restored from storage
  if (lsLoad() !== null) {
    consolePrint('// Code restored from localStorage', 'console-info');
  }
});

// ────────────────────────────────────────────────────────────
//  UI EVENT HANDLERS
// ────────────────────────────────────────────────────────────
function runCode() {
  if (game.running) return;
  consoleArea.innerHTML = '';
  const code = monacoEditor
    ? monacoEditor.getValue()
    : document.getElementById('editor-fallback')?.value || '';
  if (!code.trim()) { consolePrint('Enter code in the editor first', 'console-warn'); return; }
  compileAndRun(code);
}

function stopCode() {
  stopExecution('// Stopped by user');
}

function resetGame() {
  stopCode();
  initGrid();
  droneAnim = { x: 0, y: 0, tx: 0, ty: 0, progress: 1.0, propAngle: 0, bobPhase: 0, tiltX: 0, tiltY: 0 };
  consoleArea.innerHTML = '';
  consolePrint('// Field reset', 'console-info');
  updateStats();
  render(1.0);
}

document.getElementById('run-btn').addEventListener('click',   runCode);
document.getElementById('run-btn2').addEventListener('click',  runCode);
document.getElementById('stop-btn').addEventListener('click',  stopCode);
document.getElementById('stop-btn2').addEventListener('click', stopCode);
document.getElementById('reset-btn').addEventListener('click', resetGame);

// Speed slider
const speedSlider  = document.getElementById('speed-slider');
const speedDisplay = document.getElementById('speed-display');
speedSlider.addEventListener('input', () => {
  game.speed = parseInt(speedSlider.value);
  speedDisplay.textContent = game.speed;
});

// Samples dropdown
document.getElementById('example-btn').addEventListener('click', function () {
  const existing = document.getElementById('samples-menu');
  if (existing) { existing.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'samples-menu';
  menu.style.cssText = `
    position:absolute; background:#101928; border:1px solid #1f3050;
    border-radius:8px; z-index:999; padding:4px 0; min-width:180px;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
    font-family:'Inter',sans-serif;
    top:${this.getBoundingClientRect().bottom + 4}px;
    right:${window.innerWidth - this.getBoundingClientRect().right}px;
  `;
  for (const [name] of Object.entries(SAMPLES)) {
    const item = document.createElement('div');
    item.textContent = name;
    item.style.cssText = 'padding:8px 14px; cursor:pointer; font-size:calc(12px * var(--ui-scale)); color:#7a9ab4; font-weight:500;';
    item.onmouseenter = () => item.style.background = '#172235';
    item.onmouseleave = () => item.style.background = '';
    item.onclick = () => {
      if (monacoEditor) {
        monacoEditor.setValue(SAMPLES[name]);
        lsSave(SAMPLES[name]);
        showSaveIndicator();
      }
      menu.remove();
    };
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => { menu.remove(); }, { once: true }), 10);
});

// ────────────────────────────────────────────────────────────
//  SETTINGS
// ────────────────────────────────────────────────────────────
function computeCell(w, h) {
  return Math.max(8, Math.min(60, Math.floor(Math.min(600 / w, 600 / h))));
}

function applySettings(nextSettings) {
  const settings = normalizeSettings(nextSettings);
  const { gridW: w, gridH: h, speed, uiScale, editorFontSize, editorTheme } = settings;
  const gridChanged = (w !== GRID_W || h !== GRID_H);
  if (gridChanged && game.running) stopExecution('// Stopped: grid size changed');

  GRID_W = w;
  GRID_H = h;
  CELL   = computeCell(w, h);

  canvas.width  = CELL * GRID_W;
  canvas.height = CELL * GRID_H;

  game.speed = speed;
  speedSlider.value       = speed;
  speedDisplay.textContent = speed;
  applyUiScale(uiScale);

  if (monacoEditor) {
    monacoEditor.updateOptions({ fontSize: editorFontSize });
    monaco.editor.setTheme(editorTheme);
  }

  // Update API panel grid info
  const gridInfo = document.querySelector('.api-grid-info');
  if (gridInfo) gridInfo.innerHTML = `<b>GRID_W</b> × <b>GRID_H</b> = ${GRID_W} × ${GRID_H}<br><span style="color:var(--tx-3)">// 1 seed = 1💰</span>`;

  if (gridChanged || game.grid.length === 0) {
    initGrid();
    droneAnim = { x: 0, y: 0, tx: 0, ty: 0, progress: 1.0, propAngle: 0, bobPhase: 0, tiltX: 0, tiltY: 0 };
  }
  render(1.0);
  updateStats();
  appSettings = settings;
  saveSettingsLS(settings);
}

// ── Modal logic ──────────────────────────────────────────────
const sOverlay  = document.getElementById('settings-overlay');
const sGridW    = document.getElementById('s-grid-w');
const sGridH    = document.getElementById('s-grid-h');
const sSpeed    = document.getElementById('s-speed');
const sSpeedNum = document.getElementById('s-speed-num');
const sWarn     = document.getElementById('s-warn');
const sPresets  = document.querySelectorAll('.s-preset');
const sScaleBtns = document.querySelectorAll('.s-scale-btn');
const sEditorFont = document.getElementById('s-editor-font');
const sEditorFontNum = document.getElementById('s-editor-font-num');
const sThemeBtns = document.querySelectorAll('.s-theme-btn');
let sUiScale = appSettings.uiScale;
let sEditorTheme = appSettings.editorTheme;

function updateScaleActive() {
  sScaleBtns.forEach(btn => {
    const scale = Number(btn.dataset.scale);
    btn.classList.toggle('active', Math.abs(scale - sUiScale) < 0.001);
  });
}

function updateThemeActive() {
  sThemeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === sEditorTheme);
  });
}

function openSettings() {
  sGridW.value = GRID_W;
  sGridH.value = GRID_H;
  sSpeed.value = game.speed;
  sSpeedNum.textContent = game.speed;
  sUiScale = appSettings.uiScale;
  sEditorTheme = appSettings.editorTheme;
  sEditorFont.value = appSettings.editorFontSize;
  sEditorFontNum.textContent = appSettings.editorFontSize;
  updateScaleActive();
  updateThemeActive();
  updatePresetActive();
  sWarn.classList.add('hidden');
  sOverlay.classList.remove('hidden');
}

function closeSettings() {
  sOverlay.classList.add('hidden');
}

function updatePresetActive() {
  const w = parseInt(sGridW.value), h = parseInt(sGridH.value);
  sPresets.forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.w) === w && parseInt(b.dataset.h) === h);
  });
  sWarn.classList.toggle('hidden', w === GRID_W && h === GRID_H);
}

sPresets.forEach(btn => {
  btn.addEventListener('click', () => {
    sGridW.value = btn.dataset.w;
    sGridH.value = btn.dataset.h;
    updatePresetActive();
  });
});

sGridW.addEventListener('input', updatePresetActive);
sGridH.addEventListener('input', updatePresetActive);

sSpeed.addEventListener('input', () => {
  sSpeedNum.textContent = sSpeed.value;
});

sScaleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sUiScale = Number(btn.dataset.scale);
    updateScaleActive();
  });
});

sEditorFont.addEventListener('input', () => {
  sEditorFontNum.textContent = sEditorFont.value;
});

sThemeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sEditorTheme = btn.dataset.theme;
    updateThemeActive();
  });
});

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('s-close-btn').addEventListener('click',  closeSettings);
document.getElementById('s-cancel-btn').addEventListener('click', closeSettings);

document.getElementById('s-apply-btn').addEventListener('click', () => {
  const w = Math.max(3, Math.min(30, parseInt(sGridW.value) || 10));
  const h = Math.max(3, Math.min(30, parseInt(sGridH.value) || 10));
  const s = parseInt(sSpeed.value);
  const settings = {
    gridW: w,
    gridH: h,
    speed: s,
    uiScale: sUiScale,
    editorFontSize: parseInt(sEditorFont.value, 10),
    editorTheme: sEditorTheme,
  };
  applySettings(settings);
  closeSettings();
});

sOverlay.addEventListener('click', e => { if (e.target === sOverlay) closeSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

// ────────────────────────────────────────────────────────────
//  EXTRA MODAL (Emergency Supplies + Upgrades)
// ────────────────────────────────────────────────────────────
const EXTRA_ENERGY_AMOUNT = 40;
const EXTRA_ENERGY_COST   = 80;  // penalty price — return to base is always cheaper
const EXTRA_WATER_COST    = WATER_BUY_COST; // same as buy_water() from code — slight profit on pumpkins

const xOverlay   = document.getElementById('extra-overlay');
const xBuyEnergy = document.getElementById('x-buy-energy');
const xBuyWater  = document.getElementById('x-buy-water');
const xBaseHint  = document.getElementById('x-base-hint');

function buyEmergencyEnergy() {
  if (eco.gold < EXTRA_ENERGY_COST) return;
  eco.gold  -= EXTRA_ENERGY_COST;
  eco.energy = Math.min(ENERGY_MAX, eco.energy + EXTRA_ENERGY_AMOUNT);
  updateStats();
  consolePrint('[SERVICE] Emergency energy delivered', 'console-info');
  updateExtraButtons();
}

function buyEmergencyWater() {
  if (eco.gold < EXTRA_WATER_COST) return;
  droneActions.buy_water(1);
  consolePrint('[SERVICE] Emergency water purchased', 'console-info');
  updateExtraButtons();
}

function buyTankUpgrade() {
  if (upgTank >= UPG_MAX) return;
  const cost = upgCost(UPG_TANK_BASE_COST, upgTank);
  if (eco.gold < cost) return;
  eco.gold -= cost;
  upgTank++;
  TANK_MAX = TANK_MAX_BASE + upgTank * UPG_TANK_STEP;
  updateStats();
  updateExtraButtons();
  consolePrint(`[UPGRADE] Tank capacity → ${TANK_MAX} (Lv ${upgTank})`, 'console-info');
}

function buyEnergyUpgrade() {
  if (upgEnergy >= UPG_MAX) return;
  const cost = upgCost(UPG_ENERGY_BASE_COST, upgEnergy);
  if (eco.gold < cost) return;
  eco.gold -= cost;
  upgEnergy++;
  ENERGY_MAX = ENERGY_MAX_BASE + upgEnergy * UPG_ENERGY_STEP;
  updateStats();
  updateExtraButtons();
  consolePrint(`[UPGRADE] Battery capacity → ${ENERGY_MAX} (Lv ${upgEnergy})`, 'console-info');
}

function updateUpgradeUI() {
  // ── Tank upgrade ──────────────────────────────────────────
  const tankCur  = TANK_MAX_BASE + upgTank * UPG_TANK_STEP;
  const tankNext = tankCur + UPG_TANK_STEP;
  const tankCost = upgCost(UPG_TANK_BASE_COST, upgTank);
  const maxTank  = upgTank >= UPG_MAX;

  const tankBar = document.getElementById('upg-tank-bar');
  if (tankBar) tankBar.style.width = (upgTank / UPG_MAX * 100) + '%';

  const tankLvlEl = document.getElementById('upg-tank-lvl');
  if (tankLvlEl) tankLvlEl.textContent = `Lv ${upgTank} / ${UPG_MAX}`;

  const tankStatEl = document.getElementById('upg-tank-stat');
  if (tankStatEl) tankStatEl.innerHTML = maxTank
    ? `${tankCur} <span class="upg-max-badge">MAX</span>`
    : `${tankCur} <span class="upg-arrow">→</span> <strong>${tankNext}</strong>`;

  const tankCostEl = document.getElementById('upg-tank-cost');
  if (tankCostEl) tankCostEl.textContent = maxTank ? '' : `${tankCost} 💰`;

  const tankBtn = document.getElementById('upg-tank-btn');
  if (tankBtn) {
    tankBtn.disabled    = maxTank || eco.gold < tankCost;
    tankBtn.textContent = maxTank ? 'MAX' : 'Upgrade';
  }

  // ── Energy upgrade ────────────────────────────────────────
  const energyCur  = ENERGY_MAX_BASE + upgEnergy * UPG_ENERGY_STEP;
  const energyNext = energyCur + UPG_ENERGY_STEP;
  const energyCost = upgCost(UPG_ENERGY_BASE_COST, upgEnergy);
  const maxEnergy  = upgEnergy >= UPG_MAX;

  const energyBar = document.getElementById('upg-energy-bar');
  if (energyBar) energyBar.style.width = (upgEnergy / UPG_MAX * 100) + '%';

  const energyLvlEl = document.getElementById('upg-energy-lvl');
  if (energyLvlEl) energyLvlEl.textContent = `Lv ${upgEnergy} / ${UPG_MAX}`;

  const energyStatEl = document.getElementById('upg-energy-stat');
  if (energyStatEl) energyStatEl.innerHTML = maxEnergy
    ? `${energyCur} <span class="upg-max-badge">MAX</span>`
    : `${energyCur} <span class="upg-arrow">→</span> <strong>${energyNext}</strong>`;

  const energyCostEl = document.getElementById('upg-energy-cost');
  if (energyCostEl) energyCostEl.textContent = maxEnergy ? '' : `${energyCost} 💰`;

  const energyBtn = document.getElementById('upg-energy-btn');
  if (energyBtn) {
    energyBtn.disabled    = maxEnergy || eco.gold < energyCost;
    energyBtn.textContent = maxEnergy ? 'MAX' : 'Upgrade';
  }
}

function updateExtraButtons() {
  const atBase = game.drone.x === 0 && game.drone.y === 0;
  xBuyEnergy.disabled = atBase || eco.gold < EXTRA_ENERGY_COST;
  xBuyWater.disabled  = eco.gold < EXTRA_WATER_COST;
  xBaseHint.classList.toggle('hidden', !atBase);
  const goldEl = document.getElementById('x-gold-val');
  if (goldEl) goldEl.textContent = eco.gold;
  updateUpgradeUI();
}

function openExtra() {
  updateExtraButtons();
  xOverlay.classList.remove('hidden');
}

function closeExtra() {
  xOverlay.classList.add('hidden');
}

document.getElementById('extra-btn').addEventListener('click', openExtra);
document.getElementById('x-close-btn').addEventListener('click', closeExtra);
xBuyEnergy.addEventListener('click', buyEmergencyEnergy);
xBuyWater.addEventListener('click', buyEmergencyWater);
document.getElementById('upg-tank-btn').addEventListener('click', buyTankUpgrade);
document.getElementById('upg-energy-btn').addEventListener('click', buyEnergyUpgrade);
xOverlay.addEventListener('click', e => { if (e.target === xOverlay) closeExtra(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeExtra(); });

// ────────────────────────────────────────────────────────────
//  API PANEL TOOLTIPS
// ────────────────────────────────────────────────────────────
(function () {
  const tip = document.createElement('div');
  tip.id = 'api-tooltip';
  tip.className = 'hidden';
  document.body.appendChild(tip);

  function posTip(cx, cy) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = cx + 13, y = cy + 16;
    if (x + w > window.innerWidth  - 6) x = cx - w - 8;
    if (y + h > window.innerHeight - 6) y = cy - h - 8;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }

  const panel = document.getElementById('api-panel');
  let activeRow = null;

  panel.addEventListener('mousemove', e => {
    const row = e.target.closest('.api-fn-row');
    if (row && row.dataset.desc) {
      if (row !== activeRow) {
        activeRow = row;
        tip.textContent = row.dataset.desc;
        tip.classList.remove('hidden');
      }
      posTip(e.clientX, e.clientY);
    } else {
      activeRow = null;
      tip.classList.add('hidden');
    }
  });

  panel.addEventListener('mouseleave', () => {
    activeRow = null;
    tip.classList.add('hidden');
  });
}());

// ────────────────────────────────────────────────────────────
//  INIT
// ────────────────────────────────────────────────────────────
const savedSettings = loadSettingsLS();
applySettings(savedSettings);
consolePrint('// Welcome to Farm Drone!', 'console-info');
consolePrint('// Write C++ in the editor and press Run (Ctrl+Enter)', 'console-info');
consolePrint('// Load examples via the Examples button (top right)', 'console-info');
