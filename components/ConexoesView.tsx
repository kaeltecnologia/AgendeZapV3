import React, { useState, useEffect, useRef } from 'react';
import EvolutionConfig from './EvolutionConfig';
import AiAgentConfig from './AiAgentConfig';
import InstagramConfig from './InstagramConfig';
import GoogleBusinessConfig from './GoogleBusinessConfig';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { hasFeature } from '../config/planConfig';
import type { BookingTheme } from '../types';

type Tab = 'whatsapp' | 'agente' | 'linkweb' | 'instagram';

const ConexoesView: React.FC<{ tenantId: string; tenantSlug: string; tenantPlan?: string }> = ({ tenantId, tenantSlug, tenantPlan }) => {
  const [tab, setTab] = useState<Tab>('whatsapp');
  const [copied, setCopied] = useState(false);
  const dbOnline = db.isOnline();

  const bookingUrl = `${window.location.origin}/agendar/${tenantSlug}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Conexões</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">WhatsApp, Agente IA, Instagram e link de agendamento</p>
        </div>

        {/* DB / Supabase status badge */}
        <div className={`flex items-center gap-2 px-5 py-3 rounded-2xl border-2 ${dbOnline ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className={`w-2 h-2 rounded-full ${dbOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-[10px] font-black uppercase tracking-widest ${dbOnline ? 'text-green-600' : 'text-red-600'}`}>
            Supabase: {dbOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Tab switcher — dois grupos */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Grupo: Integrações */}
        <div className="flex flex-col gap-1">
          {!false && <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Integrações</p>}
          <div className="flex gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
            <TabBtn active={tab === 'whatsapp'} onClick={() => setTab('whatsapp')} icon="📱" label="WhatsApp" />
            <TabBtn active={tab === 'agente'}   onClick={() => setTab('agente')}   icon="🤖" label="Agente IA" />
            <TabBtn active={tab === 'instagram'} onClick={() => setTab('instagram')} icon="📸" label="Instagram" />
          </div>
        </div>
        {/* Divisor */}
        <div className="hidden sm:flex flex-col items-center self-end pb-2">
          <div className="w-px h-8 bg-slate-200" />
        </div>
        {/* Grupo: Aparência */}
        <div className="flex flex-col gap-1">
          <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Aparência</p>
          <div className="flex gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
            <TabBtn active={tab === 'linkweb'} onClick={() => setTab('linkweb')} icon="🎨" label="Link de Agendamento" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div>
        {tab === 'whatsapp' && <EvolutionConfig tenantId={tenantId} tenantSlug={tenantSlug} />}
        {tab === 'agente'   && <AiAgentConfig   tenantId={tenantId} tenantPlan={tenantPlan} />}
        {tab === 'instagram' && (hasFeature(tenantPlan, 'socialMidia')
          ? <InstagramConfig tenantId={tenantId} />
          : <UpgradeNotice feature="Instagram" />
        )}
        {tab === 'linkweb' && (
          <WebLinkPanel
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            bookingUrl={bookingUrl}
            copied={copied}
            onCopy={handleCopy}
          />
        )}
      </div>
    </div>
  );
};

// ── Web Link Panel ─────────────────────────────────────────────────────────────

const FONT_OPTIONS: { value: BookingTheme['fontStyle']; label: string; preview: string }[] = [
  { value: 'modern',  label: 'Moderno',  preview: 'font-sans' },
  { value: 'rounded', label: 'Arredondado', preview: 'font-sans' },
  { value: 'elegant', label: 'Elegante', preview: 'font-serif' },
];

const RADIUS_OPTIONS: { value: BookingTheme['buttonRadius']; label: string; class: string }[] = [
  { value: 'pill',    label: 'Pílula',    class: 'rounded-full' },
  { value: 'rounded', label: 'Arredondado', class: 'rounded-2xl' },
  { value: 'square',  label: 'Quadrado',  class: 'rounded-lg' },
];

const DEFAULT_THEME: BookingTheme = {
  primaryColor: '#f97316',
  bgColor1: '#1e3a8a',
  bgColor2: '#3b82f6',
  fontStyle: 'modern',
  showPrices: true,
  showDuration: true,
  buttonRadius: 'rounded',
  logoUrl: '',
};

const WebLinkPanel: React.FC<{
  tenantId: string;
  tenantSlug: string;
  bookingUrl: string;
  copied: boolean;
  onCopy: () => void;
}> = ({ tenantId, bookingUrl, copied, onCopy }) => {
  const [theme, setTheme] = useState<BookingTheme>(DEFAULT_THEME);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load existing theme
  useEffect(() => {
    db.getSettings(tenantId).then(s => {
      if (s.bookingTheme) setTheme({ ...DEFAULT_THEME, ...s.bookingTheme });
    }).catch(() => {});
  }, [tenantId]);

  const set = <K extends keyof BookingTheme>(key: K, value: BookingTheme[K]) =>
    setTheme(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await db.updateSettings(tenantId, { bookingTheme: theme });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { alert('Erro ao salvar configurações.'); }
    finally { setSaving(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `logos/${tenantId}/booking-logo.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('marketplace')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('marketplace').getPublicUrl(path);
      set('logoUrl', data.publicUrl);
    } catch {
      alert('Erro ao enviar imagem. Verifique se o bucket "marketplace" existe no Supabase Storage.');
    } finally { setUploading(false); }
  };

  const ColorField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="space-y-1">
      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">{label}</label>
      <div className="flex items-center gap-3">
        <div className="relative">
          <input
            type="color"
            value={value || '#000000'}
            onChange={e => onChange(e.target.value)}
            className="w-12 h-12 rounded-2xl border-2 border-slate-200 cursor-pointer p-0.5"
          />
        </div>
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="#f97316"
          maxLength={7}
          className="flex-1 p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-mono text-sm text-black outline-none focus:border-orange-400"
        />
        <div className="w-10 h-10 rounded-xl border-2 border-slate-200" style={{ backgroundColor: value || '#f97316' }} />
      </div>
    </div>
  );

  const ToggleRow = ({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-black text-black">{label}</p>
        <p className="text-[10px] text-slate-400 font-bold">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full transition-all relative ${checked ? 'bg-orange-500' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Info card */}
      <div className="bg-orange-50 border-2 border-orange-100 rounded-3xl p-6 flex gap-4 items-start">
        <span className="text-3xl mt-0.5">🔗</span>
        <div>
          <p className="font-black text-orange-700 text-sm uppercase tracking-widest">Link de Agendamento Online</p>
          <p className="text-xs text-orange-600 mt-1 leading-relaxed">
            Compartilhe este link com seus clientes para que possam agendar sozinhos, 24h por dia.
            Eles escolhem o serviço, dia, profissional e horário. O agendamento cai direto na agenda e ambos recebem confirmação no WhatsApp.
          </p>
        </div>
      </div>

      {/* URL box */}
      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Seu link exclusivo</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-mono text-sm text-slate-700 truncate select-all">
            {bookingUrl}
          </div>
          <button
            onClick={onCopy}
            className={`shrink-0 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${
              copied ? 'bg-green-500 text-white' : 'bg-black text-white hover:bg-orange-500'
            }`}
          >
            {copied ? '✓ Copiado!' : 'Copiar'}
          </button>
        </div>
        <button
          onClick={() => window.open(bookingUrl, '_blank')}
          className="flex items-center gap-2 text-xs font-black text-orange-500 hover:text-orange-600 uppercase tracking-widest transition-colors"
        >
          <span>↗</span>
          <span>Abrir página de agendamento</span>
        </button>
      </div>

      {/* ── CUSTOMIZADOR VISUAL ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎨</span>
          <div>
            <p className="font-black text-black text-sm uppercase tracking-widest">Personalizar Visual</p>
            <p className="text-[10px] text-slate-400 font-bold mt-0.5">Defina as cores, fonte, logo e exibição do seu link de agendamento</p>
          </div>
        </div>

        {/* LOGO */}
        <div className="space-y-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Logo / Foto do Estabelecimento</p>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-2xl border-2 border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
              {theme.logoUrl
                ? <img src={theme.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                : <span className="text-3xl text-slate-300">🏪</span>
              }
            </div>
            <div className="flex-1 space-y-2">
              <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-xs text-slate-600 uppercase tracking-widest hover:border-orange-400 hover:text-orange-500 transition-all disabled:opacity-50"
              >
                {uploading ? '⏳ Enviando...' : theme.logoUrl ? '🔄 Trocar Logo' : '📤 Fazer Upload do Logo'}
              </button>
              {theme.logoUrl && (
                <button
                  type="button"
                  onClick={() => set('logoUrl', '')}
                  className="w-full py-2 text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors"
                >
                  Remover logo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="border-t-2 border-slate-50 pt-4 space-y-4">
          {/* CORES */}
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cores</p>

          <ColorField
            label="Cor Principal — botões, destaques, barra de progresso"
            value={theme.primaryColor || '#f97316'}
            onChange={v => set('primaryColor', v)}
          />

          <div className="grid grid-cols-2 gap-4">
            <ColorField
              label="Fundo — início do gradiente"
              value={theme.bgColor1 || '#1e3a8a'}
              onChange={v => set('bgColor1', v)}
            />
            <ColorField
              label="Fundo — fim do gradiente"
              value={theme.bgColor2 || '#3b82f6'}
              onChange={v => set('bgColor2', v)}
            />
          </div>

          {/* Preview da cor / gradiente */}
          <div
            className="h-14 rounded-2xl flex items-center justify-center gap-4"
            style={{ background: `linear-gradient(to right, ${theme.bgColor1 || '#1e3a8a'}, ${theme.bgColor2 || '#3b82f6'})` }}
          >
            <span className="text-white text-xs font-black uppercase tracking-widest opacity-80">Preview do fundo</span>
            <div
              className="px-4 py-1.5 text-white text-xs font-black uppercase tracking-widest"
              style={{
                backgroundColor: theme.primaryColor || '#f97316',
                borderRadius: theme.buttonRadius === 'pill' ? '9999px' : theme.buttonRadius === 'square' ? '6px' : '12px',
              }}
            >
              Agendar
            </div>
          </div>
        </div>

        {/* FONTE */}
        <div className="border-t-2 border-slate-50 pt-4 space-y-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fonte</p>
          <div className="grid grid-cols-3 gap-3">
            {FONT_OPTIONS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => set('fontStyle', f.value)}
                className={`py-4 rounded-2xl border-2 text-center transition-all ${
                  theme.fontStyle === f.value
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-slate-100 hover:border-slate-300'
                }`}
              >
                <p className={`text-sm font-bold ${theme.fontStyle === f.value ? 'text-orange-600' : 'text-slate-600'} ${f.preview}`}>
                  Aa
                </p>
                <p className={`text-[10px] font-black uppercase mt-1 ${theme.fontStyle === f.value ? 'text-orange-500' : 'text-slate-400'}`}>
                  {f.label}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* ESTILO DE BOTÃO */}
        <div className="border-t-2 border-slate-50 pt-4 space-y-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estilo dos Botões</p>
          <div className="grid grid-cols-3 gap-3">
            {RADIUS_OPTIONS.map(r => (
              <button
                key={r.value}
                type="button"
                onClick={() => set('buttonRadius', r.value)}
                className={`py-4 rounded-2xl border-2 text-center transition-all ${
                  theme.buttonRadius === r.value
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-slate-100 hover:border-slate-300'
                }`}
              >
                <div
                  className="mx-auto mb-2 px-3 py-1 text-[10px] font-black text-white uppercase"
                  style={{
                    backgroundColor: theme.primaryColor || '#f97316',
                    borderRadius: r.value === 'pill' ? '9999px' : r.value === 'square' ? '6px' : '10px',
                    display: 'inline-block',
                  }}
                >
                  Botão
                </div>
                <p className={`text-[10px] font-black uppercase block ${theme.buttonRadius === r.value ? 'text-orange-500' : 'text-slate-400'}`}>
                  {r.label}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* EXIBIÇÃO */}
        <div className="border-t-2 border-slate-50 pt-4 space-y-1">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Exibição dos Serviços</p>
          <ToggleRow
            label="Mostrar valores"
            desc="Exibe o preço de cada serviço no link de agendamento"
            checked={theme.showPrices !== false}
            onChange={v => set('showPrices', v)}
          />
          <ToggleRow
            label="Mostrar duração"
            desc="Exibe o tempo estimado de cada serviço"
            checked={theme.showDuration !== false}
            onChange={v => set('showDuration', v)}
          />
        </div>

        {/* SALVAR */}
        <div className="border-t-2 border-slate-50 pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${
              saved
                ? 'bg-green-500 text-white'
                : 'bg-black text-white hover:bg-orange-500 disabled:opacity-50'
            }`}
          >
            {saving ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar Personalização'}
          </button>
        </div>
      </div>

      {/* Como funciona */}
      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Como funciona</p>
        <div className="grid grid-cols-2 gap-4">
          {[
            { n: '1', title: 'Escolhe o serviço', desc: 'O cliente vê todos os serviços com preços e duração.' },
            { n: '2', title: 'Seleciona o dia', desc: 'Calendário mostra apenas dias com horários disponíveis.' },
            { n: '3', title: 'Escolhe o profissional', desc: 'Pode escolher um profissional específico ou qualquer um.' },
            { n: '4', title: 'Confirma o horário', desc: 'Preenche nome e telefone e recebe confirmação no WhatsApp.' },
          ].map(s => (
            <div key={s.n} className="flex gap-3 items-start p-4 bg-slate-50 rounded-2xl">
              <span className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center text-xs font-black shrink-0">{s.n}</span>
              <div>
                <p className="font-black text-xs text-black uppercase tracking-tight">{s.title}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dicas */}
      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-3">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dicas de compartilhamento</p>
        <ul className="space-y-2">
          {[
            'Adicione o link na bio do Instagram e TikTok',
            'Envie no grupo do WhatsApp do estabelecimento',
            'Coloque um QR Code impresso na recepção',
            'Compartilhe em posts e stories com a chamada "Agende Online 24h"',
          ].map((tip, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
              <span className="text-orange-400 font-black shrink-0">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const UpgradeNotice: React.FC<{ feature: string }> = ({ feature }) => (
  <div className="bg-orange-50 border-2 border-orange-200 rounded-3xl p-8 text-center space-y-3">
    <span className="text-4xl">🔒</span>
    <p className="font-black text-orange-700 text-sm uppercase tracking-widest">{feature} — Plano Profissional+</p>
    <p className="text-xs text-orange-600 leading-relaxed max-w-md mx-auto">
      A integração com {feature} está disponível a partir do plano Profissional. Faça upgrade para conectar sua conta.
    </p>
  </div>
);

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
      active ? 'bg-black text-white shadow-lg' : 'text-slate-500 hover:text-black'
    }`}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </button>
);

export default ConexoesView;
