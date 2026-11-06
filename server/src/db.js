import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { seed } from './seed.js';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'admin',
     created_at TEXT NOT NULL
   );
   CREATE TABLE branches (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL, area TEXT NOT NULL,
     address TEXT NOT NULL, floor TEXT NOT NULL, directions TEXT NOT NULL,
     lat REAL NOT NULL, lng REAL NOT NULL, maps_url TEXT NOT NULL, reviews_url TEXT,
     phone TEXT NOT NULL, chairs INTEGER NOT NULL DEFAULT 3,
     opens TEXT NOT NULL DEFAULT '10:00', closes TEXT NOT NULL DEFAULT '21:00'
   );
   CREATE TABLE services (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL, family TEXT NOT NULL,
     blurb TEXT NOT NULL,
     duration_min INTEGER NOT NULL DEFAULT 30,
     keywords TEXT NOT NULL DEFAULT '',
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE dentists (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL, role TEXT NOT NULL, photo TEXT, sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE patients (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     phone TEXT NOT NULL UNIQUE,
     email TEXT,
     opted_out INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL DEFAULT 'web',
     notes TEXT,
     last_visit_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE patient_services (
     patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
     source TEXT NOT NULL,
     confidence REAL NOT NULL DEFAULT 1,
     reason TEXT,
     last_date TEXT,
     added_at TEXT NOT NULL,
     PRIMARY KEY (patient_id, service_id)
   );
   CREATE INDEX ps_service ON patient_services(service_id);
   CREATE TABLE bookings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     code TEXT NOT NULL UNIQUE,
     token TEXT NOT NULL UNIQUE,
     patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     service_id INTEGER NOT NULL REFERENCES services(id),
     branch_id INTEGER NOT NULL REFERENCES branches(id),
     dentist_id INTEGER REFERENCES dentists(id),
     starts_at TEXT NOT NULL,
     duration_min INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','completed','cancelled','no_show')),
     notes TEXT,
     source TEXT NOT NULL DEFAULT 'web',
     reminder_day_at TEXT, reminder_2h_at TEXT, survey_sent_at TEXT,
     confirmed_at TEXT, completed_at TEXT, cancelled_at TEXT,
     reschedule_count INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE INDEX bookings_time ON bookings(starts_at, status);
   CREATE INDEX bookings_patient ON bookings(patient_id);
   CREATE TABLE templates (
     key TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     body TEXT NOT NULL,
     buttons TEXT NOT NULL DEFAULT '[]',
     meta_name TEXT, meta_lang TEXT NOT NULL DEFAULT 'en',
     updated_at TEXT NOT NULL
   );
   CREATE TABLE broadcasts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     template_key TEXT NOT NULL REFERENCES templates(key),
     service_ids TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','done','cancelled')),
     scheduled_at TEXT,
     total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
     automation_id INTEGER,
     created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
   );
   CREATE TABLE broadcast_recipients (
     broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
     patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     status TEXT NOT NULL DEFAULT 'queued',
     message_id INTEGER, error TEXT,
     PRIMARY KEY (broadcast_id, patient_id)
   );
   CREATE TABLE automations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     service_id INTEGER NOT NULL REFERENCES services(id),
     template_key TEXT NOT NULL REFERENCES templates(key),
     days_after INTEGER NOT NULL,
     repeat_days INTEGER,
     active INTEGER NOT NULL DEFAULT 1,
     last_run_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE automation_sends (
     automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
     patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     due_date TEXT NOT NULL,
     message_id INTEGER,
     PRIMARY KEY (automation_id, patient_id, due_date)
   );
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
     booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
     broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL,
     direction TEXT NOT NULL CHECK (direction IN ('out','in')),
     kind TEXT NOT NULL,
     phone TEXT NOT NULL,
     body TEXT NOT NULL,
     buttons TEXT NOT NULL DEFAULT '[]',
     provider TEXT NOT NULL,
     wa_id TEXT,
     status TEXT NOT NULL,
     error TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE INDEX messages_time ON messages(created_at);
   CREATE INDEX messages_wa ON messages(wa_id);
   CREATE INDEX messages_patient ON messages(patient_id);
   CREATE TABLE surveys (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
     patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     token TEXT NOT NULL UNIQUE,
     sent_at TEXT NOT NULL, answered_at TEXT,
     rating INTEGER, recommend INTEGER, comfort INTEGER, explained INTEGER, comment TEXT
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE imports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     filename TEXT, rows INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
     grouped INTEGER NOT NULL, used_ai INTEGER NOT NULL, created_at TEXT NOT NULL
   );`,
];

db.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)');
const done = db.prepare('SELECT COUNT(*) c FROM _migrations').get().c;
for (let i = done; i < MIGRATIONS.length; i++) {
  db.exec('BEGIN');
  try { db.exec(MIGRATIONS[i]); db.prepare('INSERT INTO _migrations (n) VALUES (?)').run(i + 1); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const now = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

seed(db, { getSetting, setSetting, now });
