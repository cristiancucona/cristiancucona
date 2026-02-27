# 07_AI_Settings_Model.md
## Selio Stocks — AI Settings Model (Masterpiece, In Sync)

**Stack:** Firestore + Cloud Functions (Node) + React Admin  
**Goal:** add AI without ever breaking accounting truth.

**Perfect correlation:** this AI model is aligned with:
- Source of Truth: ledger truth, no deletes, posted immutable, FIFO, NIR-only receiving, bon de consum mandatory
- Domain Model: Documents → Movements → Lots; corrections via reversal/adjustment only
- State Machines: transitions are server-controlled; locking and approvals exist
- Firestore Schema: clients draft; server posts; movements/lots are server-only
- Security Model: role-based access + masking; approvals for sensitive actions
- Failure Scenarios: AI must not “paper over” failures; it must surface them

---

# 0) AI philosophy (simple)

AI in Selio Stocks is **a copilot**, not an autopilot.

AI is allowed to:
- explain
- detect anomalies
- suggest actions
- generate drafts

AI is NOT allowed to:
- post documents
- modify posted documents
- write movements
- change lots
- override approvals
- hide missing data

**Golden rule:** AI can propose, humans decide, server enforces.

---

# 1) AI modes (V1 vs V2)

## 1.1 SAFE mode (V1 default)
- No auto-posting
- No silent corrections
- Output = suggestions + draft documents + explanations
- AI always shows “Why” (data references)

## 1.2 SMART mode (V2 / later)
- Learns baselines from history (yield, waste, variance patterns)
- More proactive detection
- Still: no auto-posting; still draft-only unless explicitly enabled by Owner (future)

---

# 2) AI capability map (what AI can do)

## 2.1 In V1 (SAFE)
AI can:
1) **Variance investigation assistant**
   - rank probable causes using:
     - vendor price changes
     - missing recipe mappings
     - yield transforms history
     - waste/comp spikes
     - inventory count deltas
2) **Expiry risk assistant**
   - highlight lots near expiry and suggest usage
3) **Reorder suggestions (draft purchase list)**
   - using PAR levels (static) + lead time
4) **Data quality warnings**
   - missing recipes
   - unpriced lots
   - suspicious UoM changes
   - projection drift
5) **Explain numbers**
   - “why did food cost jump?”
   - “why is variance high on chicken?”

AI cannot:
- reconcile by itself
- generate “fake receiving”
- change inventory values

## 2.2 In V2 (SMART)
AI can additionally:
- learn expected yield baselines per item
- learn waste baselines per category
- anomaly detection with seasonality
- demand forecasting (optional module)

Still cannot:
- post or mutate ledger

---

# 3) AI Settings Objects (data model)

We keep AI config explicit and auditable.

## 3.1 /aiSettings/organization (single doc)
Fields:
- `entityId?`
- `enabled`: bool
- `mode`: `SAFE | SMART`
- `language`: `ro | en`
- `explanationLevel`: `SHORT | FULL`
- `allowAutoDrafts`: bool  (default true)
- `allowAutoPost`: bool     (default false; **must stay false in V1**)
- `createdAt`, `createdBy`
- `updatedAt`, `updatedBy`

## 3.2 /aiSettings/yieldLearning
Fields:
- `enabled`: bool
- `minSamples`: int (e.g., 10)
- `lookbackDays`: int (e.g., 90)
- `alertThresholdPercent`: int (e.g., 5)
- `useByCategoryOverrides`: bool

Output:
- suggested `expectedYieldPercent`
- suggested `yieldTolerancePercent`

## 3.3 /aiSettings/varianceAnomaly
Fields:
- `enabled`
- `sensitivity`: 1..5
- `lookbackDays`
- `notifyRoles[]`

Output:
- alerts + investigation hints

## 3.4 /aiSettings/reorder
Fields:
- `enabled`
- `method`: `STATIC_PAR | DYNAMIC_PAR` (V1 default STATIC_PAR)
- `safetyStockPercent`
- `leadTimeDaysDefault`
- `vendorLeadTimeOverrides` (map)
- `minOrderValueSubunits?`

Output:
- draft purchase list (not a posted document)

## 3.5 /aiSettings/expiry
Fields:
- `enabled`
- `warningDaysDefault`
- `categoryOverrides`
- `notifyRoles[]`

Output:
- expiry alerts + suggestions

---

# 4) AI Inputs (what data AI is allowed to read)

AI reads only from *approved sources*:

## 4.1 Truth sources (safe)
- `/documents` (posted + drafts, respecting permissions)
- `/movements` (read-only)
- `/lots` (read-only)
- `/projections/*` (read-only)
- `/alerts` (read-only)
- `/items`, `/vendors`, `/vendorPrices`, `/locations`
- POS sales feed snapshots (read-only)
- Recipes/BOM versions (read-only)

## 4.2 Forbidden inputs
- private employee personal data (unless explicitly required and allowed)
- customer personal data

## 4.3 Data masking alignment
AI output must respect the same visibility rules as UI:
- if user can’t see purchase prices, AI can’t output them
- if user can’t see margins, AI can’t reveal them

(Security Model enforcement.)

---

# 5) AI Outputs (what AI can produce)

AI output types:

## 5.1 Suggestions
- plain recommendations + reasons
- never changes stock

## 5.2 Draft documents (allowed)
AI may create DRAFT docs ONLY if:
- user role has WriteDraft permission for that doc type
- `allowAutoDrafts == true`

Examples:
- draft Bon de consum (waste) suggestion
- draft reorder list (purchase intent)
- draft inventory recount task
- draft variance investigation checklist

**AI must never post.** Posting is a user action + Cloud Function.

## 5.3 Alerts (allowed, via Cloud Function)
AI can propose alert creation, but final write should be done server-side:
- `createAlert(type, payload)` callable

Alerts must be explicit and non-accusatory:
- “Possible shrinkage pattern”
- “Unlogged waste risk”
not “someone stole”

---

# 6) Guardrails (hard constraints, enforceable)

These are mandatory and must be enforced in code.

## 6.1 No ledger writes
AI cannot write:
- `/movements`
- `/lots`
- posted `/documents`

Enforcement:
- Firestore Security Rules deny these writes from clients
- Cloud Functions require admin/service identity for ledger writes

## 6.2 No auto-post
- `allowAutoPost` must be false in V1
- posting functions require human auth + permission + state machine guards

## 6.3 Grounding requirement
Every AI recommendation must attach:
- which data signals it used
- timestamps / ranges
- confidence label (LOW/MED/HIGH)

## 6.4 “Missing data” honesty
If required inputs are missing (e.g., missing BOM):
- AI must say it cannot compute accurately
- must generate a task: “create recipe mapping”

No hallucinations.

---

# 7) AI Workflows (how it runs)

We implement AI via Cloud Functions to keep permissions consistent.

## 7.1 Callable Functions (recommended)
- `aiExplainKpi(queryContext)`
- `aiInvestigateVariance(countId | dateRange)`
- `aiSuggestReorder(dateRange)`
- `aiExpirySuggestions(dateRange)`
- `aiDataQualityCheck(dateRange)`

All functions:
- validate caller permissions
- apply masking
- read approved sources
- return structured outputs

## 7.2 Scheduled Jobs (optional)
- daily expiry scan
- daily data quality scan
- weekly variance anomaly scan

Jobs write alerts and projections (server-only).

---

# 8) AI for Variance Investigation (detailed)

**Input**
- countId variance projection
- movements in window
- recent NIRs and vendor price changes
- yield transforms
- waste/comp logs
- POS sync status + missing recipes

**Output (structured)**
For each top variance item:
- probable causes list (ranked)
- evidence pointers:
  - “vendor price up 12% vs last month”
  - “yield below baseline 2 times”
  - “waste spike in last 3 days”
  - “missing recipe mapping for top-selling product”
- recommended actions:
  - “recount this item”
  - “enforce receiving weight checks”
  - “log waste reasons”
  - “create/repair recipe mapping”

**Important:** AI must not accuse theft; it flags risk patterns.

---

# 9) AI for Reorder (V1 SAFE)

**Inputs**
- onHand projection
- PAR settings (static)
- lead time
- recent consumption trends (optional)
- supplier minimums (optional)

**Output**
- draft purchase list by vendor
- reorder quantities
- reason: “below PAR”, “expiry risk”, “high turnover”

**Posting**
- user converts draft to a PO (if used) or a “purchase list” export
- no stock impact until NIR posted

---

# 10) AI for Yield Learning (V2)

**Inputs**
- yield transform events (gross/usable)
- history by item
- seasonality and supplier differences (optional)

**Output**
- suggested expected yield % and tolerance range
- alerts when yield drops below threshold

**No ledger impact** — only settings suggestions.

---

# 11) Testing & evaluation (so AI doesn’t lie)

We treat AI like production software.

## 11.1 Golden questions set
Maintain a curated set of questions:
- “Why did food cost increase this week?”
- “Top 10 variance drivers this month?”
- “Which items have expiry risk?”

## 11.2 Groundedness checks
For sampled AI responses:
- verify claims correspond to actual data in Firestore
- reject responses with ungrounded numbers

## 11.3 Failure mode tests
- missing recipes
- POS down
- unpriced lots
AI must:
- raise alerts
- provide correct next steps
- never fabricate consumption

---

# 12) Security sync checklist (no omissions)

✅ AI cannot write movements or lots (schema + rules)  
✅ AI cannot post documents (state machine + functions)  
✅ AI respects role masking (security model)  
✅ AI surfaces missing data honestly (failure scenarios)  
✅ AI outputs structured evidence and actions  
✅ AI only creates drafts if role allows  

---
