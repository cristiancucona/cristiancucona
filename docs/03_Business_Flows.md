# 02_Business_Flows.md
## Selio Stocks — Business Flows (Masterpiece, Easy to Understand)

**Audience:** Owner / Manager / Ops team / Tech team  
**Goal:** describe *exactly* how Selio Stocks is used in real life, day by day, with strict rules but fast UX.  

**Perfect correlation:** this document implements:
- `0_SELIO_STOCK_INTELLIGENCE_SOURCE_OF_TRUTH.md`
- `04_Domain_Model.md`
- `03_State_Machines.md`

**Non-negotiables (repeat because they matter):**
- Stock changes only via **Movements** (ledger append-only)
- **No deletes**
- **Posted = immutable**
- Fixes happen via **reversal documents** or **adjustments**
- **NIR is the only receiving entry point**
- **Bon de consum is mandatory** for non-sale consumption
- **Yield loss is only raw processing (gross → usable)**, not cooking shrink

---

# 0) Who uses Selio Stocks (personas)

## Owner
Wants truth:
- COGS
- Prime Cost components (Food + Beverage; Labor imported)
- cash tied in stock
- variance and shrinkage
- auditability (numbers that match accounting)

## General Manager (GM)
Runs the system daily:
- approves/post NIR (if enabled)
- reviews variances
- approves adjustments
- controls discipline

## Receiving Clerk
Fast and accurate receiving:
- enters deliveries
- attaches photos/temps
- cannot approve own NIR (recommended)

## Kitchen Manager / Chef
Runs BOH controls:
- logs waste + comp
- posts prep production
- posts yield transforms (raw processing)
- needs frictionless mobile UX

## Accountant
Reconciles:
- period exports
- inventory valuation snapshots
- COGS vs accounting
No operational posting.

---

# 1) Daily rhythm (simple, real)

A strong restaurant runs these loops:

**Daily**
1) Receive deliveries (NIR)
2) Consume stock:
   - SOLD (POS derived)
   - COMP / WASTE (manual, fast)
3) Internal transfers (warehouse → kitchen / bar)
4) Prep production (if used)
5) Yield transforms (if raw processing is done)
6) End of day: review alerts + exceptions

**Weekly**
- high-value counts (proteins, premium items)
- waste & comp review

**Monthly**
- full inventory count
- variance reconciliation
- period close pack (V1.5)

---

# 2) Global UX rules (field reality)

Product constraints (must):

- Any frequent action must be ≤ **30 seconds**
- Waste logging: **3 taps max**
- Barcode scanning should work for:
  - receiving
  - inventory count
  - waste (optional)
- Inventory count is **offline-first**
- Any action that changes stock must show:
  - what will happen
  - cost impact (if role allowed)
  - required approvals (if any)
- No delete UI anywhere for posted documents — only **Reverse**

---

# 3) Flow: Receiving (NIR) — THE entry point for stock

## 3.1 Trigger
A delivery arrives.

## 3.2 Actor
Receiving Clerk creates; GM approves/posts (policy dependent).

## 3.3 Preconditions
- Item exists in Item Master with UoM conversion.
- Vendor exists (recommended).
- Destination location exists (warehouse/kitchen/bar).

## 3.4 Steps (UI-level)
1) Open **Receiving (NIR)**
2) Select:
   - Vendor
   - Destination Location
   - Document date (default today)
3) Add lines:
   - Scan barcode OR search item
   - Enter qty in purchaseUom (auto converts to baseUom)
   - Enter unit price (recommended mandatory in V1)
   - Optional: expiry date
4) Optional checks:
   - temperature
   - photo
5) Save as `DRAFT`
6) Submit:
   - if approvals: `DRAFT → PENDING_APPROVAL`
   - if not: `DRAFT → POSTED`
7) If approval flow:
   - GM reviews and posts: `PENDING_APPROVAL → POSTED`

## 3.5 Output (system creates)
On POSTED:
- new FIFO Lots (per item line)
- `RECEIVE` Movements
- on-hand updated
- vendor price history updated (if enabled)

## 3.6 What user sees
- “Inventory increased”
- lot labels (date/expiry/lot)
- receiving summary (value + items)

## 3.7 Edge cases (Romania reality)
### A) Invoice first → goods later
- Invoice is not stock truth.
- Stock is posted only via NIR when goods arrive.
- Later: link invoice ref to NIR (reconciliation task).

### B) Goods first → invoice later (e-Factura)
- NIR posts stock immediately.
- Invoice arrives later → match later.

### C) Partial delivery
- Create NIR only for delivered items.
- Remaining delivered later → another NIR.

### D) Unknown unit price
**V1 recommendation:** block posting unless price is present.  
If allowed as exception:
- create lot with `unitCost = null` and status `UNPRICED`
- valuation reports flagged incomplete
- requires later “price completion” workflow (avoid in V1).

---

# 4) Flow: Consumption — SOLD vs COMP vs WASTE

Hospitality consumption is not only sales.
Selio must capture **every** exit from stock.

## 4.1 Actors
GM + Kitchen Manager (manual), System (POS-derived).

## 4.2 Lane A — SOLD (POS derived)
1) POS sends sales events
2) Selio maps `productId → recipe/BOM` (correct version by date)
3) System computes theoretical ingredient usage
4) System records SOLD usage

**V1 product decision**
Two valid models:

### Model 1: Theoretical usage ledger (recommended start)
- SOLD does not reduce lots directly
- It builds theoretical usage
- Reconciliation happens at inventory count

Pros:
- simpler and safer early
Cons:
- real-time on-hand is less accurate unless you also post other movements

### Model 2: Direct `CONSUME_SOLD` movements
- SOLD immediately reduces stock lots FIFO

Pros:
- on-hand is always live
Cons:
- requires strong recipe quality + POS stability

**Default:** Model 1 for V1. Upgrade to Model 2 later if needed.

If recipe missing:
- create alert `MISSING_RECIPE_MAPPING`
- mark product uncontrolled until recipe created

## 4.3 Lane B — COMP / WASTE (manual fast)
1) Tap `+ Add` → **Bon de consum**
2) Choose type:
   - COMP (gratis/protocol/staff meal/test batch)
   - WASTE (spoilage/returned/burnt)
3) Scan/search item
4) Enter qty
5) Select reason code (mandatory)
6) Post

System:
- FIFO allocate lots
- create movement with lotAllocations
- update waste/comp totals immediately

UX:
- confirmation
- daily totals (waste/comp) visible to chef/GM

---

# 5) Flow: Transfers (internal) — move stock between storages

## 5.1 Trigger
Stock must move to where it’s used.

## 5.2 Actor
GM or authorized role.

## 5.3 Steps
1) Tap `+ Add` → **Transfer**
2) Select fromLocation → toLocation
3) Add items + qty
4) Post

## 5.4 System behavior
- FIFO allocate from source lots
- create `TRANSFER_OUT` with allocations
- create `TRANSFER_IN` preserving unit costs
- total inventory value unchanged

## 5.5 UX
- show transfer summary
- show “preserved cost” note (for accounting clarity)

---

# 6) Flow: Prep Production — ingredients → prep lot

## 6.1 Trigger
Kitchen produces internal inventory (sauce/dough).

## 6.2 Actor
Kitchen Manager / Chef.

## 6.3 Steps
1) Tap `+ Add` → **Prep Production**
2) Select prep item (e.g., Tomato Sauce)
3) Enter produced qty (baseUom)
4) Set expiry policy (recommended)
5) Add ingredient inputs:
   - from BOM (preferred)
   - or manual
6) Post

## 6.4 System behavior
- consumes ingredient lots FIFO (OUT movements with allocations)
- creates new prep lot:
  - total cost = sum ingredient costs
  - unit cost = total cost / produced qty
- creates `PRODUCE_PREP` movement

## 6.5 UX
- show “prep unit cost” after posting (if role allowed)
- show expiry warnings for prep lots

---

# 7) Flow: Yield Transform — gross raw → usable raw

This closes the yield modeling gap exactly as specified.

## 7.1 Trigger
Raw processing: deboning, trimming, cleaning.

## 7.2 Actor
Kitchen Manager / Chef (or butcher role).

## 7.3 Rule
Scăzământul is based on **gross raw quantities** only.  
We do not model cooking shrink (frying/baking/boiling/thawing etc.).

## 7.4 Steps
1) Tap `+ Add` → **Yield Transform**
2) Select raw item (gross) + gross qty
3) Select usable item + usable qty
4) Choose yield loss category (bones/fat/cleaning/spoiled_section)
5) Post

## 7.5 System behavior
- consume gross qty from raw lots FIFO
- compute total cost of gross consumption
- create usable lot:
  - qty = usable qty
  - unit cost = gross cost / usable qty
- write `YIELD_LOSS` record for audit (qty = gross - usable)

## 7.6 UX
- show yield % immediately
- show alert if yield below baseline tolerance

---

# 8) Flow: Inventory Count — reality snapshot

## 8.1 Trigger
Weekly high-value, monthly full inventory.

## 8.2 Actors
GM organizes; staff counts; GM locks.

## 8.3 Steps (mobile-first)
1) Create count session
2) Select location(s)
3) Freeze snapshot time `snapshotAt`
4) Count lines:
   - scan barcode
   - enter qty
5) Submit
6) GM reviews
7) Lock

## 8.4 System behavior on Lock
- compute theoretical quantities at snapshotAt
- compute variance qty + value
- generate “top variance items” view
- optionally propose draft adjustment

## 8.5 UX rules
- offline-first for counting
- show variance preview only to authorized roles (GM/Owner)

---

# 9) Flow: Variance Investigation — the playbook

This is where Selio becomes “owner-grade”.

For each top variance item:

1) Check vendor price changes
2) Check receiving errors (wrong qty / wrong unit)
3) Check yield transforms (low yield)
4) Check portioning / recipe mapping issues
5) Check unlogged comp/waste
6) Check theft indicators (patterns, time slots, missing logs)

Output:
- action list (what to fix)
- which documents are missing
- what SOP to enforce

---

# 10) Flow: Adjustments — reconcile after count (never set stock)

## 10.1 Trigger
Count is locked and variance is accepted.

## 10.2 Actor
GM initiates; Owner approves if threshold exceeded.

## 10.3 Steps
1) Open variance report
2) Select items to adjust
3) System suggests delta (counted - theoretical)
4) Add reason code
5) Submit:
   - within threshold: post
   - above threshold: approval needed

## 10.4 System behavior
- delta < 0:
  - FIFO allocate lots and decrement (ADJUSTMENT OUT)
- delta > 0:
  - create adjustment lot at policy cost
  - post ADJUSTMENT IN

## 10.5 UX
- show approval status
- show “audit note” requirement for big adjustments

---

# 11) Alerts & Exceptions (daily quick check)

Daily dashboard for GM includes:

- missing recipe mappings
- expired / near-expiry lots
- POS sync failures
- unusual waste spikes
- negative stock attempt blocked
- unpriced lots (if allowed)

Owner dashboard includes:
- cash tied in stock
- turnover
- prime cost components
- shrinkage estimate

---

# 12) Month Close (V1.5) — accounting-safe pack

## Steps
1) Ensure all NIR posted
2) Ensure POS sync applied (or imported)
3) Lock inventory count (month-end)
4) Generate export pack:
   - inventory valuation snapshot
   - movement ledger
   - COGS summary
   - waste/comp report
5) Close period (freeze)

After close:
- no backdated postings without reopen (Owner-only, audited)

---

# 13) Acceptance checklist (flows are correct only if)

✅ Receiving only increases stock via NIR posting  
✅ Every non-sale exit is logged via Bon de consum (comp/waste)  
✅ FIFO allocations exist on every OUT movement  
✅ Yield transforms are gross-based, not cooking loss  
✅ Inventory count locks snapshot and produces variance  
✅ Adjustments reconcile, never set stock  
✅ Monthly close freezes truth  

---
