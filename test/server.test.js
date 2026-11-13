'use strict';
// Offline tests: no Mac or Things needed. Run with `npm test`.
// Covers the MCP protocol, every Apple script's syntax, the read/write logic
// against a simulated Things object model, URL encoding and input validation.

const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SERVER = path.join(__dirname, '..', 'server', 'index.js');
process.env.THINGS_LOCAL_NO_START = '1';
const M = require(SERVER);
delete process.env.THINGS_LOCAL_NO_START;

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

// 1. Every script sent to Apple's engine assembles into valid JavaScript
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jxa-'));
for (const [name, fn] of Object.entries(M.J)) {
  const f = path.join(tmp, name + '.js');
  fs.writeFileSync(f, M.buildScript(fn));
  execFileSync(process.execPath, ['--check', f]);
}
ok(`all ${Object.keys(M.J).length} Apple scripts are syntactically valid`);

// 2. A simulated Things object model (mirrors how JXA exposes Things)
function coll(items) {
  const f = () => items.slice();
  f.byId = (id) => items.find((x) => x.id() === id) || { id() { throw new Error("Can't get object"); } };
  f.whose = (q) => () => items.filter((x) => {
    if (q.name && typeof q.name === 'string') return x.name() === q.name;
    if (q._or) return q._or.some((c) => {
      const k = Object.keys(c)[0]; const v = (k === 'name' ? x.name() : x.notes()) || '';
      return v.toLowerCase().includes(c[k]._contains.toLowerCase());
    });
    return false;
  });
  f.push = (x) => items.push(x);
  f.id = () => items.map((x) => x.id());
  return f;
}
let n = 0;
function item(props) {
  const s = { id: 'ID' + (++n), name: '', notes: '', status: 'open', tagNames: '', dueDate: null, activationDate: null,
    creationDate: new Date(), project: null, area: null, ...props };
  const o = {};
  for (const k of ['id', 'name', 'notes', 'status', 'tagNames', 'dueDate', 'activationDate', 'creationDate', 'project', 'area'])
    Object.defineProperty(o, k, { get: () => () => s[k], set: (v) => { s[k] = v; }, configurable: true });
  o.completionDate = () => null; o.cancellationDate = () => null; o.modificationDate = () => new Date();
  o.toDos = coll(props.children || []);
  o._s = s;
  return o;
}
const area = item({ name: 'Home' });
const proj = item({ name: 'Kitchen refresh', area });
const t1 = item({ name: 'Call "the contractor" & confirm', notes: 'ask about timeline', tagNames: 'work, urgent', project: proj, dueDate: new Date(2026, 10, 3) });
const t2 = item({ name: 'Buy groceries', notes: 'oat milk', tagNames: '' });
proj.toDos = coll([t1]);
const scheduled = []; const trashed = [];
const app = {
  lists: coll([{ id: () => 'TMTodayListSource', toDos: coll([t1, t2]) }]),
  toDos: coll([t1, t2]), projects: coll([proj]), areas: coll([area]), tags: coll([]),
  schedule: (o, opt) => scheduled.push([o.id(), opt.for]),
  delete: (o) => { if (o._shadow) throw new Error("Can't get object"); trashed.push(o.id()); },
};
const runJ = (fn, input) => new Function('app', 'input',
  'var APP = app, PROJECT_IDS = null;\n' + M.JXA_HELPERS + '\nreturn (' + M.fnSource(fn) + ')(app, input);')(app, input);

let r = runJ(M.J.getList, { list: 'today', listId: 'TMTodayListSource', limit: 1, offset: 0 });
assert.strictEqual(r.total, 2); assert.strictEqual(r.items.length, 1);
assert.deepStrictEqual(r.items[0].tags, ['work', 'urgent']);
assert.deepStrictEqual(r.items[0].project, { id: proj.id(), title: 'Kitchen refresh' });
assert.strictEqual(r.items[0].deadline, '2026-11-03');
ok('get_list: paging, tags, project and deadline formatting');

r = runJ(M.J.search, { query: 'OAT MILK', includeClosed: false, limit: 10 });
assert.strictEqual(r.total, 1); assert.strictEqual(r.items[0].title, 'Buy groceries');
r = runJ(M.J.search, { query: 'kitchen', includeClosed: true, limit: 10 });
assert.strictEqual(r.total, 1); assert.strictEqual(r.items[0].type, 'project');
ok('search: case-insensitive, matches notes, finds projects, tolerates a missing Logbook');

r = runJ(M.J.update, { id: t2.id(), title: 'Buy groceries (weekly)', addTags: ['errands'], appendNotes: 'eggs', scheduleDate: '2026-11-01' });
assert.strictEqual(t2._s.name, 'Buy groceries (weekly)');
assert.strictEqual(t2._s.tagNames, 'errands');
assert.strictEqual(t2._s.notes, 'oat milk\neggs');
assert.strictEqual(scheduled[0][1].getDate(), 1);
r = runJ(M.J.update, { id: t1.id(), removeTags: ['URGENT'], status: 'completed' });
assert.strictEqual(t1._s.tagNames, 'work'); assert.strictEqual(t1._s.status, 'completed');
assert.strictEqual(r.item.type, 'to-do');
ok('update: rename, append notes, add/remove tags, schedule, status');

r = runJ(M.J.getProject, { id: proj.id(), limit: 10 });
assert.strictEqual(r.project.type, 'project'); assert.strictEqual(r.total, 1);
assert.strictEqual(r.todos[0].type, 'to-do');
r = runJ(M.J.getProjects, { includeClosed: true });
assert.ok(r.projects.every((p) => p.type === 'project'));
ok('project vs to-do labels are correct');

r = runJ(M.J.findCreated, { type: 'to-do', title: 'Buy groceries (weekly)' });
assert.strictEqual(r.id, t2.id());
assert.throws(() => runJ(M.J.getItem, { id: 'NOPE' }), /No to-do or project/);
runJ(M.J.trash, { id: t2.id() }); assert.deepStrictEqual(trashed, [t2.id()]);
// Things also resolves a project's ID as a to-do, but that handle can't be
// trashed (the 1.0.3 bug). Model it as a distinct "shadow" object.
const projShadow = { ...proj, _shadow: true, id: proj.id };
app.toDos = coll([t1, t2, projShadow]);
r = runJ(M.J.getItem, { id: proj.id() });
assert.strictEqual(r.type, 'project');
runJ(M.J.trash, { id: proj.id() }); assert.strictEqual(trashed[1], proj.id());
ok('find-after-create, missing-ID error, trashing to-dos and projects');

// Someday includes open to-dos inside Someday projects
const sProj = item({ name: 'Learn piano' });
const sOpen = item({ name: 'Find a teacher', project: sProj });
const sDone = item({ name: 'Buy keyboard', project: sProj, status: 'completed' });
sProj.toDos = coll([sOpen, sDone]);
const sLoose = item({ name: 'Read a novel' });
app.projects = coll([proj, sProj]);
app.lists = coll([{ id: () => 'TMTodayListSource', toDos: coll([t1, t2]) }, { id: () => 'TMSomedayListSource', toDos: coll([sLoose, sProj]) }]);
r = runJ(M.J.getList, { list: 'someday', listId: 'TMSomedayListSource', limit: 10, offset: 0 });
assert.deepStrictEqual(r.items.map((x) => x.title), ['Read a novel', 'Learn piano', 'Find a teacher']);
assert.deepStrictEqual(r.items[2].viaSomedayProject, { id: sProj.id(), title: 'Learn piano' });
ok('Someday also lists open to-dos inside Someday projects');

// Bulk editing, ID checks and area tags
app.toDos = coll([t1, t2, sOpen, sLoose]);
r = runJ(M.J.checkIds, { ids: [t1.id(), sProj.id(), 'MISSING'] });
assert.deepStrictEqual(r, { missing: ['MISSING'], projects: [sProj.id()] });
r = runJ(M.J.bulkUpdate, { ids: [sOpen.id(), sLoose.id(), 'GONE'], changes: { addTags: ['music'], deadline: '2026-12-01' } });
assert.deepStrictEqual(r.results.slice(0, 2).map((x) => x.changed), [['deadline', 'tags (added)'], ['deadline', 'tags (added)']]);
assert.strictEqual(sLoose._s.tagNames, 'music'); assert.strictEqual(sOpen._s.dueDate.getMonth(), 11);
assert.ok(/No to-do or project/.test(r.results[2].error));
r = runJ(M.J.updateArea, { id: area.id(), title: 'Household', tags: ['home', 'chores'] });
assert.deepStrictEqual(r, { id: area.id(), title: 'Household', tags: ['home', 'chores'] });
ok('bulk edits apply per item and report failures; ID check flags missing items and projects; area rename + tags');

// The shared edit planner (used by update_item and bulk_update)
let plan = M.planEdit({ when: 'today', add_tags: ['x'], status: 'completed', prepend_checklist: ['first'] });
assert.strictEqual(plan.moveTo, 'TMTodayListSource'); assert.deepStrictEqual(plan.input.addTags, ['x']);
assert.strictEqual(plan.statusLast, 'completed'); assert.strictEqual(plan.url['prepend-checklist-items'], 'first');
plan = M.planEdit({ when: '2026-11-04@09:15', clear_deadline: true, heading: 'Phase B', project_id: 'P123' });
assert.deepStrictEqual(plan.url, { when: '2026-11-04@09:15', heading: 'Phase B', 'list-id': 'P123', deadline: '' });
assert.strictEqual(plan.input.projectId, undefined);
assert.throws(() => M.planEdit({ deadline: '2026-11-01', clear_deadline: true }), /not both/);
ok('edit planner routes each change to scripting, list moves or the URL scheme correctly');

// Tags, duplicates, Inbox and detach routing
const cProj = item({ name: 'Garden plan' });
const cOpen = item({ name: 'Buy seeds', project: cProj });
function tag(name, parent) { const s = { id: 'TAG' + (++n), name, parent }; const t = {}; Object.defineProperty(t, 'id', { get: () => () => s.id });
  Object.defineProperty(t, 'name', { get: () => () => s.name, set: (v) => { s.name = v; } });
  Object.defineProperty(t, 'parentTag', { get: () => () => s.parent, set: (v) => { s.parent = v; } }); return t; }
const tA = tag('Errand'); const tB = tag('Places');
app.tags = coll([tA, tB]);
r = runJ(M.J.updateTag, { id: tA.id(), title: 'Errands', parentId: tB.id() });
assert.deepStrictEqual(r, { id: tA.id(), title: 'Errands', parent: { id: tB.id(), title: 'Places' } });
assert.throws(() => runJ(M.J.updateTag, { id: tA.id(), parentId: 'NOPE' }), /No tag/);
const dupe = item({ name: 'Buy seeds', project: cProj, creationDate: new Date(Date.now() + 1000) });
app.toDos = coll([cOpen, dupe]);
assert.strictEqual(runJ(M.J.findDuplicate, { type: 'to-do', title: 'Buy seeds', originalId: cOpen.id() }).id, dupe.id());
plan = M.planEdit({ when: 'inbox', remove_from_area: true });
assert.strictEqual(plan.moveTo, 'TMInboxListSource'); assert.deepStrictEqual(plan.detach, ['detachArea']);
assert.throws(() => M.planEdit({ remove_from_project: true, project_id: 'P1' }), /without project_id/);
assert.strictEqual(M.todoJson({ title: 'x', when: 'inbox' }).attributes.when, undefined);
ok('tag rename + nesting; duplicate found by title (not the original); move to Inbox; detach from project/area');

// 3. URL building: user text is fully encoded and round-trips exactly
const tricky = 'He said "hi" & left; $(rm -rf ~) `x` 50%/2 🐶\nline2';
const url = M.jsonUrl([M.todoJson({ title: tricky, checklist: ['a&b', 'c'], when: '2026-11-02@14:30', tags: ['work'] })]);
assert.ok(url.startsWith('things:///json?data='));
assert.ok(!/[\s"&;$`]/.test(url.slice('things:///json?data='.length)));
const decoded = JSON.parse(decodeURIComponent(url.split('data=')[1]));
assert.strictEqual(decoded[0].attributes.title, tricky);
assert.strictEqual(decoded[0].attributes['checklist-items'][0].attributes.title, 'a&b');
assert.strictEqual(M.updateUrl('update', { id: 'ABC', 'auth-token': 'tok', 'append-checklist-items': 'x\ny&z', heading: undefined }),
  'things:///update?id=ABC&auth-token=tok&append-checklist-items=x%0Ay%26z');
assert.strictEqual(M.updateUrl('update', { id: 'X', deadline: '' }), 'things:///update?id=X&deadline=');
ok('URLs: every special character encoded; empty deadline clears');

assert.throws(() => M.todoJson({ title: 'x', when: 'next tuesday' }), /"when" must be/);
assert.throws(() => M.todoJson({ title: 'x', deadline: '11/3' }), /deadline/);
ok('input validation rejects malformed dates');

// 4. MCP protocol over stdio, including when loaded through a wrapper
function talk(args, messages) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, THINGS_AUTH_TOKEN: '', THINGS_LOCAL_DB_PATH: '/nonexistent' },
    });
    const lines = []; let buf = '';
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    setTimeout(() => { child.stdin.end(); resolve(lines); }, 1500);
  });
}
(async () => {
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_todo', arguments: { title: 'x', when: 'whenever' } } },
    { jsonrpc: '2.0', id: 4, method: 'nope' },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'status', arguments: {} } },
  ];
  const lines = await talk([SERVER], msgs);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.strictEqual(byId[1].result.protocolVersion, '2025-06-18');
  assert.strictEqual(byId[1].result.serverInfo.name, 'things-local');
  assert.strictEqual(lines.filter((l) => l.id == null).length, 0, 'no reply to notifications');
  const tools = byId[2].result.tools;
  assert.strictEqual(tools.length, 26);
  assert.ok(tools.every((t) => !('run' in t) && t.inputSchema.type === 'object'));
  assert.deepStrictEqual(tools, M.TOOLS.map(({ run, ...tool }) => tool));
  assert.ok(byId[3].result.isError && /"when" must be/.test(byId[3].result.content[0].text));
  assert.strictEqual(byId[4].error.code, -32601);
  assert.ok(/not passed|empty|received|placeholder/.test(JSON.parse(byId[5].result.content[0].text).authToken));
  ok('MCP handshake, 26 tools listed, errors returned cleanly, status tool');

  const wrapper = path.join(tmp, 'wrapper.js');
  fs.writeFileSync(wrapper, 'require(process.argv[2]);');
  const viaWrapper = await talk([wrapper, SERVER], msgs.slice(0, 1));
  assert.strictEqual(viaWrapper[0].result.serverInfo.name, 'things-local');
  ok('starts correctly when the host loads it through a wrapper (the v1.0.0 timeout bug)');

  const chatgptLines = await talk([SERVER, '--chatgpt'], msgs.concat({
    jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'duplicate_item', arguments: { id: 'test-id' } },
  }));
  const chatgpt = Object.fromEntries(chatgptLines.map((line) => [line.id, line]));
  assert.deepStrictEqual(chatgpt[1], byId[1]);
  const chatgptTools = chatgpt[2].result.tools;
  const withoutAnnotations = ({ annotations, ...tool }) => tool;
  assert.deepStrictEqual(chatgptTools.map(withoutAnnotations), tools.map(withoutAnnotations));
  assert.ok(chatgptTools.every(({ annotations }) => annotations.openWorldHint === false));
  const annotationsFor = (predicate) => chatgptTools.filter(({ annotations }) => predicate(annotations)).map(({ name }) => name).sort();
  assert.deepStrictEqual(annotationsFor((a) => a.readOnlyHint === true),
    tools.filter((t) => t.annotations?.readOnlyHint && t.name !== 'show_in_things').map((t) => t.name).sort());
  assert.deepStrictEqual(annotationsFor((a) => a.destructiveHint === true),
    ['bulk_update', 'move_to_trash', 'set_checklist_items', 'update_area', 'update_item', 'update_tag']);
  assert.ok(chatgptTools.every(({ annotations }) =>
    typeof annotations.readOnlyHint === 'boolean' && typeof annotations.destructiveHint === 'boolean'));
  assert.deepStrictEqual(chatgpt[3], byId[3]);
  assert.match(chatgpt[6].result.content[0].text, /local THINGS_AUTH_TOKEN environment file/);
  ok('ChatGPT discovers all 26 unchanged tool schemas with explicit annotations and local token help');

  // Regression (found in pre-publish QA): a failed /usr/bin/open put the full
  // command line, auth token included, into the error shown to Claude and the log.
  const TOKEN = 'TEST/tok+en=1234567890';
  const probe = path.join(tmp, 'probe.js');
  fs.writeFileSync(probe, `process.env.THINGS_LOCAL_NO_START='1';
    const M = require(${JSON.stringify(SERVER)});
    M.runProgram('/bin/sh', ['-c', 'exit 1', 'sh', 'things:///update?auth-token=' + encodeURIComponent(${JSON.stringify(TOKEN)})])
      .catch((e) => process.stdout.write(e.message));`);
  const leaked = execFileSync(process.execPath, [probe], { env: { ...process.env, THINGS_AUTH_TOKEN: TOKEN } }).toString();
  assert.ok(leaked && !leaked.includes('tok') && !leaked.includes(encodeURIComponent(TOKEN)), 'token leaked: ' + leaked);
  const out = execFileSync(process.execPath, [SERVER], {
    env: { ...process.env, THINGS_AUTH_TOKEN: TOKEN, THINGS_LOCAL_DB_PATH: '/nonexistent' },
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {} } }) + '\n',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString();
  assert.ok(/received \(22 characters\)/.test(out) && !out.includes(TOKEN));
  ok('auth token never appears in errors or replies (raw or URL-encoded)');

  console.log(`\nserver tests: ${passed} groups passed`);
})().catch((e) => { console.error(e); process.exit(1); });
