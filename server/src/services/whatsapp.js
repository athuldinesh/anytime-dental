// WhatsApp transport. Two modes:
//  - "cloud":   Meta WhatsApp Business Cloud API (graph.facebook.com). Production.
//  - "sandbox": nothing leaves the server; messages land in the dashboard outbox
//               where staff can preview them and simulate the patient's reply.
// Business-initiated messages (reminders, surveys, broadcasts) must use a
// Meta-approved template; free-form text/location is only allowed inside the
// 24-hour window that opens when the patient messages or taps a button.
import { getSetting } from '../db.js';
import { token } from '../lib/util.js';

export function waConfig() {
  return getSetting('whatsapp', {});
}

export function liveReady(c = waConfig()) {
  return c.mode === 'cloud' && !!c.token && !!c.phone_number_id;
}

/**
 * @param {object} m
 * @param {string} m.to          E.164 digits, no "+"
 * @param {string} m.text        rendered text (always stored; used as-is for session text)
 * @param {{name:string, lang:string, params:string[], buttons?:{payload:string}[]}} [m.template]
 * @param {{lat:number,lng:number,name:string,address:string}} [m.location]
 * @returns {Promise<{provider:string, wa_id:string|null, status:string, error?:string}>}
 */
export async function transport(m) {
  const c = waConfig();
  if (c.mode !== 'cloud') return { provider: 'sandbox', wa_id: 'sbx_' + token(9), status: 'sent' };
  if (!liveReady(c)) return { provider: 'cloud', wa_id: null, status: 'failed', error: 'WhatsApp Cloud API is selected but the access token or phone number ID is missing (Settings → WhatsApp).' };

  let payload;
  if (m.template) {
    const components = [];
    if (m.template.params?.length) {
      components.push({ type: 'body', parameters: m.template.params.map((t) => ({ type: 'text', text: t || '-' })) });
    }
    (m.template.buttons || []).forEach((b, i) => {
      components.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: b.payload }] });
    });
    payload = { type: 'template', template: { name: m.template.name, language: { code: m.template.lang || 'en' }, components } };
  } else if (m.location) {
    payload = { type: 'location', location: { latitude: m.location.lat, longitude: m.location.lng, name: m.location.name, address: m.location.address } };
  } else {
    payload = { type: 'text', text: { body: m.text.slice(0, 4096), preview_url: /https?:\/\//.test(m.text) } };
  }

  const url = `https://graph.facebook.com/${c.api_version || 'v21.0'}/${c.phone_number_id}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: m.to, ...payload }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data?.error;
      return { provider: 'cloud', wa_id: null, status: 'failed', error: e ? `${e.message}${e.error_data?.details ? ' — ' + e.error_data.details : ''} (code ${e.code})` : `HTTP ${res.status}` };
    }
    return { provider: 'cloud', wa_id: data?.messages?.[0]?.id || null, status: 'sent' };
  } catch (err) {
    return { provider: 'cloud', wa_id: null, status: 'failed', error: `Network error: ${err.message}` };
  }
}

/** Checks the configured credentials against the Graph API without sending anything. */
export async function verifyCredentials() {
  const c = waConfig();
  if (!c.token || !c.phone_number_id) return { ok: false, error: 'Add the access token and phone number ID first.' };
  try {
    const res = await fetch(`https://graph.facebook.com/${c.api_version || 'v21.0'}/${c.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`, {
      headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    return { ok: true, number: data.display_phone_number, name: data.verified_name, quality: data.quality_rating };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
