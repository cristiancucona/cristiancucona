// test/integration/postConsumption.test.ts
import * as admin from 'firebase-admin';
import { postConsumption } from '../../src/api/postConsumption';

describe('postConsumption Integration Tests', () => {
    const db = admin.firestore();

    beforeEach(async () => {
        // Clear Firestore emulator data before each test. Note: This requires the Emulator UI running or specific REST endpoint.
        await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-selio-stocks-v1/databases/(default)/documents', { method: 'DELETE' });
    });

    const mockContext = {
        auth: { uid: 'u_user1', token: {} }
    } as any;

    it('1. FIFO allocation across multiple lots and correct value computation', async () => {
        // Arrange: Create Location, 2 Lots, 1 DRAFT Consumption Doc
        const locationId = 'loc_kitchen';
        const itemId = 'it_chicken';
        const docId = 'doc_cons_1';

        await db.collection('locations').doc(locationId).set({ name: 'Kitchen' });

        // Lot 1 (Older)
        await db.collection('lots').doc('lot_001').set({
            itemId,
            locationId,
            qtyOnHandBase: 50,
            unitCostSubunitsPerBase: 10,
            createdAt: '2026-01-01T10:00:00Z',
            sourceDoc: { docType: 'NIR', docId: 'nir_1' }
        });

        // Lot 2 (Newer)
        await db.collection('lots').doc('lot_002').set({
            itemId,
            locationId,
            qtyOnHandBase: 100,
            unitCostSubunitsPerBase: 15,
            createdAt: '2026-01-02T10:00:00Z',
            sourceDoc: { docType: 'NIR', docId: 'nir_2' }
        });

        // document
        await db.collection('documents').doc(docId).set({
            docType: 'CONSUMPTION',
            subType: 'COMP',
            status: 'DRAFT',
            locationId,
            documentDate: '2026-02-01T10:00:00Z',
            createdAt: '2026-02-01T09:00:00Z',
            createdBy: 'u_user1',
            idempotencyKey: 'cons_1_idem'
        });

        // doc lines (Consume 70 items: should take 50 from lot 1 and 20 from lot 2)
        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId,
            qtyBase: 70,
            reasonCode: 'COMP_STAFF_MEAL'
        });

        // Act
        const wrapped = (postConsumption as any).run;
        await wrapped({ docId }, mockContext);

        // Assert: Lots Decremented
        const lot1Snap = await db.collection('lots').doc('lot_001').get();
        const lot2Snap = await db.collection('lots').doc('lot_002').get();
        expect(lot1Snap.data()?.qtyOnHandBase).toBe(0);
        expect(lot2Snap.data()?.qtyOnHandBase).toBe(80);

        // Assert: Document POSTED
        const docSnap = await db.collection('documents').doc(docId).get();
        expect(docSnap.data()?.status).toBe('POSTED');

        // Assert: Movements & Allocations
        const movementsSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(movementsSnap.size).toBe(1);

        const movement = movementsSnap.docs[0].data();
        expect(movement.type).toBe('CONSUME_COMP'); // Derived from reasonCode containing 'COMP'
        expect(movement.qtyBase).toBe(-70);
        // Value = (50 * 10) + (20 * 15) = 500 + 300 = 800
        expect(movement.valueSubunits).toBe(800);

        expect(movement.lotAllocations.length).toBe(2);
        expect(movement.lotAllocations[0].lotId).toBe('lot_001');
        expect(movement.lotAllocations[0].qtyBase).toBe(50);
        expect(movement.lotAllocations[1].lotId).toBe('lot_002');
        expect(movement.lotAllocations[1].qtyBase).toBe(20);
    });

    it('2. Negative stock blocked (INSUFFICIENT_STOCK)', async () => {
        // Arrange: Only 50 in stock, attempt to consume 60
        const docId = 'doc_cons_2';
        await db.collection('lots').doc('lot_003').set({
            itemId: 'it_oil', locationId: 'loc_k', qtyOnHandBase: 50,
            unitCostSubunitsPerBase: 5, createdAt: '2026-01-01T10:00:00Z', sourceDoc: { docType: 'NIR', docId: 'a' }
        });

        await db.collection('documents').doc(docId).set({
            docType: 'CONSUMPTION', subType: 'WASTE', status: 'DRAFT', locationId: 'loc_k',
            documentDate: '2026-02-01T10:00:00Z', createdAt: '2026-02-01', createdBy: 'u_user1', idempotencyKey: 'idem'
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_oil', qtyBase: 60, reasonCode: 'WASTE_SPILL'
        });

        // Act & Assert
        const wrapped = (postConsumption as any).run;
        await expect(wrapped({ docId }, mockContext)).rejects.toThrow('INSUFFICIENT_STOCK');

        // Assert immutability on failure
        const lotSnap = await db.collection('lots').doc('lot_003').get();
        expect(lotSnap.data()?.qtyOnHandBase).toBe(50); // No partial allocation
        const docSnap = await db.collection('documents').doc(docId).get();
        expect(docSnap.data()?.status).toBe('DRAFT'); // Still draft
    });

    it('3. Idempotency enforced (Post twice -> no duplicate movements)', async () => {
        const docId = 'doc_cons_3';
        await db.collection('lots').doc('lot_004').set({
            itemId: 'it_salt', locationId: 'loc_k', qtyOnHandBase: 100, unitCostSubunitsPerBase: 1,
            createdAt: '2026-01-01T10:00:00Z', sourceDoc: { docType: 'NIR', docId: '1' }
        });

        await db.collection('documents').doc(docId).set({
            docType: 'CONSUMPTION', subType: 'WASTE', status: 'DRAFT', locationId: 'loc_k',
            documentDate: '2026-02-01', createdAt: '2026', createdBy: 'u1', idempotencyKey: 'idem3'
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_salt', qtyBase: 10, reasonCode: 'WASTE'
        });

        const wrapped = (postConsumption as any).run;

        // First Call
        const res1 = await wrapped({ docId }, mockContext);
        expect(res1.alreadyPosted).toBe(false);

        // Assert first call succeeded
        const lotSnap1 = await db.collection('lots').doc('lot_004').get();
        expect(lotSnap1.data()?.qtyOnHandBase).toBe(90);

        // Second Call
        const res2 = await wrapped({ docId }, mockContext);
        expect(res2.alreadyPosted).toBe(true); // Should return early

        // Assert lots not deducted twice
        const lotSnap2 = await db.collection('lots').doc('lot_004').get();
        expect(lotSnap2.data()?.qtyOnHandBase).toBe(90);

        // Assert only 1 movement exists
        const moveSnaps = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(moveSnaps.size).toBe(1);
    });
});
