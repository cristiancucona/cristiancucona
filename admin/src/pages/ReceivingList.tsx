import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { FilePlus } from 'lucide-react';

export default function ReceivingList() {
    const [docs, setDocs] = useState<any[]>([]);

    useEffect(() => {
        const q = query(
            collection(db, 'documents'),
            where('docType', '==', 'NIR')
            // Note: For V0.1 we can sort in memory if indexes aren't propagated yet
        );
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // In-memory sort fallback for emulator testing
            data.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setDocs(data);
        });
        return unsub;
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold">Receiving Log (NIR)</h2>
                    <p className="text-slate-500">Track incoming stock ingestion runs (NIR).</p>
                </div>
                <Link to="/receiving/new" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                    <FilePlus size={18} /> New Receipt
                </Link>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                            <th className="px-6 py-3 font-medium">Doc ID</th>
                            <th className="px-6 py-3 font-medium">Status</th>
                            <th className="px-6 py-3 font-medium">Date (UTC)</th>
                            <th className="px-6 py-3 font-medium">Vendor</th>
                            <th className="px-6 py-3 font-medium text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {docs.map(d => (
                            <tr key={d.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-mono text-slate-500">{d.id}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-semibold ${d.status === 'POSTED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                        {d.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4">{d.documentDate}</td>
                                <td className="px-6 py-4">{d.vendorId}</td>
                                <td className="px-6 py-4 text-right">
                                    <Link to={`/receiving/${d.id}`} className="text-blue-600 font-medium hover:underline">View</Link>
                                </td>
                            </tr>
                        ))}
                        {docs.length === 0 && (
                            <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">No receiving documents found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
