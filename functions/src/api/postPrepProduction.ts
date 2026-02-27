// src/api/postPrepProduction.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { allocateFifoShadows, ShadowLot } from '../ledger/fifo';
import { Document, Movement, Lot } from '../types/domain';

export const postPrepProduction = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const { docId } = data;
    if (!docId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing docId.');
    }

    const db = admin.firestore();
    const docRef = db.collection('documents').doc(docId);
    const linesRef = docRef.collection('lines');

    try {
        return await db.runTransaction(async (transaction) => {
            // ==========================================
            // PHASE 1: READ
            // ==========================================
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            const docData = docSnap.data() as Document & { producedItemId: string, producedQtyBase: number };

            if (docData.docType !== 'PREP_PRODUCTION') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not a PREP_PRODUCTION type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, alreadyPosted: true };
            }

            if (docData.status !== 'DRAFT') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot post document in status: ${docData.status}`);
            }

            const locationId = docData.locationId;
            const producedItemId = docData.producedItemId;
            const producedQtyBase = docData.producedQtyBase;

            if (!locationId || !producedItemId || !producedQtyBase || producedQtyBase <= 0 || !Number.isInteger(producedQtyBase)) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing or invalid locationId, producedItemId, or positive integer producedQtyBase.');
            }

            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Document has no ingredient lines.');
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

            for (const line of lines) {
                if (!line.itemId || !line.qtyBase || line.qtyBase <= 0 || !Number.isInteger(line.qtyBase)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} has invalid itemId or qtyBase.`);
                }
            }

            const itemIds = Array.from(new Set(lines.map(line => line.itemId)));
            if (itemIds.length > 10) {
                throw new functions.https.HttpsError('unimplemented', 'Max 10 distinct ingredients per prep doc allowed in V1.');
            }

            const lotsQuery = db.collection('lots')
                .where('locationId', '==', locationId)
                .where('itemId', 'in', itemIds)
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

            let totalIngestedValueSubunits = 0;

            // 1. Consume Ingredients
            for (const line of lines) {
                const { totalValueSubunits, allocations } = allocateFifoShadows(shadowLots, line.itemId, locationId, line.qtyBase);
                totalIngestedValueSubunits += totalValueSubunits;

                const movementOutRef = db.collection('movements').doc();
                movementsToWrite.push({
                    ref: movementOutRef,
                    data: {
                        type: 'PREP_OUT',
                        itemId: line.itemId,
                        locationId,
                        qtyBase: -line.qtyBase,
                        valueSubunits: totalValueSubunits,
                        lotAllocations: allocations,
                        sourceDoc: { docType: 'PREP_PRODUCTION', docId },
                        createdAt: now,
                        createdBy: context.auth?.uid,
                        documentDate: docData.documentDate,
                        idempotencyKey: `idem_prep_${docId}_out_${line.id}`
                    }
                });
            }

            // 2. Create Single Target Lot and PREP_IN Movement
            const unitCostFloorSubunitsPerBase = Math.floor(totalIngestedValueSubunits / producedQtyBase);
            const residualUnitsOnHand = totalIngestedValueSubunits % producedQtyBase;

            const prepLotRef = db.collection('lots').doc();
            lotsToCreate.push({
                ref: prepLotRef,
                data: {
                    itemId: producedItemId,
                    locationId,
                    createdAt: now,
                    unitCostFloorSubunitsPerBase,
                    residualUnitsOnHand,
                    qtyOnHandBase: producedQtyBase,
                    sourceDoc: { docType: 'PREP_PRODUCTION', docId },
                    status: 'ACTIVE'
                }
            });

            movementsToWrite.push({
                ref: db.collection('movements').doc(),
                data: {
                    type: 'PREP_IN',
                    itemId: producedItemId,
                    locationId,
                    qtyBase: producedQtyBase,
                    valueSubunits: totalValueSubunits, // Exact financial equivalent
                    sourceDoc: { docType: 'PREP_PRODUCTION', docId },
                    createdAt: now,
                    createdBy: context.auth?.uid,
                    documentDate: docData.documentDate,
                    idempotencyKey: `idem_prep_${docId}_in`
                }
            });

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
