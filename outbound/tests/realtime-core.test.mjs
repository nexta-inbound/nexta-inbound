import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeKey, decodeKey, fromEnvelope, toEnvelope, recordPath } from '../assets/realtime-codec.mjs';
import { createRealtimeWriter } from '../assets/realtime-writer.mjs';
import { applyQuery } from '../assets/realtime-query.mjs';
import { createRealtimeReader } from '../assets/realtime-reader.mjs';

test('chaves UTF-8 reversiveis sem colisoes de prefixo', () => {
  const names = ['normal', 'a.b', '~YS5i', 'a/b', 'a#b', 'a$b', 'ação', '__proto__'];
  assert.equal(new Set(names.map(encodeKey)).size, names.length);
  for (const name of names) assert.equal(decodeKey(encodeKey(name)), name);
  assert.throws(() => encodeKey('x'.repeat(769)));
  assert.throws(() => recordPath('desconhecida', 'a'));
});

test('envelope distingue nulo, ausente, vazio e lista ordenada', () => {
  const formats = {'/n': 'null', '/empty': 'emptyMap', '/list': 'array', '/list/i00000000': 'null'};
  const envelope = {existe: true, dados: {zero: 0, false: false, list: {i00000001: 'valor'}},
    formatos: Object.fromEntries(Object.entries(formats).map(([p, v]) => [encodeKey('p' + p), v]))};
  assert.deepEqual(fromEnvelope(envelope), {n: null, empty: {}, list: [null, 'valor'], zero: 0, false: false});
  assert.equal(fromEnvelope(null), undefined);
  assert.deepEqual(fromEnvelope({existe: true, formatos: {p: 'emptyMap'}}), {});
});

test('consultas combinam carrier, data e placa sem alterar registros', () => {
  const rows = [{id: 'a', data: {carrier: 'A', plate: 'X', dateStr: '2026-11-14'}},
    {id: 'b', data: {carrier: 'B', plate: 'X', dateStr: '2026-11-15'}},
    {id: 'c', data: {carrier: 'A', plate: 'Y', dateStr: '2026-11-15'}}];
  const result = applyQuery(rows, [{kind: 'where', field: 'carrier', op: '==', value: 'A'},
    {kind: 'where', field: 'plate', op: 'in', value: ['X', 'Y']},
    {kind: 'orderBy', field: 'dateStr', direction: 'desc'}, {kind: 'limit', count: 1}]);
  assert.deepEqual(result.map(r => r.id), ['c']);
  assert.equal(rows[0].id, 'a');
});

test('mapas numericos materializados pelo SDK como array nao criam registros nulos', () => {
  assert.deepEqual(fromEnvelope({existe: true, dados: {mapa: ['a', null, 'c']}}),
    {mapa: {'0': 'a', '2': 'c'}});
});

test('ordenacao exclui campos ausentes; filtros nao convertem tipos', () => {
  const rows = [{id: 'a', data: {n: 1}}, {id: 'b', data: {n: '1'}}, {id: 'c', data: {}}];
  assert.deepEqual(applyQuery(rows, [{kind: 'where', field: 'n', op: '==', value: 1}]).map(r => r.id), ['a']);
  assert.equal(applyQuery(rows, [{kind: 'orderBy', field: 'n', direction: 'asc'}]).length, 2);
  assert.throws(() => applyQuery(rows, [{kind: 'where', field: 'n', op: '!=', value: 1}]));
});

test('leitor nega transportador antes de consultar dados e preserva snapshots', async () => {
  let reads = 0;
  const sdk = {ref: (_, path) => path, get: async () => { reads++; return {val: () => ({existe: true, dados: {n: 1}})}; }};
  const denied = createRealtimeReader({sdk, database: {}, authorize: async () => ({ativo: true, perfil: 'transportador'})});
  await assert.rejects(denied.getDoc('availability', 'a'));
  assert.equal(reads, 0);
  const allowed = createRealtimeReader({sdk, database: {}, authorize: async () => ({ativo: true, perfil: 'administrador'})});
  const doc = await allowed.getDoc('availability', 'a');
  const value = doc.data(); value.n = 99;
  assert.deepEqual(doc.data(), {n: 1});
  assert.equal(reads, 1);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function listenerSDK() {
  const state = {reads: 0, detached: 0};
  const sdk = {ref: (_, path) => path, onValue: (_, next, error) => {
    state.reads++; state.emit = value => next({val: () => value}); state.error = error;
    return () => { state.detached++; };
  }};
  return {state, sdk};
}

test('listener cancelado antes da autorizacao nao registra leitura', async () => {
  const {state, sdk} = listenerSDK();
  const reader = createRealtimeReader({sdk, database: {}, authorize: async () => ({ativo: true, perfil: 'administrador'})});
  const stop = reader.watchDoc('availability', 'a', () => assert.fail('Evento inesperado'));
  stop();
  await flush();
  assert.equal(state.reads, 0);
});

test('listener revalida permissao e para sem entregar dados apos revogacao', async () => {
  const {state, sdk} = listenerSDK();
  let active = true;
  const reader = createRealtimeReader({sdk, database: {}, authorize: async () => ({ativo: active, perfil: 'administrador'})});
  const received = [], errors = [];
  reader.watchDoc('availability', 'a', doc => received.push(doc.data()), error => errors.push(error));
  await flush();
  state.emit({existe: true, dados: {n: 1}});
  await flush();
  active = false;
  state.emit({existe: true, dados: {n: 2}});
  await flush();
  assert.deepEqual(received, [{n: 1}]);
  assert.equal(errors.length, 1);
  assert.equal(state.detached, 1);
});

test('listener de colecao atualiza filtros e respeita cancelamento', async () => {
  const {state, sdk} = listenerSDK();
  const reader = createRealtimeReader({sdk, database: {}, authorize: async () => ({ativo: true, perfil: 'interno'})});
  const received = [];
  const stop = reader.watchDocs('availability', [{kind: 'where', field: 'carrier', op: '==', value: 'A'}],
    snapshot => received.push(snapshot.docs.map(doc => doc.id)));
  await flush();
  state.emit({a: {existe: true, dados: {carrier: 'A'}}, b: {existe: true, dados: {carrier: 'B'}}});
  await flush();
  assert.deepEqual(received, [['a']]);
  stop();
  state.emit({c: {existe: true, dados: {carrier: 'A'}}});
  await flush();
  assert.equal(received.length, 1);
});

test('gravacao preserva nulos e vazios e rejeita tipos sem conversao explicita', () => {
  const value = {'a.b': [null, {}, [], false, 0, ''], mapa: {'a/b': 1}, n: null};
  assert.deepEqual(fromEnvelope(JSON.parse(JSON.stringify(toEnvelope(value)))), value);
  for (const bad of [undefined, new Date(), Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => toEnvelope(bad));
  const circular = {}; circular.self = circular;
  assert.throws(() => toEnvelope(circular));
});

test('escritas ficam desligadas por padrao e usuarios internos nao gravam', async () => {
  let calls = 0;
  const sdk = {ref: (_, p) => p, runTransaction: async () => {calls++; return {committed: true};}};
  const admin = async () => ({ativo: true, perfil: 'administrador'});
  await assert.rejects(createRealtimeWriter({sdk, database: {}, authorize: admin}).setDoc('availability', 'a', {}));
  const internal = createRealtimeWriter({sdk, database: {}, authorize: async () => ({ativo: true, perfil: 'interno'}), writesEnabled: true});
  await assert.rejects(internal.deleteDoc('availability', 'a'));
  assert.equal(calls, 0);
});

test('merge transacional usa estado fresco sem apagar campos e permite substituir mapa por vazio', async () => {
  let stored = toEnvelope({outro: 1, marcos: {a: 'anterior', b: 'manter'}, vazio: {antigo: true}});
  const sdk = {ref: (_, p) => p, runTransaction: async (_, callback, options) => {
    assert.equal(options.applyLocally, false);
    callback(null); // O SDK pode chamar antes de carregar o estado remoto.
    stored = callback(stored);
    return {committed: true};
  }};
  const writer = createRealtimeWriter({sdk, database: {}, authorize: async () => ({ativo: true, perfil: 'administrador'}), writesEnabled: true});
  await writer.setDoc('sob_ciclos', 'c', {marcos: {a: 'novo'}, vazio: {}}, {merge: true});
  assert.deepEqual(fromEnvelope(stored), {outro: 1, marcos: {a: 'novo', b: 'manter'}, vazio: {}});
});
