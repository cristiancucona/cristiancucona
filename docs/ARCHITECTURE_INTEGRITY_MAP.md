# ARCHITECTURE_INTEGRITY_MAP.md
## Selio Stocks Engine — Integrity Alignment Map

Version: 1.0  
Status: Baseline Alignment Reference  

This document maps every architectural invariant to:
- Its authoritative source document
- The enforcement layer
- The technical control mechanism
- The CI/Test coverage requirement

It exists to guarantee zero logical drift across the system.

---

# 1. Ledger Immutability

## Invariant
Movements are append-only. No delete. No update.

## Defined In
- 00_Source_of_Truth.md
- 01_Domain_Model.md
- ANTIGRAVITY_RULES.md

## Enforced In
- 02_State_Machines.md
- 04_Firestore_Schema.md
- 05_Security_Model.md

## Technical Control
- Firestore rules: deny update/delete on `/movements`
- Cloud Functions only write movements
- No `.update()` on movement docs in codebase

## CI Coverage
- Movement immutability test
- Static scan: no delete/update on movements

---

# 2. Posted Document Immutability

## Invariant
If status != DRAFT → no modification allowed.

## Defined In
- 00_Source_of_Truth.md
- 02_State_Machines.md
- ANTIGRAVITY_RULES.md

## Enforced In
- 05_Security_Model.md
- Firestore rules (status check)

## Technical Control
- Server-side status validation before post
- Firestore rule: deny update if status != DRAFT

## CI Coverage
- Attempt update on POSTED doc → must fail

---

# 3. FIFO Allocation Mandatory

## Invariant
Every OUT movement must store lotAllocations[].

## Defined In
- 01_Domain_Model.md
- 00_Source_of_Truth.md

## Enforced In
- 02_State_Machines.md
- 04_Firestore_Schema.md

## Technical Control
- Allocation logic in `post*` Cloud Functions
- Reject posting if allocations missing

## CI Coverage
- OUT movement must contain allocations
- FIFO order correctness test

---

# 4. Lots Never Negative

## Invariant
lot.qtyOnHandBase >= 0 at all times.

## Defined In
- 01_Domain_Model.md
- ANTIGRAVITY_RULES.md

## Enforced In
- 02_State_Machines.md
- 04_Firestore_Schema.md
- 06_Failure_Scenarios.md

## Technical Control
- Transaction-level allocation check
- Reject if insufficient stock

## CI Coverage
- Negative stock block test

---

# 5. NIR-Only Receiving

## Invariant
Inventory increases only via POSTED NIR / Production / Yield / Positive Adjustment.

## Defined In
- 00_Source_of_Truth.md
- 01_Domain_Model.md

## Enforced In
- 02_State_Machines.md
- 04_Firestore_Schema.md

## Technical Control
- No other docType allowed to increase stock
- Invoice does not mutate lots

## CI Coverage
- Attempt stock increase without NIR → fail

---

# 6. Bon de Consum Mandatory

## Invariant
All non-sale consumption must be logged.

## Defined In
- 00_Source_of_Truth.md
- 03_Business_Flows.md

## Enforced In
- 02_State_Machines.md
- 05_Security_Model.md

## Technical Control
- No direct lot mutation allowed
- Waste/Comp requires reasonCode

## CI Coverage
- Waste without reasonCode → reject

---

# 7. Yield Modeling Constraint

## Invariant
Yield applies only to gross raw processing (not cooking shrink).

## Defined In
- 00_Source_of_Truth.md

## Enforced In
- 02_State_Machines.md
- 03_Business_Flows.md
- 06_Failure_Scenarios.md

## Technical Control
- Allowed yield categories whitelist
- Reject invalid categories

## CI Coverage
- Attempt cooking shrink yield → reject

---

# 8. Adjustments Reconcile Delta Only

## Invariant
Adjustments compute delta = counted − theoretical.
They do not overwrite stock.

## Defined In
- 00_Source_of_Truth.md
- 01_Domain_Model.md

## Enforced In
- 02_State_Machines.md
- 04_Firestore_Schema.md

## Technical Control
- Adjustment creates movement(s) only
- No direct stock overwrite path

## CI Coverage
- Adjustment must produce movement
- No direct lot set operation allowed

---

# 9. AI Boundary

## Invariant
AI cannot write ledger or post documents.

## Defined In
- ANTIGRAVITY_RULES.md
- 07_AI_Settings_Model.md

## Enforced In
- 05_Security_Model.md
- Firestore rules
- Cloud Function boundaries

## Technical Control
- AI only creates drafts
- No AI-triggered ledger writes

## CI Coverage
- AI write to `/movements` blocked
- AI cannot transition status to POSTED

---

# 10. Period Close Locking

## Invariant
Closed period blocks backdated posting.

## Defined In
- 02_State_Machines.md
- 09_Project_Charter.md

## Enforced In
- 05_Security_Model.md
- 06_Failure_Scenarios.md

## Technical Control
- Period state validation before post
- Owner-only reopen

## CI Coverage
- Backdated post after close → reject

---

# 11. Projection Discipline

## Invariant
Projections are derived; ledger is truth.

## Defined In
- 04_Firestore_Schema.md
- 06_Failure_Scenarios.md

## Enforced In
- Projection rebuild function
- No business logic depends solely on projections

## CI Coverage
- Drop projections → rebuild from movements must succeed

---

# 12. Dependency Hierarchy

Truth priority order:

1. 00_Source_of_Truth
2. 01_Domain_Model
3. 02_State_Machines
4. 04_Firestore_Schema
5. 05_Security_Model
6. 06_Failure_Scenarios
7. 07_AI_Settings_Model
8. 08_Implementation_Slice_V1
9. 09_Project_Charter
10. ANTIGRAVITY_RULES
11. INTEGRITY_CHECKLIST

If conflict detected → higher layer wins.

---

# END
