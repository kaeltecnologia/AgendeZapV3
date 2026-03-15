import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';

const IG_APP_ID = '917328734572559';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

interface Props {
  tenantId: string;
}

const InstagramConfig: React.FC<Props> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [igUsername, setIgUsername] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await db.getSettings(tenantId);
      setIgUsername((s as any).instagramUsername || '');
      setIgUserId((s as any).instagramUserId || '');
    } catch (e) {
      console.error('[InstagramConfig] load error:', e);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Listen for OAuth callback message from popup
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type !== 'instagram-oauth-code') return;
      const code = e.data.code;
      if (!code) return;

      setConnecting(true);
      setError('');
      try {
        const redirectUri = `${window.location.origin}${window.location.pathname}`;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/instagram-oauth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ code, redirectUri, tenantId }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setIgUsername(data.username);
          setIgUserId(data.igUserId);
        }
      } catch (e: any) {
        setError(e.message || 'Erro ao conectar');
      }
      setConnecting(false);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [tenantId]);

  const handleConnect = () => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const scopes = 'instagram_business_basic,instagram_business_content_publish';
    const url = `https://api.instagram.com/oauth/authorize?client_id=${IG_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}`;

    // Open popup
    const w = 600, h = 700;
    const left = window.screenX + (window.innerWidth - w) / 2;
    const top = window.screenY + (window.innerHeight - h) / 2;
    window.open(url, 'instagram-oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await db.updateSettings(tenantId, {
        instagramAccessToken: '',
        instagramUserId: '',
        instagramUsername: '',
      } as any);
      setIgUsername('');
      setIgUserId('');
    } catch (e: any) {
      setError(e.message || 'Erro ao desconectar');
    }
    setDisconnecting(false);
  };

  const connected = !!igUserId && !!igUsername;

  if (loading) return (
    <div className="text-center py-20">
      <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Status card */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Instagram</h3>
            <p className="text-xs text-slate-400 mt-1">Conecte sua conta Instagram Business para publicar Stories pelo AgendeZap.</p>
          </div>
          {connected ? (
            <span className="text-[10px] font-bold text-green-600 bg-green-100 px-3 py-1 rounded-full">Conectado</span>
          ) : (
            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">Desconectado</span>
          )}
        </div>

        {connected ? (
          <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl border border-purple-100">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white text-lg font-black">
              {igUsername.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-slate-800">@{igUsername}</p>
              <p className="text-[10px] text-slate-400">Conta Instagram conectada</p>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="px-4 py-2 text-[10px] font-bold text-red-500 bg-red-50 rounded-xl hover:bg-red-100 transition-all disabled:opacity-40"
            >
              {disconnecting ? 'Desconectando...' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white hover:opacity-90 disabled:opacity-40"
          >
            {connecting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Conectando...
              </>
            ) : (
              'Conectar Instagram'
            )}
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-50 rounded-xl">
            <p className="text-xs font-bold text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-3">
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Requisitos</h4>
        <ul className="space-y-2 text-xs text-slate-500">
          <li className="flex items-start gap-2">
            <span className="text-orange-500 font-bold mt-0.5">1.</span>
            Conta Instagram <strong>Business</strong> ou <strong>Creator</strong>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-orange-500 font-bold mt-0.5">2.</span>
            Ao clicar em "Conectar", autorize o acesso nas permissões solicitadas
          </li>
        </ul>
      </div>
    </div>
  );
};

export default InstagramConfig;
