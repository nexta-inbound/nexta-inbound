import { getDatabase, ref, get, onValue, runTransaction, push, set, remove, query as consultaRealtime, orderByChild, equalTo } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { COLLECTION_PATHS } from './realtime-codec.mjs';
import { createRealtimeReader } from './realtime-reader.mjs';
import { createRealtimeWriter } from './realtime-writer.mjs';
import { createCompatibilityApi } from './realtime-compat.mjs';

const contexts = new WeakMap();

// Pasta do Histórico de Roteirizações (SharePoint "Historico Roteirizações", sincronizada no PC de cada um).
// Gravar arquivo na pasta não passa pelo banco, então o writesEnabled não protege: até a virada o Outbound novo
// (inclusive homologação e localhost ?gravar, que usam dados de teste) só LÊ a pasta — pedido da usuária 23/11/2026:
// "só abrir e ver as roteirizações que já estão na pasta, sem salvar nada". Na virada: true, junto com as gravações.
const PASTA_HISTORICO_LIBERADA = false;
// Semana de testes (24/11/2026, pedido da usuária): o site publicado grava no nexta-outbound para Arley/Natanael
// testarem tudo. Só internos têm o Outbound marcado; o que for gravado é apagado na virada pela cópia final
// (copia_final_outbound.py --nova-foto --aplicar --espelhar). Para voltar a só leitura: false.
const GRAVACAO_SEMANA_TESTES = true;
const AVISO_PASTA = 'Outbound novo em teste: a pasta "Historico Roteirizações" (a real) é só para consulta. Nada foi salvo nela. Para testar salvar/publicar no Telão, escolha uma pasta de teste no Histórico.';
// Semana de testes (24/11/2026): a trava vale só quando a pasta escolhida no Histórico é a REAL (nome
// "Historico Roteirizações", com ou sem acento). Pasta de teste com outro nome → salvar e publicar no Telão funcionam.
function pastaHistoricoEhAReal() {
  let pasta = null;
  try { pasta = typeof dirHandleHistorico !== 'undefined' ? dirHandleHistorico : null; } catch { pasta = null; }
  if (!pasta?.name) return false; // sem pasta escolhida o app não grava arquivo nenhum
  const nome = pasta.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return nome.includes('historico roteirizac');
}
function travarPastaHistoricoSoLeitura() {
  if (window.__pastaHistoricoTravada) return;
  window.__pastaHistoricoTravada = true;
  const negar = () => Promise.reject(new DOMException(AVISO_PASTA, 'NotAllowedError'));
  const F = window.FileSystemFileHandle?.prototype, D = window.FileSystemDirectoryHandle?.prototype;
  if (F) {
    const originalWritable = F.createWritable;     // salvar / reescrever arquivo
    F.createWritable = function (...a) { return pastaHistoricoEhAReal() ? negar() : originalWritable.apply(this, a); };
  }
  if (D) {
    const originalRemove = D.removeEntry, original = D.getFileHandle, originalDir = D.getDirectoryHandle;
    D.removeEntry = function (...a) { return pastaHistoricoEhAReal() ? negar() : originalRemove.apply(this, a); };
    D.getFileHandle = function (nome, opcoes) {    // criar arquivo novo
      return opcoes?.create && pastaHistoricoEhAReal() ? negar() : original.call(this, nome, opcoes);
    };
    D.getDirectoryHandle = function (nome, opcoes) {
      return opcoes?.create && pastaHistoricoEhAReal() ? negar() : originalDir.call(this, nome, opcoes);
    };
  }
}
// Nome legado mantido apenas para limitar mudancas nas telas. A conexao e Realtime.
export function getFirestore(app) {
  // Producao (nexta-outbound) ou homologacao (testes com contas ficticias, 17/11/2026).
  const homologacao = app.options.projectId === 'nexta-outbound-homologacao';
  if ((app.options.projectId !== 'nexta-outbound' && !homologacao) || !app.options.databaseURL) throw new Error('Destino Realtime invalido.');
  const database = getDatabase(app), auth = getAuth(app);
  const context = Object.freeze({backend: 'realtime'});
  // Perfil lido no maximo 1x por minuto (antes: 1 leitura de perfis/<uid> a CADA consulta da tela, 2026-11-19).
  let perfilMemo = null;
  const authorize = async () => {
    const user = auth.currentUser;
    if (user && perfilMemo && perfilMemo.uid === user.uid && Date.now() - perfilMemo.em < 60000) return perfilMemo.perfil;
    const perfil = await authorizeSemMemo();
    if (auth.currentUser) perfilMemo = {uid: auth.currentUser.uid, em: Date.now(), perfil};
    return perfil;
  };
  const authorizeSemMemo = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Entre pelo portal central antes de consultar o Outbound.');
    const {claims} = await user.getIdTokenResult();
    if (claims.central !== true || !claims.centralUid) throw new Error('Sessao nao vinculada ao central.');
    const profile = (await get(ref(database, 'perfis/' + user.uid))).val();
    if (auth.currentUser?.uid !== user.uid || profile?.centralUid !== claims.centralUid) throw new Error('Vinculo central invalido.');
    return profile;
  };
  const sdk = {ref, get, onValue, runTransaction, set, remove, query: consultaRealtime, orderByChild, equalTo};
  const reader = createRealtimeReader({sdk, database, authorize});
  // Gravacoes: ligadas so' na homologacao. Em producao seguem desligadas ate' a virada (decisao da usuaria).
  // Teste de gravacao no banco real (19/11/2026, autorizado pela usuaria): SO' no localhost (servidor_local) e
  // so' com ?gravar na URL. O site publicado (nexta-logistica.com.br) nunca entra aqui. As regras do banco
  // continuam valendo (transportador so' grava o que e' dele).
  const testeLocal = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('gravar');
  const writer = createRealtimeWriter({sdk, database, authorize, writesEnabled: homologacao || testeLocal || GRAVACAO_SEMANA_TESTES});
  if (!PASTA_HISTORICO_LIBERADA) travarPastaHistoricoSoLeitura();
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
// Passa a conexao adiante: sem ela, todo lote recusava as referencias ("Referencia de outra conexao").
export const writeBatch = db => apiFor(db).writeBatch(db);
export const where = (field, op, value) => ({kind: 'where', field, op, value});
export const orderBy = (field, direction = 'asc') => ({kind: 'orderBy', field, direction});
export const limit = count => ({kind: 'limit', count});
