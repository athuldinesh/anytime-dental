import { db, now, tx, getSetting } from '../db.js';
import { config } from '../config.js';
import { transport, waConfig } from './whatsapp.js';
import {
  dubai, dubaiToUtc, prettyDate, prettyTime, normalizePhone, token, bookingCode,
  firstName, render, json, bad, notFound, clean,
} from '../lib/util.js';

// ---------------------------------------------------------------- lookups
export const getBranch = (id) => db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
export const getService = (id) => db.prepare('SELECT * FROM services WHERE id = ?').get(id);
export const getPatient = (id) => db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
export const getTemplate = (key) => db.prepare('SELECT * FROM templates WHERE key = ?').get(key);

export function baseUrl() {
  const c = getSetting('clinic', {});
  return (c.public_url || config.publicUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
}

export function bookingVars(b) {
  const p = getPatient(b.patient_id), s = getService(b.service_id), br = getBranch(b.branch_id);
  return {
    name: p?.name, first_name: firstName(p?.name), service: s?.name, branch: br?.name,
    date: prettyDate(b.starts_at), time: prettyTime(b.starts_at), code: b.code,
    address: br?.address, floor: br?.floor, directions: br?.directions, map: br?.maps_url,
    link: `${baseUrl()}/r/${b.token}`, book_link: `${baseUrl()}/book`,
  };
}

// ---------------------------------------------------------------- messaging
function hasOpenWindow(phone) {
  const r = db.prepare("SELECT created_at FROM messages WHERE phone = ? AND direction = 'in' ORDER BY id DESC LIMIT 1").get(phone);
  return !!r && Date.now() - Date.parse(r.created_at) < 23.5 * 3600 * 1000;
}

/**
 * Render a template and send it. Records every attempt in `messages`.
 * session=true means this is a reply inside the 24h window (free-form allowed).
 */
export async function sendTemplate({ key, patient, booking = null, broadcastId = null, vars = {}, session = false, kind }) {
  const tpl = getTemplate(key);
  if (!tpl) throw new Error(`Unknown template ${key}`);
  const base = booking ? bookingVars(booking) : { name: patient.name, first_name: firstName(patient.name), book_link: `${baseUrl()}/book` };
  const { text, params } = render(tpl.body, { ...base, ...vars });
  const buttons = json(tpl.buttons, []);
  const c = waConfig();

  let template = null;
  if (c.mode === 'cloud' && !(session || hasOpenWindow(patient.phone))) {
    if (!tpl.meta_name) {
      return record({ patient, booking, broadcastId, kind: kind || key, text, buttons, provider: 'cloud', status: 'failed',
        error: `"${tpl.name}" has no approved Meta template name yet (Settings → Message templates). WhatsApp only allows approved templates outside the 24-hour reply window.` });
    }
    template = {
      name: tpl.meta_name, lang: tpl.meta_lang || 'en', params,
      buttons: booking ? buttons.map((bt) => ({ payload: `${bt.id}:${booking.token}` })) : [],
    };
  } else if (c.mode === 'cloud' && tpl.meta_name && buttons.length && booking) {
    // Buttons only exist on templates, so prefer the template even inside the window.
    template = { name: tpl.meta_name, lang: tpl.meta_lang || 'en', params, buttons: buttons.map((bt) => ({ payload: `${bt.id}:${booking.token}` })) };
  }

  const row = record({ patient, booking, broadcastId, kind: kind || key, text, buttons, provider: c.mode === 'cloud' ? 'cloud' : 'sandbox', status: 'queued' });
  const res = await transport({ to: patient.phone, text: buttons.length && !template ? `${text}\n\nReply CONFIRM or RESCHEDULE.` : text, template });
  db.prepare('UPDATE messages SET status = ?, wa_id = ?, error = ?, provider = ?, updated_at = ? WHERE id = ?')
    .run(res.status, res.wa_id, res.error || null, res.provider, now(), row.id);
  return { ...row, status: res.status, error: res.error || null };
}

export async function sendLocation({ patient, booking, branch }) {
  const c = waConfig();
  const text = `Location: Anytime Dental ${branch.name}, ${branch.address}`;
  const row = record({ patient, booking, kind: 'location', text, buttons: [], provider: c.mode === 'cloud' ? 'cloud' : 'sandbox', status: 'queued' });
  const res = await transport({ to: patient.phone, text, location: { lat: branch.lat, lng: branch.lng, name: `Anytime Dental ${branch.name}`, address: branch.address } });
  db.prepare('UPDATE messages SET status = ?, wa_id = ?, error = ?, provider = ?, updated_at = ? WHERE id = ?')
    .run(res.status, res.wa_id, res.error || null, res.provider, now(), row.id);
}

function record({ patient, booking, broadcastId = null, kind, text, buttons, provider, status, error = null, direction = 'out', wa_id = null }) {
  const t = now();
  const r = db.prepare(`INSERT INTO messages (patient_id, booking_id, broadcast_id, direction, kind, phone, body, buttons, provider, wa_id, status, error, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(patient?.id ?? null, booking?.id ?? null, broadcastId, direction, kind, patient?.phone || '', text,
    JSON.stringify(buttons || []), provider, wa_id, status, error, t, t);
  return { id: Number(r.lastInsertRowid), status, error };
}

// ---------------------------------------------------------------- slots
const LEAD_MIN = 30;     // earliest bookable slot is 30 min from now
const STEP_MIN = 30;

export function availableSlots({ branchId, date, duration, excludeBookingId = 0 }) {
  const br = getBranch(branchId);
  if (!br) throw notFound('Branch not found');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Invalid date');
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const open = toMin(br.opens), close = toMin(br.closes);
  const dayStart = dubaiToUtc(date, '00:00'), dayEnd = dubaiToUtc(date, '23:59');
  const taken = db.prepare(`SELECT starts_at, duration_min FROM bookings
     WHERE branch_id = ? AND status IN ('booked','confirmed','completed') AND id != ? AND starts_at BETWEEN ? AND ?`)
    .all(branchId, excludeBookingId, dayStart, dayEnd)
    .map((b) => { const s = dubai(b.starts_at).minutes; return [s, s + b.duration_min]; });
  const n = dubai();
  const minStart = n.date === date ? n.minutes + LEAD_MIN : (date < n.date ? Infinity : -1);
  const out = [];
  for (let s = open; s + duration <= close; s += STEP_MIN) {
    const e = s + duration;
    const overlap = taken.filter(([a, b]) => a < e && s < b).length;
    out.push({ time: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, free: s >= minStart && overlap < br.chairs });
  }
  return out;
}

function assertSlot({ branchId, date, time, duration, excludeBookingId }) {
  const slot = availableSlots({ branchId, date, duration, excludeBookingId }).find((x) => x.time === time);
  if (!slot) throw bad('That time is outside opening hours (10 AM to 9 PM).');
  if (!slot.free) throw bad('That time was just taken. Please pick another slot.', { code: 'slot_taken' });
}

// ---------------------------------------------------------------- patients & groups
export function upsertPatient({ name, phone, email, source = 'web', notes }) {
  const p = normalizePhone(phone);
  if (!p) throw bad('Please enter a valid mobile number, for example 050 123 4567.');
  const nm = clean(name, 120);
  if (nm.length < 2) throw bad('Please enter your full name.');
  const ex = db.prepare('SELECT * FROM patients WHERE phone = ?').get(p);
  if (ex) {
    db.prepare('UPDATE patients SET name = ?, email = COALESCE(?, email), notes = COALESCE(?, notes) WHERE id = ?')
      .run(nm, clean(email, 160) || null, notes ? clean(notes, 2000) : null, ex.id);
    return getPatient(ex.id);
  }
  const r = db.prepare('INSERT INTO patients (name, phone, email, source, notes, created_at) VALUES (?,?,?,?,?,?)')
    .run(nm, p, clean(email, 160) || null, source, notes ? clean(notes, 2000) : null, now());
  return getPatient(Number(r.lastInsertRowid));
}

export function addToGroup(patientId, serviceId, { source, confidence = 1, reason = null, lastDate = null }) {
  db.prepare(`INSERT INTO patient_services (patient_id, service_id, source, confidence, reason, last_date, added_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(patient_id, service_id) DO UPDATE SET
       last_date = CASE WHEN excluded.last_date IS NOT NULL AND (patient_services.last_date IS NULL OR excluded.last_date > patient_services.last_date) THEN excluded.last_date ELSE patient_services.last_date END,
       source = CASE WHEN patient_services.source = 'manual' THEN 'manual' ELSE excluded.source END,
       confidence = MAX(patient_services.confidence, excluded.confidence),
       reason = COALESCE(excluded.reason, patient_services.reason)`)
    .run(patientId, serviceId, source, confidence, reason, lastDate, now());
}

// ---------------------------------------------------------------- bookings
const getBookingRow = (id) => db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
export const bookingByToken = (t) => db.prepare('SELECT * FROM bookings WHERE token = ?').get(String(t || ''));

export function bookingView(b) {
  if (!b) return null;
  const p = getPatient(b.patient_id), s = getService(b.service_id), br = getBranch(b.branch_id);
  const d = dubai(b.starts_at);
  return {
    id: b.id, code: b.code, token: b.token, status: b.status, starts_at: b.starts_at, duration_min: b.duration_min,
    date: d.date, time: d.time, date_label: prettyDate(b.starts_at), time_label: prettyTime(b.starts_at),
    notes: b.notes, source: b.source, created_at: b.created_at, confirmed_at: b.confirmed_at,
    reminder_day_at: b.reminder_day_at, reminder_2h_at: b.reminder_2h_at, survey_sent_at: b.survey_sent_at,
    reschedule_count: b.reschedule_count,
    patient: p && { id: p.id, name: p.name, phone: p.phone, email: p.email },
    service: s && { id: s.id, slug: s.slug, name: s.name },
    branch: br && { id: br.id, slug: br.slug, name: br.name, address: br.address, floor: br.floor, directions: br.directions, maps_url: br.maps_url, lat: br.lat, lng: br.lng },
  };
}

export async function createBooking(input) {
  const service = getService(Number(input.service_id));
  const branch = getBranch(Number(input.branch_id));
  if (!service) throw bad('Please choose a treatment.');
  if (!branch) throw bad('Please choose a clinic.');
  const date = String(input.date || ''), time = String(input.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw bad('Please choose a date and time.');
  const b = tx(() => {
    assertSlot({ branchId: branch.id, date, time, duration: service.duration_min });
    const patient = upsertPatient({ name: input.name, phone: input.phone, email: input.email, source: input.source || 'web' });
    const t = now();
    const r = db.prepare(`INSERT INTO bookings (code, token, patient_id, service_id, branch_id, starts_at, duration_min, status, notes, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(bookingCode(), token(), patient.id, service.id, branch.id, dubaiToUtc(date, time),
      service.duration_min, input.status === 'confirmed' ? 'confirmed' : 'booked', clean(input.notes, 1000) || null, input.source || 'web', t, t);
    addToGroup(patient.id, service.id, { source: 'booking', lastDate: date });
    return getBookingRow(Number(r.lastInsertRowid));
  });
  if (input.notify !== false) {
    await sendTemplate({ key: 'booking_received', patient: getPatient(b.patient_id), booking: b }).catch((e) => console.error('[booking_received]', e));
  }
  return bookingView(getBookingRow(b.id));
}

const ACTIVE = ['booked', 'confirmed'];

export async function confirmBooking(b, { session = true } = {}) {
  if (!ACTIVE.includes(b.status)) throw bad(`This appointment is ${b.status.replace('_', ' ')} and cannot be confirmed.`);
  db.prepare("UPDATE bookings SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?), updated_at = ? WHERE id = ?").run(now(), now(), b.id);
  const fresh = getBookingRow(b.id), patient = getPatient(b.patient_id);
  await sendTemplate({ key: 'confirmed', patient, booking: fresh, session });
  await sendLocation({ patient, booking: fresh, branch: getBranch(b.branch_id) });
  return bookingView(fresh);
}

export async function requestReschedule(b) {
  if (!ACTIVE.includes(b.status)) throw bad('This appointment can no longer be changed.');
  await sendTemplate({ key: 'reschedule', patient: getPatient(b.patient_id), booking: b, session: true });
  return bookingView(b);
}

export async function rescheduleBooking(b, { date, time, branch_id, notify = true }) {
  if (!ACTIVE.includes(b.status)) throw bad('This appointment can no longer be changed.');
  const branchId = branch_id ? Number(branch_id) : b.branch_id;
  if (!getBranch(branchId)) throw bad('Please choose a clinic.');
  tx(() => {
    assertSlot({ branchId, date, time, duration: b.duration_min, excludeBookingId: b.id });
    const starts = dubaiToUtc(date, time);
    // A reminder whose moment has already passed for the new time would arrive right after the
    // "rescheduled" message, so mark it skipped instead.
    const r = getSetting('reminders', {});
    const left = Date.parse(starts) - Date.now();
    const day = left < Number(r.day_before_hours || 24) * 3600e3 ? 'skipped' : null;
    const short = left < Number(r.before_hours || 2) * 3600e3 ? 'skipped' : null;
    db.prepare(`UPDATE bookings SET starts_at = ?, branch_id = ?, status = 'booked', confirmed_at = NULL, reminder_day_at = ?, reminder_2h_at = ?,
        reschedule_count = reschedule_count + 1, updated_at = ? WHERE id = ?`).run(starts, branchId, day, short, now(), b.id);
    db.prepare('UPDATE patient_services SET last_date = ? WHERE patient_id = ? AND service_id = ? AND source = ?').run(date, b.patient_id, b.service_id, 'booking');
  });
  const fresh = getBookingRow(b.id);
  if (notify) await sendTemplate({ key: 'rescheduled', patient: getPatient(b.patient_id), booking: fresh, session: true }).catch(() => {});
  return bookingView(fresh);
}

export async function cancelBooking(b, { notify = true } = {}) {
  if (!ACTIVE.includes(b.status)) throw bad('This appointment is already closed.');
  db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), b.id);
  const fresh = getBookingRow(b.id);
  if (notify) await sendTemplate({ key: 'cancelled', patient: getPatient(b.patient_id), booking: fresh, session: true }).catch(() => {});
  return bookingView(fresh);
}

export function setStatus(b, status) {
  if (!['booked', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(status)) throw bad('Unknown status');
  const t = now();
  db.prepare(`UPDATE bookings SET status = ?, updated_at = ?,
      completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END,
      cancelled_at = CASE WHEN ? = 'cancelled' THEN COALESCE(cancelled_at, ?) ELSE cancelled_at END,
      confirmed_at = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END
    WHERE id = ?`).run(status, t, status, t, status, t, status, t, b.id);
  if (status === 'completed') {
    const d = dubai(b.starts_at).date;
    db.prepare('UPDATE patients SET last_visit_at = CASE WHEN last_visit_at IS NULL OR last_visit_at < ? THEN ? ELSE last_visit_at END WHERE id = ?').run(d, d, b.patient_id);
    addToGroup(b.patient_id, b.service_id, { source: 'booking', lastDate: d });
  }
  return bookingView(getBookingRow(b.id));
}

export async function sendSurvey(b) {
  let s = db.prepare('SELECT * FROM surveys WHERE booking_id = ?').get(b.id);
  if (!s) {
    db.prepare('INSERT INTO surveys (booking_id, patient_id, token, sent_at) VALUES (?,?,?,?)').run(b.id, b.patient_id, token(), now());
    s = db.prepare('SELECT * FROM surveys WHERE booking_id = ?').get(b.id);
  }
  db.prepare('UPDATE bookings SET survey_sent_at = ? WHERE id = ?').run(now(), b.id);
  return sendTemplate({ key: 'survey', patient: getPatient(b.patient_id), booking: b, vars: { link: `${baseUrl()}/s/${s.token}` } });
}

// ---------------------------------------------------------------- inbound
const YES = /^(confirm(ed)?|yes|yep|ok(ay)?|oo|opo|sure|coming|on my way|1)\b/i;
const MOVE = /^(re-?sched(ule)?|change|move|cannot|can't|cant|hindi|2)\b/i;

/** Handles a WhatsApp message or button tap from a patient. Returns what it did. */
export async function handleInbound({ from, text = '', payload = '', wa_id = null, name = '' }) {
  const phone = normalizePhone('+' + String(from).replace(/^\+/, ''));
  if (!phone) return { action: 'ignored' };
  if (wa_id && db.prepare("SELECT 1 FROM messages WHERE wa_id = ? AND direction = 'in'").get(wa_id)) return { action: 'duplicate' };
  let patient = db.prepare('SELECT * FROM patients WHERE phone = ?').get(phone);
  if (!patient && name) patient = upsertPatient({ name, phone, source: 'whatsapp' });

  const body = clean(text || payload, 2000);
  record({ patient: patient || { phone }, booking: null, kind: payload ? 'button' : 'reply', text: body || '(empty)', buttons: [], provider: waConfig().mode === 'cloud' ? 'cloud' : 'sandbox', status: 'received', direction: 'in', wa_id });
  if (!patient) return { action: 'logged' };

  // Explicit button payload: CONFIRM:<token> / RESCHEDULE:<token>
  const m = /^(CONFIRM|RESCHEDULE):(.+)$/.exec(payload || '');
  let b = m ? bookingByToken(m[2]) : null;
  let intent = m ? m[1] : null;

  if (!intent) {
    const word = body.trim();
    if (/^(stop|unsubscribe)\b/i.test(word)) {
      db.prepare('UPDATE patients SET opted_out = 1 WHERE id = ?').run(patient.id);
      await sendTemplate({ key: 'opt_out', patient, session: true }).catch(() => {});
      return { action: 'opted_out' };
    }
    if (/^start\b/i.test(word)) { db.prepare('UPDATE patients SET opted_out = 0 WHERE id = ?').run(patient.id); return { action: 'opted_in' }; }
    if (YES.test(word)) intent = 'CONFIRM';
    else if (MOVE.test(word)) intent = 'RESCHEDULE';
  }
  if (!intent) return { action: 'logged' };
  if (!b) {
    b = db.prepare(`SELECT * FROM bookings WHERE patient_id = ? AND status IN ('booked','confirmed') AND starts_at > ? ORDER BY starts_at LIMIT 1`)
      .get(patient.id, new Date(Date.now() - 3600e3).toISOString());
  }
  if (!b || b.patient_id !== patient.id || !ACTIVE.includes(b.status)) return { action: 'no_booking' };
  if (intent === 'CONFIRM') { await confirmBooking(b); return { action: 'confirmed', booking: b.code }; }
  await requestReschedule(b);
  return { action: 'reschedule_link', booking: b.code };
}

export function statusUpdate({ wa_id, status, error }) {
  if (!wa_id) return;
  const order = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const cur = db.prepare('SELECT id, status FROM messages WHERE wa_id = ?').get(wa_id);
  if (!cur) return;
  if (status !== 'failed' && (order[status] ?? 0) <= (order[cur.status] ?? 0)) return;
  db.prepare('UPDATE messages SET status = ?, error = COALESCE(?, error), updated_at = ? WHERE id = ?').run(status, error || null, now(), cur.id);
  if (status === 'failed') {
    db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE message_id = ?").run(error || 'Delivery failed', cur.id);
  }
}
