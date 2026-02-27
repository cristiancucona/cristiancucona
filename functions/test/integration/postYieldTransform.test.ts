import * as admin from 'firebase-admin';
import { clearFirestoreData } from '@firebase/rules-unit-testing';
import { postYieldTransform } from '../../src/api/postYieldTransform';

describe('postYieldTransform Integration Tests', () => {
    const db = admin.firestore();

    beforeEach(async () => {
        await clearFirestoreData({ projectId: 'demo-selio-stocks-v1' });
    });

    const mockContext = { auth: { uid: 'u_tester' } } as any;

    it('1. Post YIELD_TRANSFORM happy path (Shrinks gross raw into usable with 100% value mapped)', async () => {
        const locationId = 'loc_kitchen';
        const docId = 'doc_yield_1';

        // Seed 1 raw ingredient
        await db.collection('lots').doc('lot_raw_meat').set({
            itemId: 'it_raw_meat', locationId,
            qtyOnHandBase: 10000, // 10kg
            unitCostFloorSubunitsPerBase: 10,
            residualUnitsOnHand: 0,
            createdAt: '2026-02-01T10:00:00Z',
            status: 'ACTIVE'
        });

        await db.collection('documents').doc(docId).set({
            docType: 'YIELD_TRANSFORM',
            status: 'DRAFT',
            locationId,
            sourceItemId: 'it_raw_meat',
            grossQtyBase: 5000, // Processing 5kg (cost: 50,000 subunits)
            targetItemId: 'it_usable_meat',
            usableQtyBase: 4000, // Yields 4kg (shrinkage 1kg)
            documentDate: '2026-02-15T08:00:00Z',
            createdAt: '2026-02-15T07:50:00Z',
            createdBy: 'u_tester',
            idempotencyKey: 'idem_yield_1'
        });

        const wrapped = (postYieldTransform as any).run;
        await wrapped({ docId }, mockContext);

        // Assert: Source lot depleted
        const sourceLot = await db.collection('lots').doc('lot_raw_meat').get();
        expect(sourceLot.data()?.qtyOnHandBase).toBe(5000);

        // Assert: Target lot created with packed unit value
        const lotsSnap = await db.collection('lots').where('itemId', '==', 'it_usable_meat').get();
        expect(lotsSnap.size).toBe(1);
        const newLot = lotsSnap.docs[0].data();
        expect(newLot.qtyOnHandBase).toBe(4000); // 4kg
        // Math.floor(50000 / 4000) = 12, residual = 50000 % 4000 = 2000
        expect(newLot.unitCostFloorSubunitsPerBase).toBe(12);
        expect(newLot.residualUnitsOnHand).toBe(2000);

        // Assert: Movements (1 OUT, 1 IN, 1 LOSS)
        const mvSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(mvSnap.size).toBe(3);

        const outMv = mvSnap.docs.find(d => d.data().type === 'YIELD_OUT')?.data();
        expect(outMv?.valueSubunits).toBe(50000);
        expect(outMv?.qtyBase).toBe(-5000);

        const inMv = mvSnap.docs.find(d => d.data().type === 'YIELD_IN')?.data();
        expect(inMv?.valueSubunits).toBe(50000); // Financial value transfers 100%
        expect(inMv?.qtyBase).toBe(4000);

        const lossMv = mvSnap.docs.find(d => d.data().type === 'YIELD_LOSS')?.data();
        expect(lossMv?.valueSubunits).toBe(0); // STRICT: 0 value leakage
        expect(lossMv?.qtyBase).toBe(-1000); // Exposes strictly the operational volumetric shrink
    });

    it('2. Guards against backward shrinkage (gross < usable)', async () => {
        const docId = 'doc_yield_2';
        await db.collection('documents').doc(docId).set({
            docType: 'YIELD_TRANSFORM', status: 'DRAFT', locationId: 'loc_K',
            sourceItemId: 'it_raw', grossQtyBase: 50,
            targetItemId: 'it_usable', usableQtyBase: 60 // Invalid
        });

        const wrapped = (postYieldTransform as any).run;
        await expect(wrapped({ docId }, mockContext)).rejects.toThrow(/Gross quantity cannot be less/);
    });
});
