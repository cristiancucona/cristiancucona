import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../lib/firebase';

export default function Items() {
    const [items, setItems] = useState<any[]>([]);
    const [name, setName] = useState('');
    const [baseUom, setBaseUom] = useState('g');
    const [isAuthorized, setIsAuthorized] = useState(false);

    useEffect(() => {
        const unsubAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const token = await user.getIdTokenResult();
                const role = token.claims.role;
                setIsAuthorized(role === 'OWNER' || role === 'GM' || token.claims.admin === true);
            } else {
                setIsAuthorized(false);
            }
        });

        const unsubscribe = onSnapshot(collection(db, 'items'), (snap) => {
            setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => {
            unsubAuth();
            unsubscribe();
        };
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || (!isAuthorized)) return;
        try {
            const id = 'it_' + name.toLowerCase().replace(/\\s+/g, '_');
            await setDoc(doc(db, 'items', id), {
                name,
                baseUom,
                isActive: true
            });
            setName('');
        } catch (err: any) {
            alert("Firestore Security Error: " + err.message);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Item Matrix</h2>
            </div>

            {isAuthorized && (
                <form onSubmit={handleCreate} className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Item Name</label>
                        <input required value={name} onChange={e => setName(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2" placeholder="e.g. Flour Type 00" />
                    </div>
                    <div className="w-32">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Base UoM</label>
                        <input required value={baseUom} onChange={e => setBaseUom(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2" placeholder="g" />
                    </div>
                    <button type="submit" className="bg-slate-900 text-white px-6 py-2 rounded-md font-medium hover:bg-slate-800">
                        Create Master
                    </button>
                </form>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                            <th className="px-6 py-3 font-medium">ID (System Key)</th>
                            <th className="px-6 py-3 font-medium">Name</th>
                            <th className="px-6 py-3 font-medium">Base UoM</th>
                            <th className="px-6 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map(it => (
                            <tr key={it.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-mono text-slate-500">{it.id}</td>
                                <td className="px-6 py-4 font-medium">{it.name}</td>
                                <td className="px-6 py-4">{it.baseUom}</td>
                                <td className="px-6 py-4">
                                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold px-2 py-1">Active</span>
                                </td>
                            </tr>
                        ))}
                        {items.length === 0 && (
                            <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-500">No items formulated. Define system baselines to start receiving inventory.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
