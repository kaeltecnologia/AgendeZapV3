import { useEffect, useState } from 'react';

// Novo visual: ativo quando <html> tem a classe `nv` (ligada em App.tsx via ?nv=1
// ou global_settings.new_visual='all'). Reage quando a classe muda.
const hasNv = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('nv');

export function useNewVisual(): boolean {
  const [on, setOn] = useState<boolean>(hasNv);
  useEffect(() => {
    setOn(hasNv());
    const obs = new MutationObserver(() => setOn(hasNv()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return on;
}
