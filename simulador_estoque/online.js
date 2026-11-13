import { firebaseAuth as auth, firebaseDatabase as db } from './firebase.js';
import { onAuthStateChanged, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { ref, get, set, update, push, runTransaction, serverTimestamp, onValue } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { entrarPeloCentral, sairDeTudo, irParaLogin, irParaTrocarSenha, gerenciaUsuarios } from '/central/sso.js';

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
const VERSAO_SITE = 'b38dad30b1';
function script(name) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = VERSAO_SITE === 'dev' ? name : `${name}?v=${VERSAO_SITE}`; tag.onload = resolve;
    tag.onerror = () => reject(new Error(`Não foi possível carregar ${name}. Recarregue a página.`));
    document.body.append(tag);
  });
}
const hex = text => Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');

// Login pela tela inicial do site (login unico dos portais, 2026-11-03): a pessoa entra uma vez la' e
// central/sso.js troca aquela sessao por uma deste projeto, com o mesmo uid de sempre. Senha, troca de senha,
// saida e o logout apos 2h sem uso ficam no central; a validade de 72h/90 dias da senha (2026-10-14) saiu junto.
// Os campos do formulario de login do index.html ficam so' para a versao local (login.js).
document.body.classList.add('login-central');
el('trocar-senha').onclick = irParaTrocarSenha;  // a tela inicial troca e devolve a pessoa para ca'
el('logout').onclick = () => sairDeTudo(auth);    // sai tambem do login central
el('login-switch').onclick = el('logout').onclick;
function falhaEntrada(texto) { status(texto); el('login-switch').hidden = false; el('login-inicio').hidden = false; }
status('Entrando com o seu login Nexta…');
// Entra pelo login central e so' entao acompanha a sessao deste projeto (o SDK daqui e' o 12.x: vai a propria
// signInWithCustomToken)
entrarPeloCentral('simulador', auth, {entrarComToken: signInWithCustomToken})
  .then(() => onAuthStateChanged(auth, aoMudarSessao))
  .catch(error => { console.error(error); falhaEntrada(error.message); });
async function aoMudarSessao(user) {
  const version = ++generation;
  document.body.classList.add('auth-pending');
  el('login-screen').hidden = false;
  el('account-bar').hidden = true;
  if (!user) { irParaLogin(); return; }  // sessao encerrada por fora (ex.: acesso tirado no central)
  if (started) return;
  try {
    status('Conferindo acesso e carregando estoques…');
    const profile = (await get(ref(db, `perfis/${user.uid}`))).val();
    if (!profile || profile.email?.toLowerCase() !== user.email?.toLowerCase()
        || !['administrador', 'regional', 'leitura', 'base'].includes(profile.perfil)) {
      throw new Error('Sua conta ainda não tem acesso liberado ao simulador.');
    }
    // Desativado pela aba Usuarios (2026-10-29); as regras do banco tambem negam os dados.
    if (profile.desativado === true) throw new Error('Seu acesso ao simulador foi desativado. Fale com a gestão.');
    // Marca da antiga validade de senha (validade_senhas.py, desligado em 2026-11-03): as regras do banco ainda
    // negam os dados a quem ficou com ela.
    if (profile.acessoBloqueado === true) throw new Error('Seu acesso ao Nextoques está bloqueado. Fale com o administrador.');
    // Aba Aberturas (2026-10-16): as bases preenchem a abertura do dia no portal, no lugar da planilha.
    // Layout (cidades > terminais > produtos) vem de cadastros/aberturas, gerado da planilha por
    // gerar_layout_aberturas.py. Valores em aberturas/<dia>/<empDep>/<produtoHex>; cada alteracao vira
    // uma linha em aberturasHistorico/<dia>/<empDep> (quem, quando, valor anterior e novo).
    // Perfil 'base' edita so' as bases dele (perfis/<uid>/bases/<empDep> = true); admin/regional, todas.
    const aberturasApi = {
      // Quem enxerga a aba: perfil 'base' (so' ela) e quem tiver perfis/<uid>/verAberturas = true. Enquanto
      // o processo e' implantado (usuaria, 2026-10-16: "deixa so eu ver a aba de abertura por enquanto"),
      // so' a conta dela tem a marca; liberar outras pessoas e' so' marcar o perfil.
      // 2026-10-20 (usuaria): a aba fica liberada pra todos os perfis, so' pra ver; edita so' o perfil 'base' (nos
      // terminais dele) e quem tiver perfis/<uid>/editaAberturas = true. Mesma regra do gerar_regras_acesso.py.
      veAberturas() { return true; },
      canEditAbertura(empDep) {
        return profile.editaAberturas === true || (profile.perfil === 'base' && profile.bases?.[empDep] === true);
      },
      produtoKey(produto) { return hex(produto); },
      async aberturasLayout() { return (await get(ref(db, 'cadastros/aberturas'))).val(); },
      async aberturasDoDia(dia) { return (await get(ref(db, `aberturas/${dia}`))).val() || {}; },
      // Referencia do MIS do dia (litros), so' indicativo na tela (2026-10-19). Sem permissao/sem dado = {}.
      async referenciaAberturas(dia) { try { return (await get(ref(db, `aberturas/${dia}/_mis`))).val() || {}; } catch { return {}; } },
      // Botao "Baixar consolidado (Excel)" (usuaria, 2026-10-28: so' ela e a Aiko): marca exportaAberturas no perfil;
      // o modelo da planilha (cadastros/modeloExcelAberturas) so' e' legivel com a marca (gerar_regras_acesso.py).
      podeExportarAberturas() { return profile.exportaAberturas === true; },
      async modeloExcelAberturas() { return (await get(ref(db, 'cadastros/modeloExcelAberturas'))).val(); },
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
      document.body.classList.remove('auth-pending'); el('login-screen').hidden = true;
      el('account-bar').hidden = false;
      el('account-email').textContent = `${profile.nome || user.email} · ${profile.perfil}`;
    };
    // Perfil 'base': ate' 2026-10-21 so' via a aba Aberturas; agora ve todas as abas do simulador como consulta
    // (usuaria: "deixa as outras abas pra eles verem tambem, como Alertas, Cenario") — edita so' as aberturas
    // dos terminais dele; nao salva cenario (canEdit e' so' administrador/regional).
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
      // Painel Duvidas (2026-11-10): guarda a pergunta e o trecho do manual mostrado, com o perfil e SEM nome/uid
      // (usuaria: "nao precisa guardar o nome"). Vai no mesmo update que duvidasRitmo/<uid>: as regras aceitam
      // 1 pergunta a cada 3 s por pessoa. So' quem gerencia usuarios le (relatorio_duvidas.py).
      async registrarDuvida(pergunta, trecho) {
        const id = push(ref(db, 'duvidas')).key;
        await update(ref(db), {
          [`duvidas/${id}`]: {pergunta: String(pergunta).trim().slice(0, 200), trecho: String(trecho || '').slice(0, 200),
            achou: !!trecho, perfil: profile.perfil, em: serverTimestamp()},
          [`duvidasRitmo/${user.uid}`]: serverTimestamp()});
        return id;
      },
      async avaliarDuvida(id, ajudou) { await set(ref(db, `duvidas/${id}/ajudou`), !!ajudou); },
      ...aberturasApi,
      // Aba Usuarios: desde o login central (2026-11-03) so' leva a' tela de Usuarios do portal; aparece para o
      // admin geral e o key user do Nextoques.
      gerenciaUsuarios,
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
    for (const name of ['motor.js', 'sugestao.js', 'app.js', 'editor.js', 'automatico.js', 'cenarios.js', 'compartilhado.js', 'dia.js', 'aberturas.js', 'usuarios.js', 'duvidas.js']) await script(name);
    await concluirEntrada();
    el('auto-status').textContent = `Fontes de ${data.date}. A tela atualiza sozinha quando sai uma carga nova.`;
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
    // Carga principal AO VIVO (usuaria, 2026-10-21: "delays de um usuario pra outro ... de puxar os dados"): antes a
    // carga so' era lida ao abrir a pagina, entao quem abriu antes da ultima publicacao ficava com numeros velhos
    // ate' dar F5. Agora escuta fontes/atual/meta; quando muda a revisao, baixa as 3 regioes de novo, troca no
    // proprio objeto D (mesma referencia do app.js) e refaz a tela com select() — preserva o que a pessoa editou.
    // Carga de OUTRO dia muda o eixo de datas inteiro: ai' so' avisa no topo pra recarregar a pagina.
    // So' baixa com a aba do navegador VISIVEL (2026-10-21: cada carga tem ~5 MB e o plano gratuito do Firebase da'
    // 10 GB/mes de download): aba em segundo plano guarda a revisao nova e baixa uma vez so' quando voltar.
    let revisaoAtual = envelope.revision, baixandoCarga = false, metaPendente = null;
    const aoMudarMeta = async meta => {
      if (!meta?.revision || meta.revision === revisaoAtual || baixandoCarga) return;
      if (document.hidden) { metaPendente = meta; return; }
      metaPendente = null;
      baixandoCarga = true;
      try {
        const nova = JSON.parse(meta.conteudo);
        if (nova.date !== data.date) {
          if (sync) { sync.textContent = '⟳ Carga de um novo dia publicada · clique para atualizar'; sync.style.cursor = 'pointer'; sync.onclick = () => location.reload(); }
          return;
        }
        const partes = await Promise.all(visibleRegions.map(name => get(ref(db, `fontes/atual/regioes/${name}`))));
        const records = [], history = {};
        for (const s of partes) {
          const part = s.val();
          if (!part) continue;
          if (part.revision !== meta.revision) return;  // publicacao em andamento: a proxima mudanca do meta traz tudo
          const content = JSON.parse(part.conteudo);
          records.push(...content.records);
          for (const [day, items] of Object.entries(content.history || {})) history[day] = {...(history[day] || {}), ...items};
        }
        const transitoAtual = data.transitoAoVivo;
        Object.assign(data, nova, {records, history, transitoAoVivo: transitoAtual});
        revisaoAtual = meta.revision;
        textoSync();
        refazer();
      } catch (e) { console.warn('Falha ao baixar a carga atualizada', e); }
      finally { baixandoCarga = false; }
    };
    onValue(ref(db, 'fontes/atual/meta'), snap => aoMudarMeta(snap.val()));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && metaPendente) aoMudarMeta(metaPendente); });
    textoSync();
  } catch (error) { falhaEntrada(errorText(error)); }
}
