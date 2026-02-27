// src/api/rebuildOnHandProjections.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Lot } from '../types/domain';

export const rebuildOnHandProjections = functions.https.onCall(async (data, context) => {
    // Fix 2: Explicitly locked execution scope to Administrative personnel
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const role = context.auth.token.role;
    const isAdmin = context.auth.token.admin === true;
    if (role !== 'OWNER' && role !== 'GM' && !isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only OWNER, GM, or Admin can rebuild projections.');
    }

    const db = admin.firestore();

    try {
        const lotsQuery = db.collection('lots').where('qtyOnHandBase', '>', 0);
        const snapshot = await lotsQuery.get();

        // Map: locationId_itemId -> { qty, value }
        const projectionMap: Record<string, { qty: number, value: number, locationId: string, itemId: string }> = {};

        snapshot.docs.forEach(doc => {
            const lot = doc.data() as Lot;
            const key = `${lot.locationId}_${lot.itemId}`;

            if (!projectionMap[key]) {
                projectionMap[key] = { qty: 0, value: 0, locationId: lot.locationId, itemId: lot.itemId };
            }

            projectionMap[key].qty += lot.qtyOnHandBase;

            // Projections pull the absolute explicit Exact Lot Value directly, avoiding aggregate multi-float variance
            const lotExactValue = lot.lotValueOnHandSubunits ?? (lot.qtyOnHandBase * lot.unitCostFloorSubunitsPerBase + lot.residualUnitsOnHand);
            projectionMap[key].value += lotExactValue;
        });

        const batch = db.batch();
        const now = new Date().toISOString();

        for (const [key, data] of Object.entries(projectionMap)) {
            const projRef = db.collection('projections').doc(`onHand_${key}`);
            batch.set(projRef, {
                locationId: data.locationId,
                itemId: data.itemId,
                qtyOnHandBase: data.qty,
                valueOnHandSubunits: data.value,
                updatedAt: now
            });
        }

        await batch.commit();

        return { success: true, projectedKeysCount: Object.keys(projectionMap).length };

    } catch (error: any) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});
