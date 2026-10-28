'use strict';
// Visao do dia (refeita a pedido da usuaria, 2026-10-14): matriz cidade x produto, OK/NOK, olhando hoje
// + 5 dias com a VMD reprojetada como saida. Calculada na hora para todas as bases do snapshot (nao
// depende de cenario salvo); a cidade fica com a situacao do PIOR deposito. As abas antigas de
// simulacoes salvas ("Simulações de hoje" e "Por data") sairam: "nao faz sentido isso aqui".
(() => {
  const cloud = window.SIM_CLOUD;
  const view = $('dia-view'), abrir = $('ver-dia'), fechar = $('dia-fechar');

  // Janela e regras (mesmas de antes, so' que em hoje + 5 dias, nao 14):
  // critico = fechamento negativo ou abaixo do lastro em algum dia; atencao = sem critico, mas algum dia
  // com fechamento igual ou abaixo do minimo. Critico HOJE tem cor propria (vermelho sangue).
  const DIAS_A_FRENTE = 5;
  const REGIONAIS = [['SP', 'SP'], ['CO', 'CO'], ['MG_RJ', 'MG + RJ'], ['OUTRAS', 'Outras']];
  const CENARIO = 'VMD';
  const SITUACOES = {
    'critico-hoje': {rotulo: 'Crítico hoje', peso: 0},
    critico: {rotulo: 'Crítico até D+' + DIAS_A_FRENTE, peso: 1},
    atencao: {rotulo: 'Atenção', peso: 2},
    ok: {rotulo: 'OK', peso: 3},
  };
  // Colunas na ordem da planilha da usuaria; produto que nao estiver aqui entra no fim com o proprio nome.
  const COLUNAS = [['Gasolina A', 'Gasolina'], ['Gasolina Premium', 'Gasolina Premium'], ['Diesel S10 A', 'S10'],
    ['Diesel S500 A', 'S500'], ['Etanol Anidro', 'Anidro'], ['Etanol Hidratado', 'Hidratado'], ['Biodiesel', 'B100']];

  function abrirCenario(base, produto, cenario = CENARIO) {
    // Perfil 'base' nao ve a aba Simulacao de estoques (usuaria, 2026-10-21): o clique nos Alertas nao leva pra la'.
    if (window.SIM_AUTH?.profile?.perfil === 'base') return;
    trocarAba('simulacao');
    // Mesmo caminho de quem escolhe na mao (onchange), pra marcar os chips de deposito/empresa —
    // so' trocar o .value dos selects deixava a tela sem base selecionada.
    const registro = D.records.find(r => r.base === base && r.product === produto) || D.records.find(r => r.base === base);
    if (registro) {
      $('cidade').value = cidadeDe(registro); $('cidade').onchange();
      $('deposito').value = depositoDe(registro); $('deposito').onchange();
      $('empresa').value = empresaDe(registro); $('empresa').onchange();
    }
    if ([...$('product').options].some(o => o.value === produto)) $('product').value = produto;
    $('scenario').value = cenario; select();
    scrollTo({top: 0, behavior: 'smooth'});
  }

  const iso = i => day(i);
  const dataCurta = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
  const indiceHoje = () => Math.max(0, Math.round((new Date(simulationToday() + 'T12:00:00') - new Date(D.date + 'T12:00:00')) / 86400000));

  // "Em trânsito" do BI (coluna transito_caminhoes): so' FOB com status Em Andamento ou Viagem Finalizada,
  // de hoje em diante — sem CIF e sem Frota Dedicada/Placa Enviada (que o simulador conta no grafico).
  // Conferido 2026-10-14: com isso o ranking bateu 15 de 15 cidades com o BI.
  const STATUS_TRANSITO_BI = ['Em Andamento', 'Viagem Finalizada'];
  function transitoBI(r, hojeIso) {
    const porDia = D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material];
    if (!porDia) return 0;
    let total = 0;
    for (const [dia, dados] of Object.entries(porDia)) {
      if (dia < hojeIso) continue;
      for (const v of dados?.viagens || []) if (v.modal === 'fob' && STATUS_TRANSITO_BI.includes(v.status)) total += v.volume || 0;
    }
    return total;
  }

  // Situacao de um registro (base + deposito + empresa + produto) na janela hoje..hoje+5.
  function avaliar(r) {
    const content = fresh(r, CENARIO, 'auto'), resultado = E.calculate(content, n);
    const inicio = indiceHoje(), fim = Math.min(resultado.length - 1, inicio + DIAS_A_FRENTE);
    if (inicio > fim) return null;
    let primeiroCritico = null, atencao = false, menor = Infinity, diaMenor = null, ruptura = null;
    for (let i = inicio; i <= fim; i++) {
      const fechamento = resultado[i].close;
      if (fechamento < menor) { menor = fechamento; diaMenor = i; }
      const critico = fechamento < 0 || (content.lastro !== null && fechamento < content.lastro);
      if (critico && primeiroCritico === null) primeiroCritico = i;
      if (!critico && content.min !== null && fechamento <= content.min) atencao = true;
      if (fechamento < 0 && ruptura === null) ruptura = i;
    }
    const situacao = primeiroCritico !== null ? (primeiroCritico === inicio ? 'critico-hoje' : 'critico') : atencao ? 'atencao' : 'ok';
    // Sem venda prevista (VMD) na janela: fica fora dos Alertas (usuaria, 2026-10-14), mas segue no Cenario.
    let vendaJanela = 0;
    for (let i = inicio; i <= fim; i++) vendaJanela += content.movements.sale[i] || 0;
    // Pro ranking de dias de estoque: abertura de hoje (ja' projetada, se a planilha for de dia anterior)
    // e a VMD reprojetada de hoje.
    return {situacao, semVmd: vendaJanela <= 0, aberturaHoje: resultado[inicio].opening, vmdHoje: content.movements.sale[inicio] || 0,
      vmdPlanejada: r.bi?.vmdPlanejada ?? null,
      // Igual ao BI ('Abertura Estoque' = abertura - lastro; 'Estoque total' = isso + em transito de hoje em diante).
      lastroHoje: content.lastro || 0,
      transitoFuturo: transitoBI(r, iso(inicio)),
      menor, diaMenor: iso(diaMenor), primeiroCritico: primeiroCritico === null ? null : iso(primeiroCritico),
      ruptura: ruptura === null ? null : iso(ruptura), inicio: iso(inicio), fim: iso(fim)};
  }

  function calcular() {
    const itens = [];
    for (const r of D.records) {
      try { const av = avaliar(r); if (av) itens.push({registro: r, cidade: cidadeDe(r), produto: r.product, ...av}); }
      catch { /* registro sem dado suficiente pro calculo (ex.: sem abertura); fica fora */ }
    }
    return itens;
  }

  // Pior deposito da cidade por produto (pedido da usuaria: "nao precisa abrir por deposito").
  function matriz(itens) {
    const celulas = new Map();
    for (const it of itens) {
      const chave = `${it.cidade}|${it.produto}`, atual = celulas.get(chave);
      if (!atual) { celulas.set(chave, {pior: it, itens: [it]}); continue; }
      atual.itens.push(it);
      const p = SITUACOES[it.situacao].peso - SITUACOES[atual.pior.situacao].peso;
      if (p < 0 || (p === 0 && it.menor < atual.pior.menor)) atual.pior = it;
    }
    return celulas;
  }

  function textoCelula(c) {
    const it = c.pior;
    if (it.situacao === 'ok') return 'OK';
    if (it.situacao === 'atencao') return 'Atenção';
    return it.situacao === 'critico-hoje' ? 'NOK · hoje' : `NOK · ${dataCurta(it.primeiroCritico)}`;
  }
  // Popup ao passar o mouse na celula (pedido da usuaria, 2026-10-14: os cartoes por cidade sairam;
  // o detalhe aparece so' ao "relar" no dia). Uma linha por deposito/empresa da cidade, pior primeiro.
  function popupCelula(c) {
    const it = c.pior;
    const depositos = [...c.itens].sort((a, b) => SITUACOES[a.situacao].peso - SITUACOES[b.situacao].peso || a.menor - b.menor);
    return `<strong>${esc(it.cidade)} · ${esc(it.produto)}</strong><p>${esc(SITUACOES[it.situacao].rotulo)}, de ${dataCurta(it.inicio)} a ${dataCurta(it.fim)}</p>`
      + `<dl>${depositos.map(d => `<div><dt>${esc(depositoDe(d.registro))} · ${esc(empresaDe(d.registro))}</dt><dd>${esc(SITUACOES[d.situacao].rotulo)} · menor ${fmt(d.menor)} m³ em ${dataCurta(d.diaMenor)}${d.ruptura ? ` · ruptura ${dataCurta(d.ruptura)}` : ''}</dd></div>`).join('')}</dl>`
      + `<p>Clique para abrir ${depositos.length > 1 ? 'o pior depósito' : 'este depósito'} no simulador.</p>`;
  }

  const campoRegiao = $('semana-regiao'), campoBusca = $('semana-base'), campoSituacao = $('semana-situacao'),
    statusEl = $('semana-status'), barra = $('semana-barra'), tabela = $('matriz-risco'), popup = $('matriz-popover'),
    campoProdutoRanking = $('ranking-produto'), ranking = $('ranking-lista'), campoTransito = $('ranking-transito');

  // Ranking de dias de estoque por cidade (pedido da usuaria, 2026-10-14, igual ao visual "Ranking Dias
  // de Estoque" do BI): dias = abertura de hoje / VMD reprojetada de hoje, somando todos os depositos
  // (e todos os produtos, se nenhum for escolhido). A cor da barra e' a pior situacao da matriz.
  function renderRanking(itens, colunas, celulas) {
    const produto = campoProdutoRanking.value;
    const opcoes = [['', 'Todos os produtos'], ...colunas];
    if (campoProdutoRanking.options.length !== opcoes.length) {
      campoProdutoRanking.innerHTML = opcoes.map(([v, r]) => `<option value="${esc(v)}">${esc(r)}</option>`).join('');
      campoProdutoRanking.value = opcoes.some(([v]) => v === produto) ? produto : '';
    }
    const escolhido = campoProdutoRanking.value;
    const porCidade = new Map();
    for (const it of itens) {
      if (escolhido && it.produto !== escolhido) continue;
      const c = porCidade.get(it.cidade) || {abertura: 0, vmd: 0};
      c.abertura += estoqueTotal(it); c.vmd += vmdRef(it);
      porCidade.set(it.cidade, c);
    }
    const piorSituacao = cid => {
      const pesos = colunas.filter(([p]) => !escolhido || p === escolhido).map(([p]) => celulas.get(`${cid}|${p}`)).filter(Boolean).map(c => c.pior.situacao);
      return pesos.sort((a, b) => SITUACOES[a].peso - SITUACOES[b].peso)[0] || 'ok';
    };
    // Com todos os produtos juntos, a barra fica na cor neutra (um produto ruim pintaria a cidade inteira).
    const linhas = [...porCidade.entries()].filter(([, c]) => c.vmd >= 1).map(([cidade, c]) => ({cidade, dias: c.abertura / c.vmd, ...c, situacao: escolhido ? piorSituacao(cidade) : 'neutra'}))
      .sort((a, b) => b.dias - a.dias);
    const maximo = Math.max(...linhas.map(l => l.dias), 1);
    if (cidadeRanking && !linhas.some(l => l.cidade === cidadeRanking)) cidadeRanking = null;
    ranking.innerHTML = !linhas.length ? '<p class="muted">Sem VMD para calcular os dias de estoque.</p>'
      : linhas.map(l => `<button type="button" class="ranking-linha${l.cidade === cidadeRanking ? ' selecionada' : ''}" data-ranking-cidade="${esc(l.cidade)}" title="${esc(`${l.cidade}: estoque total (abertura − lastro + trânsito) ${fmt(l.abertura)} m³ ÷ VMD planejada ${fmt(l.vmd)} m³/dia = ${dias1(l.dias)} dias. Clique para ver por produto.`)}">
        <span class="ranking-cidade">${esc(l.cidade)}</span>
        <span class="ranking-trilho"><span class="ranking-barra ${l.situacao}" style="width:${Math.max(1, l.dias / maximo * 100)}%"></span></span>
        <span class="ranking-valor">${dias1(l.dias)}</span></button>`).join('');
    renderPorProduto(itens, colunas);
  }
  const dias1 = v => v.toFixed(1).replace('.', ',');
  // VMD do Cenario = 'VMD Planejada' do BI (media por dia util de hoje ate' o fim do mes, calculada na carga);
  // carga antiga sem esse campo cai na VMD de hoje.
  const vmdRef = it => it.vmdPlanejada ?? Math.max(it.vmdHoje, 0);
  const aberturaLiquida = it => Math.max(it.aberturaHoje, 0) - (it.lastroHoje || 0);
  // Ticzinho "Considerar trânsito" (usuaria, 2026-10-14): marcado = igual ao BI; desmarcado = so' a abertura.
  const comTransito = () => campoTransito.checked;
  const estoqueTotal = it => aberturaLiquida(it) + (comTransito() ? (it.transitoFuturo || 0) : 0);

  // Quadro por produto ao lado do ranking (pedido da usuaria, 2026-10-14, igual ao BI: Abertura Estoque,
  // VMD Planejada, Dias Estoque), mais o tamanho do tanque. Todas as cidades, ou a cidade clicada no ranking.
  let cidadeRanking = null;
  function renderPorProduto(itens, colunas) {
    const alvo = $('ranking-produtos');
    const escolhidos = itens.filter(it => !cidadeRanking || it.cidade === cidadeRanking);
    const linhas = colunas.map(([produto, rotulo]) => {
      const doProduto = escolhidos.filter(it => it.produto === produto);
      if (!doProduto.length) return null;
      const soma = f => doProduto.reduce((s, it) => s + f(it), 0);
      const abertura = soma(aberturaLiquida), transito = soma(it => it.transitoFuturo || 0), vmd = soma(vmdRef);
      const capacidade = it => it.registro.capacidadeFisica ?? it.registro.policy?.capacity ?? 0;
      const tanque = soma(capacidade);
      // Autonomia do tanque (pedido da usuaria, 2026-10-14): tanque / VMD = quantos dias de venda o tanque
      // cheio aguenta. So' a VMD de quem tem capacidade, pra venda no bico nao diminuir a autonomia.
      const vmdComTanque = soma(it => (capacidade(it) > 0 ? vmdRef(it) : 0));
      return {rotulo, abertura, transito, vmd, tanque, vmdComTanque, dias: vmd >= 1 ? (abertura + (comTransito() ? transito : 0)) / vmd : null, autonomia: tanque > 0 && vmdComTanque > 0 ? tanque / vmdComTanque : null};
    }).filter(Boolean);
    // Linha de total (pedido da usuaria, 2026-10-14: "faca um somatorio"): volumes somados; dias e
    // autonomia recalculados sobre os totais (nao e' soma nem media dos dias de cada produto).
    const total = ['abertura', 'transito', 'vmd', 'tanque', 'vmdComTanque'].reduce((t, k) => ({...t, [k]: linhas.reduce((s, l) => s + l[k], 0)}), {});
    total.dias = total.vmd >= 1 ? (total.abertura + (comTransito() ? total.transito : 0)) / total.vmd : null;
    total.autonomia = total.tanque > 0 && total.vmdComTanque > 0 ? total.tanque / total.vmdComTanque : null;
    alvo.innerHTML = `<div class="ranking-produtos-topo"><strong>${esc(cidadeRanking || 'Todas as cidades')}</strong>${cidadeRanking ? ' <button type="button" id="ranking-limpar">ver todas</button>' : '<small>clique numa cidade do ranking para filtrar</small>'}</div>
      <table class="ranking-produtos-tabela"><thead><tr><th>Produto</th><th title="Abertura de hoje menos o lastro mínimo">Abertura estoque</th><th>Em trânsito</th><th>VMD planejada</th><th>Dias de estoque</th><th>Tamanho do tanque</th><th title="Tamanho do tanque ÷ VMD planejada: quantos dias de venda o tanque cheio aguenta">Autonomia do tanque (dias)</th></tr></thead>
      <tbody>${linhas.map(l => `<tr><th>${esc(l.rotulo)}</th><td>${fmt(l.abertura)}</td><td>${fmt(l.transito)}</td><td>${fmt(l.vmd)}</td><td>${l.dias == null ? '—' : dias1(l.dias)}</td><td>${l.tanque ? fmt(l.tanque) : '<span class="sem-capacidade">Sem capacidade estabelecida</span>'}</td><td>${l.autonomia == null ? '—' : dias1(l.autonomia)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th><td>${fmt(total.abertura)}</td><td>${fmt(total.transito)}</td><td>${fmt(total.vmd)}</td><td>${total.dias == null ? '—' : dias1(total.dias)}</td><td>${total.tanque ? fmt(total.tanque) : '—'}</td><td>${total.autonomia == null ? '—' : dias1(total.autonomia)}</td></tr></tfoot></table>`;
  }
  $('ranking-dias-bloco').addEventListener('click', event => {
    const linha = event.target.closest('[data-ranking-cidade]');
    if (linha) { cidadeRanking = cidadeRanking === linha.dataset.rankingCidade ? null : linha.dataset.rankingCidade; renderCenario(); return; }
    if (event.target.closest('#ranking-limpar')) { cidadeRanking = null; renderCenario(); }
  });

  function colunasDe(itens) {
    const presentes = new Set(itens.map(it => it.produto));
    return COLUNAS.filter(([p]) => presentes.has(p))
      .concat([...presentes].filter(p => !COLUNAS.some(([c]) => c === p)).sort().map(p => [p, p]));
  }
  // Ranking + quadro por produto ficam na aba Cenario (pedido da usuaria, 2026-10-14); a aba Alertas
  // fica so' com a matriz. Aqui sem filtro de regiao/cidade: visao geral de todas as cidades do login.
  function renderCenario() {
    ranking.innerHTML = '';
    const itens = calcular();
    renderRanking(itens, colunasDe(itens), matriz(itens));
  }
  campoProdutoRanking.onchange = renderCenario;
  // Sempre abre marcado, sem lembrar do navegador (usuaria, 2026-10-28: tudo no padrao a cada acesso).
  campoTransito.checked = true;
  try { localStorage.removeItem('simulador.cenarioTransito'); } catch {}
  campoTransito.onchange = () => renderCenario();

  function render() {
    statusEl.textContent = 'Calculando…'; barra.innerHTML = ''; tabela.innerHTML = ''; fecharPopup();
    let itens = calcular();
    const regiao = campoRegiao.value, busca = campoBusca.value.trim().toLowerCase();
    // Fora dos Alertas: sem VMD na janela e sem capacidade de tanque estabelecida (venda no bico, 2026-10-14).
    itens = itens.filter(it => !it.semVmd && it.registro.capacidadeFisica !== 0 && (!regiao || cloud.regionOf(it.registro.base) === regiao) && (!busca || it.cidade.toLowerCase().includes(busca)));
    const celulas = matriz(itens);
    const filtroSituacao = campoSituacao.value;
    const passaSituacao = c => !filtroSituacao || (filtroSituacao === 'critico' ? c.pior.situacao.startsWith('critico') : c.pior.situacao === filtroSituacao);
    const cidades = [...new Set(itens.map(it => it.cidade))].filter(cid => [...celulas.entries()].some(([k, c]) => k.startsWith(cid + '|') && passaSituacao(c)));
    const colunas = colunasDe(itens);
    if (!cidades.length) { statusEl.textContent = 'Nenhuma cidade encontrada com os filtros atuais.'; return; }

    const piorDaCidade = cid => Math.min(...colunas.map(([p]) => celulas.get(`${cid}|${p}`)).filter(Boolean).map(c => SITUACOES[c.pior.situacao].peso));
    cidades.sort((a, b) => piorDaCidade(a) - piorDaCidade(b) || a.localeCompare(b, 'pt-BR'));

    const visiveis = cidades.flatMap(cid => colunas.map(([p]) => celulas.get(`${cid}|${p}`)).filter(c => c && passaSituacao(c)));
    const resumo = visiveis.reduce((acc, c) => ({...acc, [c.pior.situacao]: (acc[c.pior.situacao] || 0) + 1}), {});
    const amostra = itens[0];
    statusEl.textContent = `Hoje (${dataCurta(amostra.inicio)}) até ${dataCurta(amostra.fim)} · vendas pela VMD reprojetada · `
      + `${cidades.length} cidade(s), ${visiveis.length} combinação(ões) cidade × produto: `
      + Object.keys(SITUACOES).map(s => `${resumo[s] || 0} ${SITUACOES[s].rotulo.toLowerCase()}`).join(' · ') + '.';
    barra.innerHTML = Object.keys(SITUACOES).filter(s => resumo[s]).map(s =>
      `<span class="${s}" style="flex:${resumo[s]}" title="${SITUACOES[s].rotulo}">${resumo[s]}</span>`).join('');

    // Agrupada por regional (usuaria, 2026-10-14): SP, CO, MG + RJ — dentro de cada uma, pior situacao primeiro.
    const regiaoDaCidade = new Map(itens.map(it => [it.cidade, cloud.regionOf(it.registro.base) || 'OUTRAS']));
    const linhaCidade = cid => `<tr><th>${esc(cid)}</th>${colunas.map(([p]) => {
        const c = celulas.get(`${cid}|${p}`);
        if (!c || !passaSituacao(c)) return '<td class="vazio">—</td>';
        return `<td class="${c.pior.situacao}"><button type="button" data-abrir="${esc(c.pior.registro.base)}|${esc(p)}" data-celula="${esc(`${cid}|${p}`)}" aria-label="${esc(`${cid} · ${p}: ${SITUACOES[c.pior.situacao].rotulo}`)}">${textoCelula(c)}</button></td>`;
      }).join('')}</tr>`;
    tabela.innerHTML = `<thead><tr><th>Cidade / produto</th>${colunas.map(([, rotulo]) => `<th>${esc(rotulo)}</th>`).join('')}</tr></thead><tbody>`
      + REGIONAIS.map(([codigo, rotulo]) => {
        const doGrupo = cidades.filter(cid => (regiaoDaCidade.get(cid) === codigo) || (codigo === 'OUTRAS' && !REGIONAIS.some(([r]) => r === regiaoDaCidade.get(cid))));
        if (!doGrupo.length) return '';
        return `<tr class="regiao-linha"><th colspan="${colunas.length + 1}">${esc(rotulo)} <small>${doGrupo.length} cidade(s)</small></th></tr>` + doGrupo.map(linhaCidade).join('');
      }).join('') + '</tbody>';
    celulasAtuais = celulas;
  }

  let celulasAtuais = new Map();
  function mostrarPopup(botao) {
    const c = celulasAtuais.get(botao.dataset.celula); if (!c) return;
    popup.innerHTML = popupCelula(c); popup.hidden = false;
    const r = botao.getBoundingClientRect(), w = popup.offsetWidth, h = popup.offsetHeight;
    const esquerda = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    const topo = r.bottom + 8 + h <= innerHeight - 8 ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    popup.style.left = `${esquerda}px`; popup.style.top = `${topo}px`;
  }
  const fecharPopup = () => { popup.hidden = true; };
  tabela.addEventListener('pointerover', event => { const b = event.target.closest('[data-celula]'); if (b) mostrarPopup(b); });
  tabela.addEventListener('focusin', event => { const b = event.target.closest('[data-celula]'); if (b) mostrarPopup(b); });
  tabela.addEventListener('pointerout', event => { if (event.target.closest('[data-celula]')) fecharPopup(); });
  tabela.addEventListener('focusout', fecharPopup);
  addEventListener('scroll', fecharPopup, true);

  tabela.addEventListener('click', event => {
    const botao = event.target.closest('[data-abrir]'); if (!botao) return;
    fecharPopup();
    const [base, produto] = botao.dataset.abrir.split('|');
    abrirCenario(base, produto);
  });
  [campoRegiao, campoSituacao].forEach(el => el.onchange = render);
  let atraso;
  campoBusca.oninput = () => { clearTimeout(atraso); atraso = setTimeout(render, 250); };

  // ================= Historico =================
  // Simulacoes salvas pela equipe ("Salvar na equipe"), por dia — juncao das antigas abas "Simulações de
  // hoje" e "Por data" (pedido da usuaria, 2026-10-14: "a parte do historico, pra pessoa acompanhar as
  // simulacoes feitas"). So' le o que foi gravado (versoes imutaveis), agrupado por cidade.
  const campoDiaHist = $('hist-dia'), campoRegiaoHist = $('hist-regiao'), campoBuscaHist = $('hist-busca'),
    statusHist = $('hist-status'), listaHist = $('hist-lista');
  campoDiaHist.value = simulationToday();
  let geracaoHist = 0;
  const rotuloSalvo = {critico: 'Crítico', atencao: 'Atenção', ok: 'OK'};

  async function renderHistorico() {
    const minha = ++geracaoHist;
    statusHist.textContent = 'Carregando…'; listaHist.innerHTML = ''; itensHist = [];
    const dia = campoDiaHist.value || simulationToday();
    let arvore;
    try { arvore = await cloud.listDay(dia); }
    catch (error) { if (minha === geracaoHist) statusHist.textContent = `Não foi possível carregar: ${error.message}`; return; }
    if (minha !== geracaoHist) return;
    let itens = [];
    for (const porChave of Object.values(arvore || {})) {
      for (const chaveNode of Object.values(porChave)) {
        const versoes = Object.values(chaveNode.versoes || {});
        if (versoes.length) itens.push(versoes.reduce((a, b) => (a.versao > b.versao ? a : b)));
      }
    }
    itens = itens.map(it => { const r = D.records.find(x => x.base === it.base); return {...it, cidade: r ? cidadeDe(r) : (it.base || '—')}; });
    const regiao = campoRegiaoHist.value, busca = campoBuscaHist.value.trim().toLowerCase();
    itens = itens.filter(it => (!regiao || cloud.regionOf(it.base) === regiao)
      && (!busca || [it.base, it.cidade, it.produto].some(v => (v || '').toLowerCase().includes(busca))));
    const dataFmt = new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR');
    if (!itens.length) { statusHist.textContent = `Nenhuma simulação salva em ${dataFmt} com os filtros atuais.`; return; }
    const porCidade = new Map();
    for (const it of itens) { if (!porCidade.has(it.cidade)) porCidade.set(it.cidade, []); porCidade.get(it.cidade).push(it); }
    const cidades = [...porCidade.entries()].map(([cidade, lista]) => ({cidade, lista: lista.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0))}))
      .sort((a, b) => b.lista.length - a.lista.length || a.cidade.localeCompare(b.cidade, 'pt-BR'));
    statusHist.textContent = `${itens.length} simulação(ões) salva(s) em ${dataFmt}, em ${cidades.length} cidade(s). Mostra a versão mais recente de cada base, produto e cenário.`;
    listaHist.innerHTML = cidades.map(c => `<details class="card"${cidades.length <= 3 ? ' open' : ''}>
      <summary><strong>${esc(c.cidade)}</strong> <small>${c.lista.length} simulação(ões)</small></summary>
      <table class="hoje-tabela"><thead><tr><th>Base</th><th>Produto</th><th>Cenário</th><th>Situação ao salvar</th><th>Menor estoque (m³)</th><th>Versão</th><th>Autor / motivo</th><th>Horário</th><th></th></tr></thead>
      <tbody>${c.lista.map(it => `<tr class="dia-${it.indicadores?.situacao || ''}">
        <td>${esc(it.base)}</td><td>${esc(it.produto)}</td><td>${esc(it.cenario === 'Real' ? 'Faturamento' : it.cenario)}</td>
        <td>${esc(rotuloSalvo[it.indicadores?.situacao] || '—')}</td>
        <td>${it.indicadores ? fmt(it.indicadores.menorEstoque) : '—'}${it.indicadores?.diaMenorEstoque ? ` <small>em ${dataCurta(it.indicadores.diaMenorEstoque)}</small>` : ''}</td>
        <td>v${it.versao}</td>
        <td>${esc(it.autorNome || '—')}${it.motivo ? `<br><small>${esc(it.motivo)}</small>` : ''}</td>
        <td>${it.atualizadoEm ? new Date(it.atualizadoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '—'}</td>
        <td><button type="button" data-abrir-hist="${itensHist.push(it) - 1}">Abrir</button></td>
      </tr>`).join('')}</tbody></table>
    </details>`).join('');
  }
  // "Abrir" mostra a simulacao CONGELADA, exatamente como o analista salvou (premissas + movimentos gravados
  // em `conteudo`), sem levar pro simulador com os dados de hoje (usuaria, 2026-10-20: "quero que realmente
  // seja o cenario que o analista salvou, e nao que me envie pro simulador do dia atual").
  let itensHist = [];
  const dialogoHist = document.createElement('dialog');
  dialogoHist.className = 'hist-dialogo'; document.body.append(dialogoHist);
  dialogoHist.addEventListener('click', e => { if (e.target === dialogoHist || e.target.closest('[data-fechar]')) dialogoHist.close(); });
  function abrirVersaoSalva(it) {
    let s;
    try { s = JSON.parse(it.conteudo); } catch { alert('Não foi possível ler esta versão salva.'); return; }
    const inicio = Math.max(0, Math.round((new Date((it.atualizadoEm ? new Date(it.atualizadoEm).toLocaleDateString('sv-SE') : s.date) + 'T12:00:00')
      - new Date(s.date + 'T12:00:00')) / 86400000));
    const total = Math.min(30, s.movements?.sale?.length || 15), dias = [...Array(Math.min(15, total - inicio)).keys()].map(k => k + inicio);
    const calc = E.calculate(s, total);
    const dataDe = i => { const d = new Date(s.date + 'T12:00:00'); d.setDate(d.getDate() + i);
      return d.toLocaleDateString('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit'}).replace('.', ''); };
    const rotuloVenda = {VMD: 'Vendas · VMD reprojetada', 'Pedidos em tela': 'Vendas · Pedidos em tela', Real: 'Vendas · Faturamento', LE: 'Vendas · LE vigente'}[s.scenario] || 'Vendas';
    const linhasMov = E.rows.filter(([k]) => dias.some(i => (s.movements[k]?.[i] || 0) !== 0))
      .map(([k, nome, sinal]) => `<tr><th scope="row">${sinal > 0 ? '+' : '−'} ${esc(k === 'sale' ? rotuloVenda : nome)}</th>${dias.map(i => `<td>${fmt(s.movements[k][i])}</td>`).join('')}</tr>`).join('');
    const faixa = v => ({danger: 'hist-critico', warn: 'hist-atencao', good: 'hist-ok', high: 'hist-alto'})[E.stockBand(v, s)] || '';
    const premissa = (rot, v) => `<div><small>${rot}</small><strong>${v == null ? '—' : fmt(v) + ' m³'}</strong></div>`;
    dialogoHist.innerHTML = `<header><div><h2>${esc(it.base)} · ${esc(it.produto)}</h2>
        <p>Cenário <strong>${esc(it.cenario === 'Real' ? 'Faturamento' : it.cenario)}</strong> · v${it.versao} · salvo por <strong>${esc(it.autorNome || '—')}</strong>
        ${it.atualizadoEm ? ` em ${new Date(it.atualizadoEm).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}` : ''}
        ${it.motivo ? `<br>Motivo: ${esc(it.motivo)}` : ''}</p>
        <p class="hist-congelado">🔒 Exatamente como foi salvo — não usa os dados de hoje.</p></div>
        <button type="button" data-fechar aria-label="Fechar">✕</button></header>
      <div class="hist-premissas">${premissa('Abertura', s.opening)}${premissa('Lastro', s.lastro)}${premissa('Mínimo', s.min)}${premissa('Médio', s.mid)}${premissa('Máximo', s.max)}${premissa('Capacidade', s.capacity)}</div>
      <div class="hist-tabela"><table><thead><tr><th>m³</th>${dias.map(i => `<th>${dataDe(i)}</th>`).join('')}</tr></thead><tbody>
        <tr class="hist-abertura"><th scope="row">Estoque inicial</th>${dias.map(i => `<td>${fmt(calc[i].opening)}</td>`).join('')}</tr>
        ${linhasMov}
        <tr class="hist-final"><th scope="row">= Estoque final</th>${dias.map(i => `<td class="${faixa(calc[i].close)}">${fmt(calc[i].close)}</td>`).join('')}</tr>
      </tbody></table></div>`;
    dialogoHist.showModal();
  }
  listaHist.addEventListener('click', event => {
    const botao = event.target.closest('[data-abrir-hist]'); if (!botao) return;
    const it = itensHist[+botao.dataset.abrirHist]; if (it) abrirVersaoSalva(it);
  });
  [campoDiaHist, campoRegiaoHist].forEach(el => el.onchange = renderHistorico);
  let atrasoHist;
  campoBuscaHist.oninput = () => { clearTimeout(atrasoHist); atrasoHist = setTimeout(renderHistorico, 250); };

  // ================= Abas da pagina =================
  // Abas no estilo do portal inbound (pedido da usuaria, 2026-10-14): Simulacao de estoques, Alertas
  // (a Visao do dia), Cenario (editar volumes do dia + politica) e Historico. Cada filho de <main>
  // recebe data-aba com as abas em que aparece; o CSS esconde o resto conforme body[data-aba].
  const main = document.querySelector('main');
  const historicoView = $('historico-view'), rankingView = $('ranking-view');
  main.prepend(view, historicoView, rankingView);
  view.hidden = false; historicoView.hidden = false; rankingView.hidden = false;
  rankingView.dataset.aba = 'cenario';
  const filhoDeMain = el => { while (el && el.parentElement !== main) el = el.parentElement; return el; };
  const marcar = (seletor, abas) => { const el = filhoDeMain(document.querySelector(seletor)); if (el) el.dataset.aba = abas; };
  view.dataset.aba = 'alertas'; historicoView.dataset.aba = 'historico';
  marcar('main > .title', 'simulacao');
  marcar('section.filters', 'simulacao cenario');
  // Editor do dia continua escondido (cenarios.js): a usuaria preferiu a aba Cenario so' com a politica.
  marcar('section.editor-panel', 'cenario');
  marcar('section.assumptions', 'cenario');
  // "Pontos de atencao" saiu da tela (usuaria, 2026-10-14: "pode tirar"): fica fora de todas as abas.
  marcar('#alerts', 'nenhuma');
  for (const filho of main.children) if (!filho.dataset.aba) filho.dataset.aba = 'simulacao';

  const botoesAba = [...document.querySelectorAll('#abas-bar [data-aba-alvo]')];
  function trocarAba(nome) {
    document.body.dataset.aba = nome;
    botoesAba.forEach(b => b.setAttribute('aria-selected', String(b.dataset.abaAlvo === nome)));
    fecharPopup();
    if (nome === 'alertas') render();
    else if (nome === 'cenario') renderCenario();
    else if (nome === 'historico') renderHistorico();
  }
  botoesAba.forEach(b => b.onclick = () => { trocarAba(b.dataset.abaAlvo); scrollTo({top: 0}); });
  $('abas-bar').hidden = false;
  abrir.hidden = true; fechar.hidden = true;
  // Sempre abre na "Simulacao de estoques" (usuaria, 2026-10-28: "quero que ja venha padrao na aba Simulacao de
  // estoques"); nao lembra mais a ultima aba. O perfil 'base' continua abrindo em Aberturas (aberturas.js).
  try { localStorage.removeItem('simulador.aba'); } catch {}
  trocarAba('simulacao');
})();
