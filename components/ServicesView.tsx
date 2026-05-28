
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../services/mockDb';
import { Service } from '../types';

const ServicesView: React.FC<{ tenantId: string; refreshTicker?: number }> = ({ tenantId, refreshTicker = 0 }) => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal de serviço
  const [modal, setModal] = useState<{ show: boolean; data: Partial<Service> | null }>({ show: false, data: null });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Pesquisa por nome
  const [searchTerm, setSearchTerm] = useState('');

  // Modal de categoria (criar/renomear)
  const [catModal, setCatModal] = useState<{ show: boolean; oldName: string }>({ show: false, oldName: '' });
  const [catName, setCatName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getServices(tenantId, { fresh: true });
      setServices(data || []);
    } finally {
      setLoading(false);
    }
  }, [tenantId, refreshTicker]);

  useEffect(() => { loadData(); }, [loadData]);

  // Categorias derivadas dos serviços (+ "Sem Categoria")
  const categories = Array.from(new Set(services.map(s => s.category || '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const servicesByCategory = (cat: string) =>
    services.filter(s => (s.category || '') === cat).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const uncategorized = services.filter(s => !s.category).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  // ── Salvar serviço ──
  const handleSave = async () => {
    if (!modal.data?.name?.trim() || modal.data.price === undefined || modal.data.price === null) return;
    setSaving(true);
    try {
      if (modal.data.id) {
        await db.updateService(modal.data.id, {
          name: modal.data.name.trim(),
          price: modal.data.price,
          durationMinutes: modal.data.durationMinutes || 30,
          active: modal.data.active ?? true,
          category: modal.data.category || undefined,
          materialCostPercent: modal.data.materialCostPercent ?? 0,
        });
      } else {
        await db.addService({
          tenant_id: tenantId,
          name: modal.data.name.trim(),
          price: modal.data.price,
          durationMinutes: modal.data.durationMinutes || 30,
          active: true,
          category: modal.data.category || undefined,
          materialCostPercent: modal.data.materialCostPercent ?? 0,
        });
      }
      await loadData();
      setModal({ show: false, data: null });
      setConfirmDelete(false);
    } catch {
      alert('Erro ao salvar serviço.');
    } finally {
      setSaving(false);
    }
  };

  // ── Excluir serviço ──
  const handleDelete = async () => {
    if (!modal.data?.id) return;
    setDeleting(true);
    try {
      // Soft-delete: marca como inativo (oculta o serviço sem quebrar FK de agendamentos)
      await db.updateService(modal.data.id, { active: false, name: modal.data.name });
      await loadData();
      setModal({ show: false, data: null });
      setConfirmDelete(false);
    } catch {
      alert('Erro ao excluir serviço.');
    } finally {
      setDeleting(false);
    }
  };

  // ── Renomear categoria ──
  const handleRenameCategory = async () => {
    const newName = catName.trim();
    if (!newName) return;
    const toUpdate = services.filter(s => (s.category || '') === catModal.oldName);
    await Promise.all(toUpdate.map(s => db.updateService(s.id, { ...s, category: newName })));
    await loadData();
    setCatModal({ show: false, oldName: '' });
  };

  // ── Excluir categoria (move serviços para Sem Categoria) ──
  const handleDeleteCategory = async (cat: string) => {
    if (!confirm(`Excluir a categoria "${cat}"? Os serviços dentro dela ficarão sem categoria.`)) return;
    const toUpdate = services.filter(s => s.category === cat);
    await Promise.all(toUpdate.map(s => db.updateService(s.id, { ...s, category: undefined })));
    await loadData();
  };

  const openNew = (category?: string) =>
    setModal({ show: true, data: { durationMinutes: 30, active: true, category: category || '' } });

  const openEdit = (svc: Service) =>
    setModal({ show: true, data: { ...svc } });

  if (loading) return (
    <div className="p-20 text-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
      <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">Carregando catálogo...</p>
    </div>
  );

  const totalActive = services.filter(s => s.active).length;

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Catálogo de Serviços</h1>
          <p className="text-xs font-semibold text-slate-400 mt-0.5">
            {totalActive} serviço{totalActive !== 1 ? 's' : ''} ativo{totalActive !== 1 ? 's' : ''} · {categories.length} categoria{categories.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => { setCatName(''); setCatModal({ show: true, oldName: '' }); }}
            className="flex-1 sm:flex-none border-2 border-orange-200 text-orange-600 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-orange-50 transition-colors"
          >
            + Categoria
          </button>
          <button
            onClick={() => openNew()}
            className="flex-1 sm:flex-none bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-orange-600 transition-colors"
          >
            + Serviço
          </button>
        </div>
      </div>

      {/* Barra de pesquisa */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Pesquisar serviço pelo nome..."
          className="w-full pl-10 pr-10 py-3 bg-white border-2 border-slate-100 rounded-2xl text-sm font-semibold text-slate-700 placeholder-slate-300 outline-none focus:border-orange-400 transition-colors shadow-sm"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 font-black text-sm transition-colors">✕</button>
        )}
      </div>

      {/* Resultado de pesquisa — lista plana */}
      {searchTerm.trim() ? (() => {
        const q = searchTerm.trim().toLowerCase();
        const matched = services.filter(s => s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        if (matched.length === 0) return (
          <div className="py-12 text-center text-slate-300 font-semibold text-sm">Nenhum serviço encontrado para "{searchTerm}"</div>
        );
        return (
          <CategorySection
            key="__search__"
            name={`${matched.length} resultado${matched.length !== 1 ? 's' : ''}`}
            services={matched}
            allCategories={categories}
            onEdit={openEdit}
            onAdd={() => openNew()}
            onRename={undefined}
            onDelete={undefined}
          />
        );
      })() : (
        <>
          {/* Categorias */}
          {categories.map(cat => (
            <CategorySection
              key={cat}
              name={cat}
              services={servicesByCategory(cat)}
              allCategories={categories}
              onEdit={openEdit}
              onAdd={() => openNew(cat)}
              onRename={() => { setCatName(cat); setCatModal({ show: true, oldName: cat }); }}
              onDelete={() => handleDeleteCategory(cat)}
            />
          ))}

          {/* Sem Categoria */}
          {(uncategorized.length > 0 || categories.length === 0) && (
            <CategorySection
              key="__none__"
              name=""
              services={uncategorized}
              allCategories={categories}
              onEdit={openEdit}
              onAdd={() => openNew()}
              onRename={undefined}
              onDelete={undefined}
            />
          )}

          {services.length === 0 && (
            <div className="py-20 text-center text-slate-300 font-semibold text-sm">
              Nenhum serviço cadastrado. Crie uma categoria e adicione serviços.
            </div>
          )}
        </>
      )}

      {/* ── Modal: Serviço ── */}
      {modal.show && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <h2 className="text-base font-black text-slate-800">{modal.data?.id ? 'Editar Serviço' : 'Novo Serviço'}</h2>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Nome do Serviço</label>
              <input
                autoFocus
                value={modal.data?.name || ''}
                onChange={e => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })}
                placeholder="Ex: Esmaltação em Gel"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">Preço (R$)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={modal.data?.price ?? ''}
                  onChange={e => setModal({ ...modal, data: { ...modal.data, price: Number(e.target.value) } })}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm font-bold text-orange-500 focus:border-orange-400 transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">Duração (min)</label>
                <input
                  type="number" min="5" step="5"
                  value={modal.data?.durationMinutes ?? ''}
                  onChange={e => setModal({ ...modal, data: { ...modal.data, durationMinutes: Number(e.target.value) } })}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Custo de Material (%)</label>
              <input
                type="number" min="0" max="100" step="0.1"
                value={modal.data?.materialCostPercent ?? ''}
                onChange={e => setModal({ ...modal, data: { ...modal.data, materialCostPercent: Number(e.target.value) } })}
                placeholder="Ex: 20 (20% do valor do serviço)"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors"
              />
              <p className="text-[10px] text-slate-400 leading-tight">Deduzido da comissão do profissional (calculado sobre o valor cadastrado do serviço)</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Categoria</label>
              <select
                value={modal.data?.category || ''}
                onChange={e => setModal({ ...modal, data: { ...modal.data, category: e.target.value } })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors bg-white"
              >
                <option value="">Sem categoria</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {modal.data?.id && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Status</label>
                <button
                  onClick={() => setModal({ ...modal, data: { ...modal.data, active: !modal.data?.active } })}
                  className={`text-xs font-bold px-3 py-1 rounded-full transition-colors ${modal.data?.active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                >
                  {modal.data?.active ? 'Ativo' : 'Pausado'}
                </button>
              </div>
            )}

            {/* Excluir */}
            {modal.data?.id && (
              confirmDelete ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-red-700">Confirmar exclusão de "{modal.data?.name}"?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleDelete} disabled={deleting} className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 disabled:opacity-50">
                      {deleting ? 'Excluindo...' : 'Sim, excluir'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="w-full text-xs text-red-400 hover:text-red-600 font-semibold transition-colors text-left">
                  Excluir serviço
                </button>
              )
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => { setModal({ show: false, data: null }); setConfirmDelete(false); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition-colors disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: Categoria ── */}
      {catModal.show && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl w-full max-w-xs p-6 space-y-4 shadow-2xl">
            <h2 className="text-base font-black text-slate-800">{catModal.oldName ? 'Renomear Categoria' : 'Nova Categoria'}</h2>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Nome</label>
              <input
                autoFocus
                value={catName}
                onChange={e => setCatName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRenameCategory()}
                placeholder="Ex: Unhas, Pés, Cabelo..."
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm focus:border-orange-400 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCatModal({ show: false, oldName: '' })}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button onClick={handleRenameCategory} disabled={!catName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition-colors disabled:opacity-40">
                {catModal.oldName ? 'Renomear' : 'Criar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ── Componente de seção de categoria ──
function CategorySection({
  name, services, allCategories, onEdit, onAdd, onRename, onDelete,
}: {
  name: string;
  services: Service[];
  allCategories: string[];
  onEdit: (s: Service) => void;
  onAdd: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isSemCategoria = !name;
  const label = isSemCategoria ? 'Sem Categoria' : name;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      {/* Header da categoria */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <button onClick={() => setCollapsed(v => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left group">
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          <span className={`text-sm font-black tracking-tight truncate ${isSemCategoria ? 'text-slate-400 italic' : 'text-slate-800'}`}>{label}</span>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">{services.length}</span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {!isSemCategoria && onRename && (
            <button onClick={onRename} title="Renomear" className="p-1.5 rounded-lg text-slate-400 hover:text-orange-500 hover:bg-orange-50 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          {!isSemCategoria && onDelete && (
            <button onClick={onDelete} title="Excluir categoria" className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          )}
          <button onClick={onAdd} className="flex items-center gap-1 text-xs font-bold text-orange-500 hover:text-orange-600 px-2.5 py-1.5 rounded-lg hover:bg-orange-50 transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Serviço
          </button>
        </div>
      </div>

      {!collapsed && (
        services.length === 0 ? (
          <div className="py-8 text-center text-slate-300 text-xs font-semibold">
            Nenhum serviço nesta categoria.{' '}
            <button onClick={onAdd} className="text-orange-400 hover:text-orange-600 underline">Adicionar agora</button>
          </div>
        ) : (
          <>
            {/* ── Mobile: cards ── */}
            <div className="sm:hidden divide-y divide-slate-50">
              {services.map(svc => (
                <div key={svc.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 leading-snug">{svc.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      <span className="text-xs text-slate-500">{svc.durationMinutes} min</span>
                      <span className="text-xs font-bold text-slate-700">R$ {Number(svc.price).toFixed(2)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${svc.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                        {svc.active ? 'Ativo' : 'Pausado'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onEdit(svc)}
                    className="shrink-0 text-xs font-bold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Editar
                  </button>
                </div>
              ))}
            </div>

            {/* ── Desktop: tabela ── */}
            <div className="hidden sm:block overflow-x-auto">
              <div style={{ minWidth: 480 }}>
                {/* Table header */}
                <div className="grid border-b border-slate-50" style={{ gridTemplateColumns: '1fr 72px 100px 72px 60px' }}>
                  {['Serviço', 'Duração', 'Preço', 'Status', ''].map(h => (
                    <div key={h} className="px-4 py-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{h}</span>
                    </div>
                  ))}
                </div>
                {services.map((svc, i) => (
                  <div
                    key={svc.id}
                    className="grid items-center hover:bg-slate-50 transition-colors"
                    style={{ gridTemplateColumns: '1fr 72px 100px 72px 60px', borderTop: i === 0 ? 'none' : '1px solid #F1F5F9' }}
                  >
                    <div className="px-4 py-3 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate" title={svc.name}>{svc.name}</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-xs text-slate-500">{svc.durationMinutes} min</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm font-bold text-slate-700">R$ {Number(svc.price).toFixed(2)}</p>
                    </div>
                    <div className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${svc.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                        {svc.active ? 'Ativo' : 'Pausado'}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex justify-end">
                      <button onClick={() => onEdit(svc)} className="text-xs font-semibold text-slate-400 hover:text-orange-500 transition-colors">
                        Editar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

export default ServicesView;
