/**
 * MarketplacePage.tsx
 *
 * Public marketplace page — accessible at #/marketplace
 * Two tabs: "Perfis" (listings with ratings) and "Posts" (Instagram-style feed).
 * Mobile-first, responsive.
 */

import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { Tenant, CustomerAccount, MarketplacePost, MarketplacePostComment } from '../types';

interface TenantCard extends Tenant {
  rating: number;
  reviewCount: number;
}

const MarketplacePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantCard[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<TenantCard[]>([]);

  // Customer session
  const [customerSession] = useState<CustomerAccount | null>(() => {
    try { const raw = localStorage.getItem('agz_customer'); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [galleries, setGalleries] = useState<Map<string, string[]>>(new Map());

  // Lead capture / registration
  const [showCapture, setShowCapture] = useState(!localStorage.getItem('agz_customer') && !localStorage.getItem('agz_session'));
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadCity, setLeadCity] = useState('');
  const [leadPassword, setLeadPassword] = useState('');
  const [leadNichos, setLeadNichos] = useState<string[]>([]);
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [captureError, setCaptureError] = useState('');

  // Tenant session
  const tenantSession = (() => {
    try {
      const hashQuery = window.location.hash.split('?')[1];
      if (hashQuery) {
        const params = new URLSearchParams(hashQuery);
        const tid = params.get('tid');
        if (tid) return { id: tid, name: decodeURIComponent(params.get('tn') || '') };
      }
      const raw = localStorage.getItem('agz_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s?.tenantId ? { id: s.tenantId, name: s.tenantName || '' } : null;
    } catch { return null; }
  })();
  const myTenantId = tenantSession?.id || null;

  // Tabs
  const [activeTab, setActiveTab] = useState<'home' | 'explorar'>('home');

  // Tenant Detail view
  const [selectedTenant, setSelectedTenant] = useState<TenantCard | null>(null);
  const [detailTab, setDetailTab] = useState<'agendar' | 'posts'>('agendar');
  const [detailPosts, setDetailPosts] = useState<MarketplacePost[]>([]);
  const [loadingDetailPosts, setLoadingDetailPosts] = useState(false);

  // Filters
  const [searchCity, setSearchCity] = useState('');
  const [searchNicho, setSearchNicho] = useState('');

  // Posts state
  const [posts, setPosts] = useState<MarketplacePost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentsByPost, setCommentsByPost] = useState<Map<string, MarketplacePostComment[]>>(new Map());
  const [commentInputs, setCommentInputs] = useState<Map<string, { name: string; text: string }>>(new Map());

  // Post creation
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [newPostCaption, setNewPostCaption] = useState('');
  const [newPostPreview, setNewPostPreview] = useState('');
  const [newPostFile, setNewPostFile] = useState<File | null>(null);
  const [creatingPost, setCreatingPost] = useState(false);
  const postFileRef = useRef<HTMLInputElement>(null);

  // Liker ID
  const [likerId] = useState<string>(() => {
    try { const c = localStorage.getItem('agz_customer'); if (c) return JSON.parse(c).phone; } catch {}
    let sid = localStorage.getItem('agz_mp_session');
    if (!sid) { sid = crypto.randomUUID(); localStorage.setItem('agz_mp_session', sid); }
    return sid;
  });

  // ── Load Perfis ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [data, allRatings] = await Promise.all([db.getMarketplaceTenants(), db.getAllRatings()]);
        console.log('[Marketplace] getMarketplaceTenants returned:', data.length, 'tenants', data.map(t => ({ id: t.id, name: t.name, visible: t.marketplaceVisible, status: t.status })));
        console.log('[Marketplace] myTenantId:', myTenantId);
        const withRatings: TenantCard[] = data.map(t => {
          const r = allRatings.get(t.id) || { average: 0, count: 0 };
          return { ...t, rating: r.average, reviewCount: r.count };
        });
        if (myTenantId && !withRatings.find(t => t.id === myTenantId)) {
          const myTenant = await db.getTenant(myTenantId);
          console.log('[Marketplace] Fetched own tenant:', myTenant?.name, myTenant?.marketplaceVisible);
          if (myTenant) {
            const r = allRatings.get(myTenantId) || { average: 0, count: 0 };
            withRatings.unshift({ ...myTenant, rating: r.average, reviewCount: r.count });
          }
        }
        withRatings.sort((a, b) => b.rating - a.rating);
        setTenants(withRatings);
        setFilteredTenants(withRatings);
        db.getMarketplaceGalleries(withRatings.map(t => t.id)).then(g => setGalleries(g)).catch(() => {});
        if (customerSession?.phone) {
          db.getCustomerFavorites(customerSession.phone).then(favs => {
            setFavorites(new Set(favs.map(f => f.tenantId)));
          }).catch(() => {});
        }
      } catch (e) { console.error('[Marketplace] Load error:', e); }
      setLoading(false);
    })();
  }, []);

  // ── Load Posts ─────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'home') return;
    (async () => {
      setLoadingPosts(true);
      try {
        const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
        let raw = await db.getPostsFeed({
          cidade: searchCity.trim() ? norm(searchCity) : undefined,
          nicho: searchNicho || undefined,
        });
        raw = await db.enrichPostsWithTenantInfo(raw);
        setPosts(raw);
        const likedSet = await db.getPostLikesByUser(likerId, raw.map(p => p.id));
        setUserLikes(likedSet);
      } catch (e) { console.error('[Marketplace] Posts load error:', e); }
      setLoadingPosts(false);
    })();
  }, [activeTab, searchCity, searchNicho]);

  // ── Filter Perfis ─────────────────────────────────────────────────
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

  useEffect(() => {
    const cityQ = norm(searchCity);
    const nichoQ = norm(searchNicho);
    setFilteredTenants(
      tenants.filter(t => {
        if (cityQ && !norm(t.cidade || '').includes(cityQ)) return false;
        if (nichoQ && !norm(t.nicho || '').includes(nichoQ)) return false;
        return true;
      })
    );
  }, [searchCity, searchNicho, tenants]);

  const nichoOptions = [
    'Barbearia', 'Salão de Beleza', 'Manicure/Pedicure', 'Estética Corporal',
    'Estética Facial', 'Depilação', 'Micropigmentação', 'Design de Sobrancelhas',
    'Cílios e Extensões', 'Maquiagem', 'Spa', 'Clínica de Estética',
    'Bronzeamento', 'Podologia', 'Massoterapia',
  ];

  const toggleNicho = (n: string) => setLeadNichos(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);

  const handleCapture = async () => {
    const phone = leadPhone.replace(/\D/g, '');
    if (!leadName.trim() || !phone || phone.length < 10) { setCaptureError('Preencha nome e telefone válido.'); return; }
    if (!leadPassword || leadPassword.length < 4) { setCaptureError('Senha deve ter no mínimo 4 caracteres.'); return; }
    setCaptureError('');
    try {
      // Register customer account
      const result = await db.customerRegister(phone, leadName.trim(), leadPassword, leadCity.trim() || undefined);
      if ('error' in result) { setCaptureError(result.error); return; }
      // Save session
      localStorage.setItem('agz_customer', JSON.stringify(result));
      // Also save lead for marketing
      try {
        await db.addMarketplaceLead({
          phone, name: leadName.trim(),
          city: leadCity.trim() || undefined,
          nichoInterest: leadNichos.length > 0 ? leadNichos.join(', ') : undefined,
          source: 'marketplace',
        });
      } catch {}
      if (leadCity.trim()) setSearchCity(leadCity.trim());
      setLeadCaptured(true);
      setShowCapture(false);
    } catch (e) {
      console.error('[Marketplace] Erro ao registrar:', e);
      setCaptureError('Erro de conexão. Tente novamente.');
    }
  };

  const toggleFavorite = async (tenantId: string) => {
    if (!customerSession?.phone) { window.location.hash = '#/minha-conta'; return; }
    try {
      if (favorites.has(tenantId)) {
        await db.removeCustomerFavorite(customerSession.phone, tenantId);
        setFavorites(prev => { const n = new Set(prev); n.delete(tenantId); return n; });
      } else {
        await db.addCustomerFavorite(customerSession.phone, tenantId);
        setFavorites(prev => new Set(prev).add(tenantId));
      }
    } catch (e) { console.error('[Marketplace] Favorite error:', e); }
  };

  const stars = (r: number) => { if (r === 0) return ''; const full = Math.round(r / 2); return '\u2605'.repeat(full) + '\u2606'.repeat(5 - full); };

  const nichos = [...new Set([...nichoOptions, ...tenants.map(t => t.nicho).filter(Boolean)])];

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  // ── Post Handlers ─────────────────────────────────────────────────
  const handleCreatePost = async () => {
    if (!newPostFile || !myTenantId) return;
    setCreatingPost(true);
    try {
      const ext = newPostFile.name.split('.').pop() || 'jpg';
      const path = `posts/${myTenantId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('marketplace').upload(path, newPostFile, { upsert: true, contentType: newPostFile.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('marketplace').getPublicUrl(path);
      const url = data.publicUrl + '?t=' + Date.now();
      const post = await db.createPost(myTenantId, url, newPostCaption.trim() || undefined);
      setPosts(prev => [post, ...prev]);
      setNewPostFile(null);
      setNewPostPreview('');
      setNewPostCaption('');
      setShowCreatePost(false);
      if (postFileRef.current) postFileRef.current.value = '';
    } catch (err) {
      console.error('[Marketplace] Create post error:', err);
      alert('Erro ao publicar. Tente novamente.');
    }
    setCreatingPost(false);
  };

  const handlePostFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Selecione uma imagem.'); return; }
    if (file.size > 2 * 1024 * 1024) { alert('Máximo 2MB.'); return; }
    setNewPostFile(file);
    setNewPostPreview(URL.createObjectURL(file));
  };

  const handleLike = async (postId: string) => {
    try {
      const { liked, likesCount } = await db.togglePostLike(postId, likerId);
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likesCount } : p));
      setUserLikes(prev => { const n = new Set(prev); liked ? n.add(postId) : n.delete(postId); return n; });
    } catch (e) { console.error('[Marketplace] Like error:', e); }
  };

  const toggleComments = async (postId: string) => {
    if (expandedComments.has(postId)) {
      setExpandedComments(prev => { const n = new Set(prev); n.delete(postId); return n; });
      return;
    }
    if (!commentsByPost.has(postId)) {
      try {
        const comments = await db.getPostComments(postId);
        setCommentsByPost(prev => new Map(prev).set(postId, comments));
      } catch {}
    }
    setExpandedComments(prev => new Set(prev).add(postId));
  };

  const submitComment = async (postId: string) => {
    const input = commentInputs.get(postId);
    if (!input?.name.trim() || !input?.text.trim()) return;
    try {
      const comment = await db.addPostComment(postId, input.name.trim(), input.text.trim());
      setCommentsByPost(prev => { const m = new Map<string, MarketplacePostComment[]>(prev); const existing = m.get(postId) || []; m.set(postId, [...existing, comment]); return m; });
      setCommentInputs(prev => { const m = new Map(prev); m.delete(postId); return m; });
    } catch (e) { console.error('[Marketplace] Comment error:', e); }
  };

  const deletePost = async (postId: string) => {
    if (!myTenantId) return;
    try {
      await db.deletePost(postId, myTenantId);
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) { console.error('[Marketplace] Delete error:', e); }
  };

  // ── Tenant Detail ────────────────────────────────────────────────
  const openTenantDetail = async (t: TenantCard) => {
    setSelectedTenant(t);
    setDetailTab('agendar');
    setDetailPosts([]);
    setLoadingDetailPosts(true);
    try {
      let tPosts = await db.getPostsByTenant(t.id);
      tPosts = await db.enrichPostsWithTenantInfo(tPosts);
      setDetailPosts(tPosts);
      const likedSet = await db.getPostLikesByUser(likerId, tPosts.map(p => p.id));
      setUserLikes(prev => { const n = new Set(prev); likedSet.forEach(id => n.add(id)); return n; });
    } catch (e) { console.error('[Marketplace] Detail posts error:', e); }
    setLoadingDetailPosts(false);
  };

  const updateCommentInput = (postId: string, field: 'name' | 'text', value: string) => {
    setCommentInputs(prev => {
      const m = new Map<string, { name: string; text: string }>(prev);
      const cur: { name: string; text: string } = m.get(postId) || { name: '', text: '' };
      m.set(postId, { ...cur, [field]: value });
      return m;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">

      {/* ── Lead Capture Modal ──────────────────────────────────────── */}
      {showCapture && !leadCaptured && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-[32px] sm:rounded-[32px] w-full max-w-md p-8 space-y-5 animate-scaleUp border-t-4 sm:border-4 border-black">
            <div className="text-center">
              <p className="text-4xl mb-2">💈</p>
              <h2 className="text-xl font-black uppercase tracking-tight">Bem-vindo ao AZ</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">Encontre os melhores profissionais perto de você</p>
            </div>
            <div className="space-y-3">
              <input type="text" value={leadName} onChange={e => setLeadName(e.target.value)} placeholder="Seu nome" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <input type="tel" value={leadPhone} onChange={e => setLeadPhone(e.target.value)} placeholder="Seu WhatsApp (ex: 44999999999)" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <input type="text" value={leadCity} onChange={e => setLeadCity(e.target.value)} placeholder="Sua cidade" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <input type="password" value={leadPassword} onChange={e => setLeadPassword(e.target.value)} placeholder="Crie uma senha (mín. 4 caracteres)" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">O que você procura?</p>
                <div className="flex flex-wrap gap-2">
                  {nichoOptions.map(n => (
                    <button key={n} type="button" onClick={() => toggleNicho(n)} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${leadNichos.includes(n) ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
            {captureError && <p className="text-red-500 text-xs font-bold text-center">{captureError}</p>}
            <button onClick={handleCapture} disabled={!leadName.trim() || !leadPhone.trim() || leadPassword.length < 4} className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              Criar Conta
            </button>
            <button onClick={() => setShowCapture(false)} className="w-full text-center text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest py-1">
              Pular por agora
            </button>
          </div>
        </div>
      )}

      {/* ── Create Post Overlay ─────────────────────────────────────── */}
      {myTenantId && showCreatePost && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[150] flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-[32px] sm:rounded-[32px] w-full max-w-[470px] p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-black text-sm uppercase tracking-widest">Novo Post</h3>
              <button onClick={() => { setShowCreatePost(false); setNewPostFile(null); setNewPostPreview(''); setNewPostCaption(''); }} className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest">Cancelar</button>
            </div>
            <input ref={postFileRef} type="file" accept="image/*" onChange={handlePostFileSelect} className="hidden" />
            {newPostPreview ? (
              <div className="relative rounded-2xl overflow-hidden">
                <img src={newPostPreview} alt="Preview" className="w-full aspect-square object-cover" />
                <button onClick={() => { setNewPostFile(null); setNewPostPreview(''); if (postFileRef.current) postFileRef.current.value = ''; }} className="absolute top-3 right-3 w-8 h-8 bg-black/60 text-white rounded-full flex items-center justify-center font-black text-sm hover:bg-red-500 transition-all">✕</button>
              </div>
            ) : (
              <button onClick={() => postFileRef.current?.click()} className="w-full aspect-video rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-orange-400 transition-all">
                <span className="text-4xl text-slate-200">📷</span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selecionar foto</span>
                <span className="text-[9px] text-slate-300">JPG, PNG ou WebP. Max 2MB</span>
              </button>
            )}
            <textarea value={newPostCaption} onChange={e => setNewPostCaption(e.target.value)} placeholder="Escreva uma legenda... (opcional)" rows={2} className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 resize-none" />
            <button onClick={handleCreatePost} disabled={!newPostFile || creatingPost} className="w-full bg-orange-500 text-white py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {creatingPost ? 'Publicando...' : 'Publicar'}
            </button>
          </div>
        </div>
      )}

      {/* ── App Shell ───────────────────────────────────────────────── */}
      <div className="max-w-[470px] mx-auto min-h-screen bg-white relative">

        {/* ── Top Bar ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-40 bg-white border-b border-slate-100">
          <div className="flex items-center justify-between px-4 py-2.5">
            {/* Logo */}
            <div className="flex items-baseline gap-1">
              <span className="text-[22px] font-black tracking-tighter text-black leading-none">AZ</span>
              <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest">AgendeZap</span>
            </div>
            {/* Search bar on Explorar */}
            {activeTab === 'explorar' ? (
              <div className="flex-1 mx-3">
                <input
                  type="text"
                  value={searchCity}
                  onChange={e => setSearchCity(e.target.value)}
                  placeholder="🔍 Buscar cidade..."
                  className="w-full bg-slate-100 rounded-full px-4 py-2 text-sm font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-400 transition-all placeholder:text-slate-400 placeholder:font-normal"
                />
              </div>
            ) : (
              <div className="flex-1" />
            )}
            {/* Right icons */}
            <div className="flex items-center gap-1">
              {tenantSession && (
                <button onClick={() => setShowCreatePost(true)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-all">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
              )}
              <a href="#/minha-conta" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-all">
                {customerSession ? (
                  <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white text-[10px] font-black">
                    {customerSession.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                ) : tenantSession ? (
                  <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center text-white text-[10px] font-black">
                    {tenantSession.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                ) : (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </a>
            </div>
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────── */}
        <div className="pb-20">

          {/* ══ HOME TAB ══ */}
          {activeTab === 'home' && (
            <>
              {/* Stories */}
              {!loading && filteredTenants.length > 0 && (
                <div className="overflow-x-auto border-b border-slate-100" style={{ scrollbarWidth: 'none' }}>
                  <div className="flex gap-3 px-4 py-3" style={{ width: 'max-content' }}>
                    {filteredTenants.slice(0, 14).map(t => (
                      <button key={t.id} onClick={() => openTenantDetail(t)} className="flex flex-col items-center gap-1.5 shrink-0">
                        <div className="w-[62px] h-[62px] rounded-full p-[2.5px]" style={{ background: 'linear-gradient(45deg, #f97316, #ea580c, #1c1917)' }}>
                          <div className="w-full h-full rounded-full bg-white p-[2px]">
                            {galleries.get(t.id)?.[0] ? (
                              <img src={galleries.get(t.id)![0]} alt={t.name} className="w-full h-full rounded-full object-cover" />
                            ) : (
                              <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-white text-xs font-black">
                                {t.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-600 w-[66px] text-center truncate">{t.name.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Posts Feed */}
              {loadingPosts ? (
                <div className="text-center py-20">
                  <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
                </div>
              ) : posts.length === 0 ? (
                <div className="text-center py-20 px-8">
                  <p className="text-5xl mb-4">📷</p>
                  <p className="text-base font-black text-slate-400 uppercase tracking-wide">Nenhum post ainda</p>
                  <p className="text-sm text-slate-300 mt-2">{myTenantId ? 'Publique o primeiro post!' : 'Os profissionais compartilharão trabalhos em breve'}</p>
                </div>
              ) : (
                posts.map(post => {
                  const postAvatar = galleries.get(post.tenantId || '')?.[0];
                  const postInitials = (post.tenantName || '??').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <div key={post.id} className="bg-white border-b border-slate-100">
                      {/* Post header */}
                      <div className="flex items-center justify-between px-3 py-3">
                        <button onClick={() => { const t = tenants.find(x => x.id === post.tenantId); if (t) openTenantDetail(t); }} className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-200 shrink-0 bg-black flex items-center justify-center">
                            {postAvatar ? (
                              <img src={postAvatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-white text-[10px] font-black">{postInitials}</span>
                            )}
                          </div>
                          <div className="text-left">
                            <p className="text-[13px] font-black text-black leading-none">{post.tenantName || 'Profissional'}</p>
                            {(post.nicho || post.cidade) && (
                              <p className="text-[10px] text-slate-400 mt-0.5">{[post.nicho, post.cidade].filter(Boolean).join(' · ')}</p>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-300 font-medium">{timeAgo(post.createdAt)}</span>
                          {post.tenantId === myTenantId && (
                            <button onClick={() => deletePost(post.id)} className="text-slate-300 hover:text-red-500 transition-colors text-lg leading-none px-1">⋯</button>
                          )}
                        </div>
                      </div>

                      {/* Image */}
                      <div className="relative select-none" onContextMenu={e => e.preventDefault()} style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}>
                        <img src={post.imageUrl} alt="" className="w-full aspect-square object-cover pointer-events-none" draggable={false} style={{ WebkitUserDrag: 'none' } as React.CSSProperties} />
                        <div className="absolute inset-0" />
                      </div>

                      {/* Actions + Caption */}
                      <div className="px-3 pt-3 pb-4 space-y-2">
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleLike(post.id)} className="transition-transform active:scale-75">
                            {userLikes.has(post.id) ? (
                              <svg className="w-7 h-7 fill-red-500" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                            ) : (
                              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                            )}
                          </button>
                          <button onClick={() => toggleComments(post.id)}>
                            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                          </button>
                          <button onClick={() => { const t = tenants.find(x => x.id === post.tenantId); if (t) toggleFavorite(t.id); }} className="ml-auto">
                            <svg className="w-7 h-7" fill={post.tenantId && favorites.has(post.tenantId) ? 'currentColor' : 'none'} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>
                          </button>
                        </div>
                        {post.likesCount > 0 && <p className="text-[13px] font-black text-black">{post.likesCount} curtida{post.likesCount !== 1 ? 's' : ''}</p>}
                        {post.caption && (
                          <p className="text-[13px] text-black leading-snug">
                            <span className="font-black">{post.tenantName?.split(' ')[0]} </span>
                            {post.caption}
                          </p>
                        )}
                        {!expandedComments.has(post.id) && (commentsByPost.get(post.id) || []).length > 0 && (
                          <button onClick={() => toggleComments(post.id)} className="text-[12px] text-slate-400 font-medium">
                            Ver {(commentsByPost.get(post.id) || []).length} comentário{(commentsByPost.get(post.id) || []).length !== 1 ? 's' : ''}
                          </button>
                        )}
                        {expandedComments.has(post.id) && (
                          <div className="space-y-2 pt-1">
                            {(commentsByPost.get(post.id) || []).map(c => (
                              <div key={c.id} className="text-[13px]">
                                <span className="font-black text-black">{c.authorName} </span>
                                <span className="text-black">{c.content}</span>
                                <span className="text-[10px] text-slate-300 ml-2">{timeAgo(c.createdAt)}</span>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                              <input type="text" value={commentInputs.get(post.id)?.name || ''} onChange={e => updateCommentInput(post.id, 'name', e.target.value)} placeholder="Nome" className="w-20 text-[12px] font-bold border-b border-slate-200 focus:outline-none focus:border-orange-400 py-1 placeholder:text-slate-300" />
                              <input type="text" value={commentInputs.get(post.id)?.text || ''} onChange={e => updateCommentInput(post.id, 'text', e.target.value)} placeholder="Adicione um comentário..." className="flex-1 text-[12px] border-b border-slate-200 focus:outline-none focus:border-orange-400 py-1 placeholder:text-slate-300" onKeyDown={e => { if (e.key === 'Enter') submitComment(post.id); }} />
                              <button onClick={() => submitComment(post.id)} className="text-[12px] font-black text-orange-500 hover:text-orange-600 shrink-0">Publicar</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* ══ EXPLORAR TAB ══ */}
          {activeTab === 'explorar' && (
            <>
              {/* Nicho pills */}
              <div className="overflow-x-auto border-b border-slate-100" style={{ scrollbarWidth: 'none' }}>
                <div className="flex gap-2 px-4 py-3" style={{ width: 'max-content' }}>
                  <button onClick={() => setSearchNicho('')} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 transition-all ${!searchNicho ? 'bg-black text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Todos</button>
                  {nichoOptions.map(n => (
                    <button key={n} onClick={() => setSearchNicho(n === searchNicho ? '' : n)} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 transition-all ${searchNicho === n ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Grid */}
              {loading ? (
                <div className="text-center py-20">
                  <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
                </div>
              ) : filteredTenants.length === 0 ? (
                <div className="text-center py-20 px-8">
                  <p className="text-5xl mb-4">🔍</p>
                  <p className="text-base font-black text-slate-400">Nenhum resultado</p>
                  <p className="text-sm text-slate-300 mt-1">Tente mudar os filtros</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-[1.5px] mt-[1.5px]">
                  {filteredTenants.map((t, idx) => (
                    <button key={t.id} onClick={() => openTenantDetail(t)} className="aspect-square relative overflow-hidden bg-slate-100 group">
                      {galleries.get(t.id)?.[0] ? (
                        <img src={galleries.get(t.id)![0]} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-slate-700 to-black flex flex-col items-center justify-center gap-1">
                          <span className="text-white text-xl font-black">{t.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                          {t.rating > 0 && <span className="text-orange-400 text-[9px] font-black">★ {t.rating.toFixed(1)}</span>}
                        </div>
                      )}
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-2">
                        <p className="text-white text-[11px] font-black text-center leading-tight">{t.name.split(' ').slice(0, 2).join(' ')}</p>
                        {t.rating > 0 && <p className="text-orange-400 text-[11px] font-black">★ {t.rating.toFixed(1)}</p>}
                      </div>
                      {/* "Você" badge */}
                      {t.id === myTenantId && (
                        <div className="absolute top-1.5 left-1.5 bg-orange-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase">Você</div>
                      )}
                      {/* #1 badge */}
                      {idx === 0 && t.rating > 0 && (
                        <div className="absolute top-1.5 right-1.5 bg-yellow-400 text-black text-[7px] font-black px-1.5 py-0.5 rounded-full">#1</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Bottom Navigation ─────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 z-40 max-w-[470px] mx-auto">
          <div className="bg-white border-t border-slate-100 flex items-center justify-around py-2 px-4">
            {/* Home */}
            <button onClick={() => setActiveTab('home')} className="flex flex-col items-center py-1 px-4">
              {activeTab === 'home' ? (
                <svg className="w-6 h-6 fill-black" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#94a3b8"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
              )}
            </button>

            {/* Explorar */}
            <button onClick={() => setActiveTab('explorar')} className="flex flex-col items-center py-1 px-4">
              {activeTab === 'explorar' ? (
                <svg className="w-6 h-6 fill-black" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#94a3b8"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
              )}
            </button>

            {/* Create Post (tenant only) */}
            {myTenantId && (
              <button onClick={() => setShowCreatePost(true)} className="flex items-center justify-center w-10 h-10 rounded-xl border-2 border-black hover:bg-black hover:text-white transition-all group">
                <svg className="w-5 h-5 group-hover:stroke-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            )}

            {/* Account */}
            <a href="#/minha-conta" className="flex flex-col items-center py-1 px-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={customerSession || tenantSession ? 'currentColor' : '#94a3b8'}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* ── Tenant Detail Modal ──────────────────────────────────────── */}
      {selectedTenant && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-[28px] sm:rounded-[28px] w-full max-w-[470px] overflow-hidden animate-scaleUp max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-black via-slate-800 to-orange-500 p-5 relative shrink-0">
              <button onClick={() => setSelectedTenant(null)} className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center font-black text-sm transition-all">✕</button>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-white text-black flex items-center justify-center text-lg font-black shrink-0">
                  {selectedTenant.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-black text-white uppercase tracking-tight">{selectedTenant.name}</h2>
                  {selectedTenant.nicho && <span className="inline-block mt-0.5 text-[8px] font-black px-2 py-0.5 rounded-full bg-orange-500 text-white uppercase tracking-widest">{selectedTenant.nicho}</span>}
                  {selectedTenant.rating > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-orange-400 text-xs">{stars(selectedTenant.rating)}</span>
                      <span className="text-[10px] font-black text-slate-300">{selectedTenant.rating}/10 ({selectedTenant.reviewCount})</span>
                    </div>
                  )}
                </div>
              </div>
              {selectedTenant.endereco && <p className="text-xs text-slate-300 font-bold mt-2">📍 {selectedTenant.endereco}{selectedTenant.cidade ? `, ${selectedTenant.cidade}` : ''}{selectedTenant.estado ? ` - ${selectedTenant.estado}` : ''}</p>}
              {selectedTenant.descricao && <p className="text-xs text-slate-300 mt-1">{selectedTenant.descricao}</p>}
            </div>

            {/* Detail Tabs */}
            <div className="flex gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
              <button onClick={() => setDetailTab('agendar')} className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${detailTab === 'agendar' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Agendar</button>
              <button onClick={() => setDetailTab('posts')} className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${detailTab === 'posts' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Posts {detailPosts.length > 0 && `(${detailPosts.length})`}</button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 p-4">
              {detailTab === 'agendar' && (
                <div className="space-y-4">
                  {(galleries.get(selectedTenant.id) || []).length > 0 && (
                    <div className={`grid ${(galleries.get(selectedTenant.id) || []).length === 1 ? 'grid-cols-1' : (galleries.get(selectedTenant.id) || []).length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-2 rounded-2xl overflow-hidden`}>
                      {(galleries.get(selectedTenant.id) || []).map((url: string, i: number) => (
                        <div key={i} className="aspect-square overflow-hidden"><img src={url} alt="" className="w-full h-full object-cover" /></div>
                      ))}
                    </div>
                  )}
                  <div className="text-center py-4 space-y-3">
                    <p className="text-sm font-bold text-slate-500">Agende agora com {selectedTenant.name}</p>
                    <a href={`#/agendar/${selectedTenant.slug}`} className="block w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all text-center">Agendar Horário</a>
                    <button onClick={e => { e.stopPropagation(); toggleFavorite(selectedTenant.id); }} className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-slate-100 hover:bg-red-50 transition-all text-sm font-bold text-slate-600">
                      <span className="text-lg">{favorites.has(selectedTenant.id) ? '❤️' : '🤍'}</span>
                      {favorites.has(selectedTenant.id) ? 'Favoritado' : 'Favoritar'}
                    </button>
                  </div>
                </div>
              )}

              {detailTab === 'posts' && (
                <div className="space-y-4">
                  {loadingDetailPosts ? (
                    <div className="text-center py-12"><div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" /></div>
                  ) : detailPosts.length === 0 ? (
                    <div className="text-center py-12"><p className="text-4xl mb-3">📷</p><p className="text-sm font-black text-slate-400">Nenhum post ainda</p></div>
                  ) : (
                    detailPosts.map(post => (
                      <div key={post.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                        <div className="relative select-none" onContextMenu={e => e.preventDefault()} style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}>
                          <img src={post.imageUrl} alt="" className="w-full aspect-square object-cover pointer-events-none" draggable={false} style={{ WebkitUserDrag: 'none' } as React.CSSProperties} />
                          <div className="absolute inset-0" />
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          <div className="flex items-center gap-4">
                            <button onClick={() => handleLike(post.id)} className="flex items-center gap-1.5 transition-transform active:scale-75">
                              <span className="text-xl">{userLikes.has(post.id) ? '❤️' : '🤍'}</span>
                              <span className="text-xs font-black text-slate-600">{post.likesCount}</span>
                            </button>
                            <button onClick={() => toggleComments(post.id)} className="flex items-center gap-1.5">
                              <span className="text-xl">💬</span>
                              <span className="text-xs font-black text-slate-400">{(commentsByPost.get(post.id) || []).length || ''}</span>
                            </button>
                            <span className="text-[10px] font-bold text-slate-300 ml-auto">{timeAgo(post.createdAt)}</span>
                          </div>
                          {post.caption && <p className="text-sm text-black"><span className="font-black">{post.tenantName?.split(' ')[0]} </span>{post.caption}</p>}
                          {expandedComments.has(post.id) && (
                            <div className="space-y-2 pt-2 border-t border-slate-100">
                              {(commentsByPost.get(post.id) || []).map(c => (
                                <div key={c.id} className="text-sm"><span className="font-black">{c.authorName} </span><span className="text-slate-600">{c.content}</span><span className="text-[9px] text-slate-300 ml-2">{timeAgo(c.createdAt)}</span></div>
                              ))}
                              <div className="flex gap-2 pt-1">
                                <input type="text" value={commentInputs.get(post.id)?.name || ''} onChange={e => updateCommentInput(post.id, 'name', e.target.value)} placeholder="Nome" className="w-24 border-b border-slate-200 text-xs font-bold focus:outline-none focus:border-orange-400 py-1" />
                                <input type="text" value={commentInputs.get(post.id)?.text || ''} onChange={e => updateCommentInput(post.id, 'text', e.target.value)} placeholder="Comentar..." className="flex-1 border-b border-slate-200 text-xs focus:outline-none focus:border-orange-400 py-1" onKeyDown={e => { if (e.key === 'Enter') submitComment(post.id); }} />
                                <button onClick={() => submitComment(post.id)} className="text-[11px] font-black text-orange-500 hover:text-orange-600">Publicar</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketplacePage;
