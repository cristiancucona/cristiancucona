import * as admin from 'firebase-admin';
import { clearFirestoreData } from '@firebase/rules-unit-testing';
import { postTransfer } from '../../src/api/postTransfer';

describe('postTransfer Integration Tests', () => {
    const db = admin.firestore();

    beforeEach(async () => {
        await clearFirestoreData({ projectId: 'demo-selio-stocks-v1' });
    });

    const mockContext = {
        auth: { uid: 'u_tester' }
    } as any;

    it('1. Post TRANSFER happy path (Moves allocation, retains value)', async () => {
        // Arrange
        const fromLoc = 'loc_A';
        const toLoc = 'loc_B';
        const docId = 'doc_trx_1';

        // Seed initial lots
        await db.collection('lots').doc('lot_1').set({
            itemId: 'it_flour',
            locationId: fromLoc,
            qtyOnHandBase: 100,
            unitCostFloorSubunitsPerBase: 50,
            residualUnitsOnHand: 0,
            createdAt: '2026-02-01T10:00:00Z',
            status: 'ACTIVE'
        });

        await db.collection('documents').doc(docId).set({
            docType: 'TRANSFER',
            status: 'DRAFT',
            locationId: fromLoc,
            vendorId: toLoc, // Target
            documentDate: '2026-02-15T08:00:00Z',
            createdAt: '2026-02-15T07:50:00Z',
            createdBy: 'u_tester',
            idempotencyKey: 'idem_trx_1'
        });

        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_flour',
            qtyBase: 40 // Transferring 40 out of 100
        });

        // Act
        const wrapped = (postTransfer as any).run;
        await wrapped({ docId }, mockContext);

        // Assert: Document
        const docSnap = await db.collection('documents').doc(docId).get();
        expect(docSnap.data()?.status).toBe('POSTED');

        // Assert: Source lot depleted
        const sourceLot = await db.collection('lots').doc('lot_1').get();
        expect(sourceLot.data()?.qtyOnHandBase).toBe(60);

        // Assert: Target lot created mirrored
        const lotsSnap = await db.collection('lots').where('locationId', '==', toLoc).get();
        expect(lotsSnap.size).toBe(1);
        const newLot = lotsSnap.docs[0].data();
        expect(newLot.qtyOnHandBase).toBe(40);
        expect(newLot.unitCostFloorSubunitsPerBase).toBe(50); // Exact cost mapped via Floor
        expect(newLot.residualUnitsOnHand).toBe(0);
        expect(newLot.sourceLotId).toBe('lot_1'); // Lineage secured

        // Assert: Movements (OUT and IN)
        const mvSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(mvSnap.size).toBe(2);
        const outMv = mvSnap.docs.find(d => d.data().type === 'TRANSFER_OUT')?.data();
        const inMv = mvSnap.docs.find(d => d.data().type === 'TRANSFER_IN')?.data();

        expect(outMv?.qtyBase).toBe(-40);
        expect(outMv?.valueSubunits).toBe(2000); // 40 * 50

        expect(inMv?.qtyBase).toBe(40);
        expect(inMv?.valueSubunits).toBe(2000);
    });

    it('2. Insufficient stock blocks transfer completely', async () => {
        const fromLoc = 'loc_A';
        const docId = 'doc_trx_2';

        await db.collection('documents').doc(docId).set({
            docType: 'TRANSFER',
            status: 'DRAFT',
            locationId: fromLoc,
            vendorId: 'loc_B',
            documentDate: '2026-02-15T08:00:00Z',
            createdAt: '2026-02-15T07:50:00Z',
            createdBy: 'u_tester'
        });

        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_flour',
            qtyBase: 50 // We have 0
        });

        const wrapped = (postTransfer as any).run;
        await expect(wrapped({ docId }, mockContext)).rejects.toThrow(/INSUFFICIENT_STOCK/);

        // Assert: Rollback
        const docSnap = await db.collection('documents').doc(docId).get();
        expect(docSnap.data()?.status).toBe('DRAFT');
    });

    it('3. Idempotency protects against double POST', async () => {
        const docId = 'doc_trx_3';

        await db.collection('documents').doc(docId).set({
            docType: 'TRANSFER',
            status: 'POSTED', // Already posted
            locationId: 'loc_A',
            vendorId: 'loc_B'
        });

        const wrapped = (postTransfer as any).run;
        const result = await wrapped({ docId }, mockContext);

        expect(result.alreadyPosted).toBe(true);
    });
});
