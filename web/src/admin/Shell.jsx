import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  SunHorizon, CalendarBlank, UsersThree, Stack, Megaphone, Lightning, Smiley, ChatsCircle, GearSix, SignOut, List, X, Flask,
} from '@phosphor-icons/react';
import { api } from '../lib.js';
import { Logo } from '../site/Chrome.jsx';
import { ToastProvider } from './ui.jsx';
import { Today, Bookings, Patients, Groups } from './pages.jsx';
import { Broadcasts, Automations, Surveys, Messages, Settings } from './outreach.jsx';
import '../styles/admin.css';

const NAV = [
  ['', 'Today', SunHorizon],
  ['bookings', 'Bookings', CalendarBlank],
  ['patients', 'Patients', UsersThree],
  ['groups', 'Groups & AI import', Stack],
  ['broadcasts', 'Broadcasts', Megaphone],
  ['automations', 'Automations', Lightning],
  ['surveys', 'Surveys', Smiley],
  ['messages', 'WhatsApp log', ChatsCircle],
  ['settings', 'Settings', GearSix],
];

export default function Clinic() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    document.title = 'Clinic · Anytime Dental';
    api('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  if (user === undefined) return <div className="boot" />;
  return (
    <ToastProvider>
      {user ? <Layout user={user} onOut={() => setUser(null)} /> : <Login onIn={setUser} />}
    </ToastProvider>
  );
}

function Login({ onIn }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api('/api/auth/login', { method: 'POST', body: f }); onIn(r.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="login-sky" aria-hidden="true" />
      <form className="login-card" onSubmit={submit}>
        <Logo />
        <h1>Clinic sign-in</h1>
        <p>Bookings, WhatsApp reminders, broadcasts and surveys.</p>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn btn-dark btn-lg" disabled={busy}>{busy ? <span className="spin" /> : 'Sign in'}</button>
        <a className="login-back" href="/">Back to the website</a>
      </form>
    </div>
  );
}

function Layout({ user, onOut }) {
  const [wa, setWa] = useState(null);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => { api('/api/admin/overview').then((o) => setWa(o.whatsapp)).catch(() => {}); }, [loc.pathname]);
  const out = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); onOut(); nav('/clinic'); };
  return (
    <div className={`adm ${menu ? 'menu-open' : ''}`}>
      <aside className="side">
        <div className="side-top">
          <NavLink to="/clinic" className="side-logo" aria-label="Today"><Logo /></NavLink>
          <button className="icon-btn side-close" onClick={() => setMenu(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav>
          {NAV.map(([p, t, Icon]) => (
            <NavLink key={p} to={`/clinic${p ? '/' + p : ''}`} end={!p} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon size={19} /> {t}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user"><b>{user.name}</b><span>{user.email}</span></div>
          <button className="icon-btn" onClick={out} aria-label="Sign out" title="Sign out"><SignOut size={18} /></button>
        </div>
      </aside>
      <div className="side-scrim" onClick={() => setMenu(false)} />
      <div className="main">
        <div className="topbar">
          <button className="icon-btn burger-a" onClick={() => setMenu(true)} aria-label="Open menu"><List size={20} /></button>
          {wa && wa.mode !== 'cloud' && (
            <NavLink to="/clinic/settings" className="sandbox-banner"><Flask size={16} /> Sandbox mode: WhatsApp messages are kept in the log, not sent. Connect the WhatsApp Cloud API in Settings to go live.</NavLink>
          )}
          {wa && wa.mode === 'cloud' && !wa.live && (
            <NavLink to="/clinic/settings" className="sandbox-banner warn"><Flask size={16} /> Cloud API selected but credentials are incomplete.</NavLink>
          )}
        </div>
        <div className="content">
          <Routes>
            <Route index element={<Today />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="patients" element={<Patients />} />
            <Route path="groups" element={<Groups />} />
            <Route path="broadcasts" element={<Broadcasts />} />
            <Route path="automations" element={<Automations />} />
            <Route path="surveys" element={<Surveys />} />
            <Route path="messages" element={<Messages />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/clinic" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
