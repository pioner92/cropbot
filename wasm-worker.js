'use strict';

// ================================================================
//  wasm-worker.js  —  Web Worker
//  Запускает скомпилированный WASM модуль.
//  Общается с главным потоком через SharedArrayBuffer + Atomics.
// ================================================================

// ── SAB layout (Int32Array, 8 ячеек) ────────────────────────────
//  [0] ACTION   — тип действия (worker пишет, main читает, main сбрасывает в 0)
//  [1] ARG0     — первый аргумент
//  [2] ARG1     — второй аргумент
//  [3] RESULT   — результат (main пишет, worker читает)
//  [4] RESPONSE — сигнал завершения (main ставит 1, worker ждёт здесь)
//  [5] READY    — worker ставит 1 когда готов

const IDX = { ACTION:0, ARG0:1, ARG1:2, RESULT:3, RESPONSE:4, READY:5 };

// ── Коды действий (должны совпадать с game.js) ──────────────────
const ACT = {
  MOVE:1, MOVE_NORTH:2, MOVE_SOUTH:3, MOVE_EAST:4, MOVE_WEST:5,
  TILL:6, PLANT:7, HARVEST:8, WATER:9, DRONE_WAIT:10,
  GET_STATE:11, GET_STATE_AT:12, GET_CROP_TYPE:13, GET_CROP_TYPE_AT:14,
  GET_WATER_LEVEL:15, GET_WATER_LEVEL_AT:16, GET_TANK:17,
  GET_GOLD:18, GET_SEEDS:19, BUY_SEEDS:20,
  GET_X:21, GET_Y:22, GET_TICKS:23, GET_SCORE:24,
  PRINT_INT:25, BUY_WATER:26, GET_ENERGY:27, GET_MAX_ENERGY:28, IS_AT_BASE:29,
};

let ctrl = null; // Int32Array view of SAB

// Синхронный вызов в главный поток (блокирует Worker до ответа)
function callMain(action, arg0 = 0, arg1 = 0) {
  Atomics.store(ctrl, IDX.RESPONSE, 0);
  Atomics.store(ctrl, IDX.ARG0,     arg0);
  Atomics.store(ctrl, IDX.ARG1,     arg1);
  Atomics.store(ctrl, IDX.ACTION,   action);

  // Будим главный поток
  Atomics.notify(ctrl, IDX.ACTION, 1);

  // Блокируемся до получения ответа (допустимо только в Worker)
  Atomics.wait(ctrl, IDX.RESPONSE, 0);

  return Atomics.load(ctrl, IDX.RESULT);
}

// ── Импорты для WASM модуля ──────────────────────────────────────
function makeDroneEnv() {
  return {
    move:               (d)   => { callMain(ACT.MOVE, d); },
    move_north:         ()    => { callMain(ACT.MOVE_NORTH); },
    move_south:         ()    => { callMain(ACT.MOVE_SOUTH); },
    move_east:          ()    => { callMain(ACT.MOVE_EAST); },
    move_west:          ()    => { callMain(ACT.MOVE_WEST); },
    till:               ()    => { callMain(ACT.TILL); },
    plant:              (c)   => { callMain(ACT.PLANT, c); },
    harvest:            ()    => { callMain(ACT.HARVEST); },
    water:              ()    => { callMain(ACT.WATER); },
    drone_wait:         (n)   => { callMain(ACT.DRONE_WAIT, n); },
    get_state:          ()    => callMain(ACT.GET_STATE),
    get_state_at:       (x,y) => callMain(ACT.GET_STATE_AT, x, y),
    get_crop_type:      ()    => callMain(ACT.GET_CROP_TYPE),
    get_crop_type_at:   (x,y) => callMain(ACT.GET_CROP_TYPE_AT, x, y),
    get_water_level:    ()    => callMain(ACT.GET_WATER_LEVEL),
    get_water_level_at: (x,y) => callMain(ACT.GET_WATER_LEVEL_AT, x, y),
    get_tank:           ()    => callMain(ACT.GET_TANK),
    get_energy:         ()    => callMain(ACT.GET_ENERGY),
    get_max_energy:     ()    => callMain(ACT.GET_MAX_ENERGY),
    is_at_base:         ()    => callMain(ACT.IS_AT_BASE),
    get_gold:           ()    => callMain(ACT.GET_GOLD),
    get_seeds:          (c)   => callMain(ACT.GET_SEEDS, c),
    buy_seeds:          (c,n) => { callMain(ACT.BUY_SEEDS, c, n); },
    buy_water:          (n)   => { callMain(ACT.BUY_WATER, n); },
    get_x:              ()    => callMain(ACT.GET_X),
    get_y:              ()    => callMain(ACT.GET_Y),
    get_ticks:          ()    => callMain(ACT.GET_TICKS),
    get_score:          ()    => callMain(ACT.GET_SCORE),
    print_int:          (v)   => { callMain(ACT.PRINT_INT, v); },
  };
}

// Заглушки для WASI и прочих системных вызовов
function makeWasiStubs() {
  const stub0 = () => 0;
  return {
    proc_exit: () => {},
    fd_write: stub0, fd_read: stub0, fd_seek: stub0, fd_close: stub0,
    fd_fdstat_get: stub0, fd_prestat_get: stub0, fd_prestat_dir_name: stub0,
    environ_sizes_get: stub0, environ_get: stub0,
    args_sizes_get: stub0, args_get: stub0,
    clock_time_get: stub0, clock_res_get: stub0,
    random_get: stub0, path_open: stub0, path_filestat_get: stub0,
    sched_yield: stub0, poll_oneoff: stub0,
  };
}

// Динамически строим объект imports под то, что нужно конкретному модулю
function buildImports(wasmModule) {
  const droneEnv  = makeDroneEnv();
  const wasiStubs = makeWasiStubs();

  const result = {};
  const needed = WebAssembly.Module.imports(wasmModule);

  for (const { module: mod, name, kind } of needed) {
    if (!result[mod]) result[mod] = {};

    if (mod === 'env' && droneEnv[name] !== undefined) {
      result[mod][name] = droneEnv[name];
    } else if (mod === 'wasi_snapshot_preview1' && wasiStubs[name] !== undefined) {
      result[mod][name] = wasiStubs[name];
    } else if (kind === 'function') {
      result[mod][name] = () => 0; // unknown function stub
    } else if (kind === 'global') {
      result[mod][name] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
    } else if (kind === 'memory') {
      result[mod][name] = new WebAssembly.Memory({ initial: 16 });
    } else if (kind === 'table') {
      result[mod][name] = new WebAssembly.Table({ element: 'anyfunc', initial: 0 });
    }
  }
  return result;
}

// ── Обработчик сообщений от главного потока ─────────────────────
self.onmessage = async (e) => {
  if (e.data.type !== 'start') return;

  const sab       = e.data.sab;
  const wasmBytes = e.data.wasm;
  ctrl = new Int32Array(sab);

  try {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const imports    = buildImports(wasmModule);
    const instance = await WebAssembly.instantiate(wasmModule, imports);

    // Сигнализируем: Worker готов
    Atomics.store(ctrl, IDX.READY, 1);
    Atomics.notify(ctrl, IDX.READY, 1);

    // Запускаем main() — блокируется навсегда через while(1)
    const fn = instance.exports._main || instance.exports.main;
    if (!fn) throw new Error('Функция main() не найдена в скомпилированном коде');
    fn();

    // Если main() вернул управление — сообщаем
    self.postMessage({ type: 'done' });

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
