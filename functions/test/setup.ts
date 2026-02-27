// test/setup.ts
import * as admin from 'firebase-admin';

// Initialize the Firebase admin app for the emulator
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'demo-selio-stocks-v1', // Using demo prefix ensures local emulation
    });
}
