import { COLLECTION_PATHS, recordPath } from './realtime-codec.mjs';

// Fachada temporaria para as chamadas existentes, sem SDK Firestore.
export function createCompatibilityApi({reader, writer, makeId}) {
  const collection = (db, name) => {
    if (!db || !COLLECTION_PATHS[name]) throw new Error('Colecao nao mapeada: ' + name);
    return Object.freeze({kind: 'collection', db, collection: name, constraints: []});
  };
  function doc(parent, name, id) {
    let db, col, identifier;
    if (parent?.kind === 'collection') {
      db = parent.db; col = parent.collection;
      identifier = name === undefined ? makeId(col) : name;
    } else {
      db = parent; col = name; identifier = id;
    }
    recordPath(col, identifier);
    return Object.freeze({kind: 'document', db, collection: col, id: identifier});
  }
  const query = (reference, ...constraints) => {
    if (reference?.kind !== 'collection') throw new Error('Consulta exige colecao.');
    return Object.freeze({...reference, constraints: [...reference.constraints, ...constraints]});
  };
  function requireDoc(reference) {
    if (reference?.kind !== 'document') throw new Error('Referencia de documento obrigatoria.');
  }
  const wrapDocument = (reference, snapshot) => Object.freeze({...snapshot,
    ref: doc(reference.db, reference.collection, snapshot.id)});
  function wrapQuery(reference, snapshot) {
    const docs = Object.freeze(snapshot.docs.map(item => wrapDocument(reference, item)));
    return Object.freeze({...snapshot, docs, forEach: callback => docs.forEach(callback),
      docChanges: () => snapshot.docChanges().map(change => ({...change, doc: wrapDocument(reference, change.doc)}))});
  }
  const getDoc = reference => {
    requireDoc(reference);
    return reader.getDoc(reference.collection, reference.id).then(snapshot => wrapDocument(reference, snapshot));
  };
  const getDocs = reference => {
    if (reference?.kind !== 'collection') throw new Error('Referencia de colecao obrigatoria.');
    return reader.getDocs(reference.collection, reference.constraints).then(snapshot => wrapQuery(reference, snapshot));
  };
  function onSnapshot(reference, next, error) {
    if (reference?.kind === 'document') return reader.watchDoc(reference.collection, reference.id, snapshot => next(wrapDocument(reference, snapshot)), error);
    if (reference?.kind === 'collection') return reader.watchDocs(reference.collection, reference.constraints, snapshot => next(wrapQuery(reference, snapshot)), error);
    throw new Error('Referencia invalida.');
  }
  const setDoc = (reference, value, options) => {
    requireDoc(reference);
    return writer.setDoc(reference.collection, reference.id, value, options);
  };
  const deleteDoc = reference => {
    requireDoc(reference);
    return writer.deleteDoc(reference.collection, reference.id);
  };
  function writeBatch(db) {
    const operations = [];
    let committed = false;
    const append = (type, reference, data, options) => {
      if (committed) throw new Error('Lote ja encerrado.');
      requireDoc(reference);
      if (reference.db !== db) throw new Error('Referencia de outra conexao.');
      operations.push({type, collection: reference.collection, id: reference.id,
        ...(type === 'delete' ? {} : {data: structuredClone(data)}),
        ...(options ? {options: structuredClone(options)} : {})});
      return batch;
    };
    const batch = {set: (reference, data, options) => append('set', reference, data, options),
      update: (reference, data) => append('update', reference, data),
      delete: reference => append('delete', reference),
      async commit() {
        if (committed) throw new Error('Lote ja encerrado.');
        committed = true;
        if (!writer.commitBatch) throw new Error('Batch atomico nao configurado.');
        return writer.commitBatch(operations);
      }};
    return Object.freeze(batch);
  }
  return Object.freeze({collection, doc, query, getDoc, getDocs, onSnapshot, setDoc, deleteDoc, writeBatch,
    where: (field, op, value) => Object.freeze({kind: 'where', field, op, value}),
    orderBy: (field, direction = 'asc') => Object.freeze({kind: 'orderBy', field, direction}),
    limit: count => Object.freeze({kind: 'limit', count})});
}
