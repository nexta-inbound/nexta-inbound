import { firebaseAuth as auth, firebaseDatabase as db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence,
  browserSessionPersistence, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential,
  updatePassword } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { ref, get, set, update, push, runTransaction, serverTimestamp, onValue } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const el = id => document.getElementById(id);
let started = false;
let generation = 0;
function status(text) { el('login-status').textContent = text; }
function errorText(error) {
  return ({'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde antes de tentar novamente.',
    'auth/network-request-failed': 'Falha de conexão. Tente novamente.',
    'PERMISSION_DENIED': 'Seu acesso aos dados ainda não foi liberado.'})[error.code]
    || error.message || 'Não foi possível concluir a operação.';
}
// Versao dos arquivos do site (2026-10-19): preparar_site.py troca 'dev' por um codigo que muda a cada
// alteracao; o ?v=<codigo> obriga o navegador a baixar o arquivo novo (antes ficava com o antigo em cache).
const VERSAO_SITE = '17ed32480f';
function script(name) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = VERSAO_SITE === 'dev' ? name : `${name}?v=${VERSAO_SITE}`; tag.onload = resolve;
    tag.onerror = () => reject(new Error(`Não foi possível carregar ${name}. Recarregue a página.`));
    document.body.append(tag);
  });
}
const hex = text => Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');

// ── Logout por inatividade (pedido da usuaria, 2026-10-10: "tem como fazer isso no simulador tbm?", igual
// ao portal inbound). Apos 2h sem mouse/teclado/rolagem/toque em QUALQUER aba do simulador (a ultima
// atividade fica em localStorage, compartilhada entre abas), sai e volta pra tela de login. Nada se perde:
// o rascunho do simulador ja' e' gravado no navegador a cada edicao e o "Salvar na equipe" e' manual.
const INATIVIDADE_LIMITE_MS = 2 * 60 * 60 * 1000;
const ULTIMA_ATIVIDADE_KEY = 'simEstoqueUltimaAtividade';
const LOGOUT_INATIVIDADE_FLAG = 'simEstoqueLogoutInatividade';
const MSG_INATIVIDADE = 'Sessão encerrada após 2h sem uso. Entre novamente.';
let ultimaAtividadeGravada = 0, encerrando = false;
function registrarAtividade(forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimaAtividadeGravada < 30 * 1000) return;  // mousemove dispara dezenas de vezes/s
  ultimaAtividadeGravada = agora;
  try { localStorage.setItem(ULTIMA_ATIVIDADE_KEY, String(agora)); } catch {}
}
function inativoHaMuitoTempo() {
  let salvo = NaN;
  try { salvo = parseInt(localStorage.getItem(ULTIMA_ATIVIDADE_KEY), 10); } catch {}
  const ultima = Math.max(Number.isFinite(salvo) ? salvo : 0, ultimaAtividadeGravada);
  return ultima > 0 && Date.now() - ultima > INATIVIDADE_LIMITE_MS;
}
async function encerrarPorInatividade() {
  if (encerrando || !auth.currentUser) return;
  encerrando = true;
  try { sessionStorage.setItem(LOGOUT_INATIVIDADE_FLAG, '1'); } catch {}
  try { await signOut(auth); } catch {}
  location.reload();  // o reload ja' traz a versao publicada mais recente do site
}
function verificarInatividade() { if (started && inativoHaMuitoTempo()) encerrarPorInatividade(); }
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(evento =>
  document.addEventListener(evento, () => { if (started) registrarAtividade(); }, {capture: true, passive: true}));
// Voltar pra aba / desbloquear o PC: confere ANTES de contar a volta como atividade.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarInatividade(); });
setInterval(verificarInatividade, 60 * 1000);
el('login-show').onchange = () => { el('login-password').type = el('login-show').checked ? 'text' : 'password'; };
el('login-form').onsubmit = async event => {
  event.preventDefault(); el('login-submit').disabled = true; status('Entrando…');
  registrarAtividade(true);  // zera o relogio: uma marca antiga nao pode derrubar a sessao recem-aberta
  try { await signInWithEmailAndPassword(auth, el('login-email').value.trim(), el('login-password').value); }
  catch (error) { status(errorText(error)); }
  finally { el('login-password').value = ''; el('login-submit').disabled = false; }
};
el('login-reset').onclick = async () => {
  if (!el('login-email').reportValidity()) return;
  try { await sendPasswordResetEmail(auth, el('login-email').value.trim()); status('Solicitação enviada. Confira seu e-mail.'); }
  catch (error) { status(errorText(error)); }
};
el('logout').onclick = async () => { await signOut(auth); location.reload(); };
// Trocar a propria senha (pedido da usuaria, 2026-10-14, igual ao portal inbound): reautentica com a
// senha atual e grava a nova no Firebase Auth. Nada passa por servidor nosso.
const dialogoSenha = el('senha-dialogo');
function limparSenha() { for (const id of ['senha-atual', 'senha-nova', 'senha-confirma']) el(id).value = ''; el('senha-info').textContent = ''; }
el('trocar-senha').onclick = () => { limparSenha(); dialogoSenha.showModal(); el('senha-atual').focus(); };
el('senha-cancelar').onclick = () => { if (!senhaObrigatoria) dialogoSenha.close(); };
el('senha-form').onsubmit = async event => {
  event.preventDefault();
  const info = el('senha-info'), atual = el('senha-atual').value, nova = el('senha-nova').value;
  if (!atual) { info.textContent = 'Informe a senha atual.'; return; }
  if (nova.length < 6) { info.textContent = 'A nova senha deve ter pelo menos 6 caracteres.'; return; }
  if (nova !== el('senha-confirma').value) { info.textContent = 'A confirmação não corresponde à nova senha.'; return; }
  if (nova === atual) { info.textContent = 'A nova senha deve ser diferente da atual.'; return; }
  const user = auth.currentUser; if (!user) { info.textContent = 'Sessão encerrada. Entre novamente.'; return; }
  el('senha-salvar').disabled = true; info.textContent = 'Atualizando senha…';
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, atual));
    await updatePassword(user, nova);
    info.textContent = 'Senha atualizada com sucesso.';
    senhaTrocada();
    setTimeout(() => dialogoSenha.close(), 1200);
    if (aguardarLiberacao) setTimeout(() => esperarLiberacao(auth.currentUser), 1300);
  } catch (error) {
    info.textContent = ({'auth/wrong-password': 'Senha atual incorreta.', 'auth/invalid-credential': 'Senha atual incorreta.',
      'auth/weak-password': 'A nova senha é muito fraca.', 'auth/too-many-requests': 'Muitas tentativas. Aguarde antes de tentar novamente.',
      'auth/requires-recent-login': 'Sessão expirada. Saia e entre novamente antes de trocar a senha.'})[error.code] || errorText(error);
  } finally { el('senha-salvar').disabled = false; }
};

// ── Validade da senha (pedido da usuaria, 2026-10-14) ──
// Senha temporaria (a da criacao da conta, nunca trocada): 72h pra trocar, depois o login e' bloqueado e
// so' "Esqueci minha senha" resolve. Senha propria: vale 90 dias; avisa nos 5 ultimos; vencida, a pessoa
// so' usa o portal depois de trocar. A data vem do proprio Firebase Auth (passwordUpdatedAt, que tambem
// muda quando a senha e' redefinida pelo "Esqueci minha senha"). Prazos de quem ja tinha conta contam a
// partir da entrada da regra, pra ninguem ser bloqueado de surpresa. E' regra do portal, nao do banco.
const HORA = 3600 * 1000, DIA = 24 * HORA;
const SENHA_TEMPORARIA_MS = 72 * HORA, SENHA_VALIDADE_MS = 90 * DIA, SENHA_AVISO_MS = 5 * DIA;
const POLITICA_SENHA_DESDE = Date.parse('2026-10-14T18:00:00-03:00');
let senhaObrigatoria = false, aguardarLiberacao = false;
// Depois da troca, o script da maquina logistica tira o bloqueio do banco em ate' ~1 min; a tela confere
// o proprio perfil a cada 10 s e recarrega quando liberar.
async function esperarLiberacao(user) {
  if (!user) return;
  status('Senha em dia. Liberando seu acesso… isso leva até 2 minutos.');
  const limite = Date.now() + 10 * 60 * 1000;
  while (Date.now() < limite) {
    try { if ((await get(ref(db, `perfis/${user.uid}/acessoBloqueado`))).val() !== true) { location.reload(); return; } } catch {}
    await new Promise(r => setTimeout(r, 10000));
  }
  status('O acesso ainda não foi liberado. Tente entrar de novo em alguns minutos ou avise o administrador do simulador.');
}
async function senhaAtualizadaEm(user) {
  const direto = Number(user.reloadUserInfo?.passwordUpdatedAt);
  if (direto) return direto;
  try {
    const resposta = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${auth.app.options.apiKey}`,
      {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({idToken: await user.getIdToken()})});
    return Number((await resposta.json()).users?.[0]?.passwordUpdatedAt) || null;
  } catch { return null; }
}
async function situacaoSenha(user, profile) {
  const atualizada = await senhaAtualizadaEm(user);
  if (!atualizada) return {tipo: 'ok'};  // sem a data, nao bloqueia ninguem
  const agora = Date.now(), criada = Date.parse(user.metadata.creationTime);
  const temporaria = Math.abs(atualizada - criada) < 2 * 60 * 1000
    || (profile.senhaTemporariaEm && atualizada <= profile.senhaTemporariaEm + 2 * 60 * 1000);
  if (temporaria) {
    const prazo = Math.max(atualizada, POLITICA_SENHA_DESDE) + SENHA_TEMPORARIA_MS;
    return agora > prazo ? {tipo: 'bloqueada'} : {tipo: 'temporaria', prazo, atualizada};
  }
  const vence = Math.max(atualizada, POLITICA_SENHA_DESDE) + SENHA_VALIDADE_MS;
  if (agora > vence) return {tipo: 'vencida', vence};
  return vence - agora <= SENHA_AVISO_MS ? {tipo: 'aviso', vence} : {tipo: 'ok', vence};
}
const quando = t => new Date(t).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
function mostrarAvisoSenha(senha) {
  const aviso = el('aviso-senha');
  if (senha.tipo === 'temporaria') {
    aviso.querySelector('span').textContent = `Você está usando a senha inicial. Troque agora: no próximo login a troca será obrigatória, e sem troca até ${quando(senha.prazo)} o acesso fica bloqueado (só volta com “Esqueci minha senha”).`;
  } else if (senha.tipo === 'aviso') {
    const dias = Math.max(1, Math.ceil((senha.vence - Date.now()) / DIA));
    aviso.querySelector('span').textContent = `Sua senha vence em ${dias} dia(s), em ${quando(senha.vence)}. Troque agora para não perder o acesso.`;
  } else { aviso.hidden = true; return; }
  aviso.dataset.tipo = senha.tipo; aviso.hidden = false;
}
// Troca obrigatoria (a janela nao fecha): senha vencida, ou senha inicial no primeiro acesso — igual ao
// gerenciador de adicionais ("Defina sua nova senha", pedido da usuaria 2026-10-14).
function abrirTrocaObrigatoria(motivo = 'vencida') {
  senhaObrigatoria = true;
  limparSenha();
  el('senha-titulo').textContent = motivo === 'inicial' ? 'Defina sua nova senha' : 'Sua senha venceu';
  el('senha-explica').textContent = motivo === 'inicial'
    ? 'Por segurança, troque a senha inicial (a que você recebeu do administrador) antes de continuar.'
    : 'A senha do simulador vale 3 meses. Crie uma nova senha para continuar.';
  // Obrigatorio de verdade (usuaria, 2026-10-14): sem Cancelar nem Sair, so' Salvar.
  el('senha-cancelar').hidden = true;
  el('aviso-senha').hidden = true;
  dialogoSenha.showModal(); el('senha-atual').focus();
}
function senhaTrocada() {
  senhaObrigatoria = false;
  el('aviso-senha').hidden = true;
  el('senha-cancelar').hidden = false;
  el('senha-titulo').textContent = 'Trocar senha';
  el('senha-explica').textContent = 'Informe sua senha atual e a nova senha (mínimo de 6 caracteres).';
}
dialogoSenha.addEventListener('cancel', event => { if (senhaObrigatoria) event.preventDefault(); });
// O Chrome deixa o Esc fechar o <dialog> mesmo com preventDefault (sem interacao recente na pagina);
// na troca obrigatoria a janela reabre na hora.
dialogoSenha.addEventListener('close', () => { if (senhaObrigatoria) dialogoSenha.showModal(); });
el('aviso-senha-trocar').onclick = () => el('trocar-senha').click();
el('login-switch').onclick = el('logout').onclick;
await setPersistence(auth, browserSessionPersistence);
el('login-submit').disabled = el('login-reset').disabled = false;
status('Entre com o e-mail liberado para o simulador.');
try {
  if (sessionStorage.getItem(LOGOUT_INATIVIDADE_FLAG)) { sessionStorage.removeItem(LOGOUT_INATIVIDADE_FLAG); status(MSG_INATIVIDADE); }
} catch {}
onAuthStateChanged(auth, async user => {
  const version = ++generation;
  document.body.classList.add('auth-pending');
  el('login-screen').hidden = false;
  el('account-bar').hidden = true;
  if (!user) { if (started) location.reload(); return; }
  if (started) return;
  // F5 numa aba que ficou mais de 2h parada (a sessao do Firebase sobrevive ao F5 na mesma aba).
  if (inativoHaMuitoTempo()) { try { await signOut(auth); } catch {} status(MSG_INATIVIDADE); return; }
  try {
    status('Conferindo acesso e carregando estoques…');
    const profile = (await get(ref(db, `perfis/${user.uid}`))).val();
    if (!profile || profile.email?.toLowerCase() !== user.email?.toLowerCase()
        || !['administrador', 'regional', 'leitura', 'base'].includes(profile.perfil)) {
      throw new Error('Sua conta ainda não tem acesso liberado ao simulador.');
    }
    const senha = await situacaoSenha(user, profile);
    if (senha.tipo === 'bloqueada') {
      try { await signOut(auth); } catch {}
      status('Sua senha temporária expirou (prazo de 72 horas sem troca). Clique em “Esqueci minha senha” para criar uma nova.');
      return;
    }
    // Protecao no banco (2026-10-14): com acessoBloqueado, o banco nega os dados. Troca a senha antes de
    // carregar (se ela for o motivo) e espera o script da maquina logistica liberar o perfil.
    if (profile.acessoBloqueado === true) {
      if (senha.tipo === 'vencida' || senha.tipo === 'temporaria') {
        status('Troque sua senha para continuar.');
        aguardarLiberacao = true;
        abrirTrocaObrigatoria(senha.tipo === 'vencida' ? 'vencida' : 'inicial');
      } else esperarLiberacao(user);
      return;
    }
    // Aba Aberturas (2026-10-16): as bases preenchem a abertura do dia no portal, no lugar da planilha.
    // Layout (cidades > terminais > produtos) vem de cadastros/aberturas, gerado da planilha por
    // gerar_layout_aberturas.py. Valores em aberturas/<dia>/<empDep>/<produtoHex>; cada alteracao vira
    // uma linha em aberturasHistorico/<dia>/<empDep> (quem, quando, valor anterior e novo).
    // Perfil 'base' edita so' as bases dele (perfis/<uid>/bases/<empDep> = true); admin/regional, todas.
    const aberturasApi = {
      // Quem enxerga a aba: perfil 'base' (so' ela) e quem tiver perfis/<uid>/verAberturas = true. Enquanto
      // o processo e' implantado (usuaria, 2026-10-16: "deixa so eu ver a aba de abertura por enquanto"),
      // so' a conta dela tem a marca; liberar outras pessoas e' so' marcar o perfil.
      veAberturas() { return profile.perfil === 'base' || profile.verAberturas === true; },
      canEditAbertura(empDep) {
        return profile.admin === true || profile.perfil === 'regional' || (profile.perfil === 'base' && profile.bases?.[empDep] === true);
      },
      produtoKey(produto) { return hex(produto); },
      async aberturasLayout() { return (await get(ref(db, 'cadastros/aberturas'))).val(); },
      async aberturasDoDia(dia) { return (await get(ref(db, `aberturas/${dia}`))).val() || {}; },
      // Referencia do MIS do dia (litros), so' indicativo na tela (2026-10-19). Sem permissao/sem dado = {}.
      async referenciaAberturas(dia) { try { return (await get(ref(db, `aberturas/${dia}/_mis`))).val() || {}; } catch { return {}; } },
      async historicoAberturas(dia, empDep) { return (await get(ref(db, `aberturasHistorico/${dia}/${empDep}`))).val() || {}; },
      // Grava o terminal inteiro numa operacao so' (valores + historico das mudancas). `linhas`:
      // [{produto, unidade, valores:{abertura, recebEfetuado, recebProgramado}, anteriores:{...}|null}].
      async salvarAberturaTerminal(dia, empDep, terminal, linhas) {
        const autorNome = profile.nome || user.email, caminhos = {};
        for (const l of linhas) {
          const chave = hex(l.produto);
          caminhos[`aberturas/${dia}/${empDep}/${chave}`] = {terminal, produto: l.produto, unidade: l.unidade, ...l.valores,
            atualizadoPor: user.uid, atualizadoPorNome: autorNome, atualizadoEm: serverTimestamp()};
          for (const campo of ['abertura', 'recebEfetuado', 'recebProgramado']) {
            const de = l.anteriores?.[campo] ?? null, para = l.valores[campo];
            if (de === para || (de === null && para === 0)) continue;   // campo em branco salvo como 0 nao e' alteracao
            caminhos[`aberturasHistorico/${dia}/${empDep}/${push(ref(db, `aberturasHistorico/${dia}/${empDep}`)).key}`] =
              {produto: l.produto, campo, de, para, por: user.uid, porNome: autorNome, em: serverTimestamp()};
          }
        }
        await update(ref(db), caminhos);
      },
    };
    // Fim comum do login (os dois caminhos: completo e so' Aberturas).
    const concluirEntrada = async () => {
      started = true;
      registrarAtividade(true);
      document.body.classList.remove('auth-pending'); el('login-screen').hidden = true;
      el('account-bar').hidden = false;
      el('account-email').textContent = `${profile.nome || user.email} · ${profile.perfil}`;
      mostrarAvisoSenha(senha);
      if (senha.tipo === 'vencida') abrirTrocaObrigatoria('vencida');
      else if (senha.tipo === 'temporaria') {
        // Senha inicial (regra da usuaria, 2026-10-14): o 1o login com ela e' livre (so' fica o aviso); a
        // partir do 2o, a troca e' obrigatoria. "1o login" = ainda nao ha primeiroAcessoEm desta senha inicial.
        if (!profile.primeiroAcessoEm || profile.primeiroAcessoEm < senha.atualizada) {
          try { await set(ref(db, `perfis/${user.uid}/primeiroAcessoEm`), serverTimestamp()); }
          catch (e) { console.warn('Não foi possível registrar o primeiro acesso', e); }
        } else abrirTrocaObrigatoria('inicial');
      }
    };
    // Perfil 'base' (decisao da usuaria, 2026-10-16: "so a aba de abertura"): nao baixa os estoques nem
    // carrega o simulador — so' a aba Aberturas. As regras do banco tambem negam fontes/cenarios pra ele.
    if (profile.perfil === 'base') {
      if (version !== generation || auth.currentUser?.uid !== user.uid) return;
      window.SIM_AUTH = {uid: user.uid, email: user.email, profile, soAberturas: true};
      window.SIM_CLOUD = {...aberturasApi};
      await script('aberturas.js');
      await concluirEntrada();
      return;
    }
    // A carga continua publicada por região, mas todo perfil baixa todas (sem segregação, 2026-10-09).
    const visibleRegions = ['SP', 'MG_RJ', 'CO'];
    const [metaSnapshot, regions, transitoSnapshot, ...regionSnapshots] = await Promise.all([
      get(ref(db, 'fontes/atual/meta')), get(ref(db, 'cadastros/regioes')), get(ref(db, 'transitoAoVivo')),
      ...visibleRegions.map(name => get(ref(db, `fontes/atual/regioes/${name}`))),
    ]);
    const envelope = metaSnapshot.val();
    if (!envelope?.conteudo) throw new Error('A carga de estoque ainda não foi publicada.');
    const data = JSON.parse(envelope.conteudo);
    data.records = [];
    data.history = {};
    // Transito FOB/CIF ao vivo (pedido da usuaria, 2026-10-02): publicado a parte, fora do ciclo de
    // 30 min do snapshot principal, por publicar_transito_ao_vivo.py (le direto o Firebase do portal
    // inbound). So' fica tao "ao vivo" quanto o recarregamento da pagina — mesmo nivel do resto da
    // tela, que ja' nao se atualiza sozinha dentro da mesma aba ("Recarregue a pagina...").
    data.transitoAoVivo = transitoSnapshot.val()?.porBase || null;
    window.SIM_TRANSITO_EM = transitoSnapshot.val()?.meta?.atualizadoEm || null;  // horario na linha do FOB/CIF
    for (const snap of regionSnapshots) {
      const part = snap.val();
      if (!part) continue;
      if (part.revision !== envelope.revision)
        throw new Error('A carga de estoque foi atualizada durante o carregamento. Recarregue a página.');
      const content = JSON.parse(part.conteudo);
      data.records.push(...content.records);
      for (const [day, items] of Object.entries(content.history || {}))
        data.history[day] = {...(data.history[day] || {}), ...items};
    }
    if (!data.records.length || !data.date || !data.bi || !data.revision)
      throw new Error('A carga de estoque está incompleta ou não há dados para a sua região.');
    if (version !== generation || auth.currentUser?.uid !== user.uid) return;
    window.ESTOQUE_DATA = data;
    window.SIM_AUTH = {uid: user.uid, email: user.email, profile};
    window.SIM_CLOUD = {
      // Edita qualquer base: administrador e regional; perfil 'leitura' (Thiago/Thales) só consulta.
      canEdit(base) { return profile.admin === true || profile.perfil === 'regional'; },
      async list(base) { return (await get(ref(db, `cenarios/${hex(base)}`))).val() || {}; },
      async save(base, id, content, expected) {
        const result = await runTransaction(ref(db, `cenarios/${hex(base)}/${id}`), current => {
          if ((current === null) !== (expected === null)
              || (current && ['base', 'conteudo', 'atualizadoPor', 'atualizadoEm'].some(key => current[key] !== expected[key]))) return;
          return {base, conteudo: JSON.stringify(content), atualizadoPor: user.uid, atualizadoEm: serverTimestamp()};
        }, {applyLocally: false});
        if (!result.committed) throw new Error('Este cenário foi alterado por outra pessoa. Abra a versão atual antes de salvar.');
        return result.snapshot.val();
      },
      regionOf(base) { return regions.val()?.[hex(base)]; },
      // Chave estavel (destino ja e' o nivel acima no caminho) — nao usa o id da linha da planilha de
      // abertura porque a ordem das linhas pode mudar de um dia pro outro, quebrando a comparacao entre
      // dias na visao consolidada.
      dailyKey(deposito, produto, cenario) { return hex(`${deposito}|${produto}|${cenario}`); },
      async listDailyVersions(dia, base, chave) {
        return (await get(ref(db, `cenariosDia/${dia}/${hex(base)}/${chave}/versoes`))).val() || {};
      },
      // Numero da versao vem de um contador com runTransaction (mesmo padrao de contadoresViagem no
      // portal inbound), pra duas pessoas salvando ao mesmo tempo nunca ganharem o mesmo numero. Depois
      // do numero definido, grava o registro em versoes/<numero>; as regras recusam sobrescrever esse
      // caminho (create-only), entao a visao do dia nunca muda depois de salva.
      async saveDailyVersion(dia, base, chave, payload) {
        const contadorRef = ref(db, `cenariosDia/${dia}/${hex(base)}/${chave}/contador`);
        const resultado = await runTransaction(contadorRef, atual => (atual || 0) + 1);
        const numero = resultado.snapshot.val();
        const registro = {...payload, versao: numero, autor: user.uid, autorNome: profile.nome || user.email,
          atualizadoEm: serverTimestamp()};
        await set(ref(db, `cenariosDia/${dia}/${hex(base)}/${chave}/versoes/${numero}`), registro);
        return {...registro, numero};
      },
      async listDay(dia) { return (await get(ref(db, `cenariosDia/${dia}`))).val() || {}; },
      ...aberturasApi,
      // Dias 15..29 sob demanda (botao "+ fim do LE", 2026-10-19): {record_id: {iso: dia}} das 3 regioes.
      async carregarExtensao() {
        const partes = await Promise.all(visibleRegions.map(r => get(ref(db, `fontes/extensao/${r}`)).then(s => s.val()).catch(() => null)));
        const saida = {};
        for (const p of partes) if (p?.conteudo && p.data === data.date) Object.assign(saida, JSON.parse(p.conteudo));
        return saida;
      },
      // Varias datas em paralelo (visao semanal) — cada dia falho vira {} em vez de derrubar a semana toda.
      async listRange(dias) {
        const arvores = await Promise.all(dias.map(dia => get(ref(db, `cenariosDia/${dia}`)).then(s => s.val() || {}).catch(() => ({}))));
        return Object.fromEntries(dias.map((dia, i) => [dia, arvores[i]]));
      },
    };
    for (const name of ['motor.js', 'sugestao.js', 'app.js', 'editor.js', 'automatico.js', 'cenarios.js', 'compartilhado.js', 'dia.js', 'aberturas.js']) await script(name);
    await concluirEntrada();
    el('auto-status').textContent = `Fontes de ${data.date}. Recarregue a página para buscar uma nova carga.`;
    const sync = el('sync-status');
    const textoSync = () => {
      if (!sync || !data.bi?.extractedAt) return;
      const quando = new Date(data.bi.extractedAt), hm = d => d.toLocaleString('pt-BR', {hour: '2-digit', minute: '2-digit'});
      sync.textContent = 'Sincronizado ' + quando.toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})
        + (transitoEm ? ` · trânsito ${hm(transitoEm)}` : '');
      sync.title = 'Dados das fontes lidos em ' + quando.toLocaleString('pt-BR')
        + (transitoEm ? `\nTrânsito FOB/CIF atualizado em tempo real às ${transitoEm.toLocaleTimeString('pt-BR')}` : '');
    };
    // Transito em TEMPO REAL (2026-10-10, igual ao portal inbound): escuta transitoAoVivo/meta; quando
    // o transito_tempo_real.py publica, baixa SO' as bases alteradas, troca em D.transitoAoVivo e refaz a
    // tela com select() — que preserva o que a pessoa editou (mergeSource/sourceBaseline). Se ela estiver
    // digitando num campo, espera sair do campo pra nao roubar o foco.
    let transitoEm = transitoSnapshot.val()?.meta?.atualizadoEm ? new Date(transitoSnapshot.val().meta.atualizadoEm) : null;
    let ultimoMeta = transitoSnapshot.val()?.meta?.atualizadoEm || null, refazerPendente = false;
    const digitando = () => document.activeElement?.matches?.('input, select, textarea');
    const refazer = () => {
      if (digitando()) { refazerPendente = true; return; }
      refazerPendente = false;
      try { window.select?.(); } catch (e) { console.warn('Falha ao atualizar o trânsito na tela', e); }
    };
    document.addEventListener('focusout', () => setTimeout(() => { if (refazerPendente) refazer(); }, 300));
    onValue(ref(db, 'transitoAoVivo/meta'), async snap => {
      const meta = snap.val();
      if (!meta?.atualizadoEm || meta.atualizadoEm === ultimoMeta) return;
      ultimoMeta = meta.atualizadoEm;
      const alteradas = Array.isArray(meta.alteradas) ? meta.alteradas : null;
      try {
        if (!alteradas) data.transitoAoVivo = (await get(ref(db, 'transitoAoVivo/porBase'))).val() || {};
        else {
          data.transitoAoVivo = data.transitoAoVivo || {};
          const novos = await Promise.all(alteradas.map(ed => get(ref(db, `transitoAoVivo/porBase/${ed}`))));
          alteradas.forEach((ed, i) => { const v = novos[i].val(); if (v) data.transitoAoVivo[ed] = v; else delete data.transitoAoVivo[ed]; });
        }
        transitoEm = new Date(meta.atualizadoEm); window.SIM_TRANSITO_EM = meta.atualizadoEm; textoSync();
        if (!alteradas || alteradas.length) refazer();
        else document.querySelectorAll('.fonte-hora[data-fonte="transito"]').forEach(n => { n.outerHTML = window.horaFonte?.('transito') || ''; });
      } catch (e) { console.warn('Falha ao baixar o trânsito atualizado', e); }
    });
    textoSync();
  } catch (error) { status(errorText(error)); el('login-switch').hidden = false; }
});
