// src/ledger/fifo.ts
import * as admin from 'firebase-admin';
import { Lot, LotAllocation } from '../types/domain';

export interface FifoResult {
    allocations: LotAllocation[];
    totalValueSubunits: number;
}

export interface ShadowLot extends Lot {
    id: string; // The firestore doc ID
    ref: admin.firestore.DocumentReference;
}

/**
 * Allocates inventory using FIFO rules against an array of pre-fetched shadow lots.
 * This MUST be used to track allocations across multiple lines in the same transaction
 * without triggering read-after-write errors.
 */
export function allocateFifoShadows(
    shadowLots: ShadowLot[],
    itemId: string,
    locationId: string,
    qtyBaseToAllocate: number
): FifoResult {
    if (qtyBaseToAllocate <= 0 || !Number.isInteger(qtyBaseToAllocate)) {
        throw new Error('qtyBase must be a positive integer.');
    }

    let remainingQty = qtyBaseToAllocate;
    const allocations: LotAllocation[] = [];
    let totalValueSubunits = 0;

    // Iterate over pre-loaded lots for this specific item & location
    const matchedLots = shadowLots.filter(l => l.itemId === itemId && l.locationId === locationId && l.qtyOnHandBase > 0);

    // Ensure lots are correctly sorted by creation date (Timezone-safe and Timestamp agnostic)
    matchedLots.sort((a, b) => {
        const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt as any).toMillis?.() || 0;
        const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : (b.createdAt as any).toMillis?.() || 0;
        return timeA - timeB;
    });

    for (const lot of matchedLots) {
        if (remainingQty <= 0) break;

        const availableQty = lot.qtyOnHandBase;

        // Verify constraints strictly inside loop to avoid subtle bugs
        if (availableQty <= 0) continue;

        const qtyTaken = Math.min(availableQty, remainingQty);

        // Exact Lot Value model: Exhaust residual units first then apply floor
        const bonus = Math.min(qtyTaken, lot.residualUnitsOnHand);
        const valueTaken = qtyTaken * lot.unitCostFloorSubunitsPerBase + bonus;

        allocations.push({
            lotId: lot.id,
            qtyBase: qtyTaken,
            unitCostFloorSubunitsPerBase: lot.unitCostFloorSubunitsPerBase,
            bonusUnitsApplied: bonus,
            valueSubunits: valueTaken,
        });

        // UPDATE SHADOW LOT IN MEMORY FOR SUBSEQUENT ALLOCATIONS
        lot.residualUnitsOnHand -= bonus;
        lot.qtyOnHandBase -= qtyTaken;

        totalValueSubunits += valueTaken;
        remainingQty -= qtyTaken;
    }

    // Strict negative stock enforcement
    if (remainingQty > 0) {
        throw new Error(`INSUFFICIENT_STOCK: Could not allocate ${qtyBaseToAllocate}. Missing ${remainingQty}. Item: ${itemId} at Location: ${locationId}`);
    }

    return {
        allocations,
        totalValueSubunits
    };
}
