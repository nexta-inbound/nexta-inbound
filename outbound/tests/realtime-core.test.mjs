import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeKey, decodeKey, fromEnvelope, recordPath } from '../assets/realtime-codec.mjs';
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
