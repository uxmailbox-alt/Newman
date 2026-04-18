require('dotenv').config();
const express = require('express');
const { sendMessage, extractPhone } = require('./whatsapp');
const { getReply } = require('./ai');
const {
  getMember, createFamily, addMember,
  getFacts, saveFact, deleteFact,
  addItem, listItems, markDone,
  addButcherItem, listButcherItems, markButcherDone, whoAdded,
  getHistory, saveHistory,
} = require('./db');
const { addEvent, listEvents, deleteEvent, updateEvent } = require('./calendar');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

function formatListLines(items) {
  return items.map((row, n) => `${n + 1}. ${row.item}`).join('\n');
}

app.post('/webhook', async (req, res) => {
  console.log('--- Incoming webhook ---');

  const messageType = req.body?.typeWebhook;
  const handled = ['incomingMessageReceived', 'outgoingMessageReceived'];
  if (!handled.includes(messageType)) return res.sendStatus(200);

  const msgTimestamp = req.body?.timestamp;
  if (msgTimestamp && (Date.now() / 1000) - msgTimestamp > 30) {
    console.log(`Skipping old message (${Math.round((Date.now() / 1000) - msgTimestamp)}s ago)`);
    return res.sendStatus(200);
  }

  const phone = extractPhone(req.body);
  const chatId = req.body?.senderData?.chatId || '';
  if (chatId.endsWith('@g.us')) return res.sendStatus(200);

  const text = req.body?.messageData?.textMessageData?.textMessage || '';
  if (!text) return res.sendStatus(200);

  console.log(`From: ${phone} | Message: "${text}"`);

  try {
    // Resolve family context
    let member = await getMember(phone);
    const facts = member ? await getFacts(member.family_id) : [];
    const context = { member, facts };

    const history = await getHistory(phone);
    const { raw, history: updatedHistory } = await getReply(text, history, context);

    // Parse JSON — single object or array
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
      console.error('JSON parse failed. Raw:', raw);
      await saveHistory(phone, updatedHistory);
      await sendMessage(phone, raw);
      return res.sendStatus(200);
    }

    let finalReply = '';
    for (const { action, data, reply } of actions) {
      console.log(`Action: ${action} | Data: ${JSON.stringify(data)}`);
      if (reply) finalReply = reply;

      // Gate family-scoped actions behind registration
      const needsFamily = !['create_family', 'chat', 'clarify'].includes(action);
      if (needsFamily && !member) {
        finalReply = 'היי! קודם בוא נכיר. כתוב לי למשל: "צור משפחה בשם גולן, אני יאיר"';
        continue;
      }

      const familyId = member?.family_id;
      const myName = member?.member_name;

      switch (action) {
        case 'create_family': {
          if (member) { finalReply = 'כבר אתה חלק ממשפחה ✓'; break; }
          const fid = await createFamily(data.family_name, phone, data.member_name);
          member = { phone, family_id: fid, member_name: data.member_name };
          finalReply = reply || `נוצרה משפחת ${data.family_name}, ברוך הבא ${data.member_name} 👋`;
          break;
        }
        case 'add_member': {
          await addMember(familyId, data.phone, data.member_name);
          finalReply = `נוסף ${data.member_name} למשפחה ✓`;
          break;
        }
        case 'remember_fact': {
          await saveFact(familyId, data.key, data.value);
          break;
        }
        case 'forget_fact': {
          await deleteFact(familyId, data.key);
          finalReply = `שכחתי את "${data.key}" ✓`;
          break;
        }
        case 'list_facts': {
          const rows = await getFacts(familyId);
          finalReply = rows.length
            ? `מה שאני זוכר:\n${rows.map(f => `• ${f.key}: ${f.value}`).join('\n')}`
            : 'עוד לא שמרתי שום דבר 📝';
          break;
        }
        case 'who_added': {
          const row = await whoAdded(familyId, data.item);
          if (!row) {
            finalReply = `לא מצאתי את "${data.item}" ברשימות`;
          } else if (!row.added_by) {
            finalReply = `"${row.item}" נוסף בלי לדעת מי`;
          } else {
            finalReply = `${row.added_by} הוסיפ/ה את "${row.item}"`;
          }
          break;
        }
        case 'add_shopping':
          await addItem(familyId, data.item, myName);
          break;
        case 'list_shopping': {
          const items = await listItems(familyId);
          finalReply = items.length
            ? `יש לכם ברשימה:\n${formatListLines(items)}`
            : 'הרשימה ריקה 🛒';
          break;
        }
        case 'done_shopping':
          await markDone(familyId, data.item);
          break;
        case 'update_shopping':
          await markDone(familyId, data.old_item);
          await addItem(familyId, data.new_item, myName);
          break;
        case 'add_butcher':
          await addButcherItem(familyId, data.item, myName);
          break;
        case 'list_butcher': {
          const items = await listButcherItems(familyId);
          finalReply = items.length
            ? `רשימת הקצב:\n${formatListLines(items)}`
            : 'רשימת הקצב ריקה 🥩';
          break;
        }
        case 'done_butcher':
          await markButcherDone(familyId, data.item);
          break;
        case 'update_butcher':
          await markButcherDone(familyId, data.old_item);
          await addButcherItem(familyId, data.new_item, myName);
          break;
        case 'add_event':
          await addEvent(data);
          break;
        case 'list_events': {
          const events = await listEvents(data);
          if (!events.length) {
            finalReply = 'אין אירועים בטווח המבוקש 📅';
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
            finalReply = `האירועים:\n${lines.join('\n')}`;
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
