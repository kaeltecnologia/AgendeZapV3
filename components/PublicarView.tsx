import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { evolutionService } from '../services/evolutionService';
import { instagramService } from '../services/instagramService';
import { MarketplacePost } from '../types';

interface Props { tenantId: string; }

const PublicarView: React.FC<Props> = ({ tenantId }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [waConnected, setWaConnected] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Instagram state
  const [igConnected, setIgConnected] = useState(false);
  const [igUserId, setIgUserId] = useState('');
  const [igAccessToken, setIgAccessToken] = useState('');
  const [igUsername, setIgUsername] = useState('');

  // Google Business state
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusinessName, setGoogleBusinessName] = useState('');

  // Channels
  const [chWa, setChWa] = useState(true);
  const [chAz, setChAz] = useState(true);
  const [chIg, setChIg] = useState(false);
  const [chGoogle, setChGoogle] = useState(false);

  // Result feedback
  const [result, setResult] = useState<{ wa?: string; az?: string; ig?: string; google?: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tenant, postsList, settings] = await Promise.all([
          db.getTenant(tenantId),
          db.getPostsByTenant(tenantId),
          db.getSettings(tenantId),
        ]);
        setPosts(postsList);
        if (tenant?.slug) {
          const inst = evolutionService.getInstanceName(tenant.slug);
          setInstanceName(inst);
          const status = await evolutionService.checkStatus(inst);
          setWaConnected(status === 'open');
        }
        // Instagram
        const igToken = (settings as any).instagramAccessToken || '';
        const igId = (settings as any).instagramUserId || '';
        const igUser = (settings as any).instagramUsername || '';
        if (igToken && igId) {
          setIgConnected(true);
          setIgAccessToken(igToken);
          setIgUserId(igId);
          setIgUsername(igUser);
          setChIg(true);
        }
        // Google Business
        const gbName = (settings as any).googleBusinessName || '';
        const gbLocation = (settings as any).googleLocationId || '';
        if (gbName && gbLocation) {
          setGoogleConnected(true);
          setGoogleBusinessName(gbName);
          setChGoogle(true);
        }
      } catch (e) { console.error('[PublicarView] init error:', e); }
      setLoading(false);
    })();
  }, [tenantId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { alert('Selecione uma imagem.'); return; }
    if (f.size > 2 * 1024 * 1024) { alert('Máximo 2MB.'); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (f.size > 2 * 1024 * 1024) { alert('Máximo 2MB.'); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };

  const handlePublish = async () => {
    if (!file) return;
    if (!chWa && !chAz && !chIg && !chGoogle) { alert('Selecione pelo menos um canal.'); return; }
    setPublishing(true);
    setResult(null);
    const res: { wa?: string; az?: string; ig?: string; google?: string } = {};

    try {
      // 1. Upload to Supabase Storage
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `posts/${tenantId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('marketplace')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('marketplace').getPublicUrl(path);
      const publicUrl = data.publicUrl + '?t=' + Date.now();

      // 2. Publish to selected channels in parallel
      const promises: Promise<void>[] = [];

      if (chAz) {
        promises.push(
          db.createPost(tenantId, publicUrl, caption.trim() || undefined)
            .then(post => { setPosts(prev => [post, ...prev]); res.az = 'ok'; })
            .catch(e => { res.az = e.message || 'Erro'; })
        );
      }

      if (chWa && waConnected && instanceName) {
        promises.push(
          evolutionService.sendStatusImage(instanceName, publicUrl, caption.trim() || undefined)
            .then(r => { res.wa = r.success ? 'ok' : (r.error || 'Erro'); })
            .catch(e => { res.wa = e.message || 'Erro'; })
        );
      } else if (chWa && !waConnected) {
        res.wa = 'WhatsApp desconectado';
      }

      if (chIg && igConnected && igUserId && igAccessToken) {
        promises.push(
          instagramService.publishStory(igUserId, igAccessToken, publicUrl)
            .then(r => { res.ig = r.success ? 'ok' : (r.error || 'Erro'); })
            .catch(e => { res.ig = e.message || 'Erro'; })
        );
      } else if (chIg && !igConnected) {
        res.ig = 'Instagram desconectado';
      }

      if (chGoogle && googleConnected) {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cnnfnqrnjckntnxdgwae.supabase.co';
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';
        promises.push(
          fetch(`${SUPABASE_URL}/functions/v1/google-business-publish`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ tenantId, imageUrl: publicUrl, caption: caption.trim() || '' }),
          })
            .then(r => r.json())
            .then(d => { res.google = d.error ? d.error : 'ok'; })
            .catch(e => { res.google = e.message || 'Erro'; })
        );
      } else if (chGoogle && !googleConnected) {
        res.google = 'Google Business desconectado';
      }

      await Promise.all(promises);
    } catch (e: any) {
      res.az = res.az || e.message;
      res.wa = res.wa || e.message;
      res.ig = res.ig || e.message;
      res.google = res.google || e.message;
    }

    setResult(res);
    // Reset form on full success
    const hasError = [res.az, res.wa, res.ig, res.google].some(v => v && v !== 'ok');
    if (!hasError) {
      setFile(null);
      setPreview('');
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
    }
    setPublishing(false);
  };

  const removeFile = () => {
    setFile(null);
    setPreview('');
    if (fileRef.current) fileRef.current.value = '';
    setResult(null);
  };

  if (loading) return (
    <div className="text-center py-20">
      <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-700 flex items-center gap-2">
          <svg className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Publicar
        </h2>
        <p className="text-xs text-slate-400 mt-1">Publique fotos dos seus trabalhos no Status do WhatsApp, Instagram e Marketplace AZ.</p>
      </div>

      {/* Upload + Caption + Channels */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
        {/* Image upload */}
        {!preview ? (
          <div
            className="w-full aspect-video rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-orange-400 transition-all cursor-pointer"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <svg className="w-10 h-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <p className="text-xs font-bold text-slate-400">Clique ou arraste uma imagem</p>
            <p className="text-[10px] text-slate-300">JPG, PNG — máximo 2MB</p>
          </div>
        ) : (
          <div className="relative">
            <img src={preview} alt="Preview" className="w-full aspect-video object-cover rounded-2xl" />
            <button
              onClick={removeFile}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm hover:bg-red-500 transition-all"
            >
              &times;
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

        {/* Caption */}
        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="Legenda (opcional)..."
          maxLength={500}
          rows={2}
          className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 resize-none"
        />

        {/* Channel selection */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Publicar em:</p>

          {/* WhatsApp Status */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${chWa ? 'border-green-400 bg-green-50' : 'border-slate-100'}`}>
            <input type="checkbox" checked={chWa} onChange={e => setChWa(e.target.checked)} className="w-4 h-4 accent-green-500" />
            <span className="text-lg">📱</span>
            <div className="flex-1">
              <p className="text-xs font-black text-slate-700">Status WhatsApp</p>
              <p className="text-[10px] text-slate-400">Visível para todos os seus contatos</p>
            </div>
            {waConnected ? (
              <span className="text-[9px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Conectado</span>
            ) : (
              <span className="text-[9px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Desconectado</span>
            )}
          </label>

          {/* Instagram Story */}
          {igConnected ? (
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${chIg ? 'border-purple-400 bg-purple-50' : 'border-slate-100'}`}>
              <input type="checkbox" checked={chIg} onChange={e => setChIg(e.target.checked)} className="w-4 h-4 accent-purple-500" />
              <span className="text-lg">📸</span>
              <div className="flex-1">
                <p className="text-xs font-black text-slate-700">Story Instagram</p>
                <p className="text-[10px] text-slate-400">Publica como Story no @{igUsername}</p>
              </div>
              <span className="text-[9px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">@{igUsername}</span>
            </label>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-100 opacity-50">
              <input type="checkbox" disabled className="w-4 h-4" />
              <span className="text-lg">📸</span>
              <div className="flex-1">
                <p className="text-xs font-black text-slate-700">Story Instagram</p>
                <p className="text-[10px] text-slate-400">Conecte em Conexões &gt; Instagram</p>
              </div>
              <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Desconectado</span>
            </div>
          )}

          {/* Feed AZ */}
          <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${chAz ? 'border-orange-400 bg-orange-50' : 'border-slate-100'}`}>
            <input type="checkbox" checked={chAz} onChange={e => setChAz(e.target.checked)} className="w-4 h-4 accent-orange-500" />
            <span className="text-lg">🌐</span>
            <div className="flex-1">
              <p className="text-xs font-black text-slate-700">Feed AZ (Marketplace)</p>
              <p className="text-[10px] text-slate-400">Aparece no seu perfil público</p>
            </div>
            <span className="text-[9px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">Ativo</span>
          </label>

          {/* Google Maps */}
          {googleConnected ? (
            <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${chGoogle ? 'border-blue-400 bg-blue-50' : 'border-slate-100'}`}>
              <input type="checkbox" checked={chGoogle} onChange={e => setChGoogle(e.target.checked)} className="w-4 h-4 accent-blue-500" />
              <span className="text-lg">📍</span>
              <div className="flex-1">
                <p className="text-xs font-black text-slate-700">Google Maps</p>
                <p className="text-[10px] text-slate-400">Post no perfil do {googleBusinessName}</p>
              </div>
              <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">{googleBusinessName}</span>
            </label>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-100 opacity-50">
              <input type="checkbox" disabled className="w-4 h-4" />
              <span className="text-lg">📍</span>
              <div className="flex-1">
                <p className="text-xs font-black text-slate-700">Google Maps</p>
                <p className="text-[10px] text-slate-400">Conecte em Conexões &gt; Google</p>
              </div>
              <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Desconectado</span>
            </div>
          )}
        </div>

        {/* Result feedback */}
        {result && (
          <div className="space-y-1 p-3 bg-slate-50 rounded-xl">
            {result.wa !== undefined && (
              <p className={`text-xs font-bold ${result.wa === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {result.wa === 'ok' ? '✓ Status WhatsApp publicado!' : `✗ WhatsApp: ${result.wa}`}
              </p>
            )}
            {result.ig !== undefined && (
              <p className={`text-xs font-bold ${result.ig === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {result.ig === 'ok' ? '✓ Story Instagram publicado!' : `✗ Instagram: ${result.ig}`}
              </p>
            )}
            {result.az !== undefined && (
              <p className={`text-xs font-bold ${result.az === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {result.az === 'ok' ? '✓ Publicado no Feed AZ!' : `✗ Feed AZ: ${result.az}`}
              </p>
            )}
            {result.google !== undefined && (
              <p className={`text-xs font-bold ${result.google === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {result.google === 'ok' ? '✓ Publicado no Google Maps!' : `✗ Google Maps: ${result.google}`}
              </p>
            )}
          </div>
        )}

        {/* Publish button */}
        <button
          onClick={handlePublish}
          disabled={!file || publishing || (!chWa && !chAz && !chIg && !chGoogle)}
          className="w-full bg-orange-500 text-white py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {publishing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Publicando...
            </>
          ) : (
            'Publicar'
          )}
        </button>
      </div>

      {/* Post history */}
      {posts.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Publicações recentes</h3>
          <div className="grid grid-cols-3 gap-3">
            {posts.slice(0, 12).map(p => (
              <div key={p.id} className="group relative">
                <img
                  src={p.imageUrl}
                  alt={p.caption || 'Post'}
                  className="w-full aspect-square object-cover rounded-xl"
                />
                {p.caption && (
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all rounded-xl flex items-end p-2">
                    <p className="text-[10px] text-white font-bold line-clamp-3">{p.caption}</p>
                  </div>
                )}
                <p className="text-[9px] text-slate-400 mt-1">
                  {new Date(p.createdAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicarView;
