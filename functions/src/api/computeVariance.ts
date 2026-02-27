import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { allocateFifoShadows, ShadowLot } from '../ledger/fifo';
import { Document, Movement, Lot } from '../types/domain';

const VARIANCE_THRESHOLD_SUBUNITS = 50000;

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
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Document not found.');
            }

            const docData = docSnap.data() as Document;

            if (docData.docType !== 'INVENTORY_COUNT') {
                throw new functions.https.HttpsError('failed-precondition', 'Document is not an INVENTORY_COUNT type.');
            }

            if (docData.status === 'POSTED') {
                return { success: true, status: 'POSTED', alreadyPosted: true };
            }

            if (docData.status !== 'LOCKED' && docData.status !== 'PENDING_APPROVAL') {
                throw new functions.https.HttpsError('failed-precondition', `Cannot compute variance for document in status: ${docData.status}`);
            }

            const locationId = docData.locationId;
            if (!locationId) {
                throw new functions.https.HttpsError('failed-precondition', 'Missing locationId.');
            }

            const linesSnap = await transaction.get(linesRef);
            if (linesSnap.empty) {
                return { success: true, status: docData.status, allLinesProcessed: true };
            }

            const lines = linesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

            const unprocessedLines = lines.filter(l => l.varianceValueSubunits === undefined);
            const batchLines = unprocessedLines.slice(0, 150);

            if (batchLines.length === 0) {
                return { success: true, status: docData.status, allLinesProcessed: true };
            }

            const lotsQuery = db.collection('lots').where('locationId', '==', locationId);
            const lotsSnap = await transaction.get(lotsQuery);

            const allItemIds = Array.from(new Set(lines.map(line => line.itemId)));
            const allItemIdsSet = new Set(allItemIds);

            const shadowLotsAll: ShadowLot[] = lotsSnap.docs
                .map(doc => ({
                    id: doc.id,
                    ref: doc.ref,
                    ...doc.data() as any
                }))
                .filter(l => allItemIdsSet.has(l.itemId));

            const baselineCostMap = new Map<string, number>();
            const shadowLotsAllDescending = [...shadowLotsAll].sort((a, b) => {
                const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt as any).toMillis?.() || 0;
                const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : (b.createdAt as any).toMillis?.() || 0;
                return timeB - timeA;
            });

            for (const lot of shadowLotsAllDescending) {
                if (!baselineCostMap.has(lot.itemId)) {
                    baselineCostMap.set(lot.itemId, lot.unitCostFloorSubunitsPerBase);
                }
            }

            let totalAbsVarianceSubunits = Number((docData as any).totalVarianceValueSubunits) || 0;
            const now = new Date().toISOString();

            let projectedTotalAbsVariance = totalAbsVarianceSubunits;
            if (!projectedTotalAbsVariance) {
                const dryRunShadows: ShadowLot[] = shadowLotsAll.map(l => ({ ...l }));
                for (const line of lines) {
                    const vq = line.varianceQtyBase || 0;
                    if (vq < 0) {
                        const shrink = Math.abs(vq);
                        const active = dryRunShadows
                            .filter(l => l.itemId === line.itemId && l.qtyOnHandBase > 0)
                            .sort((a, b) => {
                                const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0;
                                const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0;
                                return timeA - timeB;
                            });
                        const { totalValueSubunits } = allocateFifoShadows(active, line.itemId, locationId, shrink);
                        projectedTotalAbsVariance += totalValueSubunits;
                    } else if (vq > 0) {
                        const bc = baselineCostMap.get(line.itemId) || 0;
                        projectedTotalAbsVariance += vq * bc;
                    }
                }
            }

            const role = context.auth.token?.role;
            const isAdmin = context.auth.token?.admin === true;
            const isAuthorizedToApprove = role === 'OWNER' || role === 'GM' || isAdmin;

            if (projectedTotalAbsVariance > VARIANCE_THRESHOLD_SUBUNITS && !isAuthorizedToApprove) {
                transaction.update(docRef, {
                    status: 'PENDING_APPROVAL',
                    totalVarianceValueSubunits: projectedTotalAbsVariance,
                    computedAt: now
                });
                return { success: true, status: 'PENDING_APPROVAL' };
            }

            const batchItemIdsSet = new Set(batchLines.map(line => line.itemId));
            const shadowLotsBatch = shadowLotsAll.filter(l => batchItemIdsSet.has(l.itemId));
            const originalLotQtys = new Map<string, number>(shadowLotsBatch.map(l => [l.id, l.qtyOnHandBase]));

            const movementsToWrite: { ref: admin.firestore.DocumentReference; data: Movement }[] = [];
            const lotsToCreate: { ref: admin.firestore.DocumentReference; data: Lot }[] = [];

            const WRITE_BUDGET = 450;
            let writesPlanned = 2; // doc + status buffer
            let processedLinesCount = 0;

            for (const line of batchLines) {
                let lineWritesEstimate = 1;
                const varianceQty = line.varianceQtyBase;

                if (varianceQty === undefined || varianceQty === null || !Number.isInteger(varianceQty)) {
                    throw new functions.https.HttpsError('invalid-argument', `Line ${line.id} missing valid integer varianceQtyBase.`);
                }

                if (varianceQty === 0) {
                    if (writesPlanned + lineWritesEstimate > WRITE_BUDGET) break;
                    transaction.update(linesRef.doc(line.id), { varianceValueSubunits: 0 });
                    writesPlanned += lineWritesEstimate;
                    processedLinesCount++;
                    continue;
                }

                if (varianceQty < 0) {
                    const shrinkAmount = Math.abs(varianceQty);
                    const activeShadows = shadowLotsBatch.filter(l => l.itemId === line.itemId && l.qtyOnHandBase > 0).sort((a, b) => {
                        const timeA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0;
                        const timeB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0;
                        return timeA - timeB;
                    });

                    const clonedShadows = activeShadows.map(l => ({ ...l }));
                    const { totalValueSubunits, allocations } = allocateFifoShadows(clonedShadows, line.itemId, locationId, shrinkAmount);

                    lineWritesEstimate += 1 + allocations.length;
                    if (writesPlanned + lineWritesEstimate > WRITE_BUDGET) break;

                    allocateFifoShadows(activeShadows, line.itemId, locationId, shrinkAmount);
                    totalAbsVarianceSubunits += totalValueSubunits;

                    const movementOutRef = db.collection('movements').doc();
                    movementsToWrite.push({
                        ref: movementOutRef,
                        data: {
                            type: 'ADJUSTMENT_OUT',
                            itemId: line.itemId,
                            locationId,
                            qtyBase: -shrinkAmount,
                            valueSubunits: totalValueSubunits,
                            lotAllocations: allocations,
                            sourceDoc: { docType: 'INVENTORY_COUNT', docId },
                            createdAt: now,
                            createdBy: context.auth.uid,
                            documentDate: docData.documentDate,
                            idempotencyKey: `idem_count_${docId}_out_${line.id}`
                        }
                    });
                    transaction.update(linesRef.doc(line.id), {
                        varianceValueSubunits: -totalValueSubunits
                    });

                } else if (varianceQty > 0) {
                    lineWritesEstimate += 2;
                    if (writesPlanned + lineWritesEstimate > WRITE_BUDGET) break;

                    const baselineCost = baselineCostMap.get(line.itemId);
                    if (baselineCost === undefined || baselineCost === null) {
                        throw new functions.https.HttpsError('failed-precondition', `Cannot process positive variance for Item ${line.itemId} as no historical Lot Floor Cost was found.`);
                    }

                    const gainValueSubunits = varianceQty * baselineCost;
                    totalAbsVarianceSubunits += gainValueSubunits;

                    const targetLotRef = db.collection('lots').doc();
                    lotsToCreate.push({
                        ref: targetLotRef,
                        data: {
                            itemId: line.itemId,
                            locationId,
                            createdAt: now,
                            unitCostFloorSubunitsPerBase: baselineCost,
                            residualUnitsOnHand: 0,
                            qtyOnHandBase: varianceQty,
                            sourceDoc: { docType: 'INVENTORY_COUNT', docId },
                            status: 'ACTIVE'
                        }
                    });

                    const movementInRef = db.collection('movements').doc();
                    movementsToWrite.push({
                        ref: movementInRef,
                        data: {
                            type: 'ADJUSTMENT_IN',
                            itemId: line.itemId,
                            locationId,
                            qtyBase: varianceQty,
                            valueSubunits: gainValueSubunits,
                            sourceDoc: { docType: 'INVENTORY_COUNT', docId },
                            createdAt: now,
                            createdBy: context.auth.uid,
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

            for (const sl of shadowLotsBatch) {
                const originalQty = originalLotQtys.get(sl.id);
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

            const remaining = unprocessedLines.length - processedLinesCount;
            const isFullyProcessed = remaining <= 0;
            const finalStatus = isFullyProcessed ? 'POSTED' : 'LOCKED';

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
