import * as admin from 'firebase-admin';

import { createInventoryCount } from '../../src/api/createInventoryCount';
import { lockInventoryCount } from '../../src/api/lockInventoryCount';
import { computeVariance } from '../../src/api/computeVariance';

describe('Sprint 4: Inventory Count & Variance Integration Tests', () => {
    const db = admin.firestore();

    beforeEach(async () => {
        await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-selio-stocks-v1/databases/(default)/documents', { method: 'DELETE' });
    });

    const mockAdminContext = {
        auth: { uid: 'u_admin', token: { role: 'OWNER', admin: true } }
    } as any;

    const mockStaffContext = {
        auth: { uid: 'u_staff', token: { role: 'USER' } }
    } as any;

    it('1. Full Happy Path (Negative & Positive Variance)', async () => {
        const locationId = 'loc_warehouse';
        const docId = 'doc_count_1';

        // Seed Lots:
        // Item A (Flour): 100 units @ Floor 50
        await db.collection('lots').doc('lot_flour_1').set({
            itemId: 'it_flour', locationId,
            qtyOnHandBase: 100, unitCostFloorSubunitsPerBase: 50, residualUnitsOnHand: 0,
            createdAt: '2026-02-01T10:00:00Z', status: 'ACTIVE'
        });

        // Item B (Sugar): 50 units @ Floor 10
        await db.collection('lots').doc('lot_sugar_1').set({
            itemId: 'it_sugar', locationId,
            qtyOnHandBase: 50, unitCostFloorSubunitsPerBase: 10, residualUnitsOnHand: 0,
            createdAt: '2026-02-01T10:00:00Z', status: 'ACTIVE'
        });

        // Create Count Doc
        await db.collection('documents').doc(docId).set({
            docType: 'INVENTORY_COUNT', status: 'DRAFT', locationId,
            documentDate: '2026-02-28T12:00:00Z', createdAt: '2026-02-28T11:50:00Z', createdBy: 'u_staff'
        });

        // Two lines for counting
        await db.collection('documents').doc(docId).collection('lines').doc('line_flour').set({
            itemId: 'it_flour'
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_sugar').set({
            itemId: 'it_sugar'
        });

        // STEP 1: Create Snapshot
        const createWrapped = (createInventoryCount as any).run;
        await createWrapped({ docId }, mockStaffContext);

        // Assert: Thoretic Qty set
        const flourLineSnap = await db.collection('documents').doc(docId).collection('lines').doc('line_flour').get();
        expect(flourLineSnap.data()?.theoreticalQtyBase).toBe(100);

        // STEP 2: Submit Counts and Lock
        // Mocking user input from UI:
        await db.collection('documents').doc(docId).collection('lines').doc('line_flour').update({
            countedQtyBase: 90 // Lost 10 units! (Negative)
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_sugar').update({
            countedQtyBase: 55 // Found 5 units! (Positive)
        });

        const lockWrapped = (lockInventoryCount as any).run;
        await lockWrapped({ docId }, mockStaffContext);

        const docSnapAfterLock = await db.collection('documents').doc(docId).get();
        expect(docSnapAfterLock.data()?.status).toBe('LOCKED');

        // STEP 3: Compute exact value variance
        const computeWrapped = (computeVariance as any).run;
        const computeResult = await computeWrapped({ docId }, mockStaffContext); // Using Staff Context (Should still post if under threshold!)

        expect(computeResult.status).toBe('POSTED'); // Total Variance = (10*50)+(5*10) = 550 subunits. < 50000 threshold.

        // Assert: Movements & Exact Logic applied
        const mvSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(mvSnap.size).toBe(2);

        const outMv = mvSnap.docs.find(d => d.data().type === 'ADJUSTMENT_OUT')?.data();
        expect(outMv?.qtyBase).toBe(-10); // Shrink 10
        expect(outMv?.valueSubunits).toBe(500); // 10 * 50

        const inMv = mvSnap.docs.find(d => d.data().type === 'ADJUSTMENT_IN')?.data();
        expect(inMv?.qtyBase).toBe(5); // Found 5
        expect(inMv?.valueSubunits).toBe(50); // Derived exactly from most recent lot (50 * 10)

        // Assert: New generated POSITIVE Lot has 0 fractional residual natively
        const newLotsSnap = await db.collection('lots').where('itemId', '==', 'it_sugar').get();
        expect(newLotsSnap.size).toBe(2); // The new +5 lot was generated
        const generatedFoundLot = newLotsSnap.docs.find(l => l.data().qtyOnHandBase === 5)?.data();
        expect(generatedFoundLot?.unitCostFloorSubunitsPerBase).toBe(10);
        expect(generatedFoundLot?.residualUnitsOnHand).toBe(0); // Perfect cleanly minted value
    });

    it('2. Blocks non-manager execution over absolute variance threshold', async () => {
        // Mock massive value loss
        const docId = 'doc_count_2';
        await db.collection('lots').doc('lot_gold').set({
            itemId: 'it_gold', locationId: 'loc_A',
            qtyOnHandBase: 10, unitCostFloorSubunitsPerBase: 10000, residualUnitsOnHand: 0, // 100k value
            createdAt: '2026-02-01T10:00:00Z', status: 'ACTIVE'
        });

        await db.collection('documents').doc(docId).set({
            docType: 'INVENTORY_COUNT', status: 'LOCKED', locationId: 'loc_A', totalVarianceUnits: 6
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_g').set({
            itemId: 'it_gold', theoreticalQtyBase: 10, countedQtyBase: 4, varianceQtyBase: -6
        });

        const computeWrapped = (computeVariance as any).run;

        // Staff context throws to APPROVAL
        const staffRes = await computeWrapped({ docId }, mockStaffContext);
        expect(staffRes.status).toBe('PENDING_APPROVAL');

        const docSnapAfterStaff = await db.collection('documents').doc(docId).get();
        expect(docSnapAfterStaff.data()?.status).toBe('PENDING_APPROVAL');

        // Admin context posts
        const adminRes = await computeWrapped({ docId }, mockAdminContext);
        expect(adminRes.status).toBe('POSTED');
    });

    it('3. Write Budget dynamically pauses execution during excessive multi-lot shrinkages', async () => {
        const locationId = 'loc_store';
        const docId = 'doc_count_budget_limit';
        const itemId = 'it_screws';

        // Seed 20 tiny lots 
        for (let i = 1; i <= 20; i++) {
            await db.collection('lots').doc(`lot_screws_${i}`).set({
                itemId, locationId,
                qtyOnHandBase: 1,
                unitCostFloorSubunitsPerBase: 10,
                residualUnitsOnHand: 0,
                createdAt: `2026-02-01T10:00:${i.toString().padStart(2, '0')}Z`,
                status: 'ACTIVE'
            });
        }

        // Setup Document
        await db.collection('documents').doc(docId).set({
            docType: 'INVENTORY_COUNT', status: 'LOCKED', locationId,
            documentDate: '2026-02-28T12:00:00Z', totalVarianceUnits: 15
        });

        // 1 Line that shrinks 15 of these lots!
        // allocations.length = 15 updates + 1 movement + 1 line update = 17 writes per line.
        // If we theoretically seeded 30 such lines, it would exceed 450.
        // Let's seed 30 identical lines simulating massive fragmentation traversal
        for (let i = 1; i <= 30; i++) {
            await db.collection('documents').doc(docId).collection('lines').doc(`line_scr_${i}`).set({
                itemId,
                varianceQtyBase: -15
            });
        }

        // Run Compute - Should PAUSE before processing all lines due to 17 writes per line extending over 450 (which is ~26 lines)
        const computeWrapped = (computeVariance as any).run;
        const result = await computeWrapped({ docId }, mockAdminContext);

        expect(result.nextBatchAvailable).toBe(true);

        const docSnapAfterSweep = await db.collection('documents').doc(docId).get();
        expect(docSnapAfterSweep.data()?.status).toBe('LOCKED'); // Retains locked until fully swept
        expect(docSnapAfterSweep.data()?.postedAt).toBeUndefined(); // Never posted yet
        expect(docSnapAfterSweep.data()?.computedAt).toBeDefined();

        // Check that SOME lines were processed but not ALL
        const linesProcessedSnap = await db.collection('documents').doc(docId).collection('lines').where('varianceValueSubunits', '!=', null).get();

        // Exact formula: 450 - 2 (doc updates) = 448 available. 
        // 448 / 17 writes per line = 26.3 -> 26 lines processed before pausing.
        expect(linesProcessedSnap.size).toBe(26);
    });
});
