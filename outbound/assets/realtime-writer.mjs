import { recordPath, toEnvelope, fromEnvelope } from './realtime-codec.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeFields(current, patch) {
  if (!plain(patch) || !Object.keys(patch).length) return structuredClone(patch);
  const result = new Map(Object.entries(plain(current) ? current : {}));
  for (const [key, value] of Object.entries(patch)) result.set(key, plain(value) ? mergeFields(result.get(key), value) : structuredClone(value));
  return Object.fromEntries(result);
}

// Escrita por documento com transacao. Permanece desligada por padrao.
// Nao substitui batches atomicos multi-registro nem regras no servidor.
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
  return Object.freeze({setDoc, deleteDoc});
}
