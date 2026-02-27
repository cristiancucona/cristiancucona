import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Document, Lot } from '../types/domain';

export const createInventoryCount = functions.https.onCall(async (data, context) => {
    // 1. Auth Guard
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
            // PHASE 1: READ DOCUMENT & LINES
            // ==========================================
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            const docData = docSnap.data() as Document;

            if (docData.docType !== 'INVENTORY_COUNT') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not an INVENTORY_COUNT type.');
            }

            // You can only initiate the snapshot on a Draft
            if (docData.status !== 'DRAFT') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot create count snapshot for document in status: ${docData.status}`);
            }

            const locationId = docData.locationId;
            if (!locationId) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing locationId.');
            }

            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Document has no lines.');
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

            for (const line of lines) {
                if (!line.itemId) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} is missing itemId.`);
                }
            }

            const itemIds = Array.from(new Set(lines.map(line => line.itemId)));

            if (itemIds.length > 400) {
                // V1 limit: max 400 items per inventory count sheet to prevent 500 max writes transaction fails
                throw new functions.https.HttpsError('unimplemented', 'Max 400 distinct items per count sheet allowed in V1.');
            }

            // ==========================================
            // PHASE 2: COMPUTE THEORETICAL LEDGER STATE
            // ==========================================
            // Read active stock for the targeted location
            const lotsQuery = db.collection('lots')
                .where('locationId', '==', locationId)
                .where('qtyOnHandBase', '>', 0);

            const lotsSnap = await transaction.get(lotsQuery);

            // Map itemId -> Total Qty on Hand Basis
            const theoreticalMap = new Map<string, number>();

            const itemIdsSet = new Set(itemIds);

            lotsSnap.forEach(doc => {
                const lot = doc.data() as Lot;
                if (itemIdsSet.has(lot.itemId)) {
                    const current = theoreticalMap.get(lot.itemId) || 0;
                    theoreticalMap.set(lot.itemId, current + lot.qtyOnHandBase);
                }
            });

            const now = new Date().toISOString();

            // ==========================================
            // PHASE 3: WRITE BACK
            // ==========================================
            // Update individual lines with the snapshot `theoreticalQtyBase`
            for (const line of lines) {
                const reqRef = linesRef.doc(line.id);
                const theoretical = theoreticalMap.get(line.itemId) || 0; // If item isn't in lots, theoretical is 0
                transaction.update(reqRef, {
                    theoreticalQtyBase: theoretical
                });
            }

            // Lock Document into COUNTING mode (Frozen theoretical)
            transaction.update(docRef, {
                status: 'COUNTING',
                snapshotAt: now
            });

            return { success: true };
        });

    } catch (e: any) {
        throw new functions.https.HttpsError(e.code || 'internal', e.message);
    }
});
