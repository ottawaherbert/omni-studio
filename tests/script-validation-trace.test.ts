import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { installScriptValidationTrace } from '../apps/api/src/agent/scriptValidationTrace';

test('disabled tracing preserves methods and performs no database reads', () => {
  const target = { read: () => 42 }, original = target.read;
  installScriptValidationTrace({ inTransaction: false, prepare() { throw Error('unexpected DB access'); } } as any,
    [{ name: 'target', object: target, methods: ['read'] }], { enabled: false });
  assert.equal(target.read, original);
  assert.equal(target.read(), 42);
});

test('trace aggregates synchronous nesting without changing returns, writes, rollback or throws', () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE facts(value INTEGER)');
  const records: any[] = [], expected = { result: true }, failure = Error('original failure');
  const target = {
    leaf() { return expected; },
    outer() { assert.equal(this.leaf(), expected); return this.leaf(); },
    fail() { db.prepare('INSERT INTO facts VALUES(1)').run(); throw failure; },
  };
  const original = target.outer;
  const restore = installScriptValidationTrace(db, [{ name: 'test', object: target, methods: ['outer', 'leaf', 'fail'] }],
    { enabled: true, minimumMs: 0, emit: record => records.push(record) });
  assert.equal(target.outer(), expected);
  assert.equal(records.length, 1);
  assert.equal(records[0].methods['test.leaf'].calls, 2);
  assert.equal(records[0].methods['test.outer'].calls, 1);
  assert.equal(records[0].changesBefore, records[0].changesAfter);
  assert.throws(() => db.transaction(() => target.fail())(), error => error === failure);
  assert.equal(records[1].inTransaction, true);
  assert.equal(records[1].failed, true);
  assert.equal(records[1].changesAfter - records[1].changesBefore, 1);
  assert.equal((db.prepare('SELECT count(*) n FROM facts').get() as any).n, 0);
  target.leaf();
  assert.deepEqual(Object.keys(records[2].methods), ['test.leaf']);
  restore(); assert.equal(target.outer, original); db.close();
});

test('trace does not retain a synchronous span across await or change Promise identity', async () => {
  const db = new Database(':memory:'), records: any[] = [];
  const pending = Promise.resolve('done');
  const target = { begin: () => pending, later: () => 'later' };
  installScriptValidationTrace(db, [{ name: 'test', object: target, methods: ['begin', 'later'] }],
    { enabled: true, minimumMs: 0, emit: record => records.push(record) });
  assert.equal(target.begin(), pending);
  await pending;
  assert.equal(target.later(), 'later');
  assert.equal(records.length, 2);
  assert.deepEqual(Object.keys(records[1].methods), ['test.later']);
  db.close();
});

test('a failed diagnostic sink never changes execution or leaks arguments', () => {
  const db = new Database(':memory:'), secret = 'private request contents';
  let record: unknown;
  const target = { read: (value: string) => value };
  installScriptValidationTrace(db, [{ name: 'test', object: target, methods: ['read'] }],
    { enabled: true, minimumMs: 0, emit: value => { record = value; throw Error('sink failed'); } });
  assert.equal(target.read(secret), secret);
  assert.ok(!JSON.stringify(record).includes(secret));
  db.close();
});
