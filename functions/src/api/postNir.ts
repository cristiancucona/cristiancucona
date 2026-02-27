// src/api/postNir.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Document, NirLine, Movement, Lot } from '../types/domain';

export const postNir = functions.https.onCall(async (data, context) => {
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
            if (docData.docType !== 'NIR') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not a NIR type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, alreadyPosted: true };
            }

            if (docData.status !== 'DRAFT' && docData.status !== 'PENDING_APPROVAL') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot post document in status: ${docData.status}`);
            }

            const locationId = docData.locationId;
            if (!locationId) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing locationId on document.');
            }

            const vendorId = docData.vendorId;
            if (!vendorId) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing vendorId on NIR document.');
            }

            if (!docData.documentDate) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing documentDate on NIR document.');
            }

            // 1.3 Read Lines
            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Document has no lines.');
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as NirLine }));

            // 1.4 Pre-query Validation of All Lines
            for (const line of lines) {
                if (!line.itemId) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} is missing itemId.`);
                }
                if (!line.qtyBase || line.qtyBase <= 0 || !Number.isInteger(line.qtyBase)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} qtyBase must be a positive integer.`);
                }

                // Strict pricing rule: Lots must not be unpriced. Cost determines FIFO queue.
                if (line.unitPriceSubunitsPurchaseUom === undefined || line.unitPriceSubunitsPurchaseUom === null || line.unitPriceSubunitsPurchaseUom < 0 || !Number.isInteger(line.unitPriceSubunitsPurchaseUom)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} has invalid or missing unitPriceSubunitsPurchaseUom.`);
                }

                if (!line.purchaseToBaseFactor || line.purchaseToBaseFactor <= 0) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} has missing or invalid purchaseToBaseFactor. Factor must be > 0.`);
                }
            }

            // ==========================================
            // PHASE 2: IN-MEMORY COMPUTATION 
            // ==========================================
            const lotsToCreate: { ref: admin.firestore.DocumentReference; data: Lot }[] = [];
            const movementsToWrite: { ref: admin.firestore.DocumentReference; data: Movement }[] = [];
            const now = new Date().toISOString();

            for (const line of lines) {
                // Fix #1: Precise Purchase to Base Factor Conversion
                // E.g., 4000 bani (price) / 1000g (factor) = 4 bani per gram.
                // We use Math.round to force an integer subunit per the system's strict policy.
                const rawConversionCost = line.unitPriceSubunitsPurchaseUom / line.purchaseToBaseFactor;
                const unitCostSubunitsPerBase = Math.round(rawConversionCost);

                // Value is the sum of exact integer subunit math
                const valueSubunits = line.qtyBase * unitCostSubunitsPerBase;

                // Prepare new FIFO Lot
                const lotRef = db.collection('lots').doc();
                const lot: Lot = {
                    itemId: line.itemId,
                    locationId: locationId,
                    vendorId: vendorId, // Rec #2: VendorId footprint embedded mapping
                    createdAt: now,
                    unitCostSubunitsPerBase: unitCostSubunitsPerBase,
                    qtyOnHandBase: line.qtyBase,
                    sourceDoc: { docType: 'NIR', docId: docId },
                    status: 'ACTIVE'
                };

                if (line.expiryAt) {
                    lot.expiryAt = line.expiryAt;
                }

                // Prepare append-only RECEIVE movement
                const movementRef = db.collection('movements').doc();
                const movement: Movement = {
                    type: 'RECEIVE',
                    itemId: line.itemId,
                    locationId: locationId,
                    qtyBase: line.qtyBase, // Positive for IN
                    valueSubunits: valueSubunits,
                    sourceDoc: { docType: 'NIR', docId: docId },
                    createdAt: now,
                    createdBy: context.auth?.uid,
                    documentDate: docData.documentDate,
                    idempotencyKey: `${docId}_${line.id}`
                };

                lotsToCreate.push({ ref: lotRef, data: lot });
                movementsToWrite.push({ ref: movementRef, data: movement });
            }

            // ==========================================
            // PHASE 3: WRITE PHASE
            // ==========================================

            // 3.1 Insert all brand new spawned Lots
            lotsToCreate.forEach(l => transaction.set(l.ref, l.data));

            // 3.2 Append receiving movements
            movementsToWrite.forEach(m => transaction.set(m.ref, m.data));

            // 3.3 Set Document as POSTED (Locking the document)
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
