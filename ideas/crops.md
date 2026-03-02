# New Crop Ideas

## All crops — final table

| Crop     | Ticks     | Sell | Seed | Profit | Gold/tick | Supplier cost | Unlock       |
|----------|-----------|------|------|--------|-----------|---------------|--------------|
| Wheat    | 8+12=20   | 2    | 1    | 1      | 0.050     | free          | from start   |
| Potato   | 14+20=34  | 6    | 2    | 4      | 0.118     | free          | from start   |
| Pumpkin  | 25+40=65  | 10   | 5    | 5      | 0.077     | 80g           | early game   |
| Corn     | 18+27=45  | 9    | 3    | 6      | 0.133     | 280g          | mid game     |
| Mushroom | 15+25=40  | 10   | 4    | 6      | 0.150     | 650g          | mid-late     |
| Coffee   | 40+80=120 | 35   | 20   | 15     | 0.125     | 1500g         | end game     |

**Supplier cost rationale:**
- Pumpkin 80g — ~135 ticks of potato farming. First luxury: high absolute value, good for lazy scripts
- Corn 280g — ~475 ticks of potato. Real efficiency upgrade (+13% over potato)
- Mushroom 650g — requires smart watering algorithm to beat simpler crops
- Coffee 1500g — endgame investment, highest absolute profit per harvest (15g)

---

## Unlock system — Supplier mechanic

Crops are unlocked by purchasing a **Supplier** in the Extra panel.

```
Suppliers
─────────────────────────────────────────
🌾 Wheat Supplier      [unlocked]
🥔 Potato Supplier     [unlocked]
🎃 Pumpkin Supplier    [Buy — 80g]
🌽 Corn Supplier       [Buy — 280g]
🍄 Mushroom Supplier   [Buy — 650g]
☕ Coffee Supplier     [Buy — 1500g]
```

- Locked crops are hidden in the seed shop until supplier is purchased
- `plant(CropType::CORN)` silently no-ops if Corn Supplier not purchased (WASM safety)
- Suppliers persist until reset

---

## Crop details

### Pumpkin — slow but high value
- Good for simple "plant and forget" algorithms
- Lower g/tick than Potato but higher absolute value per harvest
- First crop players will want to unlock

### Corn — real efficiency step
- Clear improvement over Potato (+13% g/tick)
- No special mechanic, pure numbers upgrade
- Fills the gap: Potato → Corn → Mushroom

### Mushroom — inverted water mechanic
- Grows only if `water_level > 40`, otherwise pauses
- Requires **preventive** watering instead of reactive ("water when low")
- Forces players to rethink their watering algorithm entirely
- Best g/tick of all crops when water is managed correctly

### Coffee — endgame, water-intensive
- Ticks: 120 (40+80) — longest cycle in the game
- Requires ~5-6 waterings per cycle
- Highest absolute profit per harvest (15g)
- Motivates optimizing watering routes and tank upgrades
- Gold/tick slightly below Mushroom, but much higher gold per harvest

### Strawberry — future idea, multi-harvest
- Ticks to first harvest: ~15, regrows in ~10 ticks (up to 3 total harvests, then dies)
- After harvest() → returns to GROWING (not EMPTY)
- Requires REGROW state or per-cell harvest counter
- Most complex to implement — save for last

---

## Implementation priority

1. **Corn** — simple, fills the gap, minimal engine changes
2. **Mushroom** — most interesting mechanic, changes algorithm logic
3. **Coffee** — endgame motivation, only new numbers
4. **Supplier unlock system** — Extra panel section, `eco.unlockedCrops` set
5. **Strawberry** — save for last, requires new cell state
