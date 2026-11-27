'use strict';
// Aba "Log mínimo" (usuaria, 2026-11-16: "um log pra validarmos esse estoque minimo por deposito e produto, pra
// gente ver qual deve ser a cadencia ideal"). Toda terca 12h o robo (nexta_etl/etl/pipelines/log_estoque_minimo.py)
// grava em logEstoqueMinimo/<dia> a cadencia que o botao "Estoque mínimo" sugeriria naquela hora, pra cada
// cidade/deposito/empresa/produto, com a VMD reprojetada. Esta aba so' le e mostra; cada terca fica separada.
(function () {
  const cloud = window.SIM_CLOUD;
  const main = document.querySelector('main'), barra = document.getElementById('abas-bar');
  if (!cloud?.logEstoqueMinimo || !main || !barra) return;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('pt-BR');
  const dataBR = iso => iso ? new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  const diaSem = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {weekday: 'short'}).replace('.', '');
  const ROTULO = {'sugerido': 'Sugerido', 'nao cabe': 'Não cabe', 'sem necessidade': 'Sem necessidade',
                  'sem estoque minimo na politica': 'Sem mínimo na política', 'sem capacidade estabelecida': 'Sem capacidade',
                  'sem capacidade informada': 'Sem capacidade', 'erro': 'Erro no cálculo'};

  // ---- botao da aba + painel ----
  const botao = document.createElement('button');
  botao.type = 'button'; botao.setAttribute('role', 'tab'); botao.dataset.abaAlvo = 'logminimo';
  botao.innerHTML = '<svg class="aba-icone" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8l3 3v13H5V4h3"/><path d="M8 11h8M8 15h8M8 7h4" opacity=".7"/></svg><span>Log mínimo</span>';
  const usuarios = barra.querySelector('[data-aba-alvo="usuarios"]');
  barra.insertBefore(botao, usuarios || null);

  const painel = document.createElement('section');
  painel.id = 'log-minimo-view'; painel.className = 'panel'; painel.dataset.aba = 'logminimo';
  painel.innerHTML = `
<div class="section-title"><div><h2>Log · Estoque mínimo</h2>
<p>Toda terça às 12:00 o robô guarda a cadência que o simulador sugere para <strong>atingir o estoque mínimo</strong>,
por cidade, depósito, empresa e produto (venda: VMD reprojetada · entrada: trânsito real + não programado · cargas de 60 m³).
Cada terça fica guardada separada, para comparar e validar a cadência ideal.</p></div>
<div class="actions"><button type="button" id="logmin-excel">⬇ Excel</button></div></div>
<div class="dia-filtros logmin-filtros">
<label>Terça de<select id="logmin-dia"></select></label>
<label>Cidade<select id="logmin-cidade"><option value="">Todas</option></select></label>
<label>Produto<select id="logmin-produto"><option value="">Todos</option></select></label>
<label>Situação<select id="logmin-situacao"><option value="">Todas</option></select></label>
<label>Buscar<input id="logmin-busca" type="search" placeholder="Depósito, empresa…"></label>
</div>
<p id="logmin-status" class="muted" role="status"></p>
<div id="logmin-resumo" class="logmin-resumo"></div>
<div class="table-scroll"><table id="logmin-tabela" class="logmin-tabela"></table></div>`;
  main.appendChild(painel);

  let carregado = false;
  window.addEventListener('simulador:aba', event => {
    if (event.detail !== 'logminimo' || carregado) return;
    carregado = true;
    carregarIndice();
  });

  let dados = null;
  async function carregarIndice() {
    $('logmin-status').textContent = 'Carregando…';
    try {
      const indice = await cloud.logEstoqueMinimoIndice();
      const dias = Object.keys(indice).sort().reverse();
      if (!dias.length) { $('logmin-status').textContent = 'Ainda não há log. O primeiro é gravado na próxima terça às 12:00.'; return; }
      $('logmin-dia').innerHTML = dias.map(d => `<option value="${d}">${dataBR(d)} · ${fmt(indice[d].recortes)} recortes</option>`).join('');
      await carregarDia(dias[0]);
    } catch (e) { $('logmin-status').textContent = 'Não foi possível carregar o log: ' + (e.message || e); }
  }
  async function carregarDia(dia) {
    $('logmin-status').textContent = 'Carregando ' + dataBR(dia) + '…';
    const bruto = await cloud.logEstoqueMinimo(dia);
    const itens = Object.keys(bruto?.itens || {}).sort().map(k => bruto.itens[k]);
    dados = {...bruto, itens};
    const opcoes = (id, valores, todos) => { const atual = $(id).value; $(id).innerHTML = `<option value="">${todos}</option>` + valores.map(v => `<option value="${esc(v)}">${esc(ROTULO[v] || v)}</option>`).join(''); $(id).value = valores.includes(atual) ? atual : ''; };
    const unicos = f => [...new Set(itens.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    opcoes('logmin-cidade', unicos(i => i.cidade), 'Todas');
    opcoes('logmin-produto', unicos(i => i.produto), 'Todos');
    opcoes('logmin-situacao', unicos(i => i.situacao), 'Todas');
    desenhar();
  }

  function filtrados() {
    if (!dados) return [];
    const c = $('logmin-cidade').value, p = $('logmin-produto').value, s = $('logmin-situacao').value, b = $('logmin-busca').value.trim().toLowerCase();
    return dados.itens.filter(i => (!c || i.cidade === c) && (!p || i.produto === p) && (!s || i.situacao === s)
      && (!b || `${i.cidade} ${i.deposito} ${i.empresa} ${i.produto} ${i.base}`.toLowerCase().includes(b)));
  }
  function diasDoLog(itens) { return [...new Set(itens.flatMap(i => (i.dias || []).map(d => d.dia)))].sort(); }

  function desenhar() {
    const itens = filtrados(), dias = diasDoLog(dados.itens);
    const conta = s => itens.filter(i => i.situacao === s).length;
    const total = itens.reduce((s, i) => s + (i.totalSugerido || 0), 0);
    $('logmin-status').textContent = `Gerado em ${new Date(dados.geradoEm).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'})} · `
      + `dados de ${dataBR(dados.dataSnapshot)} · venda: ${dados.cenarioVenda || 'VMD reprojetada'} · entrada: ${(dados.entrada || 'Transito real').replace('Transito','Trânsito').replace('Nao programado','não programado')} · objetivo: atingir o estoque mínimo · cargas de ${dados.carga || 60} m³`;
    $('logmin-resumo').innerHTML = [[itens.length, 'recortes'], [conta('sugerido'), 'com sugestão'], [conta('nao cabe'), 'não cabe'],
      [conta('sem estoque minimo na politica'), 'sem mínimo na política'], [fmt(total) + ' m³', 'sugeridos']]
      .map(([v, r]) => `<span class="logmin-chip"><strong>${typeof v === 'number' ? fmt(v) : v}</strong> ${r}</span>`).join('');
    const cab = `<thead><tr><th>Cidade</th><th>Depósito</th><th>Empresa</th><th>Produto</th><th>Abertura</th><th>Est. mín.</th><th>Capac.</th>`
      + dias.map(d => `<th class="num">${diaSem(d)}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`).join('')
      + `<th class="num">Total m³</th><th class="num">Cargas</th><th>Situação</th></tr></thead>`;
    const linhas = itens.map(i => {
      const porDia = Object.fromEntries((i.dias || []).map(d => [d.dia, d]));
      const celulas = dias.map(d => { const x = porDia[d]; if (!x) return '<td class="num muted">·</td>';
        const titulo = `Vendas ${fmt(x.vendas)} m³ · entradas já previstas ${fmt(x.entradasSemSugestao)} m³`;
        return x.situacao === 'nao-cabe' ? `<td class="num logmin-naocabe" title="Precisava de carga, mas 60 m³ não cabem sem passar do mínimo/capacidade. ${titulo}">!</td>`
          : `<td class="num${x.sugerido ? ' logmin-sug' : ''}" title="${titulo}">${x.sugerido ? fmt(x.sugerido) : '—'}</td>`; }).join('');
      return `<tr><td>${esc(i.cidade)}</td><td>${esc(i.deposito)}</td><td>${esc(i.empresa)}</td><td>${esc(i.produto)}</td>`
        + `<td class="num">${fmt(i.abertura)}</td><td class="num">${fmt(i.estoqueMinimo)}</td><td class="num">${fmt(i.capacidade)}</td>${celulas}`
        + `<td class="num"><strong>${i.dias ? fmt(i.totalSugerido) : '—'}</strong></td><td class="num">${i.dias ? fmt(i.totalCargas) : '—'}</td>`
        + `<td><span class="logmin-sit logmin-sit-${esc(String(i.situacao).replace(/\s+/g, '-'))}">${esc(ROTULO[i.situacao] || i.situacao)}</span></td></tr>`;
    }).join('');
    $('logmin-tabela').innerHTML = cab + `<tbody>${linhas || `<tr><td colspan="${10 + dias.length}" class="muted">Nenhum recorte com esse filtro.</td></tr>`}</tbody>`;
  }

  // ---- Excel (CSV com ; e BOM, abre direto no Excel) ----
  $('logmin-excel').onclick = () => {
    if (!dados) return;
    const itens = filtrados(), dias = diasDoLog(dados.itens), num = v => v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',');
    const cab = ['Terça do log', 'Cidade', 'Depósito', 'Empresa', 'Produto', 'Abertura (m³)', 'Estoque mínimo (m³)', 'Capacidade (m³)',
      ...dias.map(d => `Sugerido ${d.slice(8, 10)}/${d.slice(5, 7)}`), 'Total sugerido (m³)', 'Cargas', 'Dias sem espaço', 'Situação'];
    const linhas = itens.map(i => { const porDia = Object.fromEntries((i.dias || []).map(d => [d.dia, d]));
      return [dataBR(dados.geradoEm), i.cidade, i.deposito, i.empresa, i.produto, num(i.abertura), num(i.estoqueMinimo), num(i.capacidade),
        ...dias.map(d => porDia[d] ? (porDia[d].situacao === 'nao-cabe' ? 'não cabe' : num(porDia[d].sugerido)) : ''),
        num(i.totalSugerido), i.totalCargas ?? '', i.diasNaoCabe ?? '', ROTULO[i.situacao] || i.situacao]; });
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(c => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    a.download = `log_estoque_minimo_${(dados.geradoEm || '').slice(0, 10)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $('logmin-dia').onchange = () => carregarDia($('logmin-dia').value).catch(e => { $('logmin-status').textContent = 'Erro: ' + (e.message || e); });
  for (const id of ['logmin-cidade', 'logmin-produto', 'logmin-situacao']) $(id).onchange = desenhar;
  $('logmin-busca').oninput = desenhar;
})();
