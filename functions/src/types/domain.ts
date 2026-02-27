// src/types/domain.ts

export type MovementType =
    | 'RECEIVE'
    | 'CONSUME_SOLD'
    | 'CONSUME_COMP'
    | 'CONSUME_WASTE'
    | 'TRANSFER_OUT'
    | 'TRANSFER_IN'
    | 'PREP_OUT'
    | 'PREP_IN'
    | 'YIELD_OUT'
    | 'YIELD_IN'
export type MovementType = 'RECEIPT_IN' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'PREP_IN' | 'PREP_OUT' | 'YIELD_IN' | 'YIELD_OUT' | 'YIELD_LOSS' | 'CONSUMPTION_OUT' | 'WASTE_OUT' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';

export type DocType = 'RECEIPT' | 'TRANSFER' | 'PREP_PRODUCTION' | 'YIELD_TRANSFORM' | 'INVENTORY_COUNT' | 'CONSUMPTION' | 'WASTE';

export type DocStatus = 'DRAFT' | 'COUNTING' | 'LOCKED' | 'PENDING_APPROVAL' | 'POSTED' | 'CANCELLED';

// -----------------------------------------------------------------------------
// Core Ledger Entities
// -----------------------------------------------------------------------------

export interface SourceDoc {
    docType: DocType;
    docId: string;
}

export interface LotAllocation {
    lotId: string;
    qtyBase: number; // Integer
    unitCostFloorSubunitsPerBase: number; // The floor baseline applied to this slice
    bonusUnitsApplied: number; // Number of residual fractional units consumed
    valueSubunits: number; // Integer (qtyBase * unitCostFloor + bonus)
}

export interface Lot {
    entityId?: string;
    itemId: string;
    locationId: string;
    vendorId?: string; // Appending vendor directly to Lot for faster tracing
    sourceLotId?: string; // Appending trace for transferred lots
    createdAt: string; // ISO date string
    expiryAt?: string;
    unitCostFloorSubunitsPerBase: number; // Math.floor(totalValue / qtyBase)
    residualUnitsOnHand: number;          // totalValue % qtyBase
    qtyOnHandBase: number;
    sourceDoc: SourceDoc;
    status?: 'ACTIVE' | 'DEPLETED';
}

export interface Movement {
    entityId?: string;
    type: MovementType;
    itemId: string;
    locationId: string;
    qtyBase: number; // Signed: positive for IN, negative for OUT
    valueSubunits: number; // Absolute value
    lotAllocations?: LotAllocation[]; // Required for OUT movements
    sourceDoc: SourceDoc;
    reasonCode?: string;
    createdAt: string;
    createdBy: string;
    documentDate: string;
    idempotencyKey?: string;
}

export interface ConsumptionLine {
    itemId: string;
    qtyBase: number;
    reasonCode: string;
}

export interface NirLine {
    itemId: string;
    qtyBase: number;
    unitPriceSubunitsPurchaseUom: number; // Cost of the entire purchase package/box/kg
    purchaseToBaseFactor: number; // E.g if buying 1kg (price is for 1kg) and base is 1g, factor is 1000.
    expiryAt?: string;
}

export interface Document {
    entityId?: string;
    docType: DocType;
    subType?: 'COMP' | 'WASTE'; // Explicit subtype for consumption
    status: DocumentStatus;
    documentDate: string;
    postedAt?: string;
    createdAt: string;
    createdBy: string;
    idempotencyKey: string;
    locationId: string; // Mandatory for NIR and Consumption
    vendorId?: string; // Mandatory for NIR
}
