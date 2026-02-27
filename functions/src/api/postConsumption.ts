// src/api/postConsumption.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { allocateFifoShadows, ShadowLot } from '../ledger/fifo';
import { Document, ConsumptionLine, Movement } from '../types/domain';

export const postConsumption = functions.https.onCall(async (data, context) => {
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

            // 1.2 Document Level Validations
            if (docData.docType !== 'CONSUMPTION') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not a CONSUMPTION type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, alreadyPosted: true };
            }

            if (docData.status !== 'DRAFT') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot post document in status: ${docData.status}`);
            }

            const subType = docData.subType;
            if (subType !== 'COMP' && subType !== 'WASTE') {
                throw new functions.https.HttpsError('failed-precondition', 'Consumption document missing correct subType: requires COMP or WASTE.');
            }

            const locationId = docData.locationId;
            if (!locationId) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing locationId on document.');
            }

            // 1.3 Read Lines
            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Document has no lines.');
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as ConsumptionLine }));

            for (const line of lines) {
                if (!line.itemId || !line.qtyBase || !line.reasonCode) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} is missing required fields.`);
                }
                if (line.qtyBase <= 0 || !Number.isInteger(line.qtyBase)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} qtyBase must be a positive integer.`);
                }
            }

            const itemIds = Array.from(new Set(lines.map(line => line.itemId)));

            // 1.4 Bulk Read Affected Lots (Using in query max 10 itemIds optimization)
            if (itemIds.length > 10) {
                throw new functions.https.HttpsError('unimplemented', 'Max 10 distinct items per consumption doc allowed in V1.');
            }

            const lotsQuery = db.collection('lots')
                .where('locationId', '==', locationId)
                .where('itemId', 'in', itemIds)
                .where('qtyOnHandBase', '>', 0)
            // orderBy is implicit or done in memory to avoid indexed in-queries limits

            const lotsSnap = await transaction.get(lotsQuery);

            // ==========================================
            // PHASE 2: IN-MEMORY COMPUTATION (Shadows)
            // ==========================================
            const shadowLots: ShadowLot[] = lotsSnap.docs.map(doc => ({
                id: doc.id,
                ref: doc.ref,
                ...doc.data() as any
            }));

            // Map original quantities to only touch modified lots later
            const originalLotQtys = new Map<string, number>(shadowLots.map(l => [l.id, l.qtyOnHandBase]));

            const movementsToWrite: { ref: admin.firestore.DocumentReference; data: Movement }[] = [];
            const now = new Date().toISOString();

            for (const line of lines) {

                // Allocate against in-memory shadows. Mutations affect the shadowLots array state for subsequent loop cycles.
                const fifoResult = allocateFifoShadows(shadowLots, line.itemId, locationId, line.qtyBase);

                const movementRef = db.collection('movements').doc();
                const movementType = subType === 'COMP' ? 'CONSUME_COMP' : 'CONSUME_WASTE';

                movementsToWrite.push({
                    ref: movementRef,
                    data: {
                        type: movementType,
                        itemId: line.itemId,
                        locationId: locationId,
                        qtyBase: -line.qtyBase,
                        valueSubunits: fifoResult.totalValueSubunits,
                        lotAllocations: fifoResult.allocations,
                        sourceDoc: { docType: 'CONSUMPTION', docId: docId },
                        reasonCode: line.reasonCode,
                        createdAt: now,
                        createdBy: context.auth?.uid,
                        documentDate: docData.documentDate,
                        idempotencyKey: `${docId}_${line.id}`
                    }
                });
            }

            // ==========================================
            // PHASE 3: WRITE PHASE
            // ==========================================

            // 3.1 Overwrite lots with their new shadow values
            shadowLots.forEach(shadow => {
                const originalQty = originalLotQtys.get(shadow.id);
                if (originalQty !== undefined && shadow.qtyOnHandBase !== originalQty) {
                    transaction.update(shadow.ref, { qtyOnHandBase: shadow.qtyOnHandBase });
                }
            });

            // 3.2 Append movements
            movementsToWrite.forEach(m => transaction.set(m.ref, m.data));

            // 3.3 Set Document as POSTED
            transaction.update(docRef, {
                status: 'POSTED',
                postedAt: now,
                updatedAt: now,
                updatedBy: context.auth?.uid
            });

            return { success: true, alreadyPosted: false };
        });
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('aborted', error.message || 'Transaction failed.');
    }
});
