# Plan: Family Life Assistant (WhatsApp + Hebrew)

## Context

Yair's family runs on fragmented logistics: WhatsApp threads, school apps, mental load on one parent. The PRD defines a conversational WhatsApp assistant in Hebrew that centralizes scheduling, shopping, and coordination. The key insight from the PRD: this is a behavior problem, not a tooling problem. The assistant must feel like a partner, not a system.

This is a **family prototype** (personal use, not a product launch). Build in small validated steps. First prove the pipe works, then prove one use case works, then expand.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js (CommonJS) | Simple, fast to ship |
| WhatsApp | GreenAPI REST + webhooks | Works with personal number, no business verification |
| AI | Claude API (`claude-sonnet-4-6`) | Conversation + Hebrew NLP |
| Database | Supabase (PostgreSQL) | Visual dashboard to inspect data — easier to debug than SQLite |
| Scheduler | `node-cron` | Daily summary + reminders (added later) |
| Local testing | ngrok | Exposes localhost to a public URL so GreenAPI webhook works before any deploy |
| Hosting | Railway (later) | 24/7 server with public URL. Only needed after shopping list MVP is validated |

> **SQLite vs Supabase:** SQLite is a file on disk — zero dependencies, works offline, but you can only inspect it via terminal SQL. Supabase gives you a browser dashboard to see exactly what got saved. For a prototype where you're debugging behavior, the dashboard saves time. Free tier is generous (500MB, no credit card needed).

> **What "Hosting" means:** Your laptop can't receive GreenAPI webhooks — it has no public URL and isn't always on. For local testing, `ngrok` creates a temporary tunnel (`https://abc123.ngrok.io → localhost:3000`). For permanent use, Railway runs your server in the cloud 24/7. Phase 0 uses ngrok. Deploy to Railway only after the shopping list MVP is validated.

**Project path:** `/Users/yair.golan/Documents/family-assistant/`
(No special characters — see decisions.md rule)

---

## Architecture

```
WhatsApp (user) 
  → GreenAPI webhook 
    → Express server (src/index.js)
      → Claude API (conversation + intent extraction)
        → Supabase DB (events, shopping, history)
      → GreenAPI send API (reply to user)

node-cron (background) — added in Phase 3+
  → daily summary at 7:00 AM
  → event reminders 1 hour before
```

---

## File Structure

```
family-assistant/
├── src/
│   ├── index.js          # Express server + webhook route
│   ├── whatsapp.js       # GreenAPI client (send messages)
│   ├── ai.js             # Claude conversation manager
│   ├── db.js             # Supabase client + queries
│   └── scheduler.js      # Cron jobs (added later)
├── .env                  # GREENAPI_ID, GREENAPI_TOKEN, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
├── package.json
└── railway.toml          # added before Railway deploy
```

---

## Database Schema

Tables created via Supabase dashboard (not code). Start with just `shopping` for MVP.

```sql
-- Shopping (MVP — create this first)
CREATE TABLE shopping (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT,
  item TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events (Phase 2+)
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT,
  title TEXT NOT NULL,
  event_date DATE,
  event_time TIME,
  person TEXT,
  reminded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation history (Phase 1+)
CREATE TABLE conversations (
  phone TEXT PRIMARY KEY,
  history JSONB,           -- array of {role, content}
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Claude Prompt Design

**System prompt** (Hebrew-aware, intent extractor):
```
You are a Hebrew family assistant on WhatsApp. 
Parse the user's message and return valid JSON only — no prose, no markdown.

Return format:
{
  "action": "add_shopping" | "list_shopping" | "done_shopping" | "chat",
  "data": { ... action-specific fields ... },
  "reply": "short friendly Hebrew reply (max 2 lines)"
}

Tone: short, warm, zero jargon. Use emojis sparingly.
```

**Conversation memory:** last 10 messages per phone number stored in Supabase, passed to Claude as context.

---

## Build Phases

### Phase 0 — Scaffolding: Validate the Pipe (1 hr)
Goal: prove every piece of the system talks to each other before writing any real logic. One step at a time.

1. Create `/Users/yair.golan/Documents/family-assistant/`, init npm, install `express` + `dotenv`
2. Create GreenAPI account at green-api.com, connect your WhatsApp number, copy `GREENAPI_ID` + `GREENAPI_TOKEN`
3. Install ngrok (`brew install ngrok`), run `ngrok http 3000`, copy the `https://...ngrok.io` URL
4. In GreenAPI dashboard: set webhook URL to `https://...ngrok.io/webhook`
5. Create `src/index.js`: Express server on port 3000, POST `/webhook` that logs `req.body` to terminal
6. Send "שלום" from WhatsApp → confirm the log appears in terminal
7. Add hardcoded reply: call GreenAPI send API to reply "קיבלתי" back to sender
8. Send "שלום" again → confirm "קיבלתי" arrives in WhatsApp

**Checkpoint:** Full pipe validated. Message in → server receives → server replies. No Claude, no DB.

---

### Phase 1 — Add Claude (1 hr)
Goal: replace hardcoded reply with live Claude response in Hebrew.

1. Install `@anthropic-ai/sdk`
2. Create `src/ai.js`: call Claude with minimal system prompt, return text
3. Wire: webhook → ai.js → GreenAPI reply
4. System prompt (simple): `"You are a friendly Hebrew assistant. Reply in short, natural Hebrew."`

**Checkpoint:** Send any message → Claude responds in Hebrew. The assistant feels alive.

---

### MVP Phase — Shopping List Only (3 hrs)
Goal: one complete use case, end-to-end, before building anything else.

**Why shopping list first:** simplest flow — no dates, no time parsing, no reminders. Proves the data layer works.

1. Create Supabase project at supabase.com, get `SUPABASE_URL` + `SUPABASE_ANON_KEY`
2. Create `shopping` table in Supabase dashboard (SQL above)
3. Install `@supabase/supabase-js`, create `src/db.js` with `addItem`, `listItems`, `markDone` functions
4. Upgrade Claude system prompt to return structured JSON (shopping actions only for now)
5. In `src/index.js`: parse JSON from Claude, route to correct db function, send `reply` field back
6. Implement `add_shopping`: insert row → reply "קיבלתי, הוספתי חלב 👍"
7. Implement `list_shopping`: fetch pending → reply formatted list
8. Implement `done_shopping`: update row to done → reply "סבבה, הסרתי ✓"

**Checkpoint flows — test all three in WhatsApp:**
```
"תוסיף חלב לרשימה"   → "קיבלתי, הוספתי חלב 👍"
"מה ברשימת הקניות?"  → "יש לך: חלב, לחם, גבינה"
"קניתי חלב"          → "סבבה, הסרתי את החלב ✓"
```
Open Supabase dashboard and confirm rows are actually being saved/updated.

---

### Phase 2 — Events + Reminders (next sprint)
Once shopping list is stable and used by family in real life:
- Create `events` table in Supabase
- Add event actions to Claude prompt
- Hebrew date/time parsing (מחר, יום ראשון, ב-4)
- `scheduler.js` with node-cron: reminder 1 hour before events

### Phase 3 — Daily Summary + Proactive (next sprint)
- 07:00 cron: auto-send today's events + pending shopping
- Smart nudges based on patterns

### Phase 4 — Deploy to Railway (when ready for 24/7)
- Create Railway project, push code via GitHub
- Set all env vars in Railway dashboard
- Update GreenAPI webhook URL to Railway domain
- No SQLite volume needed — Supabase is already in the cloud
- **Checkpoint:** Everything works without ngrok running

---

## Key Decisions

1. **GreenAPI over Twilio/Meta**: works with personal WhatsApp number, no business verification needed, free tier. Webhook payload format is different from standard — adapter needed in `whatsapp.js`.

2. **Supabase over SQLite**: visual dashboard for debugging during prototype phase. No extra config for Railway deploy since Supabase is already hosted.

3. **Claude JSON mode**: Claude returns structured JSON on every turn. Express parses it and routes to DB. If JSON parse fails, fall back to sending the raw text as reply.

4. **Phone number = family ID**: MVP uses sender's phone as family identifier. Multi-user (spouse, kids) is v2.

5. **Shopping list first**: validate the full data layer with the simplest use case before adding date/time complexity of events.

---

## Files to Create (Phase 0 + 1 + MVP)

- `/Users/yair.golan/Documents/family-assistant/src/index.js`
- `/Users/yair.golan/Documents/family-assistant/src/whatsapp.js`
- `/Users/yair.golan/Documents/family-assistant/src/ai.js`
- `/Users/yair.golan/Documents/family-assistant/src/db.js`
- `/Users/yair.golan/Documents/family-assistant/package.json`
- `/Users/yair.golan/Documents/family-assistant/.env` (template only, no secrets)

---

## Out of Scope Until After MVP

- Events and reminders
- Daily summary cron
- Multi-user family registration
- School homework tracking
- Holiday planning
- Conflict detection
- Railway deploy
