// Login central: app Firebase do projeto central e chamadas às funções (functions/main.py).
// Usado pela tela inicial, pela tela de usuários e pelos sistemas (sso.js).
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { FIREBASE_CENTRAL, APP_CENTRAL, REGIAO_FUNCOES, HORAS_INATIVIDADE } from './config.js';

const app = getApps().find(a => a.name === APP_CENTRAL) || initializeApp(FIREBASE_CENTRAL, APP_CENTRAL);
export const auth = getAuth(app);
const db = getDatabase(app);
const funcoes = getFunctions(app, REGIAO_FUNCOES);

// Primeiro estado do login: o SDK lê a sessão salva no navegador de forma assíncrona
export const usuarioAtual = () => new Promise(resolve => {
  const parar = onAuthStateChanged(auth, usuario => { parar(); resolve(usuario); });
});
export async function entrar(email, senha) {
  const credencial = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), senha);
  registrarAtividade();  // login novo: a marca de antes dele derrubaria a sessão na primeira conferência
  return credencial;
}
export const sair = () => signOut(auth);
export const aoMudarLogin = funcao => onAuthStateChanged(auth, funcao);

// ── Sessão encerrada após HORAS_INATIVIDADE sem uso ──
// A última atividade (mouse, teclado, rolagem, toque) fica no localStorage, que todas as abas do site
// compartilham: usar qualquer sistema mantém os outros abertos. É a mesma chave do relógio próprio do Inbound.
const LIMITE_INATIVIDADE_MS = HORAS_INATIVIDADE * 60 * 60 * 1000;
const CHAVE_ATIVIDADE = 'nextaUltimaAtividade';
let atividadeGravada = 0;
let vigiando = false;
let expirou = false;

function registrarAtividade() {
  atividadeGravada = Date.now();
  try { localStorage.setItem(CHAVE_ATIVIDADE, String(atividadeGravada)); } catch {}
}

// Sem marca nenhuma (primeiro uso neste navegador) não conta como parado
export function inativoHaMuitoTempo() {
  let salvo = NaN;
  try { salvo = parseInt(localStorage.getItem(CHAVE_ATIVIDADE), 10); } catch {}
  const ultima = Math.max(Number.isFinite(salvo) ? salvo : 0, atividadeGravada);
  return ultima > 0 && Date.now() - ultima > LIMITE_INATIVIDADE_MS;
}

// Para páginas com a sessão aberta. aoExpirar encerra a sessão e leva ao login, uma vez só; se a página abriu
// depois do prazo (PC ligado de novo, abas restauradas), chama na hora e devolve false.
export function vigiarInatividade(aoExpirar) {
  if (vigiando) return !expirou;
  vigiando = true;
  const conferir = () => {
    if (expirou || !inativoHaMuitoTempo()) return false;
    expirou = true;
    aoExpirar();
    return true;
  };
  if (conferir()) return false;
  registrarAtividade();
  // Volta depois de muito tempo (PC desbloqueado): confere antes de contar a volta como uso
  const aoUsar = () => {
    if (expirou || Date.now() - atividadeGravada < 30 * 1000) return;  // mousemove dispara dezenas de vezes por segundo
    if (!conferir()) registrarAtividade();
  };
  for (const evento of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    document.addEventListener(evento, aoUsar, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferir(); });
  setInterval(conferir, 60 * 1000);
  return true;
}

// Cadastro da própria pessoa no central (as regras só deixam cada um ler o seu)
export async function meuCadastro() {
  const uid = auth.currentUser?.uid;
  return uid ? (await get(ref(db, `usuarios/${uid}`))).val() : null;
}

// Reautentica com a senha atual (o Firebase exige login recente para trocar) e grava a nova
export async function trocarSenha(senhaAtual, novaSenha) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sessão encerrada. Entre de novo.');
  await reauthenticateWithCredential(usuario, EmailAuthProvider.credential(usuario.email, senhaAtual));
  await updatePassword(usuario, novaSenha);
  await set(ref(db, `usuarios/${usuario.uid}/trocarSenha`), false);
}

export async function chamar(nome, dados = {}) {
  return (await httpsCallable(funcoes, nome)(dados)).data;
}

const MENSAGENS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/user-not-found': 'E-mail não encontrado.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-password': 'Informe a senha.',
  'auth/user-disabled': 'Seu acesso está desativado. Fale com o administrador.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Falha de conexão. Confira a internet e tente de novo.',
  'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
  'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de trocar a senha.',
  'auth/operation-not-allowed': 'O login por e-mail e senha ainda não foi ativado no projeto central.',
  'functions/unavailable': 'Serviço indisponível no momento. Tente de novo em instantes.',
  'functions/deadline-exceeded': 'O servidor demorou para responder. Tente de novo.',
  'functions/internal': 'Erro inesperado no servidor. Tente de novo; se continuar, avise o administrador.',
  'functions/unauthenticated': 'Sua sessão expirou. Entre de novo.',
};
// Erros das funções (permissão, validação) já vêm com a mensagem em português para a tela
const ERROS_COM_MENSAGEM = ['functions/permission-denied', 'functions/invalid-argument', 'functions/not-found',
  'functions/failed-precondition'];

export function mensagemErro(erro) {
  if (ERROS_COM_MENSAGEM.includes(erro?.code) && erro.message) return erro.message;
  return MENSAGENS[erro?.code] || erro?.message || 'Não foi possível concluir.';
}
