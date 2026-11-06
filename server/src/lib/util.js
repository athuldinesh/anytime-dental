import crypto from 'node:crypto';

// ---------- Dubai time (UTC+4 all year, no DST) ----------
const OFFSET = 4 * 60 * 60 * 1000;

/** Wall-clock parts in Dubai for a Date / ISO string. */
export function dubai(d = new Date()) {
  const t = new Date(new Date(d).getTime() + OFFSET);
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, day = t.getUTCDate();
  const hh = t.getUTCHours(), mm = t.getUTCMinutes();
  return {
    y, m, day, hh, mm, dow: t.getUTCDay(),
    date: `${y}-${pad(m)}-${pad(day)}`,
    time: `${pad(hh)}:${pad(mm)}`,
    minutes: hh * 60 + mm,
  };
}
export const pad = (n) => String(n).padStart(2, '0');

/** Dubai date "YYYY-MM-DD" + "HH:MM" -> UTC ISO string. */
export function dubaiToUtc(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET).toISOString();
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Thursday 6 November" */
export function prettyDate(iso) {
  const p = dubai(iso);
  return `${DAYS[p.dow]} ${p.day} ${MONTHS[p.m - 1]}`;
}
/** "4:30 PM" */
export function prettyTime(iso) {
  const p = dubai(iso);
  const h = p.hh % 12 || 12;
  return `${h}:${pad(p.mm)} ${p.hh < 12 ? 'AM' : 'PM'}`;
}

// ---------- Phones ----------
/**
 * Normalise to E.164 digits without "+". UAE-first: 05x / 5x / 00971 / +971.
 * Keeps other international numbers that arrive with a country code (e.g. +63 PH).
 * Returns null when it cannot be a real mobile number.
 */
export function normalizePhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const plus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = s.slice(2);
  else if (!plus) {
    if (/^05\d{8}$/.test(s)) s = '971' + s.slice(1);
    else if (/^5\d{8}$/.test(s)) s = '971' + s;
    else if (/^0[2-9]\d{7}$/.test(s)) s = '971' + s.slice(1);
    else if (/^09\d{9}$/.test(s)) s = '63' + s.slice(1); // Philippine mobile written locally
  }
  if (s.startsWith('9710')) s = '971' + s.slice(4);
  if (s.startsWith('971') && !/^971(5\d{8}|[2-9]\d{7})$/.test(s)) return null;
  if (s.length < 8 || s.length > 15) return null;
  return s;
}
export function prettyPhone(e164) {
  if (!e164) return '';
  const m = /^971(5\d)(\d{3})(\d{4})$/.exec(e164);
  if (m) return `+971 ${m[1]} ${m[2]} ${m[3]}`;
  return '+' + e164;
}

// ---------- Misc ----------
export const token = (n = 18) => crypto.randomBytes(n).toString('base64url');

/** Short human booking code, e.g. AD-7K3M9Q (no 0/O/1/I). */
export function bookingCode() {
  const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const b = crypto.randomBytes(6);
  return 'AD-' + [...b].map((x) => A[x % A.length]).join('');
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/** Fill {{placeholders}}; returns { text, params } where params are the values in order of appearance. */
export function render(body, vars) {
  const params = [];
  const text = String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => {
    const v = vars[k] == null ? '' : String(vars[k]);
    params.push(v);
    return v;
  });
  return { text, params };
}
/** The Meta-approvable version of a body: {{name}} -> {{1}}, {{2}} in order. */
export function metaBody(body) {
  let i = 0;
  return String(body).replace(/\{\{\s*[a-z_]+\s*\}\}/g, () => `{{${++i}}}`);
}

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export const clean = (v, max = 500) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
export const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };
