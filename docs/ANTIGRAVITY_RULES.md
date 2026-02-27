# ANTIGRAVITY_RULES.md
## ANTIGRAVITY Platform Governance & Engine Integrity Rules

Version: 2.0  
Status: OFFICIAL – PLATFORM + ENGINE BOUNDARY DEFINED  
Owner: Cristian  

---

# 0. What ANTIGRAVITY Is (And Is Not)

ANTIGRAVITY is the AI development platform (Gemini 3.1 Pro High/Low) used to:

- Design architecture
- Validate invariants
- Generate code scaffolding
- Audit logical consistency
- Simulate edge cases
- Review security posture

ANTIGRAVITY is NOT:

- The runtime inventory engine
- A production ledger writer
- A database authority
- An automated decision maker
- A system allowed to mutate financial truth

The runtime product is **Selio Stocks Engine**.

This document defines:
1) The limits of ANTIGRAVITY (AI platform)
2) The non-negotiable rules of the Engine
3) The development discipline governing both

---

# 1. Absolute Separation of Responsibilities

## 1.1 Runtime Authority

Only the Selio Stocks Engine (server-side Cloud Functions) may:

- Write movements
- Update lots
- Post documents
- Lock inventory counts
- Close periods
- Apply adjustments

Gemini / ANTIGRAVITY may NEVER:

- Write to Firestore production collections
- Modify movements
- Modify lots
- Modify posted documents
- Override approvals
- Bypass security rules

If AI writes ledger data directly → architecture is compromised.

---

# 2. Gemini (ANTIGRAVITY) Operational Limits

## 2.1 Allowed Capabilities

Gemini may:

- Propose architecture
- Generate draft code
- Generate test cases
- Suggest improvements
- Perform static audits
- Detect logical inconsistencies
- Generate documentation
- Create draft documents (never post)
- Generate CI validation logic

## 2.2 Forbidden Capabilities

Gemini must NEVER:

- Execute production ledger writes
- Trigger Cloud Functions that post documents
- Auto-approve adjustments
- Bypass approval thresholds
- Suppress alerts
- Modify Firestore rules dynamically
- Generate hidden business logic not reflected in documentation

---

# 3. Engine Financial Integrity Rules (Non-Negotiable)

These rules apply to Selio Stocks Engine runtime.

## 3.1 No Deletes. Ever.

The following are forbidden:

- Deleting documents
- Deleting movements
- Deleting lots
- Deleting adjustment history

Correction = reversal or new adjustment.

---

## 3.2 Posted = Immutable

If `status != DRAFT`:
- No edit allowed
- No mutation allowed
- No silent correction allowed

---

## 3.3 Movements Are Append-Only

Movements:
- Cannot be updated
- Cannot be merged
- Cannot be deleted

Ledger must be replayable from zero.

---

## 3.4 FIFO Allocation Is Mandatory

Every OUT movement must:
- Allocate FIFO lots
- Store lotAllocations[]
- Store valueSubunits

Missing allocation = invalid ledger.

---

## 3.5 Lots Never Go Negative

`lot.qtyOnHandBase < 0` is forbidden.

If allocation insufficient → block transaction.

---

## 3.6 NIR Is The Only Receiving Entry

Inventory increase allowed only via:
- POSTED NIR
- POSTED Prep Production
- POSTED Yield Transform (usable)
- POSTED Adjustment (delta > 0)

Invoice never increases stock.

---

## 3.7 Bon de Consum Is Mandatory

All non-sale consumption must be logged:
- COMP
- WASTE
- STAFF_MEAL
- TEST_BATCH

No silent shrinkage allowed.

---

## 3.8 Yield Modeling Constraint

Yield applies only to:
- Gross raw processing

Yield does NOT apply to:
- Frying shrink
- Baking shrink
- Boiling evaporation
- Thawing water loss

---

## 3.9 Adjustments Never “Set Stock”

Adjustments compute:
```
delta = counted − theoretical
```

Adjustments produce movements.
They never overwrite quantities.

---

# 4. Security Enforcement Rules

## 4.1 Client Boundaries

React Admin:
- Can create DRAFT documents
- Cannot post
- Cannot write movements
- Cannot write lots

Posting = Cloud Function only.

---

## 4.2 Approval Discipline

High-risk actions require:

- Adjustment above threshold → approval
- Optional: NIR creator ≠ approver

---

## 4.3 Masking Discipline

If a role cannot see purchase price:
- UI must not show it
- AI must not reveal it

---

# 5. AI Governance Rules

## 5.1 AI Draft-Only Policy

AI may:
- Create draft suggestions
- Suggest reorder lists
- Suggest adjustments (as draft)
- Suggest investigations

AI may NOT:
- Post documents
- Write movements
- Modify posted data

---

## 5.2 Grounded Output Requirement

Every AI recommendation must:
- Reference source data
- Show calculation logic
- Indicate uncertainty if present

No hallucinated financial numbers allowed.

---

# 6. Development Governance

## 6.1 Code Review Gate

Every PR must validate:

- INTEGRITY_CHECKLIST.md
- No ledger mutation
- No delete usage
- FIFO enforced
- Idempotency enforced

---

## 6.2 CI Mandatory Tests

Before merge:

- FIFO allocation correctness
- Negative stock block
- Duplicate post idempotency
- Reversal correctness
- Adjustment correctness
- Yield absorption math

Fail any test → no merge.

---

# 7. Projection Discipline

Projections are derived views.
They are not truth.

System must be able to:
- Drop projections
- Rebuild from movements + lots

If rebuild not possible → architecture invalid.

---

# 8. Period Close Discipline

After close:

- No backdated posting
- No silent change
- Reopen = Owner only + reason logged

---

# 9. Platform Integrity Mantra

Gemini assists.  
Engine enforces.  
Ledger decides.  

ANTIGRAVITY designs.  
Selio Stocks Engine executes.  

Integrity over convenience.  
Always.

---

# END
