const http = require('http');

// CONFIGURATION
const SERVER = 'http://localhost:297';
const USER_ID = 'usr_xxx_ID';
const AVATAR_ID = 'avtr_yyy_ID';
const PIN = '1111'; // Use your actual PIN
const TOKEN = 'abcde12345'; // Use your actual active token (or DASHBOARD if on local)

const url = `${SERVER}/change/${USER_ID}/${AVATAR_ID}/${PIN}/${TOKEN}`;

console.log(`Triggering change: ${url}`);

http.get(url, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${body}`);
    process.exit(0);
  });
}).on('error', (e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
