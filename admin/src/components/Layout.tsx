import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../lib/firebase';
import DevAuthPanel from './DevAuthPanel';

export default function Layout() {
    const [isPrivileged, setIsPrivileged] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                signInAnonymously(auth);
            } else {
                const token = await u.getIdTokenResult();
                setIsPrivileged(token.claims.role === 'OWNER' || token.claims.role === 'GM' || token.claims.admin === true);
            }
        });
        return () => unsub();
    }, []);

    return (
        <div className="min-h-screen p-8 bg-slate-50">
            <header className="mb-8 flex justify-between items-center border-b border-slate-200 pb-4">
                <div>
                    <Link to="/" className="text-3xl font-bold text-slate-900 hover:text-blue-600 transition-colors">Selio Stocks Admin v0.1</Link>
                    <p className="text-slate-500 mt-1">Immutable Ledger UI Proxy</p>
                </div>
                <div className="flex gap-4 items-center">
                    {isPrivileged && (
                        <nav className="flex gap-3 text-sm font-medium text-slate-600 mr-4">
                            <Link to="/lots" className="hover:text-blue-600">Secure Lots Viewer</Link>
                            <Link to="/movements" className="hover:text-blue-600">Ledger Trace</Link>
                        </nav>
                    )}
                    <div className="text-sm border border-slate-200 bg-white px-3 py-1 rounded-full text-slate-600 font-medium">
                        Connected: Local Emulator 🟢
                    </div>
                </div>
            </header>
            <main>
                <DevAuthPanel />
                <Outlet />
            </main>
        </div>
    );
}
