# 04_Domain_Model.md
## Selio Stocks — Domain Model (Masterpiece, Easy to Understand)

**Audience:** Owner / Manager / Tech team  
**Goal:** make the system *obvious* and *unbreakable* by defining what exists, how it behaves, and what is forbidden.  
**Scope:** **V1 Single-Unit** (one company, one fiscal identity) with **V2-ready hooks**.

---

# 0) One sentence

Selio Stocks is a **stock ledger** (like a bank ledger) where every stock change is an immutable event, valued by **FIFO lots at acquisition price**, and always explainable by documents.

---

# 1) The mental model (no jargon)

Imagine every ingredient as money.

- **Lots** = “bills” you hold, each with its own cost (older bills first).
- **Movements** = deposits/withdrawals (never edited, never deleted).
- **Documents** = human-friendly wrappers around movements (NIR, Bon de consum, Transfer, etc.).
- **Inventory Count** = reality snapshot (“how many bills do I actually have?”).
- **Variance** = the gap between expected vs counted.
- **Adjustments** = the *only* way to reconcile (by adding new movements, not rewriting history).

If we can’t explain a number using movements + documents, it’s not accounting-safe.

---

# 2) What we must be able to answer (always)

For any date range, any item, any location:

1) **On-hand qty** (what we have now)  
2) **Valuation** (what it’s worth, FIFO at acquisition price)  
3) **COGS** (what got used)  
4) **Waste cost** (disposed)  
5) **Comp cost** (no revenue but used)  
6) **Yield impact** (gross → usable)  
7) **Variance after count** (what doesn’t match and why)

---

# 3) Bounded Contexts (simple separation)

We split the domain so it stays clean:

1) **Master Data**  
   Items, Vendors, Locations, Units.
2) **Stock Ledger**  
   Lots, Movements, FIFO allocations, valuation.
3) **Operations Documents**  
   Receiving (NIR), Consumption, Transfers, Prep Production, Yield Transform.
4) **Inventory & Variance**  
   Counts, variance, adjustments.
5) **Reporting**  
   Dashboards, exports, period summaries.
6) **Integrations**  
   POS sync, e-Factura linking (not stock truth).

---

# 4) Ubiquitous Language (glossary you’ll use daily)

### Items
- **Item**: an ingredient/stock item we track (e.g., chicken breast, oil).

### Lots & valuation
- **Lot**: a batch of an item created by receiving or production. Has:
  - qty
  - unit cost
  - date/expiry
- **FIFO**: we consume the oldest lot first.

### Movements
- **Movement**: an immutable ledger record that changes stock.

### Documents
- **NIR**: receiving document that increases stock.
- **Bon de consum**: document that decreases stock for non-sale usage (comp/waste/staff meals etc.).
- **Transfer**: move stock between internal locations.
- **Prep Production**: produce internal prep item (sauce/dough) -> creates a new lot.
- **Yield Transform**: gross raw (10kg) -> usable (7kg). Cost is absorbed into usable.

### Inventory
- **Inventory Count**: physical count snapshot at a time.
- **Variance**: counted − theoretical.
- **Adjustment**: movements posted to reconcile variance (reversal-only style).

---

# 5) The “Golden Rule”: stock changes only through Movements

**Forbidden:**
- editing a posted document
- deleting a movement
- directly “setting stock” to a number

**Allowed:**
- create a new document that posts new movements (including reversals)

---

# 6) The Domain Map (what exists)

Below are the core entities.  
Every implementation detail later (Firestore schema, UI, APIs) must reflect this.

---

## 6.1 Entity: Item

**Why it exists:** to define *what* we track and how we measure it.

**Identity:** `itemId`

**Fields (must-have)**
- `name`
- `categoryId`
- `baseUom` (g / ml / pcs) — **the only unit used in calculations**
- `purchaseUom` (kg / L / box)
- `purchaseToBaseFactor` (e.g., 1 kg → 1000 g)
- `storageType` (dry / chilled / frozen)
- `isActive`

**Fields (recommended)**
- `barcodes[]`
- `expectedYieldPercent?`
- `yieldTolerancePercent?`

**Invariants**
- All quantities in the system for this item are stored in **baseUom**.
- You cannot receive/purchase an item without a valid conversion to baseUom.

---

## 6.2 Entity: Vendor

**Identity:** `vendorId`

**Fields**
- `name`
- `paymentTerms`
- `isApproved`

**Note:** Invoice accounting is a separate concern. For stock, Vendor is for traceability + pricing.

---

## 6.3 Entity: Location (internal storage)

**Identity:** `locationId`

**Meaning:** physical storage inside one unit:
- Warehouse, Kitchen, Bar, Freezer, etc.

**Fields**
- `name`
- `type` (dry/chilled/frozen/mixed)
- `roleAccess[]` (security layer)

**Invariant**
- V1: locations are not separate companies. They are internal.

---

## 6.4 Entity: Lot (FIFO batch)

**Identity:** `lotId`

**Why it exists:** FIFO valuation needs batches with their own unit cost.

**Fields**
- `itemId`
- `locationId`
- `createdAt` (receivedAt or producedAt)
- `expiryAt?`
- `unitCostSubunitsPerBase`  
  (money in integer subunits per baseUom; example: bani per gram)
- `qtyOnHandBase`
- `sourceDoc` `{ type, id }`

**Invariants**
- `qtyOnHandBase >= 0`
- `unitCostSubunitsPerBase` never changes after lot creation
- lots are created only by:
  - NIR (Receiving)
  - Prep Production
  - Yield Transform (usable lot)

---

## 6.5 Entity: Movement (immutable ledger record)

**Identity:** `movementId`

**Why it exists:** movements are the single source of truth for stock changes.

**Core Fields**
- `type`
- `itemId`
- `locationId`
- `qtyBase` (signed: +in, −out)
- `lotAllocations[]` (for OUT movements; FIFO proof)
- `valueSubunits` (derived: sum(qty×unitCost))
- `sourceDoc` `{ type, id }`
- `createdBy`, `createdAt`
- `reasonCode?` (mandatory for waste/comp/adjustments)

**Movement Types (V1)**
- `RECEIVE` (NIR)
- `CONSUME_SOLD` (POS-derived)
- `CONSUME_COMP` (no revenue)
- `CONSUME_WASTE` (disposed)
- `TRANSFER_OUT`
- `TRANSFER_IN`
- `PRODUCE_PREP`
- `YIELD_TRANSFORM_IN` (usable lot creation)
- `YIELD_LOSS` (raw structural loss)
- `ADJUSTMENT` (count reconciliation)
- `REVERSAL` (optional explicit type; or reversal is an opposite movement)

**LotAllocations structure**
```json
[
  { "lotId": "lot_001", "qtyBase": 1200, "unitCostSubunitsPerBase": 5, "valueSubunits": 6000 },
  { "lotId": "lot_002", "qtyBase": 300,  "unitCostSubunitsPerBase": 6, "valueSubunits": 1800 }
]
```

**Invariants**
- movements are append-only (no update/delete)
- every OUT movement must reference exact FIFO allocations
- every movement must reference a source document

---

## 6.6 Entity: Recipe / BOM (strongly recommended)

**Identity:** `recipeId`

**Why it exists:** to compute theoretical usage from POS sales.

**Fields**
- `productId` (POS menu item)
- `portions`
- `ingredients[]`: `{ itemId, qtyBaseUom, lossFactor? }`
- `version`
- `validFrom`, `validTo?`

**Invariants**
- BOM is versioned.
- Historical sales use the BOM version valid at that time (no retro mutation).

---

## 6.7 Entity: Inventory Count

**Identity:** `countId`

**Fields**
- `locationId`
- `snapshotAt`
- `status`: `DRAFT` → `IN_PROGRESS` → `SUBMITTED` → `LOCKED`
- `lines[]`: `{ itemId, countedQtyBase, note? }`
- `createdBy`, `createdAt`

**Invariants**
- once `LOCKED`, it becomes immutable
- variance is computed against the ledger state at `snapshotAt`

---

# 7) Aggregates (consistency boundaries)

Aggregates are “the things we must keep consistent” in one operation.

---

## 7.1 StockLedgerAggregate (Item + Location)

**Responsibility**
- keep lots qty correct
- perform FIFO allocations for OUT movements
- guarantee invariants:
  - no negative lots
  - no stock teleportation
  - allocations are provable

**Input:** “Post document” command  
**Output:** new movements + lot qty updates

---

## 7.2 InventoryCountAggregate

**Responsibility**
- snapshot freeze
- lock workflow
- variance computation request
- adjustment recommendations

---

# 8) Commands (what users do)

Commands are user actions. They generate documents, then movements.

### Receiving
- `CreateNir`
- `PostNir`

### Consumption
- `CreateConsumptionNote`
- `PostConsumptionNote`

### Transfers
- `CreateTransfer`
- `PostTransfer`

### Production
- `CreatePrepProduction`
- `PostPrepProduction`

### Yield Transform
- `CreateYieldTransform`
- `PostYieldTransform`

### Inventory
- `CreateCount`
- `SubmitCount`
- `LockCount`
- `PostAdjustmentFromCount`

---

# 9) Domain Events (system messages)

When a command succeeds, we emit an event.  
Events are used for:
- dashboards updates
- alerts
- audit streams
- UI refresh

Core events:
- `NirPosted`
- `ConsumptionPosted`
- `TransferPosted`
- `PrepProduced`
- `YieldTransformed`
- `InventoryCountLocked`
- `VarianceComputed`
- `AdjustmentPosted`
- `PosSyncApplied`
- `PeriodClosed` (V1.5)

---

# 10) FIFO allocation algorithm (easy version)

When an OUT movement is posted (consume/transfer-out/adjust-down):

1) list lots for (itemId, locationId) ordered by `createdAt` ascending  
2) take from the oldest lot until qty satisfied  
3) write allocations into the movement  
4) decrease each lot `qtyOnHandBase` by allocated qty  
5) compute total value (sum allocation values)

**If qty requested > available:**  
Policy:
- default: block posting + show “missing receiving / missing stock”
- optional: allow negative with critical alert (not recommended for V1)

---

# 11) Yield modeling (raw processing only — your rule)

## 11.1 Non-negotiable rule
Scăzământul is calculated only on **gross raw quantity received**.  
We do **NOT** model technological cooking processes:
- frigere, coacere, fierbere, dezghețare, etc.

Cooking loss is not a stock-loss event.  
It’s handled in recipe modeling later (separate layer).

## 11.2 Yield Transform algorithm (gross → usable)

Example: deboning meat

- gross raw: 10 kg
- usable: 7 kg
- yield loss: 3 kg (bones/fat)

Steps:
1) consume 10kg from raw lots (FIFO) → OUT allocations
2) create a new usable lot:
   - qty = 7kg
   - total cost = cost of the consumed 10kg
   - unit cost = totalCost / 7kg
3) record `YIELD_LOSS` movement for audit (qty=3kg, category=bones)

Key consequence:
- cost of loss is absorbed into usable unit cost (correct accounting)

---

# 12) Adjustments (count reconciliation)

We never “set stock”.

We compute delta from count:

- deltaQty = counted − theoretical

If deltaQty is negative:
- allocate FIFO lots and reduce (ADJUSTMENT OUT)

If deltaQty is positive:
- create an “adjustment lot” (ADJUSTMENT IN) at a defined policy cost
  - recommended: last known weighted unit cost or last purchase cost
  - always flagged for review

Adjustments require:
- reason code
- approval if above threshold

---

# 13) V1 → V2 compatibility (hooks)

Every entity/document should already include:
- `entityId` (nullable in V1, mandatory in V2)

So V2 becomes a “switch”, not a refactor.

---

# 14) Concrete JSON examples (so you can visualize)

### Example: NIR line
```json
{
  "docType": "NIR",
  "vendorId": "v_mega",
  "locationId": "loc_warehouse",
  "lines": [
    { "itemId": "it_oil", "qtyPurchase": 2, "purchaseUom": "L", "unitPriceSubunits": 1250 }
  ]
}
```

### Example: Lot created from NIR
```json
{
  "lotId": "lot_0001",
  "itemId": "it_oil",
  "locationId": "loc_warehouse",
  "createdAt": "2026-02-26T10:00:00Z",
  "unitCostSubunitsPerBase": 1,
  "qtyOnHandBase": 2000,
  "sourceDoc": { "type": "NIR", "id": "nir_123" }
}
```

### Example: Waste movement (FIFO proof included)
```json
{
  "movementId": "mov_9001",
  "type": "CONSUME_WASTE",
  "itemId": "it_oil",
  "locationId": "loc_kitchen",
  "qtyBase": -200,
  "lotAllocations": [
    { "lotId": "lot_0001", "qtyBase": 200, "unitCostSubunitsPerBase": 1, "valueSubunits": 200 }
  ],
  "valueSubunits": 200,
  "reasonCode": "SPILLAGE",
  "sourceDoc": { "type": "CONSUMPTION", "id": "cons_456" },
  "createdAt": "2026-02-26T12:10:00Z",
  "createdBy": "u_gm"
}
```

---

# 15) Acceptance criteria (domain-level)

The domain model is correct only if:

1) You can reconstruct on-hand by replaying movements.
2) Every OUT movement has FIFO lotAllocations.
3) No posted doc is editable.
4) No movement is deleted.
5) A count produces a variance report + adjustment doc (optional).
6) Yield transforms absorb gross cost into usable lot cost.
7) A month can close and reports reconcile.

---

# 16) What we do next

After you approve this domain model:

1) **03_State_Machines.md** becomes stricter (states + guard rules per doc).  
2) **05_Firestore_Schema.md** becomes concrete with indexes + transaction patterns.  
3) We write **Implementation Slice** tests based on this model.

---
