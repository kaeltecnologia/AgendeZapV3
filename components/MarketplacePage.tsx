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
  const [activeTab, setActiveTab] = useState<'perfis' | 'posts'>('perfis');

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
    if (activeTab !== 'posts') return;
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
    <div className="min-h-screen bg-slate-50">
      {/* ── Lead Capture Modal ────────────────────────────────── */}
      {showCapture && !leadCaptured && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-6 animate-scaleUp border-4 border-black">
            <div className="text-center">
              <p className="text-4xl mb-3">💈</p>
              <h2 className="text-2xl font-black uppercase tracking-tight">Bem-vindo ao AgendeZap</h2>
              <p className="text-xs font-bold text-slate-400 mt-2">Encontre os melhores profissionais perto de você</p>
            </div>
            <div className="space-y-4">
              <input type="text" value={leadName} onChange={e => setLeadName(e.target.value)} placeholder="Seu nome" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <input type="tel" value={leadPhone} onChange={e => setLeadPhone(e.target.value)} placeholder="Seu WhatsApp (ex: 44999999999)" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <input type="text" value={leadCity} onChange={e => setLeadCity(e.target.value)} placeholder="Sua cidade" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <input type="password" value={leadPassword} onChange={e => setLeadPassword(e.target.value)} placeholder="Crie uma senha (mín. 4 caracteres)" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-orange-400" />
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">O que você procura?</p>
                <div className="flex flex-wrap gap-2">
                  {nichoOptions.map(n => (
                    <button key={n} type="button" onClick={() => toggleNicho(n)}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${leadNichos.includes(n) ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >{n}</button>
                  ))}
                </div>
              </div>
            </div>
            {captureError && <p className="text-red-500 text-xs font-bold text-center">{captureError}</p>}
            <button onClick={handleCapture} disabled={!leadName.trim() || !leadPhone.trim() || leadPassword.length < 4} className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              Criar Conta
            </button>
          </div>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="bg-black text-white">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex-1" />
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-orange-500 mb-2">Marketplace</p>
              <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">AgendeZap</h1>
              <p className="text-sm text-slate-400 font-bold mt-2">Encontre e agende com os melhores profissionais</p>
            </div>
            <div className="flex-1 flex justify-end">
              {tenantSession ? (
                <button
                  onClick={() => { setActiveTab('posts'); setShowCreatePost(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-orange-500 transition-all text-white text-[10px] font-black uppercase tracking-widest"
                >
                  <span className="text-base">👤</span>
                  {tenantSession.name.split(' ')[0] || 'Meu Perfil'}
                </button>
              ) : (
                <a href="#/minha-conta" className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-orange-500 transition-all text-white text-[10px] font-black uppercase tracking-widest">
                  <span className="text-base">👤</span>
                  {customerSession ? customerSession.name.split(' ')[0] : 'Minha Conta'}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Filters + Tabs ───────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 -mt-4">
        <div className="bg-white rounded-2xl shadow-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input type="text" value={searchCity} onChange={e => setSearchCity(e.target.value)} placeholder="Cidade..." className="flex-1 border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400" />
            <select value={searchNicho} onChange={e => setSearchNicho(e.target.value)} className="border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 bg-white">
              <option value="">Todos os nichos</option>
              {nichos.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {/* Tab bar */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('perfis')}
              className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'perfis' ? 'bg-black text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
            >
              Perfis
            </button>
            <button
              onClick={() => setActiveTab('posts')}
              className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'posts' ? 'bg-black text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
            >
              Posts
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

        {/* ═══ TAB: PERFIS ═══ */}
        {activeTab === 'perfis' && (
          <>
            {loading ? (
              <div className="text-center py-20">
                <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Carregando...</p>
              </div>
            ) : filteredTenants.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-4xl mb-4">🔍</p>
                <p className="text-lg font-black text-slate-400">Nenhum estabelecimento encontrado</p>
                <p className="text-sm text-slate-300 mt-2">Tente mudar os filtros</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredTenants.map(t => (
                  <div key={t.id} onClick={() => openTenantDetail(t)} className={`bg-white rounded-3xl border-2 overflow-hidden hover:border-orange-400 hover:shadow-xl hover:shadow-orange-100/50 transition-all group cursor-pointer ${t.id === myTenantId ? 'border-orange-300 ring-2 ring-orange-100' : 'border-slate-100'}`}>
                    {(galleries.get(t.id) || []).length > 0 && (() => {
                      const photos = galleries.get(t.id)!;
                      return (
                        <div className={`grid ${photos.length === 1 ? 'grid-cols-1' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-[2px]`}>
                          {photos.map((url, i) => (
                            <div key={i} className="aspect-square overflow-hidden">
                              <img src={url} alt="" className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="p-6 space-y-4">
                      {t.id === myTenantId && <span className="inline-block text-[8px] font-black px-3 py-1 rounded-full bg-orange-500 text-white uppercase tracking-widest">Seu Perfil</span>}
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-black uppercase tracking-tight group-hover:text-orange-500 transition-colors">{t.name}</h3>
                          {t.nicho && <span className="inline-block mt-1 text-[8px] font-black px-3 py-1 rounded-full bg-slate-100 text-slate-500 uppercase tracking-widest">{t.nicho}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={e => { e.stopPropagation(); toggleFavorite(t.id); }} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-red-50 transition-all" title={favorites.has(t.id) ? 'Remover favorito' : 'Favoritar'}>
                            <span className="text-xl">{favorites.has(t.id) ? '❤️' : '🤍'}</span>
                          </button>
                          <div className="text-3xl">💈</div>
                        </div>
                      </div>
                      {t.rating > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-orange-400 text-sm">{stars(t.rating)}</span>
                          <span className="text-[10px] font-black text-slate-400">{t.rating}/10 ({t.reviewCount})</span>
                        </div>
                      )}
                      {t.endereco && <p className="text-xs text-slate-400 font-bold flex items-center gap-1">📍 {t.endereco}{t.cidade ? `, ${t.cidade}` : ''}{t.estado ? ` - ${t.estado}` : ''}</p>}
                      {t.descricao && <p className="text-xs text-slate-500 font-bold line-clamp-2">{t.descricao}</p>}
                      <button onClick={e => { e.stopPropagation(); openTenantDetail(t); }} className="block w-full text-center bg-orange-500 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Ver Perfil</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ TAB: POSTS ═══ */}
        {activeTab === 'posts' && (
          <div className="max-w-lg mx-auto space-y-6">

            {/* Create Post (tenant only) */}
            {myTenantId && (
              <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
                {!showCreatePost ? (
                  <button onClick={() => setShowCreatePost(true)} className="w-full py-4 rounded-2xl border-2 border-dashed border-slate-200 text-sm font-black text-slate-400 hover:border-orange-400 hover:text-orange-500 transition-all">
                    + Criar novo post
                  </button>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="font-black text-black text-sm uppercase tracking-widest">Novo Post</h3>
                      <button onClick={() => { setShowCreatePost(false); setNewPostFile(null); setNewPostPreview(''); setNewPostCaption(''); }} className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest">Cancelar</button>
                    </div>
                    <input ref={postFileRef} type="file" accept="image/*" onChange={handlePostFileSelect} className="hidden" />
                    {newPostPreview ? (
                      <div className="relative rounded-2xl overflow-hidden">
                        <img src={newPostPreview} alt="Preview" className="w-full aspect-square object-cover" />
                        <button onClick={() => { setNewPostFile(null); setNewPostPreview(''); if (postFileRef.current) postFileRef.current.value = ''; }} className="absolute top-3 right-3 w-8 h-8 bg-black/60 text-white rounded-full flex items-center justify-center font-black text-sm hover:bg-red-500 transition-all">X</button>
                      </div>
                    ) : (
                      <button onClick={() => postFileRef.current?.click()} className="w-full aspect-video rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-orange-400 transition-all">
                        <span className="text-4xl text-slate-200">📷</span>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selecionar foto</span>
                        <span className="text-[9px] text-slate-300">JPG, PNG ou WebP. Max 2MB</span>
                      </button>
                    )}
                    <textarea value={newPostCaption} onChange={e => setNewPostCaption(e.target.value)} placeholder="Escreva uma legenda... (opcional)" rows={2} className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 resize-none" />
                    <button onClick={handleCreatePost} disabled={!newPostFile || creatingPost} className="w-full bg-orange-500 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      {creatingPost ? 'Publicando...' : 'Publicar'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Posts Feed */}
            {loadingPosts ? (
              <div className="text-center py-20">
                <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Carregando posts...</p>
              </div>
            ) : posts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-4xl mb-4">📷</p>
                <p className="text-lg font-black text-slate-400">Nenhum post ainda</p>
                <p className="text-sm text-slate-300 mt-2">{myTenantId ? 'Seja o primeiro a publicar!' : 'Em breve os profissionais compartilharão seus trabalhos aqui'}</p>
              </div>
            ) : (
              posts.map(post => (
                <div key={post.id} className="bg-white rounded-3xl border-2 border-slate-100 overflow-hidden">
                  {/* Post Header */}
                  <div className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-xs font-black">
                        {(post.tenantName || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-black text-black">{post.tenantName || 'Profissional'}</p>
                        {post.nicho && <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{post.nicho}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-300">{timeAgo(post.createdAt)}</span>
                      {post.tenantId === myTenantId && (
                        <button onClick={() => deletePost(post.id)} className="text-[10px] font-black text-red-400 hover:text-red-600 uppercase" title="Excluir">X</button>
                      )}
                    </div>
                  </div>

                  {/* Post Image (protected) */}
                  <div
                    className="relative select-none"
                    onContextMenu={e => e.preventDefault()}
                    style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
                  >
                    <img src={post.imageUrl} alt="" className="w-full aspect-square object-cover pointer-events-none" draggable={false} style={{ WebkitUserDrag: 'none' } as React.CSSProperties} />
                    <div className="absolute inset-0" />
                  </div>

                  {/* Actions */}
                  <div className="px-5 py-3 space-y-3">
                    <div className="flex items-center gap-4">
                      <button onClick={() => handleLike(post.id)} className="flex items-center gap-1.5 hover:scale-105 transition-transform">
                        <span className="text-xl">{userLikes.has(post.id) ? '❤️' : '🤍'}</span>
                        <span className="text-xs font-black text-slate-600">{post.likesCount}</span>
                      </button>
                      <button onClick={() => toggleComments(post.id)} className="flex items-center gap-1.5 hover:scale-105 transition-transform">
                        <span className="text-xl">💬</span>
                        <span className="text-xs font-black text-slate-400">{(commentsByPost.get(post.id) || []).length || ''}</span>
                      </button>
                    </div>

                    {/* Caption */}
                    {post.caption && (
                      <p className="text-sm text-slate-700">
                        <span className="font-black">{post.tenantName?.split(' ')[0]} </span>
                        {post.caption}
                      </p>
                    )}

                    {/* Location */}
                    {post.cidade && <p className="text-[10px] text-slate-400 font-bold">📍 {post.cidade}</p>}

                    {/* Comments Section */}
                    {expandedComments.has(post.id) && (
                      <div className="space-y-3 pt-2 border-t border-slate-100">
                        {(commentsByPost.get(post.id) || []).map(c => (
                          <div key={c.id} className="text-sm">
                            <span className="font-black text-slate-700">{c.authorName} </span>
                            <span className="text-slate-600">{c.content}</span>
                            <span className="text-[9px] text-slate-300 ml-2">{timeAgo(c.createdAt)}</span>
                          </div>
                        ))}
                        {/* Comment Input */}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={commentInputs.get(post.id)?.name || ''}
                            onChange={e => updateCommentInput(post.id, 'name', e.target.value)}
                            placeholder="Nome"
                            className="w-24 border border-slate-100 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-orange-400"
                          />
                          <input
                            type="text"
                            value={commentInputs.get(post.id)?.text || ''}
                            onChange={e => updateCommentInput(post.id, 'text', e.target.value)}
                            placeholder="Comentar..."
                            className="flex-1 border border-slate-100 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-orange-400"
                            onKeyDown={e => { if (e.key === 'Enter') submitComment(post.id); }}
                          />
                          <button onClick={() => submitComment(post.id)} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[9px] font-black uppercase hover:bg-black transition-all">
                            Enviar
                          </button>
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

      {/* ── Tenant Detail Modal ─────────────────────────────── */}
      {selectedTenant && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl my-8 overflow-hidden animate-scaleUp">
            {/* Detail Header */}
            <div className="bg-gradient-to-r from-black via-slate-800 to-orange-500 p-6 relative">
              <button onClick={() => setSelectedTenant(null)} className="absolute top-4 right-4 w-9 h-9 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center font-black text-sm transition-all">X</button>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-white text-black flex items-center justify-center text-xl font-black shrink-0">
                  {selectedTenant.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-xl font-black text-white uppercase tracking-tight">{selectedTenant.name}</h2>
                  {selectedTenant.nicho && <span className="inline-block mt-1 text-[8px] font-black px-3 py-1 rounded-full bg-orange-500 text-white uppercase tracking-widest">{selectedTenant.nicho}</span>}
                  {selectedTenant.rating > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-orange-400 text-sm">{stars(selectedTenant.rating)}</span>
                      <span className="text-[10px] font-black text-slate-300">{selectedTenant.rating}/10 ({selectedTenant.reviewCount})</span>
                    </div>
                  )}
                </div>
              </div>
              {selectedTenant.endereco && <p className="text-xs text-slate-300 font-bold mt-3 flex items-center gap-1">📍 {selectedTenant.endereco}{selectedTenant.cidade ? `, ${selectedTenant.cidade}` : ''}{selectedTenant.estado ? ` - ${selectedTenant.estado}` : ''}</p>}
              {selectedTenant.descricao && <p className="text-xs text-slate-300 font-bold mt-2">{selectedTenant.descricao}</p>}
            </div>

            {/* Detail Tabs */}
            <div className="flex gap-2 p-4 border-b border-slate-100">
              <button onClick={() => setDetailTab('agendar')} className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${detailTab === 'agendar' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                Agendar
              </button>
              <button onClick={() => setDetailTab('posts')} className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${detailTab === 'posts' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                Posts {detailPosts.length > 0 && `(${detailPosts.length})`}
              </button>
            </div>

            {/* Detail Content */}
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {detailTab === 'agendar' && (
                <div className="space-y-4">
                  {/* Gallery */}
                  {(galleries.get(selectedTenant.id) || []).length > 0 && (
                    <div className={`grid ${(galleries.get(selectedTenant.id) || []).length === 1 ? 'grid-cols-1' : (galleries.get(selectedTenant.id) || []).length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-2 rounded-2xl overflow-hidden`}>
                      {(galleries.get(selectedTenant.id) || []).map((url, i) => (
                        <div key={i} className="aspect-square overflow-hidden">
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-center py-6 space-y-4">
                    <p className="text-sm font-bold text-slate-500">Agende agora com {selectedTenant.name}</p>
                    <a href={`#/agendar/${selectedTenant.slug}`} className="inline-block w-full max-w-sm bg-orange-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all text-center">
                      Agendar Horário
                    </a>
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
                    <div className="text-center py-12">
                      <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Carregando posts...</p>
                    </div>
                  ) : detailPosts.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-4xl mb-4">📷</p>
                      <p className="text-sm font-black text-slate-400">Nenhum post ainda</p>
                    </div>
                  ) : (
                    detailPosts.map(post => (
                      <div key={post.id} className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden">
                        {/* Post Image (protected) */}
                        <div className="relative select-none" onContextMenu={e => e.preventDefault()} style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}>
                          <img src={post.imageUrl} alt="" className="w-full aspect-square object-cover pointer-events-none" draggable={false} style={{ WebkitUserDrag: 'none' } as React.CSSProperties} />
                          <div className="absolute inset-0" />
                        </div>
                        {/* Actions */}
                        <div className="px-4 py-3 space-y-2">
                          <div className="flex items-center gap-4">
                            <button onClick={() => handleLike(post.id)} className="flex items-center gap-1.5 hover:scale-105 transition-transform">
                              <span className="text-xl">{userLikes.has(post.id) ? '❤️' : '🤍'}</span>
                              <span className="text-xs font-black text-slate-600">{post.likesCount}</span>
                            </button>
                            <button onClick={() => toggleComments(post.id)} className="flex items-center gap-1.5 hover:scale-105 transition-transform">
                              <span className="text-xl">💬</span>
                              <span className="text-xs font-black text-slate-400">{(commentsByPost.get(post.id) || []).length || ''}</span>
                            </button>
                            <span className="text-[10px] font-bold text-slate-300 ml-auto">{timeAgo(post.createdAt)}</span>
                          </div>
                          {post.caption && (
                            <p className="text-sm text-slate-700">
                              <span className="font-black">{post.tenantName?.split(' ')[0]} </span>
                              {post.caption}
                            </p>
                          )}
                          {/* Comments */}
                          {expandedComments.has(post.id) && (
                            <div className="space-y-3 pt-2 border-t border-slate-100">
                              {(commentsByPost.get(post.id) || []).map(c => (
                                <div key={c.id} className="text-sm">
                                  <span className="font-black text-slate-700">{c.authorName} </span>
                                  <span className="text-slate-600">{c.content}</span>
                                  <span className="text-[9px] text-slate-300 ml-2">{timeAgo(c.createdAt)}</span>
                                </div>
                              ))}
                              <div className="flex gap-2">
                                <input type="text" value={commentInputs.get(post.id)?.name || ''} onChange={e => updateCommentInput(post.id, 'name', e.target.value)} placeholder="Nome" className="w-24 border border-slate-100 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-orange-400" />
                                <input type="text" value={commentInputs.get(post.id)?.text || ''} onChange={e => updateCommentInput(post.id, 'text', e.target.value)} placeholder="Comentar..." className="flex-1 border border-slate-100 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-orange-400" onKeyDown={e => { if (e.key === 'Enter') submitComment(post.id); }} />
                                <button onClick={() => submitComment(post.id)} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[9px] font-black uppercase hover:bg-black transition-all">Enviar</button>
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

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="bg-black text-white py-8">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
            Powered by AgendeZap
          </p>
        </div>
      </div>
    </div>
  );
};

export default MarketplacePage;
