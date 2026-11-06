import { useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useInView } from 'motion/react';
import {
  ArrowRight, WhatsappLogo, ChatCircleText, NotePencil, MapPin, CheckCircle, CalendarDots, ArrowClockwise,
  Car, Translate, CreditCard, Clock, Plus, ArrowUpRight, Star, CaretLeft, CaretRight, Train,
} from '@phosphor-icons/react';
import { Nav, Footer, WHATSAPP } from './Chrome.jsx';
import { api, useMeta, dubaiNow, hm, WA } from '../lib.js';
import '../styles/site.css';

const spring = { type: 'spring', bounce: 0, duration: 0.6 };

export default function Home() {
  const meta = useMeta();
  useEffect(() => { document.title = 'Anytime Dental · Filipino dental clinic in Deira & Barsha Heights, Dubai'; }, []);
  return (
    <div className="site">
      <Nav />
      <main>
        <Hero />
        <Hours branches={meta?.branches} />
        <Treatments services={meta?.services} />
        <Team dentists={meta?.dentists} />
        <Clinics branches={meta?.branches} />
        <Questions />
        <Closing />
      </main>
      <Footer branches={meta?.branches} />
    </div>
  );
}

/* ------------------------------------------------------------------ hero */
function Hero() {
  return (
    <section className="hero">
      <div className="hero-sky" aria-hidden="true" />
      <div className="wrap hero-in">
        <motion.h1 className="hero-h" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, duration: 0.9 }}>
          Good dental care,<br />open every day.
        </motion.h1>
        <motion.p className="hero-p" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, duration: 0.9, delay: 0.08 }}>
          Filipino-speaking dentists in Deira and Barsha Heights, open 10 AM to 9 PM, weekends included. Book in a minute, confirm on WhatsApp.
        </motion.p>
        <motion.div className="hero-cta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, duration: 0.9, delay: 0.16 }}>
          <Link to="/book" className="btn btn-dark btn-lg">Book an appointment <span className="ico"><ArrowRight size={14} weight="bold" /></span></Link>
          <a className="btn btn-ghost btn-lg" href={WA(WHATSAPP, 'Hello Anytime Dental, I would like to book an appointment.')} target="_blank" rel="noreferrer">
            <WhatsappLogo size={20} /> Message us
          </a>
        </motion.div>
        <HeroCards />
      </div>
    </section>
  );
}

/** The two cards: a dentist's handwritten note, and the WhatsApp reminder patients really get. Tap it. */
function HeroCards() {
  const [state, setState] = useState('ask'); // ask | confirmed | moving | moved
  const [slot, setSlot] = useState(null);
  const reset = () => { setState('ask'); setSlot(null); };
  return (
    <div className="hero-cards">
      <motion.article className="card-note" initial={{ opacity: 0, y: 40, rotate: -7 }} animate={{ opacity: 1, y: 0, rotate: -5 }} transition={{ ...spring, duration: 1.1, delay: 0.25 }}>
        <span className="chip"><NotePencil size={15} weight="regular" /> Dentist’s note</span>
        <p className="hand">Cleaning done,<br />gums look healthy.<br />Next visit in 6 months.</p>
        <p className="hand hand-sm">We’ll message you when it’s time. — Anytime Dental</p>
        <svg className="note-scribble" viewBox="0 0 120 30" aria-hidden="true"><path d="M3 20c12-14 22-14 26 0s14 10 22-4 20-10 26 4 18 8 40-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </motion.article>

      <motion.article className="card-wa" aria-live="polite" initial={{ opacity: 0, y: 48, rotate: 4 }} animate={{ opacity: 1, y: 0, rotate: 2.5 }} transition={{ ...spring, duration: 1.1, delay: 0.35 }}>
        <header className="wa-top">
          <span className="chip"><ChatCircleText size={15} /> WhatsApp reminder</span>
          <span className="wa-eg">Example</span>
        </header>
        <div className="wa-thread">
          <div className="bubble in">
            Hi Maria, a reminder from Anytime Dental: your <b>teeth cleaning</b> is tomorrow at <b className="num">4:30 PM</b>, Al Rigga, Deira.
            <time className="num">10:02</time>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {state === 'ask' && (
              <motion.div key="ask" className="wa-actions" exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.18 }}>
                <button className="wa-btn" onClick={() => setState('confirmed')}><CheckCircle size={18} /> Confirm</button>
                <button className="wa-btn" onClick={() => setState('moving')}><CalendarDots size={18} /> Reschedule</button>
              </motion.div>
            )}
            {state === 'confirmed' && (
              <motion.div key="conf" className="wa-stack" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                <div className="bubble out">Confirm<time className="num">10:03</time></div>
                <div className="bubble in loc">
                  <MiniMap />
                  <b>Anytime Dental, Al Rigga</b>
                  <span>Al Ghurair Centre, Entrance 3 · 8th floor, Office 835 · Free parking</span>
                </div>
              </motion.div>
            )}
            {state === 'moving' && (
              <motion.div key="mv" className="wa-stack" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                <div className="bubble out">Reschedule<time className="num">10:03</time></div>
                <div className="bubble in">No problem. Pick a new time:</div>
                <div className="wa-slots">
                  {['Sat 11:00 AM', 'Sat 6:30 PM', 'Sun 10:30 AM'].map((s) => (
                    <button key={s} className="wa-slot num" onClick={() => { setSlot(s); setState('moved'); }}>{s}</button>
                  ))}
                </div>
              </motion.div>
            )}
            {state === 'moved' && (
              <motion.div key="mvd" className="wa-stack" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                <div className="bubble out num">{slot}<time>10:04</time></div>
                <div className="bubble in">Done. Your cleaning is now <b className="num">{slot}</b>. See you then.</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {state !== 'ask' && (
          <button className="wa-replay" onClick={reset}><ArrowClockwise size={14} /> Replay</button>
        )}
      </motion.article>
    </div>
  );
}

function MiniMap() {
  return (
    <svg className="minimap" viewBox="0 0 240 96" aria-hidden="true">
      <rect width="240" height="96" fill="#EEF6F6" />
      <path d="M-10 70 L250 40" stroke="#fff" strokeWidth="14" />
      <path d="M70 -10 L95 110" stroke="#fff" strokeWidth="10" />
      <path d="M160 -10 L150 110" stroke="#fff" strokeWidth="7" />
      <rect x="104" y="22" width="44" height="30" rx="5" fill="#D5ECEE" />
      <circle cx="126" cy="38" r="9" fill="#3DB0B7" />
      <circle cx="126" cy="38" r="3.5" fill="#fff" />
    </svg>
  );
}

/* ------------------------------------------------------------------ live hours */
const OPEN = 10 * 60, CLOSE = 21 * 60;

function Hours({ branches }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: '-15% 0px' });
  const [now, setNow] = useState(dubaiNow());
  const [next, setNext] = useState({});
  useEffect(() => { const t = setInterval(() => setNow(dubaiNow()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!branches) return;
    branches.forEach(async (b) => {
      try {
        let date = dubaiNow().date;
        let { slots } = await api(`/api/public/slots?branch=${b.id}&service=1&date=${date}`);
        let first = slots.find((s) => s.free);
        if (!first) {
          const t = new Date(Date.parse(date) + 864e5).toISOString().slice(0, 10);
          ({ slots } = await api(`/api/public/slots?branch=${b.id}&service=1&date=${t}`));
          first = slots.find((s) => s.free); date = t;
        }
        setNext((n) => ({ ...n, [b.id]: first ? { date, time: first.time, today: date === dubaiNow().date } : null }));
      } catch { /* leave blank */ }
    });
  }, [branches]);

  const isOpen = now.minutes >= OPEN && now.minutes < CLOSE;
  const pct = Math.min(1, Math.max(0, (now.minutes - OPEN) / (CLOSE - OPEN)));
  const hours = Array.from({ length: 12 }, (_, i) => 10 + i);

  return (
    <section className="hours" ref={ref}>
      <div className="wrap">
        <h2 className="sec-h center">Ten in the morning to nine at night.<br /><span className="mute">Every day, at both clinics.</span></h2>
        <div className="ruler-card">
          <div className="ruler" role="img" aria-label={`Open 10 AM to 9 PM. It is now ${hm(`${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')}`)} in Dubai.`}>
            {!isOpen && <span className="ruler-closed">Both clinics are closed now · open again at 10 AM</span>}
            <div className="ruler-track">
              <motion.div className="ruler-fill" initial={{ scaleX: 0 }} animate={{ scaleX: seen && isOpen ? pct : 0 }} transition={{ type: 'spring', bounce: 0, duration: 1.6 }} />
              {isOpen && (
                <motion.div className="ruler-now" initial={{ left: '0%', opacity: 0 }} animate={seen ? { left: `${pct * 100}%`, opacity: 1 } : {}} transition={{ type: 'spring', bounce: 0, duration: 1.6 }}>
                  <span className="num">Now {hm(`${String(now.hh).padStart(2, '0')}:${String(now.mm).padStart(2, '0')}`)}</span>
                </motion.div>
              )}
            </div>
            <div className="ruler-ticks">
              {hours.map((h) => (
                <span key={h} className="num" style={{ left: `${((h - 10) / 11) * 100}%` }}>{h === 12 ? '12' : h % 12}<i>{h < 12 ? 'am' : 'pm'}</i></span>
              ))}
            </div>
          </div>
          <div className="ruler-rows">
            {(branches || [{ id: 'a', name: 'Al Rigga, Deira' }, { id: 'b', name: 'Barsha Heights' }]).map((b) => {
              const n = next[b.id];
              return (
                <div className="ruler-row" key={b.id}>
                  <div>
                    <h3>{b.name}</h3>
                    <p className={isOpen ? 'open' : ''}><span className="dot" />{isOpen ? `Open now · closes 9 PM` : now.minutes < OPEN ? 'Opens today at 10 AM' : 'Closed now · opens 10 AM'}</p>
                  </div>
                  {n ? (
                    <Link className="next-slot" to={`/book?branch=${b.id}&date=${n.date}&time=${n.time}`}>
                      <span>Next free check-up</span>
                      <b className="num">{n.today ? 'Today' : 'Tomorrow'} {hm(n.time)}</b>
                      <ArrowRight size={16} />
                    </Link>
                  ) : <span className="next-slot is-empty"><span>Next free check-up</span><b className="num">checking…</b></span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ treatments */
const FAMILY_COPY = {
  'Everyday care': 'The visits that keep small things small.',
  'Repair & restore': 'When a tooth needs saving, rebuilding or replacing.',
  Straighten: 'Braces and aligners, managed by our orthodontist.',
  Brighten: 'Shade, shape and symmetry.',
};

function Treatments({ services }) {
  const fam = useMemo(() => {
    const g = {};
    (services || []).forEach((s) => { (g[s.family] ||= []).push(s); });
    return g;
  }, [services]);
  const block = (name, cls, photo) => fam[name] && (
    <article className={`fam ${cls}`}>
      {photo && <img className="fam-photo" src={photo} alt="" loading="lazy" />}
      <div className="fam-body">
        <h3>{name}</h3>
        <p>{FAMILY_COPY[name]}</p>
        <ul>
          {fam[name].map((s) => (
            <li key={s.id}>
              <Link to={`/book?service=${s.id}`}>
                <span className="fam-name">{s.name}</span>
                <span className="fam-blurb">{s.blurb}</span>
                <span className="fam-go" aria-hidden="true"><ArrowUpRight size={16} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
  return (
    <section className="treat" id="treatments">
      <div className="wrap">
        <h2 className="sec-h center">From a check-up to a whole new smile.</h2>
        <p className="sec-p center">Fourteen treatments across both clinics. Choose one to see the next free times.</p>
        <div className="fam-grid">
          {block('Everyday care', 'fam-a', '/img/room-clean.jpg')}
          <div className="fam-stack">
            {block('Straighten', 'fam-b')}
            {block('Brighten', 'fam-c')}
          </div>
          {block('Repair & restore', 'fam-d')}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ team (dark cinematic band) */
function Team({ dentists }) {
  const [i, setI] = useState(0);
  const list = dentists || [];
  const d = list[i];
  const go = (n) => list.length && setI((n + list.length) % list.length);
  return (
    <section className="team" id="dentists">
      <div className="wrap team-in">
        <div className="team-copy">
          <h2 className="team-h">Nine dentists.<br />One team that speaks your language.</h2>
          <p className="team-p">English and Tagalog in every room, with the warm, family-style care our patients come back for. Meet the people who will look after you.</p>
          {d && (
            <div className="team-who" aria-live="polite">
              <AnimatePresence mode="wait">
                <motion.div key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                  <b>{d.name}</b><span>{d.role}</span>
                </motion.div>
              </AnimatePresence>
              <div className="team-arrows">
                <button aria-label="Previous dentist" onClick={() => go(i - 1)}><CaretLeft size={18} /></button>
                <button aria-label="Next dentist" onClick={() => go(i + 1)}><CaretRight size={18} /></button>
              </div>
            </div>
          )}
          <div className="team-strip" role="tablist" aria-label="Dentists">
            {list.map((x, k) => (
              <button key={x.id} role="tab" aria-selected={k === i} aria-label={`${x.name}, ${x.role}`} className={k === i ? 'on' : ''} onClick={() => setI(k)}>
                <img src={x.photo} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <div className="team-photo">
          <AnimatePresence initial={false}>
            {d && (
              <motion.img key={d.id} src={d.photo} alt={`${d.name}, ${d.role} at Anytime Dental`}
                initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ clinics */
function Tower({ floor, total = 14 }) {
  return (
    <svg className="tower" viewBox={`0 0 72 ${total * 12 + 8}`} aria-hidden="true">
      {Array.from({ length: total }, (_, k) => {
        const f = total - k;
        const on = f === floor;
        return (
          <g key={f}>
            <rect x={on ? 0 : 8} y={k * 12 + 4} width={on ? 72 : 56} height="8" rx="2.5" fill={on ? '#3DB0B7' : '#E4E6E8'} />
            {on && <text x="66" y={k * 12 + 10.6} textAnchor="end" fontSize="7" fontFamily="IBM Plex Mono" fill="#fff">{f}F</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Clinics({ branches }) {
  return (
    <section className="clinics" id="clinics">
      <div className="wrap">
        <h2 className="sec-h center">Two clinics, easy to find.</h2>
        <p className="sec-p center">Both a short walk from the Metro, both with free parking.</p>
        <div className="clinic-grid">
          {(branches || []).map((b) => (
            <article className="clinic" key={b.id}>
              <Tower floor={b.slug === 'deira' ? 8 : 9} />
              <div className="clinic-body">
                <h3>{b.name}</h3>
                <p className="clinic-addr">{b.address}</p>
                <ul className="clinic-facts">
                  <li><MapPin size={18} /> {b.floor}</li>
                  <li><Train size={18} /> {b.directions.split('.')[0]}.</li>
                  <li><Car size={18} /> Free parking</li>
                  <li><Clock size={18} /> Every day, 10 AM to 9 PM</li>
                </ul>
                <div className="clinic-cta">
                  <Link className="btn btn-dark btn-sm" to={`/book?branch=${b.id}`}>Book here</Link>
                  <a className="btn btn-ghost btn-sm" href={b.maps_url} target="_blank" rel="noreferrer">Directions</a>
                  {b.reviews_url && <a className="clinic-rev" href={b.reviews_url} target="_blank" rel="noreferrer"><Star size={15} weight="fill" /> Google reviews</a>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ questions (large-type FAQ) */
const FAQ = [
  ['When are you open?', 'Both clinics are open every day of the week, including Fridays and weekends, from 10 AM to 9 PM.'],
  ['Where exactly do I go?', 'Deira: Al Ghurair Centre, Entrance 3, then the office tower lifts to the 8th floor, Office 835. Barsha Heights: Al Shafar Tower 1, 9th floor, Unit 903, near Dubai Internet City Metro Exit 1.'],
  ['How do the reminders work?', 'We message you on WhatsApp the day before and again two hours before your visit. Tap Confirm and we send the location and floor; tap Reschedule and you can pick a new time in a few seconds.'],
  ['Do your dentists speak Tagalog?', 'Yes. Our team speaks English and Tagalog, so you can explain what you feel in the language you are most comfortable with.'],
  ['Can I pay in instalments?', 'Eligible treatments can be split with Tabby or Tamara. Our team will check what applies to your plan before you start.'],
  ['Can I change or cancel my booking?', 'Anytime. Use the link in your WhatsApp message, reply to us there, or call +971 4 344 3882.'],
];

function Questions() {
  const [open, setOpen] = useState(0);
  return (
    <section className="faq" id="questions">
      <div className="wrap faq-in">
        <h2 className="faq-h">Questions, answered.</h2>
        <div className="faq-list">
          {FAQ.map(([q, a], k) => {
            const on = open === k;
            return (
              <div className={`faq-item ${on ? 'on' : ''}`} key={q}>
                <h3>
                  <button aria-expanded={on} aria-controls={`faq-${k}`} id={`faqq-${k}`} onClick={() => setOpen(on ? -1 : k)}>
                    <span>{q}</span><Plus size={22} className="faq-plus" />
                  </button>
                </h3>
                <div className="faq-a" id={`faq-${k}`} role="region" aria-labelledby={`faqq-${k}`}>
                  <div><p>{a}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ closing */
function Closing() {
  return (
    <section className="closing">
      <div className="wrap closing-in">
        <h2 className="sec-h">Book in under a minute.</h2>
        <p className="sec-p">Pick a treatment, a clinic and a time. We confirm on WhatsApp.</p>
        <div className="hero-cta">
          <Link to="/book" className="btn btn-dark btn-lg">Book an appointment <span className="ico"><ArrowRight size={14} weight="bold" /></span></Link>
        </div>
        <ul className="trust">
          <li><Clock size={16} /> Open daily, 10 AM to 9 PM</li>
          <li><Car size={16} /> Free parking</li>
          <li><Translate size={16} /> English & Tagalog</li>
          <li><CreditCard size={16} /> Tabby & Tamara</li>
        </ul>
      </div>
    </section>
  );
}
