import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Activity, Plus, FileText, ArrowUpDown } from 'lucide-react';

export default function Dashboard() {
    const [totalValue, setTotalValue] = useState<number>(0);
    const [totalLots, setTotalLots] = useState<number>(0);

    useEffect(() => {
        // Conceptually derived from Lots collection for V0.1 dashboard mockups
        const q = query(collection(db, 'lots'), where('status', '==', 'ACTIVE'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let sum = 0;
            snapshot.docs.forEach(doc => {
                const d = doc.data();
                sum += (d.qtyOnHandBase * d.unitCostSubunitsPerBase);
            });
            setTotalValue(sum);
            setTotalLots(snapshot.size);
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Ledger Overview</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                    <p className="text-sm font-medium text-slate-500">Total Active Lots</p>
                    <p className="text-3xl font-bold text-slate-900 mt-2">{totalLots}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
                    <p className="text-sm font-medium text-slate-500">Valuation (Subunits)</p>
                    <p className="text-3xl font-bold text-slate-900 mt-2">{totalValue.toLocaleString()}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-100 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-md text-blue-600"><Plus size={24} /></div>
                        <h3 className="text-lg font-semibold text-blue-900">Receiving (NIR)</h3>
                    </div>
                    <p className="text-blue-800 text-sm">Create drafts and securely post inventory acquisition payloads.</p>
                    <div className="mt-auto flex gap-3">
                        <Link to="/receiving" className="text-sm font-medium text-blue-600 hover:underline">View Ledger</Link>
                        <Link to="/receiving/new" className="text-sm font-medium text-blue-600 hover:underline">New NIR</Link>
                    </div>
                </div>

                <div className="bg-orange-50 p-6 rounded-lg border border-orange-100 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 rounded-md text-orange-600"><Activity size={24} /></div>
                        <h3 className="text-lg font-semibold text-orange-900">Consumption</h3>
                    </div>
                    <p className="text-orange-800 text-sm">Post rigorous consumption or waste algorithms mapping directly to core item units.</p>
                    <div className="mt-auto flex gap-3">
                        <Link to="/consumption" className="text-sm font-medium text-orange-600 hover:underline">View Logs</Link>
                        <Link to="/consumption/new" className="text-sm font-medium text-orange-600 hover:underline">New Consumption</Link>
                    </div>
                </div>
            </div>

            <div className="mt-8 pt-8 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link to="/items" className="flex items-center gap-2 p-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"><FileText size={16} /> Items Directory</Link>
                <Link to="/locations" className="flex items-center gap-2 p-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"><FileText size={16} /> Location Control</Link>
                <Link to="/lots" className="flex items-center gap-2 p-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"><ArrowUpDown size={16} /> Active Lots</Link>
                <Link to="/movements" className="flex items-center gap-2 p-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"><ArrowUpDown size={16} /> Global Movements</Link>
            </div>
        </div>
    );
}
