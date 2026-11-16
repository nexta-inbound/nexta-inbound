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
    return querySnapshot(collection, constraints, snapshot.val());
  }
  function querySnapshot(collection, constraints, value, previous = []) {
    const raw = value || {};
    const rows = Object.entries(raw).map(([id, envelope]) => ({id: decodeKey(id), data: fromEnvelope(envelope)}))
      .filter(row => row.data !== undefined);
    // Piloto restrito: filtra colecao autorizada inteira em memoria.
    // Substituir por indices/escopos antes de habilitar transportadores ou ampliar volume.
    const docs = applyQuery(rows, constraints).map(row => Object.freeze({id: row.id,
      exists: () => true, data: () => structuredClone(row.data), ref: Object.freeze({collection, id: row.id})}));
    const oldById = new Map(previous.map((doc, index) => [doc.id, {doc, index}]));
    const newById = new Map(docs.map((doc, index) => [doc.id, {doc, index}]));
    const changes = [];
    for (const [id, old] of oldById) {
      if (!newById.has(id)) changes.push({type: 'removed', doc: old.doc, oldIndex: old.index, newIndex: -1});
    }
    for (const [id, current] of newById) {
      const old = oldById.get(id);
      if (!old || JSON.stringify(old.doc.data()) !== JSON.stringify(current.doc.data())) {
        changes.push({type: old ? 'modified' : 'added', doc: current.doc, oldIndex: old?.index ?? -1, newIndex: current.index});
      }
    }
    return Object.freeze({docs: Object.freeze(docs), size: docs.length, empty: docs.length === 0,
      docChanges: () => changes.map(change => ({...change})),
      forEach: callback => docs.forEach(callback)});
  }
  function watch(path, convert, next, onError = () => {}) {
    if (typeof next !== 'function' || typeof onError !== 'function') throw new Error('Callbacks invalidos.');
    if (typeof sdk.onValue !== 'function') throw new Error('SDK sem suporte a listeners.');
    let closed = false;
    let detach = () => {};
    let events = Promise.resolve();
    const stop = () => { if (closed) return; closed = true; detach(); };
    const fail = error => {
      if (closed) return;
      stop();
      onError(error);
    };
    Promise.resolve().then(check).then(() => {
      if (closed) return;
      detach = sdk.onValue(sdk.ref(database, path), snapshot => {
        events = events.then(async () => {
          if (closed) return;
          // Revalida antes de entregar cada evento; as regras do banco continuam obrigatorias.
          await check();
          if (!closed) next(convert(snapshot.val()));
        }).catch(fail);
      }, fail);
      if (closed) detach();
    }).catch(fail);
    return stop;
  }
  const watchDoc = (collection, id, next, onError) => watch(recordPath(collection, id),
    value => documentSnapshot(collection, id, value), next, onError);
  function watchDocs(collection, constraints, next, onError) {
    if (!COLLECTION_PATHS[collection]) throw new Error('Colecao nao mapeada.');
    let previous = [];
    return watch(COLLECTION_PATHS[collection], value => {
      const snapshot = querySnapshot(collection, constraints, value, previous);
      previous = snapshot.docs;
      return snapshot;
    }, next, onError);
  }
  return Object.freeze({getDoc, getDocs, watchDoc, watchDocs});
}
