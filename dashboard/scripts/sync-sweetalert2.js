// scripts/sync-sweetalert2.js
//
// Kopiert die SweetAlert2-Dist-Dateien aus node_modules in
// src/public/vendor/, damit das Frontend die Dialoge selbst ausliefert
// (kein CDN -> funktioniert offline und mit strenger CSP).
//
// Die kopierten Dateien liegen im Repo. Nur nach einem Versions-Update
// von "sweetalert2" erneut ausführen:  npm run sync:sweetalert2

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'sweetalert2', 'dist');
const dest = path.join(__dirname, '..', 'src', 'public', 'vendor', 'sweetalert2');

if (!fs.existsSync(src)) {
  console.error('sweetalert2 nicht installiert - "npm install" ausführen.');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const file of ['sweetalert2.min.js', 'sweetalert2.min.css']) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}

const version = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'sweetalert2', 'package.json'), 'utf8')
).version;
console.log(`SweetAlert2 ${version} nach src/public/vendor/sweetalert2/ kopiert.`);
