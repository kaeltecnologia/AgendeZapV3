
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { evolutionService } from '../services/evolutionService';
import { db } from '../services/mockDb';

const WEBHOOK_URL = 'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook';

interface LogEntry {
  timestamp: string;
  type: 'POLLING' | 'GEMINI' | 'SUCCESS' | 'ERROR' | 'INFO';
  message: string;
}

const EvolutionConfig: React.FC<{ tenantId: string; tenantSlug?: string }> = ({ tenantId, tenantSlug }) => {
  const [instanceStatus, setInstanceStatus] = useState<'open' | 'close' | 'connecting' | 'notfound' | 'idle'>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [instanceName, setInstanceName] = useState('');

  const logContainerRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const newLog: LogEntry = {
      timestamp: new Date().toLocaleTimeString('pt-BR'),
      type,
      message
    };
    setLogs(prev => [newLog, ...prev].slice(0, 50));
  }, []);

  const refreshInstanceInfo = useCallback(async () => {
    try {
      // Sempre busca o tenant direto do DB para pegar o evolution_instance customizado
      const tenant = await db.getTenant(tenantId, { fresh: true });
      if (tenant) {
        const name = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        setInstanceName(name);
        return name;
      }

      // Fallback: gera a partir do slug da prop (quando DB não retorna)
      if (tenantSlug) {
        const name = evolutionService.getInstanceName(tenantSlug);
        setInstanceName(name);
        return name;
      }

      return '';
    } catch (e) {
      console.error("Erro ao identificar estabelecimento:", e);
      if (tenantSlug) {
        const name = evolutionService.getInstanceName(tenantSlug);
        setInstanceName(name);
        return name;
      }
      return '';
    }
  }, [tenantId, tenantSlug]);

  const handleConnect = useCallback(async (forceReset: boolean = false) => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setQrCode(null);

    try {
      const name = await refreshInstanceInfo();
      if (!name) {
        throw new Error("Falha Crítica: Não conseguimos identificar o slug do seu estabelecimento. Tente sair e entrar novamente.");
      }

      if (forceReset) {
        // ── Force reset: logout → wait until 'close' → restart → get QR ──────
        addLog('INFO', `Encerrando sessão WhatsApp de ${name}...`);
        const logoutRes = await evolutionService.logoutInstance(name);
        addLog('INFO', `Logout → HTTP ${logoutRes.status ?? '?'} | ${JSON.stringify(logoutRes.body).slice(0, 80)}`);
        if (!logoutRes.ok) {
          addLog('INFO', 'Aviso: logout retornou falha — pode já estar desconectado. Continuando...');
        }

        // Poll until status leaves 'open' (confirms logout took effect)
        addLog('INFO', 'Aguardando confirmação de desconexão...');
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const st = await evolutionService.checkStatus(name);
          if (st !== 'open') { addLog('INFO', `Desconectado (estado: ${st}). Iniciando nova sessão...`); break; }
          if (i === 11) addLog('INFO', 'Timeout aguardando desconexão — forçando mesmo assim...');
        }

        // createAndFetchQr abaixo faz o restart internamente — NÃO chamar restartInstance
        // aqui para evitar double restart que destabiliza a instância na Evolution API.
        addLog('INFO', 'Solicitando QR Code...');
        let qrResult: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          qrResult = await evolutionService.createAndFetchQr(name, false);
          if (qrResult.qrcode || qrResult.message === 'Conectado.') break;
          // Erro persistente (instância bugada/irrecuperável) — para imediatamente
          if (qrResult.status === 'error') break;
          if (attempt < 4) {
            addLog('INFO', `QR ainda não disponível, aguardando... (${attempt + 1}/5)`);
            await new Promise(r => setTimeout(r, 2500));
          }
        }

        if (qrResult?.qrcode) {
          evolutionService.enableWebhook(name, WEBHOOK_URL).catch(() => {});
          setQrCode(qrResult.qrcode);
          setInstanceStatus('connecting');
          addLog('SUCCESS', 'QR Code gerado! Abra o WhatsApp e escaneie agora.');
        } else if (qrResult?.message === 'Conectado.') {
          setInstanceStatus('open');
          addLog('INFO', 'Instância reconectou automaticamente.');
        } else {
          setError('Não foi possível gerar QR Code. Tente novamente.');
          addLog('ERROR', 'QR Code não disponível após várias tentativas.');
        }
        return; // handled above — skip generic flow below
      }

      addLog('INFO', `Conectando instância: ${name}`);
      const result = await evolutionService.createAndFetchQr(name, false);

      if (result.status === 'success') {
        // Register the Edge Function webhook so messages are processed 24/7,
        // even when the browser tab is closed.
        evolutionService.enableWebhook(name, WEBHOOK_URL).catch(() => {});
        addLog('INFO', 'Webhook Edge Function registrado — operação 24/7 ativa.');

        if (result.qrcode) {
          setQrCode(result.qrcode);
          setInstanceStatus('connecting');
          addLog('SUCCESS', "QR Code gerado! Abra o WhatsApp e escaneie agora.");
        } else if (result.message === 'Conectado.') {
          setInstanceStatus('open');
          addLog('SUCCESS', "Instância já estava conectada no servidor.");
        }
      } else {
        setError(result.message);
        addLog('ERROR', result.message);
      }
    } catch (e: any) {
      setError(e.message);
      addLog('ERROR', e.message || "Erro de sincronização com o servidor Evolution.");
    } finally {
      setLoading(false);
    }
  }, [loading, tenantId, addLog, refreshInstanceInfo]);

  const handleDisconnect = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const name = await refreshInstanceInfo();
      if (!name) throw new Error('Instância não identificada.');
      addLog('INFO', `Desconectando WhatsApp de ${name}...`);
      const res = await evolutionService.logoutInstance(name);
      addLog('INFO', `Logout → HTTP ${res.status ?? '?'} | ${JSON.stringify(res.body).slice(0, 120)}`);

      // HTTP 500 = Evolution API internal error — usually means the WA session is
      // already broken/corrupted on the server side (socket closed, connection lost).
      // Treat as disconnected and update local state.
      const sessionBroken = res.status === 500;

      if (res.ok || sessionBroken) {
        setInstanceStatus('close');
        setQrCode(null);
        addLog('SUCCESS', sessionBroken
          ? 'Sessão já estava encerrada no servidor. Estado local atualizado.'
          : 'WhatsApp desconectado com sucesso.');
      } else {
        // Other failures: try restart to clear internal state
        addLog('INFO', `Logout falhou (HTTP ${res.status}) — tentando restart...`);
        const restarted = await evolutionService.restartInstance(name);
        if (restarted) {
          setInstanceStatus('close');
          setQrCode(null);
          addLog('SUCCESS', 'Instância reiniciada. Use "Solicitar QR Code" para reconectar.');
        } else {
          setError(`Evolution API retornou HTTP ${res.status}. Tente "Reiniciar Instância".`);
          addLog('ERROR', `Não foi possível desconectar. Body: ${JSON.stringify(res.body).slice(0, 80)}`);
        }
      }
    } catch (e: any) {
      addLog('ERROR', e.message || 'Erro ao desconectar.');
    } finally {
      setLoading(false);
    }
  }, [loading, refreshInstanceInfo, addLog]);

  const handleForceSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setLogs([]);
    addLog('INFO', '🔄 Sincronização forçada iniciada...');
    try {
      const name = await refreshInstanceInfo();
      addLog('INFO', `📡 Instância: ${name || '(não encontrada)'}`);
      if (!name) { addLog('ERROR', 'Instância não identificada. Tente sair e entrar novamente.'); return; }

      // 1. Check Evolution API status (full debug)
      addLog('INFO', '── Verificando status na Evolution API ──');
      const status = await evolutionService.checkStatus(name, (msg) => addLog('POLLING', msg));
      addLog(status === 'open' ? 'SUCCESS' : 'ERROR', `Status Evolution API: ${status.toUpperCase()}`);
      setInstanceStatus(status);

      // 2. Sync DB
      addLog('INFO', '── Sincronizando banco de dados ──');
      if (status === 'open' || status === 'close' || status === 'connecting') {
        await db.updateSettings(tenantId, { connectionStatus: status });
        addLog('SUCCESS', `DB atualizado: _connectionStatus = "${status}"`);
      }

      // 3. Re-register webhook with CONNECTION_UPDATE
      addLog('INFO', '── Re-registrando webhook na Evolution API ──');
      addLog('INFO', `Webhook URL: ${WEBHOOK_URL}`);
      addLog('INFO', 'Events: MESSAGES_UPSERT, CONNECTION_UPDATE');
      const webhookOk = await evolutionService.enableWebhook(name, WEBHOOK_URL);
      addLog(webhookOk ? 'SUCCESS' : 'ERROR', `Webhook: ${webhookOk ? 'registrado com sucesso ✓' : 'falha no registro ✗'}`);

      // 4. Final status
      addLog('INFO', '── Resultado Final ──');
      addLog(status === 'open' ? 'SUCCESS' : 'ERROR',
        status === 'open'
          ? '✅ WhatsApp CONECTADO — DB e webhook sincronizados!'
          : `⚠️ WhatsApp ${status.toUpperCase()} — Escaneie o QR Code para conectar.`
      );
    } catch (e: any) {
      addLog('ERROR', `Erro: ${e.message || 'falha desconhecida'}`);
    } finally {
      setSyncing(false);
    }
  }, [syncing, tenantId, refreshInstanceInfo, addLog]);

  // Check rápido do DB na montagem — evita flash de "DESCONECTADA" antes do poll
  useEffect(() => {
    if (!tenantId) return;
    db.getSettings(tenantId).then(s => {
      if (s.connectionStatus === 'open') setInstanceStatus('open');
    }).catch(() => {});
  }, [tenantId]);

  // Polling de status — consulta Evolution API a cada 10s
  useEffect(() => {
    addLog('INFO', '▶ Polling iniciado'); // log síncrono — confirma que o código novo carregou
    let mounted = true;
    let lastStatus = '';

    const check = async () => {
      const name = await refreshInstanceInfo();
      addLog('POLLING', `inst="${name || '(vazio)'}"`);
      if (!name || !mounted) return;
      const status = await evolutionService.checkStatus(name, (msg) => addLog('POLLING', msg));
      addLog('POLLING', `→ status final: ${status}`);
      if (!mounted) return;
      setInstanceStatus(status);
      if (status === 'open' && lastStatus !== 'open') {
        evolutionService.enableWebhook(name, WEBHOOK_URL).catch(() => {});
        db.updateSettings(tenantId, { connectionStatus: 'open' }).catch(() => {});
      }
      if (status === 'close' && lastStatus === 'open') {
        db.updateSettings(tenantId, { connectionStatus: 'close' }).catch(() => {});
      }
      lastStatus = status;
    };

    check();
    const interval = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [tenantId, refreshInstanceInfo, addLog]);

  // Poll agressivo a cada 3s enquanto QR está visível — detecta conexão imediatamente
  useEffect(() => {
    if (!qrCode || !instanceName) return;
    let active = true;
    let attempts = 0;

    const poll = async () => {
      if (!active || attempts >= 30) return;
      attempts++;
      const status = await evolutionService.checkStatus(instanceName, (msg) => addLog('POLLING', msg));
      if (!active) return;
      if (status === 'open') {
        setInstanceStatus('open');
        setQrCode(null);
        addLog('SUCCESS', 'WhatsApp conectado!');
        evolutionService.enableWebhook(instanceName, WEBHOOK_URL).catch(() => {});
        db.updateSettings(tenantId, { connectionStatus: 'open' }).catch(() => {});
        return;
      }
      setTimeout(poll, 3000);
    };

    const t = setTimeout(poll, 3000);
    return () => { active = false; clearTimeout(t); };
  }, [qrCode, instanceName, addLog]);

  return (
    <div className="space-y-10 animate-fadeIn max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight italic">Conexão WhatsApp</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Instância Dedicada: <span className="text-orange-500 font-black">{instanceName || 'VINCULANDO...'}</span>
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border-2 flex items-center space-x-3 transition-all ${instanceStatus === 'open' ? 'border-green-100 bg-green-50 shadow-lg shadow-green-100/50' : instanceStatus === 'notfound' ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'}`}>
          <div className={`w-2 h-2 rounded-full ${instanceStatus === 'open' ? 'bg-green-500 animate-pulse' : instanceStatus === 'notfound' ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></div>
          <span className={`text-[10px] font-black uppercase ${instanceStatus === 'notfound' ? 'text-red-600' : 'text-slate-500'}`}>{instanceStatus === 'open' ? 'ESTABELECIDA' : instanceStatus === 'notfound' ? 'NÃO CRIADA' : 'DESCONECTADA'}</span>
        </div>
      </div>

      {instanceStatus === 'notfound' && (
        <div className="flex items-start gap-4 bg-red-50 border-2 border-red-200 rounded-2xl px-5 py-4">
          <span className="text-2xl mt-0.5">⚠️</span>
          <div>
            <p className="text-sm font-black text-red-700 uppercase tracking-wide">Instância Evolution API não encontrada</p>
            <p className="text-xs text-red-500 font-bold mt-1">
              A instância <span className="font-black">{instanceName}</span> não existe no servidor Evolution API.
              Clique em <span className="font-black">"SOLICITAR QR CODE"</span> abaixo para criá-la e conectar o WhatsApp.
              Enquanto isso, o agente IA não consegue enviar nem receber mensagens.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 flex flex-col items-center space-y-6">
          <div className="w-full">
            <h3 className="text-[10px] font-black text-black uppercase tracking-[0.2em] mb-4 border-b-2 border-orange-500 w-fit pb-1">Instruções de Emparelhamento</h3>
            <p className="text-xs text-slate-400 font-bold leading-relaxed">
              Abra o WhatsApp no seu celular &gt; Configurações &gt; Dispositivos Conectados &gt; Conectar um dispositivo e aponte a câmera.
            </p>
          </div>

          <div className="relative group">
            {instanceStatus === 'open' ? (
              <div className="w-56 h-56 bg-green-50 rounded-[40px] flex flex-col items-center justify-center shadow-inner border-2 border-green-100 animate-fadeIn">
                <span className="text-6xl mb-4">✅</span>
                <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Ativo</span>
              </div>
            ) : qrCode ? (
              <div className="p-5 bg-white border-4 border-black rounded-[40px] shadow-2xl animate-scaleUp">
                <img src={qrCode.startsWith('data:image') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code Evolution" className="w-48 h-48" />
              </div>
            ) : (
              <div className="w-56 h-56 bg-slate-50 rounded-[40px] flex items-center justify-center text-4xl grayscale opacity-30 border-2 border-dashed border-slate-200">
                <span className="animate-pulse">💤</span>
              </div>
            )}
            
            {loading && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-sm rounded-[40px] flex items-center justify-center z-10">
                <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>

          <div className="w-full space-y-4">
            <button
              onClick={() => handleConnect(false)}
              disabled={loading || instanceStatus === 'open'}
              className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl active:scale-95 ${instanceStatus === 'open' ? 'bg-slate-100 text-slate-400 cursor-default' : 'bg-orange-500 text-white hover:bg-black shadow-orange-100'}`}
            >
              {loading ? 'SINCRONIZANDO...' : instanceStatus === 'open' ? 'CONEXÃO ATIVA' : 'SOLICITAR QR CODE'}
            </button>

            {tenantSlug && (
              <button
                onClick={() => {
                  const url = `${window.location.origin}/agendar/${tenantSlug}`;
                  window.open(url, '_blank');
                }}
                className="w-full bg-white border-2 border-slate-100 text-slate-600 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:border-orange-500 hover:text-orange-500 transition-all flex items-center justify-center gap-2"
              >
                <span>🔗</span>
                <span>Ver Link Web de Agendamento</span>
              </button>
            )}

            {instanceStatus === 'open' && (
              <button
                disabled={loading}
                onClick={() => { if (confirm('Isso irá desconectar o WhatsApp desta instância. Você precisará escanear o QR Code novamente para reconectar. Continuar?')) handleDisconnect(); }}
                className="w-full bg-white text-red-400 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all border-2 border-red-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                {loading ? 'AGUARDE...' : 'Desconectar WhatsApp'}
              </button>
            )}

            <button
              disabled={loading}
              onClick={() => { if(confirm("Isso encerrará a sessão WhatsApp atual e gerará um novo QR Code. Deseja continuar?")) handleConnect(true); }}
              className="w-full bg-white text-slate-300 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:text-red-500 hover:border-red-100 transition-all border-2 border-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? 'AGUARDE...' : 'Reiniciar Instância (Nova Sessão)'}
            </button>

            {/* Force sync button */}
            <button
              disabled={loading || syncing}
              onClick={handleForceSync}
              className="w-full bg-slate-900 text-orange-400 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-black hover:text-orange-500 transition-all border-2 border-slate-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {syncing
                ? <><span className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />SINCRONIZANDO...</>
                : <><span>⚡</span><span>Forçar Sincronização com Evolution API</span></>
              }
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-100 p-6 rounded-[30px] w-full animate-fadeIn">
              <p className="text-red-600 text-[10px] font-black uppercase text-center leading-relaxed tracking-widest">
                ⚠️ {error}
              </p>
            </div>
          )}
        </div>

        <div className="bg-black p-6 rounded-[50px] shadow-2xl flex flex-col h-[560px] border-4 border-slate-900">
           <div className="flex justify-between items-center mb-8">
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <h3 className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em]">Console de Integração</h3>
              </div>
              <button onClick={() => setLogs([])} className="text-[9px] font-black text-slate-600 uppercase hover:text-white transition-colors">Limpar Logs</button>
           </div>
           <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
              {logs.map((log, i) => (
                <div key={i} className="font-mono text-[10px] leading-relaxed animate-fadeIn border-l-2 border-slate-800 pl-4 py-1">
                   <div className="flex justify-between mb-1">
                     <span className={log.type === 'ERROR' ? 'text-red-500 font-black' : log.type === 'SUCCESS' ? 'text-green-500 font-black' : 'text-orange-500 font-black'}>{log.type}</span>
                     <span className="text-slate-700 text-[8px]">{log.timestamp}</span>
                   </div>
                   <div className="text-slate-300 break-words">{log.message}</div>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-800 opacity-50">
                   <span className="text-4xl mb-4">🖥️</span>
                   <p className="font-mono text-[9px] uppercase font-black tracking-widest text-center">Aguardando comandos do sistema...</p>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default EvolutionConfig;
