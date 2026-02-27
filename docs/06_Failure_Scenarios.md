# 08_Failure_Scenarios.md
## Selio Stocks — Failure Scenarios (Masterpiece, In Sync)

**Stack:** Firestore + Cloud Functions (Node) + React Admin  
**Goal:** design for real restaurant failure modes without breaking accounting truth.

**Perfect correlation:** this document is aligned with:
- Source of Truth: no deletes, posted immutable, FIFO, NIR entry point, bon de consum mandatory
- Domain Model: Documents → Movements → Lots (append-only), reversals/adjustments only
- State Machines: allowed transitions, lock rules, approval gates
- Firestore Schema: transactions for posting, projections, server-only ledger writes
- Security Model: clients draft only; server posts; audit trail mandatory

---

# 0) Golden rules under failure

When something goes wrong, Selio Stocks must still preserve:

1) **Integrity**  
   - never corrupt lots or movements
2) **Auditability**  
   - never hide errors; always create alerts
3) **Recoverability**  
   - allow safe recovery paths: retry, reversal, adjustment, reopen period

**The only valid stock truth is the movement ledger + lots.**

---

# 1) POS sync fails (network/API down)

## Symptoms
- SALES stop updating
- Theoretical usage is missing (SOLD lane)

## Expected behavior (system)
- Create alert: `POS_SYNC_FAILED` (severity WARN/CRITICAL)
- Keep NIR/Bon/Transfers/Counts functioning normally
- Provide manual import fallback (CSV) with audit note
- Do NOT silently “guess” consumption

## Recovery
- Automatic retries with exponential backoff
- On recovery, re-run sync for missing window
- Emit event: `PosSyncApplied`

## Accounting truth impact
- If using theoretical ledger (V1 recommended):
  - variance will be incomplete until POS data is applied
- If using consume movements:
  - block “close period” until POS sync is applied or explicitly waived by Owner

---

# 2) Duplicate posting (double click / retry / timeout)

## Symptoms
- Same NIR or Bon appears posted twice
- Inventory jumps unexpectedly

## Prevention (must)
- `idempotencyKey` stored on document header
- Cloud Function checks:
  - if doc.status == POSTED → return success (no-op)
  - if idempotencyKey seen → return previous result

## Recovery
- Never delete.
- Reverse the duplicate document (create reversal doc) OR
- Post correction adjustment (only if reversal blocked by consumption)

## Alerts
- `DUPLICATE_POST_ATTEMPT` if detected

---

# 3) Negative stock (consumption > on-hand)

## Symptoms
- Posting consumption/transfer tries to allocate lots but qtyOnHand is insufficient

## Default policy (V1 recommended): STRICT BLOCK
System behavior:
- Reject posting
- Create alert: `NEGATIVE_STOCK_BLOCKED` (CRITICAL)
- Display: “Missing receiving or incorrect counts. Fix before posting.”

## Alternative policy (not recommended in V1): CONTROLLED NEGATIVE
Allowed only if:
- Owner enables feature flag
- Automatic requirement: resolve within N hours
- Automatic CRITICAL alert + owner notification

## Recovery path (strict)
1) Post missing NIR (if delivery happened but wasn’t recorded)
2) If truly missing stock: post Adjustment (with reason + approval)

---

# 4) Late invoice / invoice mismatch (e-Factura reality)

## Symptoms
- Invoice arrives later than delivery
- Invoice quantities/prices differ from NIR

## Truth rule
Inventory is based on **NIR**, not invoice.

## System behavior
- Store invoice reference as reconciliation metadata
- Create task/alert: `INVOICE_MISMATCH` if mismatch detected
- Do NOT modify lots or movements automatically

## Recovery
- Manager resolves with supplier/accounting
- If receiving qty was wrong:
  - recommended: post adjustment with reason and approval
  - avoid editing NIR after posting (forbidden)

---

# 5) Partial delivery vs expected (PO or invoice expectations)

## Symptoms
- Delivery includes only part of ordered items

## System behavior
- NIR should contain only delivered items
- Remaining items = separate NIR later
- Optional: “pending items list” for tracking (no stock impact)

---

# 6) Retro-posting (backdated receiving/waste)

## Symptoms
- Someone tries to post a document with a past `documentDate`

## Rules (from state + period close)
- Allowed only within OPEN period
- After period CLOSED:
  - must reopen period (Owner-only, audited)
  - or block

## System behavior
- If CLOSED: show “Period closed. Reopen required.”
- Create alert: `BACKDATED_POST_BLOCKED` if attempted

---

# 7) Reversal after downstream consumption (hard reality)

## Symptoms
- User tries to reverse a NIR or production doc whose lots are already partially consumed

## V1 recommended strict policy
- Block reversal (to prevent cascading ledger distortions)
- Recommend corrective path:
  - Adjustment OR
  - Create a new correcting document (e.g., negative receiving with approval) depending on policy

## System behavior
- Explain: “Cannot reverse: lot already consumed. Use Adjustment.”
- Create alert: `REVERSAL_BLOCKED_DOWNSTREAM_USAGE`

---

# 8) Wrong UoM conversion (supplier changes pack size)

## Symptoms
- Suddenly 1 box = different kg
- counts and costs become inconsistent

## Core rule
Conversions must be **versioned**, never edited retroactively.

## System behavior
- Item conversion updates apply only forward
- Historical docs retain their conversion snapshot (stored on doc line)

## Recovery
- Update item conversion for future
- If past receiving was wrong, use adjustment (with reason/approval)

Alerts:
- `UOM_CONVERSION_CHANGED` (INFO)
- `UOM_CONVERSION_SUSPICIOUS` (WARN) if extreme delta

---

# 9) OCR / scanning errors (barcode, camera)

## Symptoms
- Wrong item scanned
- Wrong qty entered due to scan misread

## Prevention
- Confirmation step: show item name + baseUom conversion preview
- For high-value items: require manual confirmation

## Recovery
- If still DRAFT: edit freely
- If POSTED: reverse (if allowed) or adjustment (if reversal blocked)

---

# 10) Concurrency conflicts (two users posting/counting)

## A) Two users posting same draft
Prevention:
- Document `version` field
- Cloud Function checks version at post time (optimistic concurrency)

Recovery:
- One post succeeds; the other is rejected with clear message

## B) Two inventory counts for same location
Policy:
- Only one active count session per location (recommended)
- Allow override only for Owner/GM

---

# 11) Offline inventory count (mobile)

## Symptoms
- Staff counts offline, network drops

## Required behavior
- Offline-first storage on device
- Sync later
- Prevent LOCK if not fully synced

## Recovery
- Resume sync, then lock
- If partial sync, show missing lines

Alert:
- `COUNT_SYNC_INCOMPLETE`

---

# 12) Projection drift (onHand projection != lots sum)

## Symptoms
- UI on-hand differs from underlying lots

## Truth rule
Lots are truth for on-hand, projections are only for speed.

## Detection
- Daily Cloud Function sanity check:
  - sum lots vs projection qty/value
  - if mismatch > tolerance: raise alert

Alert:
- `PROJECTION_DRIFT_DETECTED` (CRITICAL)

## Recovery
- Rebuild projections from movements/lot sums
- Log rebuild event

---

# 13) High waste spikes (fraud/operations)

## Symptoms
- Waste cost spikes above daily threshold

## System behavior
- Create `HIGH_WASTE` CRITICAL alert
- Require GM acknowledgement
- Highlight top waste reasons/items

## Recovery
- Ops review:
  - portioning
  - storage temperature
  - receiving quality
  - theft indicators

---

# 14) Yield transform misuse (cooking shrink reported as yield loss)

## Symptoms
- Staff tries to log frying/baking loss as yield loss

## Rule (mandatory)
Yield transform applies only to **raw processing** (gross→usable).
No cooking shrinkage allowed.

## System behavior
- Yield categories limited to raw processing only
- Block “cooking” categories
- Create `YIELD_MISUSE_BLOCKED` alert if attempted

---

# 15) Period close errors (V1.5)

## Symptoms
- Period is closed but a critical doc is missing (late NIR/late count)

## System behavior
- Close function must validate:
  - no unposted drafts in period
  - count locked (month-end)
  - POS sync applied (or owner waiver)
- If validation fails: block close and show checklist

## Recovery
- Post missing docs (within OPEN)
- Or reopen closed period (Owner-only) with audit note

Alerts:
- `CLOSE_VALIDATION_FAILED`
- `PERIOD_REOPENED`

---

# 16) Disaster recovery (operator mistakes)

## Accidental wrong posting
- No deletes
- Reversal/adjustment path only
- Always requires reason codes and approvals

## Data corruption fear
- Ledger + lots allow reconstruction:
  - movements replay can rebuild projections
  - lot history provides valuation trace

---

# 17) Operational “playbook” summary (what to do when it breaks)

1) **Posting blocked (negative stock)**  
   → find missing NIR OR count & adjust with approval

2) **POS down**  
   → keep ops running; import later; block close until fixed

3) **Wrong posted doc**  
   → reversal if no downstream usage; otherwise adjustment

4) **Period closed mistake**  
   → reopen (Owner), fix, close again (audited)

---

# 18) Checklist (kept in sync)

✅ No deletes, ever  
✅ Posted documents immutable  
✅ All stock changes via movements  
✅ FIFO allocations stored for every OUT  
✅ NIR is the only receiving entry point  
✅ Bon de consum mandatory for non-sale consumption  
✅ Yield loss is raw processing only  
✅ Counts lock snapshot and compute variance  
✅ Adjustments reconcile; never set stock  
✅ Functions enforce state machine + permissions  
✅ Projections are rebuildable, never truth

---
