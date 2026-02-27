import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
    projectId: "demo-selio-stocks-v1",
    // These are standard placeholders required by syntax but ignored by the emulator via the demo- prefix
    apiKey: "demo-api-key",
    authDomain: "demo-selio-stocks-v1.firebaseapp.com",
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const functions = getFunctions(app);
export const auth = getAuth(app);

// Prevent double-connections during Vite HMR
if (!(globalThis as any).__EMU) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    (globalThis as any).__EMU = true;
}
