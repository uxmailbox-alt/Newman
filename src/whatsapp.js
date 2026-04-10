const https = require('https');

const INSTANCE_ID = (process.env.GREENAPI_ID || '').split(/\s/)[0];
const API_TOKEN = (process.env.GREENAPI_TOKEN || '').split(/\s/)[0];

// GreenAPI send message
// Docs: https://green-api.com/en/docs/api/sending/SendMessage/
function sendMessage(phone, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chatId: `${phone}@c.us`,
      message: text,
    });

    const options = {
      hostname: 'api.green-api.com',
      path: `/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Extract sender phone from GreenAPI webhook payload
// GreenAPI sends chatId as "972501234567@c.us" — strip the suffix
function extractPhone(body) {
  const chatId = body?.senderData?.chatId || body?.chatId || '';
  return chatId.replace('@c.us', '');
}

module.exports = { sendMessage, extractPhone };
