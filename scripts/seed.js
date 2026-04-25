const { writeJson } = require('../server/storage');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
for (const name of ['settings.json', 'providers.json', 'jobs.json', 'quotes.json']) {
  const source = path.join(dataDir, name);
  const raw = fs.readFileSync(source, 'utf8');
  writeJson(name, JSON.parse(raw));
}
console.log('Seeded TurfLynk Arkansas quote-ready data.');
