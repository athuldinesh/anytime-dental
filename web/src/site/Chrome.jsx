import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { WhatsappLogo, ArrowRight, Phone, EnvelopeSimple, InstagramLogo, FacebookLogo, TiktokLogo, YoutubeLogo, MapPin } from '@phosphor-icons/react';
import { WA } from '../lib.js';

export const WHATSAPP = '971557916602';
export const PHONE = '+97143443882';

/** The clinic's own wordmark, cropped from their logo file with an SVG viewBox. */
export function Logo({ className = '', title = 'Anytime Dental' }) {
  return (
    <svg className={`logo ${className}`} viewBox="50 445 940 440" role="img" aria-label={title}>
      <image href="/img/logo.png" width="1080" height="1350" />
    </svg>
  );
}

const LINKS = [
  ['Treatments', '/#treatments'],
  ['Dentists', '/#dentists'],
  ['Clinics', '/#clinics'],
  ['Questions', '/#questions'],
];

export function Nav({ minimal = false }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    const k = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => { document.documentElement.style.overflow = ''; window.removeEventListener('keydown', k); };
  }, [open]);

  return (
    <header className={`nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="nav-in wrap">
        <Link to="/" className="nav-logo" aria-label="Anytime Dental home"><Logo /></Link>
        {!minimal && (
          <nav className="nav-links" aria-label="Main">
            {LINKS.map(([t, h]) => <a key={h} href={h}>{t}</a>)}
          </nav>
        )}
        <div className="nav-cta">
          <a className="btn btn-ghost btn-sm nav-wa" href={WA(WHATSAPP, 'Hello Anytime Dental, I would like to ask about an appointment.')} target="_blank" rel="noreferrer">
            <WhatsappLogo size={18} weight="regular" /> <span>WhatsApp</span>
          </a>
          <NavLink to="/book" className="btn btn-dark btn-sm">Book now</NavLink>
          {!minimal && (
            <button className={`burger ${open ? 'is-open' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <i /><i />
            </button>
          )}
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <nav aria-label="Mobile">
              {[...LINKS, ['Book an appointment', '/book']].map(([t, h], i) => (
                <motion.a key={h} href={h} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + i * 0.05, type: 'spring', bounce: 0, duration: 0.5 }}>{t}</motion.a>
              ))}
            </nav>
            <motion.div className="sheet-foot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
              <a href={`tel:${PHONE}`}><Phone size={18} /> +971 4 344 3882</a>
              <a href={WA(WHATSAPP)} target="_blank" rel="noreferrer"><WhatsappLogo size={18} /> +971 55 791 6602</a>
              <p>Open every day, 10 AM to 9 PM</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export function Footer({ branches = [] }) {
  return (
    <footer className="foot">
      <div className="wrap foot-grid">
        <div className="foot-brand">
          <Logo className="logo-foot" />
          <p>Filipino-speaking dental care in Deira and Barsha Heights. Open every day, 10 AM to 9 PM.</p>
          <div className="foot-social">
            <a href="https://www.instagram.com/anytimedentalclinic" target="_blank" rel="noreferrer" aria-label="Instagram"><InstagramLogo size={20} /></a>
            <a href="https://www.facebook.com/share/17jd1H5SyF/" target="_blank" rel="noreferrer" aria-label="Facebook"><FacebookLogo size={20} /></a>
            <a href="https://www.tiktok.com/@anytimedental" target="_blank" rel="noreferrer" aria-label="TikTok"><TiktokLogo size={20} /></a>
            <a href="https://youtube.com/@anytimedental-dubai" target="_blank" rel="noreferrer" aria-label="YouTube"><YoutubeLogo size={20} /></a>
          </div>
        </div>
        {branches.map((b) => (
          <div key={b.id} className="foot-col">
            <h3>{b.name}</h3>
            <p>{b.address}</p>
            <a href={b.maps_url} target="_blank" rel="noreferrer"><MapPin size={16} /> Directions</a>
          </div>
        ))}
        <div className="foot-col">
          <h3>Contact</h3>
          <a href={`tel:${PHONE}`}><Phone size={16} /> +971 4 344 3882</a>
          <a href={WA(WHATSAPP)} target="_blank" rel="noreferrer"><WhatsappLogo size={16} /> +971 55 791 6602</a>
          <a href="mailto:help@anytimedental.ae"><EnvelopeSimple size={16} /> help@anytimedental.ae</a>
        </div>
      </div>
      <div className="wrap foot-base">
        <span>© {new Date().getFullYear()} Anytime Dental Clinic, Dubai</span>
        <Link to="/clinic">Clinic sign-in <ArrowRight size={14} /></Link>
      </div>
    </footer>
  );
}
