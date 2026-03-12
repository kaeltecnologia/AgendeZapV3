import React from 'react';

interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center space-y-4">
          <span className="text-4xl">⚠️</span>
          <p className="font-black text-black text-sm uppercase tracking-widest">Erro ao carregar esta tela</p>
          <p className="text-xs text-slate-400 max-w-xs">{this.state.error.message}</p>
          <button
            onClick={this.reset}
            className="mt-2 px-5 py-2 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
