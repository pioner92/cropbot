# CLAUDE.md — Farm Drone Game

Instructions for Claude when working on this project.

---

## What is this project

A browser-based farming game inspired by *Farmer Was Replaced*. The player programs a drone in C++ directly in the browser. The code is compiled via Emscripten into WebAssembly and runs in a Web Worker.

Only one execution mode — real C++ via the server. If the server is not running, the game does not work.

---

## Files

```
index.html       — markup, styles, API panel
game.js          — game engine, renderer, WASM engine
server.js        — Node.js/Express server: POST /compile → emcc → .wasm
drone_api.h      — drone header, automatically prepended to user code
wasm-worker.js   — Web Worker: runs WASM, SAB + Atomics for communication
package.json     — dependency: express
CLAUDE.md        — this file
```

**Run:** `node server.js` → `http://localhost:3000`

---

## Architecture

### ▶ Run — C++ compilation via Emscripten
```
User code
  → POST /compile (server.js)
  → emcc → .wasm bytes
  → Web Worker (wasm-worker.js)
      WASM _main() blocks via Atomics.wait()
      ↕ SharedArrayBuffer [ACTION, ARG0, ARG1, RESULT, RESPONSE, READY]
  → wasmActionLoop() on main thread (Atomics.waitAsync)
  → execWasmAction() → droneActions{}
  → wasmReply() — unblocks Worker
```
- `main()` returned → silent Worker restart without recompilation
- `wasmLoopGen` — generation counter, kills old `wasmActionLoop` on restart
- **Recommended: `while(1)`** — no restarts at all

---

## game.js structure (sections marked with `// ────`)

| Section | Description |
|---|---|
| `CONSTANTS` | `GRID_W/H=10`, `State`, `Dir`, `CropType`, colors, timings |
| `GAME STATE` | `game{}`, `eco{}`, `initGrid()`, `growTick()` |
| `RENDERER` | Canvas 600×600, `render()`, drone animation |
| `DRONE ACTIONS` | `droneActions{}` — bridge between engine and game |
| `EXECUTION ENGINE` | `doTick()`, `stopExecution()`, `gameLoop()`, energy |
| `WASM ENGINE` | `ACT`, `IDX`, `execWasmAction()`, `wasmActionLoop()`, `_spawnWasmWorker()`, `launchWasm()`, `compileAndRun()` |
| `SAMPLE CODE` | `SAMPLES{}` — code examples |
| `MONACO EDITOR` | Monaco CDN initialization |
| `UI EVENT HANDLERS` | Run/Stop/Reset buttons, slider, dropdown |

---

## Drone API

```cpp
// Movement (1 tick)
void move(Direction dir);
void move_north/south/east/west();

// Farming (1 tick)
void till();
void plant(CropType crop);
void harvest();
void water();
void wait(int ticks);     // alias for drone_wait

// State queries (0 ticks)
CellState get_cell_state();
CellState get_cell_state(int x, int y);
CropType  get_crop();
CropType  get_crop(int x, int y);
int get_water_level();
int get_water_level(int x, int y);
int get_tank();
int get_energy();      // current battery charge
int get_max_energy();  // maximum (120)
int is_at_base();      // 1 if drone is at base (0,0), else 0
int get_x();  int get_y();
int get_ticks();  int get_score();

// Economy (0 ticks)
int  get_gold();
int  get_seeds(CropType crop);
void buy_seeds(CropType crop, int n);
void buy_water(int packs);
void print(int val);
```

### Types (enum class)

```cpp
enum class Direction  { NORTH, EAST, SOUTH, WEST };
enum class CellState  { EMPTY, TILLED, PLANTED, GROWING, READY, BASE };
enum class CropType   { WHEAT, POTATO, PUMPKIN };
```

Usage: `Direction::SOUTH`, `CellState::READY`, `CropType::WHEAT`

### Crops

| Type | Growth time | Sell price | Seed cost |
|---|---|---|---|
| `CropType::WHEAT`   | 8+12 ticks  | 2 gold  | 1 gold |
| `CropType::POTATO`  | 14+20 ticks | 6 gold  | 2 gold |
| `CropType::PUMPKIN` | 25+40 ticks | 10 gold | 5 gold |

**Water:** cell starts at 50 on planting, -2/tick. At 0 — growth pauses.
**Tank:** max 50, +8/tick at base. `water()` costs 15 units, gives the cell +50.
**Starting resources:** 50 gold, 10 wheat / 5 potato / 2 pumpkin seeds.
**Grid:** `GRID_W = GRID_H = 10`

### Base (0, 0)

- Cell with type `CellState::BASE`
- At base: farming actions (`till`, `plant`, `harvest`, `water`) are no-ops
- At base: auto-recharge +10 energy and +8 water tank per tick
- `is_at_base()` returns 1 when the drone is at base

---

## How to add a new drone function

Must update **3 places** in sync:

**1. `drone_api.h`** — declaration:
```cpp
extern "C" { void fertilize(); }          // inside extern "C"
// and/or C++ wrapper outside if enum parameters are needed
```

**2. `game.js`** — ACT constant + logic:
```js
// In const ACT { ... }:
FERTILIZE: 30,

// In execWasmAction() switch:
case ACT.FERTILIZE: droneActions.fertilize(); break;

// In droneActions{}:
fertilize() { /* logic */ },
```

**3. `wasm-worker.js`** — in `makeDroneEnv()`:
```js
fertilize: () => { callMain(ACT.FERTILIZE); },
```

Make sure the numeric code `ACT.FERTILIZE` is the same in both `game.js` and `wasm-worker.js`.

---

## How to add a new code example

In `game.js`, the `SAMPLES` object:
```js
SAMPLES['Name'] = `// C++ code with while(1)`;
```

---

## Game parameters

```js
// Top of game.js, CONSTANTS section:
const GRID_W = 10, GRID_H = 10;  // grid size
const CELL   = 30;                // px per cell

// Crops — CROPS[] array:
{ time1: 8, time2: 12, value: 2, seedCost: 1, ... }  // WHEAT

// Water:
WATER_START = 50, WATER_DRAIN = 2, TANK_MAX = 50
WATER_COST = 15, WATER_GIVE = 50, WATER_REFILL_RATE = 8
WATER_BUY_PACK = 50, WATER_BUY_COST = 10  // slight profit on pumpkins (~1.28x ROI)

// Energy (battery):
ENERGY_MAX = 120, ENERGY_START = 120, ENERGY_ACTION_COST = 1, ENERGY_CHARGE_RATE = 10
// Auto-recharge at base (0,0), +10/tick. wait() does not consume energy.
```

---

## Known limitations

- Real C++17 via Emscripten only — JS interpreter has been removed
- `print()` accepts `int` only
- Single drone, no multi-drone support
- Monaco loads from CDN (cloudflare 0.44.0) — no offline mode
- Dependency: `express` (run `npm install` before first launch)
