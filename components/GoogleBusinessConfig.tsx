import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://cnnfnqrnjckntnxdgwae.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubmZucXJuamNrbnRueGRnd2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTM3NzksImV4cCI6MjA4NzE4OTc3OX0.ANyOJVIsBv0GWuJyUmdicRrgHqZc5VAXRUSua_roO4I';

interface Props {
  tenantId: string;
}

const GoogleBusinessConfig: React.FC<Props> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await db.getSettings(tenantId);
      setBusinessName((s as any).googleBusinessName || '');
      setLocationId((s as any).googleLocationId || '');
    } catch (e) {
      console.error('[GoogleBusinessConfig] load error:', e);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Listen for OAuth callback message from popup
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type !== 'google-business-oauth-code') return;
      const code = e.data.code;
      if (!code) return;

      setConnecting(true);
      setError('');
      try {
        const redirectUri = `${window.location.origin}${window.location.pathname}`;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/google-business-oauth`, {
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
          setBusinessName(data.businessName);
          setLocationId(data.locationId);
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
    if (!GOOGLE_CLIENT_ID) {
      setError('Google Client ID não configurado. Configure VITE_GOOGLE_CLIENT_ID.');
      return;
    }
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const scope = 'https://www.googleapis.com/auth/business.manage';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=google`;

    const w = 600, h = 700;
    const left = window.screenX + (window.innerWidth - w) / 2;
    const top = window.screenY + (window.innerHeight - h) / 2;
    window.open(url, 'google-business-oauth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await db.updateSettings(tenantId, {
        googleBusinessAccessToken: '',
        googleBusinessRefreshToken: '',
        googleAccountId: '',
        googleLocationId: '',
        googleBusinessName: '',
      } as any);
      setBusinessName('');
      setLocationId('');
    } catch (e: any) {
      setError(e.message || 'Erro ao desconectar');
    }
    setDisconnecting(false);
  };

  const connected = !!locationId && !!businessName;

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
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Google Meu Negócio</h3>
            <p className="text-xs text-slate-400 mt-1">Conecte sua conta para publicar posts no Google Maps.</p>
          </div>
          {connected ? (
            <span className="text-[10px] font-bold text-green-600 bg-green-100 px-3 py-1 rounded-full">Conectado</span>
          ) : (
            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">Desconectado</span>
          )}
        </div>

        {connected ? (
          <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-2xl border border-blue-100">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 via-green-500 to-yellow-400 flex items-center justify-center text-white text-lg font-black">
              📍
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-slate-800">{businessName}</p>
              <p className="text-[10px] text-slate-400">Google Business Profile conectado</p>
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
            className="w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 via-green-500 to-yellow-400 text-white hover:opacity-90 disabled:opacity-40"
          >
            {connecting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Conectando...
              </>
            ) : (
              'Conectar Google Meu Negócio'
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
            Ter uma conta <strong>Google Meu Negócio</strong> (business.google.com)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-orange-500 font-bold mt-0.5">2.</span>
            Ao clicar em "Conectar", autorize o acesso com a conta Google do negócio
          </li>
        </ul>
      </div>
    </div>
  );
};

export default GoogleBusinessConfig;
