# 05_Firestore_Schema.md
## Selio Stocks — Firestore Schema (Masterpiece, V1 Single-Unit, V2-ready)

**Stack:** Firestore + Cloud Functions (Node) + React Admin  
**Goal:** implement the domain (Documents → Movements → Lots) with audit-grade integrity, fast queries, and safe transactions.

**Perfect correlation:** this schema enforces:
- Source of Truth (no deletes, posted immutable, FIFO, NIR entry point, bon de consum required)
- Domain Model (lots + immutable movement ledger + allocations)
- State Machines (status transitions + reversals/adjustments)

---

# 0) Non‑negotiables (schema must enforce these)

1) **Movements are append-only**  
   - no update, no delete (ever)
2) **Posted documents are immutable**  
   - only draft docs editable
3) **All quantities are stored in `baseUom`** (integers or decimals — choose one policy)
4) **All money stored in integer subunits** (bani/cents)
5) **Every movement references a source document** (`docType`, `docId`)
6) **Every OUT movement stores FIFO allocations** (`lotAllocations[]`)
7) **Lots store qtyOnHand** and never go negative
8) **Corrections are reversals/adjustments**, not edits

---

# 1) V1 vs V2 structure

## V1 (Single Unit)
We keep collections at root for speed and simplicity.

## V2-ready hook
Every doc includes:
- `entityId` (nullable in V1, required in V2)

When moving to V2, paths become:
`/entities/{entityId}/...`

We design IDs and indexes so migration is mechanical.

---

# 2) Data types policy (important)

## 2.1 Quantities
**Recommendation:** store `qtyBase` as integer in smallest measurable unit.
Examples:
- grams for weight
- milliliters for volume
- pieces for count

Why:
- no floating errors
- simpler reconciliation

If you must support decimals, store:
- `qtyBase` as integer + `qtyScale` OR use Firestore `number` with strict rounding rules.
V1 recommended: **integer base units**.

## 2.2 Money
Store all money in **integer subunits**:
- RON bani
- EUR cents

Examples:
- `unitCostSubunitsPerBase`
- `valueSubunits`

---

# 3) Collections overview (V1)

Core collections:

1) `/items/{itemId}`
2) `/vendors/{vendorId}`
3) `/locations/{locationId}`
4) `/documents/{docId}` (registry of all operational docs)
5) `/documents/{docId}/lines/{lineId}` (doc lines)
6) `/lots/{lotId}`
7) `/movements/{movementId}`
8) `/counts/{countId}` (optional if not using documents for counts)
9) `/projections/*` (derived views for speed)
10) `/alerts/{alertId}`

---

# 4) Master Data

## 4.1 /items/{itemId}
Fields:
- `entityId?`
- `name`
- `categoryId`
- `baseUom` (g/ml/pcs)
- `purchaseUom`
- `purchaseToBaseFactor` (int)
- `storageType` (dry/chilled/frozen)
- `barcodes` (array)
- `expectedYieldPercent?`
- `yieldTolerancePercent?`
- `isActive`
- `createdAt`, `createdBy`
- `updatedAt`, `updatedBy`

Indexes:
- `categoryId`
- `barcodes` (array-contains)

## 4.2 /vendors/{vendorId}
Fields:
- `entityId?`
- `name`
- `paymentTerms`
- `isApproved`
- audit fields

## 4.3 /locations/{locationId}
Fields:
- `entityId?`
- `name`
- `type`
- `roleAccess` (array)
- audit fields

## 4.4 Vendor price history
Two options:

### Option A (simple): /vendorPrices/{vendorId}_{itemId}
Fields:
- `entityId?`
- `vendorId`, `itemId`
- `currentUnitPriceSubunitsPurchaseUom`
- `history` (array of objects) OR subcollection
- audit

### Option B (clean): /vendors/{vendorId}/prices/{itemId}
Fields:
- `currentUnitPriceSubunitsPurchaseUom`
- `history` (subcollection)

Recommendation: **Option B** (clean reads per vendor).

---

# 5) Documents (operational truth wrapper)

## 5.1 /documents/{docId}
This is the universal document registry.

Fields:
- `entityId?`
- `docType`: `NIR | CONSUMPTION | TRANSFER | PREP_PRODUCTION | YIELD_TRANSFORM | INVENTORY_COUNT | ADJUSTMENT | PERIOD_CLOSE`
- `status`: as per state machines
- `documentDate` (business date)
- `postedAt?`
- `reversedAt?`
- `reversedByDocId?`
- `createdAt`, `createdBy`
- `updatedAt`, `updatedBy` (only in draft)
- `approvedAt?`, `approvedBy?` (optional)
- `locationId?` (common)
- `vendorId?` (NIR)
- `fromLocationId?`, `toLocationId?` (transfer)
- `snapshotAt?` (inventory count)
- `totals`: `{ qtyBaseTotal?, valueSubunitsTotal? }`
- `meta`: `{ notes?, attachmentsCount?, idempotencyKey }`

**Immutability rule:**
- Only `status=DRAFT` docs can be updated.
- Any posted doc cannot be modified.

## 5.2 /documents/{docId}/lines/{lineId}
Line structure depends on docType, but schema is normalized.

Common fields:
- `itemId`
- `qtyBase` (preferred) OR (`qtyPurchase`, `purchaseUom`) + conversion snapshot
- `unitPriceSubunitsPurchaseUom?` (NIR)
- `expiryAt?` (NIR)
- `reasonCode?` (consumption/adjustment)
- `note?`

For transfers:
- `fromLocationId`, `toLocationId` can be inherited from document header.

For yield:
- store `grossQtyBase`, `usableQtyBase`, `yieldCategory`, rawItemId, usableItemId

---

# 6) Lots (FIFO layer)

## 6.1 /lots/{lotId}
Fields:
- `entityId?`
- `itemId`
- `locationId`
- `createdAt` (receivedAt/producedAt)
- `expiryAt?`
- `unitCostSubunitsPerBase`
- `qtyOnHandBase`
- `sourceDoc`: `{ docType, docId }`
- `status`: `ACTIVE | DEPLETED` (optional)
- audit fields

Indexes:
- (itemId, locationId, createdAt ASC)  ← FIFO reads
- (itemId, expiryAt ASC)               ← expiry alerts
- (locationId, itemId)                 ← on-hand scans

---

# 7) Movements (immutable ledger)

## 7.1 /movements/{movementId}
Fields:
- `entityId?`
- `type` (from Domain Model)
- `itemId`
- `locationId`
- `qtyBase` (signed)
- `valueSubunits` (absolute value)
- `lotAllocations` (array) — REQUIRED for OUT movements
- `sourceDoc`: `{ docType, docId }`
- `reasonCode?`
- `createdAt`, `createdBy`
- `documentDate` (copy from doc for easy queries)
- `idempotencyKey` (optional)

Lot allocation object:
- `lotId`
- `qtyBase`
- `unitCostSubunitsPerBase`
- `valueSubunits`

Indexes:
- (createdAt DESC)
- (itemId, createdAt DESC)
- (sourceDoc.docId)
- (locationId, createdAt DESC)

**Hard rule:**
- no updates/deletes to movements.

---

# 8) Projections (derived views for speed)

Firestore is not a relational DB. We use projections to make UI fast.

## 8.1 /projections/onHand/{locationId}_{itemId}
Fields:
- `entityId?`
- `locationId`, `itemId`
- `qtyOnHandBase`
- `valueOnHandSubunits`
- `updatedAt`

Updated by Cloud Function on movement writes (or by transactional updates).

## 8.2 /projections/itemTotals/{itemId}
Fields:
- qty across all locations
- value across all locations

## 8.3 /projections/dailyStats/{YYYY-MM-DD}
Fields:
- wasteValue
- compValue
- purchasesValue
- COGSValue (if computed)
- alertsCount

## 8.4 /projections/variance/{countId}
Fields:
- top variance items list
- totals by value
- breakdown categories

---

# 9) Alerts

## /alerts/{alertId}
Fields:
- `entityId?`
- `type`: POS_SYNC_FAILED | MISSING_RECIPE | EXPIRY_RISK | HIGH_WASTE | NEGATIVE_STOCK_BLOCKED | UNPRICED_LOT
- `severity`: INFO | WARN | CRITICAL
- `itemId?`, `locationId?`
- `docId?`
- `message`
- `status`: OPEN | ACK | RESOLVED
- `createdAt`

---

# 10) Transactions (critical posting patterns)

Everything that changes stock must be atomic.

## 10.1 Posting NIR (Receiving)
Firestore **transaction**:
1) read document in DRAFT/PENDING
2) validate lines + conversions + prices
3) write doc status=POSTED + postedAt
4) for each line:
   - compute qtyBase
   - compute unitCostSubunitsPerBase
   - create lot
   - create movement RECEIVE
5) update projections (optional in same tx or via CF)

**Idempotency guard:** if already POSTED, exit.

## 10.2 Posting Consumption (COMP/WASTE)
Transaction:
1) validate doc DRAFT
2) for each item line:
   - read FIFO lots ordered by createdAt
   - allocate qty
   - decrement lots qtyOnHandBase
   - write movement with allocations
3) write doc POSTED

**Strict policy:** if not enough on-hand, block and alert.

## 10.3 Posting Transfer
Transaction:
1) validate DRAFT
2) allocate FIFO at source
3) decrement source lots
4) write TRANSFER_OUT + TRANSFER_IN movements
5) increment destination via:
   - mirrored lots OR allocation tracking
Recommendation:
- mirrored lots at destination for simple FIFO per location, with `sourceLotId`

## 10.4 Posting Prep Production
Transaction:
- consume ingredient lots (allocations)
- create prep lot with absorbed cost
- write movements (CONSUME_FOR_PRODUCTION + PRODUCE_PREP)

## 10.5 Posting Yield Transform
Transaction:
- consume gross raw lots
- create usable lot (unitCost = grossCost / usableQty)
- write YIELD_LOSS record

## 10.6 Locking Inventory Count + Variance compute
Two-step:
1) lock count document (transaction)
2) compute variance in Cloud Function (async) and store in projection `/projections/variance/{countId}`

Reason:
- variance can be heavy.

## 10.7 Posting Adjustments
Transaction:
- for each delta:
  - if negative: FIFO allocate and decrement lots
  - if positive: create adjustment lot at policy cost
- write movements
- write doc POSTED

Approval gates:
- if value > threshold: require `approvedBy`

---

# 11) Cloud Functions responsibilities (Node)

We keep clients thin and safe.

## 11.1 Callable / HTTPS functions (recommended)
- `postNir(docId)`
- `postConsumption(docId)`
- `postTransfer(docId)`
- `postPrepProduction(docId)`
- `postYieldTransform(docId)`
- `lockInventoryCount(docId)`
- `postAdjustment(docId)`
- `applyPosSync(payload or docId)`
- `closePeriod(periodId)` (V1.5)

Client (React Admin) calls functions; functions perform transactions.

## 11.2 Triggers (onWrite)
- On movement create:
  - update projections (onHand, totals)
  - raise alerts (expiry risk, negative attempts, spikes)

**Important:** triggers must be idempotent to avoid double updates.

---

# 12) Security Rules (Firestore)

Firestore rules must enforce:
- only DRAFT docs editable
- posted docs immutable
- movements are write-once
- lots updates only by service account / Cloud Function (recommended)
- role-based read masking (purchase prices)

Simplest secure model:
- Client can create DRAFT documents
- Only Cloud Functions can POST (write lots/movements)
- Clients read via role-based rules

This prevents tampering.

---

# 13) React Admin read patterns (fast UI)

We build screens on top of projections and document registry:

1) **Dashboard**
   - read `/projections/dailyStats`
   - read `/alerts` (latest)
2) **Receiving**
   - create `/documents` + lines
   - call `postNir`
3) **Bon de consum**
   - create `/documents` + lines
   - call `postConsumption`
4) **Transfers**
   - create doc + lines
   - call `postTransfer`
5) **Inventory**
   - create count doc + lines
   - call `lockInventoryCount`
   - read `/projections/variance/{countId}`
6) **Reports**
   - query `/movements` by date
   - export from function

---

# 14) Performance & scaling notes (V1)

- Movements can grow large. Use:
  - date filters
  - per-item queries
  - exports via Cloud Function (streaming)
- Lots query hot path:
  - always index (itemId + locationId + createdAt)
- Avoid large arrays in docs (history arrays).
  - prefer subcollections for price history and count lines.

---

# 15) Migration to V2 (preview)

When ready:
- create `/entities/{entityId}`
- move collections under entity
- set `entityId` everywhere
- keep same doc shapes and posting functions

This is why we put `entityId` from day 1.

---

# 16) Acceptance criteria (schema is correct only if)

✅ Posting a document is atomic: lots + movements consistent  
✅ Every OUT movement has lot allocations stored  
✅ No client can mutate posted docs or movements  
✅ On-hand projections reconcile with lot sums  
✅ Variance computations reference snapshotAt and ledger  
✅ V2 migration is mechanical via entityId

---
