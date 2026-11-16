import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import * as central from '/central/cliente.js';
import { podeVerOutbound } from '/central/config.js';
import { openOutboundSession } from './outbound-session.mjs';

const login = () => location.replace('/?entrar&voltar=%2Foutbound%2F');
export async function iniciarSessaoOutbound(app, auth, signInWithCustomToken) {
  const database = getDatabase(app);
  if (!await central.usuarioAtual()) { login(); return new Promise(() => {}); }
  if (!central.vigiarInatividade(async () => { await Promise.allSettled([auth.signOut(), central.sair()]); login(); })) return new Promise(() => {});
  try {
    const session = await openOutboundSession({
      central: {currentUser: central.usuarioAtual, registration: central.meuCadastro, call: central.chamar},
      target: {
        currentUser: () => new Promise(resolve => { const stop = auth.onAuthStateChanged(user => {stop(); resolve(user);}); }),
        signOut: () => auth.signOut(),
        signIn: async token => (await signInWithCustomToken(auth, token)).user,
        profile: async uid => (await get(ref(database, 'perfis/' + uid))).val()
      }, pilotAllowed: podeVerOutbound
    });
    central.aoMudarLogin(async user => {
      if (user?.uid !== session.centralUid) { await auth.signOut(); login(); }
    });
    return session;
  } catch (error) {
    const root = document.getElementById('app');
    if (root) {
      const title = document.createElement('h1'); title.textContent = 'Portal Programação Outbound';
      const message = document.createElement('p'); message.textContent = central.mensagemErro(error);
      const back = document.createElement('a'); back.href = '/?menu'; back.textContent = 'Voltar aos sistemas';
      root.replaceChildren(title, message, back);
    }
    throw error;
  }
}
export async function sairOutbound(auth) {
  await Promise.allSettled([auth.signOut(), central.sair()]);
  login();
}
export const trocarSenhaCentral = () => location.assign('/?senha&voltar=%2Foutbound%2F');
