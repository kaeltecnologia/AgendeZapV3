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
import { Tenant, CustomerAccount, MarketplacePost, MarketplacePostComment, MarketplaceStory } from '../types';

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

  // Lead capture / registration — skip entirely for tenant sessions
  const [showCapture, setShowCapture] = useState(() => {
    if (localStorage.getItem('agz_customer')) return false;
    if (localStorage.getItem('agz_session')) return false;
    try {
      const hq = window.location.hash.split('?')[1];
      if (hq && new URLSearchParams(hq).get('tid')) return false;
    } catch {}
    return true;
  });
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
  const [detailTab, setDetailTab] = useState<'grid' | 'agendar'>('grid');
  const [detailPosts, setDetailPosts] = useState<MarketplacePost[]>([]);
  const [loadingDetailPosts, setLoadingDetailPosts] = useState(false);

  // Follow system
  const [tenantFollowersMap, setTenantFollowersMap] = useState<Map<string, number>>(new Map());
  const [followedTenants, setFollowedTenants] = useState<Set<string>>(new Set());

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
  const lastTapRef = useRef<Map<string, number>>(new Map());

  // Stories
  const storyFileRef = useRef<HTMLInputElement>(null);
  const storyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeStoriesMap, setActiveStoriesMap] = useState<Map<string, MarketplaceStory[]>>(new Map());
  const [storyViewer, setStoryViewer] = useState<{ tenantId: string; stories: MarketplaceStory[]; idx: number } | null>(null);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const [newStoryFile, setNewStoryFile] = useState<File | null>(null);
  const [newStoryPreview, setNewStoryPreview] = useState('');
  const [newStoryCaption, setNewStoryCaption] = useState('');
  const [creatingStory, setCreatingStory] = useState(false);
  const [storyProgressPct, setStoryProgressPct] = useState(0);

  // Dopamine animations
  const [likeAnims, setLikeAnims] = useState<Set<string>>(new Set());
  const [doubleTapAnims, setDoubleTapAnims] = useState<Set<string>>(new Set());
  const [bookingConfetti, setBookingConfetti] = useState(false);

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
        db.getActiveStories(withRatings.map(t => t.id)).then(sm => setActiveStoriesMap(sm)).catch(() => {});
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
      if (liked) {
        setLikeAnims(prev => new Set(prev).add(postId));
        setTimeout(() => setLikeAnims(prev => { const n = new Set(prev); n.delete(postId); return n; }), 900);
      }
    } catch (e) { console.error('[Marketplace] Like error:', e); }
  };

  const handleImageTap = (postId: string) => {
    const now = Date.now();
    const last = lastTapRef.current.get(postId) || 0;
    if (now - last < 320) {
      if (!userLikes.has(postId)) handleLike(postId);
      setDoubleTapAnims(prev => new Set(prev).add(postId));
      setTimeout(() => setDoubleTapAnims(prev => { const n = new Set(prev); n.delete(postId); return n; }), 900);
    }
    lastTapRef.current.set(postId, now);
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

  // ── Followers helper ─────────────────────────────────────────────
  const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n);

  const handleFollow = async () => {
    if (!selectedTenant) return;
    try {
      const { followed, followersCount } = await db.toggleTenantFollow(selectedTenant.id, likerId);
      setTenantFollowersMap(prev => new Map(prev).set(selectedTenant.id, followersCount));
      setFollowedTenants(prev => { const n = new Set(prev); followed ? n.add(selectedTenant.id) : n.delete(selectedTenant.id); return n; });
    } catch (e) { console.error('[Marketplace] Follow error:', e); }
  };

  // ── Stories ──────────────────────────────────────────────────────
  const openStory = (tenantId: string) => {
    const stories = activeStoriesMap.get(tenantId);
    if (!stories?.length) return;
    setStoryViewer({ tenantId, stories, idx: 0 });
  };

  const advanceStory = (dir: 1 | -1) => {
    setStoryViewer(prev => {
      if (!prev) return null;
      const newIdx = prev.idx + dir;
      if (newIdx < 0 || newIdx >= prev.stories.length) return null;
      return { ...prev, idx: newIdx };
    });
  };

  const handleStoryFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Selecione uma imagem.'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Máximo 5MB.'); return; }
    setNewStoryFile(file);
    setNewStoryPreview(URL.createObjectURL(file));
  };

  const handleCreateStory = async () => {
    if (!newStoryFile || !myTenantId) return;
    setCreatingStory(true);
    try {
      const ext = newStoryFile.name.split('.').pop() || 'jpg';
      const path = `stories/${myTenantId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('marketplace').upload(path, newStoryFile, { upsert: true, contentType: newStoryFile.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('marketplace').getPublicUrl(path);
      const url = data.publicUrl + '?t=' + Date.now();
      const story = await db.createStory(myTenantId, url, newStoryCaption.trim() || undefined);
      const prevStories = activeStoriesMap.get(myTenantId) || [];
      const updatedStories = [...prevStories, story];
      setActiveStoriesMap(prev => new Map(prev).set(myTenantId, updatedStories));
      setNewStoryFile(null); setNewStoryPreview(''); setNewStoryCaption('');
      setShowCreateStory(false);
      if (storyFileRef.current) storyFileRef.current.value = '';
      setStoryViewer({ tenantId: myTenantId, stories: updatedStories, idx: updatedStories.length - 1 });
    } catch (err) {
      console.error('[Marketplace] Create story error:', err);
      alert('Erro ao publicar story. Tente novamente.');
    }
    setCreatingStory(false);
  };

  // Auto-advance story
  const currentStoryKey = storyViewer ? storyViewer.stories[storyViewer.idx]?.id : null;
  useEffect(() => {
    if (storyTimerRef.current) clearInterval(storyTimerRef.current);
    if (!currentStoryKey) { setStoryProgressPct(0); return; }
    setStoryProgressPct(0);
    let elapsed = 0;
    const total = 5000;
    const step = 50;
    storyTimerRef.current = setInterval(() => {
      elapsed += step;
      setStoryProgressPct(Math.min(100, (elapsed / total) * 100));
      if (elapsed >= total) {
        clearInterval(storyTimerRef.current!);
        setStoryViewer(prev => {
          if (!prev) return null;
          const newIdx = prev.idx + 1;
          if (newIdx >= prev.stories.length) return null;
          return { ...prev, idx: newIdx };
        });
      }
    }, step);
    return () => { if (storyTimerRef.current) clearInterval(storyTimerRef.current); };
  }, [currentStoryKey]);

  // ── Tenant Detail ────────────────────────────────────────────────
  const openTenantDetail = async (t: TenantCard) => {
    setSelectedTenant(t);
    setDetailTab('grid');
    setDetailPosts([]);
    setLoadingDetailPosts(true);
    try {
      const [tPosts, followersCount, followedSet] = await Promise.all([
        db.getPostsByTenant(t.id).then(p => db.enrichPostsWithTenantInfo(p)),
        db.getTenantFollowersCount(t.id),
        db.getFollowedTenants(likerId, [t.id]),
      ]);
      setDetailPosts(tPosts);
      setTenantFollowersMap(prev => new Map(prev).set(t.id, followersCount));
      setFollowedTenants(prev => { const n = new Set(prev); followedSet.has(t.id) ? n.add(t.id) : n.delete(t.id); return n; });
      const likedSet = await db.getPostLikesByUser(likerId, tPosts.map(p => p.id));
      setUserLikes(prev => { const n = new Set(prev); likedSet.forEach(id => n.add(id)); return n; });
    } catch (e) { console.error('[Marketplace] Detail error:', e); }
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
      <style>{`
        @keyframes heartBurst { 0% { transform:scale(0); opacity:1; } 15% { transform:scale(1.5); opacity:1; } 80% { transform:scale(1.1); opacity:1; } 100% { transform:scale(0.9); opacity:0; } }
        @keyframes flyUp1 { 0% { opacity:1; transform:translate(0,0) scale(0.5); } 100% { opacity:0; transform:translate(-28px,-60px) scale(1); } }
        @keyframes flyUp2 { 0% { opacity:1; transform:translate(0,0) scale(0.5); } 100% { opacity:0; transform:translate(22px,-72px) scale(0.8); } }
        @keyframes flyUp3 { 0% { opacity:1; transform:translate(0,0) scale(0.5); } 100% { opacity:0; transform:translate(-8px,-84px) scale(0.6); } }
        @keyframes flyUp4 { 0% { opacity:1; transform:translate(0,0) scale(0.5); } 100% { opacity:0; transform:translate(40px,-55px) scale(0.9); } }
        @keyframes flyUp5 { 0% { opacity:1; transform:translate(0,0) scale(0.5); } 100% { opacity:0; transform:translate(-44px,-40px) scale(0.7); } }
        @keyframes confettiFly { 0% { opacity:1; transform:translateY(0) rotate(0deg) scale(1); } 60% { opacity:1; } 100% { opacity:0; transform:translateY(-90px) rotate(720deg) scale(0.5); } }
        @keyframes storyFadeIn { 0% { opacity:0; transform:scale(1.03); } 100% { opacity:1; transform:scale(1); } }
      `}</style>

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

      {/* ── Create Story Overlay ────────────────────────────────────── */}
      {myTenantId && showCreateStory && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[150] flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-[32px] sm:rounded-[32px] w-full max-w-[470px] p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-black text-black text-sm uppercase tracking-widest">Novo Story</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Visível por 24 horas</p>
              </div>
              <button onClick={() => { setShowCreateStory(false); setNewStoryFile(null); setNewStoryPreview(''); setNewStoryCaption(''); }} className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest">Cancelar</button>
            </div>
            <input ref={storyFileRef} type="file" accept="image/*" onChange={handleStoryFileSelect} className="hidden" />
            {newStoryPreview ? (
              <div className="relative rounded-2xl overflow-hidden">
                <img src={newStoryPreview} alt="Preview" className="w-full aspect-[9/16] object-cover" />
                <button onClick={() => { setNewStoryFile(null); setNewStoryPreview(''); if (storyFileRef.current) storyFileRef.current.value = ''; }} className="absolute top-3 right-3 w-8 h-8 bg-black/60 text-white rounded-full flex items-center justify-center font-black text-sm hover:bg-red-500 transition-all">✕</button>
              </div>
            ) : (
              <button onClick={() => storyFileRef.current?.click()} className="w-full aspect-[9/16] rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-orange-400 transition-all">
                <span className="text-4xl text-slate-200">📱</span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selecionar foto</span>
                <span className="text-[9px] text-slate-300">Formato vertical recomendado · Max 5MB</span>
              </button>
            )}
            <textarea value={newStoryCaption} onChange={e => setNewStoryCaption(e.target.value)} placeholder="Legenda do story... (opcional)" rows={2} className="w-full border-2 border-slate-100 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-orange-400 resize-none" />
            <button onClick={handleCreateStory} disabled={!newStoryFile || creatingStory} className="w-full bg-orange-500 text-white py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {creatingStory ? 'Publicando...' : 'Publicar Story'}
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
              {tenantSession ? (
                <button onClick={() => { const t = tenants.find(x => x.id === myTenantId); if (t) openTenantDetail(t); }} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-all">
                  <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center text-white text-[10px] font-black">
                    {tenantSession.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                </button>
              ) : (
                <a href="#/minha-conta" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 transition-all">
                  {customerSession ? (
                    <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white text-[10px] font-black">
                      {customerSession.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </a>
              )}
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
                    {filteredTenants.slice(0, 14).map(t => {
                      const hasStory = activeStoriesMap.has(t.id);
                      const isOwn = t.id === myTenantId;
                      const handleStoryClick = () => {
                        if (hasStory) openStory(t.id);
                        else if (isOwn) setShowCreateStory(true);
                        else openTenantDetail(t);
                      };
                      return (
                        <button key={t.id} onClick={handleStoryClick} className="flex flex-col items-center gap-1.5 shrink-0">
                          <div className="w-[62px] h-[62px] rounded-full p-[2.5px] relative" style={hasStory ? { background: 'linear-gradient(45deg, #f97316, #ea580c, #1c1917)' } : { background: '#e2e8f0' }}>
                            <div className="w-full h-full rounded-full bg-white p-[2px]">
                              {galleries.get(t.id)?.[0] ? (
                                <img src={galleries.get(t.id)![0]} alt={t.name} className="w-full h-full rounded-full object-cover" />
                              ) : (
                                <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-white text-xs font-black">
                                  {t.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                            {isOwn && !hasStory && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-orange-500 rounded-full border-2 border-white flex items-center justify-center text-white font-black" style={{ fontSize: '11px', lineHeight: 1 }}>+</div>
                            )}
                          </div>
                          <span className="text-[10px] font-semibold text-slate-600 w-[66px] text-center truncate">{t.name.split(' ')[0]}</span>
                        </button>
                      );
                    })}
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
                      <div className="relative select-none" onContextMenu={e => e.preventDefault()} onClick={() => handleImageTap(post.id)} style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}>
                        <img src={post.imageUrl} alt="" className="w-full aspect-square object-cover pointer-events-none" draggable={false} style={{ WebkitUserDrag: 'none' } as React.CSSProperties} />
                        <div className="absolute inset-0" />
                        {post.likesCount >= 3 && (
                          <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[9px] font-black px-2.5 py-1 rounded-full flex items-center gap-1 select-none">
                            <span>🔥</span><span>Em alta</span>
                          </div>
                        )}
                        {doubleTapAnims.has(post.id) && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span style={{ fontSize: '80px', animation: 'heartBurst 0.9s ease-out forwards', display: 'block' }}>❤️</span>
                          </div>
                        )}
                      </div>

                      {/* Actions + Caption */}
                      <div className="px-3 pt-3 pb-4 space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="relative inline-flex">
                            <button onClick={() => handleLike(post.id)} className="transition-transform active:scale-75">
                              {userLikes.has(post.id) ? (
                                <svg className="w-7 h-7 fill-red-500" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                              ) : (
                                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                              )}
                            </button>
                            {likeAnims.has(post.id) && (
                              <div style={{ position: 'absolute', top: '50%', left: '50%', pointerEvents: 'none', overflow: 'visible' }}>
                                {['flyUp1','flyUp2','flyUp3','flyUp4','flyUp5'].map((anim, i) => (
                                  <span key={i} style={{ position: 'absolute', marginTop: '-8px', marginLeft: '-8px', fontSize: '14px', color: '#ef4444', animation: `${anim} 0.75s ease-out forwards`, animationDelay: `${i * 0.04}s` }}>♥</span>
                                ))}
                              </div>
                            )}
                          </div>
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

      {/* ── Tenant Detail Modal — Instagram Profile ──────────────────── */}
      {selectedTenant && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-[28px] sm:rounded-[28px] w-full max-w-[470px] overflow-hidden animate-scaleUp max-h-[92vh] flex flex-col">

            {/* ── Profile header (non-scrolling) ─────────────────── */}
            <div className="px-4 pt-4 pb-0 shrink-0">
              {/* Top nav: close + username */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setSelectedTenant(null)} className="p-1 -ml-1 text-black hover:text-slate-500 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>
                <span className="text-[13px] font-black text-black">{selectedTenant.name.split(' ').slice(0, 2).join(' ')}</span>
                <div className="w-6" />
              </div>

              {/* Avatar + stats row */}
              <div className="flex items-center gap-4 mb-3">
                <div className="w-[82px] h-[82px] rounded-full shrink-0 overflow-hidden bg-black flex items-center justify-center" style={{ border: '3px solid #f97316' }}>
                  {galleries.get(selectedTenant.id)?.[0] ? (
                    <img src={galleries.get(selectedTenant.id)![0]} alt={selectedTenant.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-xl font-black">{selectedTenant.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex gap-4 flex-1 justify-around">
                  <div className="text-center">
                    <p className="text-[17px] font-black text-black leading-none">{loadingDetailPosts ? '—' : detailPosts.length}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">posts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[17px] font-black text-black leading-none">{fmtCount(tenantFollowersMap.get(selectedTenant.id) || 0)}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">seguidores</p>
                  </div>
                </div>
              </div>

              {/* Name + nicho + rating + bio */}
              <div className="mb-3 space-y-0.5">
                <p className="text-[13px] font-black text-black">{selectedTenant.name}</p>
                <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                  {selectedTenant.nicho && <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 uppercase tracking-wider">{selectedTenant.nicho}</span>}
                  {selectedTenant.cidade && <span className="text-[10px] text-slate-400">📍 {selectedTenant.cidade}{selectedTenant.estado ? `, ${selectedTenant.estado}` : ''}</span>}
                </div>
                {selectedTenant.rating > 0 && (
                  <p className="text-[11px] text-orange-500 font-black">★ {selectedTenant.rating.toFixed(1)} · {selectedTenant.reviewCount} avaliações</p>
                )}
                {selectedTenant.descricao && (
                  <p className="text-[12px] text-black leading-snug pt-1">{selectedTenant.descricao}</p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pb-3">
                <button onClick={handleFollow} className={`flex-1 py-2 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all ${followedTenants.has(selectedTenant.id) ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-black text-white hover:bg-slate-800'}`}>
                  {followedTenants.has(selectedTenant.id) ? 'Seguindo ✓' : 'Seguir'}
                </button>
                <div className="relative flex-1">
                  <a href={`/agendar/${selectedTenant.slug}`} onClick={() => { setBookingConfetti(true); setTimeout(() => setBookingConfetti(false), 1400); }} className="block w-full py-2 rounded-xl font-black text-[11px] uppercase tracking-wider bg-orange-500 text-white hover:bg-orange-600 transition-all text-center">Agendar</a>
                  {bookingConfetti && (
                    <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, height: 0, pointerEvents: 'none', overflow: 'visible' }}>
                      {['🎉','✨','⭐','🌟','💫','🎊','🔥','❤️'].map((emoji, i) => (
                        <span key={i} style={{ position: 'absolute', bottom: 0, fontSize: '20px', animation: `confettiFly 1.2s ease-out forwards`, animationDelay: `${i * 0.08}s`, left: `${4 + i * 12}%` }}>{emoji}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); toggleFavorite(selectedTenant.id); }} className="w-11 py-2 rounded-xl bg-slate-100 hover:bg-red-50 transition-all flex items-center justify-center text-lg shrink-0">
                  {favorites.has(selectedTenant.id) ? '❤️' : '🤍'}
                </button>
              </div>
            </div>

            {/* ── Tab strip (posts grid / agendar) ───────────────── */}
            <div className="flex border-t border-slate-100 shrink-0">
              <button onClick={() => setDetailTab('grid')} className={`flex-1 py-2.5 flex justify-center items-center border-t-2 transition-colors ${detailTab === 'grid' ? 'border-black' : 'border-transparent'}`}>
                <svg className={`w-5 h-5 ${detailTab === 'grid' ? 'text-black' : 'text-slate-300'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" /></svg>
              </button>
              <button onClick={() => setDetailTab('agendar')} className={`flex-1 py-2.5 flex justify-center items-center border-t-2 transition-colors ${detailTab === 'agendar' ? 'border-black' : 'border-transparent'}`}>
                <svg className={`w-5 h-5 ${detailTab === 'agendar' ? 'text-black' : 'text-slate-300'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" /></svg>
              </button>
            </div>

            {/* ── Content (scrollable) ────────────────────────────── */}
            <div className="overflow-y-auto flex-1">

              {/* Posts grid tab */}
              {detailTab === 'grid' && (
                loadingDetailPosts ? (
                  <div className="text-center py-16"><div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" /></div>
                ) : detailPosts.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-4xl mb-3">📷</p>
                    <p className="text-sm font-black text-slate-400">Nenhum post ainda</p>
                    {myTenantId === selectedTenant.id && <p className="text-xs text-slate-300 mt-1">Publique o primeiro post!</p>}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-[1.5px] mt-[1.5px]">
                    {detailPosts.map(post => (
                      <div key={post.id} className="aspect-square overflow-hidden relative group bg-slate-100">
                        <img src={post.imageUrl} alt="" className="w-full h-full object-cover group-hover:opacity-80 transition-opacity pointer-events-none" draggable={false} />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          <span className="text-white text-[13px] font-black">❤️ {post.likesCount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Agendar tab */}
              {detailTab === 'agendar' && (
                <div className="p-5 space-y-5">
                  {(galleries.get(selectedTenant.id) || []).length > 0 && (
                    <div className={`grid ${(galleries.get(selectedTenant.id) || []).length === 1 ? 'grid-cols-1' : (galleries.get(selectedTenant.id) || []).length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-2 rounded-2xl overflow-hidden`}>
                      {(galleries.get(selectedTenant.id) || []).map((url: string, i: number) => (
                        <div key={i} className="aspect-square overflow-hidden"><img src={url} alt="" className="w-full h-full object-cover" /></div>
                      ))}
                    </div>
                  )}
                  {selectedTenant.endereco && (
                    <p className="text-xs text-slate-500 font-bold">📍 {selectedTenant.endereco}{selectedTenant.cidade ? `, ${selectedTenant.cidade}` : ''}</p>
                  )}
                  <a href={`/agendar/${selectedTenant.slug}`} onClick={() => { setBookingConfetti(true); setTimeout(() => setBookingConfetti(false), 1400); }} className="block w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-black transition-all text-center">
                    Agendar Horário
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── Story Viewer ─────────────────────────────────────────────── */}
      {storyViewer && (() => {
        const story = storyViewer.stories[storyViewer.idx];
        const tenant = tenants.find(t => t.id === storyViewer.tenantId);
        if (!story) return null;
        const isOwnStory = storyViewer.tenantId === myTenantId;
        return (
          <div className="fixed inset-0 z-[500] bg-black flex items-center justify-center select-none">
            {/* Image */}
            <img
              src={story.imageUrl} alt="" key={story.id}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ animation: 'storyFadeIn 0.25s ease-out' }}
            />
            {/* Gradient overlays */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70 pointer-events-none" />

            {/* Progress bars */}
            <div className="absolute top-3 left-0 right-0 flex gap-1 px-3 z-20">
              {storyViewer.stories.map((s, i) => (
                <div key={s.id} className="flex-1 rounded-full overflow-hidden" style={{ height: '2.5px', background: 'rgba(255,255,255,0.3)' }}>
                  <div className="h-full bg-white rounded-full" style={{ width: i < storyViewer.idx ? '100%' : i === storyViewer.idx ? `${storyProgressPct}%` : '0%' }} />
                </div>
              ))}
            </div>

            {/* Header */}
            <div className="absolute top-8 left-0 right-0 flex items-center px-3 z-20">
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-white shrink-0 bg-black flex items-center justify-center mr-2">
                {galleries.get(storyViewer.tenantId)?.[0] ? (
                  <img src={galleries.get(storyViewer.tenantId)![0]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-[10px] font-black">{tenant?.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??'}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-[13px] font-black leading-none">{tenant?.name || 'Profissional'}</p>
                <p className="text-white/60 text-[10px] mt-0.5">{timeAgo(story.createdAt)}</p>
              </div>
              {isOwnStory && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await db.deleteStory(story.id, myTenantId!);
                    setActiveStoriesMap(prev => {
                      const m = new Map<string, MarketplaceStory[]>(prev);
                      const arr = (m.get(myTenantId!) || []).filter(s => s.id !== story.id);
                      if (arr.length === 0) m.delete(myTenantId!); else m.set(myTenantId!, arr);
                      return m;
                    });
                    setStoryViewer(prev => {
                      if (!prev) return null;
                      const newStories = prev.stories.filter(s => s.id !== story.id);
                      if (newStories.length === 0) return null;
                      return { ...prev, stories: newStories, idx: Math.min(prev.idx, newStories.length - 1) };
                    });
                  }}
                  className="mr-2 bg-black/40 text-white text-[10px] font-black px-3 py-1.5 rounded-full hover:bg-red-500/80 transition-all"
                >
                  Excluir
                </button>
              )}
              <button onClick={() => setStoryViewer(null)} className="p-1.5 text-white bg-black/30 rounded-full hover:bg-black/50 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Caption */}
            {story.caption && (
              <div className="absolute bottom-24 left-4 right-4 z-20">
                <p className="text-white text-sm leading-snug drop-shadow-md">{story.caption}</p>
              </div>
            )}

            {/* Agendar button */}
            {tenant && (
              <div className="absolute bottom-6 left-4 right-4 z-20">
                <a
                  href={`/agendar/${tenant.slug}`}
                  onClick={e => e.stopPropagation()}
                  className="block w-full bg-white text-black py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest text-center hover:bg-orange-500 hover:text-white transition-all"
                >
                  Agendar Horário
                </a>
              </div>
            )}

            {/* Tap zones: left = prev, right = next */}
            <div className="absolute inset-0 flex z-10">
              <div className="flex-1 cursor-pointer" onClick={() => advanceStory(-1)} />
              <div className="flex-1 cursor-pointer" onClick={() => advanceStory(1)} />
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default MarketplacePage;
