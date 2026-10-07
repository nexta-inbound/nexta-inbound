'use strict';
(() => {
 // 5 cenarios (pedido da usuaria, 2026-09-30): VMD/LE/Pedidos em tela/Real puxam dado pra linha que
 // debita (unica editavel); Disp MIS mantido a pedido dela ("deixa disp mis tbm"). O usuario sempre
 // pode digitar por cima do valor puxado (customizar), igual ja funcionava antes.
 const modes=['VMD','LE','Pedidos em tela','Real','Disp MIS'];
 const today=simulationToday;
 const dateLabel=value=>new Date(value+'T12:00:00').toLocaleDateString('pt-BR');
 const popup=$('sales-popover');
 let anchor=null;
 const selector=$('scenario');
 selector.parentElement.firstChild.textContent='Cenário de venda';
 options(selector,modes);
 // Pedido da usuaria, 2026-10-01: a tela agora abre sem nada selecionado (antes vinha com uma base
 // padrao fixa), entao "state" pode nao existir ainda nesse ponto — sem a guarda, isso quebrava TODO
 // o resto do script (botoes de cenario, popup, render/renderEditor sobrescritos) silenciosamente.
 if(state)selector.value=state.scenario;
 if(D.validationStart){
  $('history-grid').closest('section').hidden=true;
  const period=document.querySelector('.filters input[value]');
  if(period)period.value='22/09 a 06/10';
  const chartSection=$('chart').closest('section');
  chartSection.querySelector('h2').textContent='Projeção a partir de 22/09';
  chartSection.querySelector('p').textContent=D.validationWarning;
  const oldChart=chart;
  chart=function(result,original){oldChart(result,original,Array.from({length:n},(_,i)=>i));};
 }
 const tableSection=$('grid').closest('section');
 tableSection.classList.add('simulation-table');
 document.querySelector('.filters').after(tableSection);
 document.querySelector('.editor-panel').hidden=true;
 tableSection.querySelector('.section-title').append($('saved'));
 const sourceDetails=$('source').closest('details');
 for(const id of ['bi-loaded','auto-status','scenario-note'])sourceDetails.append($(id));
 document.querySelector('.product-options').hidden=true;
 // .base-options (chips de cidade/deposito/empresa) NAO fica mais escondido aqui (pedido da usuaria,
 // 2026-10-05, "onde fica o botao? nao encontrei!") — antes era escondido sempre, mesmo antes de ter
 // isso que mostrar; agora precisa continuar acessivel DEPOIS da selecao tambem, porque e' onde a
 // selecao multipla de deposito/empresa acontece (os chips sao o unico jeito de marcar mais de 1).
 // Fica dentro de um <details> recolhido por padrao, entao nao polui a tela de quem nao usa.
 selector.parentElement.hidden=true;
 // Botoes de cenario: ficam DENTRO da tabela, numa coluna propria a esquerda, alinhados (rowspan) com
 // as linhas que cada grupo controla — pedido da usuaria, 2026-10-02: "chegue um ponto a tabela pra
 // direita e deixe esse botoes aqui na parte de entrada e as saidas mesmo, e eu selecione pelo lado
 // mesmo" (antes ficavam numa barra inteira acima da tabela). As celulas <th rowspan> em si sao gri
 // geradas pelo app.js a cada rebuild (#entrada-controls-cell/#scenario-controls-cell); aqui so'
 // criamos os grupos de botao UMA VEZ e os reencaixamos nessas celulas a cada render (rebuild troca o
 // innerHTML da tabela inteira, entao as celulas sao recriadas do zero e precisam ser repreenchidas).
 const controls=document.createElement('div');
 controls.className='scenario-controls';
 controls.title='Puxar vendas de';
 controls.innerHTML='<span>Vendas</span><div class="scenario-buttons" role="group" aria-label="Cenário de venda">'+modes.map(mode=>`<button type="button" data-scenario="${mode}" aria-pressed="false">${mode}</button>`).join('')+'</div>';
 function syncButtons(){
  controls.querySelectorAll('button').forEach(button=>{button.setAttribute('aria-pressed',String(Boolean(state)&&button.dataset.scenario===state.scenario));});
 }

 // Origem da entrada: mesma mecanica dos botoes de vendas acima, so' que pro grupo Transito FOB/CIF +
 // Bombeio + Transferencia-entrada. O <select id="entrada"> continua existindo (escondido) so' como
 // estado — os botoes espelham ele, igual o #scenario acima.
 const entradaSelector=$('entrada');
 const entradaModes=[['auto','Fontes automáticas'],['cadencia','Cadência MIS']];
 entradaSelector.parentElement.hidden=true;
 const entradaControls=document.createElement('div');
 entradaControls.className='scenario-controls';
 entradaControls.title='Puxar entrada de';
 entradaControls.innerHTML='<span>Entrada</span><div class="scenario-buttons" role="group" aria-label="Origem da entrada">'+entradaModes.map(([valor,rotulo])=>`<button type="button" data-entrada="${valor}" aria-pressed="false">${rotulo}</button>`).join('')+'</div>';
 function syncEntradaButtons(){
  entradaControls.querySelectorAll('button').forEach(button=>{button.setAttribute('aria-pressed',String(Boolean(state)&&button.dataset.entrada===entradaSelector.value));});
 }
 // Reencaixa os 2 grupos de botao nas celulas <th rowspan> que o app.js acabou de (re)criar.
 function placeCellButtons(){
  const celulaEntrada=document.getElementById('entrada-controls-cell');
  if(celulaEntrada&&!celulaEntrada.contains(entradaControls))celulaEntrada.appendChild(entradaControls);
  const celulaVenda=document.getElementById('scenario-controls-cell');
  if(celulaVenda&&!celulaVenda.contains(controls))celulaVenda.appendChild(controls);
 }
 function chooseEntrada(valor){
  if(!record){message('Escolha cidade, depósito e produto antes de trocar a origem da entrada.');return;}
  if(entradaSelector.value===valor)return;
  entradaSelector.value=valor;
  persist();
  select();
  editDay=Math.max(0,Math.min(n-1,Math.round((new Date(today()+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000)));
  renderEditor();syncEntradaButtons();
 }
 entradaControls.addEventListener('click',event=>{const button=event.target.closest('[data-entrada]');if(button)chooseEntrada(button.dataset.entrada);});
 entradaSelector.onchange=()=>chooseEntrada(entradaSelector.value);

 function closePopup(){if(anchor)anchor.removeAttribute('aria-describedby');anchor=null;popup.hidden=true;}
 // Ate 2026-09-28 esta funcao travava (readOnly) qualquer dia anterior a hoje, mesmo dentro da janela
 // carregada (abertura + 14 dias). Por pedido da usuaria, qualquer dia da janela agora e' editavel —
 // corrigir um recebimento de um dia passado precisa refletir no fechamento dos dias seguintes. A
 // tabela "Semana anterior · historico da fonte" continua so-leitura (nao tem campo de edicao; e' outro
 // modelo de dado, fora de state.movements).
 function limparDicaVenda(){
  document.querySelectorAll('[data-row="sale"], [data-edit-key="sale"]').forEach(input=>{input.removeAttribute('title');input.closest('label')?.removeAttribute('title');});
 }
 const previousRender=render,previousEditor=renderEditor;
 render=function(rebuild=false){closePopup();previousRender(rebuild);limparDicaVenda();placeCellButtons();syncButtons();syncEntradaButtons();};
 renderEditor=function(){previousEditor();limparDicaVenda();};
 function choose(mode){
  if(!modes.includes(mode)||!record){message('Escolha cidade, depósito e produto antes de trocar o cenário.');return;}
  if(mode===state.scenario)return;
  if(today()>day(n-1)){message('Sem datas disponíveis de hoje em diante. Atualize as fontes para iniciar a simulação.');return;}
  persist();
  selector.value=mode;
  select();
  editDay=Math.max(0,Math.min(n-1,Math.round((new Date(today()+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000)));
  renderEditor();describeScenario();syncButtons();
 }
 controls.addEventListener('click',event=>{const button=event.target.closest('[data-scenario]');if(button)choose(button.dataset.scenario);});
 selector.onchange=()=>choose(selector.value);

 function conteudoPopupVendas(index){
  const loaded=record.bi?.days[day(index)];
  // semana.porDia vem da reprojecao (reprojecao_vmd.py): 'le' e' a meta ORIGINAL antes de reprojetar
  // (diferente de loaded.vmd, que ja' e' o valor reprojetado) e 'real' e' o faturamento MySQL do dia
  // (diferente de loaded.billing, que e' volume de PEDIDO do VA05, nao faturamento).
  const semanaDia=record.bi?.semana?.porDia?.[day(index)];
  const values=[['VMD',loaded?.vmd],['LE vigente',semanaDia?.le],['Pedidos em tela',loaded?.billing],['Vendas reais',semanaDia?.real]];
  return `<strong>Vendas · ${dateLabel(day(index))}</strong><dl>${values.map(([name,value])=>`<div><dt>${name}</dt><dd>${value==null?'Sem dado':fmt(value)+' m³'}</dd></div>`).join('')}</dl><p>${day(index)<today()?'Anterior à simulação':`Cenário: <strong>${esc(state.scenario)}</strong>`}</p><p>Aplicado: <strong>${fmt(state.movements.sale[index])} m³</strong>${state.movements.sale[index]!==baseline.movements.sale[index]?' · editado':''}</p>${state.scenario==='Real'&&day(index)>D.bi.extractedAt.slice(0,10)?'<p>Valor aplicado com projeção futura.</p>':''}`;
 }
 // Popup "quem esta' trazendo esse volume" no Transito FOB — pedido da usuaria, 2026-10-02: "no popup
 // vc nao iria subir pra gente as informacoes da placa, ETA, transportadora?". So' FOB tem essa info
 // (CIF o fornecedor contrata o transporte, a gente nao sabe quem e' — "cif deixa quieto"). Dado vem
 // de D.transitoAoVivo (publicar_transito_ao_vivo.py), ja' trazido junto do resto da carga.
 function conteudoPopupTransito(index,modal){
  // Modo combinado (pedido da usuaria, 2026-10-05: "tem como trazer no fob pra qual deposito esta
  // direcionado?"): record.bi.emp_dep e' null (nao existe 1 so'), entao busca o transito ao vivo de
  // CADA registro real por tras da soma (_registrosCombinados) e junta tudo, marcando de qual
  // deposito+empresa cada viagem e' — senao some tudo igual aconteceria no modo normal (1 emp_dep so').
  const combinados=record._registrosCombinados;
  const viagens=combinados
   ?combinados.flatMap(r=>{const vivo=D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material]?.[day(index)];return (vivo?.viagens||[]).filter(v=>v.modal===modal).map(v=>({...v,_origem:`${depositoDe(r)} · ${empresaDe(r)}`}));})
   :(D.transitoAoVivo?.[record.bi?.emp_dep]?.[record.bi?.material]?.[day(index)]?.viagens||[]).filter(v=>v.modal===modal);
  if(!viagens.length)return `<strong>Trânsito ${modal.toUpperCase()} · ${dateLabel(day(index))}</strong><p>Sem detalhe de viagem ao vivo pra este dia.</p>`;
  const linha=(v,prog)=>{const partes=[v.transportador,v.placa].filter(Boolean).map(esc);return `<div style="color:${prog?'#F97316':'#60A5FA'}"><dt>${prog?'Programado · ':''}${[v.idViagem,v.fornecedor,v._origem].filter(Boolean).map(esc).join(' · ')||'Viagem'}</dt><dd>${partes.map(p=>p+' · ').join('')}${fmt(v.volume)} m³${v.status?' · '+esc(v.status):''}${v.status==='Em Andamento'&&v.kmRestante!=null?' · '+fmt(v.kmRestante)+' km restantes':''}${v.chegadaReal?' · chegou '+new Date(v.chegadaReal).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):v.eta?' · ETA '+new Date(v.eta).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}${v.dataProgramacao?' · programação '+esc(v.dataProgramacao):''}</dd></div>`;};
  const realizadas=viagens.filter(v=>v.grupo!=='programado'),programadas=viagens.filter(v=>v.grupo==='programado');
  return `<strong>Trânsito ${modal.toUpperCase()} · ${dateLabel(day(index))}</strong>`
   +(realizadas.length?`<dl>${realizadas.map(v=>linha(v)).join('')}</dl><p style="color:#60A5FA">${realizadas.length} viagem(ns) · total ${fmt(realizadas.reduce((s,v)=>s+v.volume,0))} m³</p>`:'')
   +(programadas.length?`<dl>${programadas.map(v=>linha(v,true)).join('')}</dl><p style="color:#F97316">${programadas.length} programada(s) · ${fmt(programadas.reduce((s,v)=>s+v.volume,0))} m³ · não soma na projeção</p>`:'');
 }
 // Popup "de qual deposito/empresa vem essa abertura" no modo combinado — pedido da usuaria,
 // 2026-10-05: "na abertura, quando selecionar + de 1, eu preciso saber qual deposito e empresa".
 // Tambem mostra a data de cada leitura (aberturaEm) — ja' aproveita pra avisar quando alguma base
 // esta' com leitura atrasada (nao e' de hoje), que foi exatamente o caso real da SIM/CHARRUA em
 // Betim que a usuaria perguntou antes.
 function diasDesde(dataIso){return Math.round((new Date(D.date+'T12:00:00')-new Date(dataIso+'T12:00:00'))/86400000);}
 function avisoAtraso(dataAbertura){if(!dataAbertura||dataAbertura===D.date)return'';const dias=diasDesde(dataAbertura);return ` ⚠ há ${dias} dia${dias===1?'':'s'}`;}
 function conteudoPopupAbertura(){
  const combinados=record._registrosCombinados;
  if(!combinados)return `<strong>Estoque inicial · abertura</strong><p>${fmt(record.opening)} m³ · ${dateLabel(record.aberturaEm||D.date)}${avisoAtraso(record.aberturaEm)}</p>`;
  const linha=r=>`<div><dt>${esc(depositoDe(r))} · ${esc(empresaDe(r))}</dt><dd>${fmt(r.opening)} m³ · ${dateLabel(r.aberturaEm||D.date)}${avisoAtraso(r.aberturaEm)}</dd></div>`;
  return `<strong>Estoque inicial · abertura · ${dateLabel(D.date)}</strong><dl>${combinados.map(linha).join('')}</dl><p>${combinados.length} base(s) · total ${fmt(record.opening)} m³</p>`;
 }
 function showPopup(input){
  closePopup();anchor=input;
  const index=input.dataset.day===undefined?editDay:Number(input.dataset.day);
  const tipo=input.dataset.row||input.dataset.result;
  popup.innerHTML=tipo==='fob'||tipo==='cif'?conteudoPopupTransito(index,tipo):tipo==='opening'?conteudoPopupAbertura():conteudoPopupVendas(index);
  input.setAttribute('aria-describedby','sales-popover');
  popup.hidden=false;
  const rect=input.getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight;
  popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';
  popup.style.top=Math.max(8,rect.bottom+height+8<=innerHeight?rect.bottom+8:rect.top-height-8)+'px';
 }
 const salesInput=target=>target instanceof Element?(target.closest('[data-row="sale"], [data-row="fob"], [data-row="cif"], [data-edit-key="sale"], [data-result="opening"][data-day="0"]')||target.closest('td, label')?.querySelector('[data-row="sale"], [data-row="fob"], [data-row="cif"], [data-edit-key="sale"]')):null;
 document.addEventListener('pointerover',event=>{const input=salesInput(event.target);if(input)showPopup(input);});
 document.addEventListener('focusin',event=>{const input=salesInput(event.target);if(input){requestAnimationFrame(()=>{if(document.activeElement===input)showPopup(input);});}else closePopup();});
 document.addEventListener('pointerout',event=>{if(salesInput(event.target)&&document.activeElement!==event.target)closePopup();});
 document.addEventListener('pointerdown',event=>{const input=salesInput(event.target);if(input)showPopup(input);else if(!popup.contains(event.target))closePopup();});
 document.addEventListener('input',event=>{const input=salesInput(event.target);if(input)showPopup(input);});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')closePopup();});
 document.addEventListener('scroll',closePopup,true);
 window.addEventListener('resize',closePopup);
 editDay=Math.max(0,Math.min(n-1,Math.round((new Date(today()+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000)));
 renderEditor();placeCellButtons();syncButtons();syncEntradaButtons();
})();
