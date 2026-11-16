import { getDatabase, ref, get, onValue, runTransaction, push } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { COLLECTION_PATHS } from './realtime-codec.mjs';
import { createRealtimeReader } from './realtime-reader.mjs';
import { createRealtimeWriter } from './realtime-writer.mjs';
import { createCompatibilityApi } from './realtime-compat.mjs';

const contexts = new WeakMap();
// Nome legado mantido apenas para limitar mudancas nas telas. A conexao e Realtime.
export function getFirestore(app) {
  if (app.options.projectId !== 'nexta-outbound' || !app.options.databaseURL) throw new Error('Destino Realtime invalido.');
  const database = getDatabase(app), auth = getAuth(app);
  const context = Object.freeze({backend: 'realtime'});
  const authorize = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Entre pelo portal central antes de consultar o Outbound.');
    const {claims} = await user.getIdTokenResult();
    if (claims.central !== true || !claims.centralUid) throw new Error('Sessao nao vinculada ao central.');
    const profile = (await get(ref(database, 'perfis/' + user.uid))).val();
    if (auth.currentUser?.uid !== user.uid || profile?.centralUid !== claims.centralUid) throw new Error('Vinculo central invalido.');
    return profile;
  };
  const sdk = {ref, get, onValue, runTransaction};
  const reader = createRealtimeReader({sdk, database, authorize});
  const writer = createRealtimeWriter({sdk, database, authorize, writesEnabled: false});
  contexts.set(context, createCompatibilityApi({reader, writer,
    makeId: collection => push(ref(database, COLLECTION_PATHS[collection])).key}));
  return context;
}
const apiFor = reference => {
  const api = contexts.get(reference?.db || reference);
  if (!api) throw new Error('Conexao Realtime nao inicializada.');
  return api;
};
export const collection = (db, name) => apiFor(db).collection(db, name);
export const doc = (parent, ...parts) => apiFor(parent).doc(parent, ...parts);
export const getDoc = reference => apiFor(reference).getDoc(reference);
export const getDocs = reference => apiFor(reference).getDocs(reference);
export const setDoc = (reference, ...args) => apiFor(reference).setDoc(reference, ...args);
export const deleteDoc = reference => apiFor(reference).deleteDoc(reference);
export const onSnapshot = (reference, ...args) => apiFor(reference).onSnapshot(reference, ...args);
export const query = (reference, ...args) => apiFor(reference).query(reference, ...args);
export const writeBatch = db => apiFor(db).writeBatch();
export const where = (field, op, value) => ({kind: 'where', field, op, value});
export const orderBy = (field, direction = 'asc') => ({kind: 'orderBy', field, direction});
export const limit = count => ({kind: 'limit', count});
