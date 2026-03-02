// ================================================================
//  drone_api.h — Drone API for C++ / WebAssembly
//  This file is automatically prepended to your code before compilation.
//  You do not need to write #include; it is already included.
// ================================================================

// ── Directions ────────────────────────────────────────────────
enum class Direction {
    NORTH = 0,
    EAST  = 1,
    SOUTH = 2,
    WEST  = 3
};

// ── Cell states ───────────────────────────────────────────────
enum class CellState {
    EMPTY   = 0,
    TILLED  = 1,
    PLANTED = 2,
    GROWING = 3,
    READY   = 4,
    BASE    = 5   // drone landing pad — farming actions are no-ops here
};

// ── Crops ─────────────────────────────────────────────────────
enum class CropType {
    WHEAT   = 0,
    POTATO  = 1,
    PUMPKIN = 2
};

// ── Field size (injected by server) ───────────────────────────
#define GRID_W  __GRID_W__
#define GRID_H  __GRID_H__

// ── Drone functions (C ABI — parameters are always int) ───────
#ifdef __cplusplus
extern "C" {
#endif

void move(int dir);
void move_north();
void move_south();
void move_east();
void move_west();

void till();
void plant(int crop);
void harvest();
void water();

void drone_wait(int ticks);

int get_state();
int get_state_at(int x, int y);
int get_crop_type();
int get_crop_type_at(int x, int y);
int get_water_level();
int get_water_level_at(int x, int y);
int get_tank();
int get_max_tank();
int get_energy();
int get_max_energy();
int is_at_base();

int get_gold();
int get_seeds(int crop);
void buy_seeds(int crop, int count);
void buy_water(int packs);

int get_x();
int get_y();
int get_ticks();
int get_score();

void print_int(int val);

#ifdef __cplusplus
}
#endif

// ── C++ wrappers with enum class ───────────────────────────────
#ifdef __cplusplus

// Overloads: accept enum class, pass int to C functions
inline void move(Direction dir)                  { move(static_cast<int>(dir)); }
inline void plant(CropType crop)                 { plant(static_cast<int>(crop)); }
inline int  get_seeds(CropType crop)             { return get_seeds(static_cast<int>(crop)); }
inline void buy_seeds(CropType crop, int count)  { buy_seeds(static_cast<int>(crop), count); }

// get_state() returns CellState — avoid comparing int with enum class directly
inline CellState get_cell_state()              { return static_cast<CellState>(get_state()); }
inline CellState get_cell_state(int x, int y)  { return static_cast<CellState>(get_state_at(x, y)); }

// get_crop_type() returns CropType
inline CropType get_crop()             { return static_cast<CropType>(get_crop_type()); }
inline CropType get_crop(int x, int y) { return static_cast<CropType>(get_crop_type_at(x, y)); }

// Coordinate overloads
inline int get_state(int x, int y)        { return get_state_at(x, y); }
inline int get_crop_type(int x, int y)    { return get_crop_type_at(x, y); }
inline int get_water_level(int x, int y)  { return get_water_level_at(x, y); }

// Aliases
inline void wait(int ticks)   { drone_wait(ticks); }
inline void print(int val)    { print_int(val); }

#endif // __cplusplus
