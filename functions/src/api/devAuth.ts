import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

export const emulatorSetRole = functions.https.onCall(async (data, context) => {
    // SECURITY: This function ONLY works in the emulator.
    if (!process.env.FIREBASE_EMULATOR_HUB && process.env.FUNCTIONS_EMULATOR !== 'true') {
        throw new functions.https.HttpsError('permission-denied', 'This function is only available in the local emulator suite.');
    }

    const uid = data.uid;
    const role = data.role; // e.g. 'OWNER', 'GM', 'STAFF'

    if (!uid || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing uid or role');
    }

    await admin.auth().setCustomUserClaims(uid, { role });

    return { success: true, role };
});
