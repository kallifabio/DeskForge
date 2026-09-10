const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadAccess, parseGroupsHeader } = require('../src/access');

const CONFIG = { proxmox: { templateVmid: 9000 }, defaultMaxConcurrent: 1 };

function tmpFile(obj) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vdi-access-')), 'access.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('ohne Datei: genau ein implizites Template "standard"', () => {
  const a = loadAccess(path.join(os.tmpdir(), 'gibtsnicht-xyz.json'), CONFIG);
  assert.deepEqual(a.templateNames, ['standard']);
  assert.equal(a.defaultTemplate(), 'standard');
  assert.equal(a.templateVmid('standard'), 9000);
  assert.equal(a.fromFile, false);
  // ohne Gruppenregel: Default-Kontingent
  assert.equal(a.resolveForGroups([]).maxConcurrent, 1);
  assert.equal(a.canUseTemplate([], 'standard'), true);
  assert.equal(a.canUseTemplate([], 'dev'), false);
});

test('mit Datei: Gruppenregeln, Wildcard-Templates, Kontingent-Maximum', () => {
  const p = tmpFile({
    templates: {
      standard: { templateVmid: 9000, label: 'Standard', default: true },
      dev: { templateVmid: 9001, label: 'Dev' },
    },
    groups: {
      'deskforge-admins': { templates: ['*'], maxConcurrent: 10 },
      'deskforge-dev': { templates: ['standard', 'dev'], maxConcurrent: 2 },
      '*': { templates: ['standard'], maxConcurrent: 1 },
    },
  });
  const a = loadAccess(p, CONFIG);

  assert.equal(a.fromFile, true);
  assert.deepEqual(a.templateNames.sort(), ['dev', 'standard']);
  assert.equal(a.templateVmid('dev'), 9001);

  // fremde Gruppe -> "*"-Regel
  assert.equal(a.canUseTemplate(['irgendwas'], 'dev'), false);
  assert.equal(a.resolveForGroups(['irgendwas']).maxConcurrent, 1);

  // dev-Gruppe darf dev, Kontingent 2
  assert.equal(a.canUseTemplate(['deskforge-dev'], 'dev'), true);
  assert.equal(a.resolveForGroups(['deskforge-dev']).maxConcurrent, 2);

  // admins: alle Templates, Kontingent-Maximum gewinnt bei Mehrfachgruppe
  assert.equal(a.canUseTemplate(['deskforge-admins'], 'dev'), true);
  assert.equal(a.resolveForGroups(['deskforge-dev', 'deskforge-admins']).maxConcurrent, 10);

  // Template-Auswahl fürs Dashboard
  const list = a.templatesForGroups(['deskforge-dev']).map((t) => t.name).sort();
  assert.deepEqual(list, ['dev', 'standard']);
});

test('kaputte Datei -> Defaults statt Absturz', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vdi-access-')), 'access.json');
  fs.writeFileSync(p, '{ kaputt');
  const a = loadAccess(p, CONFIG, { error() {} });
  assert.deepEqual(a.templateNames, ['standard']);
});

test('parseGroupsHeader', () => {
  assert.deepEqual(parseGroupsHeader('a, b ,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseGroupsHeader(''), []);
  assert.deepEqual(parseGroupsHeader(undefined), []);
});
