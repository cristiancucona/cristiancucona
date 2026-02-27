import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function Movements() {
    const [movements, setMovements] = useState<any[]>([]);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const [items, setItems] = useState<Record<string, string>>({});

    useEffect(() => {
        onSnapshot(collection(db, 'items'), s => {
            const map: any = {};
            s.docs.forEach(d => map[d.id] = d.data().name);
            setItems(map);
        });
    }, []);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'movements'), snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort Descending (Newest first) for movements log
            data.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setMovements(data);
        });
        return unsub;
    }, []);

    const toggleRow = (id: string) => {
        const next = new Set(expandedRows);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedRows(next);
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Immutable Ledger: Movements</h2>
                <p className="text-slate-500">Append-only systemic event log mapping value ingestion and depletion.</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                            <th className="px-4 py-3 font-medium">Timestamp (UTC)</th>
                            <th className="px-4 py-3 font-medium">Type</th>
                            <th className="px-4 py-3 font-medium">Item</th>
                            <th className="px-4 py-3 font-medium">Origin Doc</th>
                            <th className="px-4 py-3 font-medium text-right">Delta Base Qty</th>
                            <th className="px-4 py-3 font-medium text-right text-orange-700">Value (Subunits)</th>
                            <th className="px-4 py-3 text-center">Allocations</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {movements.map(m => (
                            <React.Fragment key={m.id}>
                                <tr className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-xs">{new Date(m.createdAt).toISOString()}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${m.type === 'RECEIVE' ? 'bg-green-100 text-green-700' :
                                            m.type.includes('COMP') ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                                            }`}>
                                            {m.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-slate-700">{items[m.itemId] || m.itemId}</td>
                                    <td className="px-4 py-3 text-xs">
                                        <span className="bg-slate-100 px-2 py-1 rounded text-slate-600 font-mono">
                                            {m.sourceDoc?.docType} / {m.sourceDoc?.docId.split('_').pop()}
                                        </span>
                                    </td>
                                    <td className={`px-4 py-3 text-right font-mono font-bold ${m.qtyBase > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {m.qtyBase > 0 ? '+' : ''}{m.qtyBase}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-medium text-slate-900">{m.valueSubunits.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-center">
                                        {m.lotAllocations && m.lotAllocations.length > 0 ? (
                                            <button onClick={() => toggleRow(m.id)} className="text-xs font-medium text-blue-600 hover:underline">
                                                {expandedRows.has(m.id) ? 'Collapse' : `View ${m.lotAllocations.length} Lots`}
                                            </button>
                                        ) : (
                                            <span className="text-slate-400 text-xs">-</span>
                                        )}
                                    </td>
                                </tr>
                                {expandedRows.has(m.id) && m.lotAllocations && (
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <td colSpan={7} className="px-8 py-4">
                                            <div className="bg-white border text-xs border-slate-200 rounded p-4">
                                                <p className="font-semibold text-slate-700 mb-2">Mathematical FIFO Abstraction Trace:</p>
                                                <table className="w-full text-slate-600">
                                                    <thead>
                                                        <tr className="border-b border-slate-200"><th className="pb-2 text-left">Depleted Lot ID</th><th className="pb-2 text-right">Qty Deducted</th><th className="pb-2 text-right">Locked Cost (Subunits)</th><th className="pb-2 text-right">Subtotal</th></tr>
                                                    </thead>
                                                    <tbody>
                                                        {m.lotAllocations.map((alloc: any, i: number) => (
                                                            <tr key={i} className="border-b border-slate-50 last:border-none">
                                                                <td className="py-2 font-mono">{alloc.lotId}</td>
                                                                <td className="py-2 text-right font-mono">{alloc.qtyBase}</td>
                                                                <td className="py-2 text-right font-mono">{alloc.unitCostSubunitsPerBase}</td>
                                                                <td className="py-2 text-right font-mono font-bold">{alloc.valueSubunits}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
