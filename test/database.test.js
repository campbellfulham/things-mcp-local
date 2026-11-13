'use strict';
// Tests for the read-only database tools (checklists, headings, find, tag
// usage) against a small database with the same tables and columns as
// Things' own. Needs Node 22.5+ (built-in node:sqlite). Run with `npm test`.

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

process.env.THINGS_LOCAL_NO_START = '1';
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'things-db-')), 'main.sqlite');
process.env.THINGS_LOCAL_DB_PATH = dbPath;
const M = require(path.join(__dirname, '..', 'server', 'index.js'));

const now = Date.now() / 1000;
const daysAgo = (d) => now - d * 86400;
const pack = M.packDate;

const db = new DatabaseSync(dbPath);
db.exec(`
CREATE TABLE TMTask (uuid TEXT, type INTEGER, status INTEGER, trashed INTEGER, title TEXT, notes TEXT,
  start INTEGER, startDate INTEGER, startBucket INTEGER, reminderTime INTEGER, deadline INTEGER, creationDate REAL, stopDate REAL,
  rt1_recurrenceRule BLOB,
  project TEXT, heading TEXT, area TEXT, "index" INTEGER, checklistItemsCount INTEGER, openChecklistItemsCount INTEGER);
CREATE TABLE TMChecklistItem (uuid TEXT, title TEXT, status INTEGER, "index" INTEGER, task TEXT);
CREATE TABLE TMTag (uuid TEXT, title TEXT, parent TEXT);
CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
CREATE TABLE TMArea (uuid TEXT, title TEXT);
CREATE TABLE TMAreaTag (areas TEXT, tags TEXT);`);
// type: 0 to-do, 1 project, 2 heading. status: 0 open, 2 canceled, 3 completed.
const task = db.prepare(`INSERT INTO TMTask (uuid,type,status,trashed,title,notes,start,startDate,startBucket,reminderTime,deadline,creationDate,stopDate,rt1_recurrenceRule,project,heading,area,"index",checklistItemsCount,openChecklistItemsCount)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const T = (o) => task.run(o.id, o.type ?? 0, o.status ?? 0, o.trashed ?? 0, o.title, o.notes ?? null, o.start ?? 1, o.startDate ?? null,
  o.bucket ?? 0, o.reminder ?? null, o.deadline ?? null, o.created ?? daysAgo(1), o.stopped ?? null, o.rule ?? null,
  o.project ?? null, o.heading ?? null, o.area ?? null,
  o.index ?? 0, o.cl ?? 0, o.openCl ?? 0);
db.exec(`INSERT INTO TMArea VALUES ('A1','Personal'),('A2','Wellness');
  INSERT INTO TMTag VALUES ('G1','Health',NULL),('G2','Dental','G1'),('G3','Errand',NULL),('G4','Unused',NULL);
  INSERT INTO TMAreaTag VALUES ('A2','G1');`);
T({ id: 'P1', type: 1, title: 'Weekend trip', area: 'A1' });
T({ id: 'H1', type: 2, title: 'Before', project: 'P1', index: 1 });
T({ id: 'H2', type: 2, title: 'During', project: 'P1', index: 2 });
T({ id: 'H9', type: 2, title: 'Trashed heading', project: 'P1', trashed: 1, index: 3 });
// As in real Things data, to-dos under a heading record the heading, not the project.
T({ id: 'T1', title: 'Pack', heading: 'H1', index: 1, cl: 4, openCl: 1, deadline: pack('2026-11-20') });
T({ id: 'T2', title: 'Book hotel', heading: 'H1', index: 2, status: 3, stopped: daysAgo(3) });
T({ id: 'T3', title: 'Visit museum', heading: 'H2', index: 1, startDate: pack('2026-11-07'), bucket: 1, reminder: 1188036608 });
T({ id: 'T4', title: 'Loose to-do', project: 'P1', index: 0, notes: '100% fun' });
T({ id: 'P2', type: 1, title: 'Physio', area: 'A1' });
T({ id: 'T5', title: 'Book physio session', project: 'P2' });
T({ id: 'T6', title: 'Morning stretches', area: 'A2', start: 2 });
T({ id: 'T7', title: 'Dentist checkup', start: 0 });
T({ id: 'T8', title: 'Refill prescription', status: 3, stopped: daysAgo(2) });
T({ id: 'T9', title: 'Old trashed note', trashed: 1 });
T({ id: 'T10', title: 'Return parcel', created: daysAgo(30) });
// Regression (found on real data): trashing a project marks only the project.
T({ id: 'P3', type: 1, title: 'Abandoned plan', trashed: 1 });
T({ id: 'T11', title: 'Inside trashed project', project: 'P3', deadline: pack('2026-11-12') });
T({ id: 'T12', title: 'Under trashed heading', heading: 'H9' });
// Regression (from things.py): each repeating to-do has a hidden template row; only instances are real.
T({ id: 'R1', title: 'Weekly review (template)', heading: 'H1', rule: Buffer.from('rrule') });
T({ id: 'R2', title: 'Weekly review', heading: 'H1', index: 5 });
db.exec(`INSERT INTO TMTaskTag VALUES ('P2','G1'),('T7','G2'),('T8','G1'),('T9','G1'),('T10','G3'),('T11','G1'),('T12','G1'),('R1','G1');
  INSERT INTO TMChecklistItem VALUES ('c2','charger "USB-C"',3,2,'T1'),('c1','passport',3,1,'T1'),('c3','adapter',0,3,'T1'),('c4','umbrella',2,4,'T1');`);
db.close();

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };
const titles = (r) => r.items.map((i) => i.title).sort();
const find = (f) => M.dbFind({ status: 'open', type: 'any', limit: 100, offset: 0, ...f });

// Dates
assert.strictEqual(M.packDate('2026-10-27'), 132820352); // value observed in a real Things database
assert.strictEqual(M.unpackDate(132820352), '2026-10-27');
const d = new Date(); d.setDate(d.getDate() - 6);
assert.strictEqual(M.resolveWindow('7d', 'x'), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
assert.throws(() => M.resolveWindow('7 days', 'created_within'), /7d, 2w/);
ok('Things\' packed date format and relative windows decode correctly');

// Checklists and headings
let r = M.dbGetChecklist('T1');
assert.deepStrictEqual(r.items.map((i) => i.title), ['passport', 'charger "USB-C"', 'adapter', 'umbrella']);
assert.deepStrictEqual(r.items.map((i) => i.status), ['completed', 'completed', 'open', 'canceled']);
assert.throws(() => M.dbGetChecklist('P1'), /Checklists belong to to-dos/);
assert.throws(() => M.dbGetChecklist('NOPE'), /No to-do/);
r = M.dbGetHeadings('P1', false);
assert.deepStrictEqual(r.headings.map((h) => h.title), ['Before', 'During']);
assert.strictEqual(r.headings[0].todos[0].checklist, '3/4 done'); // Things counts canceled items as closed
assert.deepStrictEqual(r.noHeading.map((t) => t.title), ['Loose to-do']);
assert.deepStrictEqual(M.dbGetHeadings('P1', true).headings[0].todos.map((t) => `${t.title}:${t.status}`), ['Pack:open', 'Book hotel:completed', 'Weekly review:open']);
ok('checklists and headings: order, statuses, trashed excluded, clear errors');

// find: the "everything tagged Health" case
r = find({ tag: 'health' });
assert.deepStrictEqual(titles(r), ['Book physio session', 'Dentist checkup', 'Morning stretches', 'Physio']);
const via = Object.fromEntries(r.items.map((i) => [i.title, i.tagMatchedVia]));
assert.deepStrictEqual(via, { 'Physio': 'own tag', 'Book physio session': 'project tag', 'Morning stretches': 'area tag', 'Dentist checkup': 'own tag' });
assert.strictEqual(find({ tag: 'health', type: 'to-do' }).total, 3);
assert.throws(() => find({ tag: 'Nope' }), /No tag named "Nope". Tags: Health, Dental/);
ok('find by tag: own, child-tag, project-inherited and area-inherited matches; trashed and completed excluded');

r = find({ tag: 'Health', status: 'closed', completedAfter: M.resolveWindow('7d', 'x') });
assert.deepStrictEqual(titles(r), ['Refill prescription']); assert.ok(r.items[0].closed);
r = find({ status: 'closed', projectId: 'P1' });
assert.deepStrictEqual(titles(r), ['Book hotel']);
ok('find completed items by period and by project (logbook queries)');

r = find({ projectId: 'P1', type: 'to-do' });
assert.deepStrictEqual(titles(r), ['Loose to-do', 'Pack', 'Visit museum', 'Weekly review']); // no template
assert.ok(r.items.every((i) => i.project && i.project.title === 'Weekend trip'));
assert.deepStrictEqual(find({ areaId: 'A1', type: 'to-do' }).total, 5); // P1's three + P2's one, via their projects
ok('find by project includes to-dos under headings (which record no project) and by area includes project to-dos');

assert.ok(!titles(find({ createdAfter: M.resolveWindow('7d', 'x') })).includes('Return parcel'));
assert.deepStrictEqual(titles(find({ createdBefore: M.resolveDay('yesterday') })).includes('Return parcel'), true);
assert.deepStrictEqual(titles(find({ hasDeadline: true })), ['Pack']); // not the to-do inside the trashed project
assert.ok(!titles(find({ status: 'any' })).some((t) => /trashed (project|heading)/.test(t)));
assert.deepStrictEqual(titles(find({ deadlineBefore: '2026-11-30', deadlineAfter: '2026-11-01' })), ['Pack']);
r = find({ scheduledAfter: '2026-11-01' });
assert.deepStrictEqual(titles(r), ['Visit museum']); assert.strictEqual(r.items[0].when, '2026-11-07 (evening)');
assert.strictEqual(r.items[0].reminder, '17:45'); // real value read from a Things library, set to 5:45 PM in the app
assert.strictEqual(M.unpackTime(null), null);
assert.strictEqual(find({ text: '100%' }).total, 1); assert.strictEqual(find({ text: '%' }).total, 1);
assert.strictEqual(find({ tag: 'Health', type: 'to-do', limit: 1, offset: 1 }).items.length, 1);
assert.ok(!titles(find({ status: 'any' })).some((t) => /template/.test(t)));
ok('find by created date, deadline, scheduled date (incl. evening + reminder time), literal text with %, paging; repeating templates hidden');

// Project cascade + true item types (found live: scripting returns a completed or
// cancelled project as a plain to-do, and couldn't enumerate its to-dos)
assert.deepStrictEqual(M.dbOpenChildren(['P1']).sort(), ['R2', 'T1', 'T3', 'T4'], 'heading to-dos included, completed T2 and template R1 excluded');
assert.deepStrictEqual(M.dbOpenChildren(['P2', 'NOPE']), ['T5']);
assert.deepStrictEqual(M.dbOpenChildren([]), []);
assert.deepStrictEqual(M.dbTypes(['P1', 'T1', 'H1', 'NOPE']), { P1: 'project', T1: 'to-do', H1: 'heading' });
const mislabelled = { item: { id: 'P2', type: 'to-do' }, list: [{ id: 'T5', type: 'project' }, { id: 'X', type: 'to-do' }] };
M.fixTypes(mislabelled);
assert.deepStrictEqual(mislabelled, { item: { id: 'P2', type: 'project' }, list: [{ id: 'T5', type: 'to-do' }, { id: 'X', type: 'to-do' }] });
// Found live (1.3.4 QA): scripting reports a Someday item's "when" as null.
const somedayCheck = { a: { id: 'T6', type: 'to-do', when: null }, b: { id: 'T5', type: 'to-do', when: null }, c: { id: 'T3', type: 'to-do', when: '2026-11-07' } };
M.fixTypes(somedayCheck);
assert.strictEqual(somedayCheck.a.when, 'someday', 'Someday to-do labelled');
assert.strictEqual(somedayCheck.b.when, null, 'Anytime to-do untouched');
assert.strictEqual(somedayCheck.c.when, '2026-11-07', 'scheduled date untouched');
assert.strictEqual(M.dbExists('project', 'P1'), true); assert.strictEqual(M.dbExists('project', 'P3'), false, 'trashed project');
assert.strictEqual(M.dbExists('area', 'A1'), true); assert.strictEqual(M.dbExists('area', 'GONE'), false);
assert.throws(() => M.checkTarget('area', 'GONE'), /No area with id GONE, so nothing was created/);
assert.deepStrictEqual(M.withProjectCounts({ id: 'P1', type: 'to-do' }), { id: 'P1', type: 'project', todos: { open: 4, total: 5 } });
assert.deepStrictEqual(M.withProjectCounts({ id: 'T1', type: 'to-do' }), { id: 'T1', type: 'to-do' });
ok('project cascade finds open to-dos (incl. under headings); types come from the database; missing project/area refused');

// Tag usage
r = M.dbTagUsage(false);
const usage = Object.fromEntries(r.tags.map((t) => [t.title, [t.openItems, t.allItems, t.areas]]));
assert.deepStrictEqual(usage, { Health: [1, 2, 1], Dental: [1, 1, 0], Errand: [1, 1, 0], Unused: [0, 0, 0] });
assert.deepStrictEqual(M.dbTagUsage(true).tags.map((t) => t.title), ['Unused']);
ok('tag usage counts open/all items and areas; finds unused tags');

// Exercise the same stdio command used by Codex and tunnel-client using only
// the fixture. A missing tag error includes fixture data in the tool reply.
const tokenFile = path.join(path.dirname(dbPath), 'things.env');
const testToken = 'fixture-token/+713';
fs.writeFileSync(tokenFile, `THINGS_AUTH_TOKEN=${testToken}\n`, { mode: 0o600 });
const childEnv = { ...process.env };
delete childEnv.THINGS_LOCAL_NO_START;
delete childEnv.THINGS_AUTH_TOKEN;
const requests = [
  ['status', {}],
  ['find', { text: '100% fun' }],
  ['find', { tag: 'missing-fixture-tag' }],
];
const probe = spawnSync(process.execPath, [
  `--env-file=${tokenFile}`, path.join(__dirname, '..', 'server', 'index.js'), '--chatgpt',
], {
  input: requests.map(([name, args], id) =>
    JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })).join('\n') + '\n',
  env: childEnv,
  encoding: 'utf8',
  timeout: 5000,
});
fs.unlinkSync(tokenFile);
assert.ifError(probe.error);
assert.strictEqual(probe.status, 0, probe.stderr);
const replies = Object.fromEntries(probe.stdout.trim().split('\n').map((line) => {
  const { id, result } = JSON.parse(line);
  return [id, result];
}));
assert.match(replies[0].content[0].text, /"authToken": "received/);
assert.deepStrictEqual(JSON.parse(replies[1].content[0].text), find({ text: '100% fun' }));
assert.strictEqual(replies[2].isError, true);
assert.match(replies[2].content[0].text, /missing-fixture-tag.*Dental/);
assert.match(probe.stderr, /find failed/);
assert.doesNotMatch(probe.stderr, /missing-fixture-tag|Dental|Loose to-do|100% fun/);
for (const secret of [testToken, encodeURIComponent(testToken)]) {
  assert.ok(!probe.stdout.includes(secret) && !probe.stderr.includes(secret));
}
ok('ChatGPT stdio reads the fixture, loads a local token and omits task details from logs');

// Safety
// Both layers, on the connection the server itself opens:
assert.strictEqual(M.readDb((db) => db.prepare('PRAGMA query_only').get().query_only), 1, 'query_only is on');
assert.throws(() => M.readDb((db) => { db.exec('PRAGMA query_only = OFF'); db.exec("UPDATE TMTask SET title='x'"); }),
  /readonly|read-only|attempt to write/i, 'opened read-only even if query_only is switched off');
assert.throws(() => M.readDb((db) => db.exec("UPDATE TMTask SET title='x'")), /readonly|query_only|read-only|attempt to write/i);
ok('the server\'s own database connection refuses writes at both layers');

const w = new DatabaseSync(dbPath); w.exec('ALTER TABLE TMChecklistItem RENAME TO Gone'); w.close();
assert.throws(() => M.dbGetChecklist('T1'), /layout has changed/);
ok('clear message if a Things update changes the database layout');

// A missing or empty database file must not be reported as a layout change.
const realPath = process.env.THINGS_LOCAL_DB_PATH;
const emptyPath = dbPath + '.empty';
fs.writeFileSync(emptyPath, '');
for (const p of [dbPath + '.missing', emptyPath]) {
  process.env.THINGS_LOCAL_DB_PATH = p;
  assert.throws(() => M.dbGetChecklist('T1'), (e) => /Could not find the Things database/.test(e.message) && !/layout/.test(e.message), p);
}
process.env.THINGS_LOCAL_DB_PATH = realPath;
fs.unlinkSync(emptyPath);
ok('a missing or empty database says so instead of blaming a layout change');

console.log(`\ndatabase tests: ${passed} groups passed`);
