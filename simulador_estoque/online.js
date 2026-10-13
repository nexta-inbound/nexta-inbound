import { firebaseAuth as auth, firebaseDatabase as db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence,
  browserSessionPersistence, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { ref, get, set, runTransaction, serverTimestamp, onValue } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

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
function script(name) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = name; tag.onload = resolve;
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
        || !['administrador', 'regional', 'leitura'].includes(profile.perfil)) {
      throw new Error('Sua conta ainda não tem acesso liberado ao simulador.');
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
      // Varias datas em paralelo (visao semanal) — cada dia falho vira {} em vez de derrubar a semana toda.
      async listRange(dias) {
        const arvores = await Promise.all(dias.map(dia => get(ref(db, `cenariosDia/${dia}`)).then(s => s.val() || {}).catch(() => ({}))));
        return Object.fromEntries(dias.map((dia, i) => [dia, arvores[i]]));
      },
    };
    for (const name of ['motor.js', 'sugestao.js', 'app.js', 'editor.js', 'automatico.js', 'cenarios.js', 'compartilhado.js', 'dia.js']) await script(name);
    started = true;
    registrarAtividade(true);
    document.body.classList.remove('auth-pending'); el('login-screen').hidden = true;
    el('account-bar').hidden = false;
    el('account-email').textContent = `${profile.nome || user.email} · ${profile.perfil}`;
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
