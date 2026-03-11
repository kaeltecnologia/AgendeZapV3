import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../services/mockDb';
import { SupportMessage } from '../types';

interface Props {
  tenantId: string;
  tenantName: string;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export default function SupportChat({ tenantId, tenantName }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const unreadCount = messages.filter(m => m.sender === 'support' && !m.read).length;

  const load = useCallback(async () => {
    const msgs = await db.getSupportMessages(tenantId);
    setMessages(msgs);
  }, [tenantId]);

  // Poll every 10s
  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 10000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  // When opened: mark support messages as read + scroll to bottom
  useEffect(() => {
    if (open) {
      db.markSupportRead(tenantId, 'support').then(() => {
        setMessages(prev => prev.map(m => m.sender === 'support' ? { ...m, read: true } : m));
      });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [open, tenantId]);

  // Scroll to bottom when new messages arrive while open
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText('');
    try {
      await db.sendTenantSupportMessage(tenantId, content);
      await load();
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (!blob || uploading) return;
        // Clipboard images may have no name — create a proper File with extension
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
        const file = new File([blob], `paste-${Date.now()}.${ext}`, { type: blob.type });
        setUploading(true);
        try {
          const url = await db.uploadSupportImage(tenantId, file);
          await db.sendTenantSupportMessage(tenantId, '', url);
          await load();
        } catch (err: any) {
          console.error('[SupportChat] paste upload error:', err);
        } finally {
          setUploading(false);
        }
        return;
      }
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await db.uploadSupportImage(tenantId, file);
      await db.sendTenantSupportMessage(tenantId, '', url);
      await load();
    } catch (err) {
      console.error('[SupportChat] file upload error:', err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-50">
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center z-10">
            {unreadCount}
          </span>
        )}
        <button
          onClick={() => setOpen(true)}
          title="Suporte AgendeZap"
          className="w-14 h-14 bg-orange-500 rounded-full shadow-xl flex items-center justify-center hover:scale-105 transition-all"
        >
          {/* Headset icon */}
          <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
          </svg>
        </button>
      </div>

      {/* Slide-in panel */}
      <div
        className={`fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-[200] flex flex-col transform transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-orange-500">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
            <div>
              <p className="text-white font-black text-sm">Suporte AgendeZap</p>
              <p className="text-orange-100 text-[10px] font-bold">Respondemos em breve</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-all"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 pb-8">
              <span className="text-4xl">👋</span>
              <p className="text-sm font-bold text-slate-600">Olá! Estamos aqui para ajudar.</p>
              <p className="text-xs text-slate-400">Envie sua dúvida ou imagem de erro!</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === 'tenant' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] space-y-1 ${msg.sender === 'tenant' ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className={`px-4 py-2.5 rounded-[20px] text-sm font-medium leading-relaxed ${
                    msg.sender === 'tenant'
                      ? 'bg-black text-white rounded-br-sm'
                      : 'bg-orange-50 border border-orange-100 text-slate-800 rounded-bl-sm'
                  }`}>
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt="imagem"
                        className="max-w-full rounded-2xl mb-1"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    {msg.content && <span>{msg.content}</span>}
                  </div>
                  <div className="flex items-center gap-1 px-1">
                    <span className="text-[10px] text-slate-300 font-bold">{formatTime(msg.createdAt)}</span>
                    {msg.sender === 'tenant' && (
                      <span className={`text-[9px] font-black ${msg.read ? 'text-orange-400' : 'text-slate-300'}`}>
                        {msg.read ? '✓✓ Visualizada' : '✓'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-slate-100 bg-slate-50 space-y-2">
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="Enviar imagem"
              className="w-9 h-9 shrink-0 rounded-xl bg-slate-200 flex items-center justify-center hover:bg-slate-300 transition-all disabled:opacity-50"
            >
              {uploading
                ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                : <svg className="w-4 h-4 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              }
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Digite sua mensagem..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-300 transition-all leading-snug"
              style={{ maxHeight: 96, overflowY: 'auto' }}
            />

            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              className="w-9 h-9 shrink-0 rounded-xl bg-orange-500 flex items-center justify-center hover:bg-orange-600 transition-all disabled:opacity-40"
            >
              {sending
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Backdrop when open on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-[199] md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
