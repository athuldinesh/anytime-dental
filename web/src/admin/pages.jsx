import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, CheckCircle, XCircle, CalendarDots, BellRinging, Smiley, ArrowRight, UploadSimple, Sparkle,
  UserPlus, Trash, CalendarBlank, UsersThree, FileCsv, WarningCircle, ArrowClockwise, MapPin, ChatCircleText,
} from '@phosphor-icons/react';
import { api, useApi, useMeta, hm, dayLabel, dateTime, dubaiNow, dubaiParts, ago, phoneLabel } from '../lib.js';
import { Badge, Drawer, Empty, Field, Seg, Stat, Loading, ErrorNote, useToast } from './ui.jsx';

/* ============================================================ Today */
export function Today() {
  const { data, error, loading, reload } = useApi('/api/admin/overview');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  const byBranch = {};
  data.today.forEach((b) => { (byBranch[b.branch.name] ||= []).push(b); });
  return (
    <>
      <header className="page-h">
        <div><h1>Today</h1><p>{dayLabel(data.date, { long: true })} · both clinics open 10 AM to 9 PM</p></div>
        <button className="btn btn-dark btn-sm" onClick={() => setCreating(true)}><Plus size={16} /> New booking</button>
      </header>
      <div className="stats">
        <Stat label="Appointments today" value={data.counts.today} sub={`${data.counts.confirmed_today} confirmed`} />
        <Stat label="Confirmed via reminders (7 days)" value={data.week.confirm_rate == null ? '–' : `${Math.round(data.week.confirm_rate * 100)}%`} sub={`${data.week.sent || 0} messages sent`} />
        <Stat label="Satisfaction" value={data.surveys.avg ? `${Number(data.surveys.avg).toFixed(1)} / 5` : '–'} sub={data.surveys.nps == null ? 'No answers yet' : `NPS ${data.surveys.nps} · ${data.surveys.answered} answers`} />
        <Stat label="Patients in groups" value={data.counts.grouped} sub={`of ${data.counts.patients} patients`} />
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-h"><h2>Schedule</h2><Link to="/clinic/bookings" className="link">All bookings <ArrowRight size={14} /></Link></div>
          {!data.today.length && <Empty icon={CalendarBlank} title="No appointments today">New web bookings appear here instantly.</Empty>}
          {Object.entries(byBranch).map(([name, list]) => (
            <div key={name} className="sched">
              <h3>{name}</h3>
              {list.map((b) => (
                <button key={b.id} className={`sched-row s-${b.status}`} onClick={() => setOpen(b.id)}>
                  <span className="num sched-t">{hm(b.time)}</span>
                  <span className="sched-who"><b>{b.patient.name}</b><small>{b.service.name}</small></span>
                  <Badge s={b.status} />
                </button>
              ))}
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Reminder queue</h2><span className="muted">next 48 hours</span></div>
          {!data.queue.length && <Empty icon={BellRinging} title="Nothing waiting">Reminders go out automatically a day before and 2 hours before.</Empty>}
          <ul className="queue">
            {data.queue.map((b) => (
              <li key={b.id}>
                <button onClick={() => setOpen(b.id)}>
                  <span className="q-when">{b.next_reminder ? <><b>{b.next_reminder.kind === 'day' ? '1-day' : '2-hour'}</b> reminder · {dateTime(b.next_reminder.at)}</> : 'Both reminders sent'}</span>
                  <span className="q-who">{b.patient.name} · {b.service.name} · {dayLabel(b.date)} {hm(b.time)}</span>
                </button>
                <Badge s={b.status} />
              </li>
            ))}
          </ul>
          {data.upcoming.length > 0 && <>
            <div className="panel-h" style={{ marginTop: 20 }}><h2>Coming up</h2></div>
            <ul className="queue">
              {data.upcoming.slice(0, 6).map((b) => (
                <li key={b.id}><button onClick={() => setOpen(b.id)}><span className="q-when"><b>{dayLabel(b.date)}</b> · {hm(b.time)} · {b.branch.name}</span><span className="q-who">{b.patient.name} · {b.service.name}</span></button><Badge s={b.status} /></li>
              ))}
            </ul>
          </>}
        </section>
      </div>
      <BookingDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
      <NewBooking open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      {loading && null}
    </>
  );
}

/* ============================================================ Bookings */
export function Bookings() {
  const meta = useMeta();
  const today = dubaiNow().date;
  const [range, setRange] = useState('upcoming');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (range === 'upcoming') p.set('from', today);
    if (range === 'today') { p.set('from', today); p.set('to', today); }
    if (branch) p.set('branch', branch);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [range, branch, status, q, today]);
  const { data, error, reload } = useApi(`/api/admin/bookings?${qs}`);
  return (
    <>
      <header className="page-h">
        <div><h1>Bookings</h1><p>Every appointment from the website, WhatsApp and the front desk.</p></div>
        <button className="btn btn-dark btn-sm" onClick={() => setCreating(true)}><Plus size={16} /> New booking</button>
      </header>
      <div className="filters">
        <Seg label="Range" value={range} onChange={setRange} options={[['upcoming', 'Upcoming'], ['today', 'Today'], ['all', 'All']]} />
        <select className="input sm" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Clinic">
          <option value="">Both clinics</option>
          {meta?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {['booked', 'confirmed', 'completed', 'cancelled', 'no_show'].map((s) => <option key={s} value={s}>{s.replace('_', '-')}</option>)}
        </select>
        <div className="search"><MagnifyingGlass size={16} /><input className="input sm" placeholder="Name, phone or code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {error && <ErrorNote error={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && !data.bookings.length && <Empty icon={CalendarBlank} title="No bookings match">Try another range or clear the search.</Empty>}
      {data && data.bookings.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Patient</th><th>Treatment</th><th>Clinic</th><th>Reminders</th><th>Status</th></tr></thead>
            <tbody>
              {data.bookings.map((b) => (
                <tr key={b.id} onClick={() => setOpen(b.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(b.id)}>
                  <td className="num nowrap">{dayLabel(b.date)} · {hm(b.time)}</td>
                  <td><b>{b.patient.name}</b><small className="num">{phoneLabel(b.patient.phone)}</small></td>
                  <td>{b.service.name}</td>
                  <td>{b.branch.name}</td>
                  <td><Rem b={b} /></td>
                  <td><Badge s={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BookingDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
      <NewBooking open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
    </>
  );
}

const Rem = ({ b }) => (
  <span className="rem">
    <i className={b.reminder_day_at && b.reminder_day_at !== 'skipped' ? 'on' : b.reminder_day_at === 'skipped' ? 'skip' : ''} title={`1 day before: ${b.reminder_day_at ? (b.reminder_day_at === 'skipped' ? 'skipped (booked late)' : 'sent') : 'pending'}`}>1d</i>
    <i className={b.reminder_2h_at && b.reminder_2h_at !== 'skipped' ? 'on' : b.reminder_2h_at === 'skipped' ? 'skip' : ''} title={`2 hours before: ${b.reminder_2h_at ? (b.reminder_2h_at === 'skipped' ? 'skipped' : 'sent') : 'pending'}`}>2h</i>
    <i className={b.survey_sent_at ? 'on' : ''} title={`Survey: ${b.survey_sent_at ? 'sent' : 'not sent'}`}>S</i>
  </span>
);

/* ---------------- booking drawer */
function BookingDrawer({ id, onClose, onChange }) {
  const toast = useToast();
  const [b, setB] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const load = async () => {
    const { booking: found } = await api(`/api/admin/bookings/${id}`);
    setB(found || null);
    if (found) { const p = await api(`/api/admin/patients/${found.patient.id}`); setMsgs(p.messages.filter((m) => m.booking_id === id)); }
  };
  useEffect(() => { setB(null); setMoving(false); if (id) load().catch((e) => toast(e.message, 'error')); }, [id]); // eslint-disable-line
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (r?.booking) setB(r.booking); if (r?.message?.status === 'failed') toast(r.message.error || 'Message failed', 'error'); else toast(ok); onChange?.(); await load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const patch = (body, ok) => run(() => api(`/api/admin/bookings/${id}`, { method: 'PATCH', body }), ok);
  const active = b && ['booked', 'confirmed'].includes(b.status);
  return (
    <Drawer open={!!id} onClose={onClose} title={b ? `${b.patient.name}` : 'Booking'}>
      {!b ? <Loading /> : (
        <div className="stack">
          <div className="kv">
            <div><span>Treatment</span><b>{b.service.name}</b></div>
            <div><span>When</span><b>{b.date_label}, {b.time_label}</b></div>
            <div><span>Clinic</span><b>{b.branch.name}</b></div>
            <div><span>Status</span><Badge s={b.status} /></div>
            <div><span>Mobile</span><b className="num"><a href={`https://wa.me/${b.patient.phone}`} target="_blank" rel="noreferrer">{phoneLabel(b.patient.phone)}</a></b></div>
            <div><span>Code</span><b className="num">{b.code}</b></div>
            {b.notes && <div className="full"><span>Notes</span><b>{b.notes}</b></div>}
          </div>
          <div className="btn-row">
            {b.status === 'booked' && <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => patch({ status: 'confirmed', notify: true }, 'Confirmed, location sent')}><CheckCircle size={16} /> Confirm + send location</button>}
            {active && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => patch({ status: 'completed' }, 'Marked as completed. The survey goes out automatically.')}><CheckCircle size={16} /> Completed</button>}
            {active && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMoving((v) => !v)}><CalendarDots size={16} /> Reschedule</button>}
            {active && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => patch({ status: 'no_show' }, 'Marked as no-show')}>No-show</button>}
            {active && <button className="btn btn-ghost btn-sm danger" disabled={busy} onClick={() => { if (confirm('Cancel this appointment? The patient gets a WhatsApp message.')) patch({ status: 'cancelled' }, 'Cancelled'); }}><XCircle size={16} /> Cancel</button>}
          </div>
          {moving && <SlotPicker b={b} onPick={(date, time) => run(() => api(`/api/admin/bookings/${id}/reschedule`, { method: 'POST', body: { date, time } }), 'Rescheduled and patient notified').then(() => setMoving(false))} />}
          <section>
            <h3 className="sub-h">WhatsApp</h3>
            <div className="btn-row">
              {active && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api(`/api/admin/bookings/${id}/remind`, { method: 'POST', body: { which: 'day' } }), '1-day reminder sent')}><BellRinging size={16} /> Send 1-day reminder</button>}
              {active && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api(`/api/admin/bookings/${id}/remind`, { method: 'POST', body: { which: '2h' } }), '2-hour reminder sent')}><BellRinging size={16} /> Send 2-hour reminder</button>}
              {b.status === 'completed' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api(`/api/admin/bookings/${id}/survey`, { method: 'POST' }), 'Survey sent')}><Smiley size={16} /> {b.survey_sent_at ? 'Resend survey' : 'Send survey now'}</button>}
            </div>
            <ul className="thread">
              {!msgs.length && <li className="muted">No messages for this booking yet.</li>}
              {msgs.slice().reverse().map((m) => (
                <li key={m.id} className={m.direction}>
                  <p>{m.body}</p>
                  {m.buttons?.length > 0 && <div className="thread-btns">{m.buttons.map((x) => <span key={x.id}>{x.title}</span>)}</div>}
                  <small>{m.kind.replace(/_/g, ' ')} · {ago(m.created_at)} · <Badge s={m.status} /></small>
                  {m.error && <small className="err">{m.error}</small>}
                </li>
              ))}
            </ul>
          </section>
          <a className="link" href={`/r/${b.token}`} target="_blank" rel="noreferrer">Open the patient’s booking page <ArrowRight size={14} /></a>
        </div>
      )}
    </Drawer>
  );
}

function SlotPicker({ b, onPick, branchId, serviceId }) {
  const today = dubaiNow().date;
  const [date, setDate] = useState(b?.date && b.date >= today ? b.date : today);
  const [slots, setSlots] = useState(null);
  const br = branchId || b?.branch.id, sv = serviceId || b?.service.id;
  useEffect(() => {
    if (!br || !sv) return;
    setSlots(null);
    api(`/api/admin/slots?branch=${br}&service=${sv}&date=${date}&exclude=${b?.id || 0}`).then((r) => setSlots(r.slots)).catch(() => setSlots([]));
  }, [date, br, sv]); // eslint-disable-line
  return (
    <div className="slotpick">
      <Field label="Date"><input className="input sm" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="slot-row">
        {slots === null ? <span className="muted">Checking…</span> : slots.map((s) => (
          <button type="button" key={s.time} className="slot" disabled={!s.free} onClick={() => onPick(date, s.time)}>{hm(s.time)}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- new booking (front desk) */
function NewBooking({ open, onClose, onDone }) {
  const meta = useMeta();
  const toast = useToast();
  const [f, setF] = useState({ name: '', phone: '', service_id: '', branch_id: '', notes: '', notify: true, status: 'booked' });
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setPick(null); setErr(null); } }, [open]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/api/admin/bookings', { method: 'POST', body: { ...f, service_id: Number(f.service_id), branch_id: Number(f.branch_id), date: pick?.date, time: pick?.time } });
      toast('Booking created'); setF({ ...f, name: '', phone: '', notes: '' }); onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={onClose} title="New booking"
      footer={<><button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-dark btn-sm" disabled={busy || !pick || !f.name || !f.phone} onClick={submit}>{busy ? <span className="spin" /> : 'Create booking'}</button></>}>
      <div className="form-2">
        <Field label="Patient name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile (WhatsApp)"><input className="input" type="tel" placeholder="050 123 4567" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Treatment">
          <select className="input" value={f.service_id} onChange={(e) => { setF({ ...f, service_id: e.target.value }); setPick(null); }}>
            <option value="">Choose…</option>{meta?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Clinic">
          <select className="input" value={f.branch_id} onChange={(e) => { setF({ ...f, branch_id: e.target.value }); setPick(null); }}>
            <option value="">Choose…</option>{meta?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Notes" full><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {f.service_id && f.branch_id && (
        <>
          <h3 className="sub-h">Time {pick && <span className="muted num">· {dayLabel(pick.date)} {hm(pick.time)}</span>}</h3>
          <SlotPicker branchId={Number(f.branch_id)} serviceId={Number(f.service_id)} onPick={(date, time) => setPick({ date, time })} />
        </>
      )}
      <label className="consent" style={{ marginTop: 16 }}><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Send the booking confirmation on WhatsApp</label>
      {err && <div className="form-error" role="alert">{err}</div>}
    </Drawer>
  );
}

/* ============================================================ Patients */
export function Patients() {
  const meta = useMeta();
  const [q, setQ] = useState('');
  const [sp] = useSearchParams();
  const [service, setService] = useState(sp.get('group') || '');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(1), [q, service]);
  const path = `/api/admin/patients?page=${page}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}${service === 'none' ? '&ungrouped=1' : service === 'opted' ? '&opted=1' : service ? `&service=${service}` : ''}`;
  const { data, error, reload } = useApi(path);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;
  return (
    <>
      <header className="page-h">
        <div><h1>Patients</h1><p>{data ? `${data.total} patients` : ' '}</p></div>
        <div className="btn-row">
          <Link className="btn btn-ghost btn-sm" to="/clinic/groups"><UploadSimple size={16} /> Import old records</Link>
          <button className="btn btn-dark btn-sm" onClick={() => setAdding(true)}><UserPlus size={16} /> Add patient</button>
        </div>
      </header>
      <div className="filters">
        <div className="search"><MagnifyingGlass size={16} /><input className="input sm" placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input sm" value={service} onChange={(e) => setService(e.target.value)} aria-label="Group">
          <option value="">All groups</option>
          <option value="none">Not in a group yet</option>
          <option value="opted">Opted out of offers</option>
          {meta?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {error && <ErrorNote error={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && !data.patients.length && <Empty icon={UsersThree} title="No patients here yet">Patients appear when they book, or import your old records to start.</Empty>}
      {data && data.patients.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Mobile</th><th>Groups</th><th>Last visit</th><th>Source</th></tr></thead>
            <tbody>
              {data.patients.map((p) => (
                <tr key={p.id} onClick={() => setOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.id)}>
                  <td><b>{p.name}</b>{p.opted_out ? <small>Opted out of offers</small> : null}</td>
                  <td className="num nowrap">{p.phone_label}</td>
                  <td><div className="tags">{p.groups.slice(0, 3).map((g) => <span key={g.id} className={`tag ${g.source === 'ai' ? 'ai' : ''}`} title={g.reason || g.source}>{g.source === 'ai' && <Sparkle size={11} weight="fill" />}{g.name}</span>)}{p.groups.length > 3 && <span className="tag">+{p.groups.length - 3}</span>}</div></td>
                  <td className="num nowrap">{p.last_visit_at ? dayLabel(p.last_visit_at, { long: true }) : p.last_booking ? dayLabel(dubaiParts(p.last_booking).date, { long: true }) : '–'}</td>
                  <td className="muted">{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <div className="pager"><button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="num">{page} / {pages}</span><button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
      <PatientDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
      <AddPatient open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
    </>
  );
}

function PatientDrawer({ id, onClose, onChange }) {
  const meta = useMeta();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = () => api(`/api/admin/patients/${id}`).then((r) => { setD(r); setEdit({ name: r.patient.name, phone: r.patient.phone_label, email: r.patient.email || '', notes: r.patient.notes || '', opted_out: !!r.patient.opted_out }); });
  useEffect(() => { setD(null); if (id) load().catch((e) => toast(e.message, 'error')); }, [id]); // eslint-disable-line
  const groups = new Set(d?.groups.map((g) => g.id));
  const toggle = async (sid) => {
    const next = groups.has(sid) ? [...groups].filter((x) => x !== sid) : [...groups, sid];
    try { const r = await api(`/api/admin/patients/${id}/groups`, { method: 'PUT', body: { service_ids: next } }); setD({ ...d, groups: r.groups }); onChange?.(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const save = async () => {
    try { await api(`/api/admin/patients/${id}`, { method: 'PATCH', body: edit }); toast('Saved'); load(); onChange?.(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const del = async () => {
    if (!confirm('Delete this patient, their bookings and message history? This cannot be undone.')) return;
    try { await api(`/api/admin/patients/${id}`, { method: 'DELETE' }); toast('Patient deleted'); onClose(); onChange?.(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.patient.name || 'Patient'} wide
      footer={d && <><button className="btn btn-ghost btn-sm danger" onClick={del}><Trash size={16} /> Delete</button><button className="btn btn-dark btn-sm" onClick={save}>Save changes</button></>}>
      {!d || !edit ? <Loading /> : (
        <div className="stack">
          <div className="form-2">
            <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Mobile"><input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Offers & broadcasts">
              <select className="input" value={edit.opted_out ? '1' : '0'} onChange={(e) => setEdit({ ...edit, opted_out: e.target.value === '1' })}>
                <option value="0">Receives broadcasts</option><option value="1">Opted out</option>
              </select>
            </Field>
            <Field label="Treatment notes" full hint="Used by the AI to place this patient in groups."><textarea className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
          <section>
            <h3 className="sub-h">Groups</h3>
            <div className="tags lg">
              {meta?.services.map((s) => {
                const g = d.groups.find((x) => x.id === s.id);
                return (
                  <button key={s.id} className={`tag pick-tag ${g ? 'on' : ''} ${g?.source === 'ai' ? 'ai' : ''}`} onClick={() => toggle(s.id)} aria-pressed={!!g} title={g ? `${g.source}${g.reason ? ' · ' + g.reason : ''}${g.last_date ? ' · last ' + g.last_date : ''}` : 'Add to group'}>
                    {g?.source === 'ai' && <Sparkle size={11} weight="fill" />}{s.name}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h3 className="sub-h">Appointments</h3>
            {!d.bookings.length && <p className="muted">No appointments yet.</p>}
            <ul className="queue">
              {d.bookings.map((b) => <li key={b.id}><span><span className="q-when"><b>{dayLabel(b.date, { long: true })}</b> · {hm(b.time)} · {b.branch.name}</span><span className="q-who">{b.service.name}</span></span><Badge s={b.status} /></li>)}
            </ul>
          </section>
          <section>
            <h3 className="sub-h">WhatsApp history</h3>
            <ul className="thread">
              {!d.messages.length && <li className="muted">No messages yet.</li>}
              {d.messages.slice(0, 30).map((m) => (
                <li key={m.id} className={m.direction}><p>{m.body}</p><small>{m.kind.replace(/_/g, ' ')} · {ago(m.created_at)} · <Badge s={m.status} /></small>{m.error && <small className="err">{m.error}</small>}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function AddPatient({ open, onClose, onDone }) {
  const meta = useMeta();
  const toast = useToast();
  const [f, setF] = useState({ name: '', phone: '', email: '', notes: '', service_ids: [], last_date: '' });
  const [err, setErr] = useState(null);
  const submit = async () => {
    setErr(null);
    try { await api('/api/admin/patients', { method: 'POST', body: f }); toast('Patient added'); setF({ name: '', phone: '', email: '', notes: '', service_ids: [], last_date: '' }); onDone(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Add patient" footer={<><button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-dark btn-sm" onClick={submit}>Add patient</button></>}>
      <div className="form-2">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile"><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Last treatment date" hint="Drives recall automations"><input className="input" type="date" value={f.last_date} onChange={(e) => setF({ ...f, last_date: e.target.value })} /></Field>
        <Field label="Notes" full><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <h3 className="sub-h">Groups</h3>
      <div className="tags lg">
        {meta?.services.map((s) => {
          const on = f.service_ids.includes(s.id);
          return <button key={s.id} className={`tag pick-tag ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, service_ids: on ? f.service_ids.filter((x) => x !== s.id) : [...f.service_ids, s.id] })}>{s.name}</button>;
        })}
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
    </Drawer>
  );
}

/* ============================================================ Groups + AI import */
export function Groups() {
  const toast = useToast();
  const { data, error, reload } = useApi('/api/admin/groups');
  const [busy, setBusy] = useState(false);
  const recl = async () => {
    setBusy(true);
    try { const r = await api('/api/admin/groups/reclassify', { method: 'POST', body: { mode: 'auto' } }); toast(`Checked ${r.checked} patients, grouped ${r.grouped}${r.aiError ? ' (AI: ' + r.aiError + ')' : ''}`, r.aiError ? 'error' : 'ok'); reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <header className="page-h">
        <div><h1>Groups & AI import</h1><p>Patients are grouped by treatment so broadcasts reach the right people.</p></div>
        {data?.ungrouped > 0 && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={recl}><Sparkle size={16} /> {busy ? 'Sorting…' : `Sort ${data.ungrouped} ungrouped patients`}</button>}
      </header>
      {error && <ErrorNote error={error} retry={reload} />}
      {data && (
        <div className="groups">
          {data.groups.map((g) => (
            <Link key={g.id} className="group" to={`/clinic/patients?group=${g.id}`}>
              <span className="muted">{g.family}</span>
              <b>{g.name}</b>
              <span className="num group-n">{g.members}</span>
              <small>{g.reachable} reachable{g.by_ai ? ` · ${g.by_ai} by AI` : ''}</small>
            </Link>
          ))}
        </div>
      )}
      <Importer ai={data?.ai} onDone={reload} />
    </>
  );
}

function Importer({ ai, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState('');
  const [mode, setMode] = useState('auto');
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const input = useRef(null);
  const meta = useMeta();

  const pickFile = (f) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr('That file is over 10 MB. Split it and import in parts.'); return; }
    setFile(f); setPrev(null); setErr(null);
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result || ''));
    r.readAsText(f);
  };
  const preview = async () => {
    setBusy(true); setErr(null);
    try { setPrev(await api('/api/admin/import/preview', { method: 'POST', body: { csv, mode } })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const items = prev.items.filter((x) => !x.issue);
      const r = await api('/api/admin/import/commit', { method: 'POST', body: { items, filename: file?.name, used_ai: prev.aiUsed > 0 } });
      toast(`Imported: ${r.created} new, ${r.updated} updated, ${r.grouped} placed in groups`);
      setPrev(null); setFile(null); setCsv(''); onDone?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const setRowServices = (line, slugs) => setPrev((p) => ({ ...p, items: p.items.map((x) => (x.line === line ? { ...x, services: slugs.map((s) => ({ slug: s, confidence: 1, reason: 'Edited', by: 'manual' })) } : x)) }));
  const svcName = (slug) => meta?.services.find((s) => s.slug === slug)?.name || slug;
  const rows = prev ? prev.items.filter((x) => filter === 'all' || (filter === 'issues' ? x.issue : filter === 'ungrouped' ? !x.issue && !x.services.length : x.services.some((s) => s.by === 'ai'))) : [];

  return (
    <section className="panel import">
      <div className="panel-h"><h2>Import previous patient data</h2><span className="muted">{ai ? 'Claude AI connected' : 'Keyword rules only · add a Claude key in Settings for AI sorting'}</span></div>
      <p className="muted" style={{ maxWidth: '70ch' }}>Upload a CSV export from your old system or a spreadsheet. Any column names work: we look for name, phone/mobile, treatment/notes and date. Each patient is placed in the right group automatically: keyword rules first (English and Tagalog), then AI for anything unclear. You review before anything is saved.</p>
      {!prev && (
        <>
          <div className={`drop ${file ? 'has' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
            role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}>
            <FileCsv size={30} weight="light" />
            <b>{file ? file.name : 'Drop a CSV file here, or click to choose'}</b>
            <small>{file ? `${(file.size / 1024).toFixed(0)} KB · ${csv.split(/\n/).length - 1} rows` : 'Up to 20,000 rows. In Excel: File → Save As → CSV UTF-8.'}</small>
            <input ref={input} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <Seg label="Sorting" value={mode} onChange={setMode} options={[['auto', 'Rules + AI when unsure'], ['all', 'AI checks every row'], ['rules', 'Rules only']]} />
            <button className="btn btn-dark btn-sm" disabled={!csv || busy} onClick={preview}>{busy ? <><span className="spin" /> Sorting…</> : <><Sparkle size={16} /> Preview groups</>}</button>
            <a className="link" href="/sample-patients.csv" download>Download a sample file</a>
          </div>
        </>
      )}
      {err && <div className="form-error" role="alert">{err}</div>}
      {prev && (
        <div className="stack">
          <div className="stats sm">
            <Stat label="Rows" value={prev.summary.rows} />
            <Stat label="Placed in groups" value={prev.summary.grouped} />
            <Stat label="No group found" value={prev.summary.ungrouped} />
            <Stat label="Skipped (bad phone / duplicate)" value={prev.summary.invalid} />
          </div>
          {prev.aiError && <div className="error-note"><WarningCircle size={18} /> AI step stopped: {prev.aiError}. Rule-based groups are still shown.</div>}
          <p className="muted">Columns found: {Object.entries(prev.columns).map(([k, v]) => `${k} → “${v}”`).join(', ')}{prev.aiUsed ? ` · AI read ${prev.aiUsed} rows` : ''}</p>
          <Seg label="Show" value={filter} onChange={setFilter} options={[['all', 'All'], ['ai', 'Sorted by AI'], ['ungrouped', 'No group'], ['issues', 'Skipped']]} />
          <div className="table-wrap tall">
            <table className="table">
              <thead><tr><th>Line</th><th>Patient</th><th>Treatment text</th><th>Groups</th></tr></thead>
              <tbody>
                {rows.slice(0, 400).map((x) => (
                  <tr key={x.line} className={x.issue ? 'dim' : ''}>
                    <td className="num">{x.line}</td>
                    <td><b>{x.name || '—'}</b><small className="num">{x.phone ? phoneLabel(x.phone) : x.raw_phone}{x.exists ? ' · existing' : ''}</small></td>
                    <td className="muted wrap-text">{x.text || '—'}{x.date ? <small className="num">Last: {x.date}</small> : null}</td>
                    <td>
                      {x.issue && <Badge s="failed">{x.issue}</Badge>}
                      {!x.issue && <div className="tags">{x.services.map((s) => <span key={s.slug} className={`tag ${s.by === 'ai' ? 'ai' : ''}`} title={`${Math.round(s.confidence * 100)}% · ${s.reason}`}>{s.by === 'ai' && <Sparkle size={11} weight="fill" />}{svcName(s.slug)}</span>)}{!x.services.length && <span className="muted">No group</span>}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 400 && <p className="muted" style={{ padding: 12 }}>Showing 400 of {rows.length} rows. All of them will be imported.</p>}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost btn-sm" onClick={() => setPrev(null)}>Back</button>
            <button className="btn btn-dark btn-sm" disabled={busy || !prev.summary.valid} onClick={commit}>{busy ? <span className="spin" /> : `Import ${prev.summary.valid} patients`}</button>
          </div>
        </div>
      )}
    </section>
  );
}

