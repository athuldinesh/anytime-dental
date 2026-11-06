// End-to-end visual QA with real mouse clicks.  node qa/shots.cjs [base]
const { chromium, devices } = require('F:/Claudex/kavak/research/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:9822';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const cred = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'ADMIN_LOGIN.txt'), 'utf8');
const EMAIL = /Email: (.+)/.exec(cred)[1].trim(), PASS = /Password: (.+)/.exec(cred)[1].trim();
const problems = [];
const ok = (cond, msg) => { if (!cond) { problems.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };

/** Click what a visitor would click: scroll in, check the element is on top at its centre, then mouse-click. */
async function click(p, locator, label) {
  const el = typeof locator === 'string' ? p.locator(locator).first() : locator;
  try { await el.scrollIntoViewIfNeeded({ timeout: 5000 }); } catch { ok(false, `found: ${label}`); return false; }
  await p.waitForTimeout(150);
  const box = await el.boundingBox();
  if (!box) { ok(false, `visible: ${label}`); return false; }
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const hit = await el.evaluate((node, [x, y]) => { const t = document.elementFromPoint(x, y); return !!t && (node === t || node.contains(t)); }, [x, y]);
  if (!hit) { const top = await p.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y); return t ? t.outerHTML.slice(0, 90) + ' scrollY=' + scrollY : 'none'; }, [x, y]); ok(false, `on top: ${label} -> ${top} @${Math.round(x)},${Math.round(y)}`); return false; }
  await p.mouse.click(x, y);
  return true;
}
async function noHScroll(p, label) {
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(w[0] <= w[1] + 1, `no horizontal scroll: ${label} (${w[0]} vs ${w[1]})`);
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const runs = [
    { name: 'desk', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'mob', ctx: { ...devices['iPhone 14 Pro'], deviceScaleFactor: 2 } },
  ];
  for (const r of runs) {
    const ctx = await b.newContext(r.ctx);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => problems.push(`[${r.name}] pageerror ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED/.test(m.text())) problems.push(`[${r.name}] console ${m.text()}`); });
    const shot = (n, full = false) => p.screenshot({ path: path.join(OUT, `${r.name}-${n}.png`), fullPage: full });

    // ---------------- home
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1600);
    await shot('01-hero');
    await noHScroll(p, `${r.name} home`);
    await click(p, p.locator('.wa-btn', { hasText: 'Confirm' }), 'hero Confirm');
    await p.waitForTimeout(800);
    ok(await p.getByText('8th floor, Office 835 · Free parking', { exact: false }).isVisible(), 'hero confirm reveals location');
    await p.locator('.card-wa').screenshot({ path: path.join(OUT, `${r.name}-02-hero-confirmed.png`) });
    await p.locator('.hours').scrollIntoViewIfNeeded(); await p.waitForTimeout(1800);
    await p.locator('.hours').screenshot({ path: path.join(OUT, `${r.name}-03-hours.png`) });
    ok(await p.locator('.next-slot b.num').first().textContent().then((t) => !/checking/.test(t)), 'live next free slot loads');
    for (const [sel, n] of [['.treat', '04-treat'], ['.team', '05-team'], ['.clinics', '06-clinics'], ['.faq', '07-faq'], ['.closing', '08-closing'], ['.foot', '09-foot']]) {
      await p.locator(sel).scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
      await p.locator(sel).screenshot({ path: path.join(OUT, `${r.name}-${n}.png`) });
    }
    const names = await p.locator('.team-strip button').count();
    ok(names === 9, `team strip has 9 dentists (${names})`);
    await click(p, p.locator('.team-strip button').nth(2), 'team thumb 3');
    await p.waitForTimeout(500);
    ok((await p.locator('.team-who b').textContent()).includes('Sri'), 'team select shows Dr. Sri');
    await click(p, p.getByRole('button', { name: /reminders work/ }), 'faq question');
    await p.waitForTimeout(500);
    ok(await p.getByText('Tap Confirm and we send the location and floor', { exact: false }).isVisible(), 'faq opens');
    if (r.name === 'mob') {
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
      await click(p, '.burger', 'burger');
      await p.waitForTimeout(600);
      await shot('10-menu');
      await click(p, '.burger', 'burger close');
    }
    await shot('00-home-full', true);

    // ---------------- booking flow
    await p.goto(BASE + '/book', { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    await click(p, p.getByRole('button', { name: 'Teeth cleaning' }), 'service');
    await p.waitForTimeout(900);
    await click(p, p.locator('.branch-pick button').first(), 'branch');
    await p.waitForTimeout(900);
    await p.waitForSelector('.day:not([disabled])');
    await click(p, p.locator('.day:not([disabled])').nth(1), 'day');
    await p.waitForTimeout(900);
    await p.waitForSelector('.slot:not([disabled])');
    await click(p, p.locator('.slot:not([disabled])').nth(r.name === 'desk' ? 3 : 6), 'slot');
    await p.waitForTimeout(400);
    await shot('11-book');
    await noHScroll(p, `${r.name} book`);
    await p.locator('input[autocomplete="name"]').fill(r.name === 'desk' ? 'Maria Santos' : 'Jose Reyes');
    await p.locator('input[type="tel"]').fill(r.name === 'desk' ? '050 123 4567' : '055 765 4321');
    await click(p, r.name === 'desk' ? p.locator('.summary .btn') : p.locator('.mob-bar .btn'), 'confirm booking');
    await p.waitForSelector('.ticket', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(700);
    ok(await p.getByText('You’re booked.').isVisible(), 'booking succeeds');
    await shot('12-booked');
    const manage = await p.locator('a', { hasText: 'Manage booking' }).getAttribute('href').catch(() => null);

    // ---------------- manage page
    if (manage) {
      await p.goto(BASE + manage, { waitUntil: 'networkidle' });
      await p.waitForTimeout(600);
      await shot('13-manage');
      await click(p, p.getByRole('button', { name: 'Reschedule' }), 'reschedule');
      await p.waitForSelector('.ticket .day:not([disabled])');
      await click(p, p.locator('.ticket .day:not([disabled])').nth(2), 'resched day');
      await p.waitForTimeout(500);
      await p.waitForSelector('.ticket .slot:not([disabled])');
      await click(p, p.locator('.ticket .slot:not([disabled])').nth(2), 'resched slot');
      await p.waitForTimeout(800);
      ok(await p.getByText('Moved to', { exact: false }).isVisible(), 'reschedule works');
      await click(p, p.getByRole('button', { name: 'Confirm' }), 'confirm on manage');
      await p.waitForTimeout(800);
      ok(await p.getByText('Confirmed. We sent the location pin', { exact: false }).isVisible(), 'confirm works');
      await shot('14-manage-confirmed');
      await noHScroll(p, `${r.name} manage`);
    }
    await ctx.close();
  }

  // ---------------- clinic dashboard
  for (const r of runs) {
    const ctx = await b.newContext(r.ctx);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => problems.push(`[adm-${r.name}] pageerror ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) problems.push(`[adm-${r.name}] console ${m.text()}`); });
    const shot = (n) => p.screenshot({ path: path.join(OUT, `${r.name}-adm-${n}.png`) });
    await p.goto(BASE + '/clinic', { waitUntil: 'networkidle' });
    await shot('00-login');
    await p.locator('input[type="email"]').fill(EMAIL);
    await p.locator('input[type="password"]').fill(PASS);
    await click(p, p.getByRole('button', { name: 'Sign in' }), 'sign in');
    await p.waitForSelector('.page-h h1');
    await p.waitForTimeout(600);
    await shot('01-today');
    await noHScroll(p, `${r.name} admin today`);

    if (r.name === 'desk') {
      await p.goto(BASE + '/clinic/bookings', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
      await shot('02-bookings');
      await click(p, p.locator('.table tbody tr:has(.b-confirmed), .table tbody tr:has(.b-booked)').first(), 'booking row');
      await p.waitForSelector('.drawer .kv'); await p.waitForTimeout(500);
      await shot('03-booking-drawer');
      await click(p, p.getByRole('button', { name: 'Send 1-day reminder' }), 'send reminder');
      await p.waitForTimeout(900);
      await click(p, p.locator('.drawer').getByRole('button', { name: 'Completed' }), 'mark completed');
      await p.waitForTimeout(900);
      await p.keyboard.press('Escape');
      await p.goto(BASE + '/clinic/messages', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
      await shot('04-messages');
      await p.goto(BASE + '/clinic/groups', { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
      await p.locator('input[type="file"]').setInputFiles(path.join(__dirname, '..', 'web', 'public', 'sample-patients.csv'));
      await p.waitForTimeout(300);
      await click(p, p.getByRole('button', { name: 'Preview groups' }), 'preview import');
      await p.waitForSelector('.import .table', { timeout: 60000 });
      await p.waitForTimeout(400);
      await shot('05-import-preview');
      const tags = await p.locator('.import .table .tag').allTextContents();
      ok(['Braces', 'Fillings', 'Root canal', 'Tooth extraction', 'Teeth cleaning'].every((t) => tags.includes(t)), `rules grouped rows (${[...new Set(tags)].join(', ')})`);
      await click(p, p.getByRole('button', { name: /Import \d+ patients/ }), 'commit import');
      await p.waitForTimeout(1200);
      await shot('06-groups');
      await p.goto(BASE + '/clinic/broadcasts', { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
      await click(p, p.getByRole('button', { name: 'New broadcast' }), 'new broadcast');
      await p.waitForTimeout(500);
      await click(p, p.locator('.drawer .pick-tag', { hasText: 'Teeth cleaning' }), 'pick cleaning group');
      await click(p, p.locator('.drawer .pick-tag', { hasText: 'Braces' }), 'pick braces group');
      await p.waitForTimeout(600);
      await shot('07-compose');
      p.once('dialog', (d) => d.accept());
      await click(p, p.locator('.drawer-f').getByRole('button', { name: 'Send now' }), 'send broadcast');
      await p.waitForTimeout(6000);
      await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
      await shot('08-broadcasts');
      ok(await p.locator('.table tbody tr').count() >= 1, 'broadcast listed');
      for (const [route, n] of [['automations', '09-automations'], ['surveys', '10-surveys'], ['settings', '11-settings'], ['patients', '12-patients']]) {
        await p.goto(BASE + '/clinic/' + route, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
        await shot(n);
      }
    } else {
      await click(p, '.burger-a', 'admin burger'); await p.waitForTimeout(500);
      await shot('02-menu');
      await click(p, p.locator('.side nav a', { hasText: 'Bookings' }), 'nav bookings');
      await p.waitForTimeout(800);
      await shot('03-bookings');
      await noHScroll(p, 'mob admin bookings');
      await p.goto(BASE + '/clinic/broadcasts', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
      await shot('04-broadcasts');
      await noHScroll(p, 'mob admin broadcasts');
    }
    await ctx.close();
  }
  await b.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
})();
