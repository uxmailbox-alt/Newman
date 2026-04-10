// Run once: node scripts/authorize.js
// Opens a browser URL, you paste the code, token.json is saved.

const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH = path.join(__dirname, '../token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const { client_id, client_secret, redirect_uris } = JSON.parse(
  fs.readFileSync(CREDENTIALS_PATH)
).installed;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the code from the browser here: ', async (code) => {
  rl.close();
  const { tokens } = await oAuth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log('\ntoken.json saved. Authorization complete.');
});
