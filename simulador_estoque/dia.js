'use strict';
// Visao do dia: consolidado dos cenarios salvos pela equipe, em duas abas.
// - "Riscos da semana": junta os 7 dias da semana selecionada e mostra, por base+deposito+produto,
//   a versao mais recente salva na semana (visao gerencial resumida, sem grafico de biblioteca externa).
// - "Por data": tabela de um dia so, igual existia antes.
// So le o que ja foi gravado (registros imutaveis) — nao recalcula nada, nao gerencia estado da simulacao.
(() => {
  const cloud = window.SIM_CLOUD;
  const view = $('dia-view'), abrir = $('ver-dia'), fechar = $('dia-fechar');
  const rotuloSituacao = {ok: 'OK', atencao: 'Atenção', critico: 'Crítico'};
  const peso = {critico: 0, atencao: 1, ok: 2};
  abrir.hidden = false;

  function abrirCenario(base, produto, cenario) {
    view.hidden = true;
    const registro = D.records.find(r => r.base === base);
    if (registro) { $('cidade').value = cidadeDe(registro); refreshDepositoOptions(); $('deposito').value = depositoDe(registro); refreshEmpresaOptions(); $('empresa').value = empresaDe(registro); }
    products();
    if ([...$('product').options].some(o => o.value === produto)) $('product').value = produto;
    $('scenario').value = cenario; select();
  }

  // ---- Abas ----
  const tabs = view.querySelectorAll('[data-dia-tab]');
  const paineis = {semana: $('semana-view'), hoje: $('hoje-view'), data: $('data-view')};
  tabs.forEach(botao => botao.onclick = () => {
    tabs.forEach(b => b.setAttribute('aria-selected', String(b === botao)));
    for (const [nome, painel] of Object.entries(paineis)) painel.hidden = nome !== botao.dataset.diaTab;
    if (botao.dataset.diaTab === 'semana') renderSemana();
    else if (botao.dataset.diaTab === 'hoje') renderHoje();
    else renderDia();
  });

  // ================= Por data =================
  // Pedido da usuaria, 2026-10-05: "historico da data da simulação > base/cidade > produto" — escolhe
  // o dia no campo acima (como sempre), e o resultado fica agrupado por cidade (1 card expansivel),
  // com a tabela completa de base+produto dentro, igual a aba "Simulações de hoje" — so' que aqui
  // cobre QUALQUER dia e mantem os indicadores de risco (situacao, menor estoque, dias critico/atencao)
  // que ja existiam nessa aba, pra triagem.
  const campoData = $('dia-data'), campoRegiaoDia = $('dia-regiao'), campoBaseDia = $('dia-base'),
    campoSituacaoDia = $('dia-situacao'), listaDia = $('dia-lista'), statusDia = $('dia-status');
  campoData.value = D.date;
  let geracaoDia = 0;

  async function linhasDoDia(dia) {
    const arvore = await cloud.listDay(dia);
    const linhas = [];
    for (const porChave of Object.values(arvore || {})) {
      for (const chaveNode of Object.values(porChave)) {
        const versoes = Object.values(chaveNode.versoes || {});
        if (!versoes.length) continue;
        linhas.push(versoes.reduce((a, b) => (a.versao > b.versao ? a : b)));
      }
    }
    return linhas;
  }

  async function renderDia() {
    const minha = ++geracaoDia;
    statusDia.textContent = 'Carregando…'; listaDia.innerHTML = '';
    const dia = campoData.value || D.date;
    let itens;
    try { itens = await linhasDoDia(dia); }
    catch (error) { if (minha === geracaoDia) statusDia.textContent = `Não foi possível carregar: ${error.message}`; return; }
    if (minha !== geracaoDia) return;
    itens = itens.map(it => {
      const registro = D.records.find(r => r.base === it.base);
      return {...it, cidade: registro ? cidadeDe(registro) : (it.base || '—')};
    });
    const regiao = campoRegiaoDia.value, base = campoBaseDia.value.trim().toLowerCase(), situacao = campoSituacaoDia.value;
    itens = itens.filter(it => (!regiao || cloud.regionOf(it.base) === regiao)
      && (!base || it.base.toLowerCase().includes(base) || it.cidade.toLowerCase().includes(base))
      && (!situacao || it.indicadores.situacao === situacao));
    if (!itens.length) { statusDia.textContent = 'Nenhuma visão salva para este dia com os filtros atuais.'; return; }
    const resumo = itens.reduce((c, it) => ({...c, [it.indicadores.situacao]: (c[it.indicadores.situacao] || 0) + 1}), {});
    const cidades = agruparPorCidade(itens)
      .sort((a, b) => peso[a.situacao] - peso[b.situacao] || b.urgenciaMax - a.urgenciaMax || a.cidade.localeCompare(b.cidade, 'pt-BR'));
    statusDia.textContent = `${itens.length} visão(ões) em ${cidades.length} cidade(s) · ${resumo.critico || 0} crítica(s) · ${resumo.atencao || 0} em atenção · ${resumo.ok || 0} ok.`;
    listaDia.innerHTML = cidades.map(c => `<details class="card dia-${c.situacao}">
      <summary><strong>${esc(c.cidade)}</strong> <small>${c.itens.length} visão(ões) · ${c.resumoSituacao.critico || 0} crítica(s) · ${c.resumoSituacao.atencao || 0} em atenção · ${c.resumoSituacao.ok || 0} ok</small></summary>
      <table class="hoje-tabela"><thead><tr><th>Base</th><th>Depósito</th><th>Produto</th><th>Cenário</th><th>Situação</th><th>Menor estoque (m³)</th><th>Dia do menor</th><th>Dias crítico</th><th>Dias atenção</th><th>Versão</th><th>Autor / motivo</th><th></th></tr></thead>
      <tbody>${c.itens.map(it => `<tr class="dia-${it.indicadores.situacao}">
        <td>${esc(it.base)}</td><td>${esc(it.deposito || '—')}</td><td>${esc(it.produto)}</td><td>${esc(it.cenario)}</td>
        <td>${rotuloSituacao[it.indicadores.situacao]}</td>
        <td>${fmt(it.indicadores.menorEstoque)}</td>
        <td>${it.indicadores.diaMenorEstoque ? new Date(it.indicadores.diaMenorEstoque + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td>${it.indicadores.diasCritico}</td><td>${it.indicadores.diasAtencao}</td>
        <td>v${it.versao}</td>
        <td>${esc(it.autorNome)}${it.motivo ? `<br><small>${esc(it.motivo)}</small>` : ''}</td>
        <td><button type="button" data-abrir="${esc(it.base)}|${esc(it.produto)}|${esc(it.cenario)}">Abrir</button></td>
      </tr>`).join('')}</tbody></table>
    </details>`).join('');
  }

  listaDia.addEventListener('click', event => {
    const botao = event.target.closest('[data-abrir]'); if (!botao) return;
    const [base, produto, cenario] = botao.dataset.abrir.split('|');
    abrirCenario(base, produto, cenario);
  });
  [campoData, campoRegiaoDia, campoSituacaoDia].forEach(el => el.onchange = renderDia);
  let atrasoDia;
  campoBaseDia.oninput = () => { clearTimeout(atrasoDia); atrasoDia = setTimeout(renderDia, 250); };

  // ================= Simulações de hoje =================
  // Pedido da usuaria, 2026-10-05: "uma outra aba com os resultados das simulações do dia... pra
  // entender os cenarios" — "É pra mostrar os cenários que a equipe salvou hoje (tipo a aba 'Por
  // data' e cidade e produtos salvos ja)". Reaproveita linhasDoDia() (so' o que foi REALMENTE salvo,
  // sem fallback de LE calculado — diferente da semana) fixo em D.date, agrupado por cidade; depois
  // "quando abrir a cidade, quero a opção de abrir por produto" — cada card e' um <details> que expande
  // pra tabela com 1 linha por base+produto salvo.
  const campoRegiaoHoje = $('hoje-regiao'), campoBaseHoje = $('hoje-base'), statusHoje = $('hoje-status'), listaHoje = $('hoje-lista');
  let geracaoHoje = 0;

  async function renderHoje() {
    const minha = ++geracaoHoje;
    statusHoje.textContent = 'Carregando…'; listaHoje.innerHTML = '';
    let itens;
    try { itens = await linhasDoDia(D.date); }
    catch (error) { if (minha === geracaoHoje) statusHoje.textContent = `Não foi possível carregar: ${error.message}`; return; }
    if (minha !== geracaoHoje) return;
    itens = itens.map(it => {
      const registro = D.records.find(r => r.base === it.base);
      return {...it, cidade: registro ? cidadeDe(registro) : (it.base || '—')};
    });
    const regiao = campoRegiaoHoje.value, busca = campoBaseHoje.value.trim().toLowerCase();
    itens = itens.filter(it => (!regiao || cloud.regionOf(it.base) === regiao)
      && (!busca || it.base.toLowerCase().includes(busca) || it.cidade.toLowerCase().includes(busca) || it.produto.toLowerCase().includes(busca)));
    if (!itens.length) { statusHoje.textContent = 'Nenhuma simulação salva hoje com os filtros atuais.'; return; }
    const porCidade = new Map();
    for (const it of itens) {
      const cidade = it.cidade || '—';
      if (!porCidade.has(cidade)) porCidade.set(cidade, []);
      porCidade.get(cidade).push(it);
    }
    const cidades = [...porCidade.entries()].map(([cidade, lista]) => {
      lista.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
      return {cidade, itens: lista};
    }).sort((a, b) => b.itens.length - a.itens.length || a.cidade.localeCompare(b.cidade, 'pt-BR'));
    statusHoje.textContent = `${itens.length} simulação(ões) salva(s) hoje em ${cidades.length} cidade(s).`;
    listaHoje.innerHTML = cidades.map(c => `<details class="card">
      <summary><strong>${esc(c.cidade)}</strong> <small>${c.itens.length} simulação(ões) salva(s)</small></summary>
      <table class="hoje-tabela"><thead><tr><th>Base</th><th>Depósito</th><th>Produto</th><th>Cenário</th><th>Versão</th><th>Autor</th><th>Horário</th><th></th></tr></thead>
      <tbody>${c.itens.map(it => `<tr>
        <td>${esc(it.base)}</td><td>${esc(it.deposito || '—')}</td><td>${esc(it.produto)}</td><td>${esc(it.cenario)}</td>
        <td>v${it.versao}</td><td>${esc(it.autorNome)}${it.motivo ? `<br><small>${esc(it.motivo)}</small>` : ''}</td>
        <td>${it.atualizadoEm ? new Date(it.atualizadoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '—'}</td>
        <td><button type="button" data-abrir="${esc(it.base)}|${esc(it.produto)}|${esc(it.cenario)}">Abrir</button></td>
      </tr>`).join('')}</tbody></table>
    </details>`).join('');
  }

  listaHoje.addEventListener('click', event => {
    const botao = event.target.closest('[data-abrir]'); if (!botao) return;
    const [base, produto, cenario] = botao.dataset.abrir.split('|');
    abrirCenario(base, produto, cenario);
  });
  campoRegiaoHoje.onchange = renderHoje;
  let atrasoHoje;
  campoBaseHoje.oninput = () => { clearTimeout(atrasoHoje); atrasoHoje = setTimeout(renderHoje, 250); };

  // ================= Riscos da semana =================
  const pills = $('semana-pills'), botaoAnterior = $('semana-anterior'), botaoProxima = $('semana-proxima'),
    campoRegiaoSemana = $('semana-regiao'), campoBaseSemana = $('semana-base'), campoSituacaoSemana = $('semana-situacao'),
    statusSemana = $('semana-status'), barra = $('semana-barra'), lista = $('semana-lista');
  let semanaOffset = 0; // 0 = semana atual (calendario, segunda a domingo), a partir de hoje de verdade
  let geracaoSemana = 0;

  function segundaFeira(data) {
    const d = new Date(data); d.setHours(12, 0, 0, 0);
    const diasDesdeSegunda = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diasDesdeSegunda);
    return d;
  }
  function isoData(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function numeroSemanaISO(data) {
    const d = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()));
    const diaSemana = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diaSemana + 3);
    const primeiraQuinta = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const diffSemanas = Math.round((d - primeiraQuinta) / (7 * 86400000));
    return diffSemanas + 1;
  }
  function diasDaSemana(segunda) {
    return Array.from({length: 7}, (_, i) => { const d = new Date(segunda); d.setDate(d.getDate() + i); return isoData(d); });
  }
  function segundaComOffset(offset) {
    const base = segundaFeira(new Date());
    base.setDate(base.getDate() + offset * 7);
    return base;
  }

  function renderPills() {
    const hojeSegunda = segundaFeira(new Date());
    pills.innerHTML = '';
    for (let i = -2; i <= 2; i++) {
      const offset = semanaOffset + i;
      const segunda = segundaComOffset(offset);
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = String(numeroSemanaISO(segunda));
      const dias = diasDaSemana(segunda);
      botao.title = `${dias[0]} a ${dias[6]}`.split('-').join('/');
      if (offset === semanaOffset) botao.classList.add('active');
      if (segunda.getTime() === hojeSegunda.getTime()) botao.classList.add('hoje');
      botao.onclick = () => { semanaOffset = offset; renderSemana(); };
      pills.appendChild(botao);
    }
  }

  async function linhasDaSemana(dias) {
    const porDia = await cloud.listRange(dias);
    // Salvos: a versao mais recente da semana por base+deposito+produto, QUALQUER cenario (nao separa
    // mais por cenario — pra visao gerencial, uma linha por base+produto e' o que faz sentido).
    const salvos = new Map();
    for (const dia of dias) {
      const arvore = porDia[dia] || {};
      for (const porChave of Object.values(arvore)) {
        for (const chaveNode of Object.values(porChave)) {
          const versoes = Object.values(chaveNode.versoes || {});
          if (!versoes.length) continue;
          const ultima = versoes.reduce((a, b) => (a.versao > b.versao ? a : b));
          const chaveGlobal = `${ultima.base}|${ultima.deposito || ''}|${ultima.produto}`;
          const atual = salvos.get(chaveGlobal);
          if (!atual || (ultima.atualizadoEm || 0) > (atual.atualizadoEm || 0)) salvos.set(chaveGlobal, {...ultima, dia, salvo: true});
        }
      }
    }
    // Cobertura completa (pedido da usuaria, 2026-10-01: "considere o cenario do dia, caso salvo; se
    // nao for salvo, considere o cenario padrao, pela simulacao do LE" — antes so' aparecia o que
    // alguem tinha salvo, ficando vazio a maior parte do tempo). Toda base+deposito+produto do
    // snapshot atual entra na lista: usa o salvo quando existir essa semana, senao calcula o LE
    // padrao na hora (sem gravar nada, sem precisar de ninguem ter salvo antes).
    const vistos = new Set(), linhas = [];
    for (const r of D.records) {
      const deposito = r.bi?.emp_dep || '';
      const chaveGlobal = `${r.base}|${deposito}|${r.product}`;
      if (vistos.has(chaveGlobal)) continue;
      vistos.add(chaveGlobal);
      // % do LE da semana ja' vendido (pedido da usuaria, 2026-10-01) — vem do mesmo campo usado na
      // barrinha "Ritmo da semana"; so' existe pros 4 produtos cobertos pela reprojecao. Preenchido
      // pro registro ATUAL (hoje), independente de ser um item salvo ou calculado agora.
      const semana = r.bi?.semana && r.bi.semana.leSemana > 0 ? r.bi.semana : null;
      // cidade (pedido da usuaria, 2026-10-05, visao executiva por cidade): mesma funcao cidadeDe() de
      // app.js, cadastro oficial — usada pra agrupar itens de bases/depositos diferentes da mesma cidade.
      const cidade = cidadeDe(r);
      const existente = salvos.get(chaveGlobal);
      if (existente) { linhas.push({...existente, semana, cidade}); continue; }
      try {
        const content = fresh(r, 'LE'), resultado = E.calculate(content, n), indicadores = window.SIM_INDICATORS(content);
        const diaIdx = indicadores.diaMenorEstoque == null ? null
          : Math.round((new Date(indicadores.diaMenorEstoque + 'T12:00:00') - new Date(D.date + 'T12:00:00')) / 86400000);
        const fluxoDia = diaIdx != null && resultado[diaIdx] ? {incoming: resultado[diaIdx].incoming, outgoing: resultado[diaIdx].outgoing} : null;
        linhas.push({base: r.base, deposito, produto: r.product, cenario: 'LE', salvo: false, indicadores, fluxoDia, semana, cidade});
      } catch { /* registro sem dado suficiente pro calculo (ex.: sem abertura); ignora */ }
    }
    return linhas;
  }
  // Texto curto explicando a causa (pedido da usuaria, 2026-10-01: "resumo de causas" pra diretoria
  // bater o olho). So' descreve o que da' pra ver nos dados — nao tenta adivinhar motivo de negocio.
  function causaTexto(it) {
    const ind = it.indicadores;
    if (ind.situacao === 'ok') return null;
    const partes = [];
    const diaFmt = ind.diaMenorEstoque ? new Date(ind.diaMenorEstoque + 'T12:00:00').toLocaleDateString('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit'}) : null;
    partes.push(`menor estoque ${fmt(ind.menorEstoque)} m³${diaFmt ? ' em ' + diaFmt : ''}`);
    if (it.fluxoDia) {
      const {incoming, outgoing} = it.fluxoDia;
      if (outgoing > incoming) partes.push(`saiu ${fmt(outgoing)} m³ e entrou só ${fmt(incoming)} m³ nesse dia`);
      else if (incoming === 0) partes.push('nenhuma entrada programada nesse dia');
    }
    if (it.semana) partes.push(`${Math.round(it.semana.realSemana / it.semana.leSemana * 100)}% do LE da semana já vendido`);
    if (ind.primeiraRuptura) partes.push(`ruptura a partir de ${new Date(ind.primeiraRuptura + 'T12:00:00').toLocaleDateString('pt-BR')}`);
    return partes.join(' · ');
  }
  // Versao curta de causaTexto() pra lista/resumo (pedido da usuaria, 2026-10-06: a frase corrida com
  // todos os detalhes "ta bem feio" quando empilhada em varias cidades/produtos — aqui so' o essencial
  // (estoque + data + ruptura, se for diferente do dia do menor estoque), 1 linha curta por produto;
  // o detalhe completo continua nas abas "Simulações de hoje"/"Por data" (tabela, não texto).
  function causaResumida(it) {
    const ind = it.indicadores;
    if (ind.situacao === 'ok') return null;
    const diaFmt = ind.diaMenorEstoque ? new Date(ind.diaMenorEstoque + 'T12:00:00').toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}) : null;
    let texto = `estoque ${fmt(ind.menorEstoque)} m³${diaFmt ? ' em ' + diaFmt : ''}`;
    if (ind.primeiraRuptura && ind.primeiraRuptura !== ind.diaMenorEstoque) {
      texto += ` · ruptura ${new Date(ind.primeiraRuptura + 'T12:00:00').toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})}`;
    }
    return texto;
  }
  // Urgencia (pedido da usuaria, 2026-10-02: "quanto mais proximo de termos ruptura e maior for o
  // volume dessa ruptura" — usado pra ranquear o TOP 10, porque 87 criticos de uma vez "fica confuso
  // pra diretores e gerentes tomarem acao"). Deficit (m³ negativos) dividido pelos dias ate' a ruptura
  // — deficit grande chegando logo pesa mais que deficit grande daqui a 2 semanas.
  function urgencia(it) {
    const ind = it.indicadores;
    if (ind.situacao === 'ok') return -Infinity;
    const diaRuptura = ind.primeiraRuptura || ind.diaMenorEstoque;
    const diasAte = diaRuptura ? Math.max(0, Math.round((new Date(diaRuptura + 'T12:00:00') - new Date(D.date + 'T12:00:00')) / 86400000)) : 14;
    const deficit = Math.max(0, -ind.menorEstoque);
    return deficit / (diasAte + 1);
  }
  // Pedido da usuaria, 2026-10-05: "tira isso [cards por base/deposito] da visao do dia, eu queria
  // algo + executivo... pode analisar por cidade como um todo os highlights, nao precisa ser por
  // deposito". Agrupa os itens (base+deposito+produto) por CIDADE — 1 card por cidade, com a pior
  // situacao entre os seus itens, a contagem por situacao, e os piores casos dela em texto.
  function agruparPorCidade(itens) {
    const porCidade = new Map();
    for (const it of itens) {
      const cidade = it.cidade || '—';
      if (!porCidade.has(cidade)) porCidade.set(cidade, []);
      porCidade.get(cidade).push(it);
    }
    return [...porCidade.entries()].map(([cidade, lista]) => {
      lista.sort((a, b) => peso[a.indicadores.situacao] - peso[b.indicadores.situacao] || urgencia(b) - urgencia(a));
      const resumoSituacao = lista.reduce((c, it) => ({...c, [it.indicadores.situacao]: (c[it.indicadores.situacao] || 0) + 1}), {});
      return {
        cidade, itens: lista,
        situacao: lista[0].indicadores.situacao,
        urgenciaMax: Math.max(...lista.map(urgencia)),
        resumoSituacao,
        piores: lista.filter(it => it.indicadores.situacao !== 'ok').slice(0, 3),
      };
    });
  }

  async function renderSemana() {
    const minha = ++geracaoSemana;
    renderPills();
    statusSemana.textContent = 'Carregando…'; barra.innerHTML = ''; lista.innerHTML = '';
    const segunda = segundaComOffset(semanaOffset), dias = diasDaSemana(segunda);
    let itens;
    try { itens = await linhasDaSemana(dias); }
    catch (error) { if (minha === geracaoSemana) statusSemana.textContent = `Não foi possível carregar: ${error.message}`; return; }
    if (minha !== geracaoSemana) return;
    const regiao = campoRegiaoSemana.value, base = campoBaseSemana.value.trim().toLowerCase(), situacao = campoSituacaoSemana.value;
    itens = itens.filter(it => (!regiao || cloud.regionOf(it.base) === regiao)
      && (!base || it.base.toLowerCase().includes(base))
      && (!situacao || it.indicadores.situacao === situacao));
    itens.sort((a, b) => peso[a.indicadores.situacao] - peso[b.indicadores.situacao] || urgencia(b) - urgencia(a) || a.base.localeCompare(b.base));
    const semanaNum = numeroSemanaISO(segunda);
    const periodo = `${new Date(dias[0] + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(dias[6] + 'T12:00:00').toLocaleDateString('pt-BR')}`;
    if (!itens.length) {
      statusSemana.textContent = `Semana ${semanaNum} (${periodo}): nenhuma base encontrada com os filtros atuais.`;
      return;
    }
    const resumo = itens.reduce((c, it) => ({...c, [it.indicadores.situacao]: (c[it.indicadores.situacao] || 0) + 1}), {});
    const salvos = itens.filter(it => it.salvo).length;
    // Visao MACRO por cidade (pedido da usuaria, 2026-10-05: "tira isso [por base/deposito] da visao
    // do dia, queria algo + executivo... pode analisar por cidade como um todo os highlights, nao
    // precisa ser por deposito" — "pq e' highlight ne? entao tem que ser macro"). 1 card por cidade,
    // ordenado pela pior situacao + maior urgencia entre os itens dela — nao lista cada deposito
    // separado, so' o resumo e os 2-3 piores casos em texto corrido dentro do card.
    const cidades = agruparPorCidade(itens)
      .sort((a, b) => peso[a.situacao] - peso[b.situacao] || b.urgenciaMax - a.urgenciaMax || a.cidade.localeCompare(b.cidade, 'pt-BR'));
    statusSemana.textContent = `Semana ${semanaNum} (${periodo}) · ${itens.length} base(s) em ${cidades.length} cidade(s) — `
      + `${resumo.critico || 0} crítica(s) · ${resumo.atencao || 0} em atenção · ${resumo.ok || 0} ok `
      + `· ${salvos} salva(s) pela equipe, ${itens.length - salvos} calculada(s) agora pelo LE padrão.`;
    barra.innerHTML = ['critico', 'atencao', 'ok'].filter(s => resumo[s]).map(s =>
      `<span class="${s}" style="flex:${resumo[s]}">${resumo[s]}</span>`).join('');
    // Resumo executivo (pedido da usuaria: "consolidar em formato de texto, com as principais causas,
    // pra diretoria bater o olho") — pedido da usuaria, 2026-10-06: "isso ta bem feio" na frase corrida
    // original; agora 1 card curto por cidade, com 1 linha por produto (bullet de verdade, nao middot).
    const resumoEl = $('semana-resumo');
    const cidadesComProblema = cidades.filter(c => c.situacao !== 'ok');
    resumoEl.innerHTML = !cidadesComProblema.length ? '' : `<p class="resumo-exec-titulo"><strong>${cidadesComProblema.length} cidade(s) com atenção esta semana</strong></p>
      <div class="resumo-exec-grid">${cidadesComProblema.map(c => `<div class="resumo-exec-item dia-${c.situacao}">
        <div class="resumo-exec-cidade">${esc(c.cidade)}</div>
        <ul class="causas-lista">${c.piores.map(it => `<li><strong>${esc(it.base.replace(c.cidade, '').trim() || it.base)}</strong> <span class="tag">${esc(it.produto)}</span> — ${esc(causaResumida(it))}</li>`).join('')}</ul>
      </div>`).join('')}</div>`;
    lista.innerHTML = cidades.map(c => `<div class="card dia-${c.situacao}">
      <h3>${esc(c.cidade)}</h3>
      <small>${c.itens.length} base(s)/depósito(s)/produto(s) · ${c.resumoSituacao.critico || 0} crítica(s) · ${c.resumoSituacao.atencao || 0} em atenção · ${c.resumoSituacao.ok || 0} ok</small>
      <p><strong>${rotuloSituacao[c.situacao]}</strong></p>
      ${c.piores.length ? `<ul class="causas-lista">${c.piores.map(it => `<li><strong>${esc(it.base.replace(c.cidade, '').trim() || it.base)}</strong> <span class="tag">${esc(it.produto)}</span> — ${esc(causaResumida(it))}</li>`).join('')}</ul>` : ''}
      <div>${c.piores.map(it => `<button type="button" data-abrir="${esc(it.base)}|${esc(it.produto)}|${esc(it.cenario)}">Abrir ${esc(it.base.replace(c.cidade, '').trim() || it.base)}</button>`).join(' ')}</div>
    </div>`).join('');
  }

  lista.addEventListener('click', event => {
    const botao = event.target.closest('[data-abrir]'); if (!botao) return;
    const [base, produto, cenario] = botao.dataset.abrir.split('|');
    abrirCenario(base, produto, cenario);
  });
  botaoAnterior.onclick = () => { semanaOffset--; renderSemana(); };
  botaoProxima.onclick = () => { semanaOffset++; renderSemana(); };
  [campoRegiaoSemana, campoSituacaoSemana].forEach(el => el.onchange = renderSemana);
  let atrasoSemana;
  campoBaseSemana.oninput = () => { clearTimeout(atrasoSemana); atrasoSemana = setTimeout(renderSemana, 250); };

  // Rola pro topo ao abrir — a secao #dia-view ja fica no comeco do HTML (antes do header/main), mas
  // sem isso a pagina pode continuar com o scroll de onde o usuario estava na simulacao.
  abrir.onclick = () => { view.hidden = false; renderSemana(); scrollTo({top: 0, behavior: 'smooth'}); };
  fechar.onclick = () => { view.hidden = true; };
  document.addEventListener('visao-dia:atualizar', event => {
    view.hidden = false;
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.diaTab === 'data')));
    paineis.semana.hidden = true; paineis.hoje.hidden = true; paineis.data.hidden = false;
    campoData.value = event.detail.dia; renderDia();
    scrollTo({top: 0, behavior: 'smooth'});
  });
})();
