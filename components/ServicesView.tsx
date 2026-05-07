
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../services/mockDb';
import { Service } from '../types';

const ServicesView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{show: boolean, data: Partial<Service> | null}>({show: false, data: null});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getServices(tenantId);
      setServices(data || []);
    } catch (error) {
      console.error("Erro ao carregar serviços:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!modal.data?.name || !modal.data?.price) return;
    
    try {
      if (modal.data.id) {
        await db.updateService(modal.data.id, modal.data);
      } else {
        await db.addService({
          tenant_id: tenantId,
          name: modal.data.name,
          price: modal.data.price,
          durationMinutes: modal.data.durationMinutes || 30,
          active: true
        });
      }
      await loadData();
      setModal({show: false, data: null});
    } catch (error) {
      alert("Erro ao salvar serviço.");
    }
  };

  if (loading) return (
    <div className="p-20 text-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4"></div>
      <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">Sincronizando Catálogo...</p>
    </div>
  );

  const sorted = [...services].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Catálogo de Serviços</h1>
          <p className="text-xs font-semibold text-slate-400 mt-0.5">{services.length} serviço{services.length !== 1 ? 's' : ''} cadastrado{services.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setModal({show: true, data: { durationMinutes: 30, active: true }})}
          className="bg-orange-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600 transition-colors w-full sm:w-auto">
          + Novo Serviço
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {/* Table header */}
        <div className="grid gap-0 border-b border-slate-100" style={{ gridTemplateColumns: '1fr 80px 110px 80px 70px' }}>
          {['Serviço', 'Duração', 'Preço', 'Status', ''].map(h => (
            <div key={h} className="px-4 py-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{h}</span>
            </div>
          ))}
        </div>

        {sorted.length === 0 ? (
          <div className="py-20 text-center text-slate-300 text-sm font-semibold">Nenhum serviço cadastrado.</div>
        ) : (
          sorted.map((svc, i) => (
            <div key={svc.id}
              className="grid items-center hover:bg-slate-50 transition-colors"
              style={{ gridTemplateColumns: '1fr 80px 110px 80px 70px', borderTop: i === 0 ? 'none' : '1px solid #F1F5F9' }}>
              <div className="px-4 py-3.5">
                <p className="text-sm font-semibold text-slate-800">{svc.name}</p>
              </div>
              <div className="px-4 py-3.5">
                <p className="text-sm text-slate-600">{svc.durationMinutes} min</p>
              </div>
              <div className="px-4 py-3.5">
                <p className="text-sm font-bold text-slate-800">R$ {Number(svc.price).toFixed(2)}</p>
              </div>
              <div className="px-4 py-3.5">
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${svc.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                  {svc.active ? 'Ativo' : 'Pausado'}
                </span>
              </div>
              <div className="px-4 py-3.5 flex justify-end">
                <button onClick={() => setModal({show: true, data: svc})}
                  className="text-xs font-semibold text-slate-400 hover:text-orange-500 transition-colors">
                  Editar
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {modal.show && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-5 shadow-2xl">
            <h2 className="text-base font-bold text-slate-800">{modal.data?.id ? 'Editar Serviço' : 'Novo Serviço'}</h2>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">Nome</label>
                <input value={modal.data?.name || ''} onChange={e => setModal({...modal, data: {...modal.data, name: e.target.value}})}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Preço (R$)</label>
                  <input type="number" value={modal.data?.price || ''} onChange={e => setModal({...modal, data: {...modal.data, price: Number(e.target.value)}})}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm font-bold text-orange-500 focus:border-orange-400 transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Duração (min)</label>
                  <input type="number" value={modal.data?.durationMinutes || ''} onChange={e => setModal({...modal, data: {...modal.data, durationMinutes: Number(e.target.value)}})}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setModal({show: false, data: null})}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSave}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition-colors">
                Salvar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ServicesView;
