
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Product } from '../types';

function genId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const UNITS = ['unidades', 'ml', 'L', 'g', 'kg', 'pares', 'caixas', 'frascos'];
const CATEGORIES = ['Cabelo', 'Barba', 'Pele', 'Perfumaria', 'Acessórios', 'Higiene', 'Outros'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ProductsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Cabelo');
  const [newCostPrice, setNewCostPrice] = useState(0);
  const [newSalePrice, setNewSalePrice] = useState(0);
  const [newQuantity, setNewQuantity] = useState<number | ''>('');
  const [newUnit, setNewUnit] = useState('unidades');

  // Edit modal
  const [editItem, setEditItem] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editCostPrice, setEditCostPrice] = useState(0);
  const [editSalePrice, setEditSalePrice] = useState(0);
  const [editQuantity, setEditQuantity] = useState<number | ''>('');
  const [editUnit, setEditUnit] = useState('unidades');

  // Filter
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getProducts(tenantId);
      setProducts(data);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newName.trim() || newSalePrice <= 0) return;
    setSaving(true);
    try {
      await db.addProduct(tenantId, {
        name: newName.trim(),
        category: newCategory,
        costPrice: newCostPrice,
        salePrice: newSalePrice,
        quantity: newQuantity !== '' ? newQuantity : undefined,
        unit: newQuantity !== '' ? newUnit : undefined,
        active: true,
      });
      setNewName(''); setNewCategory('Cabelo'); setNewCostPrice(0);
      setNewSalePrice(0); setNewQuantity(''); setNewUnit('unidades');
      setShowAddForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (p: Product) => {
    setEditItem(p);
    setEditName(p.name);
    setEditCategory(p.category || 'Cabelo');
    setEditCostPrice(p.costPrice);
    setEditSalePrice(p.salePrice);
    setEditQuantity(p.quantity !== undefined ? p.quantity : '');
    setEditUnit(p.unit || 'unidades');
  };

  const handleEdit = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await db.updateProduct(tenantId, editItem.id, {
        name: editName.trim(),
        category: editCategory,
        costPrice: editCostPrice,
        salePrice: editSalePrice,
        quantity: editQuantity !== '' ? editQuantity : undefined,
        unit: editQuantity !== '' ? editUnit : undefined,
      });
      setEditItem(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este produto?')) return;
    await db.deleteProduct(tenantId, id);
    await load();
  };

  const handleToggleActive = async (p: Product) => {
    await db.updateProduct(tenantId, p.id, { active: !p.active });
    await load();
  };

  const margin = (cost: number, sale: number) =>
    sale > 0 ? ((sale - cost) / sale * 100).toFixed(1) : '—';

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filterCategory || p.category === filterCategory;
    return matchSearch && matchCat;
  });

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Carregando produtos...</div>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Produtos</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Produtos disponíveis para venda ao cliente</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
        >
          + Novo Produto
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Buscar produto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm flex-1 bg-white dark:bg-gray-800 dark:text-white"
        />
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white"
        >
          <option value="">Todas categorias</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-2xl p-4 space-y-3">
          <h3 className="font-semibold text-orange-700 dark:text-orange-300">Novo Produto</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Nome *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nome do produto"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Categoria</label>
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white mt-1"
              >
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Preço de Custo (R$)</label>
              <input
                type="number" min="0" step="0.01"
                value={newCostPrice}
                onChange={e => setNewCostPrice(Number(e.target.value))}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Preço de Venda (R$) *</label>
              <input
                type="number" min="0" step="0.01"
                value={newSalePrice}
                onChange={e => setNewSalePrice(Number(e.target.value))}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Estoque (opcional)</label>
              <input
                type="number" min="0"
                value={newQuantity}
                onChange={e => setNewQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="Deixe em branco se não controlar"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Unidade</label>
              <select
                value={newUnit}
                onChange={e => setNewUnit(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white mt-1"
              >
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {newCostPrice > 0 && newSalePrice > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Margem estimada: <strong>{margin(newCostPrice, newSalePrice)}%</strong>
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">Cancelar</button>
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim() || newSalePrice <= 0}
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50 transition-colors"
            >
              {saving ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="text-left p-3 text-gray-500 dark:text-gray-400 font-medium">Nome</th>
              <th className="text-left p-3 text-gray-500 dark:text-gray-400 font-medium">Categoria</th>
              <th className="text-right p-3 text-gray-500 dark:text-gray-400 font-medium">Custo</th>
              <th className="text-right p-3 text-gray-500 dark:text-gray-400 font-medium">Venda</th>
              <th className="text-right p-3 text-gray-500 dark:text-gray-400 font-medium">Margem</th>
              <th className="text-right p-3 text-gray-500 dark:text-gray-400 font-medium">Estoque</th>
              <th className="text-center p-3 text-gray-500 dark:text-gray-400 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400 dark:text-gray-500">
                  Nenhum produto cadastrado
                </td>
              </tr>
            ) : filtered.map(p => (
              <tr key={p.id} className={`border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${!p.active ? 'opacity-50' : ''}`}>
                <td className="p-3 font-medium text-gray-800 dark:text-white">{p.name}</td>
                <td className="p-3 text-gray-500 dark:text-gray-400">{p.category || '—'}</td>
                <td className="p-3 text-right text-gray-500 dark:text-gray-400">{fmt(p.costPrice)}</td>
                <td className="p-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{fmt(p.salePrice)}</td>
                <td className="p-3 text-right">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                    {margin(p.costPrice, p.salePrice)}%
                  </span>
                </td>
                <td className="p-3 text-right text-gray-600 dark:text-gray-300">
                  {p.quantity !== undefined ? `${p.quantity} ${p.unit || 'un'}` : '—'}
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => openEdit(p)}
                      className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 font-medium"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleToggleActive(p)}
                      className={`text-xs font-medium ${p.active ? 'text-orange-500 hover:text-orange-700' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      {p.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 font-medium"
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-lg text-gray-800 dark:text-white">Editar Produto</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-500 dark:text-gray-400">Nome</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Categoria</label>
                <select
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white mt-1"
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Unidade</label>
                <select
                  value={editUnit}
                  onChange={e => setEditUnit(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white mt-1"
                >
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Preço de Custo (R$)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={editCostPrice}
                  onChange={e => setEditCostPrice(Number(e.target.value))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Preço de Venda (R$)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={editSalePrice}
                  onChange={e => setEditSalePrice(Number(e.target.value))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white mt-1"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-500 dark:text-gray-400">Estoque (opcional — deixe vazio para não controlar)</label>
                <input
                  type="number" min="0"
                  value={editQuantity}
                  onChange={e => setEditQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white mt-1"
                />
              </div>
            </div>
            {editCostPrice > 0 && editSalePrice > 0 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Margem: <strong>{margin(editCostPrice, editSalePrice)}%</strong>
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditItem(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">Cancelar</button>
              <button
                onClick={handleEdit}
                disabled={saving}
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-50 transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsView;
