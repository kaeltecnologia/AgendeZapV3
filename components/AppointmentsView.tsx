
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { Appointment, AppointmentStatus, BookingSource, PaymentMethod, Professional, Service, Customer, BreakPeriod, parseServiceIds, encodeServiceIds } from '../types';
import { sendProfessionalNotification, sendClientArrivedNotification, sendApptConfirmationToClient } from '../services/notificationService';
import { notifyWaitlistLeads } from '../services/waitlistService';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Returns YYYY-MM-DD using the browser's LOCAL timezone (not UTC). */
function localDateStr(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Visual calendar range picker ─────────────────────────────────────────────
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function MiniCalendar({ startDate, endDate, disabled, onChange }: {
  startDate: string; endDate: string; disabled?: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const [view, setView] = useState(() => {
    const d = startDate ? new Date(startDate + 'T12:00:00') : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [picking, setPicking] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const today = localDateStr();

  const toISO = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const prevMonth = () => setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  const handleClick = (iso: string) => {
    if (disabled) return;
    if (!picking) {
      setPicking(iso);
      onChange(iso, iso);
    } else {
      const [a, b] = iso < picking ? [iso, picking] : [picking, iso];
      onChange(a, b);
      setPicking(null);
      setHover(null);
    }
  };

  const eStart = picking && hover ? (hover < picking ? hover : picking) : startDate;
  const eEnd   = picking && hover ? (hover < picking ? picking : hover) : endDate;
  const isSingle = eStart === eEnd;

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const firstDay    = new Date(view.year, view.month, 1).getDay();

  return (
    <div className={disabled ? 'opacity-30 pointer-events-none select-none' : ''}>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
          <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="text-[11px] font-black text-black uppercase tracking-widest">
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button onClick={nextMonth} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
          <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['D','S','T','Q','Q','S','S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-black text-slate-300 py-1">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = toISO(view.year, view.month, day);
          const isStart   = iso === eStart;
          const isEnd     = iso === eEnd;
          const inRange   = !isSingle && eStart && eEnd && iso > eStart && iso < eEnd;
          const isToday   = iso === today;
          const isEdge    = isStart || isEnd;
          return (
            <div
              key={iso}
              onClick={() => handleClick(iso)}
              onMouseEnter={() => picking && setHover(iso)}
              onMouseLeave={() => picking && setHover(null)}
              className={`relative h-8 flex items-center justify-center cursor-pointer transition-all
                ${inRange ? 'bg-orange-50' : ''}
                ${inRange && isStart ? 'rounded-l-full' : ''}
                ${inRange && isEnd   ? 'rounded-r-full' : ''}
                ${!isSingle && isStart ? 'bg-orange-50 rounded-l-full' : ''}
                ${!isSingle && isEnd   ? 'bg-orange-50 rounded-r-full' : ''}
              `}
            >
              <span className={`w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-bold transition-all
                ${isEdge ? 'bg-black text-white font-black shadow-md' : ''}
                ${isToday && !isEdge ? 'ring-2 ring-orange-400 text-orange-500 font-black' : ''}
                ${!isEdge ? 'hover:bg-slate-100 text-slate-700' : ''}
              `}>
                {day}
              </span>
            </div>
          );
        })}
      </div>

      {/* Status line */}
      <div className="mt-3 text-center min-h-[16px]">
        {picking ? (
          <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest animate-pulse">
            Clique para definir o fim do período
          </p>
        ) : startDate && startDate !== endDate ? (
          <p className="text-[9px] font-bold text-slate-400">
            {startDate.split('-').reverse().join('/')} → {endDate.split('-').reverse().join('/')}
          </p>
        ) : startDate ? (
          <p className="text-[9px] font-bold text-slate-400">{startDate.split('-').reverse().join('/')}</p>
        ) : null}
      </div>
    </div>
  );
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

// ── Visual Week Calendar ──────────────────────────────────────────────────────
const PROF_COLORS = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#ef4444'];
const CATEGORY_COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#14b8a6'];
const HOUR_START = 6;
const HOUR_END = 24;
const HOUR_PX = 96; // px per hour

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

/** Compute side-by-side column layout for overlapping appointments (Google Calendar style) */
function computeApptLayout(appts: Appointment[]): Record<string, { col: number; totalCols: number }> {
  if (!appts.length) return {};
  const sorted = [...appts].sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const cols: string[][] = [];
  const colOf: Record<string, number> = {};

  for (const appt of sorted) {
    const start = new Date(appt.startTime).getTime();
    let placed = false;
    for (let c = 0; c < cols.length; c++) {
      const lastId = cols[c][cols[c].length - 1];
      const last = sorted.find(a => a.id === lastId)!;
      const lastEnd = new Date(last.startTime).getTime() + (last.durationMinutes || 30) * 60000;
      if (lastEnd <= start) {
        cols[c].push(appt.id);
        colOf[appt.id] = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      colOf[appt.id] = cols.length;
      cols.push([appt.id]);
    }
  }

  const result: Record<string, { col: number; totalCols: number }> = {};
  for (const appt of sorted) {
    const start = new Date(appt.startTime).getTime();
    const end = start + (appt.durationMinutes || 30) * 60000;
    let maxCol = colOf[appt.id];
    for (const other of sorted) {
      if (other.id === appt.id) continue;
      const os = new Date(other.startTime).getTime();
      const oe = os + (other.durationMinutes || 30) * 60000;
      if (start < oe && end > os) maxCol = Math.max(maxCol, colOf[other.id]);
    }
    result[appt.id] = { col: colOf[appt.id], totalCols: maxCol + 1 };
  }
  return result;
}

function useNow() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function WeekCalendar({
  days, appointments, customers, professionals, services, filterProfId, gridInterval = 30, onApptClick, onSlotClick,
}: {
  days: Date[];
  appointments: Appointment[];
  customers: Customer[];
  professionals: Professional[];
  services: Service[];
  filterProfId: string;
  gridInterval?: number;
  onApptClick: (a: Appointment) => void;
  onSlotClick: (date: string, time: string) => void;
}) {
  const todayStr = localDateStr();
  const now = useNow();
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const totalHeight = (HOUR_END - HOUR_START) * HOUR_PX;

  const categoryColorsMap = React.useMemo(() => {
    const cats = [...new Set(services.filter(s => s.category).map(s => s.category!))];
    return Object.fromEntries(cats.map((c, i) => [c, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]));
  }, [services]);
  const cols = days.length;

  // Current time indicator position
  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowPx = nowH >= HOUR_START && nowH < HOUR_END
    ? ((nowH - HOUR_START) * 60 + nowM) / 60 * HOUR_PX
    : null;

  return (
    <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      {/* Day header row */}
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${cols}, 1fr)`, borderBottom: '1px solid #E2E8F0' }}>
        <div style={{ borderRight: '1px solid #E2E8F0', background: '#F8FAFC' }} />
        {days.map((d, i) => {
          const dateStr = localDateStr(d);
          const isToday = dateStr === todayStr;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const dayApptCount = appointments.filter(a => a.startTime?.startsWith(dateStr)).length;
          return (
            <div key={i} style={{
              padding: '10px 4px',
              textAlign: 'center',
              borderRight: i < cols - 1 ? '1px solid #E2E8F0' : 'none',
              background: isToday ? '#FFF7ED' : isWeekend ? '#FAFAFA' : '#ffffff',
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: isToday ? '#f97316' : isWeekend ? '#94A3B8' : '#94A3B8', margin: 0 }}>
                {DAY_NAMES[d.getDay()]}
              </p>
              <div style={{
                margin: '4px auto 0',
                width: 32, height: 32, borderRadius: '50%',
                background: isToday ? '#f97316' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <p style={{ fontSize: 15, fontWeight: 800, lineHeight: 1, margin: 0, color: isToday ? '#ffffff' : isWeekend ? '#94A3B8' : '#1E293B' }}>
                  {d.getDate()}
                </p>
              </div>
              {dayApptCount > 0 && (
                <div style={{
                  margin: '4px auto 0', width: 'fit-content',
                  borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '2px 6px',
                  background: isToday ? '#FFEDD5' : '#F1F5F9',
                  color: isToday ? '#EA580C' : '#64748B',
                }}>
                  {dayApptCount}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div style={{ overflowY: 'auto', maxHeight: 560 }}>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `56px repeat(${cols}, 1fr)`, height: totalHeight }}>
          {/* Time labels column */}
          <div style={{ borderRight: '1px solid #E2E8F0', background: '#F8FAFC', position: 'relative', height: totalHeight }}>
            {hours.map(h => (
              <div
                key={h}
                style={{ position: 'absolute', width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 4, top: `${(h - HOUR_START) * HOUR_PX}px`, height: `${HOUR_PX}px` }}
              >
                <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, dayIdx) => {
            const dateStr = localDateStr(d);
            const isToday = dateStr === todayStr;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const dayAppts = appointments.filter(a => a.startTime?.startsWith(dateStr));

            return (
              <div
                key={dayIdx}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-appt]')) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const relY = e.clientY - rect.top;
                  const totalMins = HOUR_START * 60 + Math.round((relY / HOUR_PX) * 60 / 15) * 15;
                  const h = Math.floor(totalMins / 60);
                  const m = totalMins % 60;
                  if (h >= HOUR_START && h < HOUR_END) {
                    onSlotClick(dateStr, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                  }
                }}
                style={{
                  position: 'relative',
                  borderRight: dayIdx < cols - 1 ? '1px solid #E2E8F0' : 'none',
                  background: isWeekend && !isToday ? '#FAFAFA' : '#ffffff',
                  height: totalHeight,
                  cursor: 'pointer',
                }}
              >
                {/* Horizontal grid lines (interval-based) */}
                {Array.from({ length: Math.ceil((HOUR_END - HOUR_START) * 60 / gridInterval) }, (_, i) => i * gridInterval).map(mins => {
                  const isHour = mins % 60 === 0;
                  return (
                    <div key={mins} style={{
                      position: 'absolute', width: '100%',
                      top: `${(mins / 60) * HOUR_PX}px`, height: 1,
                      background: isHour ? '#E2E8F0' : 'transparent',
                      backgroundImage: isHour ? 'none' : 'repeating-linear-gradient(90deg,#E2E8F0 0,#E2E8F0 4px,transparent 4px,transparent 8px)',
                    }} />
                  );
                })}

                {/* Current time indicator */}
                {isToday && nowPx !== null && (
                  <div style={{ position: 'absolute', width: '100%', zIndex: 10, display: 'flex', alignItems: 'center', top: `${nowPx}px` }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', marginLeft: -4, flexShrink: 0 }} />
                    <div style={{ flex: 1, height: 1.5, background: '#f97316' }} />
                  </div>
                )}

                {/* Appointment blocks — with overlap layout */}
                {(() => {
                  const layout = computeApptLayout(dayAppts);
                  return dayAppts.map(a => {
                    const startDt = new Date(a.startTime);
                    const startH = startDt.getHours();
                    const startM = startDt.getMinutes();
                    if (startH < HOUR_START || startH >= HOUR_END) return null;

                    const topPx = ((startH - HOUR_START) * 60 + startM) / 60 * HOUR_PX;
                    const heightPx = Math.max(28, (a.durationMinutes || 30) / 60 * HOUR_PX - 2);

                    const profIdx = professionals.findIndex(p => p.id === a.professional_id);
                    const color = PROF_COLORS[profIdx >= 0 ? profIdx % PROF_COLORS.length : 0];
                    const cust = customers.find(c => c.id === a.customer_id);
                    const svc = services.find(s => s.id === a.service_id);
                    const isCancelled = a.status === AppointmentStatus.CANCELLED;
                    const isFinished = a.status === AppointmentStatus.FINISHED;
                    const isBilled = isFinished && (a.amountPaid !== undefined && a.amountPaid > 0);
                    const hasPlan = !!a.isPlan;

                    const catColor = svc?.category ? (categoryColorsMap[svc.category] ?? color) : color;
                    const [cr, cg, cb] = isCancelled ? [203, 213, 225] : hexToRgb(catColor);
                    const bgAlpha = isCancelled ? 0.05 : isFinished ? 0.10 : 0.18;
                    const bgColor = `rgba(${cr},${cg},${cb},${bgAlpha})`;
                    const borderColor = isCancelled ? '#CBD5E1' : color;

                    const { col, totalCols } = layout[a.id] ?? { col: 0, totalCols: 1 };
                    const widthPct = (100 / totalCols).toFixed(2);
                    const leftPct = (col * 100 / totalCols).toFixed(2);
                    const colW = `calc(${widthPct}% - 4px)`;
                    const leftPos = `calc(${leftPct}% + 2px)`;

                    const endDt = new Date(startDt.getTime() + (a.durationMinutes || 30) * 60000);
                    const timeRange = `${startDt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}–${endDt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

                    return (
                      <div
                        key={a.id}
                        data-appt="1"
                        onClick={(e) => { e.stopPropagation(); onApptClick(a); }}
                        style={{
                          position: 'absolute',
                          top: `${topPx}px`, height: `${heightPx}px`,
                          left: leftPos, width: colW,
                          borderRadius: 7, cursor: 'pointer', overflow: 'hidden',
                          backgroundColor: bgColor,
                          borderLeft: `3px solid ${borderColor}`,
                          boxShadow: `0 1px 3px rgba(0,0,0,0.08)`,
                          opacity: isCancelled ? 0.45 : 1,
                          transition: 'transform 0.1s, box-shadow 0.1s',
                          zIndex: 3,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.015)'; (e.currentTarget as HTMLElement).style.zIndex = '20'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.zIndex = '3'; }}
                      >
                        <div style={{ padding: '3px 6px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', overflow: 'hidden', position: 'relative' }}>
                          {(isBilled || hasPlan) && (
                            <div style={{ position: 'absolute', top: 2, right: 4, display: 'flex', gap: 2, fontSize: 10, lineHeight: 1 }}>
                              {isBilled && <span title="Faturado">💲</span>}
                              {hasPlan && <span title="Plano">🎟️</span>}
                            </div>
                          )}
                          <p style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, margin: 0, color: borderColor, fontVariantNumeric: 'tabular-nums', paddingRight: (isBilled || hasPlan) ? 18 : 0 }}>
                            {timeRange}
                          </p>
                          {heightPx >= 38 && (
                            <p style={{ fontSize: 11, fontWeight: 600, color: '#1E293B', lineHeight: 1.3, margin: '2px 0 0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                              {cust?.name || '—'}
                            </p>
                          )}
                          {heightPx >= 56 && svc && (
                            <p style={{ fontSize: 10, color: '#64748B', lineHeight: 1.3, margin: '1px 0 0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{svc.name}</p>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* Professional legend */}
      {professionals.length > 0 && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {professionals
            .filter(p => !filterProfId || p.id === filterProfId)
            .map(p => {
              const idx = professionals.findIndex(pr => pr.id === p.id);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: PROF_COLORS[idx >= 0 ? idx % PROF_COLORS.length : 0] }} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#475569' }}>{p.name}</span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function DayCalendar({
  date, appointments, customers, professionals, services, filterProfId, breaks = [], breakColor = '#f97316', gridInterval = 30, operatingHours, onApptClick, onSlotClick, onReorder, onApptRightClick, onBreakRightClick,
}: {
  date: Date;
  appointments: Appointment[];
  customers: Customer[];
  professionals: Professional[];
  services: Service[];
  filterProfId: string;
  breaks?: BreakPeriod[];
  breakColor?: string;
  gridInterval?: number;
  operatingHours?: Record<number, { active: boolean; range: string }>;
  onApptClick: (a: Appointment) => void;
  onSlotClick: (date: string, time: string, profId?: string) => void;
  onReorder?: (newOrder: string[]) => void;
  onApptRightClick?: (appt: Appointment, x: number, y: number) => void;
  onBreakRightClick?: (brk: BreakPeriod, x: number, y: number) => void;
}) {
  const todayStr = localDateStr();
  const dateStr = localDateStr(date);
  const now = useNow();
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const totalHeight = (HOUR_END - HOUR_START) * HOUR_PX;

  const visibleProfs = filterProfId
    ? professionals.filter(p => p.id === filterProfId)
    : professionals;
  const cols = Math.max(1, visibleProfs.length);

  const isToday = dateStr === todayStr;
  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowPx = isToday && nowH >= HOUR_START && nowH < HOUR_END
    ? ((nowH - HOUR_START) * 60 + nowM) / 60 * HOUR_PX
    : null;

  const dayAppts = appointments.filter(a => a.startTime?.startsWith(dateStr));

  // Scroll-sync refs — header scrolls in tandem with body (horizontal only).
  // Fixed column width (px) ensures header and body column borders are always pixel-perfect.
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef   = useRef<HTMLDivElement>(null);
  // Columns fill available width (1fr) but never shrink below 100px each.
  // Both header and body use the same minWidth so their 1fr resolves identically.
  const MIN_COL_W = 100; // px minimum per column
  const minGridW = 57 + cols * MIN_COL_W;
  const colTemplate = `56px repeat(${cols}, minmax(${MIN_COL_W}px, 1fr))`;

  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (headerRef.current) headerRef.current.scrollLeft = (e.currentTarget as HTMLDivElement).scrollLeft;
  };

  // ── Operating hours gray tarja helper ─────────────────────────────────
  const parseOpHours = (dayIndex: number) => {
    const cfg = operatingHours?.[dayIndex];
    if (!cfg || !cfg.active) return { openPx: 0, closePx: totalHeight };
    const toMins = (s: string) => { const [h, m] = (s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
    const [openStr, closeStr] = (cfg.range || '00:00-23:59').split('-');
    const openPx  = Math.max(0, Math.min(totalHeight, ((toMins(openStr)  - HOUR_START * 60) / 60) * HOUR_PX));
    const closePx = Math.max(0, Math.min(totalHeight, ((toMins(closeStr) - HOUR_START * 60) / 60) * HOUR_PX));
    return { openPx, closePx };
  };

  // ── Category color map (auto-palette by appearance order) ────────────
  const categoryColorsMap = React.useMemo(() => {
    const cats = [...new Set(services.filter(s => s.category).map(s => s.category!))];
    return Object.fromEntries(cats.map((c, i) => [c, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]));
  }, [services]);

  // ── Hover ghost state ────────────────────────────────────────────────
  const [hoverInfo, setHoverInfo] = useState<{ colId: string; y: number; timeStr: string } | null>(null);

  // ── Drag-to-reorder state ──────────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

      {/* ── Professional header ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0' }}>
        {/* Fixed 56px spacer — never scrolls, mirrors sticky time-label in body */}
        <div style={{ width: 56, flexShrink: 0, borderRight: '1px solid #E2E8F0', background: '#F8FAFC' }} />
        {/* Scrollable professional names — synced with body via JS */}
        <div ref={headerRef} style={{ flex: 1, overflowX: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(${MIN_COL_W}px, 1fr))`, minWidth: cols * MIN_COL_W }}>
          {visibleProfs.map((p, i) => {
            const profIdx = professionals.findIndex(pr => pr.id === p.id);
            const color = PROF_COLORS[profIdx >= 0 ? profIdx % PROF_COLORS.length : 0];
            const profDayCount = dayAppts.filter(a => a.professional_id === p.id).length;
            const isDragging  = dragIdx === i;
            const isDropTarget = hoverIdx === i && dragIdx !== null && dragIdx !== i;
            return (
              <div
                key={p.id}
                draggable={!!onReorder}
                onDragStart={() => { setDragIdx(i); setHoverIdx(null); }}
                onDragOver={e => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) setHoverIdx(i); }}
                onDragLeave={() => setHoverIdx(null)}
                onDrop={e => {
                  e.preventDefault();
                  if (dragIdx === null || dragIdx === i || !onReorder) return;
                  const reordered = [...visibleProfs];
                  const [moved] = reordered.splice(dragIdx, 1);
                  reordered.splice(i, 0, moved);
                  setDragIdx(null);
                  setHoverIdx(null);
                  onReorder(reordered.map(pr => pr.id));
                }}
                onDragEnd={() => { setDragIdx(null); setHoverIdx(null); }}
                style={{
                  padding: '10px 8px',
                  textAlign: 'center',
                  borderRight: i < cols - 1 ? '1px solid #E2E8F0' : 'none',
                  background: isDropTarget ? '#FFF7ED' : '#ffffff',
                  cursor: onReorder ? 'grab' : 'default',
                  opacity: isDragging ? 0.45 : 1,
                  transition: 'background 0.15s, opacity 0.15s',
                  outline: isDropTarget ? '2px solid #f97316' : 'none',
                  outlineOffset: -2,
                  userSelect: 'none',
                }}>
                {onReorder && (
                  <div style={{ fontSize: 9, color: '#CBD5E1', letterSpacing: 2, marginBottom: 2, lineHeight: 1 }}>⠿⠿</div>
                )}
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{p.name.charAt(0).toUpperCase()}</span>
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', margin: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '100%' }}>{p.name}</p>
                {profDayCount > 0 && (
                  <div style={{ margin: '3px auto 0', width: 'fit-content', borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '2px 6px', background: '#FEF3C7', color: '#92400E' }}>
                    {profDayCount}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* ── Time grid (scrollable: X + Y) ── */}
      <div ref={bodyRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 560 }} onScroll={onBodyScroll}>
        <div style={{ display: 'grid', gridTemplateColumns: colTemplate, minWidth: minGridW, width: '100%', height: totalHeight, position: 'relative' }}>

          {/* Time labels — sticky left so they don't scroll away horizontally */}
          <div style={{ borderRight: '1px solid #E2E8F0', background: '#F8FAFC', position: 'sticky', left: 0, zIndex: 2, height: totalHeight }}>
            {hours.map(h => (
              <div key={h} style={{ position: 'absolute', width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 4, top: `${(h - HOUR_START) * HOUR_PX}px`, height: `${HOUR_PX}px` }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {/* Professional columns */}
          {visibleProfs.map((p, colIdx) => {
            const globalProfIdx = professionals.findIndex(pr => pr.id === p.id);
            const color = PROF_COLORS[globalProfIdx >= 0 ? globalProfIdx % PROF_COLORS.length : 0];
            const profAppts = dayAppts.filter(a => a.professional_id === p.id);
            const layout = computeApptLayout(profAppts);

            return (
              <div key={p.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-appt]')) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const relY = e.clientY - rect.top;
                  const totalMins = HOUR_START * 60 + Math.round((relY / HOUR_PX) * 60 / gridInterval) * gridInterval;
                  const h = Math.floor(totalMins / 60);
                  const m = totalMins % 60;
                  if (h >= HOUR_START && h < HOUR_END) {
                    onSlotClick(dateStr, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, p.id);
                  }
                }}
                onMouseMove={(e) => {
                  if ((e.target as HTMLElement).closest('[data-appt]')) { setHoverInfo(null); return; }
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const relY = e.clientY - rect.top;
                  const totalMins = HOUR_START * 60 + Math.round((relY / HOUR_PX) * 60 / gridInterval) * gridInterval;
                  const snappedY = ((totalMins - HOUR_START * 60) / 60) * HOUR_PX;
                  const h = Math.floor(totalMins / 60);
                  const m = totalMins % 60;
                  if (h >= HOUR_START && h < HOUR_END) {
                    setHoverInfo({ colId: p.id, y: snappedY, timeStr: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` });
                  }
                }}
                onMouseLeave={() => setHoverInfo(null)}
                style={{
                  position: 'relative',
                  borderRight: colIdx < cols - 1 ? '1px solid #E2E8F0' : 'none',
                  background: isToday ? '#FFFBF7' : '#ffffff',
                  height: totalHeight,
                  cursor: 'pointer',
                }}>

                {/* Horizontal grid lines (interval-based) */}
                {Array.from({ length: Math.ceil((HOUR_END - HOUR_START) * 60 / gridInterval) }, (_, i) => i * gridInterval).map(mins => {
                  const isHour = mins % 60 === 0;
                  return (
                    <div key={mins} style={{
                      position: 'absolute', width: '100%',
                      top: `${(mins / 60) * HOUR_PX}px`, height: 1,
                      background: isHour ? '#E2E8F0' : 'transparent',
                      backgroundImage: isHour ? 'none' : 'repeating-linear-gradient(90deg,#E2E8F0 0,#E2E8F0 4px,transparent 4px,transparent 8px)',
                      pointerEvents: 'none',
                    }} />
                  );
                })}

                {/* Tarja cinza — horários fora do atendimento */}
                {(() => {
                  const { openPx, closePx } = parseOpHours(date.getDay());
                  const s: React.CSSProperties = { position: 'absolute', left: 0, right: 0, background: 'rgba(100,116,139,0.22)', pointerEvents: 'none', zIndex: 1 };
                  return <>
                    {openPx > 0 && <div style={{ ...s, top: 0, height: openPx }} />}
                    {closePx < totalHeight && <div style={{ ...s, top: closePx, height: totalHeight - closePx }} />}
                  </>;
                })()}

                {/* Break / interval blocks */}
                {breaks.filter(b => {
                  // Holiday: specific date, all profs
                  if (b.type === 'holiday') return b.date === dateStr;
                  // Vacation: range of dates per professional
                  if (b.type === 'vacation') {
                    if (b.professionalId && b.professionalId !== p.id) return false;
                    const vacStart = b.date || '';
                    const vacEnd = (b as any).vacationEndDate || b.date || '';
                    return !!vacStart && dateStr >= vacStart && dateStr <= vacEnd;
                  }
                  // Professional match (null/absent = all profs)
                  if (b.professionalId && b.professionalId !== p.id) return false;
                  // Specific one-time date
                  if (b.date) return b.date === dateStr;
                  // Recurring weekly
                  if (b.dayOfWeek !== null && b.dayOfWeek !== undefined) return b.dayOfWeek === date.getDay();
                  // Every day
                  return true;
                }).map(b => {
                  const parseHM = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + (mm || 0); };
                  const startMins = parseHM(b.startTime);
                  const endMins   = parseHM(b.endTime);
                  const isAllDay  = startMins === 0 && endMins >= 23 * 60 + 55;

                  // Type-based color: vacation=purple, holiday=red, absence=amber, break/lunch=breakColor
                  const typeColor =
                    b.type === 'vacation' ? '#7c3aed' :
                    b.type === 'holiday'  ? '#dc2626' :
                    (b.label || '').startsWith('[ausencia]') ? '#d97706' :
                    breakColor;
                  const r = parseInt(typeColor.slice(1, 3), 16) || 249;
                  const g = parseInt(typeColor.slice(3, 5), 16) || 115;
                  const bv = parseInt(typeColor.slice(5, 7), 16) || 22;

                  if (isAllDay) {
                    return (
                      <div key={b.id}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onBreakRightClick?.(b, e.clientX, e.clientY); }}
                        style={{
                          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'auto', cursor: 'context-menu',
                          background: `repeating-linear-gradient(45deg, rgba(${r},${g},${bv},0.07) 0px, rgba(${r},${g},${bv},0.07) 8px, transparent 8px, transparent 16px)`,
                          borderLeft: `3px solid rgba(${r},${g},${bv},0.5)`,
                        }}>
                        <span style={{ position: 'sticky', top: 4, display: 'block', fontSize: 9, fontWeight: 800, color: typeColor, textTransform: 'uppercase', padding: '2px 6px', letterSpacing: '0.05em' }}>{b.label}</span>
                      </div>
                    );
                  }

                  // Clamp to visible hours
                  const visStartMins = Math.max(startMins, HOUR_START * 60);
                  const visEndMins   = Math.min(endMins, HOUR_END * 60);
                  if (visEndMins <= visStartMins) return null;

                  const topPx    = ((visStartMins - HOUR_START * 60) / 60) * HOUR_PX;
                  const heightPx = Math.max(18, ((visEndMins - visStartMins) / 60) * HOUR_PX);

                  const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

                  return (
                    <div key={b.id}
                      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onBreakRightClick?.(b, e.clientX, e.clientY); }}
                      style={{
                        position: 'absolute', left: 2, right: 2,
                        top: `${topPx}px`, height: `${heightPx}px`,
                        zIndex: 2, borderRadius: 6, pointerEvents: 'auto', cursor: 'context-menu',
                        backgroundColor: `rgba(${r},${g},${bv},0.12)`,
                        borderLeft: `3px solid ${typeColor}`,
                        backgroundImage: `repeating-linear-gradient(45deg, rgba(${r},${g},${bv},0.06) 0px, rgba(${r},${g},${bv},0.06) 4px, transparent 4px, transparent 8px)`,
                      }}>
                      {heightPx >= 22 && (
                        <div style={{ padding: '2px 5px', overflow: 'hidden' }}>
                          <p style={{ fontSize: 9, fontWeight: 800, color: typeColor, textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em', lineHeight: 1.3 }}>{b.label}</p>
                          {heightPx >= 34 && (
                            <p style={{ fontSize: 8, fontWeight: 600, color: typeColor, opacity: 0.75, margin: 0, lineHeight: 1.2 }}>{fmt(startMins)}–{fmt(endMins)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Appointment blocks */}
                {profAppts.map(a => {
                  const startDt = new Date(a.startTime);
                  const startH = startDt.getHours();
                  const startM = startDt.getMinutes();
                  if (startH < HOUR_START || startH >= HOUR_END) return null;

                  const topPx = ((startH - HOUR_START) * 60 + startM) / 60 * HOUR_PX;
                  const heightPx = Math.max(28, (a.durationMinutes || 30) / 60 * HOUR_PX - 2);

                  const cust = customers.find(c => c.id === a.customer_id);
                  const svc = services.find(s => s.id === a.service_id);
                  const isCancelled = a.status === AppointmentStatus.CANCELLED;
                  const isFinished = a.status === AppointmentStatus.FINISHED;
                  const isBilled = isFinished && (a.amountPaid !== undefined && a.amountPaid > 0);
                  const hasPlan = !!a.isPlan;

                  // bg color: category color (if service has category), else professional color
                  const catColor = svc?.category ? (categoryColorsMap[svc.category] ?? color) : color;
                  const [cr, cg, cb] = isCancelled ? [203, 213, 225] : hexToRgb(catColor);
                  const bgAlpha = isCancelled ? 0.05 : isFinished ? 0.10 : 0.18;
                  const bgColor = `rgba(${cr},${cg},${cb},${bgAlpha})`;
                  const borderColor = isCancelled ? '#CBD5E1' : color; // border = professional color

                  const { col, totalCols } = layout[a.id] ?? { col: 0, totalCols: 1 };
                  const widthPct = (100 / totalCols).toFixed(2);
                  const leftPct = (col * 100 / totalCols).toFixed(2);
                  const colW = `calc(${widthPct}% - 4px)`;
                  const leftPos = `calc(${leftPct}% + 2px)`;

                  const endDt = new Date(startDt.getTime() + (a.durationMinutes || 30) * 60000);
                  const timeRange = `${startDt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}–${endDt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

                  return (
                    <div
                      key={a.id}
                      data-appt="1"
                      onClick={(e) => { e.stopPropagation(); onApptClick(a); }}
                      style={{
                        position: 'absolute',
                        top: `${topPx}px`, height: `${heightPx}px`,
                        left: leftPos, width: colW,
                        borderRadius: 7, cursor: 'pointer', overflow: 'hidden',
                        backgroundColor: bgColor,
                        borderLeft: `3px solid ${borderColor}`,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        opacity: isCancelled ? 0.45 : 1,
                        transition: 'transform 0.1s, box-shadow 0.1s',
                        zIndex: 3,
                      }}
                      onContextMenu={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        onApptRightClick?.(a, e.clientX, e.clientY);
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1.015)';
                        (e.currentTarget as HTMLElement).style.zIndex = '20';
                        setHoverInfo(null);
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.transform = '';
                        (e.currentTarget as HTMLElement).style.zIndex = '3';
                      }}
                    >
                      <div style={{ padding: '3px 6px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', overflow: 'hidden', position: 'relative' }}>
                        {/* Emojis top-right */}
                        {(isBilled || hasPlan) && (
                          <div style={{ position: 'absolute', top: 2, right: 4, display: 'flex', gap: 2, fontSize: 10, lineHeight: 1 }}>
                            {isBilled && <span title="Faturado">💲</span>}
                            {hasPlan && <span title="Plano">🎟️</span>}
                          </div>
                        )}
                        <p style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, margin: 0, color: borderColor, fontVariantNumeric: 'tabular-nums', paddingRight: (isBilled || hasPlan) ? 18 : 0 }}>
                          {timeRange}
                        </p>
                        {heightPx >= 38 && (
                          <p style={{ fontSize: 11, fontWeight: 600, color: '#1E293B', lineHeight: 1.3, margin: '2px 0 0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                            {cust?.name || '—'}
                          </p>
                        )}
                        {heightPx >= 56 && svc && (
                          <p style={{ fontSize: 10, color: '#64748B', lineHeight: 1.3, margin: '1px 0 0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{svc.name}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Hover ghost line */}
                {hoverInfo?.colId === p.id && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: `${hoverInfo.y}px`, height: 1, background: '#94A3B8', pointerEvents: 'none', zIndex: 10 }}>
                    <span style={{ position: 'absolute', right: 4, top: -9, fontSize: 9, fontWeight: 700, color: '#475569', background: '#F1F5F9', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                      {hoverInfo.timeStr}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Current-time indicator — spans all professional columns */}
          {nowPx !== null && (
            <div style={{ position: 'absolute', left: 57, right: 0, top: `${nowPx}px`, zIndex: 5, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', marginLeft: -4, flexShrink: 0 }} />
              <div style={{ flex: 1, height: 1.5, background: '#f97316' }} />
            </div>
          )}
        </div>
      </div>

      {/* Category legend */}
      {Object.keys(categoryColorsMap).length > 0 && (
        <div style={{ padding: '6px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Categorias:</span>
          {Object.entries(categoryColorsMap).map(([cat, catClr]) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: catClr, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: '#475569' }}>{cat}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Navigation Day Picker (mini-calendar popup for dia view) ─────────────────
function NavDayPicker({ selectedDate, apptDays, onSelect }: {
  selectedDate: Date;
  apptDays: Set<string>;
  onSelect: (d: Date) => void;
}) {
  const [view, setView] = React.useState({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() });
  const today = localDateStr();
  const selectedStr = localDateStr(selectedDate);

  React.useEffect(() => {
    setView({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() });
  }, [selectedDate]);

  const prevMonth = () => setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const firstDay = new Date(view.year, view.month, 1).getDay();

  return (
    <div className="w-60">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
          <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button onClick={nextMonth} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
          <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['D','S','T','Q','Q','S','S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-black text-slate-300 py-0.5">{d}</div>
        ))}
      </div>
      {/* Days grid */}
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isSelected = iso === selectedStr;
          const isToday = iso === today;
          const hasAppts = apptDays.has(iso);
          return (
            <div key={iso} className="flex flex-col items-center mb-0.5">
              <button
                onClick={() => onSelect(new Date(iso + 'T12:00:00'))}
                className={`w-7 h-7 rounded-full text-[11px] font-bold transition-all flex items-center justify-center
                  ${isSelected ? 'bg-orange-500 text-white shadow-md' : ''}
                  ${isToday && !isSelected ? 'ring-2 ring-orange-400 text-orange-600 font-black' : ''}
                  ${!isSelected ? 'hover:bg-slate-100 text-slate-700' : ''}
                `}
              >
                {day}
              </button>
              <div className={`w-1 h-1 rounded-full ${hasAppts ? 'bg-orange-400' : 'invisible'}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AppointmentsView: React.FC<{ tenantId: string; onOpenComandas?: () => void; defaultProfessionalId?: string; readOnly?: boolean; refreshTicker?: number }> = ({ tenantId, onOpenComandas, defaultProfessionalId, readOnly = false, refreshTicker = 0 }) => {
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState<{
    id: string; basePrice: number; extraValue?: number; extraNote?: string;
    method?: PaymentMethod; status?: AppointmentStatus;
    professional_id?: string; service_id?: string; customer_id?: string;
    startTime?: string; source?: BookingSource; isPlan?: boolean;
  } | null>(null);
  const [showBreakModal, setShowBreakModal] = useState(false);

  const [calView, setCalView] = useState<'dia' | 'lista'>('dia');
  const [dayDate, setDayDate] = useState<Date>(new Date());
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday
    const mon = new Date(now);
    mon.setDate(now.getDate() + diff);
    return mon;
  });

  const [startDate, setStartDate] = useState<string>(localDateStr());
  const [endDate, setEndDate] = useState<string>(localDateStr());
  const [presetPeriod, setPresetPeriod] = useState<string>('today');
  const [filterProfId, setFilterProfId] = useState<string>(defaultProfessionalId || '');

  const [showDayPicker, setShowDayPicker] = useState(false);
  const dayPickerRef = useRef<HTMLDivElement>(null);
  const hoverApptRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [calApptDays, setCalApptDays] = useState<Set<string>>(new Set());

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [breaks, setBreaks] = useState<BreakPeriod[]>([]);

  // new booking form
  interface BookingRow {
    rowId: string;
    category: string;
    svcId: string;
    profId: string;
    startTime: string;
    endTime: string;
    price: number;
  }
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [bookingRows, setBookingRows] = useState<BookingRow[]>([
    { rowId: crypto.randomUUID(), category: '', svcId: '', profId: '', startTime: '', endTime: '', price: 0 }
  ]);
  const [rowSvcSearch, setRowSvcSearch] = useState<Record<string, string>>({});
  const [openSvcDropdown, setOpenSvcDropdown] = useState<string | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingDiscount, setBookingDiscount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState('');

  // right-click appointment popup
  const [hoverAppt, setHoverAppt] = useState<{ appt: Appointment; x: number; y: number } | null>(null);
  // right-click break popup
  const [hoverBreak, setHoverBreak] = useState<{ brk: BreakPeriod; x: number; y: number } | null>(null);
  const [editingBreakId, setEditingBreakId] = useState<string | null>(null);
  useEffect(() => {
    if (!hoverAppt) return;
    const handler = (e: MouseEvent) => {
      const popup = document.querySelector('[data-popup="hover-appt"]');
      if (popup && !popup.contains(e.target as Node)) setHoverAppt(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHoverAppt(null); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [hoverAppt]);

  useEffect(() => {
    if (!hoverBreak) return;
    const handler = (e: MouseEvent) => {
      const popup = document.querySelector('[data-popup="hover-break"]');
      if (popup && !popup.contains(e.target as Node)) setHoverBreak(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHoverBreak(null); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [hoverBreak]);

  // inline new-customer creation (inside booking modal)
  const [showNewCustForm, setShowNewCustForm] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [creatingCust, setCreatingCust] = useState(false);

  // booking note
  const [bookingNote, setBookingNote] = useState('');

  // finish modal
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [extraValue, setExtraValue] = useState<number>(0);
  const [extraNote, setExtraNote] = useState('');
  const [editStatus, setEditStatus] = useState<AppointmentStatus>(AppointmentStatus.FINISHED);

  // search
  const [searchTerm, setSearchTerm] = useState('');

  // inline status editing
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);

  // appointment info panel (week view click)
  const [infoAppt, setInfoAppt] = useState<Appointment | null>(null);

  // ── Estorno / Ajuste de atendimento finalizado ─────────────────────
  const [estornoAppt, setEstornoAppt] = useState<Appointment | null>(null);
  const [estornoValor, setEstornoValor] = useState('');
  const [estornoPagamento, setEstornoPagamento] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [estornoObs, setEstornoObs] = useState('');
  const [estornoSaving, setEstornoSaving] = useState(false);

  // delete confirmation
  const [deleteApptId, setDeleteApptId] = useState<string | null>(null);
  const [deletingAppt, setDeletingAppt] = useState(false);

  // edit appointment (reschedule)
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [editProfId, setEditProfId] = useState('');
  const [editSvcIds, setEditSvcIds] = useState<string[]>([]);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editSlots, setEditSlots] = useState<string[]>([]);
  const [editSlotsLoading, setEditSlotsLoading] = useState(false);
  interface EditRow { rowId: string; svcId: string; startTime: string; endTime: string; price: number; }
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // break modal form
  const [brkLabel, setBrkLabel] = useState('');
  const [brkProfId, setBrkProfId] = useState('');
  const [brkType, setBrkType] = useState<'specific' | 'recurring' | 'holiday'>('recurring');
  const [brkAllDay, setBrkAllDay] = useState(true);
  const [brkDate, setBrkDate] = useState('');
  const [brkDayOfWeek, setBrkDayOfWeek] = useState<number>(1);
  const [brkStart, setBrkStart] = useState('12:00');
  const [brkEnd, setBrkEnd] = useState('13:00');

  // ── Break color (persisted in tenant_settings) ─────────────────────────
  const [breakColor, setBreakColor] = useState<string>('#f97316');
  const [calendarGridInterval, setCalendarGridInterval] = useState<number>(30);
  const [operatingHours, setOperatingHours] = useState<Record<number, { active: boolean; range: string }>>({});

  // ── Professional column order (persisted in tenant_settings) ──────────
  const [profOrder, setProfOrder] = useState<string[]>([]);

  const handleProfReorder = useCallback(async (newOrder: string[]) => {
    setProfOrder(newOrder);
    await db.updateSettings(tenantId, { professionalOrder: newOrder });
  }, [tenantId]);

  const refreshData = useCallback(async () => {
    const [apps, svcs, pros, custs, loadedBreaks, sett] = await Promise.all([
      db.getAppointments(tenantId),
      db.getServices(tenantId),
      db.getProfessionals(tenantId),
      db.getCustomers(tenantId),
      db.getBreaks(tenantId),
      db.getSettings(tenantId),
    ]);
    setServices(svcs);
    setProfessionals(pros);
    if (sett.professionalOrder?.length) setProfOrder(sett.professionalOrder);
    if (sett.breakColor) setBreakColor(sett.breakColor);
    if (sett.calendarGridInterval) setCalendarGridInterval(sett.calendarGridInterval);
    if (sett.operatingHours) setOperatingHours(sett.operatingHours as Record<number, { active: boolean; range: string }>);
    setBreaks(loadedBreaks);

    // Se há agendamentos com customer_id não encontrado na lista cacheada,
    // força reload fresco (acontece quando a IA cria novo cliente via webhook
    // e o cache de customers (TTL 2min) ainda não expirou).
    const custIdSet = new Set(custs.map(c => c.id));
    const hasUnresolved = apps.some(a => a.customer_id && !custIdSet.has(a.customer_id));
    const finalCusts = hasUnresolved ? await db.getCustomers(tenantId, { fresh: true }) : custs;
    setCustomers(finalCusts);

    let data = apps.filter(a => {
      if (!a.startTime) return false;
      const appDate = a.startTime.substring(0, 10);
      if (presetPeriod === 'all') return true;
      return appDate >= startDate && appDate <= endDate;
    });

    if (filterProfId) data = data.filter(a => a.professional_id === filterProfId);

    setAppointments(data.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
  }, [tenantId, startDate, endDate, presetPeriod, filterProfId, refreshTicker]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // Auto-refresh a cada 2min para mostrar agendamentos criados pela IA
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) refreshData(); }, 120_000);
    const onVisible = () => { if (!document.hidden) refreshData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [refreshData]);

  const gotoWeek = (mon: Date) => {
    const end = new Date(mon);
    end.setDate(mon.getDate() + 6);
    setWeekStart(mon);
    setStartDate(localDateStr(mon));
    setEndDate(localDateStr(end));
    setPresetPeriod('custom');
  };

  const gotoDay = (d: Date) => {
    setDayDate(d);
    setStartDate(localDateStr(d));
    setEndDate(localDateStr(d));
    setPresetPeriod('custom');
  };

  // Initialize day view on mount
  React.useEffect(() => {
    if (calView === 'dia') {
      gotoDay(dayDate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load appointment days for mini-calendar dots when picker opens
  React.useEffect(() => {
    if (!showDayPicker) return;
    db.getAppointments(tenantId).then(apps => {
      setCalApptDays(new Set(apps.map((a: Appointment) => a.startTime?.substring(0, 10)).filter(Boolean) as string[]));
    });
  }, [showDayPicker, tenantId]);

  // Close day picker on outside click
  React.useEffect(() => {
    if (!showDayPicker) return;
    const handler = (e: MouseEvent) => {
      if (dayPickerRef.current && !dayPickerRef.current.contains(e.target as Node)) {
        setShowDayPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDayPicker]);

  const applyPreset = (period: string) => {
    setPresetPeriod(period);
    const now = new Date();
    let start = new Date();
    let end = new Date();
    switch (period) {
      case 'today': start = new Date(); end = new Date(); break;
      case '7d': end = new Date(); end.setDate(now.getDate() + 7); break;
      case '14d': end = new Date(); end.setDate(now.getDate() + 14); break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'all': return;
    }
    if (period !== 'all') {
      setStartDate(localDateStr(start));
      setEndDate(localDateStr(end));
    }
  };

  const handleCreateAndSelectCustomer = async () => {
    if (!newCustName.trim() || !newCustPhone.trim()) return;
    setCreatingCust(true);
    try {
      const created = await db.addCustomer({ tenant_id: tenantId, name: newCustName.trim(), phone: newCustPhone.trim(), active: true });
      await refreshData();
      setCustomerId(created.id);
      setCustomerSearch('');
      setShowNewCustForm(false);
      setNewCustName('');
      setNewCustPhone('');
    } catch (e: any) {
      alert('Erro ao cadastrar: ' + (e.message || 'tente novamente.'));
    } finally {
      setCreatingCust(false);
    }
  };

  const openBookingModal = () => {
    setErrorMsg(''); setCustomerId(''); setCustomerSearch('');
    setBookingRows([{ rowId: crypto.randomUUID(), category: '', svcId: '', profId: '', startTime: '', endTime: '', price: 0 }]);
    setBookingDate(localDateStr()); setBookingDiscount(0); setBookingNote('');
    setShowNewCustForm(false); setNewCustName(''); setNewCustPhone('');
    setShowBookingModal(true);
  };

  const openBookingModalWithSlot = (date: string, time: string, slotProfId?: string) => {
    setErrorMsg(''); setCustomerId(''); setCustomerSearch('');
    setBookingRows([{ rowId: crypto.randomUUID(), category: '', svcId: '', profId: slotProfId ?? '', startTime: time, endTime: '', price: 0 }]);
    setBookingDate(date); setBookingDiscount(0); setBookingNote('');
    setShowNewCustForm(false); setNewCustName(''); setNewCustPhone('');
    setShowBookingModal(true);
  };

  // ── Booking helpers ──────────────────────────────────────────────────
  const calcEnd = (start: string, durationMin: number): string => {
    if (!start) return '';
    const [h, m] = start.split(':').map(Number);
    const total = h * 60 + m + durationMin;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const allBookingCategories = [...new Set(services.filter(s => s.category).map(s => s.category!))].sort();
  const bookingTotal = bookingRows.reduce((sum, r) => sum + (r.price || 0), 0) - (bookingDiscount || 0);

  const getServicesForRow = (row: BookingRow, search?: string) => {
    let svcs = services.filter(s => s.active !== false);
    if (row.profId) {
      const p = professionals.find(pr => pr.id === row.profId);
      if (p?.serviceIds?.length) svcs = svcs.filter(s => p.serviceIds!.includes(s.id));
    }
    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      svcs = svcs.filter(s => s.name.toLowerCase().includes(q));
    }
    return svcs;
  };

  const getProfsForRow = (row: BookingRow) => {
    if (!row.svcId) return professionals;
    return professionals.filter(p => !p.serviceIds?.length || p.serviceIds.includes(row.svcId));
  };

  const updateRow = (rowId: string, updates: Partial<BookingRow>) =>
    setBookingRows(prev => prev.map(r => r.rowId === rowId ? { ...r, ...updates } : r));

  const addBookingRow = () =>
    setBookingRows(prev => [...prev, { rowId: crypto.randomUUID(), category: '', svcId: '', profId: '', startTime: '', endTime: '', price: 0 }]);

  const removeBookingRow = (rowId: string) =>
    setBookingRows(prev => prev.filter(r => r.rowId !== rowId));

  const handleCreateBooking = async () => {
    const incomplete = bookingRows.some(r => !r.svcId || !r.profId || !r.startTime || !r.endTime);
    if (!customerId || !bookingDate || incomplete) {
      setErrorMsg('Por favor, preencha todos os campos.'); return;
    }
    try {
      const customer = customers.find(cu => cu.id === customerId);
      for (const row of bookingRows) {
        const [sh, sm] = row.startTime.split(':').map(Number);
        const [eh, em] = row.endTime.split(':').map(Number);
        const durationMinutes = Math.max(1, (eh * 60 + em) - (sh * 60 + sm));
        const startTimeISO = `${bookingDate}T${row.startTime}:00`;

        let isPlanAppt = false;
        if (customer?.planId && customer.planStatus === 'ativo') {
          const balance = await db.getPlanBalance(tenantId, customerId);
          if ((balance[row.svcId]?.remaining || 0) > 0) {
            isPlanAppt = true;
            await db.incrementPlanUsageMulti(tenantId, customerId, [row.svcId]);
          }
        }

        const newApp = await db.addAppointment({
          tenant_id: tenantId, customer_id: customerId,
          professional_id: row.profId, service_id: row.svcId, serviceIds: [row.svcId],
          startTime: startTimeISO, durationMinutes,
          status: AppointmentStatus.CONFIRMED,
          source: isPlanAppt ? BookingSource.PLAN : BookingSource.MANUAL,
          isPlan: isPlanAppt,
          extraNote: bookingNote || undefined,
        });
        sendProfessionalNotification(newApp);
      }
      setShowBookingModal(false); setErrorMsg('');
      // Expand visible range if bookingDate is outside current range
      if (presetPeriod !== 'all' && (bookingDate < startDate || bookingDate > endDate)) {
        if (bookingDate > endDate) setEndDate(bookingDate);
        if (bookingDate < startDate) setStartDate(bookingDate);
        setPresetPeriod('');
      } else {
        refreshData();
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Erro ao criar agendamento. Tente novamente.');
    }
  };

  const handleFinish = async () => {
    if (!showFinishModal) return;
    try {
      await db.updateAppointmentStatus(showFinishModal.id, editStatus, {
        paymentMethod, amountPaid: showFinishModal.basePrice + extraValue, extraNote, extraValue
      });
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
    }

    // When client arrives: notify + create comanda (best-effort, independent)
    if (editStatus === AppointmentStatus.ARRIVED) {
      // Notificar sempre, independente da comanda
      const fullApp = appointments.find(a => a.id === showFinishModal.id);
      if (fullApp) sendClientArrivedNotification(fullApp).catch(err =>
        console.warn('Notificação ARRIVED falhou:', err)
      );
      // Criar comanda (suporta múltiplos serviços)
      try {
        const svcIds: string[] = (showFinishModal as any).serviceIds?.length
          ? (showFinishModal as any).serviceIds
          : showFinishModal.service_id ? [showFinishModal.service_id] : [];
        const items = svcIds.map((svcId: string) => {
          const svc = services.find(s => s.id === svcId);
          return svc ? {
            id: generateId(), type: 'service' as const, itemId: svc.id,
            name: svc.name, qty: 1, unitPrice: svc.price,
            discountType: 'value' as const, discount: 0,
            professionalId: showFinishModal.professional_id,
          } : null;
        }).filter((x): x is NonNullable<typeof x> => x !== null);
        await db.createComanda({
          tenant_id: tenantId,
          appointment_id: showFinishModal.id,
          professional_id: showFinishModal.professional_id!,
          customer_id: showFinishModal.customer_id!,
          items,
          status: 'open',
        });
      } catch (err) {
        console.error('Erro ao criar comanda:', err);
      }
    }

    // When finished directly (not via comanda flow): create closed comanda record
    if (editStatus === AppointmentStatus.FINISHED) {
      try {
        const existingComandas = await db.getComandas(tenantId);
        const alreadyHas = existingComandas.some(c => c.appointment_id === showFinishModal.id);
        if (!alreadyHas) {
          const svcIds = (showFinishModal as any).serviceIds?.length
            ? (showFinishModal as any).serviceIds
            : showFinishModal.service_id ? [showFinishModal.service_id] : [];
          const items = (svcIds as string[]).map((svcId: string) => {
            const svc = services.find(s => s.id === svcId);
            return svc ? {
              id: generateId(), type: 'service' as const, itemId: svc.id,
              name: svc.name, qty: 1, unitPrice: svc.price,
              discountType: 'value' as const, discount: 0,
              professionalId: showFinishModal.professional_id,
            } : null;
          }).filter((x): x is NonNullable<typeof x> => x !== null);
          await db.createComanda({
            tenant_id: tenantId,
            appointment_id: showFinishModal.id,
            professional_id: showFinishModal.professional_id!,
            customer_id: showFinishModal.customer_id!,
            items,
            status: 'closed',
            paymentMethod,
            notes: extraNote || undefined,
            closedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Erro ao criar comanda ao finalizar:', err);
      }
    }

    setShowFinishModal(null);
    if (editStatus === AppointmentStatus.ARRIVED) {
      onOpenComandas?.();
    } else {
      refreshData();
    }
  };

  const handleDeleteAppointment = async () => {
    if (!deleteApptId) return;
    const idToDelete = deleteApptId;
    setDeletingAppt(true);
    setAppointments(prev => prev.filter(a => a.id !== idToDelete));
    setDeleteApptId(null);
    try {
      await db.deleteAppointment(idToDelete);
      refreshData();
    } catch (e) {
      console.error('Erro ao excluir agendamento:', e);
      refreshData();
    } finally {
      setDeletingAppt(false);
    }
  };

  const handleApptEstorno = async () => {
    if (!estornoAppt) return;
    setEstornoSaving(true);
    try {
      const newAmount = estornoValor !== '' ? parseFloat(estornoValor.replace(',', '.')) : estornoAppt.amountPaid;
      const safeAmount = (newAmount !== undefined && !isNaN(newAmount as number)) ? newAmount : estornoAppt.amountPaid;
      await db.updateAppointmentStatus(estornoAppt.id, AppointmentStatus.FINISHED, {
        paymentMethod: estornoPagamento,
        amountPaid: safeAmount,
        extraNote: estornoObs || estornoAppt.extraNote,
      });
      // Also update the related comanda if it exists
      try {
        const comandas = await db.getComandas(tenantId);
        const related = comandas.find(c => c.appointment_id === estornoAppt.id && c.status === 'closed');
        if (related) {
          await db.updateComanda(related.id, {
            paymentMethod: estornoPagamento,
            notes: estornoObs || related.notes,
            ...(safeAmount !== undefined ? { finalAmount: safeAmount as number } : {}),
          });
        }
      } catch {}
      setEstornoAppt(null);
      setEstornoValor('');
      setEstornoObs('');
      refreshData();
    } finally {
      setEstornoSaving(false);
    }
  };

  const openEditModal = (a: Appointment) => {
    const d = new Date(a.startTime);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const startHHMM = `${hh}:${mm}`;
    const svcIds = a.serviceIds?.length ? a.serviceIds : (a.service_id ? parseServiceIds(a.service_id) : []);
    let cumMin = 0;
    const rows: EditRow[] = svcIds.map(svcId => {
      const svc = services.find(s => s.id === svcId);
      const dur = svc?.durationMinutes || 30;
      const rs = calcEnd(startHHMM, cumMin);
      const re = calcEnd(startHHMM, cumMin + dur);
      cumMin += dur;
      return { rowId: crypto.randomUUID(), svcId, startTime: rs, endTime: re, price: svc?.price || 0 };
    });
    setEditAppt(a);
    setEditProfId(a.professional_id);
    setEditSvcIds(svcIds);
    setEditDate(a.startTime.split('T')[0]);
    setEditTime(startHHMM);
    setEditRows(rows.length ? rows : [{ rowId: crypto.randomUUID(), svcId: '', startTime: startHHMM, endTime: '', price: 0 }]);
    setEditSlots([]);
    setEditError('');
  };

  // Fetch available slots for the edit modal (called when prof+date+services change)
  const loadEditSlots = useCallback(async (pId: string, date: string, sIds: string[]) => {
    if (!pId || !date) { setEditSlots([]); return; }
    setEditSlotsLoading(true);
    try {
      const dur = sIds.length > 0
        ? services.filter(s => sIds.includes(s.id)).reduce((sum, s) => sum + s.durationMinutes, 0) || 30
        : 30;
      const settings = await db.getSettings(tenantId);
      const dateObj = new Date(date + 'T12:00:00');
      const dayIndex = dateObj.getDay();
      const dayConfig = settings.operatingHours?.[dayIndex];
      if (dayConfig && dayConfig.active === false) { setEditSlots([]); return; }

      // Use appointments from already-loaded state (fast, no extra fetch)
      const dayAppts = appointments.filter(a => {
        if (a.status === AppointmentStatus.CANCELLED || (a.status as string) === 'cancelado') return false;
        if (a.id === editAppt?.id) return false; // exclude self
        const aDate = a.startTime.substring(0, 10);
        return aDate === date && a.professional_id === pId;
      });

      const breaks: BreakPeriod[] = settings.breaks || [];
      const pad = (n: number) => String(n).padStart(2, '0');
      const INTERVAL = 30;
      const slots: string[] = [];
      let cursor = 6 * 60; // 06:00
      const endCursor = 24 * 60; // 00:00 meia-noite
      const loopLimit = endCursor - dur;

      while (cursor <= loopLimit) {
        const h = Math.floor(cursor / 60);
        const m = cursor % 60;
        const label = `${pad(h)}:${pad(m)}`;
        const slotStart = new Date(`${date}T${label}:00`);
        const slotEnd = new Date(slotStart.getTime() + dur * 60000);
        const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

        const BUFFER = 11 * 60 * 1000;
        const conflict = dayAppts.some(a => {
          const aStart = new Date(a.startTime);
          const aEnd = new Date(aStart.getTime() + a.durationMinutes * 60000);
          if (!(aStart < slotEnd && aEnd > slotStart)) return false;
          return slotStart.getTime() < aEnd.getTime() - BUFFER;
        });

        const brkConflict = breaks.some(brk => {
          if (brk.professionalId && brk.professionalId !== pId) return false;
          if ((brk as any).type === 'vacation') {
            const vacStart = brk.date || '';
            const vacEnd = (brk as any).vacationEndDate || brk.date || '';
            return !!vacStart && date >= vacStart && date <= vacEnd;
          }
          const matchDate = !brk.date || brk.date === date;
          const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
          if (!matchDate || !matchDay) return false;
          return label < brk.endTime && slotEndLabel > brk.startTime;
        });

        if (!conflict && !brkConflict) slots.push(label);
        cursor += INTERVAL;
      }
      setEditSlots(slots);
    } catch (e) {
      console.error('loadEditSlots error:', e);
      setEditSlots([]);
    } finally {
      setEditSlotsLoading(false);
    }
  }, [tenantId, services, appointments, editAppt]);

  useEffect(() => {
    if (editAppt) loadEditSlots(editProfId, editDate, editSvcIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editProfId, editDate, editSvcIds.join(','), editAppt, loadEditSlots]);

  // loadBookingSlots removed — new booking modal uses free-form time inputs

  const handleSaveEdit = async () => {
    if (!editAppt || !editProfId || !editDate) { setEditError('Preencha todos os campos.'); return; }
    const incomplete = editRows.length === 0 || editRows.some(r => !r.svcId || !r.startTime || !r.endTime);
    if (incomplete) { setEditError('Preencha serviço, início e fim de cada linha.'); return; }
    setSavingEdit(true);
    setEditError('');
    try {
      // First row: update existing appointment
      const r0 = editRows[0];
      const [sh, sm] = r0.startTime.split(':').map(Number);
      const [eh, em] = r0.endTime.split(':').map(Number);
      const dur0 = Math.max(1, (eh * 60 + em) - (sh * 60 + sm));
      await db.updateAppointmentSchedule(editAppt.id, editProfId, [r0.svcId], `${editDate}T${r0.startTime}:00`, dur0);
      // Additional rows: create new appointments
      for (const row of editRows.slice(1)) {
        const [rsh, rsm] = row.startTime.split(':').map(Number);
        const [reh, rem] = row.endTime.split(':').map(Number);
        const rdur = Math.max(1, (reh * 60 + rem) - (rsh * 60 + rsm));
        await db.addAppointment({
          tenant_id: tenantId, customer_id: editAppt.customer_id,
          professional_id: editProfId, service_id: row.svcId, serviceIds: [row.svcId],
          startTime: `${editDate}T${row.startTime}:00`, durationMinutes: rdur,
          status: editAppt.status, source: (editAppt.source || BookingSource.MANUAL) as BookingSource,
        });
      }
      setEditAppt(null);
      refreshData();
    } catch (e: any) {
      setEditError(e.message || 'Erro ao salvar. Tente novamente.');
    } finally {
      setSavingEdit(false);
    }
  };

  const openBreakModal = () => {
    setEditingBreakId(null);
    setBrkLabel(''); setBrkProfId(''); setBrkType('recurring');
    setBrkDate(''); setBrkDayOfWeek(1); setBrkStart('12:00'); setBrkEnd('13:00');
    setBrkAllDay(true);
    setShowBreakModal(true);
  };

  const openEditBreak = (brk: BreakPeriod) => {
    setEditingBreakId(brk.id);
    setBrkLabel(brk.label || '');
    setBrkProfId(brk.professionalId || '');
    const bType = brk.type === 'holiday' ? 'holiday' : brk.date ? 'specific' : 'recurring';
    setBrkType(bType);
    setBrkDate(brk.date || '');
    setBrkDayOfWeek(brk.dayOfWeek ?? 1);
    const isAllDay = brk.startTime === '00:00' && (brk.endTime === '23:59' || brk.endTime === '23:00');
    setBrkAllDay(isAllDay);
    setBrkStart(isAllDay ? '12:00' : brk.startTime);
    setBrkEnd(isAllDay ? '13:00' : brk.endTime);
    setShowBreakModal(true);
  };

  const handleCreateBreak = async () => {
    if (brkType === 'holiday') {
      if (!brkLabel || !brkDate) return;
      const newBreak: BreakPeriod = {
        id: editingBreakId || generateId(),
        label: brkLabel,
        type: 'holiday',
        professionalId: null,
        date: brkDate,
        dayOfWeek: null,
        startTime: brkAllDay ? '00:00' : brkStart,
        endTime: brkAllDay ? '23:59' : brkEnd,
      };
      const updated = editingBreakId
        ? breaks.map(b => b.id === editingBreakId ? newBreak : b)
        : [...breaks, newBreak];
      await db.saveBreaks(tenantId, updated);
      setBreaks(updated);
      setEditingBreakId(null);
      setShowBreakModal(false);
      return;
    }
    if (!brkLabel || !brkStart || !brkEnd) return;
    const newBreak: BreakPeriod = {
      id: editingBreakId || generateId(),
      label: brkLabel,
      professionalId: brkProfId || null,
      date: brkType === 'specific' ? (brkDate || null) : null,
      dayOfWeek: brkType === 'recurring' ? brkDayOfWeek : null,
      startTime: brkStart,
      endTime: brkEnd
    };
    const updated = editingBreakId
      ? breaks.map(b => b.id === editingBreakId ? newBreak : b)
      : [...breaks, newBreak];
    await db.saveBreaks(tenantId, updated);
    setBreaks(updated);
    setEditingBreakId(null);
    setShowBreakModal(false);
  };

  const handleDeleteBreak = async (id: string) => {
    const updated = breaks.filter(b => b.id !== id);
    await db.saveBreaks(tenantId, updated);
    setBreaks(updated);
  };

  const breakLabel = (b: BreakPeriod) => {
    if (b.type === 'holiday') {
      const dateStr = b.date ? new Date(b.date + 'T12:00:00').toLocaleDateString('pt-BR') : '';
      const isAllDay = b.startTime === '00:00' && (b.endTime === '23:59' || b.endTime === '23:00');
      return isAllDay ? `${dateStr} · Dia inteiro` : `${dateStr} · A partir das ${b.startTime}`;
    }
    const profName = b.professionalId
      ? professionals.find(p => p.id === b.professionalId)?.name || '?'
      : 'Todos';
    const when = b.date
      ? new Date(b.date + 'T12:00:00').toLocaleDateString('pt-BR')
      : b.dayOfWeek != null
        ? DAY_NAMES[b.dayOfWeek]
        : 'Diário';
    return `${b.startTime}–${b.endTime} · ${when} · ${profName}`;
  };

  const filteredForDisplay = searchTerm.trim()
    ? appointments.filter(a => {
        const c = customers.find(cu => cu.id === a.customer_id);
        const term = searchTerm.toLowerCase().trim();
        return (
          c?.name.toLowerCase().includes(term) ||
          c?.phone.includes(term)
        );
      })
    : appointments;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-black">Agenda</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Gestão de horários e períodos</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* View toggle */}
          <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => { setCalView('dia'); gotoDay(dayDate); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${calView === 'dia' ? 'bg-white text-black shadow-sm' : 'text-slate-500 hover:text-black'}`}
            >
              Dia
            </button>
            <button
              onClick={() => { setCalView('lista'); applyPreset('today'); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${calView === 'lista' ? 'bg-white text-black shadow-sm' : 'text-slate-500 hover:text-black'}`}
            >
              Lista
            </button>
          </div>
          {/* Grid interval selector */}
          {calView === 'dia' && (
            <select
              value={calendarGridInterval}
              onChange={e => {
                const v = Number(e.target.value);
                setCalendarGridInterval(v);
                db.updateSettings(tenantId, { calendarGridInterval: v });
              }}
              title="Divisão das linhas horizontais"
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#475569', cursor: 'pointer' }}
            >
              {[5, 10, 15, 20, 25, 30].map(v => (
                <option key={v} value={v}>{v}min</option>
              ))}
            </select>
          )}
          {!readOnly && (
            <button onClick={openBookingModal} className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-orange-600 transition-colors ml-auto sm:ml-0 whitespace-nowrap">
              + Novo Horário
            </button>
          )}
        </div>
      </div>

      {/* Day navigation (only in dia view) */}
      {calView === 'dia' && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => { const d = new Date(dayDate); d.setDate(d.getDate() - 1); gotoDay(d); }}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          {/* Clickable date — opens mini-calendar popup */}
          <div className="relative" ref={dayPickerRef}>
            <button
              onClick={() => setShowDayPicker(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-orange-300 hover:bg-orange-50 transition-colors group"
            >
              <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-orange-400 transition-colors shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span className="text-sm font-semibold text-slate-700 capitalize group-hover:text-orange-600 transition-colors whitespace-nowrap">
                {dayDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
            </button>

            {showDayPicker && (
              <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-4">
                <NavDayPicker
                  selectedDate={dayDate}
                  apptDays={calApptDays}
                  onSelect={(d) => { gotoDay(d); setShowDayPicker(false); }}
                />
              </div>
            )}
          </div>

          <button
            onClick={() => { const d = new Date(dayDate); d.setDate(d.getDate() + 1); gotoDay(d); }}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button
            onClick={() => gotoDay(new Date())}
            className="px-3 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Hoje
          </button>
        </div>
      )}

      {/* ─── Dia view (professional columns) ─── */}
      {calView === 'dia' && (
        <DayCalendar
          date={dayDate}
          appointments={appointments}
          customers={customers}
          professionals={
            profOrder.length
              ? [...professionals].sort((a, b) => {
                  const ia = profOrder.indexOf(a.id);
                  const ib = profOrder.indexOf(b.id);
                  if (ia === -1 && ib === -1) return 0;
                  if (ia === -1) return 1;
                  if (ib === -1) return -1;
                  return ia - ib;
                })
              : professionals
          }
          services={services}
          filterProfId={filterProfId}
          breaks={breaks}
          breakColor={breakColor}
          gridInterval={calendarGridInterval}
          operatingHours={operatingHours}
          onApptClick={(a) => setInfoAppt(a)}
          onSlotClick={readOnly ? () => {} : openBookingModalWithSlot}
          onReorder={handleProfReorder}
          onApptRightClick={(appt, x, y) => setHoverAppt({ appt, x: x + 12, y: y - 10 })}
          onBreakRightClick={(brk, x, y) => setHoverBreak({ brk, x: x + 12, y: y - 10 })}
        />
      )}

      {/* ─── Lista view (existing table layout) ─── */}
      {calView === 'lista' && (
      <div className="flex flex-col lg:flex-row gap-6">
        {/* ─── Sidebar ─────────────────────────────── */}
        <div className="w-full lg:w-72 shrink-0 space-y-6">

          {/* Professional Filter */}
          {!defaultProfessionalId && (
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <h3 className="font-black text-black text-xs uppercase tracking-widest">Filtrar por Profissional</h3>
            <select
              value={filterProfId}
              onChange={e => setFilterProfId(e.target.value)}
              className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-bold text-xs focus:border-orange-500 transition-colors"
            >
              <option value="">Todos os profissionais</option>
              {professionals.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {filterProfId && (
              <button onClick={() => setFilterProfId('')} className="text-[9px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors">
                ✕ Limpar filtro
              </button>
            )}
          </div>
          )}

          {/* Period Filter */}
          <div className="bg-white p-4 sm:p-6 md:p-8 rounded-[35px] border-2 border-slate-100 shadow-lg">
            <h3 className="font-black text-black mb-6 text-xs uppercase tracking-widest">Filtros de Período</h3>
            <div className="grid grid-cols-2 gap-2 mb-6">
              <PresetBtn active={presetPeriod === 'today'} onClick={() => applyPreset('today')} label="Hoje" />
              <PresetBtn active={presetPeriod === '7d'} onClick={() => applyPreset('7d')} label="7 Dias" />
              <PresetBtn active={presetPeriod === '14d'} onClick={() => applyPreset('14d')} label="14 Dias" />
              <PresetBtn active={presetPeriod === 'month'} onClick={() => applyPreset('month')} label="Este Mês" />
              <PresetBtn active={presetPeriod === 'all'} onClick={() => applyPreset('all')} label="Tudo" />
            </div>
            <div className="pt-4 border-t border-slate-50">
              <MiniCalendar
                startDate={startDate}
                endDate={endDate}
                disabled={presetPeriod === 'all'}
                onChange={(start, end) => { setStartDate(start); setEndDate(end); setPresetPeriod('custom'); }}
              />
            </div>
            <div className="mt-10 pt-6 border-t border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Período</span>
                <span className="text-xl font-black text-black">{filteredForDisplay.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concluídos</span>
                <span className="text-xl font-black text-orange-500">{filteredForDisplay.filter(a => a.status === AppointmentStatus.FINISHED).length}</span>
              </div>
            </div>
          </div>

          {/* Holidays */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-black text-xs uppercase tracking-widest">Feriados</h3>
              <button
                onClick={() => { openBreakModal(); setBrkType('holiday'); setBrkLabel('Feriado'); setBrkAllDay(true); }}
                className="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-all"
              >
                + Feriado
              </button>
            </div>
            {breaks.filter(b => b.type === 'holiday').length === 0 ? (
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center py-4">Nenhum feriado cadastrado</p>
            ) : (
              <div className="space-y-2">
                {breaks.filter(b => b.type === 'holiday').map(b => (
                  <div key={b.id} className="flex items-start justify-between bg-red-50 rounded-2xl p-3 gap-2">
                    <div>
                      <p className="text-[10px] font-black text-red-700 uppercase">{b.label}</p>
                      <p className="text-[9px] font-bold text-red-400 mt-0.5">{breakLabel(b)}</p>
                    </div>
                    <button onClick={() => handleDeleteBreak(b.id)} className="text-red-300 hover:text-red-600 text-xs font-black transition-colors shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Break Periods */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <div className="flex justify-between items-center gap-2">
              <h3 className="font-black text-black text-xs uppercase tracking-widest">Intervalos</h3>
              <div className="flex items-center gap-2 ml-auto">
                {/* Break color picker */}
                <label title="Cor dos intervalos na agenda" style={{ cursor: 'pointer', width: 22, height: 22, borderRadius: '50%', background: breakColor, border: '2px solid #e2e8f0', display: 'inline-block', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                  <input type="color" value={breakColor} onChange={e => setBreakColor(e.target.value)} onBlur={e => db.updateSettings(tenantId, { breakColor: e.target.value })} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                </label>
                <button
                  onClick={openBreakModal}
                  className="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border-2 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white transition-all"
                >
                  + Gerar
                </button>
              </div>
            </div>
            {breaks.filter(b => b.type !== 'holiday').length === 0 ? (
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center py-4">Nenhum intervalo cadastrado</p>
            ) : (
              <div className="space-y-2">
                {breaks
                  .filter(b => b.type !== 'holiday')
                  .filter(b => !filterProfId || !b.professionalId || b.professionalId === filterProfId)
                  .map(b => (
                    <div key={b.id} className="flex items-start justify-between bg-slate-50 rounded-2xl p-3 gap-2">
                      <div>
                        <p className="text-[10px] font-black text-black uppercase">{b.label}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{breakLabel(b)}</p>
                      </div>
                      <button onClick={() => handleDeleteBreak(b.id)} className="text-slate-300 hover:text-red-500 text-xs font-black transition-colors shrink-0">✕</button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Appointments Table ────────────────── */}
        <div className="flex-1 space-y-4">
          {/* Search bar */}
          <div className="bg-white rounded-[24px] border-2 border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm">
            <svg className="w-4 h-4 text-slate-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por nome ou telefone..."
              className="flex-1 bg-transparent outline-none text-xs font-black uppercase tracking-widest text-black placeholder:text-slate-300"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-slate-300 hover:text-red-400 font-black text-xs transition-colors">✕</button>
            )}
          </div>

          <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[580px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b-2 border-slate-100">
                  <th className="px-3 sm:px-6 py-3 sm:py-5">DATA / HORA</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-5">CLIENTE</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-5">SERVIÇO</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-5">PROF.</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-5">STATUS</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-5 text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {filteredForDisplay.length === 0 ? (
                  <tr><td colSpan={6} className="p-20 text-center text-slate-300 font-black uppercase tracking-widest italic">Nenhum agendamento encontrado para este intervalo.</td></tr>
                ) : (
                  filteredForDisplay.map(a => {
                    const c = customers.find(cu => cu.id === a.customer_id);
                    const p = professionals.find(pr => pr.id === a.professional_id);
                    const svcIdsParsed = a.serviceIds || parseServiceIds(a.service_id);
                    const svcs = svcIdsParsed.map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
                    const svc = svcs[0]; // primary for backward compat
                    const svcLabel = svcs.length > 1 ? svcs.map(s => s.name).join(' + ') : (svc?.name || '—');
                    const appDate = new Date(a.startTime);
                    const isAI = a.source === BookingSource.AI;
                    const isPlan = a.isPlan || a.source === BookingSource.PLAN;
                    return (
                      <tr key={a.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-black text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 uppercase transition-colors">{appDate.toLocaleDateString('pt-BR')}</span>
                            <span className="text-lg font-black text-orange-500">{appDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full w-fit uppercase tracking-widest ${isAI ? 'bg-orange-100 text-orange-600' : isPlan ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                              {isAI ? '⚡ Agente IA' : isPlan ? '📦 Plano' : '✏️ Manual'}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black group-hover:text-slate-700 dark:text-slate-100 dark:group-hover:text-slate-200 uppercase tracking-tight text-sm transition-colors">{c?.name || '—'}</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black group-hover:text-slate-700 dark:text-slate-100 dark:group-hover:text-slate-200 text-sm transition-colors">{svcLabel}</span>
                          {svcs.length > 0 && !isPlan && <p className="text-[10px] text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 font-bold uppercase transition-colors">R$ {svcs.reduce((s, sv) => s + sv.price, 0).toFixed(2)} · {a.durationMinutes}min</p>}
                          {svcs.length > 0 && isPlan && <p className="text-[10px] text-blue-500 font-bold uppercase">Plano · {a.durationMinutes}min</p>}
                        </td>
                        <td className="px-8 py-6 font-bold text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200 uppercase text-xs tracking-wider transition-colors">{p?.name || '—'}</td>
                        <td className="px-8 py-6">
                          {editingStatusId === a.id ? (
                            <select
                              autoFocus
                              defaultValue={a.status}
                              onChange={async e => {
                                const newStatus = e.target.value as AppointmentStatus;
                                setEditingStatusId(null);
                                if (newStatus === AppointmentStatus.FINISHED) {
                                  setShowFinishModal({ id: a.id, basePrice: svc?.price || 0, ...a });
                                  setEditStatus(AppointmentStatus.FINISHED);
                                  setPaymentMethod(a.paymentMethod || PaymentMethod.PIX);
                                  setExtraValue(a.extraValue || 0);
                                  setExtraNote(a.extraNote || '');
                                } else if (newStatus === AppointmentStatus.ARRIVED) {
                                  // 1. Atualizar status
                                  try {
                                    await db.updateAppointmentStatus(a.id, newStatus, {});
                                  } catch (err) {
                                    console.error('Erro ao atualizar status ARRIVED:', err);
                                  }
                                  // 2. Notificar profissional (independente da comanda)
                                  sendClientArrivedNotification(a).catch(err =>
                                    console.warn('Notificação ARRIVED falhou:', err)
                                  );
                                  // 3. Criar comanda (best-effort)
                                  try {
                                    const svcObj = services.find(s => s.id === a.service_id);
                                    const existingComandas = await db.getComandas(tenantId);
                                    const alreadyHasComanda = existingComandas.some(c => c.appointment_id === a.id);
                                    if (!alreadyHasComanda) {
                                      await db.createComanda({
                                        tenant_id: tenantId,
                                        appointment_id: a.id,
                                        professional_id: a.professional_id,
                                        customer_id: a.customer_id,
                                        items: svcObj ? [{
                                          id: generateId(), type: 'service' as const, itemId: svcObj.id,
                                          name: svcObj.name, qty: 1, unitPrice: svcObj.price,
                                          discountType: 'value' as const, discount: 0,
                                          professionalId: a.professional_id,
                                        }] : [],
                                        status: 'open',
                                      });
                                    }
                                  } catch (err) {
                                    console.error('Erro ao criar comanda:', err);
                                  }
                                  // 4. Navegar para Comandas
                                  onOpenComandas ? onOpenComandas() : refreshData();
                                } else {
                                  try {
                                    await db.updateAppointmentStatus(a.id, newStatus, {});
                                  } catch (err) {
                                    console.error('Erro ao atualizar status:', err);
                                  }
                                  if (newStatus === AppointmentStatus.CANCELLED) {
                                    const prof = professionals.find(p => p.id === a.professional_id);
                                    const dateStr = a.startTime ? a.startTime.substring(0, 10) : undefined;
                                    const timeStr = a.startTime ? a.startTime.substring(11, 16) : undefined;
                                    notifyWaitlistLeads(tenantId, { professionalName: prof?.name, date: dateStr, time: timeStr }).catch(console.error);
                                  }
                                  refreshData();
                                }
                              }}
                              onBlur={() => setEditingStatusId(null)}
                              className="text-[10px] font-black rounded-xl border-2 border-orange-400 bg-white dark:bg-gray-800 dark:text-white outline-none cursor-pointer px-2 py-1"
                            >
                              <option value={AppointmentStatus.PENDING}>Pendente</option>
                              <option value={AppointmentStatus.CONFIRMED}>Confirmado</option>
                              <option value={AppointmentStatus.ARRIVED}>Cliente Chegou</option>
                              <option value={AppointmentStatus.FINISHED}>Finalizado</option>
                              <option value={AppointmentStatus.NO_SHOW}>Faltou</option>
                              <option value={AppointmentStatus.CANCELLED}>Cancelado</option>
                            </select>
                          ) : (
                            <span
                              onClick={() => setEditingStatusId(a.id)}
                              title="Clique para alterar status"
                              className={`text-[10px] font-black px-4 py-1.5 rounded-full tracking-widest cursor-pointer hover:opacity-75 transition-opacity ${
                                a.status === AppointmentStatus.FINISHED  ? 'bg-slate-100 text-slate-500' :
                                a.status === AppointmentStatus.ARRIVED   ? 'bg-green-50 text-green-700' :
                                a.status === AppointmentStatus.NO_SHOW   ? 'bg-red-50 text-red-600' :
                                a.status === AppointmentStatus.CANCELLED ? 'bg-slate-100 text-slate-400' :
                                a.status === AppointmentStatus.CONFIRMED ? 'bg-blue-50 text-blue-600' :
                                'bg-orange-100 text-orange-600'
                              }`}>{
                                a.status === AppointmentStatus.ARRIVED  ? 'CHEGOU' :
                                a.status === AppointmentStatus.NO_SHOW  ? 'FALTOU' :
                                a.status
                              }</span>
                          )}
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {a.status === AppointmentStatus.FINISHED && (
                              <button
                                onClick={() => {
                                  setShowFinishModal({ id: a.id, basePrice: svc?.price || 0, ...a });
                                  setEditStatus(a.status);
                                  setPaymentMethod(a.paymentMethod || PaymentMethod.PIX);
                                  setExtraValue(a.extraValue || 0);
                                  setExtraNote(a.extraNote || '');
                                }}
                                className="text-black dark:text-slate-200 font-black text-[10px] uppercase hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
                              >
                                DETALHES
                              </button>
                            )}
                            <button
                              onClick={() => openEditModal(a)}
                              title="Editar horário"
                              className="text-slate-400 hover:text-orange-500 dark:text-slate-500 dark:hover:text-orange-400 transition-colors"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteApptId(a.id)}
                              title="Excluir agendamento"
                              className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 transition-colors"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      </div>
      )} {/* end calView === 'lista' */}

      {/* ─── Appointment Info Panel ─────────────────── */}
      {infoAppt && (() => {
        const ia = infoAppt;
        const iaCust = customers.find(c => c.id === ia.customer_id);
        const iaProf = professionals.find(p => p.id === ia.professional_id);
        const iaSvcIds = ia.serviceIds?.length ? ia.serviceIds : [ia.service_id];
        const iaSvcs = services.filter(s => iaSvcIds.includes(s.id));
        const iaStartDt = new Date(ia.startTime);
        const profIdx = professionals.findIndex(p => p.id === ia.professional_id);
        const iaColor = PROF_COLORS[profIdx >= 0 ? profIdx % PROF_COLORS.length : 0];

        const statusLabel: Record<string, string> = {
          PENDING: 'Pendente', CONFIRMED: 'Confirmado', ARRIVED: 'Chegou',
          FINISHED: 'Finalizado', NO_SHOW: 'Faltou', CANCELLED: 'Cancelado',
        };
        const statusColor: Record<string, string> = {
          PENDING: '#EA580C', CONFIRMED: '#2563EB', ARRIVED: '#15803D',
          FINISHED: '#94A3B8', NO_SHOW: '#DC2626', CANCELLED: '#94A3B8',
        };
        const sc = statusColor[ia.status] ?? '#94a3b8';
        const totalPrice = iaSvcs.reduce((s, v) => s + (v.price || 0), 0);

        return (
          <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
            style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
            onClick={() => setInfoAppt(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#ffffff', borderRadius: 20, width: '100%', maxWidth: 440,
                margin: '0 12px 12px', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
                overflow: 'hidden',
              }}
            >
              {/* Color accent top bar */}
              <div style={{ height: 4, background: iaColor }} />

              {/* Header */}
              <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: sc,
                      background: `${sc}18`, borderRadius: 99, padding: '3px 10px',
                    }}>
                      {statusLabel[ia.status] ?? ia.status}
                    </span>
                    {ia.source === BookingSource.AI && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', background: '#f5f3ff', borderRadius: 99, padding: '3px 8px' }}>IA</span>
                    )}
                    {ia.isPlan && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#2563EB', background: '#EFF6FF', borderRadius: 99, padding: '3px 8px' }}>Plano</span>
                    )}
                  </div>
                  <p style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0, lineHeight: 1.2 }}>
                    {iaCust?.name || 'Cliente desconhecido'}
                  </p>
                </div>
                <button
                  onClick={() => setInfoAppt(null)}
                  style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: '#F1F5F9', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ×
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Date / Time / Duration row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Data', value: iaStartDt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) },
                    { label: 'Horário', value: iaStartDt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) },
                    { label: 'Duração', value: `${ia.durationMinutes} min` },
                  ].map(item => (
                    <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 10, padding: '8px 10px' }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>{item.label}</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', margin: 0 }}>{item.value}</p>
                    </div>
                  ))}
                </div>

                {/* Services */}
                <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px' }}>
                  <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Serviços</p>
                  {iaSvcs.length > 0 ? iaSvcs.map(sv => (
                    <div key={sv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{sv.name}</span>
                      <span style={{ fontSize: 12, color: '#64748B' }}>R$ {sv.price.toFixed(2)}</span>
                    </div>
                  )) : (
                    <span style={{ fontSize: 13, color: '#64748B' }}>{services.find(s => s.id === ia.service_id)?.name || '—'}</span>
                  )}
                  {totalPrice > 0 && iaSvcs.length > 1 && (
                    <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Total</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>R$ {totalPrice.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Professional */}
                {iaProf && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFC', borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: iaColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{iaProf.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 1px' }}>Profissional</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', margin: 0 }}>{iaProf.name}</p>
                    </div>
                  </div>
                )}

                {/* Client contact */}
                {iaCust && (iaCust.phone || iaCust.email) && (
                  <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 16 }}>
                    {iaCust.phone && (
                      <div>
                        <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Telefone</p>
                        <a href={`https://wa.me/55${iaCust.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', textDecoration: 'none' }}>
                          {iaCust.phone}
                        </a>
                      </div>
                    )}
                    {iaCust.email && (
                      <div>
                        <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>E-mail</p>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{iaCust.email}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Payment info (if finished) */}
                {ia.status === AppointmentStatus.FINISHED && ia.amountPaid != null && (
                  <div style={{ background: '#F0FDF4', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Pago</p>
                        <p style={{ fontSize: 15, fontWeight: 800, color: '#15803d', margin: 0 }}>R$ {ia.amountPaid.toFixed(2)}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {ia.paymentMethod && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', background: '#dcfce7', borderRadius: 99, padding: '4px 10px' }}>{ia.paymentMethod}</span>
                        )}
                        <button
                          onClick={() => {
                            setInfoAppt(null);
                            setEstornoAppt(ia);
                            setEstornoPagamento(ia.paymentMethod ?? PaymentMethod.PIX);
                            setEstornoValor(ia.amountPaid != null ? ia.amountPaid.toFixed(2) : '');
                            setEstornoObs(ia.extraNote ?? '');
                          }}
                          style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 99, padding: '3px 10px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                        >
                          Estornar
                        </button>
                      </div>
                    </div>
                    {ia.extraNote && (
                      <p style={{ fontSize: 11, color: '#166534', marginTop: 6, marginBottom: 0 }}>📝 {ia.extraNote}</p>
                    )}
                  </div>
                )}

                {ia.extraNote && !(ia.status === AppointmentStatus.FINISHED && ia.amountPaid != null) && (
                  <div style={{ background: '#FFFBEB', borderRadius: 10, padding: '10px 12px' }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>Observação</p>
                    <p style={{ fontSize: 12, color: '#78350f', margin: 0 }}>{ia.extraNote}</p>
                  </div>
                )}
              </div>

              {/* ── Quick Status Buttons ── */}
              {ia.status !== AppointmentStatus.FINISHED && (
                <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {/* Confirmado */}
                  {ia.status !== AppointmentStatus.CONFIRMED && ia.status !== AppointmentStatus.CANCELLED && (
                    <button
                      onClick={async () => {
                        await db.updateAppointmentStatus(ia.id, AppointmentStatus.CONFIRMED, {});
                        await refreshData();
                        setInfoAppt(prev => prev?.id === ia.id ? { ...prev, status: AppointmentStatus.CONFIRMED } : prev);
                      }}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: '#DBEAFE', fontSize: 12, fontWeight: 800, color: '#1D4ED8', cursor: 'pointer' }}
                    >
                      ✓ Confirmado
                    </button>
                  )}
                  {/* Faltou */}
                  {ia.status !== AppointmentStatus.NO_SHOW && ia.status !== AppointmentStatus.CANCELLED && (
                    <button
                      onClick={async () => {
                        await db.updateAppointmentStatus(ia.id, AppointmentStatus.NO_SHOW, {});
                        await refreshData();
                        setInfoAppt(prev => prev?.id === ia.id ? { ...prev, status: AppointmentStatus.NO_SHOW } : prev);
                      }}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: '#FEE2E2', fontSize: 12, fontWeight: 800, color: '#DC2626', cursor: 'pointer' }}
                    >
                      Faltou
                    </button>
                  )}
                  {/* Cancelado */}
                  {ia.status !== AppointmentStatus.CANCELLED && (
                    <button
                      onClick={async () => {
                        await db.updateAppointmentStatus(ia.id, AppointmentStatus.CANCELLED, {});
                        await refreshData();
                        setInfoAppt(null);
                      }}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#F8FAFC', fontSize: 12, fontWeight: 800, color: '#64748B', cursor: 'pointer' }}
                    >
                      Cancelar
                    </button>
                  )}
                  {/* Reativar (only for CANCELLED) */}
                  {ia.status === AppointmentStatus.CANCELLED && (
                    <button
                      onClick={async () => {
                        await db.updateAppointmentStatus(ia.id, AppointmentStatus.PENDING, {});
                        await refreshData();
                        setInfoAppt(prev => prev?.id === ia.id ? { ...prev, status: AppointmentStatus.PENDING } : prev);
                      }}
                      style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: '#FEF3C7', fontSize: 12, fontWeight: 800, color: '#92400E', cursor: 'pointer' }}
                    >
                      ↺ Reativar
                    </button>
                  )}
                </div>
              )}

              {/* Actions */}
              {ia.status !== AppointmentStatus.CANCELLED && ia.status !== AppointmentStatus.FINISHED && (
                <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setInfoAppt(null); openEditModal(ia); }}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#ffffff', fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer' }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      setInfoAppt(null);
                      setShowFinishModal({
                        id: ia.id, basePrice: iaSvcs.reduce((s, v) => s + v.price, 0) || 0,
                        professional_id: ia.professional_id, service_id: ia.service_id,
                        customer_id: ia.customer_id, startTime: ia.startTime,
                        source: ia.source, isPlan: ia.isPlan,
                        ...((ia as any).serviceIds?.length ? { serviceIds: (ia as any).serviceIds } : {}),
                      } as any);
                    }}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: iaColor, fontSize: 13, fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
                  >
                    Finalizar
                  </button>
                </div>
              )}

              {/* Enviar confirmação ao cliente via WhatsApp */}
              {iaCust?.phone && (
                <div style={{ padding: '0 20px 8px' }}>
                  <button
                    onClick={async () => {
                      const ok = await sendApptConfirmationToClient(tenantId, ia);
                      alert(ok ? '✅ Mensagem enviada ao cliente!' : '❌ Falha ao enviar. Verifique se a instância WhatsApp está conectada.');
                    }}
                    style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', background: '#DCFCE7', fontSize: 12, fontWeight: 800, color: '#15803D', cursor: 'pointer' }}
                  >
                    📤 Enviar confirmação ao cliente
                  </button>
                </div>
              )}

              {/* Excluir — sempre visível */}
              <div style={{ padding: '0 20px 16px', display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={() => { setInfoAppt(null); setDeleteApptId(ia.id); }}
                  style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  🗑 Excluir agendamento
                </button>
              </div>
            </div>
          </div>
        );

      })()}

      {/* ─── Hover Appointment Popup ────────────────── */}
      {hoverAppt && (() => {
        const ha = hoverAppt.appt;
        const haCust = customers.find(c => c.id === ha.customer_id);
        const haProf = professionals.find(p => p.id === ha.professional_id);
        const haStartDt = new Date(ha.startTime);
        const haEndDt = new Date(haStartDt.getTime() + (ha.durationMinutes || 0) * 60000);
        const fmtT = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const haSvcIds = ha.serviceIds?.length ? ha.serviceIds : [ha.service_id];
        const haSvcs = services.filter(s => haSvcIds.includes(s.id));

        const STATUS_OPTIONS: { key: AppointmentStatus; label: string; bg: string; color: string }[] = [
          { key: AppointmentStatus.CONFIRMED, label: '✓ Confirmado', bg: '#DBEAFE', color: '#1D4ED8' },
          { key: AppointmentStatus.ARRIVED,   label: '🚶 Chegou',    bg: '#D1FAE5', color: '#065F46' },
          { key: AppointmentStatus.FINISHED,  label: '✓ Finalizado', bg: '#F0FDF4', color: '#15803D' },
          { key: AppointmentStatus.NO_SHOW,   label: '✗ Faltou',    bg: '#FEE2E2', color: '#DC2626' },
          { key: AppointmentStatus.CANCELLED, label: '✕ Cancelado', bg: '#F1F5F9', color: '#64748B' },
        ].filter(o => o.key !== ha.status);

        const popX = Math.min(hoverAppt.x, window.innerWidth - 264);
        const popY = Math.max(8, Math.min(hoverAppt.y, window.innerHeight - 240));

        return (
          <div
            key={ha.id}
            data-popup="hover-appt"
            style={{
              position: 'fixed', zIndex: 9999,
              left: popX, top: popY, width: 256,
              background: '#fff', borderRadius: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              border: '1.5px solid #E2E8F0',
              overflow: 'hidden', pointerEvents: 'auto',
            }}
          >
            <div style={{ padding: '12px 14px 8px' }}>
              <p style={{ fontWeight: 800, fontSize: 13, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {haCust?.name || '—'}
              </p>
              <p style={{ fontSize: 11, color: '#64748B', margin: 0 }}>
                {haProf?.name} · {fmtT(haStartDt)}–{fmtT(haEndDt)}
              </p>
              {haSvcs.length > 0 && (
                <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {haSvcs.map(s => s.name).join(', ')}
                </p>
              )}
            </div>
            <div style={{ padding: '0 8px 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={async () => {
                    await db.updateAppointmentStatus(ha.id, opt.key, {});
                    setHoverAppt(null);
                    refreshData();
                  }}
                  style={{ padding: '4px 8px', borderRadius: 8, border: 'none', background: opt.bg, color: opt.color, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ padding: '4px 8px 10px' }}>
              <button
                onClick={() => { setHoverAppt(null); openEditModal(ha); }}
                style={{ width: '100%', padding: '6px 0', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#F8FAFC', color: '#1E293B', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                ✏️ Editar agendamento
              </button>
            </div>
          </div>
        );
      })()}

      {/* ─── Right-Click Break Popup ────────────────── */}
      {hoverBreak && (() => {
        const hb = hoverBreak.brk;
        const popX = Math.min(hoverBreak.x, window.innerWidth - 220);
        const popY = Math.max(8, Math.min(hoverBreak.y, window.innerHeight - 130));
        return (
          <div
            data-popup="hover-break"
            style={{
              position: 'fixed', zIndex: 9999,
              left: popX, top: popY, width: 204,
              background: '#fff', borderRadius: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              border: '1.5px solid #E2E8F0',
              overflow: 'hidden', pointerEvents: 'auto',
            }}
          >
            <div style={{ padding: '10px 14px 6px' }}>
              <p style={{ fontWeight: 800, fontSize: 12, color: '#0F172A', margin: '0 0 2px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{hb.label}</p>
              {!(hb.startTime === '00:00') && (
                <p style={{ fontSize: 10, color: '#64748B', margin: 0 }}>{hb.startTime}–{hb.endTime}</p>
              )}
            </div>
            <div style={{ padding: '2px 8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                onClick={() => { setHoverBreak(null); openEditBreak(hb); }}
                style={{ width: '100%', padding: '6px 0', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#F8FAFC', color: '#1E293B', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                ✏️ Editar intervalo
              </button>
              <button
                onClick={async () => { setHoverBreak(null); await handleDeleteBreak(hb.id); }}
                style={{ width: '100%', padding: '6px 0', borderRadius: 8, border: 'none', background: '#FEE2E2', color: '#DC2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                🗑️ Excluir
              </button>
            </div>
          </div>
        );
      })()}

      {/* ─── Edit Appointment Modal ─────────────────── */}
      {editAppt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
            <div className="bg-white dark:bg-slate-900 rounded-[40px] w-full max-w-lg p-10 space-y-6 animate-scaleUp border-4 border-black dark:border-slate-700">
              <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">Editar Agendamento</h2>
              {editError && (
                <div className="bg-red-50 border-2 border-red-200 p-3 rounded-2xl text-red-600 text-xs font-black uppercase tracking-widest">⚠️ {editError}</div>
              )}
              <div className="space-y-4">
                {/* Professional */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Profissional</label>
                  <select
                    value={editProfId}
                    onChange={e => { setEditProfId(e.target.value); setEditTime(''); }}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-xs font-bold text-black dark:text-white outline-none focus:border-orange-500 transition-colors"
                  >
                    <option value="">Selecione...</option>
                    {professionals.filter(p => p.active).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {/* Services — per-row with individual time + price */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Serviço(s)</label>
                  {editRows.map((row) => {
                    const rowSvc = services.find(s => s.id === row.svcId);
                    const availSvcs = (() => {
                      let svcs = services.filter(s => s.active !== false);
                      if (editProfId) {
                        const prof = professionals.find(p => p.id === editProfId);
                        if (prof?.serviceIds?.length) svcs = svcs.filter(s => prof.serviceIds!.includes(s.id));
                      }
                      return svcs;
                    })();

                    // Conflict detection for edit modal (exclude the appointment being edited)
                    const _em = (hhmm: string) => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
                    const eStartMin = row.startTime ? _em(row.startTime) : -1;
                    const eEndMin   = row.endTime   ? _em(row.endTime)
                      : (eStartMin >= 0 && rowSvc ? eStartMin + rowSvc.durationMinutes : -1);
                    const editConflicts = (editProfId && editDate && eStartMin >= 0 && eEndMin > eStartMin)
                      ? appointments.filter(a => {
                          if (a.id === editAppt?.id) return false;
                          if (a.status === AppointmentStatus.CANCELLED) return false;
                          if (a.professional_id !== editProfId) return false;
                          if (!a.startTime?.startsWith(editDate)) return false;
                          const aS = _em(a.startTime.substring(11, 16));
                          const aE = aS + (a.durationMinutes || 30);
                          return eStartMin < aE && eEndMin > aS;
                        })
                      : [];

                    return (
                      <div key={row.rowId} style={{ background: '#F8FAFC', borderRadius: 12, padding: '10px 12px', border: '1.5px solid #E2E8F0' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                          <select
                            value={row.svcId}
                            onChange={e => {
                              const svc = services.find(s => s.id === e.target.value);
                              setEditRows(prev => prev.map(r => r.rowId !== row.rowId ? r : {
                                ...r, svcId: e.target.value,
                                endTime: svc ? calcEnd(r.startTime, svc.durationMinutes) : r.endTime,
                                price: svc?.price ?? r.price,
                              }));
                            }}
                            style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 11, fontWeight: 700, background: '#fff', outline: 'none' }}
                          >
                            <option value="">Serviço...</option>
                            {availSvcs.map(s => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes}min · R$ {(s.price ?? 0).toFixed(2)}</option>)}
                          </select>
                          {editRows.length > 1 && (
                            <button onClick={() => setEditRows(prev => prev.filter(r => r.rowId !== row.rowId))}
                              style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#FEE2E2', color: '#DC2626', fontWeight: 800, fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>
                              ✕
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', margin: '0 0 3px' }}>INÍCIO</p>
                            <input type="time" value={row.startTime}
                              onChange={e => setEditRows(prev => prev.map(r => r.rowId !== row.rowId ? r : {
                                ...r, startTime: e.target.value,
                                endTime: rowSvc ? calcEnd(e.target.value, rowSvc.durationMinutes) : r.endTime,
                              }))}
                              style={{ width: '100%', padding: '5px 6px', borderRadius: 8, border: `1.5px solid ${editConflicts.length > 0 ? '#FCD34D' : '#CBD5E1'}`, fontSize: 12, fontWeight: 700, background: '#fff', outline: 'none' }}
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', margin: '0 0 3px' }}>FIM</p>
                            <input type="time" value={row.endTime}
                              onChange={e => setEditRows(prev => prev.map(r => r.rowId !== row.rowId ? r : { ...r, endTime: e.target.value }))}
                              style={{ width: '100%', padding: '5px 6px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 12, fontWeight: 700, background: '#fff', outline: 'none' }}
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', margin: '0 0 3px' }}>R$</p>
                            <input type="number" value={row.price} min={0} step={0.01}
                              onChange={e => setEditRows(prev => prev.map(r => r.rowId !== row.rowId ? r : { ...r, price: parseFloat(e.target.value) || 0 }))}
                              style={{ width: '100%', padding: '5px 6px', borderRadius: 8, border: '1.5px solid #CBD5E1', fontSize: 12, fontWeight: 700, background: '#fff', outline: 'none' }}
                            />
                          </div>
                        </div>
                        {rowSvc && (
                          <p style={{ fontSize: 9, color: '#94A3B8', margin: '6px 0 0', fontWeight: 600 }}>
                            {rowSvc.name} · {rowSvc.durationMinutes}min padrão
                          </p>
                        )}
                        {/* Conflict hint */}
                        {editConflicts.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '6px 10px', marginTop: 6 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            <p style={{ fontSize: 9, fontWeight: 700, color: '#92400E', margin: 0 }}>
                              Encaixe{editConflicts.length > 1 ? ` (${editConflicts.length})` : ''} —{' '}
                              {editConflicts.slice(0, 2).map(a => customers.find(c => c.id === a.customer_id)?.name || 'outro cliente').join(', ')}
                              {editConflicts.length > 2 ? ` +${editConflicts.length - 2}` : ''} já neste horário
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => {
                      const last = editRows[editRows.length - 1];
                      setEditRows(prev => [...prev, { rowId: crypto.randomUUID(), svcId: '', startTime: last?.endTime || '', endTime: '', price: 0 }]);
                    }}
                    style={{ width: '100%', padding: '8px', borderRadius: 10, border: '2px dashed #CBD5E1', background: 'transparent', color: '#64748B', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >+ Adicionar Serviço</button>
                  {editRows.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, padding: '4px 2px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                        Total: <strong style={{ color: '#f97316' }}>R$ {editRows.reduce((s, r) => s + (r.price || 0), 0).toFixed(2)}</strong>
                      </span>
                    </div>
                  )}
                </div>
                {/* Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Data</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl text-xs font-bold text-black dark:text-white outline-none focus:border-orange-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditAppt(null)}
                  className="flex-1 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-sm font-black text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >CANCELAR</button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="flex-1 py-3 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                >{savingEdit ? '...' : 'SALVAR'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Appointment Confirm Modal ──────── */}
      {deleteApptId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-sm p-10 space-y-6 border-4 border-red-500 animate-scaleUp">
            <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">Excluir Agendamento?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Esta ação é permanente e não pode ser desfeita.</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeleteApptId(null)}
                className="flex-1 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-sm font-black text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                CANCELAR
              </button>
              <button
                onClick={handleDeleteAppointment}
                disabled={deletingAppt}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-black uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {deletingAppt ? '...' : 'EXCLUIR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── New Booking Modal ─────────────────────── */}
      {showBookingModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-4 pt-8 pb-10">
          <div className="bg-white rounded-[32px] w-full max-w-3xl p-8 space-y-6 animate-scaleUp border-4 border-black">
            <h2 className="text-2xl font-black text-black tracking-tight uppercase">Novo Horário</h2>
            {errorMsg && (
              <div className="bg-red-50 border-2 border-red-200 p-4 rounded-2xl text-red-600 text-xs font-black uppercase tracking-widest animate-pulse">⚠️ {errorMsg}</div>
            )}

            {/* ── Customer picker ── */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Cliente</label>
              <div className="relative">
                <div className="flex items-center gap-2 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus-within:border-orange-500 transition-colors">
                  <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    value={customerSearch}
                    onChange={e => { setCustomerSearch(e.target.value); setCustomerId(''); }}
                    placeholder={customerId ? customers.find(c => c.id === customerId)?.name : 'Pesquisar por nome ou telefone...'}
                    className="flex-1 bg-transparent outline-none text-xs font-bold text-black placeholder:text-slate-400"
                  />
                  {(customerSearch || customerId) && (
                    <button onClick={() => { setCustomerSearch(''); setCustomerId(''); }} className="text-slate-300 hover:text-red-400 text-xs font-black">✕</button>
                  )}
                </div>
                {customerSearch.trim().length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-slate-100 rounded-2xl shadow-xl z-10 max-h-52 overflow-y-auto">
                    {[...customers]
                      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                      .filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch))
                      .slice(0, 50)
                      .map(c => (
                        <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-100 transition-colors border-b border-slate-50 last:border-0">
                          <span className="text-xs font-black text-black uppercase">{c.name}</span>
                          <span className="text-[10px] text-slate-400 font-bold ml-2">{c.phone}</span>
                        </button>
                      ))
                    }
                    {[...customers].filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch)).length === 0 && (
                      <button onClick={() => {
                        setShowNewCustForm(true);
                        const isPhone = /^\+?[\d\s\-\(\)]{6,}$/.test(customerSearch.trim());
                        if (isPhone) { setNewCustPhone(customerSearch.replace(/\D/g, '')); setNewCustName(''); }
                        else { setNewCustName(customerSearch); setNewCustPhone(''); }
                        setCustomerSearch('');
                      }} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-orange-50 transition-colors text-left">
                        <span className="text-xs font-black text-orange-500">+ Cadastrar "{customerSearch}"</span>
                      </button>
                    )}
                  </div>
                )}
                {customerSearch.trim().length === 0 && !customerId && !showNewCustForm && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-slate-100 rounded-2xl shadow-xl z-10 max-h-52 overflow-y-auto">
                    {[...customers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(c => (
                      <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-100 transition-colors border-b border-slate-50 last:border-0">
                        <span className="text-xs font-black text-black uppercase">{c.name}</span>
                        <span className="text-[10px] text-slate-400 font-bold ml-2">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {customerId && <p className="text-[10px] font-black text-orange-500 ml-4 mt-1">✓ {customers.find(c => c.id === customerId)?.name}</p>}
            </div>

            {/* Inline new-customer mini-form */}
            {showNewCustForm && !customerId && (
              <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Novo Cliente</p>
                <div className="space-y-2">
                  <input value={newCustName} onChange={e => setNewCustName(e.target.value)} placeholder="Nome completo" className="w-full p-3 bg-white border-2 border-orange-100 rounded-xl font-bold text-xs outline-none focus:border-orange-500 transition-colors" />
                  <input value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)} placeholder="Telefone (ex: 11999999999)" className="w-full p-3 bg-white border-2 border-orange-100 rounded-xl font-bold text-xs outline-none focus:border-orange-500 transition-colors" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setShowNewCustForm(false); setNewCustName(''); setNewCustPhone(''); }} className="flex-1 py-2 font-black text-slate-400 uppercase text-[10px] border-2 border-slate-100 rounded-xl hover:border-slate-300 transition-all">Cancelar</button>
                  <button onClick={handleCreateAndSelectCustomer} disabled={creatingCust || !newCustName.trim() || !newCustPhone.trim()} className="flex-1 py-2 bg-orange-500 text-white rounded-xl font-black uppercase text-[10px] hover:bg-black transition-all disabled:opacity-40">{creatingCust ? 'Criando...' : 'Criar e Selecionar'}</button>
                </div>
              </div>
            )}

            {/* ── Date ── */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
              <input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs uppercase" />
            </div>

            {/* ── Service rows ── */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Serviços</label>
              {bookingRows.map((row, idx) => {
                const svcSearch = rowSvcSearch[row.rowId] || '';
                const rowSvcs = getServicesForRow(row, svcSearch);
                const rowProfs = getProfsForRow(row);
                const selectedSvc = services.find(s => s.id === row.svcId);

                // Conflict detection — check if this professional already has an overlapping appointment
                const _toMin = (hhmm: string) => { const [h, m] = (hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
                const rowStartMin = row.startTime ? _toMin(row.startTime) : -1;
                const rowEndMin   = row.endTime   ? _toMin(row.endTime)
                  : (rowStartMin >= 0 && selectedSvc ? rowStartMin + selectedSvc.durationMinutes : -1);
                const conflictAppts = (row.profId && bookingDate && rowStartMin >= 0 && rowEndMin > rowStartMin)
                  ? appointments.filter(a => {
                      if (a.status === AppointmentStatus.CANCELLED) return false;
                      if (a.professional_id !== row.profId) return false;
                      if (!a.startTime?.startsWith(bookingDate)) return false;
                      const aS = _toMin(a.startTime.substring(11, 16));
                      const aE = aS + (a.durationMinutes || 30);
                      return rowStartMin < aE && rowEndMin > aS;
                    })
                  : [];

                return (
                  <div key={row.rowId} className="bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Serviço {idx + 1}</span>
                      {bookingRows.length > 1 && (
                        <button onClick={() => removeBookingRow(row.rowId)} className="text-slate-300 hover:text-red-400 text-xs font-black transition-colors">✕ Remover</button>
                      )}
                    </div>
                    {/* Row 1: Serviço (com busca), Profissional */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="relative">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Serviço</label>
                        {/* Dropdown customizado — flutua sem limite de largura do container */}
                        <input
                          type="text"
                          placeholder={row.svcId ? (services.find(s => s.id === row.svcId)?.name ?? 'Buscar...') : 'Buscar serviço...'}
                          value={openSvcDropdown === row.rowId ? svcSearch : (services.find(s => s.id === row.svcId)?.name ?? '')}
                          onFocus={() => { setOpenSvcDropdown(row.rowId); setRowSvcSearch(prev => ({ ...prev, [row.rowId]: '' })); }}
                          onChange={e => setRowSvcSearch(prev => ({ ...prev, [row.rowId]: e.target.value }))}
                          onBlur={() => setTimeout(() => setOpenSvcDropdown(null), 150)}
                          className="w-full p-2.5 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-orange-400"
                          autoComplete="off"
                        />
                        {openSvcDropdown === row.rowId && (
                          <div className="absolute left-0 top-full mt-1 z-[200] bg-white border-2 border-orange-300 rounded-xl shadow-2xl overflow-y-auto"
                            style={{ minWidth: '340px', maxHeight: '220px' }}>
                            {rowSvcs.length === 0
                              ? <p className="text-xs text-slate-400 p-3 text-center">Nenhum serviço encontrado</p>
                              : rowSvcs.map(s => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onMouseDown={() => {
                                    updateRow(row.rowId, {
                                      svcId: s.id,
                                      price: s.price ?? 0,
                                      endTime: row.startTime && s ? calcEnd(row.startTime, s.durationMinutes) : row.endTime,
                                    });
                                    setOpenSvcDropdown(null);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-xs hover:bg-orange-50 transition-colors border-b border-slate-50 last:border-0 ${row.svcId === s.id ? 'bg-orange-50 font-black text-orange-600' : 'font-semibold text-slate-700'}`}
                                >
                                  <span className="block truncate">{s.name}</span>
                                  <span className="text-[10px] text-slate-400 font-normal">{s.durationMinutes}min · R$ {(s.price ?? 0).toFixed(2)}</span>
                                </button>
                              ))
                            }
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Profissional</label>
                        <select
                          value={row.profId}
                          onChange={e => updateRow(row.rowId, { profId: e.target.value })}
                          className="w-full p-2.5 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-orange-400"
                        >
                          <option value="">Selecionar...</option>
                          {rowProfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* Row 2: Início, Fim, Preço */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Início</label>
                        <input
                          type="time"
                          value={row.startTime}
                          onChange={e => {
                            const start = e.target.value;
                            updateRow(row.rowId, {
                              startTime: start,
                              endTime: selectedSvc && start ? calcEnd(start, selectedSvc.durationMinutes) : row.endTime,
                            });
                          }}
                          className={`w-full p-2.5 bg-white border-2 rounded-xl text-xs font-bold outline-none focus:border-orange-400 ${conflictAppts.length > 0 ? 'border-amber-300' : 'border-slate-200'}`}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Fim</label>
                        <input
                          type="time"
                          value={row.endTime}
                          onChange={e => updateRow(row.rowId, { endTime: e.target.value })}
                          className="w-full p-2.5 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-orange-400"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Valor (R$)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.price}
                          onChange={e => updateRow(row.rowId, { price: parseFloat(e.target.value) || 0 })}
                          className="w-full p-2.5 bg-white border-2 border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-orange-400"
                        />
                      </div>
                    </div>

                    {/* Conflict hint */}
                    {conflictAppts.length > 0 && (
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <svg className="w-3 h-3 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <p className="text-[10px] font-black text-amber-700 leading-tight">
                          Encaixe{conflictAppts.length > 1 ? ` (${conflictAppts.length})` : ''} —{' '}
                          {conflictAppts.slice(0, 2).map(a => customers.find(c => c.id === a.customer_id)?.name || 'outro cliente').join(', ')}
                          {conflictAppts.length > 2 ? ` +${conflictAppts.length - 2}` : ''} já neste horário
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                onClick={addBookingRow}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-xs font-black text-slate-400 hover:border-orange-400 hover:text-orange-500 transition-all"
              >
                + Adicionar Serviço
              </button>
            </div>

            {/* ── Discount + Total ── */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Desconto (R$)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={bookingDiscount}
                  onChange={e => setBookingDiscount(parseFloat(e.target.value) || 0)}
                  className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs outline-none focus:border-orange-400"
                />
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</p>
                <p className="text-xl font-black text-orange-500">R$ {bookingTotal.toFixed(2)}</p>
              </div>
            </div>

            {/* ── Observação ── */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Observação</label>
              <textarea
                rows={2}
                placeholder="Anotação interna sobre este agendamento..."
                value={bookingNote}
                onChange={e => setBookingNote(e.target.value)}
                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-xs outline-none focus:border-orange-400 resize-none"
              />
            </div>

            {/* ── Actions ── */}
            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowBookingModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Voltar</button>
              <button onClick={handleCreateBooking} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs shadow-xl shadow-orange-100 hover:bg-black transition-all">Agendar</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ─── Finish / Manage Modal ────────────────── */}
      {showFinishModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-orange-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-black uppercase">Gerenciar Agendamento</h2>
              <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                showFinishModal.source === BookingSource.AI ? 'bg-orange-100 text-orange-600' :
                (showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) ? 'bg-blue-100 text-blue-600' :
                'bg-slate-100 text-slate-500'
              }`}>
                {showFinishModal.source === BookingSource.AI ? '⚡ Agente IA' :
                 (showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) ? '📦 Plano' :
                 '✏️ Manual'}
              </span>
            </div>

            <div className="bg-slate-50 rounded-3xl p-6 space-y-3">
              {showFinishModal.startTime && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data / Hora</span>
                  <span className="text-sm font-black text-orange-500">
                    {new Date(showFinishModal.startTime).toLocaleDateString('pt-BR')} às{' '}
                    {new Date(showFinishModal.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
              {showFinishModal.service_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Serviço</span>
                  <span className="text-sm font-black text-black">{services.find(s => s.id === showFinishModal.service_id)?.name || '—'}</span>
                </div>
              )}
              {showFinishModal.professional_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profissional</span>
                  <span className="text-sm font-black text-black">{professionals.find(p => p.id === showFinishModal.professional_id)?.name || '—'}</span>
                </div>
              )}
              {showFinishModal.customer_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cliente</span>
                  <span className="text-sm font-black text-black">{customers.find(c => c.id === showFinishModal.customer_id)?.name || '—'}</span>
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value as AppointmentStatus)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                  <option value={AppointmentStatus.PENDING}>PENDENTE</option>
                  <option value={AppointmentStatus.CONFIRMED}>CONFIRMADO</option>
                  <option value={AppointmentStatus.ARRIVED}>CLIENTE CHEGOU</option>
                  <option value={AppointmentStatus.FINISHED}>FINALIZADO</option>
                  <option value={AppointmentStatus.NO_SHOW}>FALTOU</option>
                  <option value={AppointmentStatus.CANCELLED}>CANCELADO</option>
                </select>
              </div>

              {!(showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) && (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Forma de Pagamento</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                      {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Acréscimo (Opcional)</label>
                    <input type="number" value={extraValue} onChange={e => setExtraValue(Number(e.target.value))} placeholder="Valor Extra" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black" />
                  </div>
                  <div className="bg-black p-8 rounded-[30px] text-center">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Total do Atendimento</p>
                    <p className="text-4xl font-black text-white">R$ {(showFinishModal.basePrice + (extraValue || 0)).toFixed(2)}</p>
                  </div>
                </>
              )}

              {(showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) && (
                <div className="bg-blue-50 border-2 border-blue-100 p-6 rounded-[24px] text-center">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Cobertura do Plano</p>
                  <p className="text-lg font-black text-blue-600">Atendimento incluso no plano do cliente</p>
                  <p className="text-[9px] font-bold text-blue-400 mt-1 uppercase">Sem cobrança — não somado ao financeiro</p>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button onClick={() => setShowFinishModal(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Sair</button>
              <button onClick={handleFinish} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs">Gravar Alterações</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ─── Break Period Modal ───────────────────── */}
      {showBreakModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-6 animate-scaleUp border-4 border-black">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight">{brkType === 'holiday' ? (editingBreakId ? 'Editar Feriado' : 'Novo Feriado') : (editingBreakId ? 'Editar Intervalo' : 'Gerar Intervalo')}</h2>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">{brkType === 'holiday' ? 'Nome do Feriado' : 'Nome do Intervalo'}</label>
                <input value={brkLabel} onChange={e => setBrkLabel(e.target.value)} placeholder={brkType === 'holiday' ? 'Ex: Natal, Ano Novo, Carnaval' : 'Ex: Almoço, Intervalo'} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500" />
              </div>

              {brkType !== 'holiday' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Profissional (opcional)</label>
                  <select value={brkProfId} onChange={e => setBrkProfId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                    <option value="">Todos os profissionais</option>
                    {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Tipo</label>
                <div className="flex gap-2">
                  <button onClick={() => setBrkType('recurring')} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'recurring' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Semanal
                  </button>
                  <button onClick={() => setBrkType('specific')} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'specific' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Dia Específico
                  </button>
                  <button onClick={() => { setBrkType('holiday'); setBrkLabel(l => l || 'Feriado'); setBrkAllDay(true); }} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'holiday' ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Feriado
                  </button>
                </div>
              </div>

              {brkType === 'recurring' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia da Semana</label>
                  <select value={brkDayOfWeek} onChange={e => setBrkDayOfWeek(Number(e.target.value))} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}

              {(brkType === 'specific' || brkType === 'holiday') && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
                  <input type="date" value={brkDate} onChange={e => setBrkDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              )}

              {brkType === 'holiday' && (
                <div className="flex items-center gap-3 px-4">
                  <button
                    onClick={() => setBrkAllDay(!brkAllDay)}
                    className={`w-12 h-7 rounded-full transition-all relative ${brkAllDay ? 'bg-red-500' : 'bg-slate-200'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-1 transition-all ${brkAllDay ? 'left-6' : 'left-1'}`} />
                  </button>
                  <span className="text-xs font-bold text-slate-600">Dia inteiro</span>
                </div>
              )}

              {(brkType !== 'holiday' || !brkAllDay) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">{brkType === 'holiday' ? 'Fecha a partir de' : 'Início'}</label>
                    <input type="time" value={brkStart} onChange={e => setBrkStart(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                  </div>
                  {brkType !== 'holiday' && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Fim</label>
                      <input type="time" value={brkEnd} onChange={e => setBrkEnd(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-4 pt-2">
              <button onClick={() => { setShowBreakModal(false); setEditingBreakId(null); }} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Cancelar</button>
              <button onClick={handleCreateBreak} className={`flex-1 py-4 text-white rounded-2xl font-black uppercase text-xs transition-all ${brkType === 'holiday' ? 'bg-red-500 hover:bg-red-600' : 'bg-black hover:bg-orange-500'}`}>{brkType === 'holiday' ? 'Salvar Feriado' : 'Salvar Intervalo'}</button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ── Modal: Estorno / Ajuste de Atendimento Finalizado ─────────── */}
      {estornoAppt && (() => {
        const eaCust = customers.find(c => c.id === estornoAppt.customer_id);
        const eaProf = professionals.find(p => p.id === estornoAppt.professional_id);
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-[40px] w-full max-w-md max-h-[90vh] overflow-y-auto p-8 space-y-5 animate-scaleUp border-4 border-red-400">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black text-black uppercase tracking-tight">Estorno / Ajuste</h2>
                  <p className="text-xs font-bold text-slate-400 mt-0.5">
                    {eaCust?.name ?? '—'} · {eaProf?.name ?? '—'}
                  </p>
                </div>
                <button onClick={() => setEstornoAppt(null)} className="text-slate-400 hover:text-black font-black text-lg">✕</button>
              </div>

              {/* Valor original */}
              <div className="bg-slate-50 rounded-2xl px-5 py-3 flex justify-between items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Valor registrado</span>
                <span className="text-sm font-black text-slate-500">
                  {estornoAppt.amountPaid != null ? `R$ ${estornoAppt.amountPaid.toFixed(2)}` : '—'}
                </span>
              </div>

              {/* Novo valor */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Novo Valor (R$)</label>
                <input
                  type="number" min={0} step="0.01"
                  value={estornoValor}
                  onChange={e => setEstornoValor(e.target.value)}
                  placeholder="Ex: 80.00"
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-lg outline-none focus:border-red-400 transition-all"
                />
              </div>

              {/* Forma de pagamento */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                <select
                  value={estornoPagamento}
                  onChange={e => setEstornoPagamento(e.target.value as PaymentMethod)}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black"
                >
                  {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                </select>
              </div>

              {/* Observações */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observações</label>
                <textarea
                  value={estornoObs}
                  onChange={e => setEstornoObs(e.target.value)}
                  placeholder="Ex: desconto concedido, erro de cobrança..."
                  rows={3}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-sm outline-none focus:border-red-400 transition-all resize-none"
                />
              </div>

              {/* Preview */}
              {estornoValor !== '' && !isNaN(parseFloat(estornoValor)) && (
                <div className="bg-red-50 border-2 border-red-100 rounded-2xl px-6 py-4 text-center">
                  <p className="text-[9px] font-black text-red-400 uppercase mb-1">Novo Total</p>
                  <p className="text-3xl font-black text-red-600">R$ {parseFloat(estornoValor.replace(',', '.')).toFixed(2)}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setEstornoAppt(null)} className="flex-1 py-3 text-slate-400 font-black text-xs uppercase">Cancelar</button>
                <button
                  onClick={handleApptEstorno}
                  disabled={estornoSaving}
                  className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-50 hover:bg-red-600 transition-all"
                >
                  {estornoSaving ? 'Salvando...' : '✅ Confirmar Estorno'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const PresetBtn = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`px-3 py-2 text-[9px] font-black uppercase tracking-tighter rounded-xl transition-all ${active ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:text-black'}`}>
    {label}
  </button>
);

const ModalSelect = ({ label, value, onChange, placeholder, children }: any) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
    <select value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
      <option value="">{placeholder}</option>
      {children}
    </select>
  </div>
);

export default AppointmentsView;
