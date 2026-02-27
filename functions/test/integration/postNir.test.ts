import * as admin from 'firebase-admin';
import { clearFirestoreData } from '@firebase/rules-unit-testing';
import { postNir } from '../../src/api/postNir';

describe('postNir Integration Tests', () => {
    const db = admin.firestore();

    beforeEach(async () => {
        // Fix #3: Safer explicit teardown bypassing direct HTTP hits
        await clearFirestoreData({ projectId: 'demo-selio-stocks-v1' });
    });

    const mockContext = {
        auth: { uid: 'u_user1', token: {} }
    } as any;

    it('1. Post NIR happy path (Creates Lots and RECEIVE movements)', async () => {
        // Arrange
        const locationId = 'loc_store';
        const vendorId = 'ven_123';
        const docId = 'doc_nir_1';

        await db.collection('documents').doc(docId).set({
            docType: 'NIR',
            status: 'DRAFT',
            locationId,
            vendorId,
            documentDate: '2026-02-15T08:00:00Z',
            createdAt: '2026-02-15T07:50:00Z',
            createdBy: 'u_user1',
            idempotencyKey: 'idem_nir_1'
        });

        // 2 lines: Water and Flour
        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_water',
            qtyBase: 50,
            unitPriceSubunitsPurchaseUom: 10, // 10 bani per unit
            purchaseToBaseFactor: 1
        });

        await db.collection('documents').doc(docId).collection('lines').doc('line_2').set({
            itemId: 'it_flour',
            qtyBase: 100,
            unitPriceSubunitsPurchaseUom: 50, // 50 bani per kg (1000g)
            purchaseToBaseFactor: 10 // Factor conversion: 50 / 10 = 5 cost
        });

        // Act
        const wrapped = (postNir as any).run;
        await wrapped({ docId }, mockContext);

        // Assert: Document POSTED
        const docSnap = await db.collection('documents').doc(docId).get();
        expect(docSnap.data()?.status).toBe('POSTED');

        // Assert: Lots Created mapped exact cost + quantities
        const lotsSnap = await db.collection('lots').where('sourceDoc.docId', '==', docId).get();
        expect(lotsSnap.size).toBe(2);

        const waterLot = lotsSnap.docs.find(d => d.data().itemId === 'it_water')?.data();
        expect(waterLot?.qtyOnHandBase).toBe(50);
        expect(waterLot?.unitCostSubunitsPerBase).toBe(10);
        expect(waterLot?.locationId).toBe(locationId);

        const flourLot = lotsSnap.docs.find(d => d.data().itemId === 'it_flour')?.data();
        expect(flourLot?.qtyOnHandBase).toBe(100);
        expect(flourLot?.unitCostSubunitsPerBase).toBe(5);

        // Assert: Movements Created mapped exact values
        const movementsSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(movementsSnap.size).toBe(2);

        const waterMove = movementsSnap.docs.find(d => d.data().itemId === 'it_water')?.data();
        expect(waterMove?.type).toBe('RECEIVE');
        expect(waterMove?.qtyBase).toBe(50);
        expect(waterMove?.valueSubunits).toBe(500); // 50 * 10

        const flourMove = movementsSnap.docs.find(d => d.data().itemId === 'it_flour')?.data();
        expect(flourMove?.type).toBe('RECEIVE');
        expect(flourMove?.qtyBase).toBe(100);
        expect(flourMove?.valueSubunits).toBe(500); // 100 * 5
    });

    it('2. Idempotency enforced (Post twice -> avoids duplicating)', async () => {
        // Arrange
        const docId = 'doc_nir_idem';
        await db.collection('documents').doc(docId).set({
            docType: 'NIR', status: 'DRAFT', locationId: 'l1', vendorId: 'v1',
            documentDate: '2026-02-15', createdAt: '2026-02-15', createdBy: 'u1', idempotencyKey: 'idem_n2'
        });
        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_sugar', qtyBase: 10, unitPriceSubunitsPurchaseUom: 20, purchaseToBaseFactor: 1
        });

        const wrapped = (postNir as any).run;

        // Act: First post
        const res1 = await wrapped({ docId }, mockContext);
        expect(res1.alreadyPosted).toBe(false);

        // Act: Second Post
        const res2 = await wrapped({ docId }, mockContext);
        expect(res2.alreadyPosted).toBe(true); // Short circuits

        // Assert: Only 1 lot, 1 movement spawned
        const lotsSnap = await db.collection('lots').where('sourceDoc.docId', '==', docId).get();
        expect(lotsSnap.size).toBe(1);

        const movesSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(movesSnap.size).toBe(1);
    });

    it('3. Validation failure rollback (Missing Price -> Aborts transaction entirely)', async () => {
        // Arrange
        const docId = 'doc_nir_fail';
        await db.collection('documents').doc(docId).set({
            docType: 'NIR', status: 'DRAFT', locationId: 'l1', vendorId: 'v1', documentDate: '2026-02-15',
            createdAt: '2026-02-15', createdBy: 'u1', idempotencyKey: 'idem_fail'
        });

        // Good line
        await db.collection('documents').doc(docId).collection('lines').doc('line_1').set({
            itemId: 'it_salt', qtyBase: 10, unitPriceSubunitsPurchaseUom: 5, purchaseToBaseFactor: 1
        });
        // Bad line (missing price mapping)
        await db.collection('documents').doc(docId).collection('lines').doc('line_2').set({
            itemId: 'it_pepper', qtyBase: 10
        });

        const wrapped = (postNir as any).run;

        // Act & Assert
        await expect(wrapped({ docId }, mockContext)).rejects.toThrow('invalid or missing unitPriceSubunitsPurchaseUom');

        // Assert rollback -> Everything untouched
        const docSnap = await db.collection('documents').doc(docId).get();
        expect(docSnap.data()?.status).toBe('DRAFT');

        const lotsSnap = await db.collection('lots').where('sourceDoc.docId', '==', docId).get();
        expect(lotsSnap.empty).toBe(true);

        const movesSnap = await db.collection('movements').where('sourceDoc.docId', '==', docId).get();
        expect(movesSnap.empty).toBe(true);
    });
});
