'use strict';
const $=id=>document.getElementById(id), E=window.StockEngine;let D=window.ESTOQUE_DATA;
const fmt=v=>v===null||v===undefined?'—':Math.round(v).toLocaleString('pt-BR');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=i=>{const d=new Date(D.date+'T12:00:00');d.setDate(d.getDate()+i);return d.toISOString().slice(0,10);};
const label=i=>new Date(day(i)+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
let record,state,baseline,n=15,timer;
// Selecao multipla de deposito/empresa (pedido da usuaria, 2026-10-05): "deixa selecionar + de 1
// deposito e + de 1 empresa, mas deixa simular e soma as informacoes, mas nao deixa salvar na equipe".
// depositosAtivos/empresasAtivas sao a fonte da verdade (um Set cada, mesmo no modo normal de 1 so');
// os <select> de cima refletem esse estado quando da' pra mostrar um unico valor, e os chips (botoes)
// sao quem realmente liga/desliga cada opcao quando tem mais de uma ativa. modoCombinado=true quando
// a combinacao atual junta 2+ registros — compartilhado.js usa essa flag pra desabilitar so' o
// "Salvar na equipe" (o resto da edicao continua liberado normalmente).
let depositosAtivos=new Set(),empresasAtivas=new Set(),modoCombinado=false;
function mergeSource(saved,current){const next=structuredClone(current),previous=saved.sourceBaseline;if(previous){for(const [k]of parameters)if(saved[k]!==previous[k])next[k]=saved[k];for(const [k]of E.rows)for(let i=0;i<30;i++)if(saved.movements[k][i]!==previous.movements[k][i])next.movements[k][i]=saved.movements[k][i];}else{for(const [k]of parameters)next[k]=saved[k];next.movements=structuredClone(saved.movements);}next.name=saved.name;return next;}
const parameters=[['opening','Estoque inicial / abertura'],['lastro','Lastro mínimo'],['min','Estoque mínimo'],['mid','Estoque médio'],['max','Estoque máximo'],['capacity','Capacidade física']];
function simulationToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
// cenarioForcado (pedido da usuaria, 2026-10-01): permite calcular o estado "fresh" de QUALQUER
// registro com um cenario especifico, sem depender do que esta selecionado na tela — usado pela
// "Visao da semana" pra calcular o LE padrao ao vivo de bases sem cenario salvo.
function fresh(r,cenarioForcado){
 const scenario=cenarioForcado||$('scenario')?.value||'LE',today=simulationToday();
 // Origem da entrada (pedido da usuaria, 2026-10-01): 'auto' = fontes de sempre (FOB/CIF do portal +
 // Bombeio da cadencia DAP); 'cadencia' = substitui FOB+CIF+Bombeio inteiros pelos valores PLANEJADOS
 // da cadencia MIS (ja' separados por frete em loaded.cadencia). Nao ha equivalente de cadencia pra
 // transferencia, entao fica zerada nesse modo. "Restaurar" volta pro 'auto' porque fresh() so' le
 // $('entrada').value quando nao vem cenarioForcado — e o botao restaurar chama fresh(record) puro,
 // que relê o select; o select em si so' muda quando o usuario mexe, entao o reset preserva a escolha
 // atual do select — por isso o botao "Restaurar" tambem reseta o select pra 'auto' (ver mais abaixo).
 const entrada=$('entrada')?.value||'auto';
 const startIndex=Math.max(0,Math.round((new Date(today+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000));
 const switchIndex=Math.max(startIndex,Math.round((new Date(D.bi.inbound.switchDate+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000));
 const movements=Object.fromEntries(E.rows.map(([k])=>[k,Array(30).fill(0)]));
 for(let i=0;i<15;i++){
  const loaded=r.bi?.days[day(i)];if(!loaded)continue;
  const future=day(i)>=today;
  for(const k of ['sale','fob','cif','pump','transferIn','transferOut']){
   const mis=future&&scenario==='Inbound + MIS'&&i>=switchIndex&&['fob','cif','pump'].includes(k);
   movements[k][i]=(mis?loaded.inboundMis?.[k]:loaded[k])??0;
  }
  if(future&&entrada==='cadencia'){
   movements.fob[i]=loaded.cadencia?.fob??0;movements.cif[i]=loaded.cadencia?.cif??0;
   movements.pump[i]=loaded.cadencia?.pump??0;movements.transferIn[i]=0;
  }
  // Transito ao vivo (pedido da usuaria, 2026-10-02): publicar_transito_ao_vivo.py le o Firebase do
  // portal inbound direto (nao o CSV de 30 em 30 min) e publica em D.transitoAoVivo, por emp_dep e
  // material. So' sobrescreve quando 'auto' (nao em 'cadencia', que ja' e' uma fonte explicita
  // diferente) e fora do cenario 'Inbound + MIS' (que tem sua propria fonte de FOB/CIF, loaded.inboundMis).
  if(future&&entrada==='auto'&&scenario!=='Inbound + MIS'){
   const vivo=D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material]?.[day(i)];
   if(vivo&&(vivo.fob!=null||vivo.cif!=null)){movements.fob[i]=vivo.fob??0;movements.cif[i]=vivo.cif??0;}
  }
  // Datas anteriores usam a mesma base em todos os cenarios.
  if(!future)continue;
  // 5 cenarios de venda (pedido da usuaria, 2026-09-30): VMD (reprojetada), LE (vigente, SEM
  // reprojecao — antes do 2026-09-30 esse botao aplicava a reprojetada, agora aplica o valor original),
  // Pedidos em tela (VA05, total do dia, todos os status — igual ao que o BI mostra hoje, nao so' os
  // "Em processamento"), Real (faturamento MySQL ate' agora, nao o volume de pedido do VA05) e Disp MIS
  // (disponibilidade, inalterado). semana.porDia so' existe pros produtos cobertos pela reprojecao.
  const semanaDia=r.bi?.semana?.porDia?.[day(i)];
  if(scenario==='VMD')movements.sale[i]=loaded.vmd??0;
  else if(scenario==='LE')movements.sale[i]=semanaDia?.le??0;
  else if(scenario==='Pedidos em tela')movements.sale[i]=loaded.billing??0;
  else if(scenario==='Real'){if(day(i)<=D.bi.extractedAt.slice(0,10))movements.sale[i]=semanaDia?.real??0;}
  else if(['Disp MIS','Inbound + MIS'].includes(scenario))movements.sale[i]=loaded.scenarios?.[scenario]?.availability??0;
 }
 return {version:1,id:r.id,date:D.date,sourceRevision:D.revision,name:'Minha simulação',opening:r.opening,lastro:r.bi?.days[day(0)]?.scenarios?.[scenario]?.lastro??r.policy?.lastro??null,min:r.policy?.min??null,mid:r.policy?.mid??null,max:r.policy?.max??null,capacity:r.policy?.capacity??null,clamp:false,scenario,switchIndex,movements};
}
function key(){return 'nexta-stock-auto-v2:'+D.date+':'+record.id+':'+($('scenario')?.value||'LE')+':'+($('entrada')?.value||'auto');}
function sourceNote(k,i){const loaded=record.bi?.days[day(i)],mode=state.scenario;if(['received','planned','purchase','loanIn','loanOut'].includes(k))return 'Ajuste adicional manual; não repetir um volume já importado.';if(['fob','cif'].includes(k)){const mis=mode==='Inbound + MIS'&&i>=state.switchIndex;return `${mis?'Cadências MIS ('+k.toUpperCase()+')':'CSV do portal, com filtro de status e data de descarga'} · ${fmt((mis?loaded?.inboundMis[k]:loaded?.[k])??0)} m³ · ${day(i)}`;}
 if(k==='sale'){
  const semanaDia=record.bi?.semana?.porDia?.[day(i)];
  if(mode==='VMD')return `VMD reprojetada · ${loaded?.vmd==null?'sem valor na fonte':fmt(loaded.vmd)+' m³'} · ${day(i)}`;
  if(mode==='LE')return `LE vigente, sem reprojeção · ${semanaDia?.le==null?'sem valor na fonte':fmt(semanaDia.le)+' m³'} · ${day(i)}`;
  if(mode==='Pedidos em tela')return `Pedidos em tela (VA05, todos os status) · ${loaded?.billing==null?'sem valor na fonte':fmt(loaded.billing)+' m³'} · ${day(i)}`;
  if(mode==='Real')return `Faturado real até agora · ${semanaDia?.real==null?'sem valor na fonte':fmt(semanaDia.real)+' m³'} · ${day(i)}`;
  if(['Disp MIS','Inbound + MIS'].includes(mode))return `Disponibilidade MIS · ${fmt(loaded?.scenarios?.[mode]?.availability)} m³ · ${day(i)}`;
 }
 const field=k==='sale'?'vmd':k;if(loaded?.missingModelRow)return 'Sem linha de dados para este recorte nas fontes; valor inicial zero.';return `${D.bi?.formulas[field]??D.bi?.formulas[k]??k} · ${loaded?.[field]==null?'sem valor na fonte, considerado zero na simulação':fmt(loaded[field])+' m³ importados'} · ${day(i)}`;}
function message(s){$('message').textContent=s;clearTimeout(timer);timer=setTimeout(()=>$('message').textContent='',7000);}
function persist(){try{state.sourceBaseline=baseline;localStorage.setItem(key(),JSON.stringify(state));$('saved').textContent='SALVO NESTE NAVEGADOR';}catch{$('saved').textContent='SEM SALVAMENTO LOCAL';message('Não foi possível salvar no navegador. Exporte o JSON para guardar suas alterações.');}}
function options(el,values){el.replaceChildren(...values.map(v=>new Option(v,v)));}
// Cidade+deposito (pedido da usuaria, 2026-10-01: "deixa primeiro sem nenhuma selecao, e filtra cidade
// e depois o deposito" — antes era um unico select de 'base' com tudo junto, ex. "Betim POTENCIAL").
// record.policy.city tem a cidade isolada; o deposito e' o resto de record.base depois da cidade.
// bi.cidade/bi.deposito (cadastro oficial, mesmo de-para de regiao/reprojecao) sao a fonte confiavel;
// policy.city (coluna da planilha de Politica de Estoques) so' entra de fallback — tem pelo menos 1
// erro de digitacao conhecido la ("Ribeirão PretoRUFF", sem espaco, 2026-10-01) que criava cidade falsa.
function cidadeDe(registro){return registro.bi?.cidade||registro.policy?.city||'';}
function depositoDe(registro){const cidade=cidadeDe(registro);return registro.bi?.deposito||(cidade?registro.base.slice(cidade.length).trim():registro.base);}
function empresaDe(registro){return registro.bi?.empresa||'';}
// Busca o registro batendo cidade+deposito+empresa (via cidadeDe/depositoDe/empresaDe, nao reconstroi a
// string) e devolve o r.base REAL. Bug encontrado em 2026-10-02, 2 camadas: (1) reconstruir
// "${cidade} ${deposito}" na mao e comparar com r.base quebrava quando o deposito do cadastro tem
// capitalizacao diferente do nome da base (ex.: cadastro guarda "NEXTA", mas r.base e' "Barra do
// Garças Nexta"); (2) mesmo so' com cidade+deposito, existem 7 combinacoes REAIS ambiguas no cadastro
// (ex.: "Betim"+"POTENCIAL" tem 3 bases diferentes — CHARRUA/Nexta/SIM, que so' se distinguem pela
// Empresa) — por isso o 3o filtro de Empresa.
// Registros batendo cidade + QUALQUER deposito ativo + QUALQUER empresa ativa (os Sets, nao mais um
// unico valor). Com 1 so' em cada Set, e' exatamente o que baseAtual() fazia antes.
function registrosAtuais(){const cidade=$('cidade').value;if(!cidade||!depositosAtivos.size||!empresasAtivas.size)return[];return D.records.filter(r=>cidadeDe(r)===cidade&&depositosAtivos.has(depositoDe(r))&&empresasAtivas.has(empresaDe(r)));}
// Pedido da usuaria, 2026-10-05 (bug achado por ela): ligar/desligar 1 chip de deposito/empresa
// reconstroi a lista de produtos, e sem preservar a selecao anterior o <select> pula sozinho pro
// 1o produto da nova lista (ex.: de "Diesel S10 A" pro "Biodiesel") sem avisar — ai os numeros da
// tela pareciam errados, mas era outro produto sendo mostrado. Mesmo padrao ja usado em
// refreshDepositoOptions/refreshEmpresaOptions: so' troca se o produto atual nao existir mais.
function products(){const produtoAnterior=$('product').value;options($('product'),[...new Set(registrosAtuais().map(r=>r.product))]);if(produtoAnterior&&[...$('product').options].some(o=>o.value===produtoAnterior))$('product').value=produtoAnterior;select();}
function somaOuNula(valores){const presentes=valores.filter(v=>v!==null&&v!==undefined);return presentes.length?presentes.reduce((a,b)=>a+b,0):null;}
// So' os campos realmente lidos de record.bi.days fora do fresh() (VMD/Pedidos em tela nas linhas de
// referencia da tabela) — tudo que alimenta a simulacao de verdade (fob/cif/pump/sale/...) ja vem
// somado via freshCombinado, que chama fresh() em CADA registro real antes de somar.
function biDiaCombinado(registros,iso){const dias=registros.map(r=>r.bi?.days?.[iso]).filter(Boolean);if(!dias.length)return null;return{vmd:somaOuNula(dias.map(d=>d.vmd)),billing:somaOuNula(dias.map(d=>d.billing))};}
function semanaCombinada(registros){const semanas=registros.map(r=>r.bi?.semana).filter(Boolean);if(!semanas.length)return null;const dias=new Set();for(const s of semanas)for(const d of Object.keys(s.porDia||{}))dias.add(d);const porDia={};for(const d of dias){const les=semanas.map(s=>s.porDia?.[d]?.le).filter(v=>v!=null),reais=semanas.map(s=>s.porDia?.[d]?.real).filter(v=>v!=null);porDia[d]={le:les.length?les.reduce((a,b)=>a+b,0):0,real:reais.length?reais.reduce((a,b)=>a+b,0):null};}return{leSemana:somaOuNula(semanas.map(s=>s.leSemana))??0,realSemana:somaOuNula(semanas.map(s=>s.realSemana))??0,porDia};}
// "record" sintetico pro modo combinado: so' metadados/exibicao (base/politica/texto) — a simulacao em
// si usa freshCombinado, nao os campos deste objeto. emp_dep fica null de proposito: o popup de
// trânsito FOB (cenarios.js) ja degrada bem pra "sem detalhe" quando nao acha D.transitoAoVivo[null].
function construirRegistroCombinado(registros,openingSomado){const cidade=cidadeDe(registros[0]),produto=registros[0].product;const depositos=[...new Set(registros.map(depositoDe))].sort((a,b)=>a.localeCompare(b,'pt-BR')),empresas=[...new Set(registros.map(empresaDe))].sort((a,b)=>a.localeCompare(b,'pt-BR'));const atrasado=registros.find(r=>r.aberturaEm&&r.aberturaEm!==D.date);return{id:'combinado:'+registros.map(r=>r.id).sort().join(','),base:`${cidade} · ${depositos.join(' + ')} · ${empresas.join(' + ')} (combinado)`,product:produto,sheet:'—',row:'—',opening:openingSomado,aberturaEm:atrasado?atrasado.aberturaEm:D.date,policy:{name:`Combinado · ${registros.length} bases somadas`,source:'Somado automaticamente a partir das bases selecionadas',sheet:'—',row:'—'},
 // _registrosCombinados: os registros REAIS por tras da soma, guardados aqui so' pro popup de
 // transito FOB (cenarios.js) conseguir mostrar de qual deposito/empresa cada viagem e' — pedido da
 // usuaria, 2026-10-05: "tem como trazer no fob pra qual deposito esta direcionado?".
 capacidadeFisica:somaOuNula(registros.map(r=>r.capacidadeFisica)),_registrosCombinados:registros,
 bi:{name:cidade,material:registros[0].bi.material,emp_dep:null,cidade,deposito:depositos.join(' + '),empresa:empresas.join(' + '),unit:'m³',days:Object.fromEntries(Object.keys(registros[0].bi.days).map(iso=>[iso,biDiaCombinado(registros,iso)])),semana:semanaCombinada(registros),semanaPorDeposito:null}};}
// Soma, campo a campo, o fresh() de CADA registro real selecionado — cada um ja' aplica cenario de
// venda/origem da entrada/transito ao vivo corretamente pro seu proprio emp_dep, so' depois os
// resultados sao somados. Isso evita reimplementar essa logica toda pro caso combinado.
function freshCombinado(registros){const partes=registros.map(r=>fresh(r));const somarCampo=campo=>somaOuNula(partes.map(p=>p[campo]));const movements={};for(const [k] of E.rows)movements[k]=Array.from({length:30},(_,i)=>partes.reduce((total,p)=>total+(p.movements[k][i]||0),0));const openingSomado=partes.reduce((total,p)=>total+p.opening,0);return{baseline:{version:1,id:'combinado:'+registros.map(r=>r.id).sort().join(','),date:D.date,sourceRevision:D.revision,name:'Minha simulação (combinada)',opening:openingSomado,lastro:somarCampo('lastro'),min:somarCampo('min'),mid:somarCampo('mid'),max:somarCampo('max'),capacity:somarCampo('capacity'),clamp:false,scenario:partes[0]?.scenario||'LE',switchIndex:partes[0]?.switchIndex??0,movements},openingSomado};}
function select(){
 const registros=registrosAtuais().filter(r=>r.product===$('product').value);
 modoCombinado=registros.length>1;
 if(!registros.length)record=undefined;
 else if(!modoCombinado)record=registros[0];
 // Filtro de regiao pode deixar a lista de bases vazia (ex.: nao ha base dessa regiao pra este login);
 // sem guarda, fresh(undefined) quebra o resto do render e trava a tela com os chips desatualizados.
 if(!registros.length){for(const id of ['grid','cards','alerts','chart','semana-progresso'])$(id).innerHTML='';if($('bi-measures'))$('bi-measures').innerHTML='';message(registrosAtuais().length?'Nenhuma base disponível para este filtro. Ajuste a região ou escolha outra base.':'Escolha cidade, depósito(s), empresa(s) e produto acima para começar.');return;}
 if(modoCombinado){const {baseline:combinada,openingSomado}=freshCombinado(registros);record=construirRegistroCombinado(registros,openingSomado);baseline=combinada;}
 else baseline=fresh(record);
 state=structuredClone(baseline);try{const saved=localStorage.getItem(key());if(saved){const candidate=E.validate(JSON.parse(saved));if(candidate.id===record.id&&candidate.date===D.date){state=mergeSource(candidate,baseline);}}}catch{message('Cenário local inválido ou indisponível. Abertura original carregada.');}E.rows.find(r=>r[0]==='sale')[1]=({VMD:'Vendas · VMD reprojetada',LE:'Vendas · LE vigente',['Pedidos em tela']:'Vendas · Pedidos em tela',Real:'Vendas · Faturado (Real)',['Disp MIS']:'Vendas · Disp. MIS'})[state.scenario]||'Vendas';premises();render(true);}
// Politica de estoque (abertura/lastro/minimo/medio/maximo/capacidade): fixa, vem da planilha e nao
// e' editavel pela simulacao (pedido da usuaria, 2026-09-28) — so os movimentos (entradas/saidas)
// continuam editaveis, na tabela e no editor por dia.
// record.aberturaEm: dia de onde veio a abertura dessa base+produto (pode ser mais antigo que D.date —
// ver JANELA_FALLBACK_ABERTURA_DIAS em atualizar_dados.py). Avisa na tela quando nao e' de hoje.
// Pedido da usuaria, 2026-10-05: no modo combinado, se QUALQUER uma das bases por tras da soma tiver
// leitura atrasada, considera atrasado tambem (mesmo que outras estejam em dia) — e' sinal de alerta
// visual na celula, o detalhe de qual base exatamente fica no popup (cenarios.js:conteudoPopupAbertura).
function aberturaAtrasada(){if(record._registrosCombinados)return record._registrosCombinados.some(r=>r.aberturaEm&&r.aberturaEm!==D.date);return record.aberturaEm && record.aberturaEm!==D.date;}
// Pedido da usuaria, 2026-10-05: quanto mais velha a leitura, mais forte o aviso visual — nao so'
// laranja pra qualquer atraso, mas vermelho a partir de alguns dias (DIAS_ABERTURA_GRAVE). No modo
// combinado usa a leitura MAIS atrasada entre as bases somadas (pior caso, mais conservador).
const DIAS_ABERTURA_GRAVE=3;
function diasAtrasoAbertura(){
 if(!record)return 0;
 const datas=(record._registrosCombinados?record._registrosCombinados.map(r=>r.aberturaEm):[record.aberturaEm]).filter(d=>d&&d!==D.date);
 if(!datas.length)return 0;
 return Math.max(...datas.map(d=>Math.round((new Date(D.date+'T12:00:00')-new Date(d+'T12:00:00'))/86400000)));
}
function premises(){$('name').value=state.name;$('clamp').checked=state.clamp;$('premises').innerHTML=parameters.map(([k,l])=>`<label>${l}<input type="number" readonly data-param="${k}" aria-label="${l}" value="${state[k]===null?'':Math.round(state[k])}" placeholder="Ausente na fonte" title="Valor fixo, carregado da planilha de política."><small>${k==='opening'?(aberturaAtrasada()?`⚠ Abertura de ${new Date(record.aberturaEm+'T12:00:00').toLocaleDateString('pt-BR')} (não é de hoje)`:'Abertura importada'):`Política: ${fmt(baseline[k])} m³`}</small></label>`).join('');}
function history(i){return D.history?.[day(i)]?.[record.base+'|'+record.product];}
// Dias passados da grade: o que realmente aconteceu (mesmas fontes do BI): abertura da planilha do dia,
// vendas realizadas (VA05 fornecido), FOB/CIF realizados (trânsito publicado) e fechamento = abertura do dia seguinte.
// Cor da abertura pela ocupacao do tanque: vermelho abaixo de 70% da capacidade, amarelo ate 75%, verde acima.
function capBand(v){const cap=record.capacidadeFisica;if(v==null||!cap)return'';const p=v/cap;return p<0.70?'danger':p<=0.75?'warn':'high';}
function transitoPassado(i,k){const t=D.transitoAoVivo?.[record.bi?.emp_dep]?.[record.bi?.material]?.[day(i)];return t?.[k]??null;}
function valorPassado(k,i,result){
 if(k==='opening')return history(i)?.opening??null;
 if(k==='outgoing')return history(i)?.sale??null;
 if(k==='incoming'){const f=transitoPassado(i,'fob'),c=transitoPassado(i,'cif');return f==null&&c==null?null:(f||0)+(c||0);}
 if(k==='close'){const prox=i+1===0?result[0]?.opening:history(i+1)?.opening;return prox??null;}
 return null;
}
function status(v){return E.stockBand(v,state);}
function render(rebuild=false){const result=E.calculate(state,n),original=E.calculate(baseline,n);
 $('source').textContent=`Abertura real de ${label(0)}/${D.date.slice(0,4)} • ${record.base} • ${record.product}. Próximos 14 dias preenchidos com o LE vigente, FOB/CIF e programação MIS. Extração: ${D.bi.extractedAt.replace('T',' ')}. Todos os volumes em m³.`;
 $('dia-atual-aviso').textContent=`Hoje: ${new Date(simulationToday()+'T12:00:00').toLocaleDateString('pt-BR')} · abertura de referência: ${label(0)} (última planilha preenchida). Dias anteriores a hoje usam o realizado; hoje e os próximos dias usam pedidos e previsão.`;
 $('provenance').textContent=`Fonte: ${D.source} | Aba: ${record.sheet} | Linha: ${record.row}. Abertura original: ${fmt(record.opening)} m³. Histórico extraído das planilhas diárias, sem edição. Ausência de informação é exibida como “—”.`;
 semanaProgresso();
 const low=Math.min(...result.map(x=>Math.min(x.opening,x.close))),last=result.at(-1).close;
 const first=result.findIndex(x=>['danger','warn'].includes(status(x.opening))||['danger','warn'].includes(status(x.close)));
 $('cards').innerHTML=[['Abertura de referência',fmt(state.opening),'m³ · início do dia'],['Fechamento ao fim de 14 dias',fmt(last),`m³ · diferença de ${fmt(last-original.at(-1).close)} vs. original`],['Menor estoque no período',fmt(low),'m³ · abertura e fechamento'],['Primeira atenção',first<0?'Sem alerta de limite':label(first),first<0?'Verifique os limites e campos não preenchidos':'Confira os pontos de atenção abaixo']].map(([title,value,sub],i)=>`<article class="card"><small>${title}</small><strong class="${i===2?status(low):''}">${value}</strong><em>${sub}</em></article>`).join('');
 const passado=mostrarHistoricoGrade?5:0;const offsets=Array.from({length:passado+n},(_,i)=>i-passado);
 if(rebuild){let html=`<thead><tr><th class="row-controls"><button type="button" id="toggle-historico" title="Mostrar ou ocultar o histórico dos 5 dias anteriores">${mostrarHistoricoGrade?'−':'+'}</button></th><th class="row-label">Movimento / m³</th>`+offsets.map(i=>`<th class="${i<0?'history':i===0?'today':''}">${label(i)}<br><small>${i<0?'Histórico':i===0?'Referência':'Simulação'}</small></th>`).join('')+'</tr></thead><tbody>';
 const outputRow=(key,name)=>`<tr class="total"><th class="row-controls"></th><th class="row-label">${name}</th>${offsets.map(i=>`<td data-result="${key}" data-day="${i}"></td>`).join('')}</tr>`;
 html+=outputRow('opening','Estoque inicial · abertura');html+=outputRow('lastro','Lastro mínimo');html+=outputRow('openingNet','Abertura menos lastro');
 // 4 linhas informativas (so' leitura, nao entram no calculo) mostrando as referencias da venda antes
 // da linha editavel que realmente debita do estoque — pedido da usuaria, 2026-09-30: ver as 4 fontes
 // (VMD reprojetada, LE original sem reprojecao, Pedidos em tela = VA05 total do dia/todos os status,
 // faturamento real) fixas, lado a lado com o que foi aplicado (que o usuario escolhe puxar ou digitar).
 const infoRow=(titulo,getter)=>`<tr class="info-row"><th class="row-controls"></th><th class="row-label">↳ ${titulo}</th>${offsets.map(i=>`<td class="history${i===0?' today':''}">${fmt(getter(i))}</td>`).join('')}</tr>`;
 // Pedido da usuaria, 2026-10-01: "Recebimento adicional manual" e "Programação adicional manual"
 // tiradas da tabela (ficavam sempre zeradas, so' poluiam a visao). O calculo continua somando o que
 // ja estiver salvo nesses campos (E.rows/motor.js inalterado); so' nao aparecem mais como linha editavel.
 // Coluna de controle (rowspan) pros botoes "Puxar entrada de"/"Puxar vendas de" — pedido da usuaria,
 // 2026-10-02: "chegue um ponto a tabela pra direita e deixe esse botoes aqui na parte de entrada e as
 // saidas mesmo, e eu selecione pelo lado mesmo". A 1a linha de cada grupo (entrada: fob/cif/pump/
 // transferIn; saida: sale/transferOut) recebe um <th rowspan> vazio que o cenarios.js preenche depois
 // (ver #entrada-controls-cell/#scenario-controls-cell); as demais linhas do mesmo grupo nao emitem
 // celula nenhuma nessa coluna, porque o rowspan da 1a linha ja' a ocupa.
 const linhasVisiveis=E.rows.filter(([k])=>!['received','planned','transferIn','transferOut'].includes(k));
 const entradaKeys=linhasVisiveis.filter(([,,sign])=>sign>0).map(([k])=>k);
 const saidaKeys=linhasVisiveis.filter(([,,sign])=>sign<0).map(([k])=>k);
 for(const [k,l,sign] of E.rows){
  if(['received','planned','transferIn','transferOut'].includes(k))continue;
  if(k==='sale'){
   html+=infoRow('VMD reprojetada',i=>record.bi?.days[day(i)]?.vmd);
   html+=infoRow('LE vigente (sem reprojeção)',i=>record.bi?.semana?.porDia?.[day(i)]?.le);
   html+=infoRow('Pedidos em tela',i=>record.bi?.days[day(i)]?.billing);
   html+=infoRow('Vendas reais (faturamento)',i=>record.bi?.semana?.porDia?.[day(i)]?.real);
  }
  const controlCell=k===entradaKeys[0]?`<th rowspan="${entradaKeys.length}" class="row-controls" id="entrada-controls-cell"></th>`
   :k===saidaKeys[0]?`<th rowspan="${saidaKeys.length}" class="row-controls" id="scenario-controls-cell"></th>`:'';
  html+=`<tr class="${sign>0?'entry':'exit'}">${controlCell}<th class="row-label">${sign>0?'+':'−'} ${l}</th>`+offsets.map(i=>i<0?`<td class="history${i===0?' today':''}" title="${k==='sale'?'Faturamento pendente de integração':'Informação histórica da fonte'}">${fmt(['fob','cif'].includes(k)?transitoPassado(i,k):history(i)?.[k])}</td>`:`<td class="${i===0?'today':''}"><input type="number" step="any" min="0" data-row="${k}" data-day="${i}" aria-label="${l} ${label(i)}" value="${Math.round(state.movements[k][i])}" title="${esc(sourceNote(k,i))}"></td>`).join('')+'</tr>';
 }
 for(const [k,l] of [['incoming','Total de entradas'],['outgoing','Total de saídas']])html+=outputRow(k,l);
 $('grid').innerHTML=html+'</tbody>';}
 // Celula de abertura (dia 0) ganha um aviso visual quando a leitura nao e' de hoje — pedido da
 // usuaria, 2026-10-05: "mostra a ultima data que puxou... uma cor diferente pra mostrar que nao e'
 // a do dia". O detalhe de qual base exatamente (no combinado) fica no popup, ao passar o mouse/clicar.
 document.querySelectorAll('[data-result]').forEach(td=>{const i=+td.dataset.day,k=td.dataset.result;const v=i<0?valorPassado(k,i,result):result[i][k];const ehAbertura=k==='opening'&&i===0,dias=ehAbertura?diasAtrasoAbertura():0;td.textContent=(dias>0?'⚠ ':'')+fmt(v);td.className=(i<0?'history ': '')+(i===0?'today ':'')+(dias>0?(dias>=DIAS_ABERTURA_GRAVE?'atrasada-grave ':'atrasada '):'')+(k==='opening'?capBand(v):(['close','available'].includes(k)?(v==null?'':status(v)):''));});
 document.querySelectorAll('[data-row]').forEach(input=>input.parentElement.classList.toggle('edited',state.movements[input.dataset.row][+input.dataset.day]!==baseline.movements[input.dataset.row][+input.dataset.day]));
 chart(result,original,Array.from({length:7+n},(_,i)=>i-7));alerts(result);
}
// record.bi.semana: {leSemana, realSemana} — vem da reprojecao do VMD (cidade+familia de produto);
// so' existe pros 4 produtos cobertos (Gasolina, Diesel S10, Diesel S500, Hidratado) e quando o banco
// de faturamento respondeu na ultima publicacao.
function semanaProgresso(){
 const el=$('semana-progresso');if(!el)return;
 const semana=record.bi.semana;
 if(!semana||!(semana.leSemana>0)){el.innerHTML='';return;}
 const pct=semana.realSemana/semana.leSemana,estourou=pct>1;
 const cor=estourou?'#8DC830':pct>=0.7?'#8DC830':pct>=0.35?'#F97316':'#FF6B5F';
 // Faturamento so' tem granularidade de dia (sem hora), entao "ate' agora" na pratica e' "ate' a
 // ultima publicacao" — mostra o horario da extracao em vez de sugerir precisao por hora que nao existe.
 const horaExtracao=new Date(D.bi.extractedAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const dias=Object.keys(semana.porDia||{}).sort();
 const hojeIso=simulationToday();
 const tabela=dias.length?`<table class="semana-progresso-tabela"><thead><tr><th>Dia</th>${dias.map(d=>`<th class="${d===hojeIso?'today':''}">${new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short'})}<br><small>${new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</small></th>`).join('')}</tr></thead><tbody>
   <tr><th>LE</th>${dias.map(d=>`<td class="${d===hojeIso?'today':''}">${fmt(semana.porDia[d].le)}</td>`).join('')}</tr>
   <tr><th>Vendido</th>${dias.map(d=>`<td class="${d===hojeIso?'today':''}">${fmt(semana.porDia[d].real)}</td>`).join('')}</tr>
 </tbody></table>`:'';
 el.innerHTML=`<div class="semana-progresso-rotulo">Ritmo da semana (dados até ${horaExtracao}): <strong>${fmt(semana.realSemana)} de ${fmt(semana.leSemana)} m³ vendidos</strong> (${Math.round(pct*100)}%)${estourou?' · já passou da meta da semana':''}</div><div class="semana-progresso-barra"><div style="width:${Math.min(pct,1)*100}%;background:${cor}"></div></div>${tabela}`;
}
// Series finas de movimento (so' cobrem i>=0 — dias passados ainda nao tem esses campos no
// historico, so' opening/planned/received/sale; ver "editar passado" pausado).
const movSeries=[
 ['received','Recebimentos','#7DD3C0',i=>i>=0?state.movements.received[i]:null],
 ['pump','Prog. Bombeio','#2DD4BF',i=>i>=0?state.movements.pump[i]:null],
 ['progRoad','Prog. Rodoviário','#5EEAD4',i=>i>=0?(record.bi?.days[day(i)]?.progRoad??null):null],
 ['fob','Trânsito FOB','#64748B',i=>i>=0?state.movements.fob[i]:null],
 ['cif','Trânsito CIF','#FDE68A',i=>i>=0?state.movements.cif[i]:null],
 ['vmd','Média Vendas','#E5E7EB',i=>i>=0?(record.bi?.days[day(i)]?.vmd??null):null],
 ['plannedSales','Vendas Planejadas','#D9F99D',i=>i>=0?(record.bi?.days[day(i)]?.scenarios?.LE?.plannedSales??null):null],
 ['actualSales','Vendas Real','#4ADE80',i=>i>=0?(record.bi?.days[day(i)]?.scenarios?.Real?.actualSales??null):null],
 ['availability','Disp. MIS','#A3E635',i=>i>=0?(record.bi?.days[day(i)]?.scenarios?.['Disp MIS']?.availability??null):null],
];
// Entradas viram blocos empilhados sobre a abertura (igual ao grafico do BI); as demais series seguem em linha.
const ENTRADAS_BLOCO=['received','pump','progRoad','fob','cif'];
const valorMov=(k,i)=>(movSeries.find(m=>m[0]===k)[3](i))||0;
const topoPilha=(result,i)=>Math.max(result[i]?.opening??0,0)+ENTRADAS_BLOCO.reduce((s,k)=>s+valorMov(k,i),0);
let chartContext=null;
let mostrarHistoricoGrade=false;
document.addEventListener('click',e=>{if(e.target.closest('#toggle-historico')){mostrarHistoricoGrade=!mostrarHistoricoGrade;render(true);}});
function chart(result,original,offsets){chartContext={result,offsets};let rot='';const W=1200,H=250,L=60,R=20,T=16,B=32;const movValores=movSeries.flatMap(([,,,f])=>offsets.map(f)).filter(v=>v!=null);const pilhas=offsets.filter(i=>i>=0).map(i=>topoPilha(result,i));const values=result.flatMap(x=>[x.opening,x.close]).concat(original.map(x=>x.close),offsets.filter(i=>i<0).map(i=>history(i)?.opening).filter(v=>v!=null),parameters.slice(1).map(([k])=>state[k]).filter(v=>v!==null),movValores,pilhas,[0]);const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(hi-lo,1),y=v=>T+(hi+span*.1-v)/(span*1.2)*(H-T-B),x=i=>L+(i+7+.5)*(W-L-R)/offsets.length;
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histórico de abertura e projeção de estoque em metros cúbicos"><rect x="${L}" y="0" width="${x(0)-L-(W-L-R)/offsets.length/2}" height="${H-B}" fill="#ffffff04"/>`;
 for(let j=0;j<5;j++){const v=lo+(hi-lo)*j/4;svg+=`<path d="M${L} ${y(v)}H${W-R}" stroke="#314A32"/><text x="${L-8}" y="${y(v)+4}" fill="#7FA069" text-anchor="end" font-size="11">${fmt(v)}</text>`;}
 for(const [k,color,dash] of [['min','#FF6B5F','4 5'],['mid','#9CA3AF','4 5'],['lastro','#F97316','4 5'],['max','#8DC830','4 5'],['capacity','#38BDF8','']])if(state[k]!==null)svg+=`<path d="M${L} ${y(state[k])}H${W-R}" stroke="${color}" stroke-width="${k==='capacity'?2:1}" stroke-dasharray="${dash}"><title>${k}: ${fmt(state[k])} m³</title></path>`;
 const today=simulationToday();const hojeI=offsets.find(i=>day(i)===today);if(hojeI!=null)svg+=`<rect x="${x(hojeI)-(W-L-R)/offsets.length/2}" y="0" width="${(W-L-R)/offsets.length}" height="${H-B}" fill="#EEFE7A" opacity=".08"><title>Hoje</title></rect>`;
 const base=svg;svg='';for(const i of offsets){const v=i<0?history(i)?.opening:result[i].opening;if(v!=null){const barTop=Math.min(y(v),y(0)),cor=i<0?'#527568':(d=>{const s=state.movements.sale[i]??0;return s<=0||d>=s?'#14B8A6':d>=0.9*s?'#FACC15':'#FF6B5F';})(v+result[i].incoming);svg+=`<rect x="${x(i)-12}" y="${barTop}" width="24" height="${Math.max(1,Math.abs(y(v)-y(0)))}" fill="${cor}" opacity=".9"><title>${label(i)} · Abertura: ${fmt(v)} m³</title></rect>`;const rotulo=fmt(v),largura=Math.max(26,rotulo.length*7+10),comPilha=i>=0&&topoPilha(result,i)>Math.max(v,0),ry=comPilha?barTop+4:barTop-22;rot+=`<rect x="${x(i)-largura/2}" y="${ry}" width="${largura}" height="17" rx="4" fill="#EAF6E8" opacity=".92"/><text x="${x(i)}" y="${ry+12}" text-anchor="middle" fill="#14210F" font-size="11" font-weight="700">${rotulo}</text>`;}svg+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle" fill="${day(i)===today?'#EEFE7A':'#BFD4A8'}" font-size="11" font-weight="${day(i)===today?'700':'400'}">${label(i)}</text>`;}
 const barras1=svg;svg='';for(const [series,color,dash] of [[original,'#7FA069','5 5'],[result,'#EEFE7A','']])svg+=`<polyline points="${series.map((v,i)=>`${x(i)},${y(v.close)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}"/>`;
 const linhas1=svg;svg='';for(const i of offsets.filter(i=>i>=0)){let cum=Math.max(result[i]?.opening??0,0);for(const k of ENTRADAS_BLOCO){const [,nome,cor,valorEm]=movSeries.find(m=>m[0]===k);const v=valorEm(i)||0;if(v<=0)continue;svg+=`<rect x="${x(i)-12}" y="${y(cum+v)}" width="24" height="${Math.max(1,y(cum)-y(cum+v))}" fill="${cor}" opacity=".85"><title>${label(i)} · ${nome}: ${fmt(v)} m³</title></rect>`;if(y(cum)-y(cum+v)>=14)rot+=`<text x="${x(i)}" y="${(y(cum)+y(cum+v))/2+4}" text-anchor="middle" font-size="10" font-weight="700" fill="#0B1A0E">${fmt(v)}</text>`;cum+=v;}if(cum>Math.max(result[i]?.opening??0,0))rot+=`<text x="${x(i)}" y="${y(cum)-6}" text-anchor="middle" font-size="11" font-weight="700" fill="#EAF6E8">${fmt(cum-Math.max(result[i]?.opening??0,0))}</text>`;}
 const barras2=svg;svg='';for(const [chave,nome,cor,valorEm] of movSeries.filter(m=>!ENTRADAS_BLOCO.includes(m[0]))){const pontos=offsets.map(i=>[i,valorEm(i)]).filter(([,v])=>v!=null);if(!pontos.length)continue;svg+=`<polyline points="${pontos.map(([i,v])=>`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${cor}" stroke-width="1.5" opacity=".85"/>`;for(const [i,v] of pontos)svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${cor}"><title>${label(i)} · ${nome}: ${fmt(v)} m³</title></circle>`;}
 result.forEach((v,i)=>{svg+=`<circle cx="${x(i)}" cy="${y(v.close)}" r="4" fill="${status(v.close)==='danger'?'#FF6B5F':status(v.close)==='warn'?'#F97316':'#EEFE7A'}"><title>${label(i)} · Fechamento: ${fmt(v.close)} m³</title></circle>`;});
 const linhas2=svg;svg=base+linhas1+linhas2+barras1+barras2;
 // Area invisivel por dia, por cima de tudo, pra abrir o popup com o detalhamento completo daquele
 // dia (pedido da usuaria, 2026-10-01: "popupzinho com todas as infos que temos").
 const largura=(W-L-R)/offsets.length;
 for(const i of offsets)svg+=`<rect x="${x(i)-largura/2}" y="0" width="${largura}" height="${H-B}" fill="transparent" data-chart-day="${i}" tabindex="0" aria-label="Detalhes de ${esc(label(i))}"/>`;
 $('chart').innerHTML=svg+rot+'</svg>';}
function popupGrafico(i){
 const {result,offsets}=chartContext||{};if(!result)return'';
 const futuro=i>=0;
 const linhas=[];
 linhas.push(['Abertura',futuro?result[i]?.opening:history(i)?.opening]);
 if(futuro)linhas.push(['Fechamento',result[i]?.close]);
 linhas.push(['Vendas aplicada (debita)',futuro?state.movements.sale[i]:history(i)?.sale]);
 for(const [,nome,,valorEm] of movSeries){const v=valorEm(i);if(v!=null)linhas.push([nome,v]);}
 const semanaDia=record.bi?.semana?.porDia?.[day(i)],depositoDia=record.bi?.semanaPorDeposito?.porDia?.[day(i)];
 let semanaHtml='';
 if(semanaDia||depositoDia){
  const linha=(titulo,d)=>d?`<div><dt>${esc(titulo)}</dt><dd>${fmt(d.real)} de ${fmt(d.le)} m³ (${d.le?Math.round(d.real/d.le*100):0}%)</dd></div>`:'';
  semanaHtml=`<p><strong>LE da semana · já realizado</strong></p><dl>${linha('Cidade (consolidado)',semanaDia)}${linha('Este depósito',depositoDia)}</dl>`;
 }
 return `<strong>${esc(label(i))} · ${esc(record.base)} · ${esc(record.product)}</strong><dl>${linhas.map(([n,v])=>`<div><dt>${esc(n)}</dt><dd>${v==null?'Sem dado':fmt(v)+' m³'}</dd></div>`).join('')}</dl>${semanaHtml}`;
}
function mostrarPopupGrafico(el){
 const i=+el.dataset.chartDay,popup=$('chart-popover');
 popup.innerHTML=popupGrafico(i);popup.hidden=false;
 const rect=el.getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight;
 popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';
 popup.style.top=Math.max(8,rect.top-height-8>=8?rect.top-height-8:rect.bottom+8)+'px';
}
function fecharPopupGrafico(){$('chart-popover').hidden=true;}
document.addEventListener('pointerover',e=>{const el=e.target.closest('[data-chart-day]');if(el)mostrarPopupGrafico(el);});
document.addEventListener('focusin',e=>{const el=e.target.closest('[data-chart-day]');if(el)mostrarPopupGrafico(el);});
document.addEventListener('pointerdown',e=>{const el=e.target.closest('[data-chart-day]');if(el)mostrarPopupGrafico(el);else if(!$('chart-popover').contains(e.target))fecharPopupGrafico();});
document.addEventListener('pointerout',e=>{if(e.target.closest('[data-chart-day]')&&document.activeElement!==e.target)fecharPopupGrafico();});
function alerts(result){const items=['O histórico de vendas realizadas não é carregado nesta versão; as vendas futuras usam o LE vigente e, hoje, o maior entre o LE e os pedidos do SAP.',`Valores futuros carregados das fontes (${D.bi.extractedAt.replace('T',' ')}). Portal carregado até ${D.bi.coverage.portal_max.slice(0,10)}; cadências MIS até ${D.bi.coverage.cadencia_max.slice(0,10)}.`];if(parameters.slice(1).some(([k])=>state[k]===null))items.push('A planilha de política tem campos vazios neste recorte; os alertas correspondentes estão indisponíveis.');result.forEach((r,i)=>{const low=Math.min(r.opening,r.close),high=Math.max(r.opening,r.close),a=[];if(low<0)a.push(`déficit físico de ${fmt(-low)} m³`);if(state.lastro!==null&&low<state.lastro)a.push('estoque abaixo do lastro');if(state.min!==null&&low<=state.min)a.push(`no mínimo ou abaixo em ${fmt(state.min-low)} m³`);if(state.capacity!==null&&high>state.capacity)a.push(`capacidade excedida em ${fmt(high-state.capacity)} m³`);else if(state.max!==null&&high>state.max)a.push('acima do estoque máximo');if(a.length)items.push(label(i)+': '+a.join(' • '));});$('alerts').innerHTML=items.map(s=>`<div class="alert">${esc(s)}</div>`).join('');}
// Selecionar pelo <select> nativo sempre colapsa pra 1 so' (troca o Set inteiro) — e' a ferramenta de
// "escolher so' esse"; os chips (abaixo) sao quem permite ligar varios ao mesmo tempo sem perder os
// outros ja ativos.
$('cidade').onchange=()=>{depositosAtivos=new Set();empresasAtivas=new Set();refreshDepositoOptions();products();};
$('deposito').onchange=()=>{depositosAtivos=$('deposito').value?new Set([$('deposito').value]):new Set();refreshEmpresaOptions();products();};
$('empresa').onchange=()=>{empresasAtivas=$('empresa').value?new Set([$('empresa').value]):new Set();products();};
$('product').onchange=select;
$('grid').oninput=e=>{const input=e.target,k=input.dataset.row;if(!k)return;if(!input.validity.valid||input.value===''||!Number.isFinite(input.valueAsNumber))return;try{E.setMovement(state,k,+input.dataset.day,input.valueAsNumber);}catch(err){message(err.message);input.value=Math.round(state.movements[k][+input.dataset.day]);return;}persist();render();};
$('grid').addEventListener('focusout',e=>{const input=e.target;if(input.dataset.row)input.value=Math.round(state.movements[input.dataset.row][+input.dataset.day]);});
$('clamp').onchange=()=>{state.clamp=$('clamp').checked;persist();render();};$('name').onchange=()=>{state.name=$('name').value;persist();};
// Pedido da usuaria, 2026-10-02: tirar da tela os botoes "Restaurar dados da fonte"/"Exportar CSV"/
// "Salvar cenario JSON"/"Abrir cenario" (topo). "Restaurar" continua disponivel via #reset-tabela (↺
// Restaurar, junto da tabela) — mesma acao, so' que exposta num unico lugar agora. Exportar CSV/Salvar
// JSON/Abrir cenario (arquivo local) nao tem mais botao na tela; o Firebase ("Salvar na equipe") segue
// disponivel pra compartilhar cenarios com a equipe.
function restaurarDaFonte(){$('entrada').value='auto';if(modoCombinado){const registros=registrosAtuais().filter(r=>r.product===$('product').value);const {baseline:combinada,openingSomado}=freshCombinado(registros);record=construirRegistroCombinado(registros,openingSomado);baseline=combinada;}else baseline=fresh(record);state=structuredClone(baseline);persist();premises();render(true);message('Recorte restaurado aos dados da fonte (origem da entrada voltou para Fontes automáticas).');}
$('entrada').onchange=()=>{persist();select();};
$('reset-tabela').onclick=restaurarDaFonte;
// Filtro de regiao (SP/MG+RJ/Centro-Oeste): so aparece quando ha SIM_CLOUD.regionOf (versao hospedada
// com Firebase); no modo local (sem login) nao ha regiao cadastrada, entao o campo fica escondido.
function basesPermitidas(){const todas=[...new Set(D.records.map(r=>r.base))];const regiao=$('regiao-filtro')?.value;return regiao&&window.SIM_CLOUD?.regionOf?todas.filter(b=>window.SIM_CLOUD.regionOf(b)===regiao):todas;}
// Cidade primeiro, depois deposito (dentro da cidade escolhida) — os dois sempre comecam com uma opcao
// vazia "Selecione...", pra tela nao abrir com nada pre-selecionado.
function cidadesPermitidas(){const permitidas=new Set(basesPermitidas());return [...new Set(D.records.filter(r=>permitidas.has(r.base)).map(cidadeDe))].sort((a,b)=>a.localeCompare(b,'pt-BR'));}
function depositosPermitidos(cidade){const permitidas=new Set(basesPermitidas());return [...new Set(D.records.filter(r=>permitidas.has(r.base)&&cidadeDe(r)===cidade).map(depositoDe))].sort((a,b)=>a.localeCompare(b,'pt-BR'));}
// Empresa (3o nivel — pedido da usuaria, 2026-10-02): cidade+deposito sozinhos nao sao unicos, existem
// 7 combinacoes reais ambiguas no cadastro (ex.: Betim+POTENCIAL tem 3 bases: CHARRUA/Nexta/SIM).
// `depositos` aceita 1+ depositos (Set ou array) — pedido da usuaria, 2026-10-05: empresa disponivel e'
// a uniao das empresas de TODOS os depositos ativos, nao so' de um.
function empresasPermitidas(cidade,depositos){const permitidas=new Set(basesPermitidas()),depositosSet=depositos instanceof Set?depositos:new Set(depositos);return [...new Set(D.records.filter(r=>permitidas.has(r.base)&&cidadeDe(r)===cidade&&depositosSet.has(depositoDe(r))).map(empresaDe))].sort((a,b)=>a.localeCompare(b,'pt-BR'));}
function refreshBaseOptions(){const cidadeAnterior=$('cidade').value;options($('cidade'),['',...cidadesPermitidas()]);$('cidade').options[0].textContent='Selecione a cidade';if([...$('cidade').options].some(o=>o.value===cidadeAnterior))$('cidade').value=cidadeAnterior;refreshDepositoOptions();}
// O <select> nativo so' mostra 1 valor por vez; com exatamente 1 ativo reflete ele normal, com 0 ou 2+
// fica na opcao vazia (os chips, que suportam multi-selecao de verdade, mostram o estado real nesse caso).
function sincronizarSelectMultiplo(select,ativos){select.value=ativos.size===1?[...ativos][0]:'';}
// Pedido da usuaria, 2026-10-05: se a cidade (ou cidade+depositos) so' tem 1 opcao possivel de
// deposito/empresa, preenche sozinho (ex.: Barra do Garcas so' tem 1 deposito e 1 empresa — nao faz
// sentido pedir pra escolher). Preserva selecoes anteriores que continuam validas (mesmo esquema que ja
// existia pro <select> simples, so' que agora sobre um Set em vez de 1 valor so').
function refreshDepositoOptions(){const cidade=$('cidade').value;const permitidos=cidade?depositosPermitidos(cidade):[];options($('deposito'),['',...permitidos]);$('deposito').options[0].textContent='Selecione o depósito';const permitidosSet=new Set(permitidos);depositosAtivos=new Set([...depositosAtivos].filter(d=>permitidosSet.has(d)));if(!depositosAtivos.size&&permitidos.length===1)depositosAtivos=new Set(permitidos);sincronizarSelectMultiplo($('deposito'),depositosAtivos);refreshEmpresaOptions();}
function refreshEmpresaOptions(){const cidade=$('cidade').value;const permitidos=cidade&&depositosAtivos.size?empresasPermitidas(cidade,depositosAtivos):[];options($('empresa'),['',...permitidos]);$('empresa').options[0].textContent='Selecione a empresa';const permitidosSet=new Set(permitidos);empresasAtivas=new Set([...empresasAtivas].filter(e=>permitidosSet.has(e)));if(!empresasAtivas.size&&permitidos.length===1)empresasAtivas=new Set(permitidos);sincronizarSelectMultiplo($('empresa'),empresasAtivas);if(typeof renderChips==='function')renderChips();}
// So aparece pra quem enxerga mais de uma regiao (administrador/leitura); regional ja so ve a propria
// regiao, entao filtrar por outra sempre daria lista vazia.
const perfilVeTudo=window.SIM_AUTH?.profile?.admin===true||window.SIM_AUTH?.profile?.perfil==='leitura';
if(perfilVeTudo)$('regiao-filtro-label').hidden=false;
$('regiao-filtro')?.addEventListener('change',()=>{refreshBaseOptions();products();});
// Pedido da usuaria, 2026-10-01: nada pre-selecionado ao abrir (antes tinha um default fixo em
// "Duque de Caxias" + "Gasolina A", resquicio de teste que nunca devia ter ficado).
refreshBaseOptions();options($('product'),[]);select();$('date').value=D.date;
