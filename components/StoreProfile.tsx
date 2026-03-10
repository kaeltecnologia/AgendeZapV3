
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { geocodeAddress } from '../services/geocodingService';

const StoreProfile: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [themeColor, setThemeColor] = useState('#f97316');
  const [coverImage, setCoverImage] = useState('');
  const [loading, setLoading] = useState(true);

  // Marketplace fields
  const [mpVisible, setMpVisible] = useState(false);
  const [endereco, setEndereco] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');
  const [cep, setCep] = useState('');
  const [descricao, setDescricao] = useState('');
  const [mpSaving, setMpSaving] = useState(false);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    const load = async () => {
      const [settings, cover] = await Promise.all([
        db.getSettings(tenantId),
        db.getCoverImage(tenantId)
      ]);
      setThemeColor(settings.themeColor);
      setCoverImage(cover);
      // Load tenant data for marketplace
      try {
        const tenants = await db.getAllTenants();
        const t = tenants.find((x: any) => x.id === tenantId);
        if (t) {
          setMpVisible(t.marketplaceVisible || false);
          setEndereco(t.endereco || '');
          setCidade(t.cidade || '');
          setEstado(t.estado || '');
          setCep(t.cep || '');
          setDescricao(t.descricao || '');
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, [tenantId]);

  const saveMarketplace = async () => {
    setMpSaving(true);
    setGeoStatus('idle');

    // Geocode the full address to get lat/lng
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (endereco || cidade) {
      const fullAddress = [endereco, cidade, estado, cep].filter(Boolean).join(', ');
      const coords = await geocodeAddress(fullAddress);
      if (coords) {
        latitude = coords.lat;
        longitude = coords.lng;
        setGeoStatus('ok');
      } else {
        setGeoStatus('fail');
      }
    }

    await db.updateTenant(tenantId, {
      marketplaceVisible: mpVisible,
      endereco, cidade, estado, cep, descricao,
      latitude, longitude,
    } as any);
    setMpSaving(false);
  };
  
  const handleColorChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setThemeColor(val);
    await db.updateSettings(tenantId, { themeColor: val });
  };

  const handleRemoveCover = async () => {
    setCoverImage('');
    await db.setCoverImage(tenantId, '');
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO PERFIL...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Personalização da Marca</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Configuração visual do seu Link de Agendamento</p>
      </div>

      <div className="bg-white p-4 sm:p-8 md:p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-8 sm:space-y-12">
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
             <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center text-xl">🖼️</div>
             <h3 className="font-black text-black uppercase tracking-widest text-sm">Banner de Capa</h3>
          </div>
          <div className="relative border-4 border-dashed border-slate-100 rounded-[35px] bg-slate-50 overflow-hidden min-h-[220px] group transition-all hover:border-orange-500">
            {coverImage ? (
              <img src={coverImage} alt="Cover" className="w-full h-56 object-cover" />
            ) : (
              <div className="p-16 text-center">
                <p className="font-black text-black uppercase text-xs tracking-widest">Upload de Logotipo ou Fachada</p>
                <p className="text-[10px] font-bold text-slate-300 uppercase mt-2 tracking-widest">Formato: JPG, PNG até 5MB</p>
              </div>
            )}
            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" />
            {coverImage && <button onClick={handleRemoveCover} className="absolute top-4 right-4 bg-white p-3 rounded-2xl text-red-500 font-black text-[10px] uppercase shadow-xl">Remover</button>}
          </div>
        </div>

        <div className="space-y-8">
          <div className="flex items-center space-x-4">
             <div className="w-10 h-10 bg-orange-500 text-white rounded-xl flex items-center justify-center text-xl">🎨</div>
             <h3 className="font-black text-black uppercase tracking-widest text-sm">Identidade Cromática</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="bg-slate-50 p-8 rounded-[30px] flex items-center space-x-8">
              <input type="color" value={themeColor} onChange={handleColorChange} className="w-24 h-24 rounded-[24px] border-4 border-white shadow-xl cursor-pointer bg-transparent" />
              <div className="space-y-2">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Código da Cor</p>
                 <p className="text-2xl font-black text-black tracking-tight uppercase">{themeColor}</p>
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Prévia do Botão</p>
              <button style={{backgroundColor: themeColor}} className="w-full text-white py-5 rounded-[24px] font-black uppercase tracking-[0.2em] shadow-2xl transition-transform hover:scale-105">Agendar Agora</button>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t-2 border-slate-50">
          <button className="w-full bg-black text-white py-6 rounded-[30px] font-black text-sm uppercase tracking-[0.3em] shadow-2xl shadow-slate-200 hover:bg-orange-500 transition-all">
            Salvar Layout
          </button>
        </div>
      </div>

      {/* ── Marketplace Central ──────────────────────────────── */}
      <div className="bg-white p-4 sm:p-8 md:p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-6 sm:space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center text-xl">📡</div>
            <div>
              <h3 className="font-black text-black uppercase tracking-widest text-sm">Marketplace Central</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Apareça para clientes buscando serviços na sua região</p>
            </div>
          </div>
          <button
            onClick={() => setMpVisible(v => !v)}
            className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${mpVisible ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}
          >
            {mpVisible ? 'Visível' : 'Oculto'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([
            ['Endereço', endereco, setEndereco, 'Rua das Flores, 123'],
            ['Cidade', cidade, setCidade, 'Maringá'],
            ['Estado', estado, setEstado, 'PR'],
            ['CEP', cep, setCep, '87000-000'],
          ] as [string, string, (v: string) => void, string][]).map(([label, val, setter, ph]) => (
            <div key={label} className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
              <input type="text" value={val} onChange={e => setter(e.target.value)} placeholder={ph}
                className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Descrição</label>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
            placeholder="Descreva seu negócio em poucas palavras..."
            className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 resize-none" rows={3} />
        </div>

        <button onClick={saveMarketplace}
          className="w-full bg-orange-500 text-white py-4 rounded-[20px] font-black text-[10px] uppercase tracking-[0.2em] hover:bg-black transition-all">
          {mpSaving ? 'Salvando...' : 'Salvar Marketplace'}
        </button>

        {geoStatus === 'ok' && (
          <p className="text-center text-xs font-black text-green-600 mt-2">
            Localização encontrada no mapa! Clientes próximos poderão te encontrar.
          </p>
        )}
        {geoStatus === 'fail' && (
          <p className="text-center text-xs font-black text-amber-600 mt-2">
            Não foi possível localizar o endereço no mapa. Verifique se o endereço, cidade e estado estão corretos.
          </p>
        )}
      </div>
    </div>
  );
};

export default StoreProfile;
