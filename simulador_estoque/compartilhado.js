'use strict';
(() => {
  const cloud = window.SIM_CLOUD;
  let currentId = null, expected = null, context = '', busy = false;
  // So' "Salvar na equipe" fica visivel (pedido da usuaria, 2026-10-02: "teria como tirar esses
  // botoes? exceto o salvar na equipe"). "Abrir cenário"/"Salvar como novo"/lista/atualizar foram
  // tirados da tela — o codigo de abrir/listar cenarios salvos (cloud.list/refresh) foi removido
  // junto, ja' que nada mais chama. `save()` continua podendo ser chamado com `copy=true` no futuro
  // se a funcionalidade "salvar como novo" precisar voltar.
  const bar = document.createElement('div');
  bar.className = 'cloud-bar';
  bar.innerHTML = '<div class="cloud-bar-actions">'
    + '<button id="cloud-save" class="primary">Salvar na equipe</button>'
    + '</div><small id="cloud-status" role="status"></small>';
  document.querySelector('.filters').after(bar);
  const note = text => { $('cloud-status').textContent = text; };
  // Sem record (filtro de regiao pode zerar a lista de bases), usa uma chave estavel em vez de quebrar.
  const identity = () => record ? [record.id, D.date, state.scenario].join('|') : 'sem-registro';
  const previousKey = key;
  key = () => `${window.SIM_AUTH.uid}:${previousKey()}`;
  // Não reutilizar rascunhos deixados por outra conta no mesmo navegador.
  select();
  // Modo combinado (2+ depositos/empresas somados, pedido da usuaria 2026-10-05): edicao local livre
  // igual sempre foi (o filtro de regiao ja' restringe quais bases entram na combinacao, em
  // registrosAtuais()/basesPermitidas()) — so' "Salvar na equipe" fica bloqueado, porque nao existe
  // uma unica base pra registrar o cenario salvo.
  const editable = () => Boolean(record) && (modoCombinado || cloud.canEdit(record.base));
  function lock() {
    const allowed = editable();
    const podeSalvarEquipe = allowed && !modoCombinado;
    document.querySelectorAll('[data-row], [data-param], [data-edit-key], #name').forEach(input => {
      input.disabled = !allowed;
    });
    // 'reset' e 'import' (botoes do topo) foram tirados da tela em 2026-10-02 — 'reset-tabela' (↺
    // Restaurar, junto da tabela) e' quem faz a restauracao agora; 'import' nao tem mais substituto.
    for (const id of ['reset-tabela', 'repeat-day']) {
      $(id).disabled = !allowed || busy;
    }
    $('cloud-save').disabled = !podeSalvarEquipe || busy;
    if (context !== identity()) {
      context = identity(); currentId = null; expected = null;
      note(modoCombinado ? 'Modo combinado: edição liberada, mas não dá pra salvar na equipe (não existe uma base só pra registrar).' : allowed ? 'Rascunho local. Use Salvar na equipe para compartilhar.' : 'Consulta: edição desta base não liberada para seu perfil.');
    }
  }
  const previousRender = render;
  render = function(...args) { previousRender(...args); lock(); };
  const previousEditor = renderEditor;
  renderEditor = function(...args) { previousEditor(...args); lock(); };
  async function run(action) {
    if (busy) return;
    busy = true; lock();
    try { await action(); } catch (error) { note(error.message); }
    finally { busy = false; lock(); }
  }
  // Indicadores da visao do dia: calculados sobre os proximos 14 dias (mesma janela da simulacao).
  // Critico = fechamento negativo ou abaixo do lastro; atencao = no minimo ou abaixo, sem ser critico.
  function indicators(content) {
    const result = E.calculate(content, n);
    let low = Infinity, lowDay = null, critico = 0, atencao = 0, ruptura = null;
    result.forEach((r, i) => {
      if (r.close < low) { low = r.close; lowDay = day(i); }
      const isCritico = r.close < 0 || (content.lastro !== null && r.close < content.lastro);
      const isAtencao = !isCritico && content.min !== null && r.close <= content.min;
      if (isCritico) critico++; else if (isAtencao) atencao++;
      if (r.close < 0 && ruptura === null) ruptura = day(i);
    });
    const out = {menorEstoque: Math.round(low * 100) / 100, diaMenorEstoque: lowDay, diasAtencao: atencao,
      diasCritico: critico, situacao: critico > 0 ? 'critico' : atencao > 0 ? 'atencao' : 'ok'};
    if (ruptura) out.primeiraRuptura = ruptura;
    return out;
  }
  // Depois de salvar na equipe, tambem registra uma versao na visao do dia (imutavel — ver online.js).
  // Falha aqui nao desfaz o salvamento acima, que ja esta commitado; so avisa.
  async function saveDaily(base, content) {
    const deposito = record.bi.emp_dep;
    const dia = D.date, chave = cloud.dailyKey(deposito, record.product, content.scenario);
    const existentes = Object.values(await cloud.listDailyVersions(dia, base, chave));
    let motivo = '';
    if (existentes.length) {
      const ultima = existentes.sort((a, b) => b.versao - a.versao)[0];
      const prosseguir = confirm(`Já existe uma visão salva hoje para ${base} · ${record.product} · `
        + `${content.scenario} (v${ultima.versao}, por ${ultima.autorNome}). Salvar uma nova versão? `
        + 'A anterior continua no histórico.');
      if (!prosseguir) { note('Cenário salvo para a equipe. Visão do dia não atualizada.'); return; }
      motivo = (prompt('Motivo da nova versão (obrigatório):', '') || '').trim();
      if (!motivo) throw new Error('Informe o motivo para salvar uma nova versão na visão do dia.');
    }
    await cloud.saveDailyVersion(dia, base, chave, {base, deposito, produto: record.product, cenario: content.scenario,
      nome: content.name, motivo, conteudo: JSON.stringify(content), fonteRevisao: D.revision,
      indicadores: indicators(content)});
    document.dispatchEvent(new CustomEvent('visao-dia:atualizar', {detail: {dia}}));
    note('Cenário salvo para a equipe e na visão do dia.');
  }
  async function save(copy) {
    if (modoCombinado) throw new Error('Modo combinado: não dá pra salvar na equipe, só existe cenário salvo por base.');
    if (!editable()) throw new Error('Seu perfil permite apenas consultar esta base.');
    const content = E.validate(structuredClone(state));
    const name = prompt('Nome do cenário para a equipe:', content.name);
    if (name === null) return;
    content.name = name.trim();
    if (!content.name || content.name.length > 80) throw new Error('Informe um nome de até 80 caracteres.');
    const selection = identity(), base = record.base;
    const id = copy || !currentId ? crypto.randomUUID() : currentId;
    // Buscar antes da transação também preenche o cache usado no primeiro callback.
    const latest = (await cloud.list(base))[id] || null;
    const prior = copy || !currentId ? null : expected;
    if ((latest === null) !== (prior === null) || (latest && ['base', 'conteudo', 'atualizadoPor', 'atualizadoEm'].some(key => latest[key] !== prior[key]))) throw new Error('Cenário alterado por outra pessoa. Abra a versão atual antes de salvar.');
    const saved = await cloud.save(base, id, content, prior);
    if (selection !== identity()) return;
    currentId = id; expected = saved; state.name = content.name;
    persist(); note('Cenário salvo para a equipe.');
    try { await saveDaily(base, content); }
    catch (error) { note(`Cenário salvo para a equipe, mas a visão do dia falhou: ${error.message}`); }
  }
  $('cloud-save').onclick = () => run(() => save(false));
  lock();
  // Exposta pra dia.js reaproveitar o mesmo calculo de risco (critico/atencao/ok) no fallback "LE
  // padrao ao vivo" dos Riscos da semana (pedido da usuaria, 2026-10-01) — sem duplicar a logica aqui.
  window.SIM_INDICATORS = indicators;
})();
