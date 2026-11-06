// Scheduler + WhatsApp flow tests against a throwaway database.  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anytime-test-'));
process.env.ADMIN_PASSWORD = 'test-password-123';
const { db, setSetting, getSetting } = await import('../src/db.js');
const flows = await import('../src/services/flows.js');
const { tick, automationDue } = await import('../src/services/scheduler.js');
const { previewImport } = await import('../src/services/classify.js');
const { normalizePhone, dubai, addDays } = await import('../src/lib/util.js');

const msgs = (bookingId) => db.prepare('SELECT kind, direction, body, status FROM messages WHERE booking_id = ? ORDER BY id').all(bookingId);
const iso = (ms) => new Date(ms).toISOString();

function makeBooking({ hoursAhead, createdHoursAgo = 72, phone = '0501112233', name = 'Ana Cruz' }) {
  const p = flows.upsertPatient({ name, phone });
  const starts = iso(Date.now() + hoursAhead * 3600e3);
  const r = db.prepare(`INSERT INTO bookings (code, token, patient_id, service_id, branch_id, starts_at, duration_min, status, source, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'booked', 'web', ?, ?)`).run('AD-T' + crypto.randomBytes(3).toString('hex').toUpperCase(), 'tok' + crypto.randomBytes(8).toString('hex'), p.id, 2, 1, starts, 45,
    iso(Date.now() - createdHoursAgo * 3600e3), iso(Date.now()));
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(r.lastInsertRowid));
}

test('phone normalisation (UAE first, PH kept)', () => {
  assert.equal(normalizePhone('050 123 4567'), '971501234567');
  assert.equal(normalizePhone('+971 55 765 4321'), '971557654321');
  assert.equal(normalizePhone('00971521112233'), '971521112233');
  assert.equal(normalizePhone('+63 917 123 4567'), '639171234567');
  assert.equal(normalizePhone('12345'), null);
});

test('day-before reminder goes out with Confirm / Reschedule, once', async () => {
  const b = makeBooking({ hoursAhead: 20 });
  await tick();
  const m = msgs(b.id);
  assert.equal(m.filter((x) => x.kind === 'reminder_day').length, 1);
  assert.match(m[0].body, /tomorrow/);
  await tick();
  assert.equal(msgs(b.id).filter((x) => x.kind === 'reminder_day').length, 1, 'not sent twice');
});

test('2-hour reminder goes out inside the window', async () => {
  const b = makeBooking({ hoursAhead: 1.5, phone: '0502223344' });
  await tick();
  const kinds = msgs(b.id).map((x) => x.kind);
  assert.ok(kinds.includes('reminder_2h'));
  assert.ok(!kinds.includes('reminder_day'), 'day reminder is not sent when only 1.5h remain');
});

test('late booking skips the day reminder', async () => {
  const b = makeBooking({ hoursAhead: 10, createdHoursAgo: 1, phone: '0503334455' });
  await tick();
  assert.equal(db.prepare('SELECT reminder_day_at FROM bookings WHERE id = ?').get(b.id).reminder_day_at, 'skipped');
});

test('patient taps Confirm → confirmed + floor text + location pin', async () => {
  const b = makeBooking({ hoursAhead: 30, phone: '0504445566' });
  const out = await flows.handleInbound({ from: '971504445566', payload: `CONFIRM:${b.token}`, text: 'Confirm', wa_id: 'wamid.1' });
  assert.equal(out.action, 'confirmed');
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(b.id).status, 'confirmed');
  const m = msgs(b.id);
  assert.ok(m.some((x) => x.kind === 'confirmed' && /8th floor/.test(x.body)));
  assert.ok(m.some((x) => x.kind === 'location'));
  const dup = await flows.handleInbound({ from: '971504445566', payload: `CONFIRM:${b.token}`, wa_id: 'wamid.1' });
  assert.equal(dup.action, 'duplicate', 'webhook retries are ignored');
});

test('patient asks to reschedule → self-service link; rescheduling resets reminders', async () => {
  const b = makeBooking({ hoursAhead: 30, phone: '0505556677' });
  const out = await flows.handleInbound({ from: '971505556677', text: 'reschedule please' });
  assert.equal(out.action, 'reschedule_link');
  assert.ok(msgs(b.id).some((x) => x.kind === 'reschedule' && x.body.includes(`/r/${b.token}`)));
  const day = addDays(dubai().date, 5);
  const v = await flows.rescheduleBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id), { date: day, time: '15:00' });
  assert.equal(v.date, day); assert.equal(v.time, '15:00'); assert.equal(v.status, 'booked');
  assert.equal(v.reminder_day_at, null);
});

test('STOP opts out of broadcasts', async () => {
  flows.upsertPatient({ name: 'Optout Person', phone: '0506667788' });
  const r = await flows.handleInbound({ from: '971506667788', text: 'STOP' });
  assert.equal(r.action, 'opted_out');
  assert.equal(db.prepare("SELECT opted_out FROM patients WHERE phone = '971506667788'").get().opted_out, 1);
});

test('completed visit → survey link after the delay', async () => {
  setSetting('reminders', { day_before_hours: 24, before_hours: 2, survey_delay_min: 0 });
  const b = makeBooking({ hoursAhead: -1, phone: '0507778899' });
  flows.setStatus(b, 'completed');
  await tick();
  const s = db.prepare('SELECT * FROM surveys WHERE booking_id = ?').get(b.id);
  assert.ok(s, 'survey row created');
  assert.ok(msgs(b.id).some((x) => x.kind === 'survey' && x.body.includes(`/s/${s.token}`)));
});

test('a full slot cannot be double-booked', async () => {
  db.prepare('UPDATE branches SET chairs = 1 WHERE id = 2').run();
  const date = addDays(dubai().date, 3);
  await flows.createBooking({ service_id: 1, branch_id: 2, date, time: '11:00', name: 'First Person', phone: '0521230001', notify: false });
  await assert.rejects(flows.createBooking({ service_id: 1, branch_id: 2, date, time: '11:00', name: 'Second Person', phone: '0521230002', notify: false }), /just taken/);
});

test('automation finds patients due N days after their last treatment', () => {
  const p = flows.upsertPatient({ name: 'Recall Due', phone: '0509990001' });
  flows.addToGroup(p.id, 2, { source: 'manual', lastDate: addDays(dubai().date, -181) });
  const a = db.prepare("SELECT * FROM automations WHERE template_key = 'recall_cleaning' LIMIT 1").get();
  assert.ok(automationDue(a).some((x) => x.patient_id === p.id));
});

test('import sorts English + Tagalog records into groups (rules)', async () => {
  const csv = 'Name,Mobile,Treatment\nA,0501000001,Pasta lower molar\nB,0501000002,Bunot wisdom\nC,0501000003,Braces adj\nD,0501000004,Invisalign tray 3\nE,0501000005,OP + scaling\n';
  const r = await previewImport(csv, 'rules');
  const slugs = r.items.map((x) => x.services.map((s) => s.slug).sort().join('+'));
  assert.deepEqual(slugs, ['filling', 'extraction', 'braces', 'aligners', 'cleaning+scaling']);
});

test('webhook verifies the Meta signature', async () => {
  const { webhookRouter } = await import('../src/routes/webhook.js');
  const express = (await import('express')).default;
  setSetting('whatsapp', { ...getSetting('whatsapp', {}), app_secret: 's3cret' });
  const app = express(); app.use('/w', webhookRouter);
  const srv = app.listen(0); const port = srv.address().port;
  const bad = await fetch(`http://127.0.0.1:${port}/w`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: '{}' });
  assert.equal(bad.status, 401);
  const body = JSON.stringify({ entry: [] });
  const good = await fetch(`http://127.0.0.1:${port}/w`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex') }, body });
  assert.equal(good.status, 200);
  const verify = await fetch(`http://127.0.0.1:${port}/w?hub.mode=subscribe&hub.verify_token=${getSetting('whatsapp').verify_token}&hub.challenge=42`);
  assert.equal(await verify.text(), '42');
  srv.close();
});
