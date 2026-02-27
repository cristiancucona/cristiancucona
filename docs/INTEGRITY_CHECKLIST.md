# INTEGRITY_CHECKLIST.md
## Selio Stocks Engine — Code Review + CI Gate (Non‑Negotiable)

Version: 1.0  
Status: OFFICIAL CI GATE  
Owner: Cristian  

**Purpose:** This checklist is a hard gate for merges and releases.  
If any item fails → **NO MERGE / NO RELEASE**.

**Note:** `ARCHITECTURE_INTEGRITY_MAP.md` explains *why* and *where* invariants are enforced.  
This file is the *practical gate* the team runs on every PR/CI.

---

# 1) Absolute Blockers (instant reject)

## 1.1 Any delete capability
- Any Firestore delete on:
  - `/documents`
  - `/documents/*/lines`
  - `/movements`
  - `/lots`
  - `/projections` (optional, but recommended deny client deletes)
- Any code path that deletes/overwrites posted history

✅ Fix method must be: **Reversal document** or **Adjustment document**.

## 1.2 Any client write to ledger
React Admin must not write to:
- `/movements`
- `/lots`

Posting must be server-only (Cloud Functions).

## 1.3 Any mutation of POSTED docs
- If `status != DRAFT` → deny edits
- No “edit posted line” UX
- No “fix posted” shortcut

## 1.4 Any OUT movement without FIFO allocations
- Every OUT movement must include `lotAllocations[]`
- Missing allocations = invalid ledger

## 1.5 Any possibility of negative lot qty
- `lot.qtyOnHandBase` must never drop below 0
- If insufficient stock → block posting + alert

---

# 2) PR Review Checklist (reviewer must validate)

## 2.1 Source of Truth compliance
- NIR is the only receiving entry point
- Bon de consum mandatory for non-sale consumption (COMP/WASTE/STAFF_MEAL/TEST_BATCH)
- Yield loss = gross raw processing only (no cooking shrink)
- Adjustments reconcile delta only (never set stock)

## 2.2 Domain model compliance
- Stock changes only via Movements (append-only)
- Lots created only by NIR / Prep / Yield / Positive Adjustment
- Reversal-only corrections (no retro edits)

## 2.3 State machine compliance
- Allowed transitions only (DRAFT → POSTED via function)
- POSTED → REVERSED only via reversal doc (or defined reversal flow)
- Inventory count: SUBMITTED → LOCKED only
- Period close: OPEN → CLOSED; reopen Owner-only

## 2.4 Firestore schema compliance
- Required fields present:
  - `createdAt`, `createdBy`
  - `sourceDoc: {docType, docId}` on movements
  - `documentDate` copied to movements
- Money in integer subunits
- Qty in baseUom (integer base units preferred)

## 2.5 Security compliance
- Role checks enforced server-side
- Masking respected (no price leak)
- Approval thresholds enforced for adjustments
- Separation of duties enforced where enabled (creator ≠ approver for NIR)

## 2.6 Failure resilience
- Idempotency key used in all post functions
- Duplicate post is safe no-op (no double movements)
- Projection rebuild supported (admin tool)

## 2.7 AI constraints
- AI never writes ledger
- AI never posts
- AI drafts only, respecting role permissions + masking

---

# 3) Mandatory Metadata (every record)

## 3.1 Documents (header)
- `docType`
- `status`
- `documentDate`
- `createdAt`, `createdBy`
- `meta.idempotencyKey` (required for posting flows)
- `postedAt` (on post)
- `reversedByDocId` (on reverse)

## 3.2 Movements (ledger)
- `type`
- `itemId`, `locationId`
- `qtyBase` (signed)
- `valueSubunits`
- `sourceDoc`
- `createdAt`, `createdBy`
- `documentDate`
- `lotAllocations[]` for OUT types
- `reasonCode` for WASTE/COMP/ADJUSTMENT

## 3.3 Lots (FIFO)
- `itemId`, `locationId`
- `createdAt`
- `unitCostSubunitsPerBase`
- `qtyOnHandBase`
- `sourceDoc`

---

# 4) Mandatory Automated CI Gates

## 4.1 Unit tests (core)
- FIFO allocation order correctness
- FIFO allocation value correctness
- Negative stock block
- Idempotency (posting twice does not double-write)
- Posted doc immutability enforcement
- Movement immutability enforcement
- Adjustment delta logic (positive + negative)
- Yield transform gross→usable cost absorption

## 4.2 Integration tests (Firestore emulator)
- `postNir()` creates lot + movement, updates doc state
- `postConsumption()` allocates FIFO, decrements lots, writes movement
- `postTransfer()` writes OUT+IN, preserves value
- `postYieldTransform()` writes gross OUT + usable IN + YIELD_LOSS
- `lockInventoryCount()` locks and triggers variance compute
- `postAdjustment()` consumes FIFO for negative, creates lot for positive

## 4.3 Security tests
- Client cannot write `/movements` or `/lots`
- Client cannot edit POSTED `/documents`
- Unauthorized roles cannot view masked fields
- Approvals required above threshold

## 4.4 Static checks (lint)
- No Firestore `.delete()` calls in posting logic
- No Firestore `.update()` on `/movements`
- No direct writes to `/lots` from client code

---

# 5) Golden Scenario (must pass before release)

Run this exact scenario in CI + staging:

1) NIR: receive 10kg chicken @ 40 RON/kg  
2) Yield transform: 10kg gross → 7kg usable  
3) Waste: 0.2kg usable  
4) Inventory count: verify expected qty  
5) Adjustment: delta 0  
6) Export: valuation matches math  

If any number deviates → NO RELEASE.

---

# 6) Release Gate (production checklist)

- All tests passing
- Firestore rules deployed and verified
- Cloud Functions deployed and smoke-tested
- Projection rebuild tool available
- Alerts verified:
  - POS_SYNC_FAILED
  - NEGATIVE_STOCK_BLOCKED
  - PROJECTION_DRIFT_DETECTED

---

# 7) Reviewer Signature (manual)

Before merge, reviewer must confirm:

- ✅ Ledger append-only
- ✅ FIFO allocations exist for every OUT
- ✅ No deletes / no posted edits
- ✅ Server-only posting
- ✅ Security + masking preserved
- ✅ Golden scenario still passes

---

# END
