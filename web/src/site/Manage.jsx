import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, CalendarDots, XCircle, MapPin, CalendarPlus, Info, Star } from '@phosphor-icons/react';
import { Nav } from './Chrome.jsx';
import { api, hm, dayLabel, icsFor } from '../lib.js';
import '../styles/site.css';

const STATUS = { booked: 'Awaiting confirmation', confirmed: 'Confirmed', completed: 'Visit completed', cancelled: 'Cancelled', no_show: 'Missed' };

export default function Manage() {
  const { token } = useParams();
  const [b, setB] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState(null); // reschedule | cancel
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    document.title = 'Your appointment · Anytime Dental';
    api(`/api/public/bookings/${token}`).then((r) => setB(r.booking)).catch((e) => setErr(e.message));
  }, [token]);

  const act = async (path, body, msg) => {
    setBusy(true); setErr(null);
    try {
      const r = await api(`/api/public/bookings/${token}/${path}`, { method: 'POST', body: body || {} });
      setB(r.booking); setMode(null); setFlash(msg);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const ics = useMemo(() => (b ? icsFor(b) : null), [b]);
  const active = b && ['booked', 'confirmed'].includes(b.status);

  return (
    <div className="flow">
      <Nav minimal />
      <div className="ticket-wrap">
        {!b && !err && <p className="flow-sub">Loading your appointment…</p>}
        {!b && err && (<><h1 className="flow-h">Link not found</h1><p className="flow-sub">{err}</p><p style={{ marginTop: 20 }}><Link className="btn btn-dark" to="/book">Book an appointment</Link></p></>)}
        {b && (
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.6 }}>
            <h1 className="flow-h">Hi {b.patient.name.split(' ')[0]}.</h1>
            <p className="flow-sub">Here is your appointment at Anytime Dental.</p>
            <AnimatePresence>
              {flash && (
                <motion.div className="notice" style={{ marginTop: 18 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }}>
                  <CheckCircle size={20} /> <span>{flash}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <article className="ticket">
              <div className="ticket-top">
                <span className={`status-pill ${b.status}`}>{STATUS[b.status]}</span>
                <h2>{b.service.name}</h2>
                <p>{b.date_label} at {b.time_label}</p>
              </div>
              <div className="ticket-body">
                <div className="ticket-rows">
                  <div><span>Clinic</span><b>{b.branch.name}</b></div>
                  <div><span>Booking</span><b className="num">{b.code}</b></div>
                  <div style={{ gridColumn: '1 / -1' }}><span>Address</span><b>{b.branch.address}</b></div>
                  <div style={{ gridColumn: '1 / -1' }}><span>Where to go</span><b>{b.branch.floor} {b.branch.directions}</b></div>
                </div>
                <div className="ticket-perf" />
                {active && !mode && (
                  <div className="ticket-actions">
                    {b.status === 'booked' && <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => act('confirm', null, 'Confirmed. We sent the location pin to your WhatsApp.')}><CheckCircle size={18} /> Confirm</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setMode('reschedule')}><CalendarDots size={18} /> Reschedule</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMode('cancel')}><XCircle size={18} /> Cancel</button>
                  </div>
                )}
                {mode === 'reschedule' && <Reschedule b={b} token={token} busy={busy} onPick={(date, time) => act('reschedule', { date, time }, `Moved to ${dayLabel(date, { long: true })} at ${hm(time)}.`)} onClose={() => setMode(null)} />}
                {mode === 'cancel' && (
                  <div className="notice" style={{ background: '#FDF0EF', color: '#5B1610' }}>
                    <Info size={20} />
                    <div>
                      <p>Cancel your {b.service.name.toLowerCase()} on {b.date_label}?</p>
                      <div className="ticket-actions" style={{ marginTop: 12 }}>
                        <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => act('cancel', null, 'Your appointment is cancelled.')}>Yes, cancel it</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Keep it</button>
                      </div>
                    </div>
                  </div>
                )}
                {err && <div className="form-error" role="alert">{err}</div>}
                <div className="ticket-actions">
                  {active && ics && <a className="btn btn-ghost btn-sm" href={ics} download={`anytime-dental-${b.code}.ics`}><CalendarPlus size={18} /> Add to calendar</a>}
                  <a className="btn btn-ghost btn-sm" href={b.branch.maps_url} target="_blank" rel="noreferrer"><MapPin size={18} /> Directions</a>
                  {!active && <Link className="btn btn-dark btn-sm" to="/book">Book a new visit</Link>}
                </div>
              </div>
            </article>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Reschedule({ b, token, busy, onPick, onClose }) {
  const [days, setDays] = useState(null);
  const [date, setDate] = useState(null);
  const [slots, setSlots] = useState(null);
  useEffect(() => { api(`/api/public/days?branch=${b.branch.id}&service=${b.service.id}`).then((r) => setDays(r.days)); }, [b]);
  useEffect(() => {
    if (!date) return;
    setSlots(null);
    api(`/api/public/slots?branch=${b.branch.id}&service=${b.service.id}&date=${date}&token=${token}`).then((r) => setSlots(r.slots));
  }, [date]); // eslint-disable-line
  return (
    <div>
      <div className="step-h"><h2 style={{ fontSize: 17 }}>Choose a new time</h2><button type="button" onClick={onClose}>Close</button></div>
      <div className="days">
        {(days || []).map((d) => (
          <button type="button" key={d.date} className="day" disabled={!d.free} aria-pressed={date === d.date} onClick={() => setDate(d.date)}>
            <b>{dayLabel(d.date).split(' ')[0]}</b><strong className="num">{Number(d.date.slice(8))}</strong><small>{d.free ? `${d.free} free` : 'full'}</small>
          </button>
        ))}
      </div>
      {date && (
        <div className="slot-row" style={{ marginTop: 12 }}>
          {slots === null ? <p className="flow-sub">Checking…</p> : slots.map((s) => (
            <button type="button" key={s.time} className="slot" disabled={!s.free || busy} onClick={() => onPick(date, s.time)}>{hm(s.time)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ survey */
export function Survey() {
  const { token } = useParams();
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [a, setA] = useState({ rating: 0, recommend: null, comfort: 0, explained: 0, comment: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'How did we do? · Anytime Dental';
    api(`/api/public/surveys/${token}`).then((r) => { setS(r.survey); if (r.survey.answered) setDone(true); }).catch((e) => setErr(e.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!a.rating) { setErr('Please tap a rating from 1 to 5.'); return; }
    if (a.recommend == null) { setErr('Please choose how likely you are to recommend us.'); return; }
    setBusy(true); setErr(null);
    try { await api(`/api/public/surveys/${token}`, { method: 'POST', body: a }); setDone(true); window.scrollTo({ top: 0 }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const Scale = ({ k, n = 5 }) => (
    <div className="rate-row" role="group">
      {Array.from({ length: n }, (_, i) => i + 1).map((v) => (
        <button type="button" key={v} className="rate num" aria-pressed={a[k] === v} aria-label={`${v} of ${n}`} onClick={() => setA({ ...a, [k]: v })}>{v}</button>
      ))}
    </div>
  );

  return (
    <div className="flow">
      <Nav minimal />
      <div className="ticket-wrap">
        {!s && !err && <p className="flow-sub">Loading…</p>}
        {!s && err && <><h1 className="flow-h">Survey not found</h1><p className="flow-sub">{err}</p></>}
        {s && done && (
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="flow-h">Thank you{s.first_name ? `, ${s.first_name}` : ''}.</h1>
            <p className="flow-sub">Your answers go straight to the team at {s.branch}.</p>
            {a.rating >= 4 && s.reviews_url && (
              <div className="step" style={{ marginTop: 24 }}>
                <p style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>Glad it went well.</p>
                <p className="flow-sub">A short Google review helps other families find us.</p>
                <a className="btn btn-dark" style={{ marginTop: 16 }} href={s.reviews_url} target="_blank" rel="noreferrer"><Star size={18} weight="fill" /> Review us on Google</a>
              </div>
            )}
            <p style={{ marginTop: 24 }}><Link className="btn btn-ghost" to="/">Back to Anytime Dental</Link></p>
          </motion.div>
        )}
        {s && !done && (
          <form onSubmit={submit}>
            <h1 className="flow-h">How did we do{s.first_name ? `, ${s.first_name}` : ''}?</h1>
            <p className="flow-sub">{s.service} at {s.branch}{s.date ? `, ${s.date}` : ''}. Four quick taps.</p>
            <div className="step">
              <div className="q"><b>Overall, how was your visit?</b><Scale k="rating" /><div className="scale-ends"><span>Poor</span><span>Excellent</span></div></div>
              <div className="q">
                <b>How likely are you to recommend us to family or friends?</b>
                <div className="nps-row" role="group">
                  {Array.from({ length: 11 }, (_, i) => i).map((v) => (
                    <button type="button" key={v} className="nps" aria-pressed={a.recommend === v} onClick={() => setA({ ...a, recommend: v })}>{v}</button>
                  ))}
                </div>
                <div className="scale-ends"><span>Not likely</span><span>Very likely</span></div>
              </div>
              <div className="q"><b>Did you feel comfortable?<small>optional</small></b><Scale k="comfort" /></div>
              <div className="q"><b>Did the dentist explain things clearly?<small>optional</small></b><Scale k="explained" /></div>
              <div className="q">
                <label className="field"><b style={{ fontSize: 17, letterSpacing: '-0.02em' }}>Anything we could do better?<small style={{ fontWeight: 400, color: 'var(--text-2)', fontSize: 13, marginLeft: 6 }}>optional</small></b>
                  <textarea className="input" maxLength={2000} value={a.comment} onChange={(e) => setA({ ...a, comment: e.target.value })} />
                </label>
              </div>
              {err && <div className="form-error" role="alert">{err}</div>}
              <button className="btn btn-dark btn-lg" style={{ marginTop: 16, width: '100%' }} disabled={busy}>{busy ? <span className="spin" /> : 'Send my answers'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
