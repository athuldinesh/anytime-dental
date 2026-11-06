# Anytime Dental

Website, online booking and a clinic dashboard for Anytime Dental (Al Rigga, Deira and Barsha Heights, Dubai).

**Patients**
- Book a treatment, clinic and time online. Free slots come from both clinics' real capacity (chairs × 30-minute slots, 10 AM to 9 PM, every day).
- Get WhatsApp messages: a booking confirmation, a reminder **1 day before** and **2 hours before**, both with **Confirm / Reschedule** buttons.
- **Confirm** sends the floor, entrance, directions and a location pin. **Reschedule** sends a link to pick a new time, which resets the reminders.
- Get a **satisfaction survey** link after the visit is marked completed.

**Clinic team** (`/clinic`)
- **Today**: the schedule for both clinics, the reminder queue, the confirmation rate and satisfaction.
- **Bookings**: create, confirm, reschedule, complete, mark no-show or cancel. Send a reminder or survey by hand.
- **Patients**: groups by service (Cleaning, Braces, Fillings and the other 11), plus WhatsApp history per patient.
- **Groups & AI import**: upload old records as a CSV with any column names. Keyword rules (English + Tagalog, e.g. *pasta*, *bunot*, *OP*, *RCT*) place each patient in the right group, and Claude handles anything unclear. You review before saving.
- **Broadcasts**: a WhatsApp bulk sender. Pick groups and a message, then send now or schedule. Each patient gets it once, opted-out patients are skipped, and sending speed is rate-limited.
- **Automations**: automatic broadcasts per service, e.g. a cleaning recall 180 days after the last cleaning, or braces adjustments every 30 days. Checked daily at 10 AM. Patients with an upcoming appointment are skipped.
- **Surveys**: average rating, NPS, comfort and clarity scores, and comments, overall and per clinic.
- **WhatsApp log**: every message in and out with its delivery status. In sandbox mode you can simulate the patient tapping Confirm or Reschedule.
- **Settings**: WhatsApp Cloud API connection, message templates, timing, chairs per clinic, AI key and password.

Patients who reply **STOP** are opted out of broadcasts but still get appointment reminders. **START** re-subscribes them.

## Run locally

```bash
npm run install:all
npm run build
npm start            # http://localhost:9822   ·   dashboard: /clinic
```

On first start an admin account is created. If `ADMIN_PASSWORD` is not set, the generated password is written to `server/data/ADMIN_LOGIN.txt`. Change it under Settings → Your password.

Tests: `npm test` covers reminders, confirm/reschedule, STOP, surveys, slot capacity, automations, import sorting and the webhook signature. `npm run qa` runs the Playwright click-through and saves screenshots to `qa/shots`.

## Deploy

One Node 22 process serves everything. Data lives in SQLite (`DATA_DIR`), so give it a persistent disk.

- **Render:** push this folder to a repository and create a Blueprint from `render.yaml`. Set `PUBLIC_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- **Docker / any VPS:** `docker build -t anytime-dental . && docker run -p 8080:8080 -v anytime:/data -e PUBLIC_URL=https://… anytime-dental`
- Put it behind HTTPS. Meta only calls `https://` webhooks.

## Going live on WhatsApp (Meta Cloud API)

Until this is done the system runs in **sandbox mode**: everything works, and messages appear in the WhatsApp log instead of being sent.

1. In **Meta Business Manager** create (or open) the WhatsApp Business Account and add the clinic's number (+971 55 791 6602 or a new one).
2. In **developers.facebook.com** create an app → add **WhatsApp**. Create a **System User** with a **permanent access token** that has `whatsapp_business_messaging` and `whatsapp_business_management`.
3. In the dashboard → **Settings → WhatsApp**, paste the token, the **Phone number ID**, the WABA ID and the **App secret**. Click **Test connection**.
4. In Meta → WhatsApp → **Configuration**, set the **Callback URL** and **Verify token** shown in Settings, then subscribe to **messages**.
5. **Templates.** WhatsApp only allows approved templates for messages the clinic starts. In Settings → *Reminder & survey messages* and Broadcasts → *Broadcast messages*, open each message and copy the **“Text to submit to Meta”** (variables already numbered {{1}}, {{2}}…). Create the template in Meta:
   - *Reminder, 1 day before* and *Reminder, 2 hours before*: category **Utility**, with two **Quick Reply** buttons, **Confirm** and **Reschedule**, in that order.
   - Booking received, Survey, Cancelled, Rescheduled: **Utility**.
   - Recalls and offers: **Marketing**.
   After approval, paste each template's exact name into **Meta template name**.
6. Switch the mode to **Live** and save.

Replies inside the 24-hour window (the location pin after Confirm, the reschedule link, opt-out confirmations) are sent as normal messages and need no template.

## AI sorting

Add an Anthropic API key in Settings (or set `ANTHROPIC_API_KEY`). Without one, imports use the keyword rules only. The model is `claude-haiku-5-5` by default and can be changed in Settings. Only the treatment and notes text of each row is sent, never names or phone numbers.

## CSV import format

Any of these headers work, in any order: name (or first + last name), phone / mobile / WhatsApp, treatment / service / procedure, notes / remarks, last visit / date. Dates may be DD/MM/YYYY, YYYY-MM-DD or Excel serial numbers. A sample is at `/sample-patients.csv`.
