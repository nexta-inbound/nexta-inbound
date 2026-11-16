import { COLLECTION_PATHS, recordPath, toEnvelope, fromEnvelope } from './realtime-codec.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeFields(current, patch) {
  if (!plain(patch) || !Object.keys(patch).length) return structuredClone(patch);
  const result = new Map(Object.entries(plain(current) ? current : {}));
  for (const [key, value] of Object.entries(patch)) result.set(key, plain(value) ? mergeFields(result.get(key), value) : structuredClone(value));
  return Object.fromEntries(result);
}

// Escrita por documento com transacao. Permanece desligada por padrao.
// Batches usam uma transacao na colecao inteira; nunca transacao na raiz.
export function createRealtimeWriter({sdk, database, authorize, writesEnabled = false}) {
  if (typeof authorize !== 'function') throw new Error('Verificacao de acesso obrigatoria.');
  const check = async () => {
    if (writesEnabled !== true) throw new Error('Gravacoes do piloto ainda desabilitadas.');
    const profile = await authorize();
    if (profile?.ativo !== true || profile.perfil !== 'administrador') throw new Error('Gravacao exige administrador autorizado.');
  };
  async function setDoc(collection, id, data, options = {}) {
    await check();
    // Valida antes de abrir a transacao; callback pode ser repetido pelo SDK.
    const replacement = toEnvelope(data);
    const reference = sdk.ref(database, recordPath(collection, id));
    const result = await sdk.runTransaction(reference, current => {
      if (options.merge !== true) return replacement;
      const original = fromEnvelope(current);
      return toEnvelope(mergeFields(original ?? {}, data));
    }, {applyLocally: false});
    if (!result.committed) throw new Error('Gravacao nao confirmada pelo Realtime.');
  }
  async function deleteDoc(collection, id) {
    await check();
    const result = await sdk.runTransaction(sdk.ref(database, recordPath(collection, id)), () => null, {applyLocally: false});
    if (!result.committed) throw new Error('Exclusao nao confirmada pelo Realtime.');
  }
  async function commitBatch(operations) {
    await check();
    if (!Array.isArray(operations) || !operations.length || operations.length > 500) throw new Error('Lote exige de 1 a 500 operacoes.');
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
