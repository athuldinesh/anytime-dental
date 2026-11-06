import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { WhatsappLogo, CalendarPlus, ShieldCheck, CheckCircle, MapPin } from '@phosphor-icons/react';
import { Nav } from './Chrome.jsx';
import { api, useMeta, hm, dayLabel, icsFor, phoneLabel } from '../lib.js';
import '../styles/site.css';

const PERIODS = [['Morning', 0, 12 * 60], ['Afternoon', 12 * 60, 17 * 60], ['Evening', 17 * 60, 24 * 60]];
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export default function Book() {
  const meta = useMeta();
  const [qs] = useSearchParams();
  const [service, setService] = useState(Number(qs.get('service')) || null);
  const [branch, setBranch] = useState(Number(qs.get('branch')) || null);
  const [date, setDate] = useState(qs.get('date') || null);
  const [time, setTime] = useState(qs.get('time') || null);
  const [days, setDays] = useState(null);
  const [slots, setSlots] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', consent: true, website: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const refs = { branch: useRef(null), day: useRef(null), time: useRef(null), details: useRef(null) };

  useEffect(() => { document.title = 'Book an appointment · Anytime Dental'; }, []);
  // Arriving with a time but no treatment (e.g. from "next free check-up"): default to check-up.
  useEffect(() => { if (meta && !service && (qs.get('time') || qs.get('date'))) setService(meta.services[0].id); }, [meta]); // eslint-disable-line

  const svc = meta?.services.find((s) => s.id === service);
  const br = meta?.branches.find((b) => b.id === branch);

  useEffect(() => {
    if (!service || !branch) { setDays(null); return; }
    let live = true;
    api(`/api/public/days?branch=${branch}&service=${service}`).then((r) => {
      if (!live) return;
      setDays(r.days);
      if (date && !r.days.find((d) => d.date === date && d.free)) { setDate(null); setTime(null); }
    }).catch(() => setDays([]));
    return () => { live = false; };
  }, [service, branch]); // eslint-disable-line

  const loadSlots = () => {
    if (!service || !branch || !date) { setSlots(null); return; }
    setSlots(null);
    api(`/api/public/slots?branch=${branch}&service=${service}&date=${date}`).then((r) => {
      setSlots(r.slots);
      if (time && !r.slots.find((s) => s.time === time && s.free)) setTime(null);
    }).catch(() => setSlots([]));
  };
  useEffect(loadSlots, [service, branch, date]); // eslint-disable-line

  const scrollTo = (k) => setTimeout(() => refs[k].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);

  const grouped = useMemo(() => {
    const g = {};
    (meta?.services || []).forEach((s) => { (g[s.family] ||= []).push(s); });
    return g;
  }, [meta]);

  const ready = service && branch && date && time;

  function validate() {
    const e = {};
    if (form.name.trim().length < 2) e.name = 'Please enter your full name.';
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 9) e.phone = 'Please enter your mobile number, for example 050 123 4567.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'That email address does not look right.';
    if (!form.consent) e.consent = 'We need this to send your reminders.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit(ev) {
    ev?.preventDefault();
    if (!ready) return;
    if (!validate()) { scrollTo('details'); return; }
    setBusy(true); setErrors({});
    try {
      const r = await api('/api/public/bookings', { method: 'POST', body: { service_id: service, branch_id: branch, date, time, ...form } });
      setDone(r.booking);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.data?.code === 'slot_taken') { setTime(null); loadSlots(); scrollTo('time'); }
      setErrors({ form: err.message });
    } finally { setBusy(false); }
  }

  if (done) return <Booked b={done} />;

  return (
    <div className="flow">
      <Nav minimal />
      <div className="wrap flow-in">
        <form onSubmit={submit} noValidate>
          <h1 className="flow-h">Book an appointment</h1>
          <p className="flow-sub">Both clinics are open every day, 10 AM to 9 PM.</p>

          <section className="step" aria-labelledby="s1">
            <div className="step-h"><h2 id="s1">Treatment</h2>{svc && <span className="step-val">{svc.duration_min} min</span>}</div>
            <div className="svc-groups">
              {Object.entries(grouped).map(([fam, list]) => (
                <div key={fam}>
                  <h3>{fam}</h3>
                  <div className="svc-row">
                    {list.map((s) => (
                      <button type="button" key={s.id} className="pick" aria-pressed={service === s.id}
                        onClick={() => { setService(s.id); if (!branch) scrollTo('branch'); }}>{s.name}</button>
                    ))}
                  </div>
                </div>
              ))}
              {!meta && <div className="svc-row">{Array.from({ length: 8 }, (_, i) => <span key={i} className="pick" style={{ width: 120, opacity: 0.4 }} />)}</div>}
            </div>
          </section>

          <section className={`step ${!service ? 'is-locked' : ''}`} ref={refs.branch} aria-labelledby="s2">
            <div className="step-h"><h2 id="s2">Clinic</h2></div>
            <div className="branch-pick">
              {(meta?.branches || []).map((b) => (
                <button type="button" key={b.id} aria-pressed={branch === b.id} onClick={() => { setBranch(b.id); scrollTo('day'); }}>
                  <b>{b.name}</b><span>{b.floor.split('.')[0]}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={`step ${!(service && branch) ? 'is-locked' : ''}`} ref={refs.day} aria-labelledby="s3">
            <div className="step-h"><h2 id="s3">Day</h2>{date && <span className="step-val">{dayLabel(date, { long: true })}</span>}</div>
            <div className="days" role="group" aria-label="Choose a day">
              {(days || Array.from({ length: 10 }, (_, i) => ({ date: `x${i}`, free: 0, skeleton: true }))).map((d) => {
                if (d.skeleton) return <span key={d.date} className="day" style={{ height: 82, opacity: 0.35 }} />;
                const [, m, dd] = d.date.split('-');
                return (
                  <button type="button" key={d.date} className="day" disabled={!d.free} aria-pressed={date === d.date}
                    onClick={() => { setDate(d.date); setTime(null); scrollTo('time'); }}>
                    <b>{dayLabel(d.date).split(' ')[0]}</b>
                    <strong className="num">{Number(dd)}</strong>
                    <small>{d.free ? `${d.free} free` : 'full'}</small>
                    <span className="sr-only">{dayLabel(d.date, { long: true })} {m}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={`step ${!date ? 'is-locked' : ''}`} ref={refs.time} aria-labelledby="s4">
            <div className="step-h"><h2 id="s4">Time</h2>{time && <span className="step-val num">{hm(time)}</span>}</div>
            <div className="slots">
              {slots === null && date && <p className="flow-sub">Checking free times…</p>}
              {slots && !slots.some((s) => s.free) && <p className="flow-sub">No free times left on this day. Please choose another day.</p>}
              {slots && PERIODS.map(([label, a, b]) => {
                const list = slots.filter((s) => toMin(s.time) >= a && toMin(s.time) < b);
                if (!list.length) return null;
                return (
                  <div key={label}>
                    <h3>{label}</h3>
                    <div className="slot-row">
                      {list.map((s) => (
                        <button type="button" key={s.time} className="slot" disabled={!s.free} aria-pressed={time === s.time}
                          onClick={() => { setTime(s.time); scrollTo('details'); }}>{hm(s.time)}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`step ${!ready ? 'is-locked' : ''}`} ref={refs.details} aria-labelledby="s5">
            <div className="step-h"><h2 id="s5">Your details</h2></div>
            <div className="form-grid">
              <label className="field">
                <span>Full name</span>
                <input className="input" autoComplete="name" value={form.name} aria-invalid={!!errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                {errors.name && <small className="err">{errors.name}</small>}
              </label>
              <label className="field">
                <span>Mobile (WhatsApp)</span>
                <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="050 123 4567" value={form.phone} aria-invalid={!!errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                {errors.phone ? <small className="err">{errors.phone}</small> : <small>Reminders and your location pin arrive here.</small>}
              </label>
              <label className="field full">
                <span>Email <em style={{ fontStyle: 'normal', color: 'var(--text-3)' }}>(optional)</em></span>
                <input className="input" type="email" autoComplete="email" value={form.email} aria-invalid={!!errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {errors.email && <small className="err">{errors.email}</small>}
              </label>
              <label className="field full">
                <span>Anything we should know? <em style={{ fontStyle: 'normal', color: 'var(--text-3)' }}>(optional)</em></span>
                <textarea className="input" maxLength={1000} placeholder="For example: pain on the lower left, first visit, prefer Dr. Vea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
              <input className="sr-only" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              <label className="consent full">
                <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                <span>Send my booking confirmation and reminders on WhatsApp (a day before and two hours before).</span>
              </label>
              {errors.consent && <small className="err full">{errors.consent}</small>}
              {errors.form && <div className="form-error full" role="alert">{errors.form}</div>}
            </div>
          </section>
        </form>

        <aside className="summary" aria-label="Your booking">
          <h2>Your booking</h2>
          <Sum label="Treatment" v={svc?.name} />
          <Sum label="Clinic" v={br?.name} />
          <Sum label="When" v={date && time ? `${dayLabel(date, { long: true })}, ${hm(time)}` : date ? dayLabel(date, { long: true }) : null} />
          <button className="btn btn-dark btn-lg" disabled={!ready || busy} onClick={submit}>
            {busy ? <span className="spin" /> : 'Confirm booking'}
          </button>
          <p className="summary-note"><ShieldCheck size={18} /> Free to book. Change or cancel anytime from the WhatsApp link.</p>
        </aside>
      </div>
      <div className="mob-bar">
        <div>{ready ? <><b>{svc?.name}</b>{br?.name} · {dayLabel(date)} {hm(time)}</> : <><b>{svc ? svc.name : 'Choose a treatment'}</b>{br ? br.name : 'then a clinic and time'}</>}</div>
        <button className="btn btn-dark" disabled={!ready || busy} onClick={submit}>{busy ? <span className="spin" /> : 'Confirm'}</button>
      </div>
    </div>
  );
}

const Sum = ({ label, v }) => (
  <div className="sum-row"><span>{label}</span><b className={v ? '' : 'empty'}>{v || 'Not chosen yet'}</b></div>
);

function Booked({ b }) {
  const ics = useMemo(() => icsFor(b), [b]);
  return (
    <div className="flow">
      <Nav minimal />
      <div className="ticket-wrap">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.7 }}>
          <h1 className="flow-h">You’re booked.</h1>
          <p className="flow-sub">We’ve sent the details to {phoneLabel(b.patient.phone)} on WhatsApp.</p>
          <article className="ticket">
            <div className="ticket-top">
              <span className="chip"><CheckCircle size={15} /> Booking {b.code}</span>
              <h2>{b.service.name}</h2>
              <p>{b.date_label} at {b.time_label}</p>
            </div>
            <div className="ticket-body">
              <div className="ticket-rows">
                <div><span>Clinic</span><b>{b.branch.name}</b></div>
                <div><span>Name</span><b>{b.patient.name}</b></div>
                <div style={{ gridColumn: '1 / -1' }}><span>Where to go</span><b>{b.branch.floor}</b></div>
              </div>
              <div className="ticket-perf" />
              <div className="notice"><WhatsappLogo size={20} /> <span>A day before and two hours before, we’ll ask you to confirm. Tap Confirm and we send the location pin; tap Reschedule to pick a new time.</span></div>
              <div className="ticket-actions">
                <a className="btn btn-dark btn-sm" href={ics} download={`anytime-dental-${b.code}.ics`}><CalendarPlus size={18} /> Add to calendar</a>
                <a className="btn btn-ghost btn-sm" href={b.branch.maps_url} target="_blank" rel="noreferrer"><MapPin size={18} /> Directions</a>
                <Link className="btn btn-ghost btn-sm" to={`/r/${b.token}`}>Manage booking</Link>
              </div>
            </div>
          </article>
        </motion.div>
      </div>
    </div>
  );
}
