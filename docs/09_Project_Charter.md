# 09_Project_Charter.md
## Selio Stocks Engine — Project Charter

Document ID: SELIO-STOCKS-CHARTER-09
Version: 1.0
Status: OFFICIAL BASELINE
Owner: Cristian
Last Updated: 2026-02-26

---

# 1. Executive Summary

Selio Stocks Engine is the financial integrity core of the Selio ecosystem.

Its purpose is to provide:

- Audit-proof inventory control
- FIFO valuation at acquisition price
- Immutable movement ledger
- Adjustment-based reconciliation
- Month-end financial stability

This system is designed to withstand real-world operational chaos while preserving accounting truth.

ANTIGRAVITY (Gemini 3.1 Pro High/Low) is the development platform assisting design and validation.
It is not part of the runtime ledger.

---

# 2. Strategic Objective

Deliver a single-unit (V1) hospitality inventory engine that:

- Eliminates silent stock mutations
- Prevents ledger corruption
- Detects shrinkage
- Forces waste logging discipline
- Reconciles with accounting exports
- Survives POS outages and operational failures

Integrity first. Features second.

---

# 3. Scope Definition — V1 (Single Unit)

## 3.1 In Scope

The following components are mandatory in V1:

1. Item Master
2. Storage Locations (internal)
3. Receiving (NIR)
4. Bon de consum (Comp / Waste)
5. Internal Transfers
6. Prep Production
7. Yield Transform (gross raw only)
8. Inventory Count
9. Adjustments (delta-based)
10. FIFO Lot Engine
11. Movement Ledger (append-only)
12. Owner Dashboard (core KPIs)
13. Reporting & Exports
14. Period Close (basic locking)

All stock flows must follow:

Documents → Movements → Lots → Projections

---

## 3.2 Explicitly Out of Scope (V1)

- Multi-unit consolidation
- Franchise mode
- AI auto-posting
- Forecasting
- Vendor EDI integration
- Invoice OCR automation
- Advanced demand planning
- Revenue optimization

No scope expansion allowed during V1.

---

# 4. Architectural Principles

The engine is built on:

- Firestore (document database)
- Cloud Functions (server-side transaction authority)
- React Admin (UI only, no ledger writes)
- Immutable movement ledger
- FIFO allocation model
- Integer base units
- Integer money subunits

Server = authority  
Client = draft interface  
Ledger = truth

---

# 5. Core Invariants

The following must always hold:

1. No deletes (documents, movements, lots).
2. Posted documents are immutable.
3. Movements are append-only.
4. Every OUT movement stores FIFO lotAllocations.
5. Lots never go negative.
6. NIR is the only receiving entry point.
7. Bon de consum mandatory for non-sale consumption.
8. Yield modeling applies only to raw processing.
9. Adjustments reconcile delta only (never set stock).
10. Period close blocks backdated posting.
11. AI cannot write ledger data.

If any invariant breaks, the system is invalid.

---

# 6. Delivery Milestones

## Milestone 1 — Ledger Core
- FIFO allocation engine
- Lots collection
- Movement append-only ledger
- Strict negative stock block
- On-hand projection

## Milestone 2 — Receiving + Consumption
- NIR draft + post
- Bon de consum draft + post
- Idempotency enforcement

## Milestone 3 — Transfers + Production + Yield
- Transfer engine
- Prep production
- Yield transform (gross-only)

## Milestone 4 — Inventory + Adjustments
- Count sessions
- Snapshot lock
- Variance computation
- Adjustment workflow + approvals

## Milestone 5 — Reporting + Period Close
- Movement ledger export
- Valuation snapshot export
- Waste/Comp reporting
- Period lock discipline

---

# 7. Success Criteria

V1 is considered successful only if:

- Inventory reconciliation deviation < 0.1% unexplained variance
- All OUT movements contain valid FIFO allocations
- No movement mutation detected
- All posting functions idempotent
- Period close prevents retroactive ledger mutation
- CI Integrity Checklist passes 100%
- Golden scenario test passes end-to-end

---

# 8. Risk Management

## Risk 1 — Developer Convenience Over Integrity
Mitigation:
- Mandatory INTEGRITY_CHECKLIST gate

## Risk 2 — Scope Drift
Mitigation:
- Out-of-Scope section locked
- Owner approval required for new features

## Risk 3 — Performance Degradation
Mitigation:
- Projection strategy
- Rebuild capability
- Date-indexed queries

## Risk 4 — Incorrect Yield Usage
Mitigation:
- Hard-coded allowed yield categories
- No cooking shrink classification

---

# 9. Governance Model

Decision Authority:
Cristian

Technical Integrity Enforcement:
Code review + CI gate (INTEGRITY_CHECKLIST.md)

Release Authority:
Owner sign-off required

---

# 10. Versioning Discipline

This document defines the Selio Stocks Engine V1.0 baseline.

Any modification requires:

- Version increment
- Changelog entry
- Impact analysis
- Integrity validation

---

# 11. Final Statement

Selio Stocks Engine is not optimized for speed of development.
It is optimized for correctness of financial truth.

Ledger first.
Integrity always.
Convenience later.

