# GAME_SPEC.md — Domino Tetris (All Fives-inspired)

## 0) Summary

Domino Tetris is a single-player endless, web-based falling-block game inspired by classic Tetris, but using 2-cell Domino tiles (0:0 to 6:6). Rows clear like Tetris. However:

- Score is earned only when a cleared row’s pip total is a positive multiple of 5 (“5Mult”).
- The player has Lives that go up/down based on cleared row quality.
- A Streak system can double score (max ×2), and special handling applies to double-row clears.

Target implementation is plain HTML/CSS/JS (e.g., `index.html`, `styles.css`, `app.js`), adapting a simple DOM-grid Tetris baseline.

## 1) Definitions

- **Cell / Block**: A single square in the grid.
- **Domino tile**: A piece made of exactly 2 cells, each cell has a pip value 0..6.
- **5Mult row**: A cleared row whose sum of pip values is divisible by 5 AND > 0.
  - Formal: `rowSum > 0 && rowSum % 5 === 0`
  - Note: `rowSum === 0` is treated as NonMult (penalty), even though mathematically 0 is divisible by 5.
- **NonMult row**: Any cleared row that is not a 5Mult row (including sum = 0).
- **Lock**: The moment a falling piece becomes fixed (“taken”) on the board.
- **Streak**: A state that, when active, doubles score on qualifying clears (max ×2).

## 2) Platform & Scope

- **Platform**: Web (desktop keyboard prototype).
- **Mode**: Single-player endless, high-score.
- **Audio**: None in V0.

## 3) Board

- Grid size: **8 columns × 16 rows**.
- Coordinates (0-based):
  - Top-left cell = `(row=0, col=0)`
  - Bottom-right cell = `(row=15, col=7)`
- Index mapping (if using a 1D array `squares[]`):
  - `index = row * width + col`
  - `width = 8`, `height = 16`

## 4) Domino Tile Set & Random Generation

### Tile universe (Double-Six set)

- All unique dominoes from 0:0 to 6:6, 28 unique tiles.
- Represent each tile as `{a, b}` where `0 <= a <= b <= 6`.

### “28-bag” distribution

- Create a bag containing one instance of each of the 28 unique tiles.
- Shuffle the bag (Fisher–Yates recommended).
- Draw sequentially until empty; then refill and reshuffle; repeat infinitely.

### Spawn pip ordering rule

- Pieces spawn horizontally, with smaller value on the left:
  - left cell pip = `min(a,b)`
  - right cell pip = `max(a,b)`
- After spawn, pip values follow their cells through movement/rotation (no re-sorting).

## 5) Spawn Rules

- Spawn location (0-based):
  - Two horizontal cells at `row 0, col 3` and `col 4`
  - i.e., `(0,3)` and `(0,4)`
- Default orientation: Horizontal.
- Game over immediately if spawn placement collides with taken cells.

## 6) Movement, Gravity, and Locking

### Gravity

- Initial fall interval: `1000ms`.
- Progressive gravity:
  - Track `totalRowsCleared` (counts all cleared rows, both 5Mult and NonMult).
  - Every time `totalRowsCleared` crosses a multiple of 10, reduce interval by `50ms`.
  - Minimum interval: `150ms`.
  - Example: `interval = max(150, 1000 - 50 * floor(totalRowsCleared / 10))`.

### Horizontal movement

- One cell per input (key repeat allowed by browser).
- Blocked if either cell would leave the board or overlap a taken cell.

### Soft drop

- Holding `S` or `DownArrow` accelerates downward movement (implementation detail is flexible):
  - Either temporarily reduce interval, or repeatedly call `moveDown()` faster while held.
- Soft drop does not instantly lock; locking still occurs only when the piece can’t move further down.

### Hard drop

- Press `Space` or `RightShift`:
  - Move piece down until the next step would collide/out-of-bounds.
  - Then immediately lock.

### Locking rule (V0)

- Instant lock (no lock delay).
- A piece locks when it cannot move down by 1 row due to:
  - bottom boundary, or
  - collision with taken cells.

## 7) Rotation

### Rotation direction

- Rotate clockwise only.

### Pivot rule (Anchor Pivot, V0)

Use an “anchor” cell depending on orientation:

- If piece is horizontal, the left cell is the anchor.
- If piece is vertical, the bottom cell is the anchor.

Rotation mapping (clockwise) with pip-following:

- Horizontal: `[Anchor][Other]` → Vertical with the other cell above anchor.
- Vertical: cell-above + anchor → Horizontal with the above cell to the right of anchor.

Pip values stay attached to their respective cells as they move.

### Wall-kicks (minimal)

When attempting rotation, try these placements in order for the rotated shape:

1. rotate in place
2. rotate with `x - 1`
3. rotate with `x + 1`
4. rotate with `y + 1`

Notes:

- `y + 1` exists to allow rotation at/near the top (row 0) when anchor rotation would otherwise go out of bounds.
- If none of the 4 attempts fit (in-bounds + not colliding with taken), rotation is canceled.

## 8) Line Clear Detection

After a lock:

- Identify any full rows (all 8 cells taken).
- Because pieces are 2 cells, at most 2 rows can clear per lock.
- If 1 row clears → “Single clear” resolution.
- If 2 rows clear → “Double clear” resolution (special rules).

Row pip sum:

- `rowSum = sum(pips of the 8 taken cells in that row)`
- For vertical dominoes spanning two rows, each row counts only the pip value of the cell inside that row.

## 9) Score Rules

### Base score per row

- If row is 5Mult → `rowBaseScore = rowSum`
- Else (NonMult) → `rowBaseScore = 0`

### Multipliers (max ×2)

Score multipliers never exceed ×2.

#### Single clear multiplier

- If `streakActiveBeforeLock === true` and the row is 5Mult → apply ×2.
- Otherwise ×1.

#### Double clear multiplier (special)

If at least one of the cleared rows is 5Mult, then:

- apply a ×2 multiplier to the scoring of the entire clear event (i.e., any 5Mult row scores are doubled)
- this is true even if the streak was previously inactive
- (NonMult rows still score 0, so doubling doesn’t matter for them)

If both cleared rows are NonMult:

- multiplier irrelevant (score remains 0)

## 10) Lives Rules

- Start with 10 lives.
- Lives change is computed per cleared row, then applied simultaneously per lock.

Per cleared row:

- 5Mult row: +2 lives
- NonMult row: -1 life

Double clear application:

- Compute `netLivesDelta = sum(delta for each cleared row)`
- Apply once (simultaneous) so ordering cannot cause premature death.

Game over from lives:

- If lives becomes `< 0`, game ends immediately (after applying the clear results).

## 11) Streak Rules (Score-only)

- Streak affects score only, never lives.
- State: `streakActive` boolean.

Update logic after each lock:

- If the lock clears at least one 5Mult row (including mixed double clears):
  - `streakActive` becomes `true` (starts or continues)
- Else (no clears OR only NonMult clears):
  - `streakActive` becomes `false` (resets)

Scoring interaction:

- Single clear: streak (if active before lock) doubles qualifying score.
- Double clear: if at least one 5Mult row, the clear event uses ×2 regardless of prior streak, and streak becomes active for next lock.

## 12) Game Over Conditions

Game ends immediately when either is true:

- Spawn collision: a newly spawned piece overlaps taken cells.
- Lives `< 0` after resolving a lock (including line clears).

## 13) Modes: Easy vs Hard

Two separate start buttons:

- Start Easy: shows per-row pip sums (locked cells only)
- Start Hard: hides per-row pip sums

Row sums display rules:

- Shown on the right side of the grid, aligned by row.
- Sum is computed using locked/taken cells only (never includes the falling piece).
- Update after:
  - each lock
  - each line clear + collapse

## 14) Controls (Both Schemes Enabled)

Movement:

- Left: `A` or `LeftArrow`
- Right: `D` or `RightArrow`
- Soft drop (hold): `S` or `DownArrow`
- Rotate clockwise: `W` or `UpArrow`
- Hard drop: `Space` or `RightShift`

Meta:

- Pause/Resume: `P`
- Restart: `R`

Pause behavior:

- Gravity timer stops.
- Inputs that move/rotate/drop are ignored while paused (except `P`/`R`).

Restart behavior:

- Clears board
- Resets score, lives, streak, speed, cleared-row counter
- Reinitializes and shuffles a fresh 28-bag

## 15) Visual & Rendering Requirements

### Domino visuals (V0)

- Tiles are white.
- Thin black border around each occupied cell.
- A thin black divider line between the two cells of the same domino (when adjacent).
- Pips are black dots arranged like standard domino faces.

### Legibility toggle (dev parameter)

Provide a single parameter to switch pip rendering:

- `PIP_RENDER_MODE = "pips" | "numbers"`

In `"numbers"` mode, each occupied cell displays its pip value as a numeral instead of dots (useful for testing).

No color coding:

- Uniform look; do not color pieces by value.

## 16) Suggested Data Model (Implementation Guidance)

- `gridWidth = 8`, `gridHeight = 16`
- `cells[]`: length 128, each cell holds:
  - `taken: boolean`
  - `pip: number | null`
  - `dominoId: string | null` (optional; helps draw the divider line between the two halves)
- `currentPiece`:
  - `cells: [{row,col,pip}, {row,col,pip}]`
  - `orientation: "H"|"V"`
- Bag:
  - `bag: Array<{a,b}>`
  - `bagIndex`
- State:
  - `score: number`
  - `lives: number`
  - `streakActive: boolean`
  - `totalRowsCleared: number`
  - `dropIntervalMs: number`
  - `isPaused: boolean`
  - `mode: "easy"|"hard"`

## 17) Acceptance Test Scenarios

- Spawn: piece appears at `(0,3)-(0,4)` with left pip ≤ right pip.
- Row sum 0: clearing a full row of all zeros:
  - score +0
  - lives -1
  - streak resets
- Single 5Mult clear with no streak:
  - score += rowSum
  - lives += 2
  - streak becomes active
- Single 5Mult clear with streak active:
  - score += rowSum * 2
  - lives += 2
  - streak remains active
- Single NonMult clear:
  - score += 0
  - lives -= 1
  - streak resets
- Mixed double clear (one 5Mult, one NonMult):
  - score += `(5MultRowSum * 2)` (double-clear rule)
  - lives += `(+2) + (-1) = +1` applied simultaneously
  - streak becomes/continues active
- Double 5Mult clear:
  - score += `(sumRow1 + sumRow2) * 2`
  - lives += `2 + 2 = +4` applied simultaneously
  - streak becomes/continues active
- Rotation at top row:
  - If in-place rotation would go out of bounds, `y+1` kick allows rotation when space permits.
- Game over lives:
  - If lives becomes `-1` after applying a lock’s net lives delta → immediate game over.
- Speed progression:
  - After every 10 total cleared rows, interval decreases by `50ms` down to `150ms`.
