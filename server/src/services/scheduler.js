// One loop, every 30 s:
//   1. "1 day before" reminders (Confirm / Reschedule)
//   2. "2 hours before" reminders (Confirm / Reschedule)
//   3. satisfaction surveys after a visit is marked completed
//   4. automations (per service group, N days after the last treatment) → queue a broadcast
//   5. pump queued broadcasts at the configured rate
import { db, now, getSetting } from '../db.js';
import { sendTemplate, sendSurvey, getPatient } from './flows.js';
import { dubai, addDays, daysBetween, json } from '../lib/util.js';

let running = false;
const log = (...a) => console.log('[scheduler]', ...a);

export async function tick() {
  if (running) return;
  running = true;
  try {
    await reminders();
    await surveys();
    runAutomations();
    await pumpBroadcasts();
  } catch (e) {
    console.error('[scheduler] tick failed', e);
  } finally {
    running = false;
  }
}

async function reminders() {
  const r = getSetting('reminders', {});
  const dayH = Number(r.day_before_hours || 24), shortH = Number(r.before_hours || 2);
  const n = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  // Day-before: due when within dayH of the start, but only while there's still more than shortH to go.
  const dayDue = db.prepare(`SELECT * FROM bookings WHERE status IN ('booked','confirmed') AND reminder_day_at IS NULL
      AND starts_at <= ? AND starts_at > ?`).all(iso(n + dayH * 3600e3), iso(n + shortH * 3600e3));
  for (const b of dayDue) {
    // Booked less than a day ahead (e.g. at 3 PM for tomorrow 10 AM)? the booking message already covered it.
    if (Date.parse(b.created_at) > Date.parse(b.starts_at) - dayH * 3600e3) {
      db.prepare("UPDATE bookings SET reminder_day_at = 'skipped' WHERE id = ?").run(b.id);
      continue;
    }
    db.prepare('UPDATE bookings SET reminder_day_at = ? WHERE id = ?').run(now(), b.id);
    const m = await sendTemplate({ key: 'reminder_day', patient: getPatient(b.patient_id), booking: b });
    log('day reminder', b.code, m.status, m.error || '');
  }

  const shortDue = db.prepare(`SELECT * FROM bookings WHERE status IN ('booked','confirmed') AND reminder_2h_at IS NULL
      AND starts_at <= ? AND starts_at > ?`).all(iso(n + shortH * 3600e3), iso(n + 10 * 60e3));
  for (const b of shortDue) {
    if (Date.parse(b.created_at) > Date.parse(b.starts_at) - shortH * 3600e3) {
      db.prepare("UPDATE bookings SET reminder_2h_at = 'skipped' WHERE id = ?").run(b.id);
      continue;
    }
    db.prepare('UPDATE bookings SET reminder_2h_at = ? WHERE id = ?').run(now(), b.id);
    const m = await sendTemplate({ key: 'reminder_2h', patient: getPatient(b.patient_id), booking: b });
    log('2h reminder', b.code, m.status, m.error || '');
  }
}

async function surveys() {
  const delay = Number(getSetting('reminders', {}).survey_delay_min ?? 120);
  const due = db.prepare(`SELECT * FROM bookings WHERE status = 'completed' AND survey_sent_at IS NULL AND completed_at IS NOT NULL
      AND completed_at <= ? AND completed_at > ?`).all(new Date(Date.now() - delay * 60e3).toISOString(), new Date(Date.now() - 7 * 864e5).toISOString());
  for (const b of due) {
    const m = await sendSurvey(b);
    log('survey', b.code, m.status, m.error || '');
  }
}

/** Patients an automation would message today. Shared by the scheduler and the dashboard preview. */
export function automationDue(a, today = dubai().date) {
  const grace = Number(getSetting('broadcast', {}).grace_days ?? 7);
  const rows = db.prepare(`SELECT ps.patient_id, ps.last_date FROM patient_services ps JOIN patients p ON p.id = ps.patient_id
      WHERE ps.service_id = ? AND ps.last_date IS NOT NULL AND p.opted_out = 0`).all(a.service_id);
  const out = [];
  for (const r of rows) {
    let due = addDays(r.last_date, a.days_after);
    if (due > today) continue;
    if (a.repeat_days) {
      const k = Math.floor(daysBetween(due, today) / a.repeat_days);
      due = addDays(due, k * a.repeat_days);
    }
    if (daysBetween(due, today) > grace) continue;
    // Someone with an upcoming appointment doesn't need a nudge.
    const upcoming = db.prepare("SELECT 1 FROM bookings WHERE patient_id = ? AND status IN ('booked','confirmed') AND starts_at > ?").get(r.patient_id, now());
    if (upcoming) continue;
    if (db.prepare('SELECT 1 FROM automation_sends WHERE automation_id = ? AND patient_id = ? AND due_date = ?').get(a.id, r.patient_id, due)) continue;
    out.push({ patient_id: r.patient_id, due_date: due });
  }
  return out;
}

function runAutomations() {
  const d = dubai();
  if (d.hh < 10 || d.hh >= 20) return; // send inside clinic hours only
  const list = db.prepare('SELECT * FROM automations WHERE active = 1').all();
  for (const a of list) {
    if (a.last_run_at && dubai(a.last_run_at).date === d.date) continue;
    const due = automationDue(a, d.date);
    db.prepare('UPDATE automations SET last_run_at = ? WHERE id = ?').run(now(), a.id);
    if (!due.length) continue;
    const t = now();
    const r = db.prepare(`INSERT INTO broadcasts (name, template_key, service_ids, status, scheduled_at, total, automation_id, created_at, started_at)
        VALUES (?,?,?,'sending',?,?,?,?,?)`).run(`${a.name} · ${d.date}`, a.template_key, JSON.stringify([a.service_id]), t, due.length, a.id, t, t);
    const bid = Number(r.lastInsertRowid);
    const insR = db.prepare('INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, patient_id) VALUES (?,?)');
    const insS = db.prepare('INSERT OR IGNORE INTO automation_sends (automation_id, patient_id, due_date) VALUES (?,?,?)');
    for (const x of due) { insR.run(bid, x.patient_id); insS.run(a.id, x.patient_id, x.due_date); }
    log('automation queued', a.name, due.length);
  }
}

/** Resolve the audience for a set of service groups (opted-out patients excluded). */
export function audience(serviceIds) {
  const ids = (serviceIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  return db.prepare(`SELECT DISTINCT p.id, p.name, p.phone FROM patients p JOIN patient_services ps ON ps.patient_id = p.id
      WHERE p.opted_out = 0 AND ps.service_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name`).all(...ids);
}

async function pumpBroadcasts() {
  const t = now();
  db.prepare("UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, ?) WHERE status = 'scheduled' AND scheduled_at <= ?").run(t, t);
  const perMin = Math.max(1, Number(getSetting('broadcast', {}).per_minute || 60));
  let budget = Math.ceil(perMin / 2); // tick runs every 30 s
  const active = db.prepare("SELECT * FROM broadcasts WHERE status = 'sending' ORDER BY id").all();
  for (const b of active) {
    const queue = db.prepare("SELECT * FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'queued' LIMIT ?").all(b.id, budget);
    for (const r of queue) {
      const p = getPatient(r.patient_id);
      if (!p || p.opted_out) { db.prepare("UPDATE broadcast_recipients SET status = 'skipped', error = 'Opted out' WHERE broadcast_id = ? AND patient_id = ?").run(b.id, r.patient_id); continue; }
      const m = await sendTemplate({ key: b.template_key, patient: p, broadcastId: b.id, kind: b.automation_id ? 'automation' : 'broadcast' });
      db.prepare('UPDATE broadcast_recipients SET status = ?, message_id = ?, error = ? WHERE broadcast_id = ? AND patient_id = ?')
        .run(m.status === 'failed' ? 'failed' : 'sent', m.id, m.error, b.id, r.patient_id);
      if (b.automation_id) db.prepare('UPDATE automation_sends SET message_id = ? WHERE automation_id = ? AND patient_id = ? AND message_id IS NULL').run(m.id, b.automation_id, r.patient_id);
      budget--;
      await new Promise((res) => setTimeout(res, 150));
    }
    const c = db.prepare(`SELECT SUM(status='sent') s, SUM(status='failed') f, SUM(status='queued') q FROM broadcast_recipients WHERE broadcast_id = ?`).get(b.id);
    db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(c.s || 0, c.f || 0, b.id);
    if (!c.q) db.prepare("UPDATE broadcasts SET status = 'done', finished_at = ? WHERE id = ?").run(now(), b.id);
    if (budget <= 0) break;
  }
}

export function startScheduler(ms) {
  setTimeout(tick, 3000);
  return setInterval(tick, ms);
}

export { json };
