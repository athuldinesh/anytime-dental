// Reference data from anytimedental.ae (branches, services, team) plus default
// message templates and automations. Runs on every boot; inserts only what is
// missing and never overwrites edits made in the dashboard.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { hashPassword } from './lib/password.js';

export const BRANCHES = [
  {
    slug: 'deira', name: 'Al Rigga, Deira', area: 'Deira',
    address: 'Office 835, Al Ghurair Office Tower, Al Ghurair Centre, Al Rigga, Deira, Dubai',
    floor: '8th floor, Office 835. Use Al Ghurair Centre Entrance 3, then the office tower lifts.',
    directions: 'Near Al Rigga and Union Metro. Free parking at Al Ghurair Centre.',
    lat: 25.267105, lng: 55.3175459,
    maps_url: 'https://maps.app.goo.gl/Rf8b4sUQWTatvLnr7',
    reviews_url: 'https://www.google.com/maps/search/?api=1&query=Anytime+Dental+Al+Rigga&query_place_id=ChIJhY4SraRdXz4Rsum5BCPX6J0',
    phone: '+97143443882', chairs: 3,
  },
  {
    slug: 'barsha', name: 'Barsha Heights', area: 'Barsha Heights (Tecom)',
    address: 'Unit 903, Al Shafar Tower 1, Barsha Heights, Dubai',
    floor: '9th floor, Unit 903, Al Shafar Tower 1.',
    directions: 'Near Dubai Internet City Metro, Exit 1. Free parking in the building.',
    lat: 25.0984482, lng: 55.1741736,
    maps_url: 'https://maps.app.goo.gl/tAn5FFWuMQnzXGoj6',
    reviews_url: 'https://www.google.com/maps/search/?api=1&query=Anytime+Dental+Barsha+Heights&query_place_id=ChIJ23Xft5VrXz4RCvOqT8u0mnk',
    phone: '+97143443882', chairs: 3,
  },
];

// keywords: English + Tagalog + the shorthand clinics write in patient files.
export const SERVICES = [
  ['checkup', 'Check-up & consultation', 'Everyday care', 'An unhurried exam, X-rays when you need them, and a plan in plain words.', 30,
    'check up,checkup,check-up,consult,consultation,exam,examination,x-ray,xray,opg,panoramic,pacheck,assessment,new patient'],
  ['cleaning', 'Teeth cleaning', 'Everyday care', 'Routine cleaning that keeps gums healthy between visits.', 45,
    'cleaning,clean,op,prophy,prophylaxis,oral prophylaxis,linis,paglilinis,hygiene,hygienist'],
  ['scaling', 'Scaling & polishing', 'Everyday care', 'Removes hardened tartar above and below the gumline, then polishes.', 45,
    'scaling,scale,polish,polishing,deep clean,deep cleaning,tartar,calculus,plaque,gum treatment,periodontal'],
  ['filling', 'Fillings', 'Everyday care', 'Tooth-coloured fillings that repair cavities and match your smile.', 45,
    'filling,fillings,fill,pasta,composite,restoration,cavity,cavities,decay,caries,tooth colored,tooth coloured,gic'],
  ['extraction', 'Tooth extraction', 'Repair & restore', 'Gentle removal, including wisdom teeth, with clear aftercare.', 45,
    'extraction,extract,bunot,pull out,wisdom,odontectomy,removal,impacted,surgery,surgical'],
  ['root-canal', 'Root canal', 'Repair & restore', 'Saves an infected tooth by cleaning and sealing the canals.', 60,
    'root canal,rct,endo,endodontic,pulp,pulpectomy,nerve,abscess'],
  ['crowns', 'Dental crowns', 'Repair & restore', 'A custom cap that restores the strength and shape of a tooth.', 60,
    'crown,crowns,cap,zirconia,emax,e-max,pfm,porcelain crown,jacket'],
  ['bridges', 'Dental bridges', 'Repair & restore', 'Replaces a missing tooth by anchoring to the teeth beside it.', 60,
    'bridge,bridges,pontic,fixed bridge'],
  ['dentures', 'Dentures', 'Repair & restore', 'Comfortable full or partial dentures, fitted and adjusted with you.', 45,
    'denture,dentures,pustiso,false teeth,partial denture,flexible denture,complete denture'],
  ['implants', 'Dental implants', 'Repair & restore', 'A permanent replacement root topped with a natural-looking crown.', 60,
    'implant,implants,abutment,fixture,bone graft,implant crown'],
  ['braces', 'Braces', 'Straighten', 'Metal or ceramic braces with regular adjustments by our orthodontist.', 30,
    'braces,brace,orthodontic,orthodontics,ortho,adjustment,adjust,adj,wire,brackets,bracket,power chain,elastic,metal braces,ceramic braces'],
  ['aligners', 'Clear aligners', 'Straighten', 'Nearly invisible trays that move teeth step by step.', 30,
    'aligner,aligners,invisalign,clear aligner,clear braces,trays,retainer'],
  ['whitening', 'Teeth whitening', 'Brighten', 'In-clinic whitening for a noticeably brighter shade.', 60,
    'whitening,whiten,bleaching,bleach,white teeth,zoom'],
  ['veneers', 'Veneers', 'Brighten', 'Thin porcelain or composite shells for shape, colour and symmetry.', 60,
    'veneer,veneers,laminate,laminates,smile makeover,smile design'],
];

export const DENTISTS = [
  ['Dr. Morris', 'Founder', '/img/dr-morris.webp'],
  ['Dr. Alex', 'Prosthodontist & implant dentist', '/img/dr-alex.webp'],
  ['Dr. Sri', 'Orthodontist', '/img/dr-sri.webp'],
  ['Dr. Nithika', 'General dentist', '/img/dr-nithika.webp'],
  ['Dr. Mylirose', 'General dentist', '/img/dr-mylirose.webp'],
  ['Dr. Vea', 'General dentist', '/img/dr-vea.webp'],
  ['Dr. Marvin', 'General dentist', '/img/dr-marvin.webp'],
  ['Dr. Innah', 'General dentist', '/img/dr-innah.webp'],
  ['Dr. Dorna', 'General dentist', '/img/dr-dorna.webp'],
];

const CONFIRM_RESCHEDULE = JSON.stringify([{ id: 'CONFIRM', title: 'Confirm' }, { id: 'RESCHEDULE', title: 'Reschedule' }]);

export const TEMPLATES = [
  ['booking_received', 'Booking received', 'system',
    'Hi {{first_name}}, your {{service}} appointment at Anytime Dental {{branch}} is booked for {{date}} at {{time}}. Booking code {{code}}. We will remind you a day before. Manage your booking: {{link}}', '[]'],
  ['reminder_day', 'Reminder, 1 day before', 'system',
    'Hi {{first_name}}, a reminder from Anytime Dental: your {{service}} appointment is tomorrow, {{date}} at {{time}}, at our {{branch}} clinic. Please confirm or reschedule below.', CONFIRM_RESCHEDULE],
  ['reminder_2h', 'Reminder, 2 hours before', 'system',
    'Hi {{first_name}}, see you soon: {{service}} today at {{time}}, Anytime Dental {{branch}}. Tap Confirm if you are on your way, or Reschedule if something came up.', CONFIRM_RESCHEDULE],
  ['confirmed', 'Confirmed, with location', 'system',
    'Thank you, {{first_name}}. You are confirmed for {{date}} at {{time}}.\n\n{{address}}\n{{floor}}\n{{directions}}\n\nMap: {{map}}', '[]'],
  ['reschedule', 'Reschedule link', 'system',
    'No problem, {{first_name}}. Choose a new time here: {{link}}\nOr reply with a day and time that suits you and our team will arrange it.', '[]'],
  ['rescheduled', 'Rescheduled', 'system',
    'Done, {{first_name}}. Your {{service}} appointment is now {{date}} at {{time}} at our {{branch}} clinic.', '[]'],
  ['cancelled', 'Cancelled', 'system',
    'Your Anytime Dental appointment on {{date}} at {{time}} is cancelled. Book again whenever you are ready: {{book_link}}', '[]'],
  ['survey', 'Satisfaction survey', 'system',
    'Thank you for visiting Anytime Dental {{branch}}, {{first_name}}. How did we do? It takes 30 seconds: {{link}}', '[]'],
  ['opt_out', 'Opt-out confirmation', 'system',
    'You will not receive offers from Anytime Dental any more. Appointment reminders will still reach you. Reply START to subscribe again.', '[]'],
  ['recall_cleaning', 'Cleaning recall (6 months)', 'broadcast',
    'Hi {{first_name}}, it has been about six months since your last cleaning at Anytime Dental. Book your next one in a minute: {{book_link}}', '[]'],
  ['braces_adjustment', 'Braces adjustment (monthly)', 'broadcast',
    'Hi {{first_name}}, it is time for your braces adjustment. Pick a time at Deira or Barsha Heights, any day 10 AM to 9 PM: {{book_link}}', '[]'],
  ['aligner_check', 'Aligner progress check', 'broadcast',
    'Hi {{first_name}}, time for a quick aligner progress check with our orthodontist. Book here: {{book_link}}', '[]'],
  ['whitening_touchup', 'Whitening touch-up', 'broadcast',
    'Hi {{first_name}}, it has been a while since your whitening. A touch-up keeps the shade bright. Book here: {{book_link}}', '[]'],
  ['general_update', 'General clinic update', 'broadcast',
    'Hi {{first_name}}, a note from Anytime Dental: both our clinics are open every day, 10 AM to 9 PM, with free parking. Book anytime: {{book_link}}', '[]'],
];

const AUTOMATIONS = [
  ['Cleaning recall, every 6 months', 'cleaning', 'recall_cleaning', 180, 180],
  ['Scaling recall, every 6 months', 'scaling', 'recall_cleaning', 180, 180],
  ['Braces adjustment, monthly', 'braces', 'braces_adjustment', 30, 30],
  ['Aligner check, every 6 weeks', 'aligners', 'aligner_check', 42, 42],
  ['Whitening touch-up, yearly', 'whitening', 'whitening_touchup', 365, null],
];

export function seed(db, { getSetting, setSetting, now }) {
  const t = now();
  const insB = db.prepare(`INSERT OR IGNORE INTO branches (slug,name,area,address,floor,directions,lat,lng,maps_url,reviews_url,phone,chairs)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const b of BRANCHES) insB.run(b.slug, b.name, b.area, b.address, b.floor, b.directions, b.lat, b.lng, b.maps_url, b.reviews_url, b.phone, b.chairs);

  const insS = db.prepare('INSERT OR IGNORE INTO services (slug,name,family,blurb,duration_min,keywords,sort) VALUES (?,?,?,?,?,?,?)');
  SERVICES.forEach((s, i) => insS.run(s[0], s[1], s[2], s[3], s[4], s[5], i));

  if (!db.prepare('SELECT COUNT(*) c FROM dentists').get().c) {
    const insD = db.prepare('INSERT INTO dentists (name, role, photo, sort) VALUES (?,?,?,?)');
    DENTISTS.forEach((d, i) => insD.run(d[0], d[1], d[2], i));
  }

  const insT = db.prepare('INSERT OR IGNORE INTO templates (key,name,kind,body,buttons,updated_at) VALUES (?,?,?,?,?,?)');
  for (const tp of TEMPLATES) insT.run(tp[0], tp[1], tp[2], tp[3], tp[4], t);

  if (!db.prepare('SELECT COUNT(*) c FROM automations').get().c) {
    const sid = (slug) => db.prepare('SELECT id FROM services WHERE slug = ?').get(slug).id;
    const insA = db.prepare('INSERT INTO automations (name, service_id, template_key, days_after, repeat_days, active, created_at) VALUES (?,?,?,?,?,1,?)');
    for (const a of AUTOMATIONS) insA.run(a[0], sid(a[1]), a[2], a[3], a[4], t);
  }

  const defaults = {
    whatsapp: {
      mode: 'sandbox', api_version: 'v21.0', token: '', phone_number_id: '', waba_id: '', app_secret: '',
      verify_token: crypto.randomBytes(12).toString('hex'),
    },
    ai: { api_key: '', model: 'claude-haiku-5-5' },
    reminders: { day_before_hours: 24, before_hours: 2, survey_delay_min: 120 },
    clinic: { whatsapp: '971557916602', phone: '+97143443882', email: 'help@anytimedental.ae', public_url: config.publicUrl },
    broadcast: { per_minute: 60, grace_days: 7 },
  };
  for (const [k, v] of Object.entries(defaults)) {
    const cur = getSetting(k);
    if (cur == null) setSetting(k, v);
    else if (typeof cur === 'object') setSetting(k, { ...v, ...cur });
  }

  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
    const email = process.env.ADMIN_EMAIL || 'admin@anytimedental.ae';
    const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run(email, 'Clinic admin', hashPassword(pass), 'admin', t);
    if (!process.env.ADMIN_PASSWORD) {
      const f = path.join(config.dataDir, 'ADMIN_LOGIN.txt');
      fs.writeFileSync(f, `Anytime Dental dashboard\nEmail: ${email}\nPassword: ${pass}\nChange it in Settings after the first sign-in.\n`, { mode: 0o600 });
      console.log(`[seed] admin account created, credentials written to ${f}`);
    }
  }
}
