// Meta WhatsApp Cloud API webhook: verification handshake + inbound messages and delivery statuses.
import { Router, raw } from 'express';
import crypto from 'node:crypto';
import { waConfig } from '../services/whatsapp.js';
import { handleInbound, statusUpdate } from '../services/flows.js';

export const webhookRouter = Router();

webhookRouter.get('/', (req, res) => {
  const c = waConfig();
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] && req.query['hub.verify_token'] === c.verify_token) {
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

webhookRouter.post('/', raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const c = waConfig();
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (c.app_secret) {
    const sig = String(req.get('x-hub-signature-256') || '');
    const want = 'sha256=' + crypto.createHmac('sha256', c.app_secret).update(body).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.sendStatus(401);
  }
  res.sendStatus(200); // acknowledge fast; Meta retries on slow responses
  let data;
  try { data = JSON.parse(body.toString('utf8')); } catch { return; }
  for (const entry of data.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((ct) => [ct.wa_id, ct.profile?.name || '']));
      for (const m of v.messages || []) {
        let text = '', payload = '';
        if (m.type === 'text') text = m.text?.body || '';
        else if (m.type === 'button') { payload = m.button?.payload || ''; text = m.button?.text || ''; }
        else if (m.type === 'interactive') {
          const r = m.interactive?.button_reply || m.interactive?.list_reply;
          payload = r?.id || ''; text = r?.title || '';
        } else text = `[${m.type}]`;
        try { await handleInbound({ from: m.from, text, payload, wa_id: m.id, name: names[m.from] }); }
        catch (e) { console.error('[webhook] inbound failed', e); }
      }
      for (const s of v.statuses || []) {
        statusUpdate({ wa_id: s.id, status: s.status, error: s.errors?.[0] ? `${s.errors[0].title} (${s.errors[0].code})` : null });
      }
    }
  }
});
