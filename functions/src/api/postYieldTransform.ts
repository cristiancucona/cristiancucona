// src/api/postYieldTransform.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { allocateFifoShadows, ShadowLot } from '../ledger/fifo';
import { Document, Movement, Lot } from '../types/domain';

export const postYieldTransform = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const { docId } = data;
    if (!docId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing docId.');
    }

    const db = admin.firestore();
    const docRef = db.collection('documents').doc(docId);

    try {
        return await db.runTransaction(async (transaction) => {
            // ==========================================
            // PHASE 1: READ
            // ==========================================
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            // docData shape matches the Yield Transform domain
            const docData = docSnap.data() as Document & {
                sourceItemId: string,
                grossQtyBase: number,
                targetItemId: string,
                usableQtyBase: number
            };

            if (docData.docType !== 'YIELD_TRANSFORM') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not a YIELD_TRANSFORM type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, alreadyPosted: true };
            }

            if (docData.status !== 'DRAFT') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot post document in status: ${docData.status}`);
            }

            const locationId = docData.locationId;
            const { sourceItemId, grossQtyBase, targetItemId, usableQtyBase } = docData;

            if (!locationId || !sourceItemId || !grossQtyBase || !targetItemId || !usableQtyBase) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing required yield transformation fields.');
            }

            if (grossQtyBase <= 0 || usableQtyBase <= 0 || !Number.isInteger(grossQtyBase) || !Number.isInteger(usableQtyBase)) {
                throw new functions.https.HttpsError('invalid-argument', 'Quantities must be strictly positive integers.');
            }

            if (grossQtyBase < usableQtyBase) {
                throw new functions.https.HttpsError('invalid-argument', 'Gross quantity cannot be less than usable quantity.');
            }

            const lotsQuery = db.collection('lots')
                .where('locationId', '==', locationId)
                .where('itemId', '==', sourceItemId)
                .where('qtyOnHandBase', '>', 0);

            const lotsSnap = await transaction.get(lotsQuery);

            // ==========================================
            // PHASE 2: IN-MEMORY COMPUTATION (Shadows)
            // ==========================================
            const shadowLots: ShadowLot[] = lotsSnap.docs.map(doc => ({
                id: doc.id,
                ref: doc.ref,
                ...doc.data() as any
            }));

            const originalLotQtys = new Map<string, number>(shadowLots.map(l => [l.id, l.qtyOnHandBase]));

            const movementsToWrite: { ref: admin.firestore.DocumentReference; data: Movement }[] = [];
            const lotsToCreate: { ref: admin.firestore.DocumentReference; data: Lot }[] = [];
            const now = new Date().toISOString();

            // 1. Consume Source Ingredient
            const { totalValueSubunits, allocations } = allocateFifoShadows(shadowLots, sourceItemId, locationId, grossQtyBase);

            const movementOutRef = db.collection('movements').doc();
            movementsToWrite.push({
                ref: movementOutRef,
                data: {
                    type: 'YIELD_OUT',
                    itemId: sourceItemId,
                    locationId,
                    qtyBase: -grossQtyBase,
                    valueSubunits: totalValueSubunits,
                    lotAllocations: allocations,
                    sourceDoc: { docType: 'YIELD_TRANSFORM', docId },
                    createdAt: now,
                    createdBy: context.auth?.uid || 'UNKNOWN_USER',
                    documentDate: docData.documentDate,
                    idempotencyKey: `idem_yield_${docId}_out`
                }
            });

            // 2. Create Target Lot, absorbing 100% of the cost into the yielded usableQtyBase
            const unitCostFloorSubunitsPerBase = Math.floor(totalValueSubunits / usableQtyBase);
            const residualUnitsOnHand = totalValueSubunits % usableQtyBase;

            const targetLotRef = db.collection('lots').doc();
            lotsToCreate.push({
                ref: targetLotRef,
                data: {
                    itemId: targetItemId,
                    locationId,
                    createdAt: now,
                    unitCostFloorSubunitsPerBase,
                    residualUnitsOnHand,
                    qtyOnHandBase: usableQtyBase,
                    sourceDoc: { docType: 'YIELD_TRANSFORM', docId },
                    status: 'ACTIVE'
                }
            });

            movementsToWrite.push({
                ref: db.collection('movements').doc(),
                data: {
                    type: 'YIELD_IN',
                    itemId: targetItemId,
                    locationId,
                    qtyBase: usableQtyBase, // Positive
                    valueSubunits: totalValueSubunits, // Transferred 100% of financial cost
                    sourceDoc: { docType: 'YIELD_TRANSFORM', docId },
                    createdAt: now,
                    createdBy: context.auth?.uid || 'UNKNOWN_USER',
                    documentDate: docData.documentDate,
                    idempotencyKey: `idem_yield_${docId}_in`
                }
            });

            // 3. Log YIELD_LOSS for operational transparency without impacting finances
            const shrinkQty = grossQtyBase - usableQtyBase;
            if (shrinkQty > 0) {
                movementsToWrite.push({
                    ref: db.collection('movements').doc(),
                    data: {
                        type: 'YIELD_LOSS',
                        itemId: sourceItemId,
                        locationId,
                        qtyBase: -shrinkQty, // Negative for clarity that volume was lost
                        valueSubunits: 0, // CRITICAL ASSUMPTION RULE: 0 value leakage
                        sourceDoc: { docType: 'YIELD_TRANSFORM', docId },
                        createdAt: now,
                        createdBy: context.auth?.uid || 'UNKNOWN_USER',
                        documentDate: docData.documentDate,
                        idempotencyKey: `idem_yield_${docId}_loss`
                    }
                });
            }

            // ==========================================
            // PHASE 3: WRITE BACK
            // ==========================================
            for (const sl of shadowLots) {
                const originalQty = originalLotQtys.get(sl.id);
                if (sl.qtyOnHandBase !== originalQty) {
                    transaction.update(sl.ref, {
                        qtyOnHandBase: sl.qtyOnHandBase,
                        status: sl.qtyOnHandBase === 0 ? 'DEPLETED' : 'ACTIVE'
                    });
                }
            }

            for (const lc of lotsToCreate) transaction.set(lc.ref, lc.data);
            for (const mov of movementsToWrite) transaction.set(mov.ref, mov.data);

            transaction.update(docRef, {
                status: 'POSTED',
                postedAt: now
            });

            return { success: true };
        });

    } catch (e: any) {
        throw new functions.https.HttpsError(e.code || 'internal', e.message);
    }
});
