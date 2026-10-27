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
  // "Enviado" = o terminal tem alguma linha gravada no dia (usuaria, 2026-10-27: "se a pessoa nao clicou no botao, ai sim
  // e' pendente"): quem salvou no portal (mesmo tudo zero, o Salvar grava todos os produtos) ou planilha com qualquer
  // campo preenchido (abertura ou recebimentos). Antes exigia abertura > 0 e base que so' recebeu ficava "Pendente".
  const enviado = t => t.produtos.some(p => valorSalvo(t, p));
  // Base unica das aberturas (2026-10-26): linhas copiadas do Formulario Excel pelo ETL tem origem 'planilha'.
  // Ficam marcadas na tela; ao Salvar, a linha e' regravada inteira (sem origem) e passa a valer como portal.
  const daPlanilha = s => s?.origem === 'planilha';
  const viaPlanilha = t => enviado(t) && t.produtos.every(p => { const s = valorSalvo(t, p); return !s || daPlanilha(s); });
  const situacao = t => enviado(t) ? (viaPlanilha(t) ? 'Enviado · via planilha' : 'Enviado') : 'Pendente';
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
    // Um botao so' por cidade (usuaria, 2026-10-19: "nao quero que cliquem em 500 botoes por deposito"): grava
    // de uma vez todos os terminais alterados. Fica fixo no topo ao rolar.
    const algumEditavel = cidade.terminais.some(t => terminalVisivel(t) && cloud.canEditAbertura(t.empDep));
    $('ab-cidade').innerHTML = `<div class="ab-cidade-topo"><h3>${esc(cidade.cidade)}</h3>${algumEditavel
      ? `<button type="button" class="ab-salvar" id="ab-salvar-cidade" ${pendentes.size ? '' : 'disabled'}>Salvar ${esc(cidade.cidade)}</button>` : ''}</div>`
      + cidade.terminais.filter(terminalVisivel).map(t => {
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
        const planilha = daPlanilha(salvo);
        const campo = k => `<td><input type="number" min="0" step="1" inputmode="numeric" data-ab-campo="${k}" data-ab-produto="${esc(p.nome)}"
            value="${salvo[k] ?? 0}" ${pode ? '' : 'readonly'} aria-label="${esc(p.nome)} · ${esc(ROTULO_CAMPO[k])}"
            ${planilha && salvo[k] > 0 ? `class="ab-planilha" title="Veio do Formulário Excel (planilha). Confirme ou corrija e salve para valer o portal."` : ''}></td>`;
        // Referencia do MIS do dia (2026-10-19): so' indicativo pra quem preenche, embaixo da Abertura Dia.
        const mis = referencia[t.empDep]?.[p.nome];
        const abertura = campo('abertura').replace('</td>', mis != null
          ? `<small class="ab-ref" title="Abertura do dia no SAP (referência, não é preenchida automaticamente)">SAP: ${num(mis)} L</small></td>` : '</td>');
        linhas += `<tr><th scope="row">${esc(p.nome)}</th>${abertura}${campo('recebEfetuado')}${campo('recebProgramado')}</tr>`;
      }
      return `<article class="ab-terminal ${enviado(t) ? 'ab-enviado' : 'ab-pendente'}" data-ab-terminal="${esc(t.empDep)}">
        <div class="ab-topo"><div><h4>${esc(t.nome)}</h4>
          <span class="ab-situacao">${situacao(t)}</span>
          ${ult ? `<small>Última alteração: ${esc(ult.atualizadoPorNome || '')} · ${quando(ult.atualizadoEm)}</small>` : ''}</div>
          <div class="ab-acoes">${pode ? '' : '<small>Somente leitura</small>'}
          <button type="button" class="ab-hist-botao" data-ab-hist="${esc(t.empDep)}">Histórico</button></div></div>
        <div class="ab-tabela"><table>${linhas}</table></div>
        <div class="ab-historico" hidden></div></article>`;
    }).join('');
  }

  // Le os campos de um terminal na tela: {t, linhas} ou null se houver valor invalido.
  function coletar(t) {
    const bloco = document.querySelector(`[data-ab-terminal="${CSS.escape(t.empDep)}"]`);
    if (!bloco) return null;
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
    return linhas.some(l => Object.values(l.valores).some(v => Number.isNaN(v))) ? null : {t, linhas};
  }

  // Salva de uma vez todos os terminais alterados da cidade aberta, com UM aviso so' (vazios + diferencas >10%).
  async function salvarCidade() {
    const cidade = layout.cidades.find(c => c.aba === cidadeAberta);
    const alvos = (cidade?.terminais || []).filter(t => terminalVisivel(t) && cloud.canEditAbertura(t.empDep) && pendentes.has(t.empDep));
    if (!alvos.length) { status('Nenhuma alteração para salvar.'); return; }
    const lotes = alvos.map(coletar);
    if (lotes.some(l => !l)) { status('Há valores inválidos: use apenas números inteiros, sem sinal negativo.', true); return; }
    const vazios = lotes.filter(({linhas}) => !linhas.some(l => l.unidade !== 'frascos' && l.valores.abertura > 0)).map(({t}) => t.nome);
    if (vazios.length && !confirm(`Nenhuma abertura de combustível foi preenchida em:\n${vazios.map(n => '• ' + n).join('\n')}\n\nSalvar assim mesmo?`)) return;
    // Diferenca acima de 10% da referencia (usuaria, 2026-10-19): um resumo so', de todos os terminais; a pessoa
    // confirma ou volta pra corrigir. A mensagem pra gestao (WhatsApp) sai da maquina logistica.
    const fora = lotes.flatMap(({t, linhas}) => linhas.filter(l => l.unidade !== 'frascos').map(l => {
      const ref = referencia[t.empDep]?.[l.produto], ab = l.valores.abertura;
      return ref > 0 && ab > 0 && Math.abs(ab - ref) / ref > 0.10 ? {terminal: t.nome, produto: l.produto, ab, ref, pct: Math.round((ab - ref) / ref * 100)} : null;
    }).filter(Boolean));
    if (fora.length) {
      const texto = fora.map(f => `• ${f.terminal} · ${f.produto}: digitado ${num(f.ab)} L × referência ${num(f.ref)} L (${f.pct > 0 ? '+' : ''}${f.pct}%)`).join('\n');
      if (!confirm(`A abertura ficou mais de 10% diferente da referência do SAP:\n\n${texto}\n\n`
          + 'Tem certeza de que essa é a abertura? Se confirmar, ela vai para o grupo Status RPA Nexta no WhatsApp marcada em vermelho.')) return;
    }
    const botao = $('ab-salvar-cidade'); if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }
    const falhas = [];
    for (const {t, linhas} of lotes) {
      try { await cloud.salvarAberturaTerminal(campoDia.value, t.empDep, t.nome, linhas); pendentes.delete(t.empDep); }
      catch (erro) { console.error(erro); falhas.push(t.nome); }
    }
    dados = await cloud.aberturasDoDia(campoDia.value).catch(() => dados);
    renderCidade();
    status(falhas.length ? `Não foi possível salvar: ${falhas.join(', ')}. Verifique a conexão e tente de novo.`
      : `${lotes.length} terminal(is) salvo(s).`, falhas.length > 0);
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
    const botao = $('ab-salvar-cidade'); if (botao) botao.disabled = false;
  });
  view.addEventListener('click', e => {
    const cartao = e.target.closest('[data-ab-cidade]');
    if (cartao) { cidadeAberta = cartao.dataset.abCidade; render(); scrollTo({top: 0}); return; }
    if (e.target.closest('#ab-salvar-cidade')) { salvarCidade(); return; }
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
  // Atualiza sozinha a cada 1 min enquanto a aba esta' aberta (usuaria, 2026-10-21: "delays de um usuario pro
  // outro"): o que uma base salva aparece pros outros sem F5. Nao recarrega se houver alteracao nao salva.
  setInterval(() => {
    if (document.body.dataset.aba === 'aberturas' && !document.hidden && !pendentes.size && !carregando) carregar();
  }, 60000);
  // Perfil 'base' sempre entra na aba Aberturas (e' o que ele preenche); ve Alertas, Cenario e Historico, mas NAO a
  // aba "Simulacao de estoques" (usuaria, 2026-10-21).
  if (perfil.perfil === 'base') {
    const abaSimulacao = document.querySelector('#abas-bar [data-aba-alvo="simulacao"]');
    if (abaSimulacao) abaSimulacao.hidden = true;
    if (document.body.dataset.aba !== 'aberturas') botaoAba?.click();
  }
  if (document.body.dataset.aba === 'aberturas' && !carregouUmaVez) aoMostrar();
})();
