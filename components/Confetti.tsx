import React, { useEffect, useRef } from 'react';

interface ConfettiProps {
  active: boolean;
  onDone?: () => void;
}

const COLORS = ['#f97316', '#3b82f6', '#22c55e', '#facc15', '#ec4899', '#a855f7', '#14b8a6'];
const COUNT = 60;

const Confetti: React.FC<ConfettiProps> = ({ active, onDone }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    container.innerHTML = '';

    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const left = Math.random() * 100;
      const delay = Math.random() * 0.6;
      const duration = 1.8 + Math.random() * 1.2;
      const size = 6 + Math.random() * 8;
      const shape = Math.random() > 0.5 ? '50%' : '2px';
      el.style.cssText = `
        left:${left}vw; top:-20px;
        background:${color};
        width:${size}px; height:${size}px;
        border-radius:${shape};
        animation-duration:${duration}s;
        animation-delay:${delay}s;
      `;
      container.appendChild(el);
    }

    const timer = setTimeout(() => {
      container.innerHTML = '';
      onDone?.();
    }, 3000);

    return () => clearTimeout(timer);
  }, [active, onDone]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}
    />
  );
};

export default Confetti;
