# New Crop Ideas

## Current crops (for context)

| Crop    | Ticks    | Sell | Seed | Profit | Gold/tick |
|---------|----------|------|------|--------|-----------|
| Wheat   | 8+12=20  | 2    | 1    | 1      | 0.050     |
| Potato  | 14+20=34 | 6    | 2    | 4      | 0.118     |
| Pumpkin | 25+40=65 | 10   | 5    | 5      | 0.077     |

---

## New crops

### Corn — fills the gap between Potato and Pumpkin
- Ticks: ~50 (20+30)
- Sell: 8 gold, seed: 3 gold → profit 5
- Gold/tick: ~0.10
- No special mechanic — just a needed progression step
- Needed because there is currently a large gap between potato (0.118) and pumpkin (0.077)

### Coffee — endgame, water-intensive crop
- Ticks: ~120 (40+80)
- Sell: 35 gold, seed: 20 gold → profit 15
- Gold/tick: 0.125 (best in the game if watering is optimized)
- Special: requires ~5 waterings per cycle, highest absolute profit
- Motivates players to optimize watering routes

### Mushroom — inverted water mechanic
- Ticks: ~40 (15+25)
- Sell: ~10 gold, seed: 4 gold → profit 6
- Special: grows only if `water_level > 40`, otherwise growth pauses
- Requires preventive watering (keep level high) instead of reactive ("water when low")
- Changes the drone's algorithm logic entirely

### Strawberry — multi-harvest crop
- Ticks to first harvest: ~15, then regrows in ~10 ticks (up to 2 more times)
- After harvest() does not go to EMPTY — returns to GROWING (up to 3 harvests total, then dies)
- Special: the standard "till → plant → harvest" loop no longer works
- Requires a new REGROW state or a harvest counter per cell
- Most complex to implement

---

## Implementation priority

1. **Corn** — simple, fills the gap, minimal engine changes
2. **Mushroom** — most interesting mechanic, changes algorithm logic
3. **Coffee** — endgame motivation, only new numbers
4. **Strawberry** — save for last, requires new cell state in the engine
