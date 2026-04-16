require('dotenv').config();
const express = require('express');
const { sendMessage, extractPhone } = require('./whatsapp');
const { getReply } = require('./ai');
const { addItem, listItems, markDone, getHistory, saveHistory, addButcherItem, listButcherItems, markButcherDone } = require('./db');
const { addEvent, listEvents, deleteEvent, updateEvent } = require('./calendar');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/webhook', async (req, res) => {
  console.log('--- Incoming webhook ---');

  // Handle incoming messages from others, and outgoing (for self-testing)
  const messageType = req.body?.typeWebhook;
  const handled = ['incomingMessageReceived', 'outgoingMessageReceived'];
  if (!handled.includes(messageType)) {
    return res.sendStatus(200);
  }

  // Ignore messages older than 30 seconds — prevents backlog replay on reconnect
  const msgTimestamp = req.body?.timestamp;
  if (msgTimestamp && (Date.now() / 1000) - msgTimestamp > 30) {
    console.log(`Skipping old message (${Math.round((Date.now() / 1000) - msgTimestamp)}s ago)`);
    return res.sendStatus(200);
  }

  const phone = extractPhone(req.body);

  // Ignore group chats — only respond to direct messages
  const chatId = req.body?.senderData?.chatId || '';
  if (chatId.endsWith('@g.us')) {
    return res.sendStatus(200);
  }

  const text = req.body?.messageData?.textMessageData?.textMessage || '';
  if (!text) return res.sendStatus(200);

  console.log(`From: ${phone} | Message: "${text}"`);

  try {
    const history = await getHistory(phone);
    const { raw, history: updatedHistory } = await getReply(text, history);

    // Parse JSON from Claude — handle single object or array
    let actions;
    try {
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        actions = JSON.parse(trimmed);
      } else {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('No JSON found');
        actions = [JSON.parse(raw.slice(start, end + 1))];
      }
    } catch {
      // Claude returned non-JSON — send as plain text
      console.error('JSON parse failed. Raw:', raw);
      await saveHistory(phone, updatedHistory);
      await sendMessage(phone, raw);
      return res.sendStatus(200);
    }

    let finalReply = '';
    for (const { action, data, reply } of actions) {
      console.log(`Action: ${action} | Data: ${JSON.stringify(data)}`);
      if (reply) finalReply = reply;

      switch (action) {
        case 'add_shopping':
          await addItem(phone, data.item);
          break;
        case 'list_shopping': {
          const items = await listItems(phone);
          finalReply = items.length
            ? `יש לך ברשימה:\n${items.map((i, n) => `${n + 1}. ${i}`).join('\n')}`
            : 'הרשימה ריקה 🛒';
          break;
        }
        case 'done_shopping':
          await markDone(phone, data.item);
          break;
        case 'update_shopping':
          await markDone(phone, data.old_item);
          await addItem(phone, data.new_item);
          break;
        case 'add_butcher':
          await addButcherItem(phone, data.item);
          break;
        case 'list_butcher': {
          const butcherItems = await listButcherItems(phone);
          finalReply = butcherItems.length
            ? `רשימת הקצב:\n${butcherItems.map((i, n) => `${n + 1}. ${i}`).join('\n')}`
            : 'רשימת הקצב ריקה 🥩';
          break;
        }
        case 'done_butcher':
          await markButcherDone(phone, data.item);
          break;
        case 'update_butcher':
          await markButcherDone(phone, data.old_item);
          await addButcherItem(phone, data.new_item);
          break;
        case 'add_event':
          await addEvent(data);
          break;
        case 'list_events': {
          const events = await listEvents(7);
          if (!events.length) {
            finalReply = 'אין אירועים בשבוע הקרוב 📅';
          } else {
            const lines = events.map(e => {
              const start = e.start.dateTime || e.start.date;
              const d = new Date(start);
              const dateStr = d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
              const timeStr = e.start.dateTime
                ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
                : '';
              return `• ${e.summary} — ${dateStr}${timeStr ? ' ' + timeStr : ''}`;
            });
            finalReply = `האירועים הקרובים:\n${lines.join('\n')}`;
          }
          break;
        }
        case 'delete_event': {
          const deleted = await deleteEvent(data.title);
          finalReply = `מחקתי את "${deleted}" ✓`;
          break;
        }
        case 'update_event': {
          const updated = await updateEvent(data);
          finalReply = `עדכנתי את "${updated}" ✓`;
          break;
        }
      }
    }

    if (!finalReply) finalReply = 'בוצע ✓';

    await saveHistory(phone, updatedHistory);
    await sendMessage(phone, finalReply);
    console.log(`Reply sent: "${finalReply}"`);
  } catch (err) {
    console.error('Error:', err.message);
    await sendMessage(phone, 'סליחה, משהו השתבש 🙏').catch(() => {});
  }

  res.sendStatus(200);
});

app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Family assistant running on port ${PORT}`);
  console.log(`GOOGLE_CLIENT_ID set: ${!!process.env.GOOGLE_CLIENT_ID}`);
  console.log(`GOOGLE_REFRESH_TOKEN set: ${!!process.env.GOOGLE_REFRESH_TOKEN}`);
});
