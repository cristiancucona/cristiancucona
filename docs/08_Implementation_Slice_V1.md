# 09_Implementation_Slice_V1.md
## Selio Stocks — Implementation Slice V1 (Masterpiece, In Sync)

**Stack:** Firestore + Cloud Functions (Node) + React Admin  
**Goal:** ship V1 Single-Unit as the smallest system that is mathematically correct, audit-safe, and usable in real restaurants.

**Perfect correlation:** this plan is aligned with:
- Source of Truth (NIR entry point, bon de consum required, FIFO lots, no deletes)
- Domain Model (Documents → Movements → Lots; yield gross-only; adjustments reconcile)
- State Machines (draft/post/reverse/lock + approvals + period close)
- Business Flows (operational happy paths)
- Firestore Schema (transactions + projections + server-only ledger writes)
- Security Model (client drafts; server posts; masking; approvals)
- Failure Scenarios (idempotency, strict negative stock, projection drift)

---

# 0) V1 definition (what “done” means)

V1 is done when a real restaurant can run a full month and Selio can produce:

1) Inventory valuation snapshot (FIFO, acquisition price)
2) Movements ledger export (audit trail)
3) Waste + Comp cost report
4) Inventory count variance report
5) Adjustment log (approved where required)
6) A month close pack that accounting can trust

**If it can’t reconcile after a physical count, it is not done.**

---

# 1) Core product choice (explicit)

## 1.1 SOLD consumption model
V1 default:
- SOLD is tracked as **theoretical usage ledger** derived from POS + BOM  
- Lots are not reduced by SOLD in real-time
- Reconciliation is via Inventory Count + Adjustments

Why:
- safer early
- fewer dependencies (recipe quality, POS stability)
- still produces owner-grade variance insights

Upgrade path:
- V1.5+ can introduce direct `CONSUME_SOLD` movements if desired.

---

# 2) Architecture slice strategy

We build from the inside out:

1) Ledger engine (Lots + Movements + FIFO allocations)
2) Posting functions (NIR / Bon / Transfer / Production / Yield)
3) Inventory count + variance + adjustments
4) Projections + dashboards
5) Exports + period close

This ensures we never ship UI without integrity.

---

# 3) Sprint plan (V1)

## Sprint 1 — Ledger Core (Foundation)
### Deliverables
- Firestore collections: items, locations, lots, movements, documents
- FIFO allocation logic (server-side)
- Movement creation contract (append-only)
- Projections: onHand basic

### Cloud Functions
- `allocateFifo(itemId, locationId, qtyBase)` internal helper
- `rebuildOnHandProjections()` admin-only tool

### Acceptance tests (must)
- FIFO allocates oldest lots first
- OUT movement stores lotAllocations
- Lots never go negative
- Movements cannot be updated/deleted

### UI (minimal)
- Admin screen: Items (create/edit)
- Admin screen: Locations (create/edit)
- Read-only: Lots + Movements viewer (for debugging)

---

## Sprint 2 — Receiving (NIR) + Bon de consum (COMP/WASTE)
### Deliverables
- NIR document creation (draft + lines)
- NIR posting via Cloud Function (transaction)
- Consumption document creation (draft + lines)
- Consumption posting via Cloud Function (transaction)
- Reason codes enforced

### Cloud Functions
- `postNir(docId)`
- `postConsumption(docId)`

### Acceptance tests
- No NIR → no inventory increase
- Posting NIR creates lot + RECEIVE movement
- Posting consumption:
  - blocks if insufficient on-hand (strict)
  - writes FIFO allocations
  - updates onHand projection
- Posted docs immutable (draft-only edits)

### UI
- Receiving screen (fast line add)
- Bon de consum screen (3 taps max for waste/comp)

---

## Sprint 3 — Transfers + Prep Production + Yield Transform
### Deliverables
- Transfer draft + post
- Prep production draft + post
- Yield transform draft + post
- Expiry fields on lots supported

### Cloud Functions
- `postTransfer(docId)`
- `postPrepProduction(docId)`
- `postYieldTransform(docId)`

### Acceptance tests
- Transfer preserves value (OUT + IN match)
- Prep production:
  - consumes ingredients FIFO
  - creates prep lot with absorbed cost
- Yield transform:
  - gross consumption FIFO
  - usable lot unit cost = grossCost / usableQty
  - yield loss logged as YIELD_LOSS
- Cooking shrink cannot be logged as yield loss (category enforcement)

### UI
- Transfer screen
- Prep production screen (BOM optional)
- Yield transform screen with limited categories

---

## Sprint 4 — Inventory Count + Variance + Adjustments
### Deliverables
- Inventory count sessions (draft → submitted → locked)
- Variance compute pipeline (server)
- Adjustment drafts and posting with approval thresholds
- Variance projection view

### Cloud Functions
- `lockInventoryCount(docId)`
- `computeVariance(countId)` (triggered)
- `postAdjustment(docId)`

### Acceptance tests
- Locked count immutable
- Variance computed at snapshotAt
- Adjustments:
  - never set stock directly
  - delta < 0 consumes FIFO lots
  - delta > 0 creates adjustment lot at policy cost
  - approvals required above threshold
- Reversal rules enforced (no delete)

### UI
- Inventory count screen (mobile-friendly)
- Variance review screen (top items first)
- Adjustment workflow (approve + post)

---

## Sprint 5 — Reports + Export + Month Close (V1.5 light)
### Deliverables
- Exports:
  - movements ledger
  - inventory valuation by lot
  - waste/comp
  - on-hand by item/location
- Close validation checklist
- Period close state machine (OPEN → CLOSED; reopen owner-only)

### Cloud Functions
- `exportMovements(range)`
- `exportValuationSnapshot(period)`
- `closePeriod(periodId)`
- `reopenPeriod(periodId, reason)`

### Acceptance tests
- Close blocks if required steps missing (configurable)
- Closed periods block backdated postings
- Reopen requires owner reason + audit
- Export totals reconcile with lots and movements

### UI
- Reports screen (download buttons)
- Period close screen (owner)

---

# 4) Definition of Done (DoD) — strict

V1 is not done unless:

- All posting is server-side (Cloud Functions)
- Movements are immutable and append-only
- Posted docs are immutable
- FIFO allocations stored for every OUT
- NIR is the only receiving entry point
- Bon de consum is mandatory for non-sale consumption
- Yield transforms follow gross-only rule
- Inventory counts lock and compute variance
- Adjustments reconcile, never set stock
- Security masking respected per role
- Projection drift detection exists (at least manual rebuild tool)

---

# 5) Implementation details (Node + Firestore)

## 5.1 Transaction boundaries
Each `post*` function must be a single Firestore transaction:
- validate doc state + permissions
- read required lots (FIFO order)
- write movements
- update lots
- set doc status POSTED

## 5.2 Idempotency
Each doc has `idempotencyKey`.
Functions must:
- return success if doc already POSTED
- avoid double ledger writes

## 5.3 Projection updates
Two safe methods:
A) update projections inside transaction (fast but more writes)  
B) update projections via movement trigger (safer; must be idempotent)

V1 recommended:
- transaction updates onHand for immediate UI
- nightly rebuild tool as backup

---

# 6) QA test plan (must-have)

## 6.1 Golden scenarios
1) Receive 10kg chicken at 40 RON/kg
2) Yield transform 10kg → 7kg usable
3) Waste 0.2kg
4) Inventory count shows expected qty
5) Adjustment corrects delta
6) Export valuation matches expected math

## 6.2 Failure scenarios regression
- duplicate post attempts
- negative stock blocked
- POS sync missing recipe mapping alert
- projection drift rebuild

---

# 7) What we do NOT build in V1 (explicit)

- multi-unit entities
- inter-company transfers
- auto-posting AI
- forecasting
- invoice OCR automation
- EDI vendor integrations

Those are V2+.

---

# 8) Next step after this doc

Proceed directly to implementation:

1) Create repo structure (functions + admin)
2) Implement Sprint 1 exactly as written
3) Add golden scenario tests
4) Ship internal alpha (single location)

Optional (documentation polish): update `01_Project_Charter.md` only after Sprint 1 is working.


Proceed to:
- `09_Project_Charter.md` (polish with milestones + owners)
- and then start implementation.

---
