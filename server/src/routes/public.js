import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, now, getSetting } from '../db.js';
import {
  availableSlots, createBooking, bookingByToken, bookingView, confirmBooking, cancelBooking,
  rescheduleBooking, getService, getBranch,
} from '../services/flows.js';
import { dubai, addDays, prettyDate, bad, notFound, clean } from '../lib/util.js';

export const publicRouter = Router();

const writeLimit = rateLimit({ windowMs: 10 * 60e3, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please try again in a few minutes.' } });

publicRouter.get('/meta', (_req, res) => {
  const c = getSetting('clinic', {});
  res.json({
    branches: db.prepare('SELECT id, slug, name, area, address, floor, directions, lat, lng, maps_url, reviews_url, phone, opens, closes FROM branches ORDER BY id').all(),
    services: db.prepare('SELECT id, slug, name, family, blurb, duration_min FROM services ORDER BY sort').all(),
    dentists: db.prepare('SELECT id, name, role, photo FROM dentists ORDER BY sort').all(),
    clinic: { whatsapp: c.whatsapp, phone: c.phone, email: c.email },
    now: { ...dubai(), iso: now() },
  });
});

publicRouter.get('/days', (req, res) => {
  const branch = getBranch(Number(req.query.branch)), service = getService(Number(req.query.service));
  if (!branch || !service) throw bad('Choose a clinic and a treatment first.');
  const today = dubai().date;
  const days = [];
  for (let i = 0; i < 21; i++) {
    const date = addDays(today, i);
    const slots = availableSlots({ branchId: branch.id, date, duration: service.duration_min });
    days.push({ date, label: prettyDate(`${date}T08:00:00.000Z`), free: slots.filter((s) => s.free).length });
  }
  res.json({ days });
});

publicRouter.get('/slots', (req, res) => {
  const branch = getBranch(Number(req.query.branch)), service = getService(Number(req.query.service));
  if (!branch || !service) throw bad('Choose a clinic and a treatment first.');
  const exclude = req.query.token ? bookingByToken(req.query.token)?.id || 0 : 0;
  res.json({ slots: availableSlots({ branchId: branch.id, date: String(req.query.date || ''), duration: service.duration_min, excludeBookingId: exclude }) });
});

publicRouter.post('/bookings', writeLimit, async (req, res) => {
  const b = req.body || {};
  if (b.website) throw bad('Rejected'); // honeypot
  if (!b.consent) throw bad('Please agree to receive appointment messages on WhatsApp.');
  const view = await createBooking({
    service_id: b.service_id, branch_id: b.branch_id, date: b.date, time: b.time,
    name: b.name, phone: b.phone, email: b.email, notes: b.notes, source: 'web',
  });
  res.status(201).json({ booking: view });
});

const byToken = (req) => {
  const b = bookingByToken(req.params.token);
  if (!b) throw notFound('We could not find that booking. The link may be incomplete.');
  return b;
};

publicRouter.get('/bookings/:token', (req, res) => res.json({ booking: bookingView(byToken(req)) }));
publicRouter.post('/bookings/:token/confirm', writeLimit, async (req, res) => res.json({ booking: await confirmBooking(byToken(req)) }));
publicRouter.post('/bookings/:token/cancel', writeLimit, async (req, res) => res.json({ booking: await cancelBooking(byToken(req)) }));
publicRouter.post('/bookings/:token/reschedule', writeLimit, async (req, res) => {
  const { date, time, branch_id } = req.body || {};
  res.json({ booking: await rescheduleBooking(byToken(req), { date: String(date || ''), time: String(time || ''), branch_id }) });
});

// ---- satisfaction survey
const surveyByToken = (t) => db.prepare('SELECT * FROM surveys WHERE token = ?').get(String(t || ''));

publicRouter.get('/surveys/:token', (req, res) => {
  const s = surveyByToken(req.params.token);
  if (!s) throw notFound('This survey link is not valid.');
  const b = bookingView(db.prepare('SELECT * FROM bookings WHERE id = ?').get(s.booking_id));
  res.json({ survey: { answered: !!s.answered_at, first_name: (b?.patient?.name || '').split(' ')[0], branch: b?.branch?.name, service: b?.service?.name, date: b?.date_label, reviews_url: getBranch(b?.branch?.id)?.reviews_url } });
});

publicRouter.post('/surveys/:token', writeLimit, (req, res) => {
  const s = surveyByToken(req.params.token);
  if (!s) throw notFound('This survey link is not valid.');
  if (s.answered_at) throw bad('Thank you, we already have your answers.');
  const { rating, recommend, comfort, explained, comment } = req.body || {};
  const r = Number(rating), n = Number(recommend);
  if (!(r >= 1 && r <= 5)) throw bad('Please choose a rating from 1 to 5.');
  if (!(n >= 0 && n <= 10)) throw bad('Please choose how likely you are to recommend us.');
  const opt = (v) => (v == null || v === '' ? null : Math.max(1, Math.min(5, Number(v) || 0)) || null);
  db.prepare('UPDATE surveys SET rating = ?, recommend = ?, comfort = ?, explained = ?, comment = ?, answered_at = ? WHERE id = ?')
    .run(r, n, opt(comfort), opt(explained), clean(comment, 2000) || null, now(), s.id);
  res.json({ ok: true });
});
