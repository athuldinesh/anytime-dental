import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/kalam/latin-400.css';
import './styles/base.css';
import Home from './site/Home.jsx';

const Book = lazy(() => import('./site/Book.jsx'));
const Manage = lazy(() => import('./site/Manage.jsx'));
const Survey = lazy(() => import('./site/Manage.jsx').then((m) => ({ default: m.Survey })));
const Clinic = lazy(() => import('./admin/Shell.jsx'));

function ScrollTop() {
  const { pathname, hash } = useLocation();
  React.useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth' })); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function NotFound() {
  return (
    <main className="nf">
      <h1>That page isn’t here.</h1>
      <p>The link may be old or incomplete.</p>
      <a className="btn btn-dark" href="/">Back to Anytime Dental</a>
    </main>
  );
}

const Fallback = () => <div className="boot" aria-busy="true" />;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <ScrollTop />
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/book" element={<Book />} />
            <Route path="/r/:token" element={<Manage />} />
            <Route path="/s/:token" element={<Survey />} />
            <Route path="/clinic/*" element={<Clinic />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </MotionConfig>
  </React.StrictMode>,
);
