import { useEffect, useState } from 'react';
import {
  Plus, Megaphone, Lightning, Smiley, ChatsCircle, PaperPlaneTilt, Copy, CheckCircle, Sparkle, PencilSimple, Trash, WarningCircle, Flask, Key, Clock,
} from '@phosphor-icons/react';
import { api, useApi, useMeta, ago, dateTime, dubaiNow } from '../lib.js';
import { Badge, Drawer, Empty, Field, Seg, Stat, Loading, ErrorNote, Toggle, useToast } from './ui.jsx';

const VARS = ['first_name', 'name', 'book_link'];

/* ============================================================ Broadcasts */
export function Broadcasts() {
  const { data, error, reload } = useApi('/api/admin/broadcasts');
  const tpls = useApi('/api/admin/templates');
  const [compose, setCompose] = useState(false);
  const [open, setOpen] = useState(null);
  const [tplEdit, setTplEdit] = useState(null);
  useEffect(() => {
    if (!data?.broadcasts.some((b) => b.status === 'sending' || b.status === 'scheduled')) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);
  const broadcastTpls = (tpls.data?.templates || []).filter((t) => t.kind === 'broadcast');
  return (
    <>
      <header className="page-h">
        <div><h1>Broadcasts</h1><p>Bulk WhatsApp messages to patient groups: cleaning, braces, fillings and more.</p></div>
        <button className="btn btn-dark btn-sm" onClick={() => setCompose(true)}><PaperPlaneTilt size={16} /> New broadcast</button>
      </header>
      {error && <ErrorNote error={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && !data.broadcasts.length && <Empty icon={Megaphone} title="No broadcasts yet" action={<button className="btn btn-dark btn-sm" onClick={() => setCompose(true)}>Send the first one</button>}>Pick one or more groups, choose a message and send now or schedule it.</Empty>}
      {data && data.broadcasts.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Broadcast</th><th>Message</th><th>Progress</th><th>When</th><th>Status</th></tr></thead>
            <tbody>
              {data.broadcasts.map((b) => (
                <tr key={b.id} onClick={() => setOpen(b.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(b.id)}>
                  <td><b>{b.name}</b>{b.automation_id ? <small><Lightning size={11} /> automation</small> : null}</td>
                  <td>{b.template_name}</td>
                  <td><Progress b={b} /></td>
                  <td className="num nowrap">{dateTime(b.scheduled_at || b.created_at)}</td>
                  <td><Badge s={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-h"><h2>Broadcast messages</h2><button className="btn btn-ghost btn-sm" onClick={() => setTplEdit({ name: '', body: 'Hi {{first_name}}, ', meta_name: '' })}><Plus size={16} /> New message</button></div>
        <div className="tpl-grid">
          {broadcastTpls.map((t) => (
            <button key={t.key} className="tpl" onClick={() => setTplEdit(t)}>
              <b>{t.name}</b>
              <p>{t.body}</p>
              <small>{t.meta_name ? <><CheckCircle size={13} /> Meta template: {t.meta_name}</> : <><WarningCircle size={13} /> Needs a Meta template name to send live</>}</small>
            </button>
          ))}
        </div>
      </section>

      <Composer open={compose} onClose={() => setCompose(false)} templates={broadcastTpls} onDone={() => { setCompose(false); reload(); }} />
      <BroadcastDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
      <TemplateDrawer tpl={tplEdit} onClose={() => setTplEdit(null)} onDone={() => { setTplEdit(null); tpls.reload(); }} />
    </>
  );
}

const Progress = ({ b }) => {
  const done = b.sent + b.failed;
  return (
    <span className="prog">
      <span className="prog-bar"><i style={{ width: `${b.total ? (b.sent / b.total) * 100 : 0}%` }} /><i className="f" style={{ width: `${b.total ? (b.failed / b.total) * 100 : 0}%` }} /></span>
      <span className="num">{done}/{b.total}{b.failed ? ` · ${b.failed} failed` : ''}</span>
    </span>
  );
};

function Bubble({ text, buttons = [] }) {
  return (
    <div className="wa-prev">
      <div className="wa-prev-b">{text || <span className="muted">Message preview</span>}</div>
      {buttons.length > 0 && <div className="wa-prev-btns">{buttons.map((b) => <span key={b.id || b.title}>{b.title}</span>)}</div>}
    </div>
  );
}

function Composer({ open, onClose, templates, onDone }) {
  const toast = useToast();
  const groups = useApi(open ? '/api/admin/groups' : null, [open]);
  const [f, setF] = useState({ name: '', template_key: '', service_ids: [], when: 'now', at: '' });
  const [aud, setAud] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setErr(null); setF((x) => ({ ...x, template_key: x.template_key || (templates.find((t) => t.key === 'general_update') || templates[0])?.key || '' })); } }, [open, templates]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api(`/api/admin/audience?service_ids=${f.service_ids.join(',')}&template=${f.template_key}`).then(setAud).catch(() => setAud(null));
    }, 150);
    return () => clearTimeout(t);
  }, [open, f.service_ids, f.template_key]);
  const tpl = templates.find((t) => t.key === f.template_key);
  const send = async () => {
    setErr(null);
    if (!f.service_ids.length) { setErr('Choose at least one group.'); return; }
    if (f.when === 'later' && !f.at) { setErr('Choose when to send.'); return; }
    if (!confirm(`Send "${tpl?.name}" to ${aud?.count || 0} patients${f.when === 'later' ? ' at the scheduled time' : ' now'}?`)) return;
    setBusy(true);
    try {
      await api('/api/admin/broadcasts', { method: 'POST', body: { name: f.name, template_key: f.template_key, service_ids: f.service_ids, scheduled_at: f.when === 'later' ? new Date(`${f.at}:00+04:00`).toISOString() : null } });
      toast(f.when === 'later' ? 'Broadcast scheduled' : 'Broadcast is sending');
      setF({ name: '', template_key: f.template_key, service_ids: [], when: 'now', at: '' });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const min = `${dubaiNow().date}T${String(dubaiNow().hh).padStart(2, '0')}:${String(dubaiNow().mm).padStart(2, '0')}`;
  return (
    <Drawer open={open} onClose={onClose} title="New broadcast" wide
      footer={<><span className="muted grow">{aud ? `${aud.count} patients will receive this` : ''}</span><button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-dark btn-sm" disabled={busy || !aud?.count} onClick={send}>{busy ? <span className="spin" /> : f.when === 'later' ? 'Schedule' : 'Send now'}</button></>}>
      <div className="compose">
        <div className="stack">
          <Field label="Name (for your records)"><input className="input" placeholder="e.g. November cleaning recall" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="field">
            <span>Patient groups</span>
            <div className="tags lg">
              {(groups.data?.groups || []).map((g) => {
                const on = f.service_ids.includes(g.id);
                return (
                  <button key={g.id} className={`tag pick-tag ${on ? 'on' : ''}`} aria-pressed={on} disabled={!g.reachable}
                    onClick={() => setF({ ...f, service_ids: on ? f.service_ids.filter((x) => x !== g.id) : [...f.service_ids, g.id] })}>
                    {g.name} <span className="num">{g.reachable}</span>
                  </button>
                );
              })}
            </div>
            <small>Patients in several selected groups get the message once. Opted-out patients are left out.</small>
          </div>
          <Field label="Message">
            <select className="input" value={f.template_key} onChange={(e) => setF({ ...f, template_key: e.target.value })}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </Field>
          <div className="field">
            <span>When</span>
            <Seg label="When" value={f.when} onChange={(v) => setF({ ...f, when: v })} options={[['now', 'Send now'], ['later', 'Schedule']]} />
            {f.when === 'later' && <input className="input" type="datetime-local" min={min} value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} aria-label="Send at (Dubai time)" />}
            {f.when === 'later' && <small>Dubai time.</small>}
          </div>
          {err && <div className="form-error" role="alert">{err}</div>}
        </div>
        <div className="compose-prev">
          <span className="muted">Preview{aud?.sample?.[0] ? ` for ${aud.sample[0].name}` : ''}</span>
          <Bubble text={aud?.preview || tpl?.body} />
          {aud?.sample?.length > 0 && <ul className="aud">{aud.sample.map((p) => <li key={p.phone}><b>{p.name}</b><span className="num">{p.phone}</span></li>)}{aud.count > aud.sample.length && <li className="muted">and {aud.count - aud.sample.length} more</li>}</ul>}
          {tpl && !tpl.meta_name && <p className="hint-warn"><WarningCircle size={15} /> In live mode WhatsApp needs this message approved as a Meta template first. Add its template name under Broadcast messages.</p>}
        </div>
      </div>
    </Drawer>
  );
}

function BroadcastDrawer({ id, onClose, onChange }) {
  const toast = useToast();
  const { data, reload } = useApi(id ? `/api/admin/broadcasts/${id}` : null, [id]);
  useEffect(() => {
    if (!data || !['sending', 'scheduled'].includes(data.broadcast.status)) return;
    const t = setInterval(reload, 3000); return () => clearInterval(t);
  }, [data, reload]);
  const cancel = async () => {
    if (!confirm('Stop this broadcast? Messages already sent stay sent.')) return;
    try { await api(`/api/admin/broadcasts/${id}/cancel`, { method: 'POST' }); toast('Broadcast stopped'); reload(); onChange(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const b = data?.broadcast;
  return (
    <Drawer open={!!id} onClose={onClose} title={b?.name || 'Broadcast'} wide
      footer={b && ['sending', 'scheduled'].includes(b.status) && <button className="btn btn-ghost btn-sm danger" onClick={cancel}>Stop broadcast</button>}>
      {!b ? <Loading /> : (
        <div className="stack">
          <div className="stats sm">
            <Stat label="Recipients" value={b.total} />
            <Stat label="Sent" value={b.sent} />
            <Stat label="Failed" value={b.failed} />
            <Stat label="Status" value={<Badge s={b.status} />} />
          </div>
          <Bubble text={b.body} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Patient</th><th>Mobile</th><th>Status</th></tr></thead>
              <tbody>
                {data.recipients.map((r) => (
                  <tr key={r.patient_id}><td><b>{r.name}</b>{r.error && <small className="err">{r.error}</small>}</td><td className="num nowrap">{r.phone}</td><td><Badge s={r.message_status || r.status} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function TemplateDrawer({ tpl, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { setErr(null); setF(tpl ? { name: tpl.name, body: tpl.body, meta_name: tpl.meta_name || '', meta_lang: tpl.meta_lang || 'en' } : null); }, [tpl]);
  if (!tpl || !f) return <Drawer open={false} onClose={onClose} title="" />;
  const isNew = !tpl.key;
  const metaBody = (() => { let i = 0; return f.body.replace(/\{\{\s*[a-z_]+\s*\}\}/g, () => `{{${++i}}}`); })();
  const save = async () => {
    setErr(null);
    try {
      if (isNew) await api('/api/admin/templates', { method: 'POST', body: f });
      else await api(`/api/admin/templates/${tpl.key}`, { method: 'PUT', body: f });
      toast('Message saved'); onDone();
    } catch (e) { setErr(e.message); }
  };
  const del = async () => {
    if (!confirm('Delete this message?')) return;
    try { await api(`/api/admin/templates/${tpl.key}`, { method: 'DELETE' }); toast('Deleted'); onDone(); } catch (e) { setErr(e.message); }
  };
  const insert = (v) => setF({ ...f, body: `${f.body}{{${v}}}` });
  return (
    <Drawer open={!!tpl} onClose={onClose} title={isNew ? 'New broadcast message' : f.name} wide
      footer={<>{!isNew && tpl.kind === 'broadcast' && <button className="btn btn-ghost btn-sm danger" onClick={del}><Trash size={16} /> Delete</button>}<span className="grow" /><button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-dark btn-sm" onClick={save}>Save</button></>}>
      <div className="compose">
        <div className="stack">
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Message" hint={`${f.body.length} / 1024 characters`}>
            <textarea className="input" rows={7} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
          <div className="btn-row">{(tpl.kind === 'system' ? tpl.variables.filter((v, i, a) => a.indexOf(v) === i) : VARS).map((v) => <button key={v} type="button" className="tag pick-tag" onClick={() => insert(v)}>+ {v}</button>)}</div>
          <Field label="Meta template name" hint="After WhatsApp approves the template in Meta Business Manager, paste its exact name here (lowercase, underscores).">
            <input className="input mono" placeholder="e.g. cleaning_recall_v1" value={f.meta_name} onChange={(e) => setF({ ...f, meta_name: e.target.value })} />
          </Field>
          <Field label="Template language code"><input className="input mono" value={f.meta_lang} onChange={(e) => setF({ ...f, meta_lang: e.target.value })} /></Field>
          {err && <div className="form-error" role="alert">{err}</div>}
        </div>
        <div className="compose-prev">
          <span className="muted">Preview</span>
          <Bubble text={f.body.replace(/\{\{\s*first_name\s*\}\}/g, 'Maria').replace(/\{\{\s*name\s*\}\}/g, 'Maria Santos').replace(/\{\{\s*book_link\s*\}\}/g, 'anytimedental.ae/book')} buttons={tpl.buttons || []} />
          <span className="muted" style={{ marginTop: 16 }}>Text to submit to Meta for approval</span>
          <pre className="meta-body">{metaBody}</pre>
          <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(metaBody); toast('Copied'); }}><Copy size={16} /> Copy</button>
          {tpl.buttons?.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Add two Quick Reply buttons in Meta: {tpl.buttons.map((b) => `“${b.title}”`).join(' and ')}.</p>}
        </div>
      </div>
    </Drawer>
  );
}

/* ============================================================ Automations */
export function Automations() {
  const meta = useMeta();
  const toast = useToast();
  const { data, error, reload } = useApi('/api/admin/automations');
  const tpls = useApi('/api/admin/templates');
  const [edit, setEdit] = useState(null);
  const toggle = async (a) => {
    try { await api(`/api/admin/automations/${a.id}`, { method: 'PATCH', body: { active: !a.active } }); reload(); toast(a.active ? 'Paused' : 'Turned on'); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <header className="page-h">
        <div><h1>Automations</h1><p>Broadcasts that send themselves, based on each patient’s last treatment in a group. Checked daily at 10 AM.</p></div>
        <button className="btn btn-dark btn-sm" onClick={() => setEdit({ name: '', service_id: meta?.services[1]?.id || '', template_key: 'recall_cleaning', days_after: 180, repeat_days: '', active: true })}><Plus size={16} /> New automation</button>
      </header>
      {error && <ErrorNote error={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && !data.automations.length && <Empty icon={Lightning} title="No automations">Create one to remind cleaning patients every 6 months, braces patients monthly, and so on.</Empty>}
      <div className="autos">
        {data?.automations.map((a) => (
          <article key={a.id} className={`auto ${a.active ? '' : 'off'}`}>
            <div className="auto-top">
              <div><b>{a.name}</b><span className="tag">{a.service?.name}</span></div>
              <Toggle checked={!!a.active} onChange={() => toggle(a)} label={`${a.active ? 'Pause' : 'Turn on'} ${a.name}`} />
            </div>
            <p className="auto-rule"><Clock size={16} /> {a.days_after} days after the last {a.service?.name.toLowerCase()}{a.repeat_days ? `, then every ${a.repeat_days} days` : ''}</p>
            <p className="muted">Sends “{a.template_name}”</p>
            <div className="auto-foot">
              <span><b className="num">{a.due_today}</b> due today</span>
              <span><b className="num">{a.sent_total}</b> sent so far</span>
              <button className="link" onClick={() => setEdit({ ...a, repeat_days: a.repeat_days || '' })}><PencilSimple size={14} /> Edit</button>
            </div>
          </article>
        ))}
      </div>
      <AutomationDrawer a={edit} templates={(tpls.data?.templates || []).filter((t) => t.kind === 'broadcast')} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />
    </>
  );
}

function AutomationDrawer({ a, templates, onClose, onDone }) {
  const meta = useMeta();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { setErr(null); setF(a ? { ...a } : null); }, [a]);
  const save = async () => {
    setErr(null);
    const body = { name: f.name, service_id: Number(f.service_id), template_key: f.template_key, days_after: Number(f.days_after), repeat_days: f.repeat_days === '' ? null : Number(f.repeat_days), active: !!f.active };
    try {
      if (a.id) await api(`/api/admin/automations/${a.id}`, { method: 'PATCH', body });
      else await api('/api/admin/automations', { method: 'POST', body });
      toast('Automation saved'); onDone();
    } catch (e) { setErr(e.message); }
  };
  const del = async () => {
    if (!confirm('Delete this automation?')) return;
    try { await api(`/api/admin/automations/${a.id}`, { method: 'DELETE' }); toast('Deleted'); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <Drawer open={!!a && !!f} onClose={onClose} title={a?.id ? 'Edit automation' : 'New automation'}
      footer={f && <>{a?.id && <button className="btn btn-ghost btn-sm danger" onClick={del}><Trash size={16} /> Delete</button>}<span className="grow" /><button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-dark btn-sm" onClick={save}>Save</button></>}>
      {f && (
        <div className="form-2">
          <Field label="Name" full><input className="input" value={f.name} placeholder="e.g. Filling check, yearly" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Patient group">
            <select className="input" value={f.service_id} onChange={(e) => setF({ ...f, service_id: e.target.value })}>
              {meta?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Message">
            <select className="input" value={f.template_key} onChange={(e) => setF({ ...f, template_key: e.target.value })}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Days after last treatment"><input className="input num" type="number" min="1" max="1095" value={f.days_after} onChange={(e) => setF({ ...f, days_after: e.target.value })} /></Field>
          <Field label="Then repeat every (days)" hint="Leave empty to send once"><input className="input num" type="number" min="7" max="1095" value={f.repeat_days} onChange={(e) => setF({ ...f, repeat_days: e.target.value })} /></Field>
          <label className="consent full"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
          <p className="muted full">Patients with an upcoming appointment, or who opted out, are skipped. Each patient gets each reminder once.</p>
          {err && <div className="form-error full" role="alert">{err}</div>}
        </div>
      )}
    </Drawer>
  );
}

/* ============================================================ Surveys */
export function Surveys() {
  const { data, error, reload } = useApi('/api/admin/surveys');
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = data.summary;
  const max = Math.max(1, ...data.dist);
  return (
    <>
      <header className="page-h"><div><h1>Satisfaction surveys</h1><p>Sent on WhatsApp after each completed visit.</p></div></header>
      <div className="stats">
        <Stat label="Average rating" value={s.avg ? `${Number(s.avg).toFixed(2)} / 5` : '–'} sub={`${s.answered || 0} of ${s.total || 0} answered`} />
        <Stat label="Net Promoter Score" value={s.nps ?? '–'} sub={s.rated ? `${s.promoters} promoters · ${s.detractors} detractors` : 'No answers yet'} />
        <Stat label="Felt comfortable" value={s.comfort ? `${Number(s.comfort).toFixed(1)} / 5` : '–'} />
        <Stat label="Clear explanations" value={s.explained ? `${Number(s.explained).toFixed(1)} / 5` : '–'} />
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-h"><h2>Ratings</h2></div>
          <div className="dist">
            {[5, 4, 3, 2, 1].map((r) => (
              <div key={r} className="dist-row"><span className="num">{r}</span><span className="dist-bar"><i style={{ width: `${(data.dist[r - 1] / max) * 100}%` }} /></span><span className="num">{data.dist[r - 1]}</span></div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>By clinic</h2></div>
          {!data.byBranch.length && <p className="muted">No surveys sent yet.</p>}
          <ul className="queue">
            {data.byBranch.map((b) => <li key={b.name}><span><span className="q-when"><b>{b.name}</b></span><span className="q-who">{b.answered} answers</span></span><span className="num">{b.avg ? Number(b.avg).toFixed(2) : '–'} / 5</span></li>)}
          </ul>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h2>Responses</h2></div>
        {!data.responses.length && <Empty icon={Smiley} title="No surveys yet">Mark a visit as completed and the survey goes out automatically after the delay set in Settings.</Empty>}
        {data.responses.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Patient</th><th>Visit</th><th>Rating</th><th>Recommend</th><th>Comment</th></tr></thead>
              <tbody>
                {data.responses.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b><small>{r.branch}</small></td>
                    <td>{r.service}<small className="num">{dateTime(r.starts_at)}</small></td>
                    <td>{r.answered_at ? <span className="num rating">{r.rating}/5</span> : <Badge s="sent">Waiting</Badge>}</td>
                    <td className="num">{r.recommend ?? '–'}</td>
                    <td className="wrap-text">{r.comment || <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ============================================================ WhatsApp log */
export function Messages() {
  const toast = useToast();
  const [dir, setDir] = useState('');
  const [q, setQ] = useState('');
  const [reply, setReply] = useState({});
  const path = `/api/admin/messages?${dir ? `direction=${dir}&` : ''}${q.trim() ? `q=${encodeURIComponent(q.trim())}` : ''}`;
  const { data, error, reload } = useApi(path);
  useEffect(() => { const t = setInterval(reload, 8000); return () => clearInterval(t); }, [reload]);
  const sim = async (m, body) => {
    try { const r = await api('/api/admin/sandbox/reply', { method: 'POST', body: { message_id: m.id, ...body } }); toast(`Patient reply handled: ${r.action.replace(/_/g, ' ')}`); setReply({ ...reply, [m.id]: '' }); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const sandbox = data?.mode !== 'cloud';
  return (
    <>
      <header className="page-h"><div><h1>WhatsApp log</h1><p>Every message sent and received, with delivery status.</p></div><TestSend /></header>
      <div className="filters">
        <Seg label="Direction" value={dir} onChange={setDir} options={[['', 'All'], ['out', 'Sent'], ['in', 'Received']]} />
        <div className="search"><input className="input sm" placeholder="Search name, number or text" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {sandbox && <div className="sandbox-tip"><Flask size={18} /> <span>Sandbox: use <b>Patient taps</b> on a reminder to test the full flow (confirm → location, reschedule → link) without a live WhatsApp number.</span></div>}
      {error && <ErrorNote error={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && !data.messages.length && <Empty icon={ChatsCircle} title="No messages yet">Booking confirmations, reminders, surveys and broadcasts will show here.</Empty>}
      <ul className="log">
        {data?.messages.map((m) => (
          <li key={m.id} className={`log-item ${m.direction}`}>
            <div className="log-meta">
              <b>{m.patient_name || m.phone_label}</b>
              <span className="num">{m.phone_label}</span>
              <span>{m.direction === 'in' ? 'received' : m.kind.replace(/_/g, ' ')}</span>
              <span>{ago(m.created_at)}</span>
              <Badge s={m.status} />
              {m.provider === 'sandbox' && <span className="tag">sandbox</span>}
            </div>
            <p className="log-body">{m.body}</p>
            {m.buttons?.length > 0 && <div className="thread-btns">{m.buttons.map((b) => <span key={b.id}>{b.title}</span>)}</div>}
            {m.error && <p className="err">{m.error}</p>}
            {sandbox && m.direction === 'out' && m.buttons?.length > 0 && m.booking_token && ['booked', 'confirmed'].includes(m.booking_status) && (
              <div className="sim">
                <span className="muted">Patient taps:</span>
                <button className="btn btn-ghost btn-sm" onClick={() => sim(m, { button: 'CONFIRM' })}>Confirm</button>
                <button className="btn btn-ghost btn-sm" onClick={() => sim(m, { button: 'RESCHEDULE' })}>Reschedule</button>
              </div>
            )}
            {sandbox && m.direction === 'out' && (
              <form className="sim" onSubmit={(e) => { e.preventDefault(); if (reply[m.id]) sim(m, { text: reply[m.id] }); }}>
                <input className="input sm" placeholder="Simulate a reply, e.g. STOP or yes" value={reply[m.id] || ''} onChange={(e) => setReply({ ...reply, [m.id]: e.target.value })} />
                <button className="btn btn-ghost btn-sm" disabled={!reply[m.id]}>Reply</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function TestSend() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { const r = await api('/api/admin/messages/test', { method: 'POST', body: { phone } }); if (r.message.status === 'failed') toast(r.message.error, 'error'); else { toast('Test message sent'); setOpen(false); } }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><PaperPlaneTilt size={16} /> Send a test</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Send a test message" footer={<><button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-dark btn-sm" disabled={busy || !phone} onClick={send}>Send test</button></>}>
        <Field label="Mobile number" hint="Sends the “General clinic update” message. In live mode it must be an approved template."><input className="input" type="tel" placeholder="050 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </Drawer>
    </>
  );
}

/* ============================================================ Settings */
export function Settings() {
  const toast = useToast();
  const { data, error, reload } = useApi('/api/admin/settings');
  const tpls = useApi('/api/admin/templates');
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState(null);
  const [tplEdit, setTplEdit] = useState(null);
  useEffect(() => { if (data) setS(JSON.parse(JSON.stringify(data))); }, [data]);
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!s) return <Loading />;
  const set = (sec, k, v) => setS({ ...s, [sec]: { ...s[sec], [k]: v } });
  const save = async (sections) => {
    setBusy(true);
    try {
      const body = Object.fromEntries(sections.map((k) => [k, s[k]]));
      await api('/api/admin/settings', { method: 'PUT', body });
      toast('Settings saved'); reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const doVerify = async () => {
    setVerify({ busy: true });
    try { await api('/api/admin/settings', { method: 'PUT', body: { whatsapp: s.whatsapp } }); setVerify(await api('/api/admin/settings/whatsapp/verify', { method: 'POST' })); reload(); }
    catch (e) { setVerify({ ok: false, error: e.message }); }
  };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };
  return (
    <>
      <header className="page-h"><div><h1>Settings</h1><p>WhatsApp connection, message templates, reminder timing and AI.</p></div></header>

      <section className="panel set">
        <div className="panel-h"><h2>WhatsApp Business (Cloud API)</h2><Badge s={s.whatsapp.mode === 'cloud' ? 'delivered' : 'queued'}>{s.whatsapp.mode === 'cloud' ? 'Live' : 'Sandbox'}</Badge></div>
        <Seg label="Mode" value={s.whatsapp.mode} onChange={(v) => set('whatsapp', 'mode', v)} options={[['sandbox', 'Sandbox (no messages leave)'], ['cloud', 'Live: WhatsApp Cloud API']]} />
        <div className="form-2">
          <Field label="Permanent access token" hint="System user token from Meta Business Settings"><input className="input mono" type="password" autoComplete="off" value={s.whatsapp.token} onChange={(e) => set('whatsapp', 'token', e.target.value)} /></Field>
          <Field label="Phone number ID"><input className="input mono" value={s.whatsapp.phone_number_id} onChange={(e) => set('whatsapp', 'phone_number_id', e.target.value)} /></Field>
          <Field label="WhatsApp Business Account ID"><input className="input mono" value={s.whatsapp.waba_id} onChange={(e) => set('whatsapp', 'waba_id', e.target.value)} /></Field>
          <Field label="App secret" hint="Used to verify that webhook calls really come from Meta"><input className="input mono" type="password" autoComplete="off" value={s.whatsapp.app_secret} onChange={(e) => set('whatsapp', 'app_secret', e.target.value)} /></Field>
          <Field label="Webhook callback URL" hint="Paste in Meta → WhatsApp → Configuration. Subscribe to “messages”.">
            <div className="copyfield"><input className="input mono" readOnly value={s.webhook_url} /><button className="icon-btn" onClick={() => copy(s.webhook_url)} aria-label="Copy"><Copy size={16} /></button></div>
          </Field>
          <Field label="Webhook verify token">
            <div className="copyfield"><input className="input mono" value={s.whatsapp.verify_token} onChange={(e) => set('whatsapp', 'verify_token', e.target.value)} /><button className="icon-btn" onClick={() => copy(s.whatsapp.verify_token)} aria-label="Copy"><Copy size={16} /></button></div>
          </Field>
        </div>
        {verify && !verify.busy && (verify.ok
          ? <div className="ok-note"><CheckCircle size={18} /> Connected: {verify.name} · {verify.number}{verify.quality ? ` · quality ${verify.quality}` : ''}</div>
          : <div className="error-note"><WarningCircle size={18} /> {verify.error}</div>)}
        <div className="btn-row">
          <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => save(['whatsapp'])}>Save WhatsApp settings</button>
          <button className="btn btn-ghost btn-sm" disabled={verify?.busy} onClick={doVerify}>{verify?.busy ? <span className="spin" /> : 'Test connection'}</button>
        </div>
      </section>

      <section className="panel set">
        <div className="panel-h"><h2>Reminder & survey messages</h2><span className="muted">Each needs an approved Meta template to send live</span></div>
        <div className="tpl-grid">
          {(tpls.data?.templates || []).filter((t) => t.kind === 'system').map((t) => (
            <button key={t.key} className="tpl" onClick={() => setTplEdit(t)}>
              <b>{t.name}</b><p>{t.body}</p>
              <small>{t.meta_name ? <><CheckCircle size={13} /> {t.meta_name}</> : <><WarningCircle size={13} /> No Meta template name yet</>}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="panel set">
        <div className="panel-h"><h2>Timing</h2></div>
        <div className="form-3">
          <Field label="First reminder (hours before)"><input className="input num" type="number" min="6" max="72" value={s.reminders.day_before_hours} onChange={(e) => set('reminders', 'day_before_hours', Number(e.target.value))} /></Field>
          <Field label="Second reminder (hours before)"><input className="input num" type="number" min="1" max="6" value={s.reminders.before_hours} onChange={(e) => set('reminders', 'before_hours', Number(e.target.value))} /></Field>
          <Field label="Survey after visit (minutes)"><input className="input num" type="number" min="0" max="2880" value={s.reminders.survey_delay_min} onChange={(e) => set('reminders', 'survey_delay_min', Number(e.target.value))} /></Field>
          <Field label="Broadcast speed (messages / minute)"><input className="input num" type="number" min="1" max="600" value={s.broadcast.per_minute} onChange={(e) => set('broadcast', 'per_minute', Number(e.target.value))} /></Field>
          <Field label="Automation catch-up window (days)" hint="How late a recall may still go out"><input className="input num" type="number" min="0" max="60" value={s.broadcast.grace_days} onChange={(e) => set('broadcast', 'grace_days', Number(e.target.value))} /></Field>
          {s.branches.map((b, i) => (
            <Field key={b.id} label={`Chairs at ${b.name}`} hint="Appointments allowed at the same time">
              <input className="input num" type="number" min="1" max="20" value={b.chairs} onChange={(e) => { const br = [...s.branches]; br[i] = { ...b, chairs: Number(e.target.value) }; setS({ ...s, branches: br }); }} />
            </Field>
          ))}
        </div>
        <div className="btn-row"><button className="btn btn-dark btn-sm" disabled={busy} onClick={() => save(['reminders', 'broadcast', 'branches'])}>Save timing</button></div>
      </section>

      <section className="panel set">
        <div className="panel-h"><h2><Sparkle size={18} /> AI patient sorting (Claude)</h2>{s.ai_env && <span className="muted">Key set on the server</span>}</div>
        <div className="form-2">
          <Field label="Anthropic API key" hint="Used only to place imported patients into treatment groups"><input className="input mono" type="password" autoComplete="off" placeholder="sk-ant-…" value={s.ai.api_key} onChange={(e) => set('ai', 'api_key', e.target.value)} /></Field>
          <Field label="Model"><input className="input mono" value={s.ai.model} onChange={(e) => set('ai', 'model', e.target.value)} /></Field>
        </div>
        <div className="btn-row"><button className="btn btn-dark btn-sm" disabled={busy} onClick={() => save(['ai'])}>Save AI settings</button></div>
      </section>

      <section className="panel set">
        <div className="panel-h"><h2>Clinic</h2></div>
        <div className="form-2">
          <Field label="Public website address" hint="Used in WhatsApp links (reschedule, survey, booking)"><input className="input mono" placeholder="https://anytimedental.ae" value={s.clinic.public_url || ''} onChange={(e) => set('clinic', 'public_url', e.target.value)} /></Field>
          <Field label="WhatsApp number shown on the site"><input className="input mono" value={s.clinic.whatsapp} onChange={(e) => set('clinic', 'whatsapp', e.target.value)} /></Field>
          <Field label="Phone"><input className="input mono" value={s.clinic.phone} onChange={(e) => set('clinic', 'phone', e.target.value)} /></Field>
          <Field label="Email"><input className="input" value={s.clinic.email} onChange={(e) => set('clinic', 'email', e.target.value)} /></Field>
        </div>
        <div className="btn-row"><button className="btn btn-dark btn-sm" disabled={busy} onClick={() => save(['clinic'])}>Save clinic details</button></div>
      </section>

      <Password />
      <TemplateDrawer tpl={tplEdit} onClose={() => setTplEdit(null)} onDone={() => { setTplEdit(null); tpls.reload(); }} />
    </>
  );
}

function Password() {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '' });
  const save = async () => {
    try { await api('/api/admin/password', { method: 'POST', body: f }); toast('Password changed'); setF({ current: '', next: '' }); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <section className="panel set">
      <div className="panel-h"><h2><Key size={18} /> Your password</h2></div>
      <div className="form-2">
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 10 characters"><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      </div>
      <div className="btn-row"><button className="btn btn-dark btn-sm" disabled={!f.current || f.next.length < 10} onClick={save}>Change password</button></div>
    </section>
  );
}

