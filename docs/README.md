 # Selio Stocks — Financial Integrity First

Selio Stocks is the core inventory control engine powering **Selio Stocks**.

It is not a CRUD app.
It is not a spreadsheet replacement.
It is a **financial integrity system** built around an immutable ledger, FIFO valuation, and audit-safe operations.

---

# 1. Mission

Build a stock management engine for Hospitality that:

- Never corrupts inventory
- Never rewrites history
- Always reconciles with accounting
- Survives real-world chaos (POS failures, late invoices, human mistakes)

If it cannot pass an inventory reconciliation after a physical count, it is not production-ready.

---

# 2. Architecture Principles

Selio Stocks is built on:

- 🔹 Firestore (document database)
- 🔹 Cloud Functions (server-side posting & transactions)
- 🔹 React Admin (UI)
- 🔹 Immutable Movement Ledger
- 🔹 FIFO Lot Valuation

Core principle:

```
Documents → Movements → Lots → Projections
```

Truth lives in:
- Movements
- Lots

Everything else is derived.

---

# 3. Core Documents

All stock changes originate from one of these:

- NIR (Receiving)
- Bon de consum (Comp / Waste)
- Transfer
- Prep Production
- Yield Transform (gross → usable)
- Inventory Count
- Adjustment
- Period Close (V1.5)

Each document follows a strict state machine:
- DRAFT
- POSTED
- REVERSED
- (or LOCKED / CLOSED where applicable)

---

# 4. Non‑Negotiables

- No deletes
- Posted = immutable
- All OUT movements store FIFO allocations
- NIR is the only receiving entry point
- Bon de consum is mandatory for non-sale consumption
- Yield loss applies only to raw processing
- Adjustments reconcile, never set stock
- AI cannot write ledger

See:
`ANTIGRAVITY_RULES.md`

---

# 5. Folder Structure

```
/Selio Stocks
 ├── 01_Project_Charter.md
 ├── 02_Business_Flows.md
 ├── 03_State_Machines.md
 ├── 04_Domain_Model.md
 ├── 05_Firestore_Schema.md
 ├── 06_Security_Model.md
 ├── 07_AI_Settings_Model.md
 ├── 08_Failure_Scenarios.md
 ├── 09_Implementation_Slice_V1.md
 ├── ANTIGRAVITY_RULES.md
 └── README.md
```

Read order (recommended):

1. Domain Model
2. State Machines
3. Business Flows
4. Firestore Schema
5. Security Model
6. Failure Scenarios
7. Implementation Slice

---

# 6. V1 Scope

Single-unit only.

Includes:
- FIFO lots
- NIR
- Comp/Waste logging
- Transfers
- Prep production
- Yield (raw only)
- Inventory count
- Adjustments
- Exports

Excludes:
- Multi-unit consolidation
- Auto-post AI
- Forecasting
- EDI automation

---

# 7. Development Discipline

Before merging code:

- Ledger integrity verified
- FIFO allocation tested
- Negative stock blocked
- Idempotency enforced
- Reversal works
- Adjustment works
- Golden scenario test passes

If integrity is compromised → rollback.

---

# 8. Philosophy

ANTIGRAVITY protects the business from:

- Shrinkage
- Hidden waste
- Silent stock edits
- Accounting mismatch
- Operational chaos

We do not optimize for convenience first.
We optimize for correctness first.

---

# 9. Mantra

Ledger first.  
Integrity always.  
Convenience later.
