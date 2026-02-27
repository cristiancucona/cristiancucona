// src/api/postTransfer.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { allocateFifoShadows, ShadowLot } from '../ledger/fifo';
import { Document, Movement, Lot } from '../types/domain';

export const postTransfer = functions.https.onCall(async (data, context) => {
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
            // PHASE 1: READ EVERYTHING (No Writes Yet)
            // ==========================================

            // 1.1 Read Document
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            const docData = docSnap.data() as Document;

            // 1.2 Document Validations
            if (docData.docType !== 'TRANSFER') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not a TRANSFER type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, alreadyPosted: true };
            }

            if (docData.status !== 'DRAFT') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot post document in status: ${docData.status}`);
            }

            const fromLocationId = docData.locationId;
            const toLocationId = docData.vendorId; // Repurposing vendorId field temporarily. A proper schema would have targetLocationId

            if (!fromLocationId || !toLocationId) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing fromLocationId or toLocationId mapping.');
            }

            if (fromLocationId === toLocationId) {
                throw new functions.https.HttpsError('failed-precondition', 'Cannot transfer to the same location.');
            }

            // 1.3 Read Lines
            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Document has no lines.');
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

            for (const line of lines) {
                if (!line.itemId || !line.qtyBase) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} is missing required fields.`);
                }
                if (line.qtyBase <= 0 || !Number.isInteger(line.qtyBase)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} qtyBase must be a positive integer.`);
                }
            }

            const itemIds = Array.from(new Set(lines.map(line => line.itemId)));

            if (itemIds.length > 10) {
                throw new functions.https.HttpsError('unimplemented', 'Max 10 distinct items per transfer doc allowed in V1.');
            }

            // Read source location lots
            const lotsQuery = db.collection('lots')
                .where('locationId', '==', fromLocationId)
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

            for (const line of lines) {
                const requiredQty = line.qtyBase;
                const { totalValueSubunits: totalConsumedValue, allocations } = allocateFifoShadows(shadowLots, line.itemId, fromLocationId, requiredQty);

                // 1. Log TRANSFER_OUT
                const movementOutRef = db.collection('movements').doc();
                movementsToWrite.push({
                    ref: movementOutRef,
                    data: {
                        type: 'TRANSFER_OUT',
                        itemId: line.itemId,
                        locationId: fromLocationId,
                        qtyBase: -requiredQty,
                        valueSubunits: totalConsumedValue,
                        lotAllocations: allocations,
                        sourceDoc: { docType: 'TRANSFER', docId },
                        createdAt: now,
                        createdBy: context.auth.uid,
                        documentDate: docData.documentDate,
                        idempotencyKey: `idem_trx_${docId}_out_${line.id}`
                    }
                });

                // 2. Create Mirrored Lots at target and log TRANSFER_IN
                // For each depletion allocation, we emit a mirrored LOT IN exactly at that precise price
                for (let i = 0; i < allocations.length; i++) {
                    const alloc = allocations[i];

                    // Exact Lot Value matching for transfer preservation
                    const unitCostFloorSubunitsPerBase = Math.floor(alloc.valueSubunits / alloc.qtyBase);
                    const residualUnitsOnHand = alloc.valueSubunits % alloc.qtyBase;

                    // Create Mirrored Lot
                    const mirroredLotRef = db.collection('lots').doc();
                    const mirroredLot: Lot = {
                        itemId: line.itemId,
                        locationId: toLocationId, // Shifted to target location
                        createdAt: now,
                        unitCostFloorSubunitsPerBase,
                        residualUnitsOnHand,
                        qtyOnHandBase: alloc.qtyBase,
                        sourceDoc: { docType: 'TRANSFER', docId },
                        sourceLotId: alloc.lotId, // Track back lineage
                        status: 'ACTIVE'
                    };
                    lotsToCreate.push({ ref: mirroredLotRef, data: mirroredLot });

                    // Log TRANSFER_IN specifically for this allocated subunit
                    const movementInRef = db.collection('movements').doc();
                    movementsToWrite.push({
                        ref: movementInRef,
                        data: {
                            type: 'TRANSFER_IN',
                            itemId: line.itemId,
                            locationId: toLocationId,
                            qtyBase: alloc.qtyBase, // Positive
                            valueSubunits: alloc.valueSubunits,
                            sourceDoc: { docType: 'TRANSFER', docId },
                            createdAt: now,
                            createdBy: context.auth.uid,
                            documentDate: docData.documentDate,
                            idempotencyKey: `idem_trx_${docId}_in_${line.id}_${i}`
                        }
                    });
                }
            }

            // ==========================================
            // PHASE 3: WRITE BACK ALL TRANSFORMATIONS
            // ==========================================

            // 3.1 Update Source depleted lots
            for (const sl of shadowLots) {
                const originalQty = originalLotQtys.get(sl.id);
                if (sl.qtyOnHandBase !== originalQty) {
                    transaction.update(sl.ref, {
                        qtyOnHandBase: sl.qtyOnHandBase,
                        status: sl.qtyOnHandBase === 0 ? 'DEPLETED' : 'ACTIVE'
                    });
                }
            }

            // 3.2 Create mirrored lots
            for (const lc of lotsToCreate) {
                transaction.set(lc.ref, lc.data);
            }

            // 3.3 Create movements
            for (const mov of movementsToWrite) {
                transaction.set(mov.ref, mov.data);
            }

            // 3.4 Lock Document
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
