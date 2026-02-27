import * as admin from 'firebase-admin';

import { postPrepProduction } from '../../src/api/postPrepProduction';

describe('postPrepProduction Integration Tests', () => {
    const db = admin.firestore();

    beforeEach(async () => {
        await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-selio-stocks-v1/databases/(default)/documents', { method: 'DELETE' });
    });

    const mockContext = { auth: { uid: 'u_tester' } } as any;

    it('1. Post PREP_PRODUCTION happy path (Merges 2 ingredients into 1 prep)', async () => {
        const locationId = 'loc_kitchen';
        const docId = 'doc_prep_1';

        // Seed 2 ingredients
        await db.collection('lots').doc('lot_sugar').set({
            itemId: 'it_sugar', locationId,
            qtyOnHandBase: 1000, unitCostFloorSubunitsPerBase: 5, residualUnitsOnHand: 0, createdAt: '2026-02-01T10:00:00Z'
        });
        await db.collection('lots').doc('lot_water').set({
            itemId: 'it_water', locationId,
            qtyOnHandBase: 5000, unitCostFloorSubunitsPerBase: 1, residualUnitsOnHand: 0, createdAt: '2026-02-01T10:00:00Z'
        });

        await db.collection('documents').doc(docId).set({
            docType: 'PREP_PRODUCTION',
            status: 'DRAFT',
            locationId,
            producedItemId: 'it_syrup',
            producedQtyBase: 2000, // Yielding 2000g of syrup
            documentDate: '2026-02-15T08:00:00Z',
            createdAt: '2026-02-15T07:50:00Z',
            createdBy: 'u_tester'
        });

        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_sugar', qtyBase: 500 // Cost: 500 * 5 = 2500
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_2').set({
            itemId: 'it_water', qtyBase: 1000 // Cost: 1000 * 1 = 1000
        });
        // Total Input Value: 3500 subunits
        // Unit Cost: 3500 / 2000 = 1.75 => approx 2 (assuming integer rounding per spec)

        const wrapped = (postPrepProduction as any).run;
        await wrapped({ docId }, mockContext);

        // Assert: Target lot created
        const lotsSnap = await db.collection('lots').where('itemId', '==', 'it_syrup').get();
        expect(lotsSnap.size).toBe(1);
        const newLot = lotsSnap.docs[0].data();
        expect(newLot.qtyOnHandBase).toBe(2000);
        // Cost: 3500 / 2000 => Floor: 1, Residual: 1500
        expect(newLot.unitCostFloorSubunitsPerBase).toBe(1);
        expect(newLot.residualUnitsOnHand).toBe(1500);

        // Assert: Movements
        const mvSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(mvSnap.size).toBe(3); // 2 OUT, 1 IN

        const inMv = mvSnap.docs.find(d => d.data().type === 'PREP_IN')?.data();
        expect(inMv?.valueSubunits).toBe(3500); // IN movement absorbs literal consumed value
    });

    it('2. Fails if ingredients not sufficient', async () => {
        const docId = 'doc_prep_2';
        await db.collection('documents').doc(docId).set({
            docType: 'PREP_PRODUCTION', status: 'DRAFT', locationId: 'loc_K',
            producedItemId: 'it_syrup', producedQtyBase: 100
        });
        await db.collection('documents').doc(docId).collection('lines').doc('l1').set({
            itemId: 'it_ghost', qtyBase: 50 // Doesn't exist
        });

        const wrapped = (postPrepProduction as any).run;
        await expect(wrapped({ docId }, mockContext)).rejects.toThrow(/INSUFFICIENT_STOCK/);
    });
});
