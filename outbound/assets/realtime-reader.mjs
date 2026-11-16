import { COLLECTION_PATHS, recordPath, decodeKey, fromEnvelope } from './realtime-codec.mjs';
import { applyQuery } from './realtime-query.mjs';

// Leitor do piloto interno. O SDK e injetado para testar sem conexao com Firebase.
// Nao possui operacoes de escrita. Nao deve ser usado para transportadores.
export function createRealtimeReader({sdk, database, authorize}) {
  if (typeof authorize !== 'function') throw new Error('Verificacao de acesso obrigatoria.');
  const check = async () => {
    const profile = await authorize();
    if (!profile?.ativo || !['administrador', 'interno'].includes(profile.perfil)) {
      throw new Error('Leitor disponivel apenas para o piloto interno autorizado.');
    }
  };
  function documentSnapshot(collection, id, envelope) {
    const value = fromEnvelope(envelope);
    return Object.freeze({id, exists: () => value !== undefined,
      data: () => value === undefined ? undefined : structuredClone(value),
      ref: Object.freeze({collection, id})});
  }
  async function getDoc(collection, id) {
    await check();
    const snapshot = await sdk.get(sdk.ref(database, recordPath(collection, id)));
    return documentSnapshot(collection, id, snapshot.val());
  }
  async function getDocs(collection, constraints = []) {
    await check();
    if (!COLLECTION_PATHS[collection]) throw new Error('Colecao nao mapeada.');
    const snapshot = await sdk.get(sdk.ref(database, COLLECTION_PATHS[collection]));
    const raw = snapshot.val() || {};
    const rows = Object.entries(raw).map(([id, envelope]) => ({id: decodeKey(id), data: fromEnvelope(envelope)}))
      .filter(row => row.data !== undefined);
    // Piloto restrito: filtra colecao autorizada inteira em memoria.
    // Substituir por indices/escopos antes de habilitar transportadores ou ampliar volume.
    const docs = applyQuery(rows, constraints).map(row => Object.freeze({id: row.id,
      exists: () => true, data: () => structuredClone(row.data), ref: Object.freeze({collection, id: row.id})}));
    return Object.freeze({docs, size: docs.length, empty: docs.length === 0,
      forEach: callback => docs.forEach(callback)});
  }
  return Object.freeze({getDoc, getDocs});
}
