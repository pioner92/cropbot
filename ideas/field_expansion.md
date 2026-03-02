# Idea: Field Expansion

## Concept

A purchasable upgrade in the Extra modal. Each level adds +1 column on the right and +1 row
on the bottom. The field is always square. The base stays in the corner at (0,0).

---

## Expansion tiers

| Level   | Size        | New cells | Cost   |
|---------|-------------|-----------|--------|
| 0 start | 10×10 = 99  | —         | —      |
| 1       | 11×11 = 120 | +21       | 500    |
| 2       | 12×12 = 143 | +23       | 1 200  |
| 3       | 13×13 = 168 | +25       | 2 700  |
| 4       | 14×14 = 195 | +27       | 6 000  |
| 5       | 15×15 = 224 | +29       | 13 000 |

Pricing is aggressive — each expansion only pays off if the algorithm actually covers the
whole field.

New cells are added as EMPTY — the player must till them. No free head start.

---

## Problem: GRID_W/H in WASM

`drone_api.h` defines `GRID_W` and `GRID_H` as compile-time `#define` macros, substituted
by the server at compile time. If the field expands at runtime, the compiled WASM still
thinks the field is 10×10.

**Solution:** add two query functions (0 ticks):
```cpp
int get_grid_w();  // current field width
int get_grid_h();  // current field height
```
The `GRID_W`/`GRID_H` macros remain as the values at compile time.
A smart player writes an adaptive algorithm using `get_grid_w()` — which is an interesting
challenge in itself.

---

## Rendering

The canvas stays the same size. `CELL` becomes dynamic:
```js
let CELL = Math.floor(CANVAS_GRID_PX / GRID_W); // recalculated on expansion
```
At 15×15 cells will be slightly smaller but still readable.
Purchase is only allowed when the drone is stopped — to avoid a jump in the drone animation.

---

## What needs to change in the code

1. `GRID_W` / `GRID_H` → `let` instead of `const`, add `_BASE` versions
2. `initGrid()` — reset field size on Reset (to be decided)
3. `game.grid` — expand without full recreation (append rows/columns to existing array)
4. Renderer — dynamic `CELL`, recalculate on expansion
5. `drone_api.h` + `game.js` + `wasm-worker.js` — add `get_grid_w()` / `get_grid_h()`
6. Extra modal — new "Field Expansion" upgrade card

---

## Open questions

- **Does Reset restore the field size?** Probably yes — otherwise saving purchased expansions
  adds significant complexity
- **Purchase only when the game is stopped** — to avoid drone animation jumping
