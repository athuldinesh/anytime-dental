import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db, now, tx, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { verifyPassword, hashPassword } from '../lib/password.js';
import {
  dubai, dubaiToUtc, addDays, normalizePhone, prettyPhone, metaBody, render, json, clean, bad, notFound, HttpError, firstName,
} from '../lib/util.js';
import {
  bookingView, createBooking, setStatus, rescheduleBooking, cancelBooking, confirmBooking, sendTemplate, sendSurvey,
  upsertPatient, addToGroup, handleInbound, getPatient, availableSlots, baseUrl,
} from '../services/flows.js';
import { audience, automationDue, tick } from '../services/scheduler.js';
import { previewImport, classifyRows, aiReady } from '../services/classify.js';
import { verifyCredentials, liveReady } from '../services/whatsapp.js';

// ------------------------------------------------------------------ sessions
const COOKIE = 'ad_session';
const MAX_AGE = 12 * 3600e3;
const sign = (s) => crypto.createHmac('sha256', config.secret).update(s).digest('base64url');
function issue(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + MAX_AGE })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readSession(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, sig] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  if (!body || !sig || sign(body).length !== sig.length || !crypto.timingSafeEqual(Buffer.from(sign(body)), Buffer.from(sig))) return null;
  const p = json(Buffer.from(body, 'base64url').toString(), null);
  if (!p || p.exp < Date.now()) return null;
  return db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(p.uid) || null;
}
const cookieOpts = () => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE / 1000}${config.production ? '; Secure' : ''}`;

export const authRouter = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' } });

authRouter.post('/login', loginLimit, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'That email and password do not match.');
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(issue(u))}; ${cookieOpts()}`);
  res.json({ user: { id: u.id, email: u.email, name: u.name } });
});
authRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});
authRouter.get('/me', (req, res) => {
  const u = readSession(req);
  if (!u) throw new HttpError(401, 'Signed out');
  res.json({ user: u });
});

// ------------------------------------------------------------------ admin
export const adminRouter = Router();
adminRouter.use((req, _res, next) => {
  const u = readSession(req);
  if (!u) throw new HttpError(401, 'Please sign in again.');
  // CSRF: browsers cannot send this header cross-site without CORS, which we never grant.
  if (req.method !== 'GET' && req.get('x-anytime') !== '1') throw new HttpError(403, 'Missing request header.');
  req.user = u;
  next();
});

adminRouter.post('/password', (req, res) => {
  const { current, next: nw } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) throw bad('Your current password is not correct.');
  if (String(nw || '').length < 10) throw bad('Use at least 10 characters for the new password.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(nw), u.id);
  res.json({ ok: true });
});

const ser = (b) => bookingView(b);
const rowsOf = (sql, ...a) => db.prepare(sql).all(...a);

// ---------- overview
adminRouter.get('/overview', (_req, res) => {
  const d = dubai();
  const from = dubaiToUtc(d.date, '00:00'), to = dubaiToUtc(addDays(d.date, 1), '00:00');
  const today = rowsOf('SELECT * FROM bookings WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at', from, to).map(ser);
  const upcoming = rowsOf(`SELECT * FROM bookings WHERE starts_at >= ? AND status IN ('booked','confirmed') ORDER BY starts_at LIMIT 12`, to).map(ser);
  const n = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const r = getSetting('reminders', {});
  const queue = rowsOf(`SELECT * FROM bookings WHERE status IN ('booked','confirmed') AND starts_at > ? AND starts_at <= ?
      AND (reminder_day_at IS NULL OR reminder_2h_at IS NULL) ORDER BY starts_at LIMIT 12`, iso(n), iso(n + 48 * 3600e3)).map((b) => {
    const v = ser(b);
    const dayAt = Date.parse(b.starts_at) - Number(r.day_before_hours || 24) * 3600e3;
    const shortAt = Date.parse(b.starts_at) - Number(r.before_hours || 2) * 3600e3;
    v.next_reminder = !b.reminder_day_at && dayAt > n ? { kind: 'day', at: iso(dayAt) } : !b.reminder_2h_at ? { kind: '2h', at: iso(Math.max(shortAt, n)) } : null;
    return v;
  });
  const week = dubaiToUtc(addDays(d.date, -6), '00:00');
  const s = db.prepare(`SELECT COUNT(*) total, SUM(answered_at IS NOT NULL) answered, AVG(rating) avg,
      SUM(recommend >= 9) promoters, SUM(recommend <= 6) detractors, SUM(recommend IS NOT NULL) rated FROM surveys`).get();
  const m = db.prepare(`SELECT SUM(direction='out') sent, SUM(direction='in') received, SUM(status='failed') failed,
      SUM(status IN ('delivered','read')) delivered FROM messages WHERE created_at >= ?`).get(week);
  const confirmRate = db.prepare(`SELECT SUM(confirmed_at IS NOT NULL) c, COUNT(*) t FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status != 'cancelled'`).get(week, to);
  res.json({
    today, upcoming, queue,
    counts: {
      today: today.filter((b) => b.status !== 'cancelled').length,
      confirmed_today: today.filter((b) => b.status === 'confirmed' || b.status === 'completed').length,
      patients: db.prepare('SELECT COUNT(*) c FROM patients').get().c,
      grouped: db.prepare('SELECT COUNT(DISTINCT patient_id) c FROM patient_services').get().c,
    },
    week: { ...m, confirm_rate: confirmRate.t ? confirmRate.c / confirmRate.t : null },
    surveys: { ...s, nps: s.rated ? Math.round(((s.promoters - s.detractors) / s.rated) * 100) : null },
    whatsapp: { mode: getSetting('whatsapp', {}).mode, live: liveReady() },
    ai: aiReady(),
    date: d.date,
  });
});

// ---------- bookings
adminRouter.get('/bookings', (req, res) => {
  const { from, to, branch, status, q } = req.query;
  const where = [], args = [];
  if (from) { where.push('b.starts_at >= ?'); args.push(dubaiToUtc(String(from), '00:00')); }
  if (to) { where.push('b.starts_at < ?'); args.push(dubaiToUtc(addDays(String(to), 1), '00:00')); }
  if (branch) { where.push('b.branch_id = ?'); args.push(Number(branch)); }
  if (status) { where.push('b.status = ?'); args.push(String(status)); }
  if (q) { where.push('(p.name LIKE ? OR p.phone LIKE ? OR b.code LIKE ?)'); const l = `%${String(q).replace(/[%_]/g, '')}%`; args.push(l, l.replace(/[^\d%]/g, '') || l, l.toUpperCase()); }
  const list = rowsOf(`SELECT b.* FROM bookings b JOIN patients p ON p.id = b.patient_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.starts_at ${from ? 'ASC' : 'DESC'} LIMIT 500`, ...args);
  res.json({ bookings: list.map(ser) });
});

adminRouter.post('/bookings', async (req, res) => {
  const b = req.body || {};
  res.status(201).json({ booking: await createBooking({ ...b, source: 'admin', notify: b.notify !== false }) });
});

const bookingOr404 = (id) => { const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(id)); if (!b) throw notFound('Booking not found'); return b; };

adminRouter.get('/bookings/:id', (req, res) => res.json({ booking: ser(bookingOr404(req.params.id)) }));

adminRouter.patch('/bookings/:id', async (req, res) => {
  const b = bookingOr404(req.params.id);
  const { status, notes } = req.body || {};
  if (notes != null) db.prepare('UPDATE bookings SET notes = ?, updated_at = ? WHERE id = ?').run(clean(notes, 1000) || null, now(), b.id);
  if (status === 'cancelled') return res.json({ booking: await cancelBooking(b, { notify: req.body.notify !== false }) });
  if (status === 'confirmed' && req.body.notify) return res.json({ booking: await confirmBooking(b, { session: false }) });
  res.json({ booking: status ? setStatus(b, status) : ser(bookingOr404(b.id)) });
});
adminRouter.post('/bookings/:id/reschedule', async (req, res) => {
  const { date, time, branch_id, notify } = req.body || {};
  res.json({ booking: await rescheduleBooking(bookingOr404(req.params.id), { date: String(date || ''), time: String(time || ''), branch_id, notify: notify !== false }) });
});
adminRouter.post('/bookings/:id/remind', async (req, res) => {
  const b = bookingOr404(req.params.id);
  const key = req.body?.which === '2h' ? 'reminder_2h' : 'reminder_day';
  const m = await sendTemplate({ key, patient: getPatient(b.patient_id), booking: b });
  db.prepare(`UPDATE bookings SET ${key === 'reminder_2h' ? 'reminder_2h_at' : 'reminder_day_at'} = ? WHERE id = ?`).run(now(), b.id);
  res.json({ message: m, booking: ser(bookingOr404(b.id)) });
});
adminRouter.post('/bookings/:id/survey', async (req, res) => {
  const b = bookingOr404(req.params.id);
  if (b.status !== 'completed') throw bad('Mark the visit as completed before sending the survey.');
  res.json({ message: await sendSurvey(b), booking: ser(bookingOr404(b.id)) });
});
adminRouter.get('/slots', (req, res) => {
  const s = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(req.query.service));
  if (!s) throw bad('Choose a treatment');
  res.json({ slots: availableSlots({ branchId: Number(req.query.branch), date: String(req.query.date || ''), duration: s.duration_min, excludeBookingId: Number(req.query.exclude || 0) }) });
});

// ---------- patients & groups
function groupsOf(pid) {
  return rowsOf(`SELECT s.id, s.slug, s.name, ps.source, ps.confidence, ps.reason, ps.last_date FROM patient_services ps
      JOIN services s ON s.id = ps.service_id WHERE ps.patient_id = ? ORDER BY s.sort`, pid);
}

adminRouter.get('/patients', (req, res) => {
  const { q, service, page = 1, ungrouped, opted } = req.query;
  const where = [], args = [];
  if (q) { const l = `%${String(q).replace(/[%_]/g, '')}%`; where.push('(p.name LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)'); args.push(l, l.replace(/[^\d%]/g, '') || l, l); }
  if (service) { where.push('EXISTS (SELECT 1 FROM patient_services ps WHERE ps.patient_id = p.id AND ps.service_id = ?)'); args.push(Number(service)); }
  if (ungrouped) where.push('NOT EXISTS (SELECT 1 FROM patient_services ps WHERE ps.patient_id = p.id)');
  if (opted) where.push('p.opted_out = 1');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const per = 50, off = (Math.max(1, Number(page)) - 1) * per;
  const total = db.prepare(`SELECT COUNT(*) c FROM patients p ${w}`).get(...args).c;
  const list = rowsOf(`SELECT p.*, (SELECT MAX(starts_at) FROM bookings b WHERE b.patient_id = p.id) last_booking FROM patients p ${w} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, ...args, per, off)
    .map((p) => ({ ...p, phone_label: prettyPhone(p.phone), groups: groupsOf(p.id) }));
  res.json({ patients: list, total, per });
});

adminRouter.get('/patients/:id', (req, res) => {
  const p = getPatient(Number(req.params.id));
  if (!p) throw notFound('Patient not found');
  res.json({
    patient: { ...p, phone_label: prettyPhone(p.phone) },
    groups: groupsOf(p.id),
    bookings: rowsOf('SELECT * FROM bookings WHERE patient_id = ? ORDER BY starts_at DESC', p.id).map(ser),
    messages: rowsOf('SELECT * FROM messages WHERE patient_id = ? ORDER BY id DESC LIMIT 100', p.id).map((m) => ({ ...m, buttons: json(m.buttons, []) })),
  });
});

adminRouter.post('/patients', (req, res) => {
  const b = req.body || {};
  const p = upsertPatient({ name: b.name, phone: b.phone, email: b.email, notes: b.notes, source: 'manual' });
  for (const sid of b.service_ids || []) addToGroup(p.id, Number(sid), { source: 'manual', lastDate: b.last_date || null });
  res.status(201).json({ patient: p });
});

adminRouter.patch('/patients/:id', (req, res) => {
  const p = getPatient(Number(req.params.id));
  if (!p) throw notFound('Patient not found');
  const b = req.body || {};
  let phone = p.phone;
  if (b.phone != null) {
    phone = normalizePhone(b.phone);
    if (!phone) throw bad('That mobile number does not look right.');
    const clash = db.prepare('SELECT id FROM patients WHERE phone = ? AND id != ?').get(phone, p.id);
    if (clash) throw bad('Another patient already has this number.');
  }
  db.prepare('UPDATE patients SET name = ?, phone = ?, email = ?, notes = ?, opted_out = ? WHERE id = ?').run(
    b.name != null ? clean(b.name, 120) || p.name : p.name, phone,
    b.email != null ? clean(b.email, 160) || null : p.email,
    b.notes != null ? clean(b.notes, 2000) || null : p.notes,
    b.opted_out != null ? (b.opted_out ? 1 : 0) : p.opted_out, p.id);
  res.json({ patient: getPatient(p.id) });
});

adminRouter.delete('/patients/:id', (req, res) => {
  const p = getPatient(Number(req.params.id));
  if (!p) throw notFound('Patient not found');
  db.prepare('DELETE FROM patients WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

adminRouter.put('/patients/:id/groups', (req, res) => {
  const p = getPatient(Number(req.params.id));
  if (!p) throw notFound('Patient not found');
  const ids = (req.body?.service_ids || []).map(Number).filter(Boolean);
  tx(() => {
    db.prepare(`DELETE FROM patient_services WHERE patient_id = ? ${ids.length ? `AND service_id NOT IN (${ids.map(() => '?').join(',')})` : ''}`).run(p.id, ...ids);
    for (const sid of ids) {
      if (!db.prepare('SELECT 1 FROM patient_services WHERE patient_id = ? AND service_id = ?').get(p.id, sid)) addToGroup(p.id, sid, { source: 'manual' });
    }
  });
  res.json({ groups: groupsOf(p.id) });
});

adminRouter.get('/groups', (_req, res) => {
  res.json({
    groups: rowsOf(`SELECT s.id, s.slug, s.name, s.family,
        (SELECT COUNT(*) FROM patient_services ps JOIN patients p ON p.id = ps.patient_id WHERE ps.service_id = s.id) members,
        (SELECT COUNT(*) FROM patient_services ps JOIN patients p ON p.id = ps.patient_id WHERE ps.service_id = s.id AND p.opted_out = 0) reachable,
        (SELECT COUNT(*) FROM patient_services ps WHERE ps.service_id = s.id AND ps.source = 'ai') by_ai
      FROM services s ORDER BY s.sort`),
    ungrouped: db.prepare('SELECT COUNT(*) c FROM patients p WHERE NOT EXISTS (SELECT 1 FROM patient_services ps WHERE ps.patient_id = p.id)').get().c,
    ai: aiReady(),
  });
});

// ---------- import (AI filtration)
adminRouter.post('/import/preview', async (req, res) => {
  const { csv, mode } = req.body || {};
  if (!csv || String(csv).length < 10) throw bad('Choose a CSV file first.');
  try { res.json(await previewImport(String(csv), ['all', 'rules', 'auto'].includes(mode) ? mode : 'auto')); }
  catch (e) { if (e.status) throw bad(e.message); throw e; }
});

adminRouter.post('/import/commit', (req, res) => {
  const { items, filename, used_ai } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw bad('Nothing to import.');
  const slugs = Object.fromEntries(rowsOf('SELECT id, slug FROM services').map((s) => [s.slug, s.id]));
  let created = 0, updated = 0, grouped = 0;
  tx(() => {
    for (const it of items.slice(0, 20000)) {
      const phone = normalizePhone(it.phone);
      if (!phone) continue;
      const name = clean(it.name, 120) || 'Patient';
      const ex = db.prepare('SELECT * FROM patients WHERE phone = ?').get(phone);
      let pid;
      if (ex) {
        db.prepare(`UPDATE patients SET email = COALESCE(email, ?), notes = CASE WHEN ? = '' THEN notes ELSE TRIM(COALESCE(notes || ' · ', '') || ?) END,
            last_visit_at = CASE WHEN ? IS NOT NULL AND (last_visit_at IS NULL OR last_visit_at < ?) THEN ? ELSE last_visit_at END WHERE id = ?`)
          .run(clean(it.email, 160) || null, clean(it.text, 600), clean(it.text, 600), it.date || null, it.date || null, it.date || null, ex.id);
        pid = ex.id; updated++;
      } else {
        const r = db.prepare('INSERT INTO patients (name, phone, email, source, notes, last_visit_at, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(name, phone, clean(it.email, 160) || null, 'import', clean(it.text, 600) || null, it.date || null, now());
        pid = Number(r.lastInsertRowid); created++;
      }
      let any = false;
      for (const s of it.services || []) {
        const sid = slugs[s.slug];
        if (!sid) continue;
        addToGroup(pid, sid, { source: s.by === 'ai' ? 'ai' : 'rules', confidence: Number(s.confidence) || 0.8, reason: clean(s.reason, 120) || null, lastDate: it.date || null });
        any = true;
      }
      if (any) grouped++;
    }
    db.prepare('INSERT INTO imports (filename, rows, created, updated, grouped, used_ai, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(clean(filename, 200) || null, items.length, created, updated, grouped, used_ai ? 1 : 0, now());
  });
  res.json({ created, updated, grouped });
});

/** Re-run the classifier over patients who are not in any group yet, using their stored notes. */
adminRouter.post('/groups/reclassify', async (req, res) => {
  const list = rowsOf(`SELECT id, notes, last_visit_at FROM patients p WHERE notes IS NOT NULL AND notes != ''
      AND NOT EXISTS (SELECT 1 FROM patient_services ps WHERE ps.patient_id = p.id) LIMIT 2000`);
  if (!list.length) return res.json({ checked: 0, grouped: 0 });
  const { results, aiError } = await classifyRows(list.map((p) => ({ text: p.notes })), req.body?.mode || 'auto');
  const slugs = Object.fromEntries(rowsOf('SELECT id, slug FROM services').map((s) => [s.slug, s.id]));
  let grouped = 0;
  tx(() => list.forEach((p, i) => {
    const svc = results[i].services;
    for (const s of svc) addToGroup(p.id, slugs[s.slug], { source: s.by === 'ai' ? 'ai' : 'rules', confidence: s.confidence, reason: s.reason, lastDate: p.last_visit_at });
    if (svc.length) grouped++;
  }));
  res.json({ checked: list.length, grouped, aiError });
});

// ---------- templates
const tplOut = (t) => ({ ...t, buttons: json(t.buttons, []), meta_body: metaBody(t.body), variables: [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]) });
adminRouter.get('/templates', (_req, res) => res.json({ templates: rowsOf("SELECT * FROM templates ORDER BY kind DESC, name").map(tplOut) }));

const ALLOWED_VARS = new Set(['name', 'first_name', 'service', 'branch', 'date', 'time', 'code', 'address', 'floor', 'directions', 'map', 'link', 'book_link']);
function checkBody(body) {
  const b = String(body || '').trim();
  if (b.length < 5) throw bad('Write the message first.');
  if (b.length > 1024) throw bad('WhatsApp template bodies are limited to 1024 characters.');
  const unknown = [...b.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]).filter((v) => !ALLOWED_VARS.has(v));
  if (unknown.length) throw bad(`Unknown placeholder: {{${unknown[0]}}}. Use first_name, name or book_link.`);
  return b;
}

adminRouter.put('/templates/:key', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE key = ?').get(req.params.key);
  if (!t) throw notFound('Template not found');
  const { body, name, meta_name, meta_lang } = req.body || {};
  db.prepare('UPDATE templates SET body = ?, name = ?, meta_name = ?, meta_lang = ?, updated_at = ? WHERE key = ?').run(
    body != null ? checkBody(body) : t.body, name != null ? clean(name, 80) || t.name : t.name,
    meta_name != null ? (String(meta_name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || null) : t.meta_name,
    meta_lang != null ? clean(meta_lang, 10) || 'en' : t.meta_lang, now(), t.key);
  res.json({ template: tplOut(db.prepare('SELECT * FROM templates WHERE key = ?').get(t.key)) });
});

adminRouter.post('/templates', (req, res) => {
  const { name, body, meta_name } = req.body || {};
  const nm = clean(name, 80);
  if (nm.length < 2) throw bad('Give the template a name.');
  let key = nm.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'template';
  while (db.prepare('SELECT 1 FROM templates WHERE key = ?').get(key)) key += '_2';
  db.prepare("INSERT INTO templates (key, name, kind, body, buttons, meta_name, updated_at) VALUES (?,?,'broadcast',?,'[]',?,?)")
    .run(key, nm, checkBody(body), meta_name ? String(meta_name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : null, now());
  res.status(201).json({ template: tplOut(db.prepare('SELECT * FROM templates WHERE key = ?').get(key)) });
});

adminRouter.delete('/templates/:key', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE key = ?').get(req.params.key);
  if (!t) throw notFound('Template not found');
  if (t.kind === 'system') throw bad('System templates can be edited but not deleted.');
  if (db.prepare('SELECT 1 FROM automations WHERE template_key = ?').get(t.key) || db.prepare('SELECT 1 FROM broadcasts WHERE template_key = ?').get(t.key)) {
    throw bad('This template is used by a broadcast or automation, so it is kept for the record.');
  }
  db.prepare('DELETE FROM templates WHERE key = ?').run(t.key);
  res.json({ ok: true });
});

// ---------- broadcasts
adminRouter.get('/audience', (req, res) => {
  const ids = String(req.query.service_ids || '').split(',').map(Number).filter(Boolean);
  const list = audience(ids);
  const tpl = req.query.template ? db.prepare('SELECT * FROM templates WHERE key = ?').get(String(req.query.template)) : null;
  const sample = list[0];
  res.json({
    count: list.length,
    sample: list.slice(0, 6).map((p) => ({ name: p.name, phone: prettyPhone(p.phone) })),
    preview: tpl ? render(tpl.body, { name: sample?.name || 'Maria Santos', first_name: firstName(sample?.name || 'Maria'), book_link: `${baseUrl()}/book` }).text : null,
  });
});

adminRouter.get('/broadcasts', (_req, res) => {
  res.json({ broadcasts: rowsOf(`SELECT b.*, t.name template_name FROM broadcasts b JOIN templates t ON t.key = b.template_key ORDER BY b.id DESC LIMIT 200`)
    .map((b) => ({ ...b, service_ids: json(b.service_ids, []) })) });
});

adminRouter.post('/broadcasts', async (req, res) => {
  const { name, template_key, service_ids, scheduled_at } = req.body || {};
  const tpl = db.prepare('SELECT * FROM templates WHERE key = ?').get(String(template_key || ''));
  if (!tpl) throw bad('Choose a message template.');
  if (tpl.kind === 'system') throw bad('Pick a broadcast template, not a reminder template.');
  const ids = (service_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Choose at least one patient group.');
  const list = audience(ids);
  if (!list.length) throw bad('No reachable patients in the selected groups.');
  let when = null;
  if (scheduled_at) {
    const t = Date.parse(scheduled_at);
    if (Number.isNaN(t)) throw bad('That schedule time is not valid.');
    if (t < Date.now() - 60e3) throw bad('Pick a time in the future.');
    when = new Date(t).toISOString();
  }
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO broadcasts (name, template_key, service_ids, status, scheduled_at, total, created_at, started_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(clean(name, 120) || tpl.name, tpl.key, JSON.stringify(ids), when ? 'scheduled' : 'sending', when || now(), list.length, now(), when ? null : now());
    const bid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO broadcast_recipients (broadcast_id, patient_id) VALUES (?,?)');
    for (const p of list) ins.run(bid, p.id);
    return bid;
  });
  if (!when) setTimeout(tick, 50);
  res.status(201).json({ broadcast: db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id) });
});

adminRouter.get('/broadcasts/:id', (req, res) => {
  const b = db.prepare('SELECT b.*, t.name template_name, t.body FROM broadcasts b JOIN templates t ON t.key = b.template_key WHERE b.id = ?').get(Number(req.params.id));
  if (!b) throw notFound('Broadcast not found');
  const recipients = rowsOf(`SELECT r.status, r.error, p.id patient_id, p.name, p.phone, m.status message_status FROM broadcast_recipients r
      JOIN patients p ON p.id = r.patient_id LEFT JOIN messages m ON m.id = r.message_id WHERE r.broadcast_id = ? ORDER BY p.name LIMIT 2000`, b.id)
    .map((r) => ({ ...r, phone: prettyPhone(r.phone) }));
  res.json({ broadcast: { ...b, service_ids: json(b.service_ids, []) }, recipients });
});

adminRouter.post('/broadcasts/:id/cancel', (req, res) => {
  const b = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(Number(req.params.id));
  if (!b) throw notFound('Broadcast not found');
  if (!['scheduled', 'sending', 'draft'].includes(b.status)) throw bad('This broadcast has already finished.');
  db.prepare("UPDATE broadcasts SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), b.id);
  db.prepare("UPDATE broadcast_recipients SET status = 'skipped', error = 'Cancelled' WHERE broadcast_id = ? AND status = 'queued'").run(b.id);
  res.json({ ok: true });
});

// ---------- automations
const autoOut = (a) => ({ ...a, service: db.prepare('SELECT id, name, slug FROM services WHERE id = ?').get(a.service_id), template_name: db.prepare('SELECT name FROM templates WHERE key = ?').get(a.template_key)?.name, due_today: automationDue(a).length,
  sent_total: db.prepare('SELECT COUNT(*) c FROM automation_sends WHERE automation_id = ?').get(a.id).c });
adminRouter.get('/automations', (_req, res) => res.json({ automations: rowsOf('SELECT * FROM automations ORDER BY id').map(autoOut) }));

function autoInput(b, cur = {}) {
  const service_id = Number(b.service_id ?? cur.service_id);
  const template_key = String(b.template_key ?? cur.template_key ?? '');
  const days_after = Number(b.days_after ?? cur.days_after);
  const repeat_days = b.repeat_days === '' || b.repeat_days === null ? null : Number(b.repeat_days ?? cur.repeat_days) || null;
  if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(service_id)) throw bad('Choose the patient group.');
  const t = db.prepare('SELECT kind FROM templates WHERE key = ?').get(template_key);
  if (!t || t.kind !== 'broadcast') throw bad('Choose a broadcast template.');
  if (!(days_after >= 1 && days_after <= 1095)) throw bad('Days after the last visit must be between 1 and 1095.');
  if (repeat_days != null && !(repeat_days >= 7 && repeat_days <= 1095)) throw bad('Repeat every 7 to 1095 days, or leave it empty.');
  return { name: clean(b.name ?? cur.name, 120) || 'Automation', service_id, template_key, days_after, repeat_days, active: b.active == null ? (cur.active ?? 1) : (b.active ? 1 : 0) };
}
adminRouter.post('/automations', (req, res) => {
  const a = autoInput(req.body || {});
  const r = db.prepare('INSERT INTO automations (name, service_id, template_key, days_after, repeat_days, active, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(a.name, a.service_id, a.template_key, a.days_after, a.repeat_days, a.active, now());
  res.status(201).json({ automation: autoOut(db.prepare('SELECT * FROM automations WHERE id = ?').get(Number(r.lastInsertRowid))) });
});
adminRouter.patch('/automations/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM automations WHERE id = ?').get(Number(req.params.id));
  if (!cur) throw notFound('Automation not found');
  const a = autoInput(req.body || {}, cur);
  db.prepare('UPDATE automations SET name = ?, service_id = ?, template_key = ?, days_after = ?, repeat_days = ?, active = ? WHERE id = ?')
    .run(a.name, a.service_id, a.template_key, a.days_after, a.repeat_days, a.active, cur.id);
  res.json({ automation: autoOut(db.prepare('SELECT * FROM automations WHERE id = ?').get(cur.id)) });
});
adminRouter.delete('/automations/:id', (req, res) => {
  db.prepare('DELETE FROM automations WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- surveys
adminRouter.get('/surveys', (_req, res) => {
  const list = rowsOf(`SELECT s.*, p.name, b.code, b.starts_at, br.name branch, sv.name service FROM surveys s
      JOIN patients p ON p.id = s.patient_id JOIN bookings b ON b.id = s.booking_id JOIN branches br ON br.id = b.branch_id
      JOIN services sv ON sv.id = b.service_id ORDER BY s.id DESC LIMIT 500`);
  const byBranch = rowsOf(`SELECT br.name, COUNT(s.answered_at) answered, AVG(s.rating) avg, AVG(s.recommend) rec FROM surveys s
      JOIN bookings b ON b.id = s.booking_id JOIN branches br ON br.id = b.branch_id GROUP BY br.id`);
  const dist = [1, 2, 3, 4, 5].map((r) => db.prepare('SELECT COUNT(*) c FROM surveys WHERE rating = ?').get(r).c);
  const s = db.prepare(`SELECT COUNT(*) total, SUM(answered_at IS NOT NULL) answered, AVG(rating) avg, AVG(comfort) comfort, AVG(explained) explained,
      SUM(recommend >= 9) promoters, SUM(recommend <= 6) detractors, SUM(recommend IS NOT NULL) rated FROM surveys`).get();
  res.json({ responses: list, byBranch, dist, summary: { ...s, nps: s.rated ? Math.round(((s.promoters - s.detractors) / s.rated) * 100) : null } });
});

// ---------- messages
adminRouter.get('/messages', (req, res) => {
  const { kind, q, status, direction } = req.query;
  const where = [], args = [];
  if (kind) { where.push('m.kind = ?'); args.push(String(kind)); }
  if (status) { where.push('m.status = ?'); args.push(String(status)); }
  if (direction) { where.push('m.direction = ?'); args.push(String(direction)); }
  if (q) { const l = `%${String(q).replace(/[%_]/g, '')}%`; where.push('(p.name LIKE ? OR m.phone LIKE ? OR m.body LIKE ?)'); args.push(l, l.replace(/[^\d%]/g, '') || l, l); }
  const list = rowsOf(`SELECT m.*, p.name patient_name, b.token booking_token, b.status booking_status FROM messages m
      LEFT JOIN patients p ON p.id = m.patient_id LEFT JOIN bookings b ON b.id = m.booking_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 300`, ...args);
  res.json({ messages: list.map((m) => ({ ...m, buttons: json(m.buttons, []), phone_label: prettyPhone(m.phone) })), mode: getSetting('whatsapp', {}).mode });
});

/** Sandbox only: act as the patient tapping a button or replying. */
adminRouter.post('/sandbox/reply', async (req, res) => {
  if (getSetting('whatsapp', {}).mode === 'cloud') throw bad('Simulated replies are only available in sandbox mode.');
  const { message_id, button, text } = req.body || {};
  const m = db.prepare('SELECT m.*, b.token FROM messages m LEFT JOIN bookings b ON b.id = m.booking_id WHERE m.id = ?').get(Number(message_id));
  if (!m) throw notFound('Message not found');
  const payload = button && m.token ? `${String(button).toUpperCase()}:${m.token}` : '';
  const out = await handleInbound({ from: m.phone, payload, text: button ? (button === 'CONFIRM' ? 'Confirm' : 'Reschedule') : clean(text, 500), wa_id: 'sbx_in_' + crypto.randomBytes(6).toString('hex') });
  res.json(out);
});

adminRouter.post('/messages/test', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw bad('Enter the mobile number to send the test to.');
  const p = db.prepare('SELECT * FROM patients WHERE phone = ?').get(phone) || { id: null, name: 'Test', phone };
  const key = String(req.body?.template || 'general_update');
  const m = await sendTemplate({ key, patient: p, kind: 'test', vars: { service: 'Teeth cleaning', branch: 'Al Rigga, Deira', date: 'Friday 7 November', time: '4:30 PM', code: 'AD-TEST01', link: `${baseUrl()}/book` } });
  res.json({ message: m });
});

// ---------- settings
const SECRET_KEYS = ['token', 'app_secret', 'api_key'];
const mask = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, SECRET_KEYS.includes(k) ? (v ? `••••${String(v).slice(-4)}` : '') : v]));

adminRouter.get('/settings', (req, res) => {
  const base = baseUrl();
  res.json({
    whatsapp: mask(getSetting('whatsapp', {})), ai: mask(getSetting('ai', {})), reminders: getSetting('reminders', {}),
    clinic: getSetting('clinic', {}), broadcast: getSetting('broadcast', {}),
    webhook_url: `${base}/webhook/whatsapp`, base_url: base, ai_env: !!process.env.ANTHROPIC_API_KEY,
    branches: rowsOf('SELECT id, name, chairs FROM branches ORDER BY id'), user: req.user,
  });
});

adminRouter.put('/settings', (req, res) => {
  const b = req.body || {};
  const merge = (key, patch, allowed) => {
    if (!patch) return;
    const cur = getSetting(key, {});
    const next = { ...cur };
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      if (SECRET_KEYS.includes(k) && String(patch[k]).startsWith('••••')) continue; // unchanged mask
      next[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
    }
    setSetting(key, next);
  };
  if (b.whatsapp?.mode && !['sandbox', 'cloud'].includes(b.whatsapp.mode)) throw bad('Unknown WhatsApp mode');
  merge('whatsapp', b.whatsapp, ['mode', 'api_version', 'token', 'phone_number_id', 'waba_id', 'app_secret', 'verify_token']);
  merge('ai', b.ai, ['api_key', 'model']);
  if (b.reminders) {
    const r = b.reminders;
    if (r.day_before_hours != null && !(r.day_before_hours >= 6 && r.day_before_hours <= 72)) throw bad('The first reminder must be 6 to 72 hours before.');
    if (r.before_hours != null && !(r.before_hours >= 1 && r.before_hours <= 6)) throw bad('The second reminder must be 1 to 6 hours before.');
    if (r.survey_delay_min != null && !(r.survey_delay_min >= 0 && r.survey_delay_min <= 2880)) throw bad('Survey delay must be 0 to 2880 minutes.');
  }
  merge('reminders', b.reminders, ['day_before_hours', 'before_hours', 'survey_delay_min']);
  if (b.clinic?.public_url && !/^https?:\/\/[^\s]+$/.test(b.clinic.public_url)) throw bad('The public address must start with https://');
  merge('clinic', b.clinic, ['whatsapp', 'phone', 'email', 'public_url']);
  if (b.broadcast?.per_minute != null && !(b.broadcast.per_minute >= 1 && b.broadcast.per_minute <= 600)) throw bad('Sending speed must be 1 to 600 per minute.');
  merge('broadcast', b.broadcast, ['per_minute', 'grace_days']);
  if (Array.isArray(b.branches)) for (const br of b.branches) {
    const c = Number(br.chairs);
    if (c >= 1 && c <= 20) db.prepare('UPDATE branches SET chairs = ? WHERE id = ?').run(c, Number(br.id));
  }
  res.json({ ok: true });
});

adminRouter.post('/settings/whatsapp/verify', async (_req, res) => res.json(await verifyCredentials()));
