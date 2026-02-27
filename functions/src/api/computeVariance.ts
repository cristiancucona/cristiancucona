import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { allocateFifoShadows, ShadowLot } from '../ledger/fifo';
import { Document, Movement, Lot } from '../types/domain';

const VARIANCE_THRESHOLD_SUBUNITS = 50000; // Manager Approval required for >$500 abs variance

export const computeVariance = functions.https.onCall(async (data, context) => {
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
            // PHASE 1: READ EVERYTHING
            // ==========================================
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            const docData = docSnap.data() as Document;

            if (docData.docType !== 'INVENTORY_COUNT') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not an INVENTORY_COUNT type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, alreadyPosted: true };
            }

            // Must only run computation on LOCKED or PENDING_APPROVAL formats
            if (docData.status !== 'LOCKED' && docData.status !== 'PENDING_APPROVAL') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot compute variance for document in status: ${docData.status}`);
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

            // Enforce safe 150 line batch to prevent hitting 500 max writes
            // User must continue triggering computation on the doc until POSTED
            const unprocessedLines = lines.filter(l => l.varianceValueSubunits === undefined);
            const batchLines = unprocessedLines.slice(0, 150);

            if (batchLines.length === 0) {
                // Failsafe. If all lines processed but status is somewhat not completed
                return { success: true, allLinesProcessed: true };
            }

            const itemIds = Array.from(new Set(batchLines.map(line => line.itemId)));

            const lotsQuery = db.collection('lots')
                .where('locationId', '==', locationId);
            // Cannot filter strictly by qtyOnHandBase > 0 because we need active lots for POSITIVE variance cost fallback

            const lotsSnap = await transaction.get(lotsQuery);

            // ==========================================
            // PHASE 2: IN-MEMORY COMPUTATION (Shadows)
            // ==========================================
            const itemIdsSet = new Set(itemIds);

            const shadowLots: ShadowLot[] = lotsSnap.docs
                .map(doc => ({
                    id: doc.id,
                    ref: doc.ref,
                    ...doc.data() as any
                }))
                .filter(l => itemIdsSet.has(l.itemId))
                // Sort by time
                .sort((a, b) => {
                    const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt as any).toMillis?.() || 0;
                    const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : (b.createdAt as any).toMillis?.() || 0;
                    return timeB - timeA; // Descending, newest first
                });

            // Build deterministic baseline cost map
            const baselineCostMap = new Map<string, number>();
            for (const lot of shadowLots) {
                // shadowLots is descending by date, so the first match per item is the newest
                if (!baselineCostMap.has(lot.itemId)) {
                    baselineCostMap.set(lot.itemId, lot.unitCostFloorSubunitsPerBase);
                }
            }

            const originalLotQtys = new Map<string, number>(shadowLots.map(l => [l.id, l.qtyOnHandBase]));

            const movementsToWrite: { ref: admin.firestore.DocumentReference; data: Movement }[] = [];
            const lotsToCreate: { ref: admin.firestore.DocumentReference; data: Lot }[] = [];
            const now = new Date().toISOString();

            const WRITE_BUDGET = 450;
            let writesPlanned = 0;
            // 1 doc update + 1 final status write (buffer)
            writesPlanned += 2;

            let totalAbsVarianceSubunits = Number((docData as any).totalVarianceValueSubunits) || 0;
            let processedLinesCount = 0;

            for (const line of batchLines) {
                // Estimate baseline writes for this line:
                // 1 for line update (varianceValueSubunits)
                let lineWritesEstimate = 1;

                const varianceQty = line.varianceQtyBase;

                if (varianceQty === undefined || varianceQty === null || !Number.isInteger(varianceQty)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} missing valid integer varianceQtyBase. Must run lockInventoryCount first.`);
                }

                if (varianceQty === 0) {
                    if (writesPlanned + lineWritesEstimate > WRITE_BUDGET) break;
                    transaction.update(linesRef.doc(line.id), { varianceValueSubunits: 0 }); // Mark processed
                    writesPlanned += lineWritesEstimate;
                    processedLinesCount++;
                    continue; // Perfect count
                }

                if (varianceQty < 0) {
                    // SHRINKAGE (Negative Variance)
                    // Action: EXACT Lot Value FIFO Consumption
                    const shrinkAmount = Math.abs(varianceQty);
                    const activeShadows = shadowLots.filter(l => l.itemId === line.itemId && l.qtyOnHandBase > 0);
                    const { totalValueSubunits, allocations } = allocateFifoShadows(activeShadows, line.itemId, locationId, shrinkAmount);

                    // Estimate: 1 movement + N lot updates
                    lineWritesEstimate += 1 + allocations.length;

                    if (writesPlanned + lineWritesEstimate > WRITE_BUDGET) {
                        // Reached budget bound. Break before mutating in-memory shadows
                        break;
                    }

                    totalAbsVarianceSubunits += totalValueSubunits;

                    const movementOutRef = db.collection('movements').doc();
                    movementsToWrite.push({
                        ref: movementOutRef,
                        data: {
                            type: 'ADJUSTMENT_OUT',
                            itemId: line.itemId, // Fix
                            locationId,
                            qtyBase: -shrinkAmount,
                            valueSubunits: totalValueSubunits,
                            lotAllocations: allocations,
                            sourceDoc: { docType: 'INVENTORY_COUNT', docId },
                            createdAt: now,
                            createdBy: context.auth?.uid,
                            documentDate: docData.documentDate,
                            idempotencyKey: `idem_count_${docId}_out_${line.id}`
                        }
                    });
                    // Save explicit loss to the line reference
                    transaction.update(linesRef.doc(line.id), {
                        varianceValueSubunits: -totalValueSubunits
                    });

                } else if (varianceQty > 0) {
                    // POSITIVE VARIANCE (Stock Found)
                    // Action: EXACT Lot Value Generation based on newest lot price

                    // Estimate: 1 movement + 1 lot create
                    lineWritesEstimate += 2;

                    if (writesPlanned + lineWritesEstimate > WRITE_BUDGET) {
                        break;
                    }

                    const baselineCost = baselineCostMap.get(line.itemId);
                    if (baselineCost === undefined || baselineCost === null) {
                        // User explicitly requested we fail fast rather than diluting 0 cost
                        throw new functions.https.HttpsError('failed-precondition', `Cannot process positive variance for Item ${line.itemId} as no historical Lot Floor Cost was found. You must establish initial cost basis (e.g. Receipt) before counting new found stock.`);
                    }

                    const gainValueSubunits = varianceQty * baselineCost;

                    totalAbsVarianceSubunits += gainValueSubunits;

                    // Create newly established positive lot seamlessly
                    const targetLotRef = db.collection('lots').doc();
                    lotsToCreate.push({
                        ref: targetLotRef,
                        data: {
                            itemId: line.itemId,
                            locationId,
                            createdAt: now,
                            unitCostFloorSubunitsPerBase: baselineCost,
                            residualUnitsOnHand: 0, // No fractionals on generated stock
                            qtyOnHandBase: varianceQty,
                            sourceDoc: { docType: 'INVENTORY_COUNT', docId },
                            status: 'ACTIVE'
                        }
                    });

                    // Log IN adjustment natively matched
                    const movementInRef = db.collection('movements').doc();
                    movementsToWrite.push({
                        ref: movementInRef,
                        data: {
                            type: 'ADJUSTMENT_IN',
                            itemId: line.itemId,
                            locationId,
                            qtyBase: varianceQty, // Positive Gain
                            valueSubunits: gainValueSubunits,
                            sourceDoc: { docType: 'INVENTORY_COUNT', docId },
                            createdAt: now,
                            createdBy: context.auth?.uid,
                            documentDate: docData.documentDate,
                            idempotencyKey: `idem_count_${docId}_in_${line.id}`
                        }
                    });

                    transaction.update(linesRef.doc(line.id), {
                        varianceValueSubunits: gainValueSubunits
                    });
                }

                writesPlanned += lineWritesEstimate;
                processedLinesCount++;
            }

            //THRESHOLD LOGIC 
            const role = context.auth?.token?.role;
            const isAdmin = context.auth?.token?.admin === true;
            const isAuthorizedToApprove = role === 'OWNER' || role === 'GM' || isAdmin;

            if (totalAbsVarianceSubunits > VARIANCE_THRESHOLD_SUBUNITS && !isAuthorizedToApprove) {
                // Failsafe exit logic. Document is frozen in PENDING_APPROVAL and nothing writes back to active Lots.
                transaction.update(docRef, {
                    status: 'PENDING_APPROVAL',
                    totalVarianceValueSubunits: totalAbsVarianceSubunits,
                    computedAt: now
                });
                return { success: true, status: 'PENDING_APPROVAL' };
            }

            // ==========================================
            // PHASE 3: WRITE BACK
            // ==========================================
            for (const sl of shadowLots) {
                const originalQty = originalLotQtys.get(sl.id);
                // we check original against active so we don't accidentally resurrect purely for cost-reads
                if (sl.qtyOnHandBase !== originalQty) {
                    transaction.update(sl.ref, {
                        qtyOnHandBase: sl.qtyOnHandBase,
                        residualUnitsOnHand: sl.residualUnitsOnHand,
                        status: sl.qtyOnHandBase === 0 ? 'DEPLETED' : 'ACTIVE'
                    });
                }
            }

            for (const lc of lotsToCreate) transaction.set(lc.ref, lc.data);
            for (const mov of movementsToWrite) transaction.set(mov.ref, mov.data);

            const isFullyProcessed = processedLinesCount === batchLines.length && unprocessedLines.length === batchLines.length;
            const finalStatus = isFullyProcessed ? 'POSTED' : docData.status;

            const updateData: any = {
                status: finalStatus,
                totalVarianceValueSubunits: totalAbsVarianceSubunits,
                computedAt: now
            };

            if (isFullyProcessed) {
                updateData.postedAt = now;
            }

            transaction.update(docRef, updateData);

            return { success: true, status: finalStatus, nextBatchAvailable: !isFullyProcessed };
        });

    } catch (e: any) {
        throw new functions.https.HttpsError(e.code || 'internal', e.message);
    }
});
