
import React, { useState } from 'react';
import EstoqueView from './EstoqueView';
import ProductsView from './ProductsView';

const EstoqueProdutosView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [tab, setTab] = useState<'insumos' | 'produtos'>('insumos');

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Tabs */}
      <div className="flex items-center gap-2 bg-white border border-slate-100 rounded-2xl p-1.5 w-fit shadow-sm">
        <button
          onClick={() => setTab('insumos')}
          className={`px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
            tab === 'insumos' ? 'bg-black text-white shadow-lg' : 'text-slate-400 hover:text-black hover:bg-slate-50'
          }`}
        >
          📦 Insumos & Estoque
        </button>
        <button
          onClick={() => setTab('produtos')}
          className={`px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
            tab === 'produtos' ? 'bg-black text-white shadow-lg' : 'text-slate-400 hover:text-black hover:bg-slate-50'
          }`}
        >
          🛍️ Produtos para Venda
        </button>
      </div>

      {tab === 'insumos' ? (
        <EstoqueView tenantId={tenantId} />
      ) : (
        <ProductsView tenantId={tenantId} />
      )}
    </div>
  );
};

export default EstoqueProdutosView;
