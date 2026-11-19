import { COLLECTION_PATHS, recordPath, toEnvelope, fromEnvelope } from './realtime-codec.mjs';
import { fieldValue } from './realtime-query.mjs';
import { CAMPO_TRANSPORTADORA } from './realtime-reader.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeFields(current, patch) {
  if (!plain(patch) || !Object.keys(patch).length) return structuredClone(patch);
  const result = new Map(Object.entries(plain(current) ? current : {}));
  for (const [key, value] of Object.entries(patch)) result.set(key, plain(value) ? mergeFields(result.get(key), value) : structuredClone(value));
  return Object.fromEntries(result);
}

// O que cada perfil grava (as REGRAS do banco sao a garantia; isto so' evita tentar o que sera' negado):
//   administrador / interno -> tudo, como no Outbound antigo (regras: cadastros de usuarios so' admin)
//   transportador           -> so' a propria disponibilidade e o proprio bloqueio, e acrescentar auditoria/aviso
// Listas "so' acrescenta" (auditoria, notificacoes): gravacao direta de registro novo, sem transacao (a transacao
// precisaria LER o lugar vazio, e o transportador nao le essas listas).
const TRANSPORTADOR_GRAVA = new Set(['availability', 'locks']);
const SO_ACRESCENTA = new Set(['auditoria', 'notificacoes']);
const negado = e => /permission|denied|permiss/i.test(String(e?.code || '') + ' ' + String(e?.message || ''));

export function createRealtimeWriter({sdk, database, authorize, writesEnabled = false}) {
  if (typeof authorize !== 'function') throw new Error('Verificacao de acesso obrigatoria.');
  const check = async (collection, data) => {
    if (writesEnabled !== true) throw new Error('Gravacoes do piloto ainda desabilitadas.');
    const profile = await authorize();
    if (profile?.ativo !== true) throw new Error('Gravacao exige perfil ativo.');
    if (['administrador', 'interno'].includes(profile.perfil)) return profile;
    if (profile.perfil === 'transportador' && profile.transportadorNome) {
      if (SO_ACRESCENTA.has(collection)) return profile;
      if (TRANSPORTADOR_GRAVA.has(collection)) {
        if (data !== undefined && fieldValue(data, CAMPO_TRANSPORTADORA[collection]) !== profile.transportadorNome) {
          throw new Error('Registro de outra transportadora: gravacao bloqueada.');
        }
        return profile;
      }
    }
    throw new Error('Gravacao nao permitida para este perfil.');
  };
  const direto = profile => profile.perfil === 'transportador';
  async function setDoc(collection, id, data, options = {}) {
    const profile = await check(collection, data);
    const reference = sdk.ref(database, recordPath(collection, id));
    if (SO_ACRESCENTA.has(collection)) {
      await sdk.set(reference, toEnvelope(data));
      return;
    }
    if (direto(profile)) {
      // Transportador: sem transacao (nao pode ler registro inexistente). Merge so' sobre o proprio registro.
      let atual;
      if (options.merge === true) {
        try { atual = fromEnvelope((await sdk.get(reference)).val()); } catch (e) { if (!negado(e)) throw e; }
      }
      const valor = options.merge === true ? mergeFields(atual ?? {}, data) : data;
      if (fieldValue(valor, CAMPO_TRANSPORTADORA[collection]) !== profile.transportadorNome) {
        throw new Error('Registro de outra transportadora: gravacao bloqueada.');
      }
      await sdk.set(reference, toEnvelope(valor));
      return;
    }
    const replacement = toEnvelope(data);
    const result = await sdk.runTransaction(reference, current => {
      if (options.merge !== true) return replacement;
      const original = fromEnvelope(current);
      return toEnvelope(mergeFields(original ?? {}, data));
    }, {applyLocally: false});
    if (!result.committed) throw new Error('Gravacao nao confirmada pelo Realtime.');
  }
  async function deleteDoc(collection, id) {
    const profile = await check(collection);
    const reference = sdk.ref(database, recordPath(collection, id));
    if (direto(profile)) { await sdk.remove(reference); return; }
    const result = await sdk.runTransaction(reference, () => null, {applyLocally: false});
    if (!result.committed) throw new Error('Exclusao nao confirmada pelo Realtime.');
  }
  async function commitBatch(operations) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 500) throw new Error('Lote exige de 1 a 500 operacoes.');
    const profile = await check(operations[0].collection);
    if (direto(profile)) throw new Error('Lote nao disponivel para transportador.');
    const collection = operations[0].collection;
    const seen = new Set();
    for (const operation of operations) {
      const path = recordPath(operation.collection, operation.id);
      if (operation.collection !== collection) throw new Error('Lote entre colecoes distintas ainda nao suportado.');
      if (seen.has(path)) throw new Error('Documento repetido no lote.');
      seen.add(path);
      if (!['set', 'update', 'delete'].includes(operation.type)) throw new Error('Operacao de lote invalida.');
      if (operation.type !== 'delete') {
        if (!plain(operation.data)) throw new Error('Gravacao exige objeto.');
        if (operation.type === 'update' && Object.keys(operation.data).some(key => key.includes('.'))) throw new Error('Update com caminho pontuado exige adaptacao explicita.');
        toEnvelope(operation.data);
      }
    }
    let applied = false;
    let missing = '';
    const result = await sdk.runTransaction(sdk.ref(database, COLLECTION_PATHS[collection]), current => {
      applied = false; missing = '';
      // O primeiro callback pode vir sem cache. Retornar o estado atual permite
      // ao servidor resolver o conflito e repetir com os dados existentes.
      // Se o registro realmente nao existir, o lote termina sem alteracoes.
      const entries = new Map(Object.entries(current || {}).filter(([, value]) => value !== null));
      for (const operation of operations) {
        const id = recordPath(collection, operation.id).split('/').at(-1);
        if (operation.type === 'update' && entries.get(id)?.existe !== true) {
          missing = operation.id;
          return current;
        }
      }
      for (const operation of operations) {
        const id = recordPath(collection, operation.id).split('/').at(-1);
        if (operation.type === 'delete') { entries.delete(id); continue; }
        const original = fromEnvelope(entries.get(id));
        const value = operation.type === 'update'
          ? Object.fromEntries([...Object.entries(original), ...Object.entries(operation.data)])
          : operation.options?.merge === true ? mergeFields(original ?? {}, operation.data) : operation.data;
        entries.set(id, toEnvelope(value));
      }
      applied = true;
      return entries.size ? Object.fromEntries(entries) : null;
    }, {applyLocally: false});
    if (!result.committed) throw new Error('Lote nao confirmado pelo Realtime.');
    if (!applied) throw new Error('Lote nao aplicado: registro ausente ' + missing);
  }
  return Object.freeze({setDoc, deleteDoc, commitBatch});
}
