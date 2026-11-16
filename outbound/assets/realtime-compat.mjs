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
  function writeBatch() {
    // Nunca substituir batch por varias gravacoes independentes.
    const batch = {set() {return batch;}, update() {return batch;}, delete() {return batch;},
      async commit() {throw new Error('Batch atomico multi-registro ainda nao habilitado no piloto Realtime.');}};
    return Object.freeze(batch);
  }
  return Object.freeze({collection, doc, query, getDoc, getDocs, onSnapshot, setDoc, deleteDoc, writeBatch,
    where: (field, op, value) => Object.freeze({kind: 'where', field, op, value}),
    orderBy: (field, direction = 'asc') => Object.freeze({kind: 'orderBy', field, direction}),
    limit: count => Object.freeze({kind: 'limit', count})});
}
