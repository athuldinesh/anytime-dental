import { useEffect, useState, useCallback, useRef } from 'react';

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    credentials: 'same-origin',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-anytime': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.error || (res.status === 429 ? 'Too many requests, try again shortly.' : 'Something went wrong. Please try again.'));
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

/** Fetch on mount / when deps change. Returns { data, error, loading, reload, setData }. */
export function useApi(path, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: !!path });
  const tick = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++tick.current;
    set((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      if (id === tick.current) set({ data, error: null, loading: false });
    } catch (error) {
      if (id === tick.current) set((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (fn) => set((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

let metaCache = null;
export function useMeta() {
  const [meta, setMeta] = useState(metaCache);
  useEffect(() => {
    if (metaCache) return;
    api('/api/public/meta').then((m) => { metaCache = m; setMeta(m); }).catch(() => {});
  }, []);
  return meta;
}

// ---- Dubai time helpers (UTC+4, no DST)
export function dubaiNow() {
  const t = new Date(Date.now() + 4 * 3600e3);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}
export function hm(time) {
  const [h, m] = time.split(':').map(Number);
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function dubaiParts(iso) {
  const t = new Date(Date.parse(iso) + 4 * 3600e3);
  return { date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16) };
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(date, { long = false } = {}) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const today = dubaiNow().date;
  const tomorrow = new Date(Date.UTC(...today.split('-').map((v, i) => (i === 1 ? v - 1 : Number(v)))) + 864e5).toISOString().slice(0, 10);
  if (!long && date === today) return 'Today';
  if (!long && date === tomorrow) return 'Tomorrow';
  return `${DOW[dt.getUTCDay()]} ${d} ${MON[m - 1]}`;
}
export function dateTime(iso) {
  const p = dubaiParts(iso);
  return `${dayLabel(p.date)} · ${hm(p.time)}`;
}
export function ago(iso) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dateTime(iso);
}
export function phoneLabel(e164) {
  const m = /^971(5\d)(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `+971 ${m[1]} ${m[2]} ${m[3]}` : e164 ? `+${e164}` : '';
}

/** .ics file for "Add to calendar" */
export function icsFor(b) {
  const start = new Date(b.starts_at);
  const end = new Date(start.getTime() + b.duration_min * 60e3);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/[,;\\]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const text = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Anytime Dental//Booking//EN', 'BEGIN:VEVENT',
    `UID:${b.code}@anytimedental.ae`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${esc(`${b.service.name} · Anytime Dental`)}`,
    `LOCATION:${esc(b.branch.address)}`,
    `DESCRIPTION:${esc(`${b.branch.floor}\n${b.branch.directions}\nBooking ${b.code}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
}

export const WA = (num, text) => `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
