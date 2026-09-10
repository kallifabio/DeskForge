// scripts/sync-fontawesome.js
//
// Kopiert die benötigten Font-Awesome-Dateien aus node_modules in
// src/public/vendor/, damit das Frontend die Icons selbst ausliefert
// (kein CDN -> funktioniert offline und mit strenger CSP).
//
// Die kopierten Dateien liegen im Repo. Dieses Skript nur nach einem
// Versions-Update von @fortawesome/fontawesome-free erneut ausführen:
//   npm run sync:fontawesome

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free');
const dest = path.join(__dirname, '..', 'src', 'public', 'vendor', 'fontawesome');

if (!fs.existsSync(src)) {
  console.error('@fortawesome/fontawesome-free nicht installiert - "npm install" ausführen.');
  process.exit(1);
}

fs.mkdirSync(path.join(dest, 'css'), { recursive: true });
fs.mkdirSync(path.join(dest, 'webfonts'), { recursive: true });

fs.copyFileSync(path.join(src, 'css', 'all.min.css'), path.join(dest, 'css', 'all.min.css'));
for (const file of fs.readdirSync(path.join(src, 'webfonts'))) {
  fs.copyFileSync(path.join(src, 'webfonts', file), path.join(dest, 'webfonts', file));
}

const version = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
console.log(`Font Awesome ${version} nach src/public/vendor/fontawesome/ kopiert.`);
