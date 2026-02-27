# GEMINI_ASSIMILATION_MAP.md
## Selio Stocks Engine — Cognitive Assimilation Map for Gemini 3.1 Pro (ANTIGRAVITY Platform)

Version: 1.0  
Status: Cognitive Index – No New Rules Introduced  

---

# 0. Identity Layer

## Product (Runtime System)
Selio Stocks Engine  
→ Financial inventory integrity system  
→ Ledger-driven  
→ FIFO valuation  
→ Adjustment-based reconciliation  

## AI Platform
ANTIGRAVITY (Gemini 3.1 Pro High/Low)  
→ Development assistant  
→ Design validator  
→ Code generator  
→ Audit assistant  
→ NOT runtime authority  

---

# 1. Foundational Truth Layer (Highest Authority)

### 00_Source_of_Truth.md

Defines:

- Financial philosophy
- FIFO at acquisition price
- NIR-only receiving
- Bon de consum mandatory
- Adjustments = delta only
- Yield = gross raw only
- Prime Cost focus

If any document conflicts with this → Source_of_Truth wins.

---

# 2. Conceptual Architecture Layer

### 01_Domain_Model.md

Defines:

- Core Entities (Item, Lot, Movement, Document, Inventory Count)
- Aggregates
- Invariants
- Domain Events
- Value Objects

Core invariant:

Documents → Movements → Lots → Projections

---

# 3. Behavioral Enforcement Layer

### 02_State_Machines.md

Defines:

- Draft → Posted → Reversed
- Lock rules
- Approval gates
- Adjustment discipline
- Period close logic
- Idempotency discipline

If a transition is not defined → it is forbidden.

---

# 4. Operational Layer

### 03_Business_Flows.md

Defines real-world flows:

- Receiving (NIR)
- Consumption (Sold / Comp / Waste)
- Transfers
- Prep Production
- Yield Transform (gross-only)
- Inventory Count
- Adjustments
- Month Close

UX simplicity must never override Domain or State rules.

---

# 5. Persistence Layer

### 04_Firestore_Schema.md

Defines:

- Collections
- Required fields
- Transaction boundaries
- Append-only ledger
- Projection strategy
- entityId (V2-ready)

Database structure must enforce invariants.

---

# 6. Enforcement & Security Layer

### 05_Security_Model.md

Defines:

- Role matrix
- Server-only posting
- Masking rules
- Approval thresholds
- Firestore rule philosophy

Client = Draft only  
Server = Ledger authority  

---

# 7. Resilience Layer

### 06_Failure_Scenarios.md

Defines:

- Negative stock blocking
- Duplicate post idempotency
- POS failure handling
- Projection rebuild
- Period reopen discipline

Failure must never corrupt ledger truth.

---

# 8. AI Governance Layer

### 07_AI_Settings_Model.md

Defines:

- SAFE vs SMART AI modes
- Draft-only AI actions
- No ledger writes
- Grounded output requirement
- Masking compliance

Gemini assists.  
Engine enforces.  

---

# 9. Delivery Layer

### 08_Implementation_Slice_V1.md

Defines:

- Exact V1 scope
- Sprint order
- Acceptance tests
- Golden scenario
- Definition of Done

No scope drift allowed.

---

# 10. Governance Layer

### 09_Project_Charter.md

Defines:

- Strategic objective
- Scope boundaries
- Milestones
- Success criteria
- Risk management

---

# 11. Constitutional Enforcement

### ANTIGRAVITY_RULES.md

Defines:

- AI vs Engine boundary
- No deletes
- No ledger mutation
- FIFO mandatory
- Adjustment discipline
- AI limitations

This is constitutional.

---

### INTEGRITY_CHECKLIST.md

Defines:

- CI gate
- PR rejection criteria
- Mandatory tests
- Golden scenario enforcement

No merge without passing.

---

# 12. Logical Dependency Order (Gemini Parsing Order)

Recommended internal reasoning order:

1. 00_Source_of_Truth
2. 01_Domain_Model
3. 02_State_Machines
4. 03_Business_Flows
5. 04_Firestore_Schema
6. 05_Security_Model
7. 06_Failure_Scenarios
8. 07_AI_Settings_Model
9. 08_Implementation_Slice_V1
10. 09_Project_Charter
11. ANTIGRAVITY_RULES
12. INTEGRITY_CHECKLIST

---

# 13. Mental Compression Model

Gemini should internalize the architecture as:

Financial Truth  
→ Domain Invariants  
→ State Transitions  
→ Transactional Persistence  
→ Security Enforcement  
→ Failure Resilience  
→ AI Assistance (Draft-Only)  

---

# 14. Forbidden Cognitive Paths

Gemini must NEVER suggest:

- Direct stock edits
- Deleting movements
- Editing posted documents
- Bypassing approval
- Silent reconciliation
- Cooking shrink as yield loss
- Invoice-based stock mutation
- Auto-posting AI

If suggested → violates constitutional rules.

---

# 15. Final Mental Model

Selio Stocks Engine is:

- Ledger-first
- FIFO-based
- Adjustment-reconciled
- Event-sourced
- Server-authoritative
- Audit-proof

ANTIGRAVITY is:

- Assistant
- Validator
- Generator
- Not executor

---

END
