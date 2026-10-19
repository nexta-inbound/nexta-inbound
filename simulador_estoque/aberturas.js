'use strict';
// Aba "Aberturas" (pedido da usuaria, 2026-10-16): as bases preenchem a abertura do dia no portal, no
// lugar da planilha "Envio Abertura Bases/DD.MM.AAAA.xlsx". Mesmo desenho da planilha: menu de cidades
// com Enviado/Pendente e, em cada cidade, um bloco por terminal com Abertura Dia, Receb. Efetuado /
// Disponivel e Receb. Programado (litros; aditivos em frascos). Edicao livre, com historico de quem
// alterou, quando e o valor anterior (online.js: SIM_CLOUD.salvarAberturaTerminal).
// So' existe no modo hospedado (Firebase); no modo local a aba some.
(function () {
  const cloud = window.SIM_CLOUD;
  const botaoAba = document.querySelector('#abas-bar [data-aba-alvo="aberturas"]');
  if (!cloud?.aberturasLayout || !cloud.veAberturas?.()) {
    if (botaoAba) botaoAba.hidden = true;
    // Aba lembrada de outro acesso (localStorage) mas sem permissao agora: volta pra Simulacao.
    if (document.body.dataset.aba === 'aberturas') document.querySelector('#abas-bar [data-aba-alvo="simulacao"]')?.click();
    return;
  }
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = v => v == null ? '' : Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 0});
  const hojeIso = () => new Date().toLocaleDateString('sv-SE');
  const CAMPOS = [['abertura', 'Abertura Dia'], ['recebEfetuado', 'Receb. Efetuado / Disponível'], ['recebProgramado', 'Receb. Programado Dia']];
  const ROTULO_CAMPO = {abertura: 'Abertura', recebEfetuado: 'Receb. efetuado / disponível', recebProgramado: 'Receb. programado'};
  const perfil = window.SIM_AUTH?.profile || {};

  const view = document.createElement('section');
  view.id = 'aberturas-view'; view.className = 'panel ab-view'; view.dataset.aba = 'aberturas';
  view.innerHTML = `
    <div class="section-title"><div><h2>Aberturas das bases</h2>
      <p>Preencha a abertura do dia de cada terminal. Volumes em litros; aditivos em frascos. Cada alteração fica registrada com o nome de quem alterou.</p></div></div>
    <div class="ab-barra">
      <label>Data <input type="date" id="ab-dia"></label>
      <button type="button" id="ab-voltar" hidden>‹ Todas as cidades</button>
      <span id="ab-status" class="ab-status" role="status"></span>
    </div>
    <div id="ab-menu" class="ab-menu"></div>
    <div id="ab-cidade" class="ab-cidade" hidden></div>`;
  document.querySelector('main').append(view);

  let layout = null, dados = {}, referencia = {}, cidadeAberta = null, carregando = false;
  const pendentes = new Set();   // empDep com alteracao nao salva
  const campoDia = $('ab-dia');
  campoDia.value = hojeIso();
  const status = (texto, erro = false) => { const el = $('ab-status'); el.textContent = texto; el.classList.toggle('erro', erro); };

  // Bases que esta pessoa pode ver: perfil 'base' ve so' as cidades dos terminais dele; os demais, todas.
  const terminalVisivel = t => perfil.perfil !== 'base' || cloud.canEditAbertura(t.empDep);
  const cidadesVisiveis = () => (layout?.cidades || []).filter(c => c.terminais.some(terminalVisivel));
  const valorSalvo = (t, p) => dados[t.empDep]?.[cloud.produtoKey(p.nome)] || null;
  // "Enviado" igual a planilha (aba Menu): alguma abertura do terminal maior que zero.
  const enviado = t => t.produtos.some(p => (valorSalvo(t, p)?.abertura || 0) > 0);
  const ultimaAtualizacao = t => t.produtos.map(p => valorSalvo(t, p)).filter(Boolean)
    .reduce((m, v) => (!m || (v.atualizadoEm || 0) > (m.atualizadoEm || 0)) ? v : m, null);
  const quando = ms => ms ? new Date(ms).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '';

  async function carregar() {
    if (carregando) return;
    carregando = true; status('Carregando…');
    try {
      if (!layout) layout = await cloud.aberturasLayout();
      if (!layout?.cidades?.length) { status('O cadastro das aberturas ainda não foi publicado. Fale com o administrador.', true); return; }
      [dados, referencia] = await Promise.all([cloud.aberturasDoDia(campoDia.value), cloud.referenciaAberturas?.(campoDia.value) ?? {}]);
      pendentes.clear();
      status('');
      render();
    } catch (erro) {
      console.error(erro); status('Não foi possível carregar as aberturas. Recarregue a página.', true);
    } finally { carregando = false; }
  }

  function render() {
    $('ab-voltar').hidden = !cidadeAberta;
    $('ab-menu').hidden = !!cidadeAberta; $('ab-cidade').hidden = !cidadeAberta;
    if (cidadeAberta) renderCidade(); else renderMenu();
  }

  function renderMenu() {
    const cidades = cidadesVisiveis();
    $('ab-menu').innerHTML = cidades.map(c => {
      const ts = c.terminais.filter(terminalVisivel), ok = ts.filter(enviado).length;
      const situacao = ok === ts.length ? 'enviado' : ok ? 'parcial' : 'pendente';
      const texto = ok === ts.length ? 'Enviado' : ok ? `${ok} de ${ts.length} enviados` : 'Pendente';
      return `<button type="button" class="ab-cartao ab-${situacao}" data-ab-cidade="${esc(c.aba)}">
        <strong>${esc(c.cidade)}</strong><span class="ab-situacao">${texto}</span>
        <small>${ts.map(t => esc(t.nome)).join(' · ')}</small></button>`;
    }).join('') || '<p class="ab-vazio">Nenhuma base liberada para o seu acesso. Fale com o administrador.</p>';
    const total = cidades.flatMap(c => c.terminais.filter(terminalVisivel)), enviados = total.filter(enviado).length;
    status(`${enviados} de ${total.length} terminais enviados em ${new Date(campoDia.value + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
  }

  function renderCidade() {
    const cidade = layout.cidades.find(c => c.aba === cidadeAberta);
    if (!cidade) { cidadeAberta = null; render(); return; }
    $('ab-cidade').innerHTML = `<h3>${esc(cidade.cidade)}</h3>` + cidade.terminais.filter(terminalVisivel).map(t => {
      const pode = cloud.canEditAbertura(t.empDep), ult = ultimaAtualizacao(t);
      let unidadeAtual = null, linhas = '';
      for (const p of t.produtos) {
        if (p.unidade !== unidadeAtual) {
          unidadeAtual = p.unidade;
          // Mesmos titulos da planilha: litros nos combustiveis; nos aditivos, "Recebimentos/Programado Dia (frascos)".
          const titulos = p.unidade === 'frascos' ? ['Abertura Dia (frascos)', 'Recebimentos Dia (frascos)', 'Programado Dia (frascos)']
            : ['Abertura Dia (litros)', 'Receb. Efetuado / Disponível (litros)', 'Receb. Programado Dia (litros)'];
          // A coluna "Abertura da base" (soma) saiu em 2026-10-19 a pedido da usuaria: a abertura que vale e' a 1a coluna.
          linhas += `<tr class="ab-cab"><th>Produto</th>${titulos.map(r => `<th>${r}</th>`).join('')}</tr>`;
        }
        const salvo = valorSalvo(t, p) || {};
        // Padrao 0 em tudo (usuaria, 2026-10-16): a pessoa so' troca o que tiver valor.
        const campo = k => `<td><input type="number" min="0" step="1" inputmode="numeric" data-ab-campo="${k}" data-ab-produto="${esc(p.nome)}"
            value="${salvo[k] ?? 0}" ${pode ? '' : 'readonly'} aria-label="${esc(p.nome)} · ${esc(ROTULO_CAMPO[k])}"></td>`;
        // Referencia do MIS do dia (2026-10-19): so' indicativo pra quem preenche, embaixo da Abertura Dia.
        const mis = referencia[t.empDep]?.[p.nome];
        const abertura = campo('abertura').replace('</td>', mis != null
          ? `<small class="ab-ref" title="Abertura do dia no SAP (referência, não é preenchida automaticamente)">SAP: ${num(mis)} L</small></td>` : '</td>');
        linhas += `<tr><th scope="row">${esc(p.nome)}</th>${abertura}${campo('recebEfetuado')}${campo('recebProgramado')}</tr>`;
      }
      return `<article class="ab-terminal ${enviado(t) ? 'ab-enviado' : 'ab-pendente'}" data-ab-terminal="${esc(t.empDep)}">
        <div class="ab-topo"><div><h4>${esc(t.nome)}</h4>
          <span class="ab-situacao">${enviado(t) ? 'Enviado' : 'Pendente'}</span>
          ${ult ? `<small>Última alteração: ${esc(ult.atualizadoPorNome || '')} · ${quando(ult.atualizadoEm)}</small>` : ''}</div>
          <div class="ab-acoes">${pode ? `<button type="button" class="ab-salvar" data-ab-salvar="${esc(t.empDep)}" disabled>Salvar</button>` : '<small>Somente leitura</small>'}
          <button type="button" class="ab-hist-botao" data-ab-hist="${esc(t.empDep)}">Histórico</button></div></div>
        <div class="ab-tabela"><table>${linhas}</table></div>
        <div class="ab-historico" hidden></div></article>`;
    }).join('');
  }

  async function salvar(empDep) {
    const cidade = layout.cidades.find(c => c.aba === cidadeAberta), t = cidade?.terminais.find(x => x.empDep === empDep);
    const bloco = document.querySelector(`[data-ab-terminal="${CSS.escape(empDep)}"]`);
    if (!t || !bloco || !cloud.canEditAbertura(empDep)) return;
    const linhas = t.produtos.map(p => {
      const valores = {};
      for (const [k] of CAMPOS) {
        const campo = bloco.querySelector(`input[data-ab-campo="${k}"][data-ab-produto="${CSS.escape(p.nome)}"]`);
        const v = campo.value.trim() === '' ? 0 : Math.round(Number(campo.value));
        valores[k] = Number.isFinite(v) && v >= 0 ? v : NaN;
      }
      const salvo = valorSalvo(t, p);
      return {produto: p.nome, unidade: p.unidade, valores, anteriores: salvo ? Object.fromEntries(CAMPOS.map(([k]) => [k, salvo[k] ?? null])) : null};
    });
    if (linhas.some(l => Object.values(l.valores).some(v => Number.isNaN(v)))) { status('Há valores inválidos: use apenas números inteiros, sem sinal negativo.', true); return; }
    if (!linhas.some(l => l.unidade !== 'frascos' && l.valores.abertura > 0)
        && !confirm(`Nenhuma abertura de combustível foi preenchida em ${t.nome}. Salvar assim mesmo?`)) return;
    // Diferenca acima de 10% da referencia (usuaria, 2026-10-19): so' no Salvar, um resumo de todas as linhas
    // fora da faixa; a pessoa confirma ou volta pra corrigir. O e-mail pra gestao sai da maquina logistica.
    const fora = linhas.filter(l => l.unidade !== 'frascos').map(l => {
      const ref = referencia[empDep]?.[l.produto], ab = l.valores.abertura;
      return ref > 0 && ab > 0 && Math.abs(ab - ref) / ref > 0.10 ? {produto: l.produto, ab, ref, pct: Math.round((ab - ref) / ref * 100)} : null;
    }).filter(Boolean);
    if (fora.length) {
      const texto = fora.map(f => `• ${f.produto}: digitado ${num(f.ab)} L × referência ${num(f.ref)} L (${f.pct > 0 ? '+' : ''}${f.pct}%)`).join('\n');
      if (!confirm(`${t.nome}\n\nA abertura ficou mais de 10% diferente da referência do SAP:\n\n${texto}\n\n`
          + 'Tem certeza de que essa é a abertura? Se confirmar, um e-mail será enviado à gestão informando a diferença.')) return;
    }
    const botao = bloco.querySelector('.ab-salvar'); botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      await cloud.salvarAberturaTerminal(campoDia.value, empDep, t.nome, linhas);
      pendentes.delete(empDep);
      dados = await cloud.aberturasDoDia(campoDia.value);
      renderCidade();
      status(`${t.nome}: abertura salva.`);
    } catch (erro) {
      console.error(erro); botao.disabled = false; botao.textContent = 'Salvar';
      status(`Não foi possível salvar ${t.nome}. Verifique a conexão e tente de novo.`, true);
    }
  }

  async function mostrarHistorico(empDep) {
    const bloco = document.querySelector(`[data-ab-terminal="${CSS.escape(empDep)}"]`), caixa = bloco?.querySelector('.ab-historico');
    if (!caixa) return;
    if (!caixa.hidden) { caixa.hidden = true; return; }
    caixa.hidden = false; caixa.textContent = 'Carregando histórico…';
    try {
      const itens = Object.values(await cloud.historicoAberturas(campoDia.value, empDep)).sort((a, b) => (b.em || 0) - (a.em || 0));
      caixa.innerHTML = itens.length ? `<ul>${itens.map(h => `<li><span>${quando(h.em)}</span> · <strong>${esc(h.porNome)}</strong> · ${esc(h.produto)} · ${esc(ROTULO_CAMPO[h.campo] || h.campo)}: ${h.de == null ? 'vazio' : num(h.de)} → ${num(h.para)}</li>`).join('')}</ul>`
        : '<p>Nenhuma alteração registrada neste dia.</p>';
    } catch (erro) { console.error(erro); caixa.textContent = 'Não foi possível carregar o histórico.'; }
  }

  const temPendencia = () => pendentes.size > 0;
  const podeSair = () => !temPendencia() || confirm('Há alterações não salvas nesta cidade. Sair mesmo assim?');
  view.addEventListener('input', e => {
    const campo = e.target.closest('input[data-ab-campo]'); if (!campo || campo.readOnly) return;
    const bloco = campo.closest('[data-ab-terminal]'), empDep = bloco.dataset.abTerminal;
    pendentes.add(empDep); campo.classList.add('ab-alterado');
    const botao = bloco.querySelector('.ab-salvar'); if (botao) botao.disabled = false;
  });
  view.addEventListener('click', e => {
    const cartao = e.target.closest('[data-ab-cidade]');
    if (cartao) { cidadeAberta = cartao.dataset.abCidade; render(); scrollTo({top: 0}); return; }
    const sv = e.target.closest('[data-ab-salvar]'); if (sv) { salvar(sv.dataset.abSalvar); return; }
    const hi = e.target.closest('[data-ab-hist]'); if (hi) mostrarHistorico(hi.dataset.abHist);
  });
  $('ab-voltar').onclick = () => { if (!podeSair()) return; cidadeAberta = null; pendentes.clear(); render(); };
  campoDia.onchange = () => { if (!podeSair()) return; carregar(); };
  addEventListener('beforeunload', e => { if (temPendencia()) { e.preventDefault(); e.returnValue = ''; } });

  // Perfil 'base': o simulador nem e' carregado (online.js), entao nao ha dia.js pra montar as abas —
  // mostra a barra so' com Aberturas e abre direto nela.
  if (window.SIM_AUTH?.soAberturas) {
    document.querySelectorAll('#abas-bar [data-aba-alvo]').forEach(b => { b.hidden = b !== botaoAba; });
    botaoAba.setAttribute('aria-selected', 'true');
    document.getElementById('abas-bar').hidden = false;
    document.body.dataset.aba = 'aberturas';
  }
  // dia.js controla a troca de abas; aqui so' carrega quando a aba Aberturas aparece.
  let carregouUmaVez = false;
  const aoMostrar = () => { if (document.body.dataset.aba === 'aberturas') { carregouUmaVez = true; carregar(); } };
  botaoAba?.addEventListener('click', aoMostrar);
  if (document.body.dataset.aba === 'aberturas' && !carregouUmaVez) aoMostrar();
})();
