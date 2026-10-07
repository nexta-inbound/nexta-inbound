import { firebaseAuth as auth, firebaseDatabase as db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence,
  browserSessionPersistence, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { ref, get, set, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

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
el('login-show').onchange = () => { el('login-password').type = el('login-show').checked ? 'text' : 'password'; };
el('login-form').onsubmit = async event => {
  event.preventDefault(); el('login-submit').disabled = true; status('Entrando…');
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
onAuthStateChanged(auth, async user => {
  const version = ++generation;
  document.body.classList.add('auth-pending');
  el('login-screen').hidden = false;
  el('account-bar').hidden = true;
  if (!user) { if (started) location.reload(); return; }
  if (started) return;
  try {
    status('Conferindo acesso e carregando estoques…');
    const profile = (await get(ref(db, `perfis/${user.uid}`))).val();
    if (!profile || profile.email?.toLowerCase() !== user.email?.toLowerCase()
        || !['administrador', 'regional', 'leitura'].includes(profile.perfil)) {
      throw new Error('Sua conta ainda não tem acesso liberado ao simulador.');
    }
    // A carga é publicada por região: administrador e leitura baixam todas; regional, só a sua.
    const visibleRegions = profile.admin === true || profile.perfil === 'leitura'
      ? ['SP', 'MG_RJ', 'CO'] : [profile.regiao];
    if (!visibleRegions[0]) throw new Error('Sua conta não tem região definida. Peça a liberação ao administrador.');
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
      canEdit(base) { return profile.admin === true || (profile.perfil === 'regional' && regions.val()?.[hex(base)] === profile.regiao); },
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
    for (const name of ['motor.js', 'app.js', 'editor.js', 'automatico.js', 'cenarios.js', 'compartilhado.js', 'dia.js']) await script(name);
    started = true;
    document.body.classList.remove('auth-pending'); el('login-screen').hidden = true;
    el('account-bar').hidden = false;
    el('account-email').textContent = `${profile.nome || user.email} · ${profile.perfil}`;
    el('auto-status').textContent = `Fontes de ${data.date}. Recarregue a página para buscar uma nova carga.`;
    const sync = el('sync-status');
    if (sync && data.bi?.extractedAt) {
      const quando = new Date(data.bi.extractedAt);
      sync.textContent = 'Sincronizado ' + quando.toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
      sync.title = 'Dados das fontes lidos em ' + quando.toLocaleString('pt-BR');
    }
  } catch (error) { status(errorText(error)); el('login-switch').hidden = false; }
});
