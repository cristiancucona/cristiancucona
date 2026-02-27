# 06_Security_Model.md
## Selio Stocks — Security Model (Masterpiece, In Sync)

**Stack:** Firestore + Cloud Functions (Node) + React Admin  
**Goal:** enforce Source of Truth + Domain invariants through permissions, approvals, immutable ledgers, and data visibility controls.

**Perfect correlation:** this security model enforces:
- Source of Truth: *no deletes*, posted immutable, NIR entry point, bon de consum mandatory, FIFO allocations.
- Domain Model: Documents → Movements → Lots (append-only ledger), reversals/adjustments only.
- State Machines: allowed transitions only, approval gates, lock rules.
- Firestore Schema: client drafts, server posts, movements write-once.

---

# 0) Security philosophy (simple)

Selio Stocks is a financial system.  
So the security model is built on three pillars:

1) **Integrity** — nobody can secretly change stock.  
2) **Traceability** — every critical action has who/when/why.  
3) **Least privilege** — users see only what they need.

**Golden rule:**  
Clients can prepare drafts.  
Only server (Cloud Functions) can post stock-changing events.

---

# 1) Roles (V1 Single-Unit)

We define roles as product roles (not Firebase roles).  
Each user has: `roleId`, optional `scopes` (locations).

## 1.1 Owner
- Full visibility and ultimate approvals
- Can close/reopen periods (V1.5)
- Can approve high-value adjustments

## 1.2 General Manager (GM)
- Runs operations
- Can post NIR/consumption/transfers/production/yield (within policies)
- Can lock inventory counts
- Can initiate adjustments (approval required if above threshold)

## 1.3 Kitchen Manager / Chef
- Can post:
  - waste
  - comp (optional, depending on policy)
  - prep production
  - yield transforms
- Can view:
  - theoretical vs actual usage
- Purchase prices:
  - optional masked (recommended)

## 1.4 Receiving Clerk
- Can create NIR drafts
- Cannot approve/post own NIR (recommended)
- Cannot adjust inventory

## 1.5 Accountant
- Read-only operational
- Full reporting access
- Can export accounting packs
- Cannot post documents that change stock

## 1.6 Staff (Restricted)
- May log waste (optional)
- May participate in inventory counting (count lines only)
- No price visibility
- No adjustments

---

# 2) Permissions (what each role can do)

We separate permission types:

- **Read**: view data
- **WriteDraft**: create/update drafts
- **Post**: transition document to POSTED (stock impact)
- **Approve**: approve someone else’s document (if required)
- **Lock**: lock inventory counts
- **Export**: generate reporting packs

---

# 3) Permission Matrix (V1)

Legend:
- R = Read
- D = Draft create/update
- P = Post
- A = Approve
- L = Lock
- X = Export

| Module / Role | Owner | GM | Chef | Receiving | Accountant | Staff |
|---|---:|---:|---:|---:|---:|---:|
| Items master | R/D | R/D | R | R | R | R |
| Vendors + prices | R/D | R | (masked) | R | R | (no) |
| Receiving (NIR) | R | R/D/P/A | R | R/D | R | (no) |
| Consumption (COMP/WASTE) | R | R/D/P | R/D/P (limited) | R | R | R/D (waste only, optional) |
| Transfers | R | R/D/P | R | (no) | R | (no) |
| Prep production | R | R/D/P | R/D/P | (no) | R | (no) |
| Yield transform | R | R/D/P | R/D/P | (no) | R | (no) |
| Inventory count | R | R/D/L | R/D | R/D | R | R/D (count lines only) |
| Adjustments | R/P/A | R/D/P (A if >threshold) | R | (no) | R | (no) |
| Reports/Dashboards | R/X | R/X | R (no cost?) | R | R/X | R (very limited) |
| Period close (V1.5) | R/P | (no) | (no) | (no) | R | (no) |

**Notes**
- “Chef Post limited”: can post only WASTE/PRODUCTION/YIELD — not adjustments.
- Staff waste logging: optional feature toggle.

---

# 4) Approval policies (separation of duties)

## 4.1 NIR approval (recommended)
- Receiving Clerk creates NIR draft
- GM posts/approves
- Rule: creator cannot approve their own NIR

## 4.2 Adjustments approval
Adjustments are sensitive.
Policy:
- If adjustment value > `ADJUSTMENT_APPROVAL_THRESHOLD`:
  - requires Owner approval OR GM+Owner, depending on org

## 4.3 Waste spike review
If daily waste value exceeds threshold:
- create CRITICAL alert
- GM must ACK

---

# 5) Data visibility & masking

This is crucial for trust + internal politics.

## 5.1 Purchase price visibility
By default:
- Owner, GM, Accountant: full
- Chef: masked vendor unit prices (optional)
- Staff: no pricing

Masking rules:
- hide `vendorPrices`
- hide `unitCostSubunitsPerBase` on lots
- still allow showing *category-level* metrics if needed (e.g., waste %)

## 5.2 Margin visibility
- Owner only by default
- optional for GM

## 5.3 Audit visibility
- Owner and Accountant can export full audit logs
- GM can view operational audit for their unit

---

# 6) Firestore Rules strategy (enforce invariants)

**Core design:**
- React Admin (client) can create documents in `DRAFT`
- Client can edit only if `status == DRAFT`
- Client cannot write to `/movements` or `/lots`
- Only Cloud Functions (service account) can:
  - post documents
  - write movements
  - update lots
  - update projections

This prevents tampering.

---

# 7) Firestore Rules (conceptual pseudocode)

> This is not copy/paste production rules — it is the contract.
> Implementation will be done in repo.

## 7.1 Documents
Allow create if authenticated and role allows draft:
- `create: if isAuthed() && canWriteDraft(docType)`
Allow update only if:
- `resource.data.status == 'DRAFT'`
- and `canWriteDraft(docType)`
Deny updates if status != DRAFT.

Allow read if role allows:
- `canRead(docType)`

Allow delete: **never**
- `delete: if false`

## 7.2 Lines
Lines inherit document permissions:
- create/update only while parent doc is DRAFT
- delete never

## 7.3 Movements
- client create/update/delete: deny
- service account only (Cloud Functions):
  - allow create if request.auth.token.admin == true (or via custom claim/service account)

## 7.4 Lots
- client update: deny
- service account writes only

## 7.5 Projections
- reads allowed by role
- writes only by service account

---

# 8) Cloud Functions (authorization layer)

We enforce permissions and state transitions on server.

## 8.1 Shared checks (for every post function)
- verify caller role
- verify doc exists and is in correct state
- verify state machine transition is allowed
- verify required fields and reason codes
- enforce idempotency key
- run Firestore transaction:
  - write doc state change
  - write movements
  - update lots
- emit alerts if necessary

## 8.2 Stock-changing functions (server-only posting)
- `postNir(docId)`
- `postConsumption(docId)`
- `postTransfer(docId)`
- `postPrepProduction(docId)`
- `postYieldTransform(docId)`
- `postAdjustment(docId)`

## 8.3 Inventory lock
- `lockInventoryCount(docId)`:
  - locks count
  - triggers variance compute

## 8.4 Period close (V1.5)
- `closePeriod(periodId)` (Owner only)

---

# 9) Audit requirements (mandatory)

For every critical event:
- who (`createdBy`)
- when (`createdAt`)
- why (`reasonCode` or `note`)
- source doc reference
- deviceId (optional)
- ip hash (optional)

**Specific mandatory reasons**
- Waste: reasonCode required
- Comp: reasonCode required
- Adjustment: reasonCode required + approval if threshold exceeded
- Reopen period: owner note required

---

# 10) Protection against the top fraud patterns

## 10.1 Silent stock rewrite
Prevented by:
- no deletes
- no lot direct edits by client
- ledger append-only

## 10.2 Fake receiving
Mitigations:
- creator cannot approve own NIR
- attachments: delivery photo optional
- anomaly alerts: frequent small NIRs at night (future)

## 10.3 Adjustment abuse
Mitigations:
- thresholds + approvals
- mandatory reason
- adjustment report sent to owner/accountant
- locked periods block backdated adjustments

## 10.4 Hiding waste
Mitigations:
- waste log mandatory for disposal
- waste spikes alert
- inventory count catches unlogged shrinkage

---

# 11) Sync rules with previous documents (checklist)

✅ Documents posted immutable (State Machines)  
✅ No deletes (Source of Truth)  
✅ Stock changes only via movements (Domain Model)  
✅ FIFO allocations required for OUT movements (Domain Model + Schema)  
✅ NIR entry point for receiving (Source of Truth)  
✅ Bon de consum mandatory for non-sale consumption (Source of Truth)  
✅ Yield transforms raw-only (Source of Truth)  
✅ Inventory count lock and variance compute (State Machines)  
✅ Adjustments reconcile, never “set stock” (Domain Model)  

---

# 12) What we implement next

After this document:
- `08_Failure_Scenarios.md` (already exists) will be cross-checked against security gates.
- Then we finalize:
  - Cloud Functions permission middleware
  - Firestore rules (production implementation)

---
