import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, collection, onSnapshot, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../lib/firebase';
import { Save, Send } from 'lucide-react';

export default function ReceivingEdit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isNew = id === 'new';
    const docId = isNew ? `nir_${Date.now()}` : id!;

    const [status, setStatus] = useState('DRAFT');
    const [header, setHeader] = useState({ vendorId: '', locationId: '', documentDate: new Date().toISOString().split('T')[0] });
    const [lines, setLines] = useState<any[]>([]);

    // Dictionaries
    const [items, setItems] = useState<any[]>([]);
    const [locations, setLocations] = useState<any[]>([]);

    useEffect(() => {
        onSnapshot(collection(db, 'items'), s => setItems(s.docs.map(d => ({ id: d.id, ...d.data() }))));
        onSnapshot(collection(db, 'locations'), s => setLocations(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, []);

    useEffect(() => {
        if (!isNew) {
            getDoc(doc(db, 'documents', docId)).then(snap => {
                if (snap.exists()) {
                    const data = snap.data();
                    setStatus(data.status);
                    setHeader({ vendorId: data.vendorId || '', locationId: data.locationId || '', documentDate: data.documentDate || '' });
                }
            });
            onSnapshot(collection(db, 'documents', docId, 'lines'), snap => {
                setLines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            });
        }
    }, [docId, isNew]);

    const [isSaving, setIsSaving] = useState(false);
    const [isPosting, setIsPosting] = useState(false);
    const isReadOnly = status !== 'DRAFT';

    const handleSaveDraft = async () => {
        if (isReadOnly || isSaving) return;
        if (!auth.currentUser?.uid) {
            alert("Auth not ready, retry.");
            return;
        }
        setIsSaving(true);
        try {
            await setDoc(doc(db, 'documents', docId), {
                docType: 'NIR',
                status: 'DRAFT',
                ...header,
                createdAt: new Date().toISOString(),
                createdBy: auth.currentUser.uid,
                idempotencyKey: `idem_${docId}`
            }, { merge: true });

            for (const line of lines) {
                if (!line.id) line.id = `line_${Date.now()}_${Math.random()}`;
                await setDoc(doc(db, 'documents', docId, 'lines', line.id), {
                    itemId: line.itemId,
                    qtyBase: Number(line.qtyBase),
                    unitPriceSubunitsPurchaseUom: Number(line.unitPriceSubunitsPurchaseUom),
                    purchaseToBaseFactor: Number(line.purchaseToBaseFactor)
                });
            }
            if (isNew) navigate(`/receiving/${docId}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handlePost = async () => {
        if (isPosting) return;
        if (!confirm("Are you sure? Posting to ledger is irreversible.")) return;
        setIsPosting(true);
        await handleSaveDraft();
        try {
            const postNir = httpsCallable(functions, 'postNir');
            const result: any = await postNir({ docId });

            if (result.data?.alreadyPosted) {
                alert("Already Posted: The system recognized this transaction idempotency key.");
            } else {
                alert("Success! The NIR has been posted to the immutable ledger.");
            }
            navigate('/receiving');
        } catch (err: any) {
            let userMsg = err.message;
            if (err.code === 'permission-denied') userMsg = "Permission Denied: Ensure you have OWNER, GM, or Admin privileges.";
            alert(`Server Rejected: ${userMsg}`);
        } finally {
            setIsPosting(false);
        }
    };

    const addLine = () => {
        if (isReadOnly) return;
        setLines([...lines, { id: '', itemId: '', qtyBase: 1, unitPriceSubunitsPurchaseUom: 0, purchaseToBaseFactor: 1 }]);
    };

    const updateLine = (index: number, field: string, value: any) => {
        if (isReadOnly) return;
        const newLines = [...lines];
        newLines[index][field] = value;
        setLines(newLines);
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Receiving Document (NIR)</h2>
                <div className="flex gap-3">
                    <span className={`px-4 py-2 font-bold text-sm rounded border ${status === 'POSTED' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-yellow-100 text-yellow-800 border-yellow-200'}`}>
                        {status}
                    </span>
                    {!isReadOnly && (
                        <>
                            <button onClick={handleSaveDraft} disabled={isSaving || isPosting} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded hover:bg-slate-50 font-medium disabled:opacity-50">
                                <Save size={16} /> {isSaving ? 'Saving...' : 'Save Draft'}
                            </button>
                            <button onClick={handlePost} disabled={!header.vendorId || !header.locationId || lines.length === 0 || isSaving || isPosting} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50">
                                <Send size={16} /> {isPosting ? 'Posting...' : 'Post to Ledger'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
                <div className="col-span-3 bg-white p-6 rounded border border-slate-200 grid grid-cols-3 gap-4 shadow-sm">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Vendor ID</label>
                        <input value={header.vendorId} onChange={e => setHeader({ ...header, vendorId: e.target.value })} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-2" placeholder="e.g. VEND_SYSCO" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Destination Location</label>
                        <select value={header.locationId} onChange={e => setHeader({ ...header, locationId: e.target.value })} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-2">
                            <option value="">Select Location...</option>
                            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Document Date</label>
                        <input type="date" value={header.documentDate} onChange={e => setHeader({ ...header, documentDate: e.target.value })} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-2" />
                    </div>
                </div>

                <div className="col-span-3 bg-white rounded border border-slate-200 overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <h3 className="font-semibold text-slate-700">Receive Lines</h3>
                        {!isReadOnly && <button onClick={addLine} className="text-sm text-blue-600 font-medium hover:underline">+ Add Line</button>}
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            <tr>
                                <th className="p-3">Item</th>
                                <th className="p-3">Base Qty Built</th>
                                <th className="p-3">Price (Subunits/Pkg)</th>
                                <th className="p-3 pr-6 text-right">Pack Factor (/Base)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {lines.map((ln, idx) => (
                                <tr key={idx}>
                                    <td className="p-3">
                                        <select value={ln.itemId} onChange={e => updateLine(idx, 'itemId', e.target.value)} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-1">
                                            <option value="">Select Item...</option>
                                            {items.map(it => <option key={it.id} value={it.id}>{it.name} ({it.baseUom})</option>)}
                                        </select>
                                    </td>
                                    <td className="p-3"><input type="number" min="1" value={ln.qtyBase} onChange={e => updateLine(idx, 'qtyBase', e.target.value)} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-1" /></td>
                                    <td className="p-3"><input type="number" min="0" value={ln.unitPriceSubunitsPurchaseUom} onChange={e => updateLine(idx, 'unitPriceSubunitsPurchaseUom', e.target.value)} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-1" /></td>
                                    <td className="p-3 pr-6"><input type="number" min="1" value={ln.purchaseToBaseFactor} onChange={e => updateLine(idx, 'purchaseToBaseFactor', e.target.value)} disabled={isReadOnly} className="w-full border border-slate-300 rounded p-1 text-right" /></td>
                                </tr>
                            ))}
                            {lines.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500">No items on this document yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
