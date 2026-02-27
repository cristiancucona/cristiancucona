import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function Lots() {
    const [lots, setLots] = useState<any[]>([]);

    // Dictionaries for mapping IDs to names gracefully
    const [items, setItems] = useState<Record<string, string>>({});
    const [locations, setLocations] = useState<Record<string, string>>({});

    useEffect(() => {
        onSnapshot(collection(db, 'items'), s => {
            const map: any = {};
            s.docs.forEach(d => map[d.id] = d.data().name);
            setItems(map);
        });
        onSnapshot(collection(db, 'locations'), s => {
            const map: any = {};
            s.docs.forEach(d => map[d.id] = d.data().name);
            setLocations(map);
        });
    }, []);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'lots'), snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // In-memory sort fallback for emulator testing (index propagation)
            data.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setLots(data);
        });
        return unsub;
    }, []);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Immutable Ledger: Lots</h2>
                <p className="text-slate-500">Global chronological FIFO stacks.</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                            <th className="px-4 py-3 font-medium">Lot ID</th>
                            <th className="px-4 py-3 font-medium">Timestamp (UTC)</th>
                            <th className="px-4 py-3 font-medium">Location</th>
                            <th className="px-4 py-3 font-medium">Item</th>
                            <th className="px-4 py-3 font-medium">Origin Doc</th>
                            <th className="px-4 py-3 font-medium text-right bg-blue-50/50">Base Qty</th>
                            <th className="px-4 py-3 font-medium text-right bg-blue-50/50">Unit Subunit Cost</th>
                            <th className="px-4 py-3 font-medium text-right bg-blue-50/50">Total Subunits</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {lots.map(l => (
                            <tr key={l.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-mono text-slate-500 text-xs">{l.id}</td>
                                <td className="px-4 py-3 text-xs">{new Date(l.createdAt).toISOString()}</td>
                                <td className="px-4 py-3">{locations[l.locationId] || l.locationId}</td>
                                <td className="px-4 py-3 font-semibold text-slate-700">{items[l.itemId] || l.itemId}</td>
                                <td className="px-4 py-3 text-xs">
                                    <span className="bg-slate-100 px-2 py-1 rounded text-slate-600 font-mono">
                                        {l.sourceDoc?.docType} / {l.sourceDoc?.docId.split('_').pop()}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-medium">{l.qtyOnHandBase.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right font-mono text-slate-500">{l.unitCostSubunitsPerBase.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">{(l.qtyOnHandBase * l.unitCostSubunitsPerBase).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
