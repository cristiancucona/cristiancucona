import { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';

export default function DevAuthPanel() {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<string>('NONE');
    const [email, setEmail] = useState('admin@selio.local');
    const [password, setPassword] = useState('password');
    const [selectedRole, setSelectedRole] = useState('OWNER');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            setUser(u);
            if (u) {
                const token = await u.getIdTokenResult(true); // Force refresh
                setRole(token.claims.role || 'NONE');
            } else {
                setRole('NONE');
            }
            setLoading(false);
        });
        return unsub;
    }, []);

    const handleLogin = async () => {
        try {
            setLoading(true);
            let u;
            try {
                const cred = await signInWithEmailAndPassword(auth, email, password);
                u = cred.user;
            } catch {
                const cred = await createUserWithEmailAndPassword(auth, email, password);
                u = cred.user;
            }

            // Call emulator backend to assign claim
            const setEmulatorRole = httpsCallable(functions, 'emulatorSetRole');
            await setEmulatorRole({ uid: u.uid, role: selectedRole });

            // Force refresh token so current session knows about the new claim
            await u.getIdToken(true);
            const token = await u.getIdTokenResult();
            setRole(token.claims.role || 'NONE');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="text-sm p-4 text-slate-500">Auth Booting...</div>;

    if (user) {
        return (
            <div className="bg-slate-900 border border-slate-700 text-white rounded p-4 text-sm flex justify-between items-center mb-6">
                <div>
                    <span className="text-slate-400">DEV USER:</span> <span className="font-mono ml-2">{user.email}</span>
                    <span className="ml-4 text-slate-400">CLAIM:</span> <span className="font-mono font-bold text-green-400 ml-2">{role}</span>
                </div>
                <button onClick={() => signOut(auth)} className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded border border-slate-600">Sign Out</button>
            </div>
        );
    }

    return (
        <div className="bg-indigo-50 border border-indigo-200 rounded p-4 mb-6 text-sm flex items-end gap-3 shadow-inner">
            <div className="flex-1">
                <label className="block text-xs font-bold text-indigo-800 mb-1">DEV LOGIN (EMULATOR ONLY)</label>
                <input value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-indigo-200 rounded p-1.5" placeholder="Email" />
            </div>
            <div className="w-32">
                <label className="block text-xs font-bold text-indigo-800 mb-1">Set Role</label>
                <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)} className="w-full border border-indigo-200 rounded p-1.5">
                    <option value="OWNER">OWNER</option>
                    <option value="GM">GM</option>
                    <option value="STAFF">STAFF</option>
                </select>
            </div>
            <button onClick={handleLogin} disabled={loading} className="bg-indigo-600 text-white font-medium px-4 py-1.5 rounded hover:bg-indigo-700 active:bg-indigo-800">
                Authenticate & Inject Claim
            </button>
        </div>
    );
}
