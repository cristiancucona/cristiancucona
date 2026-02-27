import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Document } from '../types/domain';

export const lockInventoryCount = functions.https.onCall(async (data, context) => {
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
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            const docData = docSnap.data() as Document;

            if (docData.docType !== 'INVENTORY_COUNT') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not an INVENTORY_COUNT type.');
            }

            // You can only lock an active COUNTING state
            if (docData.status !== 'COUNTING') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot lock count document in status: ${docData.status}`);
            }

            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'Document has no lines.');
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

            if (lines.length > 400) {
                // V1 limit: max 400 items per count sheet to protect Firestore 500 write bound limit
                throw new functions.https.HttpsError('unimplemented', 'Max 400 distinct items per count sheet allowed in V1.');
            }

            let totalVarianceUnits = 0;

            for (const line of lines) {
                // Ensure all lines have been counted
                if (line.countedQtyBase === undefined || line.countedQtyBase === null || line.countedQtyBase < 0 || !Number.isInteger(line.countedQtyBase)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} missing valid integer countedQtyBase. Must submit all counted quantities.`);
                }

                if (line.theoreticalQtyBase === undefined || line.theoreticalQtyBase < 0 || !Number.isInteger(line.theoreticalQtyBase)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} missing valid integer theoreticalQtyBase. Did you run createInventoryCount first?`);
                }

                // Compute exact variance at volumetric scale
                const varianceQtyBase = line.countedQtyBase - line.theoreticalQtyBase;

                transaction.update(linesRef.doc(line.id), {
                    varianceQtyBase
                });

                totalVarianceUnits += Math.abs(varianceQtyBase);
            }

            const now = new Date().toISOString();

            // Lock Document into LOCKED mode (Ready for Computation)
            transaction.update(docRef, {
                status: 'LOCKED',
                lockedAt: now,
                totalVarianceUnits
            });

            return { success: true, totalVarianceUnits };
        });

    } catch (e: any) {
        throw new functions.https.HttpsError(e.code || 'internal', e.message);
    }
});
