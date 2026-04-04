// @ts-nocheck
// ErrorBoundary requires a class component; ts-nocheck bypasses React 19 type quirks with Component generics
import React from 'react';

const isChunkError = (err) =>
  err?.message?.includes('dynamically imported module') ||
  err?.message?.includes('Failed to fetch') ||
  err?.message?.includes('Loading chunk') ||
  err?.message?.includes('Loading CSS chunk');

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    // Auto-reload once on chunk load errors (new deploy invalidated old chunks)
    if (isChunkError(error) && !sessionStorage.getItem('agz_chunk_reload')) {
      sessionStorage.setItem('agz_chunk_reload', '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.error) {
      const chunkErr = isChunkError(this.state.error);
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center space-y-4">
          <span className="text-4xl">⚠️</span>
          <p className="font-black text-black text-sm uppercase tracking-widest">
            {chunkErr ? 'Atualização disponível' : 'Erro ao carregar esta tela'}
          </p>
          <p className="text-xs text-slate-400 max-w-xs">
            {chunkErr ? 'Uma nova versão foi publicada. Recarregue a página.' : this.state.error.message}
          </p>
          <button
            onClick={() => {
              if (chunkErr) {
                sessionStorage.removeItem('agz_chunk_reload');
                window.location.reload();
              } else {
                this.setState({ error: null });
                this.props.onReset?.();
              }
            }}
            className="mt-2 px-5 py-2 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all"
          >
            {chunkErr ? 'Recarregar página' : 'Tentar novamente'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
