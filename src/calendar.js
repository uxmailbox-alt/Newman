const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function getAuth() {
  let client_id, client_secret, redirect_uri, refresh_token;

  // Railway: load from individual env vars
  if (process.env.GOOGLE_CLIENT_ID) {
    client_id     = process.env.GOOGLE_CLIENT_ID.trim();
    client_secret = process.env.GOOGLE_CLIENT_SECRET.trim();
    redirect_uri  = 'http://localhost';
    refresh_token = process.env.GOOGLE_REFRESH_TOKEN.trim();
  } else {
    // Local: load from files
    const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '../credentials.json')));
    const token = JSON.parse(fs.readFileSync(path.join(__dirname, '../token.json')));
    client_id     = creds.installed.client_id;
    client_secret = creds.installed.client_secret;
    redirect_uri  = creds.installed.redirect_uris[0];
    refresh_token = token.refresh_token;
  }

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
  oAuth2Client.setCredentials({ refresh_token });
  return oAuth2Client;
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuth() });
}

// Add an event to the primary (shared) calendar
async function addEvent({ title, date, time, person }) {
  const calendar = getCalendar();

  // Build start/end datetime
  // date: "2026-04-11", time: "16:00" (optional)
  let start, end;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    const endHour = String(h + 1).padStart(2, '0');
    const mins = String(m || 0).padStart(2, '0');
    start = { dateTime: `${date}T${String(h).padStart(2, '0')}:${mins}:00`, timeZone: 'Asia/Jerusalem' };
    end   = { dateTime: `${date}T${endHour}:${mins}:00`, timeZone: 'Asia/Jerusalem' };
  } else {
    start = { date };
    end   = { date };
  }

  const eventBody = {
    summary: person ? `${title} (${person})` : title,
    start,
    end,
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 60 }],
    },
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    resource: eventBody,
  });

  return res.data;
}

// List upcoming events (next 7 days by default)
async function listEvents(days = 7) {
  const calendar = getCalendar();
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + days);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  return res.data.items || [];
}

// Delete an event by searching its title
async function deleteEvent(title) {
  const calendar = getCalendar();
  const events = await listEvents(30);
  const match = events.find(e =>
    e.summary && e.summary.toLowerCase().includes(title.toLowerCase())
  );
  if (!match) throw new Error(`לא מצאתי אירוע בשם "${title}"`);
  await calendar.events.delete({ calendarId: 'primary', eventId: match.id });
  return match.summary;
}

module.exports = { addEvent, listEvents, deleteEvent };
