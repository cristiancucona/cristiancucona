# SELIO STOCKS INTELLIGENCE

## SOURCE OF TRUTH – Hospitality Inventory & Cost Control

**Version 1.0**  
**Status: Authoritative Operational Framework**

---

# 1. PURPOSE

## 1.1 What Selio Stocks is

Selio Stocks is the operational and financial control layer for hospitality inventory.  
It produces a single, auditable answer to:

- What do we have?
- What did we buy?
- What did we consume (sold / comp / waste)?
- What should it have cost (theoretical)?
- What did it actually cost (real)?
- Where is the variance and why?

## 1.2 What this document is

This is the authoritative specification for Selio Stocks.

It defines:

- business rules
- calculations
- required data
- operational SOPs
- exception handling
- UI/UX expectations
- audit trail requirements

If a rule is not here, it is not a rule.

## 1.3 Scope

### In scope

- Purchasing → Receiving (NIR) → Storage → Transfers → Consumption → Inventory Count
- FIFO valuation at acquisition price
- Recipe/BOM costing and theoretical usage
- Waste / Comp / Shrinkage tracking
- Variance analysis and owner dashboards

### Out of scope (for v1)

- demand forecasting
- vendor EDI automation
- advanced ML anomaly detection (comes later)

---

# 2. CORE FINANCIAL PRINCIPLES (NON-NEGOTIABLE)

## 2.1 The money model

### 2.1.1 Profit equation

```
Profit = Revenue − Expenses
```

Selio Stocks exists to control controllable expenses without degrading guest experience.

### 2.1.2 COGS reality

COGS is not “what you bought”.  
COGS is “what you used”.

Therefore Selio must separate:

- Purchases (cash / accounts payable)
- Inventory (asset)
- Usage / COGS (expense)

## 2.2 Prime Cost (Owner KPI #1)

```
Prime Cost = Food Cost + Beverage Cost + Labor Cost
```

Selio Stocks focuses on the first two.  
Labor is included in dashboards to contextualize decisions.

### Benchmarks (guidance, not law)

- Full Service: ≤ 65%
- QSR: ≤ 60%

If Prime Cost is unstable, the business is unstable.

## 2.3 Accounting perspective (Owner clarity)

### 2.3.1 Income statement vs balance sheet

- Income statement = performance over time
- Balance sheet = position at a moment

### 2.3.2 Inventory is an asset until used

- Purchases increase inventory
- Consumption converts inventory to COGS
- Physical inventory count is the reality check

### 2.3.3 Core COGS formula (period)

```
Beginning Inventory
+ Purchases (posted)
− Ending Inventory
= COGS
```

This formula is a control backstop.  
Selio also runs item-level usage using movements + BOM.

---

# 3. DEFINITIONS (GLOSSARY)

## 3.1 Documents

- **PO (Purchase Order)**: intent to buy; optional in v1.
- **NIR / Receiving**: official intake document that posts inventory increases.
- **Invoice**: supplier fiscal document; can arrive before or after delivery.
- **Transfer**: movement of stock between storages/locations.
- **Consumption note (Bon de consum)**: stock decrease event not necessarily linked to a sale.
- **Waste log**: classified disposal (spoilage, prep waste, returned, etc.).
- **Comp/Gratis**: consumption without revenue (still cost).
- **Physical inventory count**: actual stock at a timestamp.

## 3.2 Concepts

- **Theoretical usage**: usage implied by sales × recipe/BOM.
- **Actual usage**: usage recorded by stock movements + counts.
- **Variance**: Actual − Theoretical (by qty and by value).
- **Shrinkage**: unexplained loss (usually theft, counting error, unlogged waste).

## 3.3 Valuation

- **FIFO valuation**: issue stock from oldest lots at acquisition price.
- **Acquisition price**: supplier unit price + attributable costs (if configured).

---

# 4. SYSTEM ARCHITECTURE (BUSINESS)

## 4.1 The Flow of Stock (single source of truth)

Every item flows through these states:

1. Planned (optional PO)
2. Received (NIR posts stock)
3. Stored (tracked by location/bin)
4. Moved (transfer)
5. Used (sale-linked or not)
6. Counted (inventory)
7. Adjusted (variance resolved)

Selio must be able to explain any delta using documents.

## 4.2 Event-sourcing principle

Selio Stocks is event-driven:

- stock never “teleports”
- every change is an event with author, timestamp, reason, and references

---

# 5. DATA MODEL (PRODUCT REQUIREMENTS)

## 5.1 Core entities

### 5.1.1 Item (ingredient / stock item)

Required fields:

- itemId
- name
- category
- baseUom (g/ml/pcs)
- purchaseUom (kg/l/box)
- conversion (purchase→base)
- storage requirements (dry/chilled/frozen)
- yield defaults (optional)
- VAT / fiscal mapping (optional)

### 5.1.2 Vendor

- vendorId
- name
- payment terms

### 5.1.3 Storage Location

- locationId (warehouse/fridge/bar)
- type
- access roles

### 5.1.4 Stock Lot (FIFO layer)

A lot is created on receiving.

- lotId
- itemId
- receivedAt
- expiryAt (optional)
- unitCost
- qtyOnHand (baseUom)
- sourceDoc (nirId)

### 5.1.5 Stock Movement

Immutable movement record:

- movementId
- type: RECEIVE | CONSUME | TRANSFER_OUT | TRANSFER_IN | ADJUSTMENT | WASTE | COMP
- itemId
- qty (baseUom)
- unitCost (for valuation)
- fromLocation / toLocation
- sourceDocId
- createdBy
- createdAt

### 5.1.6 Recipe / BOM (optional for v1 but strongly recommended)

- recipeId
- productId (POS menu item)
- yield
- portions
- ingredients[]: itemId, qty(baseUom), lossFactor(optional)

### 5.1.7 Inventory Count

- countId
- locationId
- snapshotAt
- lines[]: itemId, countedQty(baseUom), notes

## 5.2 Canonical rules

- baseUom is the only truth for math.
- all documents convert to baseUom on input.
- money stored in integer subunits.

---

# 6. PURCHASING SYSTEM (V1)

## 6.1 Vendor discipline

- Approved vendors list
- Price history per item/vendor
- Exception flow for emergency buys

## 6.2 Purchase Order (optional)

If used, PO defines expected price/qty.  
Receiving can reference PO for 3-way control.

---

# 7. RECEIVING (NIR) – THE INVENTORY ENTRY POINT

## 7.1 Non-negotiable rule

No NIR → no inventory increase.

## 7.2 Two real-world scenarios

### A) Invoice first → goods later

- invoice is recorded (accounts payable)
- NIR posts inventory when delivery arrives
- matching happens later

### B) Goods first → invoice later

- NIR posts inventory based on delivery
- invoice arrives later (e-Factura)
- matching happens later

Both must work.

## 7.3 Receiving SOP (operational)

Checklist per delivery:

- verify supplier
- verify quantities (scale/count)
- verify quality + temperature
- verify expiry
- confirm unit prices (if known)
- post NIR
- print/apply labels (date + expiry + lot)

## 7.4 Lot creation

On NIR posting:

- create lots per item line
- assign unitCost
- increase qtyOnHand

---

# 8. STORAGE & FIFO DISCIPLINE

## 8.1 FIFO rules

- items must be date-labeled
- older lots physically in front
- app enforces FIFO valuation regardless of physical mistakes

## 8.2 Expiry risk

Selio tracks:

- days-to-expiry
- lot-level risk alerts

---

# 9. CONSUMPTION (BON DE CONSUM) – REQUIRED

## 9.1 Why it exists

Sales are not enough.  
Hospitality has non-sale consumption:

- comp/gratis
- waste/spoilage
- staff meals
- test batches

Bon de consum is the canonical mechanism to post these decreases.

## 9.2 Consumption types (must be distinct)

1. Sold (generated revenue) – usually derived from POS + recipes.
2. Comp/Gratis (no revenue, but cost) – must be logged.
3. Waste/Spoilage (no revenue, disposed) – must be logged with reason.

## 9.3 Posting logic

When a consumption event is posted:

- allocate qty against FIFO lots (oldest first)
- create movement records
- compute value impact (COGS, comp cost, waste cost)

---

# 10. TRANSFERS BETWEEN LOCATIONS

## 10.1 Rule

Transfers never change total inventory value.  
They only relocate stock.

## 10.2 Transfer posting

- TRANSFER_OUT from source location (FIFO lots)
- TRANSFER_IN to destination location (preserve lot cost)

---

# 11. PHYSICAL INVENTORY COUNT

## 11.1 Purpose

Physical count validates reality.  
It is the audit gate.

## 11.2 Frequency

- high value: weekly
- proteins: weekly
- full count: monthly

## 11.3 Count workflow

- create count session
- freeze snapshot time
- collect counts by location
- lock and submit
- variance computed per item

---

# 12. VARIANCE & ROOT CAUSE ANALYSIS

## 12.1 Variance definitions

- Qty variance = counted − theoretical
- Value variance = qty variance × unit cost (FIFO-weighted)

## 12.2 Investigation playbook

When variance detected:

1. purchasing price variance
2. receiving errors
3. yield variance
4. portion variance
5. unlogged waste/comp
6. theft indicators

No guessing.  
Always isolate.

---

# 13. OWNER DASHBOARD (MVP)

## 13.1 Weekly must-haves

- Food cost %
- Beverage cost %
- Prime cost % (imported labor)
- Inventory value by location
- Waste cost and %
- Comp cost and %
- Top variance items
- Cash tied in stock

## 13.2 Core formulas

- Food cost % = food COGS / food sales
- Beverage cost % = beverage COGS / beverage sales
- Inventory turnover = COGS / avg inventory

---

# 14. RULES ENGINE (IF/THEN) – PRODUCTIZED

## 14.1 Alerts

- IF variance > threshold → recount + manager review
- IF item expiry < X days → push usage suggestion
- IF purchases ↑ and sales flat → inventory build-up risk
- IF food cost ↑ and sales stable → check waste/yield/portioning

## 14.2 Threshold defaults (configurable)

- variance critical: >2% value or >X currency
- waste critical: >Y% category

---

# 15. GOVERNANCE & AUDIT

## 15.1 Audit trail requirements

Every event stores:

- who
- when
- why
- source document
- before/after quantities (derived)

## 15.2 Weekly rhythm

- review variance
- review waste
- review vendor price movements

## 15.3 Monthly rhythm

- full inventory
- menu/recipe review
- par level recalibration

---

# 16. EXECUTION STANDARD

This document overrides:

- verbal rules
- informal habits

If a process is not defined here, it must be specified before use.

---

# APPENDIX A — UI/UX (MINIMUM SCREENS)

1. Stocks Dashboard (Owner)
2. Items (master + UoM conversions)
3. Vendors + price history
4. Receiving (NIR) – create/post
5. Consumption (Bon de consum) – create/post
6. Transfers – create/post
7. Inventory Count – create/submit
8. Variance – investigate/resolve
9. Reports – export (CSV/PDF)

---

# APPENDIX B — EXPORTS (MUST)

- movements ledger (all)
- inventory valuation by lot
- inventory on hand by item/location
- variance report per count
- waste report (by reason)
- comp report (by reason)

---

# 17. PRODUCTION / PREP ITEMS (CRITICAL GAP CLOSED)

## 17.1 Definition

A Prep Item is an internally produced stock item created from raw ingredients and later consumed by recipes or sold directly.

Prep Items are inventory.  
They generate new FIFO lots.

---

# 17A. ADVANCED YIELD MODELING (RAW MATERIAL LOSS CONTROL)

This section defines how Selio Stocks handles yield variation from raw material processing (e.g., deboning, trimming, cleaning).

## 17A.1 Core Principle

Scăzământul (raw material loss) is calculated strictly on:

**GROSS RAW QUANTITY (brut recepționat)**

WITHOUT modeling technological cooking processes such as:

- frying
- baking
- boiling
- thawing
- roasting
- dehydration
- peeling heat-loss

Cooking transformations are not stock-loss events.  
They are production transformations.

Only physical removal of unusable raw material is considered yield loss.

---

## 17A.2 Example — Deboning Meat

Input:
- 10 kg whole meat (gross weight)
- Acquisition cost: 40 RON/kg
- Total cost: 400 RON

After trimming/deboning:
- 7 kg usable meat
- 3 kg bones/fat/inedible

System rules:

1. Consume 10 kg from FIFO lot
2. Create new lot:
   - Item: Trimmed Meat
   - Qty: 7 kg
   - Total cost: 400 RON
   - Unit cost: 400 / 7 = 57.14 RON/kg
3. Register yield loss record:
   - 3 kg classified as RAW YIELD LOSS
   - Not treated as WASTE
   - Not treated as THEFT

The cost of 3 kg is absorbed into the 7 kg usable product.

---

## 17A.3 Yield Formula

```
Yield % = Usable Qty / Gross Qty
Unit Cost After Yield = Gross Total Cost / Usable Qty
```

---

## 17A.4 Yield Loss Classification

Yield loss categories:

- Bones
- Fat trimming
- Cleaning waste
- Spoiled raw section (at processing)

These are NOT operational waste.  
They are structural yield losses.

System must store yield metrics per item.

---

## 17A.5 Yield Baseline

Each item may define:

- Expected yield %
- Acceptable deviation range (±X%)

If actual yield < threshold:  
→ Alert: processing inefficiency

---

## 17A.6 What Is NOT Yield Modeling

The following are NOT handled as yield loss:

- evaporation during cooking
- weight reduction from baking
- oil absorption
- water loss from boiling

These belong to recipe theoretical modeling, not raw stock valuation.

Stock valuation remains based on gross-to-usable transformation only.

---

## 17A.7 Product Impact

Yield modeling changes:

- theoretical recipe cost
- variance analysis accuracy
- meat/fish margin protection

Without yield modeling:  
Food cost appears inflated artificially.

With correct yield modeling:  
Margin analysis becomes real.

---

## 17A.8 Data Model Extension

Add to Item:

- expectedYieldPercent (optional)
- yieldTolerancePercent

Add to Production Event:

- grossQty
- usableQty
- yieldLossQty (derived)
- yieldCategory

---

# 18. ROLES & PERMISSIONS MATRIX (ENTERPRISE GRADE)

## 18.1 Core Roles

### Owner

- Full financial visibility
- Approve adjustments > threshold
- Access vendor prices
- Access variance reports

### General Manager

- Create/approve NIR
- Create transfers
- Post consumption
- Initiate inventory count
- View cost reports

### Kitchen Manager / Chef

- View items
- Post prep production
- Post waste
- View theoretical vs actual usage
- No access to vendor price history (optional config)

### Receiving Clerk

- Create NIR (pending status)
- Cannot approve own NIR
- Cannot adjust inventory

### Accountant

- View all financial reports
- Reconcile COGS vs accounting
- No operational posting

### Staff (Restricted)

- No cost visibility
- No inventory adjustments

## 18.2 Approval Logic

- Inventory Adjustment > X currency requires GM or Owner
- NIR approval cannot be done by creator
- Deleting posted documents is forbidden  
  → Only reversal via compensating movement

## 18.3 Sensitive Data Controls

- Purchase price visibility configurable per role
- Margin visibility configurable per role

---

# 19. POS SYNCHRONIZATION POLICY

## 19.1 Modes

### Real-Time Mode (Recommended)

- Each POS sale triggers theoretical usage immediately
- Inventory dashboard updates live

### Batch Mode

- Usage posted at End-of-Day
- Variance analysis only reliable after closure

Default: Real-Time for QSR, Batch allowed for legacy systems.

## 19.2 Failure Handling

If POS sync fails:

- Alert generated
- Manual sync allowed
- No silent data loss

---

# 20. MOBILE UX REQUIREMENTS (FIELD REALITY)

## 20.1 Receiving (Tablet Mode)

- Quick item search
- Barcode scanning support
- Quantity entry with unit auto-conversion
- Temperature field input
- Camera attach for delivery photo

## 20.2 Inventory Count (Mobile Mode)

- Offline-first capability
- Barcode scanning
- Auto-focus next item
- Variance preview before submission

## 20.3 Waste Logging (Fast Entry)

- 3 taps maximum
- Mandatory reason selection
- Optional photo

---

# 21. PRODUCT ROADMAP STRATEGY

Selio Stocks will be developed in two controlled phases:

- V1 → Single-Unit Excellence
- V2 → Multi-Unit & Consolidation Engine

The architecture must allow V2 without rewriting V1.

---

## V1 — SINGLE UNIT ARCHITECTURE (FOUNDATION LAYER)

### V1.1 Objective

Build an unbreakable inventory control engine for ONE legal entity / ONE location.

Primary goals:

- Perfect FIFO valuation
- Perfect movement ledger
- Perfect variance detection
- Accounting-safe COGS

If V1 is not mathematically correct, V2 is impossible.

### V1.2 Structural Assumptions

- One company
- One fiscal identity
- Multiple internal storage locations allowed (warehouse, kitchen, bar)
- Single currency
- Single chart of accounts mapping

### V1.3 Data Model Constraints

- locationId refers to internal storage, not separate business entities
- All reports aggregate at company level
- No inter-company transfer logic

### V1.4 Required Modules (V1 Scope Lock)

1. Item Master
2. Vendor Management
3. Receiving (NIR)
4. FIFO Lot Engine
5. Stock Movement Ledger
6. Consumption (Sales + Bon de Consum)
7. Prep Production
8. Transfers (internal only)
9. Physical Inventory Count
10. Variance Analysis
11. Owner Dashboard
12. Accounting Export

Anything beyond this is V2.

### V1.5 Accounting Integrity Requirements

- Monthly closing lock
- Period freeze after export
- Reversal-only corrections
- Inventory valuation snapshot per period

### V1.6 KPI Focus (Single Unit)

- Food Cost %
- Beverage Cost %
- Prime Cost %
- Waste %
- Shrinkage %
- Inventory Turnover
- Cash tied in stock

---

## V2 — MULTI-UNIT ARCHITECTURE (SCALING LAYER)

V2 activates only after V1 mathematical stability is proven.

### V2.1 Objective

Enable:

- Multiple legal entities
- Multiple locations
- Central warehouse
- Franchise models
- Consolidated reporting

### V2.2 Structural Additions

**BusinessEntity**  
New entity layer above location.

Fields:

- entityId
- legalName
- fiscalId
- currency
- accountingMapping

**Location (redefined)**  
Now belongs to BusinessEntity.

### V2.3 Inter-Unit Transfers

Two possible modes:

**Mode A — Same Legal Entity**

- Transfer = movement only
- No revenue event

**Mode B — Different Legal Entities**

Transfer becomes:

- TRANSFER_OUT (entity A)
- PURCHASE (entity B)
- Transfer price applied
- Optional markup logic

System must support both.

### V2.4 Central Warehouse Logic

- Central warehouse as master stock location
- Branches request stock
- Automatic transfer documents
- Visibility: warehouse manager vs branch manager

### V2.5 Consolidated Reporting

Must support:

- Per location inventory value
- Per entity COGS
- Group Prime Cost
- Cross-location variance heatmap

### V2.6 Role Hierarchy Expansion

Add:

- Group Owner
- Regional Manager
- Central Procurement Manager

Permission inheritance required.

### V2.7 Pricing Governance

Multi-unit introduces:

- Central negotiated prices
- Branch price overrides
- Vendor contract enforcement

### V2.8 Data Isolation

Critical rule:  
Inventory data between legal entities must be logically isolated.

Cross-entity visibility must be configurable.

---

## V1 → V2 COMPATIBILITY REQUIREMENT

All V1 tables must include:

- entityId (nullable in V1, mandatory in V2)

This prevents refactoring later.

---

## VERSIONING STRATEGY

- Version 1.1 → Single-unit hardened
- Version 1.5 → Accounting close engine stabilized
- Version 2.0 → Multi-unit activation

---

## ARCHITECTURAL PRINCIPLE

We do not build features.  
We build financial integrity.

V1 must be boring and perfect.  
V2 must be scalable and controlled.

---

# END OF DOCUMENT
