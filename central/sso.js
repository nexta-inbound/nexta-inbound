// Login central dentro de um sistema (agendamento, inbound...): a pessoa entra uma vez na tela inicial e o
// sistema troca essa sessão por uma do próprio projeto Firebase (função entrarNoSistema → signInWithCustomToken),
// com o mesmo uid de sempre naquele projeto. Senha, troca de senha e saída ficam na tela inicial.
//
//   import { entrarPeloCentral, sairDeTudo, irParaTrocarSenha } from '/central/sso.js';
//   await entrarPeloCentral('agendamento', auth);   // auth = getAuth(app do sistema); depois, onAuthStateChanged
//
// O auth do sistema só é usado pelos métodos da própria instância (signOut, onAuthStateChanged), que valem em
// qualquer versão do SDK; quem usa outra versão (Nextoques, 12.x) passa a própria signInWithCustomToken.
import { signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth as authCentral, usuarioAtual, meuCadastro, chamar, sair as sairDoCentral, mensagemErro,
  inativoHaMuitoTempo, vigiarInatividade } from './cliente.js';
import { SISTEMAS } from './config.js';

// Falha que a página do sistema mostra para a pessoa (sem acesso, desativado, servidor fora...)
export class ErroAcesso extends Error {}

// ?voltar só aceita caminho (a tela inicial recusa endereço externo e ?query); ?inativo faz o login avisar o motivo
const enderecoLogin = (inativo = false) => `/?voltar=${encodeURIComponent(location.pathname)}${inativo ? '&inativo' : ''}`;
let estaSaindo = false;
let cadastroCentral = null;
let sistemaAtual = '';
let gravarPendencias = null;
// Sessão sendo encerrada: o banco do sistema corta as leituras abertas, e a página não deve tratar como erro
export const saindo = () => estaSaindo;

function irPara(endereco) {
  estaSaindo = true;
  location.replace(endereco);
  return new Promise(() => {});  // a página está saindo: quem chamou não segue adiante
}

const primeiroEstado = auth => new Promise(resolve => {
  const parar = auth.onAuthStateChanged(usuario => { parar(); resolve(usuario); });
});

// Gancho antesDeSair do sistema (ex.: o Inbound grava o autosave pendente), enquanto a sessão dele ainda vale;
// sem travar a saída se o banco não responder
async function gravarAntesDeSair() {
  if (!gravarPendencias) return;
  await Promise.race([Promise.resolve().then(gravarPendencias).catch(erro => console.error(erro)),
    new Promise(resolve => setTimeout(resolve, 5000))]);
}

// Saiu do central (ou entrou outra pessoa) em outra aba: encerra a sessão do sistema e volta para o login
function vigiarCentral(uidCentral, authSistema) {
  authCentral.onAuthStateChanged(async usuario => {
    if (estaSaindo || usuario?.uid === uidCentral) return;
    estaSaindo = true;
    await gravarAntesDeSair();
    await authSistema.signOut().catch(() => {});
    location.replace(enderecoLogin(inativoHaMuitoTempo()));
  });
}

// Prazo sem uso vencido (relógio em cliente.js): encerra o sistema e o central, e o login avisa o motivo
async function sairPorInatividade(authSistema) {
  estaSaindo = true;
  await gravarAntesDeSair();
  await Promise.allSettled([authSistema.signOut(), sairDoCentral()]);
  location.replace(enderecoLogin(true));
}

// opcoes.entrarComToken: signInWithCustomToken da versão do SDK do sistema (padrão: a 10.12.2 daqui)
// opcoes.antesDeSair: função (pode ser async) chamada antes de a sessão cair por inatividade ou por saída em
// outra aba
export async function entrarPeloCentral(sistema, authSistema, opcoes = {}) {
  const { entrarComToken = signInWithCustomToken, antesDeSair = null } = opcoes;
  sistemaAtual = sistema;
  gravarPendencias = antesDeSair;
  const nome = SISTEMAS[sistema]?.nome || 'este sistema';
  const pessoa = await usuarioAtual();
  if (!pessoa) return irPara(enderecoLogin());
  if (!vigiarInatividade(() => sairPorInatividade(authSistema))) return new Promise(() => {});
  let cadastro;
  try { cadastro = await meuCadastro(); } catch (erro) { throw new ErroAcesso(mensagemErro(erro)); }
  if (!cadastro || cadastro.ativo === false) {
    throw new ErroAcesso('Seu login não está liberado. Fale com o key user do sistema que você usa.');
  }
  cadastroCentral = cadastro;
  if (cadastro.trocarSenha === true) return irPara(enderecoLogin());  // a tela inicial pede a troca e volta
  if (cadastro.acessos?.[sistema] !== true) {
    await authSistema.signOut().catch(() => {});
    throw new ErroAcesso(`Você não tem acesso ao ${nome}. Fale com o key user do sistema.`);
  }
  vigiarCentral(pessoa.uid, authSistema);

  // Sessão do sistema já aberta pelo central para esta mesma pessoa: segue com ela
  const atual = await primeiroEstado(authSistema);
  if (atual) {
    const { claims } = await atual.getIdTokenResult().catch(() => ({ claims: {} }));
    if (claims.central === true && claims.centralUid === pessoa.uid) return atual;
  }
  // Sem sessão, sessão antiga (login por senha do sistema) ou de outra pessoa: troca pela do central
  try {
    const { token } = await chamar('entrarNoSistema', { sistema });
    return (await entrarComToken(authSistema, token)).user;
  } catch (erro) {
    if (erro?.code === 'functions/unauthenticated') return irPara(enderecoLogin());
    throw new ErroAcesso(mensagemErro(erro));
  }
}

// "Sair" no sistema: encerra o sistema e o central e volta ao login da tela inicial
export async function sairDeTudo(authSistema) {
  estaSaindo = true;
  await Promise.allSettled([authSistema.signOut(), sairDoCentral()]);
  location.replace('/?entrar');
}

// Sessão do sistema encerrada por fora (ex.: acesso desativado): volta ao login central
export function irParaLogin() {
  if (!estaSaindo) irPara(enderecoLogin());  // no "Sair", a própria saída já leva à tela inicial
}

// Admin geral ou key user do sistema: cadastra pessoas na tela de Usuários (/usuarios/)
export const gerenciaUsuarios = () =>
  cadastroCentral?.adminGeral === true || cadastroCentral?.keyUser?.[sistemaAtual] === true;

// A troca de senha é na tela inicial; depois ela devolve a pessoa para cá
export function irParaTrocarSenha() {
  location.assign(`/?senha&voltar=${encodeURIComponent(location.pathname)}`);
}
