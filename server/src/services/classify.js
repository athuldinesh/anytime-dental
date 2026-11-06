// Turns a clinic's old patient records (CSV export, any column names) into
// patients sorted into service groups. Two passes:
//   1. rules: English + Tagalog keyword match on the treatment / notes text.
//   2. Claude: for rows the rules could not place (or all rows when asked),
//      batched, returning service slugs with a confidence and a short reason.
import { db, getSetting } from '../db.js';
import { normalizePhone, clean } from '../lib/util.js';

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  const delim = (() => { const first = s.split(/\r?\n/)[0] || ''; const c = (ch) => first.split(ch).length; return c(';') > c(',') && c(';') > c('\t') ? ';' : c('\t') > c(',') ? '\t' : ','; })();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const H = {
  name: /^(full ?name|patient( ?name)?|name|client|customer|pangalan)$/i,
  first: /^(first ?name|given ?name)$/i,
  last: /^(last ?name|surname|family ?name)$/i,
  phone: /(phone|mobile|mob|contact|whats ?app|number|tel|cell)/i,
  email: /e-?mail/i,
  treatment: /(treatment|service|procedure|reason|complaint|diagnosis|description|visit type|category|done)/i,
  notes: /(note|remark|comment|history|details)/i,
  date: /(date|last ?visit|visited|appointment|seen)/i,
};

export function mapColumns(header) {
  const idx = {};
  header.forEach((h, i) => {
    const t = String(h).trim();
    for (const [k, re] of Object.entries(H)) if (idx[k] == null && re.test(t)) { idx[k] = i; break; }
  });
  return idx;
}

/** Excel serials, DD/MM/YYYY (UAE default), YYYY-MM-DD, "12 Mar 2025". Returns YYYY-MM-DD or null. */
export function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) { let [a, b, y] = [+m[1], +m[2], +m[3]]; if (y < 100) y += 2000; if (b > 12 && a <= 12) [a, b] = [b, a]; return iso(y, b, a); }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

// ---------- rules ----------
function serviceRules() {
  return db.prepare('SELECT id, slug, name, keywords FROM services ORDER BY sort').all().map((s) => ({
    ...s,
    res: s.keywords.split(',').map((k) => k.trim()).filter(Boolean).map((k) => new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]*')}([^a-z]|$)`, 'i')),
  }));
}

export function ruleClassify(text, rules = serviceRules()) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return [];
  const hits = [];
  for (const s of rules) {
    const n = s.res.filter((re) => re.test(t)).length;
    if (n) hits.push({ slug: s.slug, confidence: Math.min(0.95, 0.75 + n * 0.08), reason: 'Keyword match', by: 'rules' });
  }
  // "clear braces" means aligners, not braces
  if (hits.some((h) => h.slug === 'aligners') && /clear\s*braces|invisalign/.test(t)) return hits.filter((h) => h.slug !== 'braces');
  return hits;
}

// ---------- Claude ----------
export function aiReady() {
  const a = getSetting('ai', {});
  return !!(a.api_key || process.env.ANTHROPIC_API_KEY);
}

async function claudeBatch(items, services) {
  const a = getSetting('ai', {});
  const key = a.api_key || process.env.ANTHROPIC_API_KEY;
  const catalog = services.map((s) => `${s.slug}: ${s.name}`).join('\n');
  const lines = items.map((it) => `${it.i}\t${it.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: a.model || 'claude-haiku-5-5',
      max_tokens: 4000,
      system: 'You sort dental clinic patient records into treatment groups. Records come from a clinic in Dubai with a Filipino team, so notes mix English, Tagalog and clinical shorthand (e.g. "OP" = oral prophylaxis = cleaning, "pasta" = filling, "bunot" = extraction, "RCT" = root canal, "adj" = braces adjustment). Only use the service slugs given. If a record says nothing about treatment, return an empty list. Answer with JSON only.',
      messages: [{
        role: 'user',
        content: `Services:\n${catalog}\n\nRecords (index<TAB>text):\n${lines}\n\nReturn a JSON array, one object per record: {"i": index, "services": [slug,...], "confidence": 0..1, "reason": "few words"}`,
      }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Claude API HTTP ${res.status}`);
  const txt = (data.content || []).map((c) => c.text || '').join('');
  const m = txt.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Claude returned no JSON');
  return JSON.parse(m[0]);
}

/**
 * rows: [{ text }] → [{ services:[{slug, confidence, reason, by}] }]
 * mode: 'auto' (AI only where rules fail), 'all' (AI on every row), 'rules'
 */
export async function classifyRows(rows, mode = 'auto') {
  const rules = serviceRules();
  const out = rows.map((r) => ({ services: ruleClassify(r.text, rules) }));
  const useAi = mode !== 'rules' && aiReady();
  let aiError = null, aiUsed = 0;
  if (useAi) {
    const todo = rows.map((r, i) => ({ i, text: r.text || '' })).filter((x) => x.text.trim() && (mode === 'all' || !out[x.i].services.length));
    const slugs = new Set(rules.map((r) => r.slug));
    for (let k = 0; k < todo.length; k += 40) {
      const batch = todo.slice(k, k + 40);
      try {
        const res = await claudeBatch(batch, rules);
        for (const r of res) {
          const target = out[r.i];
          if (!target) continue;
          const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0.7));
          for (const slug of (r.services || []).filter((s) => slugs.has(s))) {
            const ex = target.services.find((s) => s.slug === slug);
            if (ex) { ex.confidence = Math.max(ex.confidence, conf); ex.by = 'rules+ai'; }
            else target.services.push({ slug, confidence: conf, reason: clean(r.reason, 120) || 'AI', by: 'ai' });
          }
        }
        aiUsed += batch.length;
      } catch (e) { aiError = e.message; break; }
    }
  }
  return { results: out, aiUsed, aiError, aiAvailable: aiReady() };
}

/** Builds the preview for an uploaded CSV. Nothing is written. */
export async function previewImport(csvText, mode) {
  const grid = parseCsv(csvText);
  if (grid.length < 2) throw Object.assign(new Error('The file needs a header row and at least one patient.'), { status: 400 });
  const header = grid[0];
  const col = mapColumns(header);
  if (col.phone == null) throw Object.assign(new Error('Could not find a phone / mobile column in the file.'), { status: 400 });
  const rows = grid.slice(1).slice(0, 20000).map((r, n) => {
    const get = (k) => (col[k] != null ? String(r[col[k]] ?? '').trim() : '');
    const name = get('name') || [get('first'), get('last')].filter(Boolean).join(' ');
    const treatment = [get('treatment'), get('notes')].filter(Boolean).join(' · ');
    const phone = normalizePhone(get('phone'));
    return { line: n + 2, name: clean(name, 120), raw_phone: get('phone'), phone, email: get('email'), date: parseDate(get('date')), text: treatment };
  });
  const { results, aiUsed, aiError, aiAvailable } = await classifyRows(rows, mode);
  const existing = new Set(db.prepare('SELECT phone FROM patients').all().map((p) => p.phone));
  const seen = new Set();
  const items = rows.map((r, i) => {
    let issue = null;
    if (!r.phone) issue = 'Invalid phone';
    else if (seen.has(r.phone)) issue = 'Duplicate in file';
    if (r.phone) seen.add(r.phone);
    return { ...r, services: results[i].services, exists: !!(r.phone && existing.has(r.phone)), issue };
  });
  return {
    columns: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, header[v]])),
    items, aiUsed, aiError, aiAvailable,
    summary: {
      rows: items.length,
      valid: items.filter((x) => !x.issue).length,
      grouped: items.filter((x) => !x.issue && x.services.length).length,
      ungrouped: items.filter((x) => !x.issue && !x.services.length).length,
      invalid: items.filter((x) => x.issue).length,
    },
  };
}
