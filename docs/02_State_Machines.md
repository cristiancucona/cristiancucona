# 03_State_Machines.md
## Selio Stocks — State Machines (Masterpiece, Easy to Understand)

**Audience:** Owner / Manager / Tech team  
**Goal:** eliminate ambiguity. Every document has clear states, transitions, guards, and side effects.  
**Hard rule (from Source of Truth + Domain Model):**  
- **No deletes.**  
- **Posted = immutable.**  
- **Fixes happen only via reversal documents (new movements).**  
- **Stock changes only via Movements** (ledger is append-only).

This file is the operational “contract” for the UI and backend.

---

# 0) One picture in your head

Every business action is a **Document**.

A Document lives in **states**:

- **Draft**: editable, no stock impact.
- **Posted**: creates immutable Movements + updates Lots.
- **Reversed**: a new reversal document neutralizes the Posted effects.

If you can’t explain something with:  
**Document → Movements → Lot allocations**, it’s not valid.

---

# 1) Global conventions (applies to all documents)

## 1.1 States (standard set)
Most documents use:

- `DRAFT`
- `POSTED`
- `REVERSED`

Some add:
- `PENDING_APPROVAL`
- `SUBMITTED`
- `LOCKED`

## 1.2 Universal transition rules
- Only `DRAFT` can be edited.
- `POSTED` documents cannot be edited or deleted.
- `REVERSED` means: effects have been neutralized by a reversal document.
- Reversal is always a **new document** (not a flag change).

## 1.3 Universal side effects
On `POSTED`:
- create Movements (append-only)
- update Lots (qtyOnHand changes) inside a transaction
- write audit info: who/when/source

On `REVERSED`:
- create opposite Movements referencing the original document
- update Lots back (or neutralize created lots) using the stored lotAllocations

## 1.4 Idempotency (anti double-post)
Every post operation must have:
- `idempotencyKey`
- server-side check: “already posted” → do nothing

## 1.5 Time policy (important)
Each document has two times:
- `documentDate` (business date, can be backdated with policy)
- `postedAt` (system timestamp)

Backdating policy:
- allowed only in **OPEN** periods
- after CLOSE: requires explicit reopen (Owner-only, audited)

(Period close states are defined later.)

---

# 2) Document registry (what documents exist)

All operational actions map to doc types:

1) `NIR` (Receiving)
2) `CONSUMPTION` (Bon de consum)
3) `TRANSFER`
4) `PREP_PRODUCTION`
5) `YIELD_TRANSFORM`
6) `INVENTORY_COUNT`
7) `ADJUSTMENT`
8) `PERIOD_CLOSE` (V1.5)

Each has its own state machine.

---

# 3) NIR (Receiving) — State Machine

## 3.1 What it does
- Increases stock.
- Creates FIFO Lots.
- Creates `RECEIVE` Movements.

**Non-negotiable:** No NIR → no inventory increase.

## 3.2 States
- `DRAFT`
- `PENDING_APPROVAL` (optional policy)
- `POSTED`
- `REVERSED`

## 3.3 Transitions
1) `DRAFT → PENDING_APPROVAL` (Submit)  
2) `DRAFT → POSTED` (Post directly if approvals disabled)  
3) `PENDING_APPROVAL → POSTED` (Approve + Post)  
4) `POSTED → REVERSED` (Reverse)

## 3.4 Guards (what must be true)
- Document has at least 1 line.
- Each line has:
  - `itemId`
  - qty in purchaseUom (convertible to baseUom)
  - `unitCost` (recommended mandatory for V1 accounting-safety)
- Creator cannot approve their own NIR (if enabled).
- Posting must be atomic (transaction):
  - lots created/updated
  - movements created

## 3.5 Side effects on POSTED
For each line:
- convert qty to baseUom
- create a new Lot:
  - `unitCostSubunitsPerBase`
  - `qtyOnHandBase`
  - `sourceDoc = NIR`
- create Movement:
  - `type=RECEIVE`
  - `qtyBase=+X`
  - `valueSubunits=qty×unitCost`

## 3.6 Side effects on REVERSED
Create a new document: `NIR_REVERSAL` (or `ADJUSTMENT` with reversal flag, but recommended: explicit reversal doc).

Reversal algorithm:
- For each original RECEIVE movement:
  - create opposite movement `RECEIVE_REVERSAL` (or `RECEIVE` with negative qty)
  - reduce the created lot qty accordingly
- If any qty from those lots was already consumed:
  - reversal must be blocked OR require a “cascade reversal plan”.
**V1 recommended:** block reversal if lots are partially consumed. Require corrective adjustment instead.

(We keep it strict to protect accounting truth.)

---

# 4) CONSUMPTION (Bon de consum) — State Machine

## 4.1 What it does
Decreases stock for:
- `SOLD` (POS derived)
- `COMP` (gratis/protocol)
- `WASTE` (spoilage/stricăciuni)

**Non-negotiable:** any non-sale consumption must be logged.

## 4.2 States
- `DRAFT`
- `POSTED`
- `REVERSED`

## 4.3 Transitions
- `DRAFT → POSTED`
- `POSTED → REVERSED`

## 4.4 Guards
- Must specify `subtype`: `COMP` or `WASTE` (manual docs).
- Must have reasonCode:
  - mandatory for `COMP` and `WASTE`
- Must have qty convertible to baseUom.
- Stock must exist:
  - FIFO allocation possible for the requested qty (strict policy)

## 4.5 Side effects on POSTED
For each line:
1) FIFO allocate lots (oldest first)
2) Decrement lots qtyOnHandBase
3) Write Movement with **lotAllocations**:
   - `type=CONSUME_COMP` or `CONSUME_WASTE`
   - `qtyBase=-X`
   - `valueSubunits=sum(allocations)`

## 4.6 SOLD consumption (POS derived)
SOLD is usually not a manual Bon de consum.
It is produced by POS sync + BOM:

State machine for SOLD sync is defined in section 9, but the result is:
- `CONSUME_SOLD` movements (or a theoretical ledger if you prefer 2-ledger design)

**Rule:** If recipe/BOM missing → no theoretical consumption; generate alert.

## 4.7 Reversal
Reversal creates opposite movements using the stored allocations.
- restore lots qtyOnHandBase accordingly
- keep full audit trail

---

# 5) TRANSFER (internal) — State Machine

## 5.1 What it does
Moves stock between internal locations.
Does not change total value.

## 5.2 States
- `DRAFT`
- `POSTED`
- `REVERSED`

## 5.3 Transitions
- `DRAFT → POSTED`
- `POSTED → REVERSED`

## 5.4 Guards
- fromLocation != toLocation
- qty convertible to baseUom
- FIFO allocation possible at source location

## 5.5 Side effects on POSTED
For each line:
1) FIFO allocate from source lots
2) Create `TRANSFER_OUT` movement (with lotAllocations)
3) Decrement source lots
4) Create `TRANSFER_IN` movement at destination
   - preserves unitCost and allocation structure

**V1 implementation choice:**
- You can preserve original lot identity by storing `originalLotId` in destination allocations.
- Or you can create “mirrored lots” at destination with same cost.
Both are valid if audit is maintained.
Recommended: preserve traceability via `originalLotId`.

## 5.6 Reversal
- Reverse both movements and restore source lots
- Remove/neutralize destination stock changes

---

# 6) PREP_PRODUCTION — State Machine

## 6.1 What it does
Converts ingredients → a prep item lot (sauce/dough).
This is inventory.

## 6.2 States
- `DRAFT`
- `POSTED`
- `REVERSED`

## 6.3 Guards
- Must specify prep itemId
- Must specify producedQty (baseUom)
- Must specify ingredient inputs (from BOM or manual)
- Must have expiry policy (optional but recommended)

## 6.4 Side effects on POSTED
1) Consume ingredient inputs (FIFO):
   - decrement lots
   - movements: `CONSUME_FOR_PRODUCTION` (can reuse `CONSUME_COMP` with distinct reason, but better explicit type)
2) Create new Lot for prep item:
   - total cost = sum(ingredient allocation values)
   - unit cost = total cost / producedQty
3) Create movement `PRODUCE_PREP`:
   - qtyBase=+producedQty
   - valueSubunits=total cost

## 6.5 Reversal
- reverse `PRODUCE_PREP` (remove/neutralize prep lot qty)
- reverse ingredient consumptions using stored allocations
Strict policy: block reversal if prep lot was already consumed; require adjustment.

---

# 7) YIELD_TRANSFORM (Gross → Usable) — State Machine

## 7.1 What it does
Raw processing yield: deboning, trimming, cleaning.
**No cooking shrinkage modeling.** (This is mandatory.)

## 7.2 States
- `DRAFT`
- `POSTED`
- `REVERSED`

## 7.3 Guards
- Must specify:
  - raw itemId + grossQty
  - usable itemId + usableQty
  - yield loss category
- grossQty > usableQty (usually)
- FIFO allocation possible for grossQty

## 7.4 Side effects on POSTED
1) Consume gross raw qty (FIFO allocations)
2) Compute totalGrossCost = sum(allocation values)
3) Create usable lot:
   - qty = usableQty
   - unitCost = totalGrossCost / usableQty
4) Movements created:
   - OUT movement (consume raw): `YIELD_TRANSFORM_OUT` (or `CONSUME_FOR_YIELD`)
   - IN movement (create usable): `YIELD_TRANSFORM_IN`
   - `YIELD_LOSS` movement for audit:
     - qty = grossQty − usableQty
     - category = bones/fat/cleaning/spoiled_section

**Accounting truth:** the cost of loss is absorbed into usable unit cost.

## 7.5 Reversal
- reverse usable lot creation
- reverse raw consumption using stored allocations
Strict policy: block reversal if usable lot already consumed.

---

# 8) INVENTORY_COUNT — State Machine

## 8.1 What it does
Captures real-world stock at a time and computes variance.

## 8.2 States
- `DRAFT`
- `IN_PROGRESS`
- `SUBMITTED`
- `LOCKED`
- `ADJUSTED` (optional marker: adjustment posted)

## 8.3 Transitions
1) `DRAFT → IN_PROGRESS` (Start counting)
2) `IN_PROGRESS → SUBMITTED` (Submit)
3) `SUBMITTED → LOCKED` (Lock)
4) `LOCKED → ADJUSTED` (When adjustment posted)

## 8.4 Guards
- Snapshot time must be frozen (`snapshotAt`)
- Only one active count per location unless explicitly allowed
- After `LOCKED`, no edits allowed

## 8.5 Side effects on LOCKED
- compute theoretical qty at snapshotAt from ledger
- compute variance per item:
  - qty variance
  - value variance (FIFO weighted)
- generate variance report
- optionally generate draft adjustment recommendation

---

# 9) ADJUSTMENT (from Count) — State Machine

## 9.1 What it does
Reconciles theoretical stock to counted stock via movements.
**It never “sets stock”.**

## 9.2 States
- `DRAFT`
- `PENDING_APPROVAL` (if above threshold)
- `POSTED`
- `REVERSED`

## 9.3 Transitions
- `DRAFT → PENDING_APPROVAL` (if required)
- `DRAFT → POSTED` (if within limits)
- `PENDING_APPROVAL → POSTED` (approved)
- `POSTED → REVERSED`

## 9.4 Guards
- Must reference `countId`
- Must include reasonCode and approval metadata if needed
- Must compute delta per item:
  - deltaQty = counted − theoretical

## 9.5 Side effects on POSTED
For each item delta:

### Case A: deltaQty < 0 (we have less than expected)
- allocate FIFO lots for the missing qty
- decrement lots
- write `ADJUSTMENT` movement (OUT)

### Case B: deltaQty > 0 (we have more than expected)
We must add stock carefully.

Options for unit cost policy (choose one):
1) last purchase cost
2) last weighted cost
3) manager-entered cost (not recommended)

**V1 recommended:** last purchase cost + flagged review.

Implementation:
- create an “adjustment lot”:
  - qty = deltaQty
  - unitCost = policy cost
- write `ADJUSTMENT` movement (IN)

## 9.6 Reversal
Reversal creates opposite adjustment movements and restores lots.

---

# 10) POS_SYNC (Integration) — State Machine

## 10.1 What it does
Turns sales into theoretical consumption (SOLD) using BOM.

## 10.2 States
- `IDLE`
- `SYNCING`
- `APPLIED`
- `FAILED`
- `RETRYING`

## 10.3 Transitions
- `IDLE → SYNCING`
- `SYNCING → APPLIED`
- `SYNCING → FAILED`
- `FAILED → RETRYING → SYNCING`

## 10.4 Guards
- POS events must be idempotent
- productId must map to BOM version for that time
- if missing BOM → create alert and skip that product usage

## 10.5 Side effects on APPLIED
Per sales event:
- compute ingredient usage from BOM
- write `CONSUME_SOLD` movement(s) OR write theoretical ledger records
- update dashboards

**Important:** if you do theoretical ledger separate from actual ledger, then SOLD is “theoretical” and is reconciled via inventory counts.  
This is a product decision. V1 can start with theoretical ledger to reduce complexity.

---

# 11) PERIOD_CLOSE (V1.5) — State Machine

## 11.1 Why it exists
Without closing, backdated edits can change past reports.
Owners need stable numbers.

## 11.2 States
- `OPEN`
- `SOFT_LOCK` (optional)
- `CLOSED`
- `REOPENED`

## 11.3 Transitions
- `OPEN → SOFT_LOCK` (optional pre-close)
- `OPEN → CLOSED`
- `SOFT_LOCK → CLOSED`
- `CLOSED → REOPENED` (Owner-only, audited)
- `REOPENED → CLOSED`

## 11.4 Rules
On `CLOSED`:
- store valuation snapshot
- generate export pack
- block posting backdated documents into the closed period

Reopen requires:
- Owner reason note
- audit entry
- limited time window (policy)

---

# 12) “What can go wrong” (fast mapping)

- Double posting → prevented by idempotency key
- Negative stock → blocked by strict FIFO policy
- Late invoice → does not affect stock (NIR is truth)
- Backdated waste → allowed only if period open
- Reversal after consumption → blocked; require adjustment

---

# 13) Checklist (does this match Source of Truth + Domain Model?)

✅ Stock changes only through Movements  
✅ Posted docs immutable  
✅ FIFO allocations stored on every OUT  
✅ NIR is the only entry point for receiving  
✅ Bon de consum required for non-sale consumption  
✅ Yield loss = gross raw processing only (no cooking shrink)  
✅ Inventory counts lock snapshot and compute variance  
✅ Adjustments reconcile, never “set stock”  
✅ POS sync never fails silently  
✅ Period close freezes accounting truth

---
