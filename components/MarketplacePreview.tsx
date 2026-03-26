import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { Review, Service } from '../types';
import { geocodeAddress } from '../services/geocodingService';

interface RankingData {
  position: number;
  total: number;
  average: number;
  count: number;
}

const MarketplacePreview: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [rating, setRating] = useState<{ average: number; count: number }>({ average: 0, count: 0 });
  const [ranking, setRanking] = useState<RankingData | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [viewCount, setViewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Editable profile fields
  const [editing, setEditing] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [endereco, setEndereco] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');
  const [cep, setCep] = useState('');
  const [mpVisible, setMpVisible] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        // Load tenant first — essential; rest are optional
        const t = await db.getTenant(tenantId);
        setTenant(t);

        if (t) {
          setDescricao(t.descricao || '');
          setEndereco(t.endereco || '');
          setCidade(t.cidade || '');
          setEstado(t.estado || '');
          setCep(t.cep || '');
          setMpVisible(t.marketplaceVisible || false);
        }

        // Load optional data in parallel — failures don't block
        const [r, revs, rankings, svcs, settings, views] = await Promise.all([
          db.getAverageRating(tenantId).catch(() => ({ average: 0, count: 0 })),
          db.getReviews(tenantId).catch(() => [] as Review[]),
          db.getMarketplaceRankings().catch(() => [] as any[]),
          db.getServices(tenantId).catch(() => []),
          db.getSettings(tenantId).catch(() => ({} as any)),
          db.getTenantViewCount(tenantId).catch(() => 0),
        ]);
        setRating(r);
        setReviews(revs.slice(0, 10));
        setServices(svcs.filter((s: any) => s.active));
        setLogoUrl(settings.logoUrl || '');
        setGalleryPhotos(settings.galleryPhotos || []);
        setViewCount(views);

        const me = rankings.find((x: any) => x.tenantId === tenantId);
        setRanking({
          position: me?.position ?? rankings.length + 1,
          total: rankings.length || 1,
          average: r.average,
          count: r.count,
        });
      } catch (e) {
        console.error('[MarketplacePreview] Error:', e);
      }
      setLoading(false);
    })();
  }, [tenantId]);

  const weblink = `${window.location.origin}/agendar/${tenant?.slug || ''}`;

  const copyLink = () => {
    navigator.clipboard.writeText(weblink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stars = (r: number) => {
    const full = Math.round(r / 2);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  };

  const rankBadge = (pos: number) => {
    if (pos === 1) return { icon: '🏆', label: '#1 da região', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' };
    if (pos === 2) return { icon: '🥈', label: '#2 da região', color: 'bg-slate-100 text-slate-600 border-slate-300' };
    if (pos === 3) return { icon: '🥉', label: '#3 da região', color: 'bg-orange-100 text-orange-600 border-orange-300' };
    if (pos <= 10) return { icon: '⭐', label: `Top ${pos} da região`, color: 'bg-blue-50 text-blue-600 border-blue-200' };
    return null;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return iso; }
  };

  const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validate: max 2MB, image only
    if (!file.type.startsWith('image/')) { alert('Selecione um arquivo de imagem.'); return; }
    if (file.size > 2 * 1024 * 1024) { alert('Imagem muito grande. Máximo 2MB.'); return; }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `logos/${tenantId}.${ext}`;

      // Upload (overwrite if exists)
      const { error: upErr } = await supabase.storage
        .from('marketplace')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Get public URL
      const { data } = supabase.storage.from('marketplace').getPublicUrl(path);
      const url = data.publicUrl + '?t=' + Date.now(); // cache bust
      setLogoUrl(url);

      // Save immediately
      await db.updateSettings(tenantId, { logoUrl: url });
    } catch (err: any) {
      console.error('[MarketplacePreview] Upload error:', err);
      alert('Erro ao enviar imagem. Verifique se o bucket "marketplace" existe no Supabase Storage.');
    }
    setUploading(false);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUploadGallery = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Selecione um arquivo de imagem.'); return; }
    if (file.size > 2 * 1024 * 1024) { alert('Imagem muito grande. Máximo 2MB.'); return; }
    if (galleryPhotos.length >= 3) { alert('Máximo de 3 fotos.'); return; }

    setUploadingGallery(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `gallery/${tenantId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('marketplace')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('marketplace').getPublicUrl(path);
      const url = data.publicUrl + '?t=' + Date.now();
      const updated = [...galleryPhotos, url];
      setGalleryPhotos(updated);
      await db.updateSettings(tenantId, { galleryPhotos: updated });
    } catch (err: any) {
      console.error('[MarketplacePreview] Gallery upload error:', err);
      alert('Erro ao enviar foto.');
    }
    setUploadingGallery(false);
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  const removeGalleryPhoto = async (idx: number) => {
    const updated = galleryPhotos.filter((_, i) => i !== idx);
    setGalleryPhotos(updated);
    await db.updateSettings(tenantId, { galleryPhotos: updated });
  };

  const handleSave = async () => {
    setSaving(true);
    setGeoStatus('idle');
    try {
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
        descricao,
        endereco,
        cidade,
        estado,
        cep,
        marketplaceVisible: mpVisible,
        ...(latitude !== undefined && { latitude, longitude }),
      });

      // Save logo URL in settings
      await db.updateSettings(tenantId, { logoUrl });

      setTenant((prev: any) => ({
        ...prev, descricao, endereco, cidade, estado, cep,
        marketplaceVisible: mpVisible,
        ...(latitude !== undefined && { latitude, longitude }),
      }));
      setEditing(false);
    } catch (e) {
      console.error('[MarketplacePreview] Save error:', e);
    }
    setSaving(false);
  };

  const toggleVisibility = async () => {
    const newVal = !mpVisible;
    setMpVisible(newVal);
    setTenant((prev: any) => ({ ...prev, marketplaceVisible: newVal }));
    try {
      await db.updateTenant(tenantId, { marketplaceVisible: newVal });
    } catch (e) {
      console.error('[MarketplacePreview] Toggle error:', e);
      setMpVisible(!newVal);
      setTenant((prev: any) => ({ ...prev, marketplaceVisible: !newVal }));
    }
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO...</div>;
  if (!tenant) return <div className="p-20 text-center font-black text-slate-400">Tenant não encontrado</div>;

  const badge = ranking ? rankBadge(ranking.position) : null;
  const initials = tenant.name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '??';

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">

      {/* ── Profile Header (estilo LinkedIn) ──────────────────── */}
      <div className="bg-white rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
        {/* Banner */}
        <div className="h-32 bg-gradient-to-r from-black via-slate-800 to-orange-500 relative">
          {/* Online/Offline toggle */}
          <button
            onClick={toggleVisibility}
            className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full transition-all hover:bg-black/70"
          >
            <div className={`w-8 h-4.5 rounded-full transition-all relative ${mpVisible ? 'bg-green-500' : 'bg-slate-500'}`} style={{ width: 32, height: 18 }}>
              <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[2px] transition-all ${mpVisible ? 'left-[15px]' : 'left-[2px]'}`} />
            </div>
            <span className={`text-[9px] font-black uppercase tracking-widest ${mpVisible ? 'text-green-400' : 'text-slate-400'}`}>
              {mpVisible ? 'Online' : 'Offline'}
            </span>
          </button>
          {badge && (
            <span className={`absolute top-4 right-4 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-black border ${badge.color}`}>
              {badge.icon} {badge.label}
            </span>
          )}
        </div>

        {/* Avatar + Name */}
        <div className="px-6 sm:px-8 pb-6 -mt-12">
          <div className="flex items-end gap-4 mb-4">
            {logoUrl ? (
              <img src={logoUrl} alt={tenant.name} className="w-24 h-24 rounded-2xl border-4 border-white shadow-lg object-cover bg-white" />
            ) : (
              <div className="w-24 h-24 rounded-2xl border-4 border-white shadow-lg bg-black text-white flex items-center justify-center text-2xl font-black">
                {initials}
              </div>
            )}
            <div className="flex-1 pb-1">
              <h1 className="text-2xl font-black text-black uppercase tracking-tight">{tenant.name}</h1>
              {tenant.nicho && (
                <span className="inline-block mt-1 text-[9px] font-black px-3 py-1 rounded-full bg-orange-50 text-orange-600 uppercase tracking-widest">
                  {tenant.nicho}
                </span>
              )}
            </div>
            <button
              onClick={() => editing ? handleSave() : setEditing(true)}
              disabled={saving}
              className={`px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                editing
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-slate-100 text-slate-600 hover:bg-black hover:text-white'
              } ${saving ? 'opacity-50' : ''}`}
            >
              {saving ? 'Salvando...' : editing ? 'Salvar' : 'Editar Perfil'}
            </button>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6 text-sm">
            {rating.average > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-orange-400">{stars(rating.average)}</span>
                <span className="text-[10px] font-black text-slate-400">{rating.average.toFixed(1)}/10</span>
              </div>
            )}
            <span className="text-[10px] font-black text-slate-400">{rating.count} avaliações</span>
            {ranking && <span className="text-[10px] font-black text-slate-400">#{ranking.position} de {ranking.total}</span>}
          </div>
        </div>
      </div>

      {/* ── Editable fields (visible when editing) ────────────── */}
      {editing && (
        <div className="bg-white p-6 sm:p-8 rounded-[30px] border-2 border-orange-200 shadow-xl shadow-orange-50/50 space-y-4">
          <h3 className="font-black text-black uppercase tracking-widest text-sm">Editar Perfil</h3>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Foto / Logo</label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-cover border-2 border-slate-100" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-xl font-black">{initials}</div>
              )}
              <div className="flex-1 space-y-2">
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadLogo} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className={`px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                    uploading ? 'bg-slate-100 text-slate-400' : 'bg-black text-white hover:bg-orange-500'
                  }`}
                >
                  {uploading ? 'Enviando...' : logoUrl ? 'Trocar Foto' : 'Enviar Foto'}
                </button>
                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => { setLogoUrl(''); db.updateSettings(tenantId, { logoUrl: '' }); }}
                    className="ml-2 px-3 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest bg-red-50 text-red-500 hover:bg-red-100 transition-all"
                  >
                    Remover
                  </button>
                )}
                <p className="text-[9px] text-slate-400 font-bold">JPG, PNG ou WebP. Máximo 2MB.</p>
              </div>
            </div>
          </div>

          {/* Gallery photos (up to 3) */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Fotos do Estabelecimento ({galleryPhotos.length}/3)</label>
            <div className="flex gap-3 flex-wrap">
              {galleryPhotos.map((url, i) => (
                <div key={i} className="relative group">
                  <img src={url} alt={`Foto ${i + 1}`} className="w-24 h-24 rounded-xl object-cover border-2 border-slate-100" />
                  <button
                    type="button"
                    onClick={() => removeGalleryPhoto(i)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs font-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    X
                  </button>
                </div>
              ))}
              {galleryPhotos.length < 3 && (
                <div>
                  <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleUploadGallery} className="hidden" />
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={uploadingGallery}
                    className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 hover:border-orange-400 hover:bg-orange-50 transition-all"
                  >
                    {uploadingGallery ? (
                      <div className="w-5 h-5 border-2 border-slate-200 border-t-orange-500 rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="text-2xl text-slate-300">+</span>
                        <span className="text-[8px] font-black text-slate-400 uppercase">Adicionar</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            <p className="text-[9px] text-slate-400 font-bold mt-1">Até 3 fotos. JPG, PNG ou WebP. Máximo 2MB cada.</p>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Descrição</label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Fale sobre seu negócio, diferenciais, especialidades..." rows={3} className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Endereço</label>
              <input type="text" value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número" className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cidade</label>
              <input type="text" value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Cidade" className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Estado</label>
              <input type="text" value={estado} onChange={e => setEstado(e.target.value)} placeholder="UF" className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">CEP</label>
              <input type="text" value={cep} onChange={e => setCep(e.target.value)} placeholder="00000-000" className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => setMpVisible(!mpVisible)}
              className={`w-12 h-7 rounded-full transition-all relative ${mpVisible ? 'bg-green-500' : 'bg-slate-200'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-1 transition-all ${mpVisible ? 'left-6' : 'left-1'}`} />
            </button>
            <span className="text-xs font-black text-slate-600">Visível no Marketplace</span>
          </div>

          {geoStatus === 'ok' && <p className="text-xs font-black text-green-600">Localização encontrada!</p>}
          {geoStatus === 'fail' && <p className="text-xs font-black text-amber-600">Não foi possível localizar o endereço no mapa.</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-green-500 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-green-600 transition-all disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
            <button onClick={() => { setEditing(false); setGeoStatus('idle'); }} className="px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── About + Location ──────────────────────────────────── */}
      {!editing && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Sobre */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-3">
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Sobre</h3>
            {descricao ? (
              <p className="text-sm text-slate-600 font-bold leading-relaxed">{descricao}</p>
            ) : (
              <p className="text-sm text-slate-300 font-bold italic">Nenhuma descrição ainda. Clique em "Editar Perfil" para adicionar.</p>
            )}
            {!mpVisible && (
              <p className="text-[10px] font-black text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                Perfil oculto no marketplace. Ative clicando em "Editar Perfil".
              </p>
            )}
          </div>

          {/* Localização */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-3">
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Localização</h3>
            {endereco || cidade ? (
              <div className="space-y-1">
                {endereco && <p className="text-sm text-slate-600 font-bold">{endereco}</p>}
                <p className="text-sm text-slate-500 font-bold">
                  {[cidade, estado].filter(Boolean).join(' - ')}
                  {cep ? ` | ${cep}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-300 font-bold italic">Endereço não configurado.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Gallery (Instagram-style) ──────────────────────── */}
      {galleryPhotos.length > 0 && !editing && (
        <div className="bg-white p-6 sm:p-8 rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-4">
          <h3 className="font-black text-black uppercase tracking-widest text-sm">Fotos</h3>
          <div className={`grid gap-2 ${galleryPhotos.length === 1 ? 'grid-cols-1' : galleryPhotos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {galleryPhotos.map((url, i) => (
              <button key={i} onClick={() => setLightboxIdx(i)} className="aspect-square rounded-2xl overflow-hidden hover:opacity-90 transition-opacity">
                <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div className="fixed inset-0 bg-black/90 z-[300] flex items-center justify-center p-4" onClick={() => setLightboxIdx(null)}>
          <button onClick={() => setLightboxIdx(null)} className="absolute top-6 right-6 text-white text-3xl font-black hover:text-orange-400 transition-colors">X</button>
          {galleryPhotos.length > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + galleryPhotos.length) % galleryPhotos.length); }} className="absolute left-4 text-white text-4xl font-black hover:text-orange-400 transition-colors">‹</button>
              <button onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % galleryPhotos.length); }} className="absolute right-4 text-white text-4xl font-black hover:text-orange-400 transition-colors">›</button>
            </>
          )}
          <img src={galleryPhotos[lightboxIdx]} alt="Foto" className="max-w-full max-h-[85vh] rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ── WebLink ──────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-3">
        <h3 className="font-black text-black uppercase tracking-widest text-sm">Seu WebLink</h3>
        <div className="flex items-center gap-3">
          <input type="text" readOnly value={weblink} className="flex-1 border-2 border-slate-100 rounded-xl p-3 text-sm font-bold text-slate-600 bg-slate-50" />
          <button
            onClick={copyLink}
            className={`px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
              copied ? 'bg-green-500 text-white' : 'bg-black text-white hover:bg-orange-500'
            }`}
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>

      {/* ── Serviços ─────────────────────────────────────────── */}
      <div className="bg-white p-6 sm:p-8 rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-black uppercase tracking-widest text-sm">Serviços</h3>
          <span className="text-[10px] font-black text-slate-400">{services.length} ativos</span>
        </div>

        {services.length === 0 ? (
          <p className="text-sm text-slate-300 font-bold italic py-4 text-center">Nenhum serviço cadastrado ainda.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {services.map(svc => (
              <div key={svc.id} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 hover:bg-orange-50 transition-all group">
                <div>
                  <p className="text-sm font-black text-slate-700 group-hover:text-orange-600 transition-colors">{svc.name}</p>
                  <p className="text-[10px] font-bold text-slate-400">{svc.durationMinutes} min</p>
                </div>
                <p className="text-sm font-black text-orange-500">R$ {fmtBRL(svc.price)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Stats ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
          <p className="text-3xl font-black text-orange-500">{rating.average > 0 ? rating.average.toFixed(1) : '—'}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Nota Média</p>
        </div>
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
          <p className="text-3xl font-black text-black">{rating.count}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Avaliações</p>
        </div>
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
          <p className="text-3xl font-black text-black">{viewCount}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Visitas</p>
        </div>
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
          <p className="text-3xl font-black text-black">#{ranking?.position || '—'}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Ranking</p>
        </div>
        <div className="bg-white rounded-2xl border-2 border-slate-100 p-5 text-center">
          <p className="text-3xl font-black text-black">{ranking?.total || 0}</p>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Total no MP</p>
        </div>
      </div>

      {/* ── Últimas Avaliações ────────────────────────────────── */}
      <div className="bg-white p-6 sm:p-8 rounded-[30px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-black uppercase tracking-widest text-sm">Avaliações</h3>
          <span className="text-[10px] font-black text-slate-400">{rating.count} no total</span>
        </div>

        {reviews.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-4xl mb-3">📝</p>
            <p className="text-sm font-black text-slate-400">Nenhuma avaliação ainda</p>
            <p className="text-[10px] font-bold text-slate-300 mt-1">As avaliações aparecem quando clientes dão nota após o atendimento</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map(rev => (
              <div key={rev.id} className="bg-slate-50 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 text-xs">{stars(rev.rating)}</span>
                    <span className="text-[10px] font-black text-slate-500">{rev.rating}/10</span>
                  </div>
                  <span className="text-[9px] font-bold text-slate-300">{formatDate(rev.createdAt)}</span>
                </div>
                <p className="text-xs font-black text-slate-600">{rev.customerName || 'Cliente'}</p>
                {rev.comment && <p className="text-xs text-slate-500">{rev.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketplacePreview;
