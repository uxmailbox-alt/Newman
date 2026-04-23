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

  console.log(`Calendar event created: id=${res.data.id} summary="${res.data.summary}" start=${JSON.stringify(res.data.start)}`);
  return res.data;
}

// List events with optional date range and keyword filter
async function listEvents({ days = 7, date_from = null, date_to = null, tonight = false, keyword = null } = {}) {
  const calendar = getCalendar();
  const tz = 'Asia/Jerusalem';

  let timeMin, timeMax;

  if (date_from) {
    timeMin = new Date(`${date_from}T00:00:00`);
  } else {
    timeMin = new Date();
  }

  if (date_to) {
    timeMax = new Date(`${date_to}T23:59:59`);
  } else {
    timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + days);
  }

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  let events = res.data.items || [];

  if (tonight) {
    events = events.filter(e => {
      if (!e.start.dateTime) return false;
      const hour = new Date(e.start.dateTime).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz });
      return parseInt(hour) >= 17;
    });
  }

  if (keyword) {
    const kw = keyword.toLowerCase();
    events = events.filter(e => e.summary && e.summary.toLowerCase().includes(kw));
  }

  return events;
}

// Fuzzy match: check if all words in query appear in the event title
function fuzzyMatch(eventTitle, query) {
  const title = eventTitle.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w => title.includes(w));
}

// Delete an event by searching its title
async function deleteEvent(title) {
  const calendar = getCalendar();
  const events = await listEvents({ days: 30 });
  const match = events.find(e => e.summary && fuzzyMatch(e.summary, title));
  if (!match) throw new Error(`לא מצאתי אירוע בשם "${title}"`);
  await calendar.events.delete({ calendarId: 'primary', eventId: match.id });
  return match.summary;
}

// Update an event's time/date by searching its title
async function updateEvent({ title, date, time }) {
  const calendar = getCalendar();
  const events = await listEvents({ days: 30 });
  const match = events.find(e => e.summary && fuzzyMatch(e.summary, title));
  if (!match) throw new Error(`לא מצאתי אירוע בשם "${title}"`);

  const existingStart = match.start.dateTime || match.start.date;
  const existingDate = existingStart.slice(0, 10); // YYYY-MM-DD
  const resolvedDate = date || existingDate;

  let start, end;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    const endHour = String(h + 1).padStart(2, '0');
    const mins = String(m || 0).padStart(2, '0');
    start = { dateTime: `${resolvedDate}T${String(h).padStart(2, '0')}:${mins}:00`, timeZone: 'Asia/Jerusalem' };
    end   = { dateTime: `${resolvedDate}T${endHour}:${mins}:00`, timeZone: 'Asia/Jerusalem' };
  } else {
    start = { date: resolvedDate };
    end   = { date: resolvedDate };
  }

  await calendar.events.patch({
    calendarId: 'primary',
    eventId: match.id,
    resource: { start, end },
  });

  return match.summary;
}

module.exports = { addEvent, listEvents, deleteEvent, updateEvent };
