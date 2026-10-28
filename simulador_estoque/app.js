'use strict';
const $=id=>document.getElementById(id), E=window.StockEngine;let D=window.ESTOQUE_DATA;
const fmt=v=>v===null||v===undefined?'—':Math.round(v).toLocaleString('pt-BR');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=i=>{const d=new Date(D.date+'T12:00:00');d.setDate(d.getDate()+i);return d.toISOString().slice(0,10);};
const label=i=>new Date(day(i)+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
// "seg", "ter"... embaixo da data na tabela e no grafico (pedido da usuaria, 2026-10-08).
const diaSemana=i=>new Date(day(i)+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','');
let record,state,baseline,n=15,timer;
// Sugestao de cadencia (sugestao.js): dias em que a carga era necessaria e nao coube, so' pra pintar a celula.
const CARGA_SUGESTAO=60,GATILHO_SUGESTAO=0.70;let avisosSugestao={};
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
// Nomes da usuaria (2026-10-08): "programado" = FOB que ja conta hoje (Em Andamento/Viagem Finalizada,
// e desde 2026-10-14 tambem Placa Enviada/Frota Dedicada — com placa, Herrlog ainda sem rastrear); "nao programado" = viagens FOB do portal ainda sem placa (Ofertado/Aceito/Backlog), que o
// publicar_transito_ao_vivo.py ja manda so' no detalhe (viagens[].grupo==='programado' no codigo).
// Nao entra na conta, a nao ser na origem de entrada "Programado + Não programado".
// Viagens que sao transferencia entre bases nossas (2026-10-15): ficam so' na linha/popup "Transferencia ·
// entrada", fora do Trânsito FOB/CIF e do "nao programado", pra nao aparecerem duas vezes.
function idsTransfEntrada(r){const s=new Set();for(const d of Object.values(r?.bi?.days||{}))for(const t of d?.transferenciasEntrada||[])if(t.viagem)s.add(t.viagem);return s;}
function fobNaoProgramado(r,iso){const ids=idsTransfEntrada(r);const vs=(D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material]?.[iso]?.viagens||[]).filter(v=>v.modal==='fob'&&v.grupo==='programado'&&!ids.has(v.idViagem));return vs.length?vs.reduce((s,v)=>s+(v.volume||0),0):null;}
// entradaForcada: a Visao do dia sempre usa as fontes automaticas, qualquer que seja a origem de
// entrada escolhida na tela do simulador.
// Transferencias de entrada por dia, com a linha em que cada viagem ja' estava ('fob'/'cif'/'naoprog'/null).
// Com o transito ao vivo, o dia e a linha vem dele (achando a viagem pelo numero); sem ele, da carga de 30 min.
function entradasTransfPorDia(r){
 const vivo=D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material],noVivo={},porDia={};
 if(vivo)for(const [iso,d] of Object.entries(vivo))for(const v of d?.viagens||[])if(v.idViagem)noVivo[v.idViagem]={iso,conta:v.grupo==='programado'?'naoprog':v.modal,statusViagem:v.statusViagem||null};
 for(const [iso,d] of Object.entries(r.bi?.days||{}))for(const t of d?.transferenciasEntrada||[]){
  const vivoT=t.viagem?noVivo[t.viagem]:null;
  (porDia[vivoT?vivoT.iso:iso]??=[]).push({...t,conta:vivoT?vivoT.conta:(vivo?null:t.conta),statusViagem:vivoT?.statusViagem??t.statusViagem??null});
 }
 return porDia;
}
// Filtro por Status da viagem (usuaria, 2026-10-19: "quando selecione so' T1, considere so' T1 pras entradas;
// T1 e T2, os 2; se tiver em backlog, so' backlog; deixe eu selecionar mais de 1"). Vale pros carros do transito
// (FOB/CIF/transferencia) em "Fontes automaticas" e "Programado + Nao programado"; com todos marcados = regra normal.
const STATUS_VIAGEM=[['T1','T1 · Programado'],['T2','T2 · Na origem'],['T3','T3 · Em deslocamento'],['T4','T4 · No destino'],
 ['T5','T5 · Finalizada'],['sem','Sem status'],['backlog','Backlog (sem placa)']];
// Sempre abre com TODOS os status marcados (usuaria, 2026-10-28: "traga como padrao os dados de todos os botoes"):
// o filtro nao fica mais guardado no navegador — quem desmarcava um status deixava de ver viagens nas visitas
// seguintes sem perceber. A marca antiga e' apagada.
let filtroStatusViagem=new Set(STATUS_VIAGEM.map(([k])=>k));
try{localStorage.removeItem('simulador.filtroStatusViagem');}catch{}
const filtroStatusAtivo=()=>filtroStatusViagem.size<STATUS_VIAGEM.length;
// Categoria do carro: sem placa (grupo 'programado' no detalhe) = backlog; com placa, pelo T1..T5 da Herrlog.
function categoriaViagem(v){if(v.grupo==='programado')return 'backlog';const m=/^T([1-5])/.exec(String(v.statusViagem||''));return m?'T'+m[1]:'sem';}
// Botao de entrada "Tudo" (usuaria, 2026-10-19; igual ao LE do BI): "Programado + Nao programado" e mais a
// cadencia rodoviaria do MIS que ainda nao virou viagem no portal (entra no FOB).
const incluiNaoProg=e=>e==='auto+naoprog'||e==='auto+tudo';
// Botao "Inbound S · MIS S+1" = cenario LE do BI (usuaria, 2026-10-20/21: "quero que bata"). Conferido com o print
// do BI (Betim POTENCIAL+RBZ, Biodiesel): em TODOS os dias entram as viagens do portal (programado + nao programado,
// = "Programado + Nao programado"); da segunda da S+1 (D.bi.inbound.switchDate) em diante SOMA-SE a cadencia MIS do
// dia (FOB/CIF) — o BI nao troca o portal pela cadencia, soma (26/10: 167,5 do portal + 65 da cadencia = 233).
const entradaNoDia=(e,iso)=>e==='le-bi'?'auto+naoprog':e;
// "Trânsito real + Não programado" passou a ser o LE do BI (usuaria, 2026-10-28: "programado + nao programado quero
// que seja o botao igual ao LE"): na S+1 soma a cadencia MIS que ainda nao virou viagem no portal.
const comoLE=e=>e==='le-bi'||e==='auto+naoprog';
const somaCadenciaS1=(e,iso)=>comoLE(e)&&iso>=(D.bi?.inbound?.switchDate||'9999');
// Parte do FOB do dia que e' so' planejamento da cadencia MIS (borda ambar tracejada na tabela e no grafico):
// no botao "LE" (2026-10-21, usuaria: "deixa o ambar"), a cadencia MIS somada da S+1 em diante.
function cadenciaAmbar(i){const e=$('entrada')?.value,iso=day(i);if(i<0)return 0;
 if(comoLE(e))return somaCadenciaS1(e,iso)?registrosReais().reduce((s,r)=>{const c=r.bi?.days?.[iso]?.cadencia;return s+(c?.fobPendente??c?.fob??0);},0):0;
 if(e==='auto+tudo')return registrosReais().reduce((s,r)=>s+cadenciaMisSemViagem(r,iso),0);
 return 0;}
function cadenciaMisSemViagem(r,iso){
 const v=r.bi?.days?.[iso]?.progRoad;if(!v)return 0;
 const planejadas=(entradasTransfPorDia(r)[iso]||[]).filter(t=>t.conta!=='fob'&&t.conta!=='cif').reduce((s,t)=>s+(t.volume||0),0);
 return Math.max(0,v-planejadas-(fobNaoProgramado(r,iso)||0));
}
function trocarFiltroStatus(chaves){filtroStatusViagem=new Set(chaves);}
function fresh(r,cenarioForcado,entradaForcada){
 // Padrao VMD reprojetada (2026-10-19: LE e Disp MIS sairam dos botoes).
 const scenario=cenarioForcado||$('scenario')?.value||'VMD',today=simulationToday();
 // Origem da entrada (pedido da usuaria, 2026-10-01): 'auto' = fontes de sempre (FOB/CIF do portal +
 // Bombeio da cadencia DAP); 'cadencia' = substitui FOB+CIF+Bombeio inteiros pelos valores PLANEJADOS
 // da cadencia MIS (ja' separados por frete em loaded.cadencia). Nao ha equivalente de cadencia pra
 // transferencia, entao fica zerada nesse modo. "Restaurar" volta pro 'auto' porque fresh() so' le
 // $('entrada').value quando nao vem cenarioForcado — e o botao restaurar chama fresh(record) puro,
 // que relê o select; o select em si so' muda quando o usuario mexe, entao o reset preserva a escolha
 // atual do select — por isso o botao "Restaurar" tambem reseta o select pra 'auto' (ver mais abaixo).
 const entradaTela=entradaForcada||$('entrada')?.value||'auto';
 const startIndex=Math.max(0,Math.round((new Date(today+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000));
 const switchIndex=Math.max(startIndex,Math.round((new Date(D.bi.inbound.switchDate+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000));
 const movements=Object.fromEntries(E.rows.map(([k])=>[k,Array(30).fill(0)]));
 const transfEntrada=entradasTransfPorDia(r);
 for(let i=0;i<Math.min(n,30);i++){
  const loaded=r.bi?.days[day(i)];if(!loaded)continue;
  const future=day(i)>=today,entrada=entradaNoDia(entradaTela,day(i));
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
  if(future&&entrada.startsWith('auto')&&scenario!=='Inbound + MIS'){
   // Com o transito ao vivo carregado, ele e' a UNICA fonte do FOB/CIF futuro (usuaria, 2026-10-27: "isso NUNCA
   // pode acontecer"): dia sem viagem ao vivo = 0. Antes caia no FOB da carga (CSV das :00/:30), e a viagem que o
   // ETA novo empurrou pro dia seguinte contava nos dois dias (Betim POTENCIAL hidratado, 60 em 28 e 29/10).
   if(D.transitoAoVivo){
    const vivo=D.transitoAoVivo[r.bi?.emp_dep]?.[r.bi?.material]?.[day(i)];
    movements.fob[i]=vivo?.fob??0;movements.cif[i]=vivo?.cif??0;
   }
   // "Programado + Não programado" (pedido da usuaria, 2026-10-08): soma no FOB as viagens ainda sem placa.
   if(incluiNaoProg(entrada))movements.fob[i]+=fobNaoProgramado(r,day(i))??0;
   // Transferencia de entrada em linha propria (pedido da usuaria, 2026-10-15): a viagem que vem de outra base
   // nossa sai do FOB/CIF (se ja' estava la') e entra em "Transferencia · entrada"; a que nao estava em linha
   // nenhuma (programada no portal ou na cadencia) passa a contar aqui, fechando com a saida da origem.
   // Regra dos dois botoes (usuaria, 2026-10-16): "Fontes automaticas" = so' o real, o que ja' esta' no transito;
   // "Programado + Nao programado" = tudo (com placa + Backlog sem placa + cadencia). Entao a transferencia que
   // ainda nao esta' no transito (Backlog/cadencia) so' conta no segundo botao.
   for(const t of transfEntrada[day(i)]||[]){
    // 'naoprog' (sem placa) nunca esta' no FOB: fobNaoProgramado ja' deixa as transferencias de fora.
    const conta=t.conta==='naoprog'?null:t.conta;
    if(!conta&&!incluiNaoProg(entrada))continue;
    if(conta)movements[conta][i]-=Math.min(movements[conta][i],t.volume);
    // Em "Fontes automaticas" so' conta a transferencia COM Status Viagem (T1-T5); sem status (ex.: Placa
    // Enviada ainda sem rastreio) fica igual ao Backlog: so' entra no "Programado + Nao programado" (2026-10-19).
    if(!incluiNaoProg(entrada)&&!emViagemTransf(t))continue;
    movements.transferIn[i]+=t.volume;
   }
   const misDia=entrada==='auto+tudo'?cadenciaMisSemViagem(r,day(i)):0;
   movements.fob[i]+=misDia;
   // Filtro de Status da viagem: refaz FOB/CIF/transferencia so' com os carros das categorias marcadas. A
   // Visao do dia (entradaForcada) ignora o filtro.
   if(filtroStatusAtivo()&&!entradaForcada){
    const idsTransf=idsTransfEntrada(r);
    movements.fob[i]=0;movements.cif[i]=0;movements.transferIn[i]=0;
    for(const v of vivo?.viagens||[]){
     if(!filtroStatusViagem.has(categoriaViagem(v)))continue;
     const destino=v.idViagem&&idsTransf.has(v.idViagem)?'transferIn':v.modal==='cif'?'cif':'fob';
     movements[destino][i]+=v.volume||0;
    }
    // Transferencia que so' existe na cadencia (sem carro): conta como Backlog.
    if(filtroStatusViagem.has('backlog'))for(const t of transfEntrada[day(i)]||[])if(!t.viagem)movements.transferIn[i]+=t.volume;
    // No "Tudo", a cadencia MIS sem viagem tambem conta como Backlog.
    if(filtroStatusViagem.has('backlog'))movements.fob[i]+=misDia;
   }
  }
  // LE do BI: cadencia MIS do dia somada ao portal na S+1 (com filtro de status, entra como Backlog).
  if(future&&somaCadenciaS1(entradaTela,day(i))&&(!filtroStatusAtivo()||entradaForcada||filtroStatusViagem.has('backlog'))){
   movements.fob[i]+=loaded.cadencia?.fobPendente??loaded.cadencia?.fob??0;movements.cif[i]+=loaded.cadencia?.cifPendente??loaded.cadencia?.cif??0;}
  // Transferencia de entrada consolidada no FOB (usuaria, 2026-10-20: "tira a linha de transferencia (entradas) e
  // consolida tudo no FOB entrada; so' mostra uma cor diferente no popup"). A regra de quando conta continua a mesma.
  if(future){movements.fob[i]+=movements.transferIn[i];movements.transferIn[i]=0;}
  // Datas anteriores usam a mesma base em todos os cenarios.
  if(!future)continue;
  // 5 cenarios de venda (pedido da usuaria, 2026-09-30): VMD (reprojetada), LE (vigente, SEM
  // reprojecao — antes do 2026-09-30 esse botao aplicava a reprojetada, agora aplica o valor original),
  // Pedidos em tela (VA05, total do dia, todos os status — igual ao que o BI mostra hoje, nao so' os
  // "Em processamento"), Real (faturamento MySQL ate' agora, nao o volume de pedido do VA05) e Disp MIS
  // (disponibilidade, inalterado). semana.porDia so' existe pros produtos cobertos pela reprojecao.
  const semanaDia=r.bi?.semana?.porDia?.[day(i)];
  if(scenario==='VMD')movements.sale[i]=loaded.vmd??0;
  // LE do deposito, dia a dia, em toda a janela (loaded.le, 2026-10-16); snapshot antigo sem o campo cai no da semana.
  else if(scenario==='LE')movements.sale[i]=loaded.le??semanaDia?.le??0;
  else if(scenario==='Pedidos em tela')movements.sale[i]=loaded.billing??0;
  // Real igual ao BI (vendas_projecao_real, 2026-10-19): ate' hoje a venda real do deposito (passado =
  // faturamento, hoje = VA05 do dia, a qualquer hora); de amanha em diante fica a VMD reprojetada (loaded.sale).
  // Snapshot antigo sem vendaReal: regra anterior (real da cidade, hoje so' depois das 13h).
  else if(scenario==='Real'){if(day(i)<=today)movements.sale[i]=loaded.vendaReal!==undefined?(loaded.vendaReal??0):(day(i)<=D.bi.extractedAt.slice(0,10)?semanaDia?.real??0:movements.sale[i]);}
  else if(['Disp MIS','Inbound + MIS'].includes(scenario))movements.sale[i]=loaded.scenarios?.[scenario]?.availability??0;
 }
 return {version:1,id:r.id,date:D.date,sourceRevision:D.revision,name:'Minha simulação',opening:r.opening,lastro:r.bi?.days[day(0)]?.scenarios?.[scenario]?.lastro??r.policy?.lastro??null,min:r.policy?.min??null,mid:r.policy?.mid??null,max:r.policy?.max??null,capacity:r.capacidadeFisica??r.policy?.capacity??null,clamp:false,scenario,switchIndex,movements};
}
function key(){return 'nexta-stock-auto-v2:'+D.date+':'+record.id+':'+($('scenario')?.value||'VMD')+':'+($('entrada')?.value||'auto');}
function sourceNote(k,i){const loaded=record.bi?.days[day(i)],mode=state.scenario;if(k==='planned')return 'Cadência sugerida pelo simulador (cargas de '+CARGA_SUGESTAO+' m³) ou digitada. Não altera a cadência do MIS.';if(['received','planned','purchase','loanIn','loanOut'].includes(k))return 'Ajuste adicional manual; não repetir um volume já importado.';if(['fob','cif'].includes(k)){const mis=mode==='Inbound + MIS'&&i>=state.switchIndex;return `${mis?'Cadências MIS ('+k.toUpperCase()+')':'CSV do portal, com filtro de status e data de descarga'} · ${fmt((mis?loaded?.inboundMis[k]:loaded?.[k])??0)} m³ · ${day(i)}`;}
 if(k==='sale'){
  const semanaDia=record.bi?.semana?.porDia?.[day(i)];
  if(mode==='VMD')return `VMD reprojetada · ${loaded?.vmd==null?'sem valor na fonte':fmt(loaded.vmd)+' m³'} · ${day(i)}`;
  if(mode==='LE'){const le=loaded?.le??semanaDia?.le;return `LE vigente, sem reprojeção · ${le==null?'sem valor na fonte':fmt(le)+' m³'} · ${day(i)}`;}
  if(mode==='Pedidos em tela')return `Pedidos em tela (VA05, todos os status) · ${loaded?.billing==null?'sem valor na fonte':fmt(loaded.billing)+' m³'} · ${day(i)}`;
  if(mode==='Real'){
   if(day(i)>simulationToday())return `Real: de amanhã em diante vale a VMD reprojetada · ${fmt(loaded?.vmd??0)} m³ · ${day(i)}`;
   const real=loaded?.vendaReal!==undefined?loaded.vendaReal:semanaDia?.real;
   return `${day(i)<simulationToday()?'Faturado (venda real)':'Pedidos do VA05 de hoje (venda real até o momento)'} · ${real==null?'sem valor na fonte':fmt(real)+' m³'} · ${day(i)}`;}
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
function biDiaCombinado(registros,iso){const dias=registros.map(r=>r.bi?.days?.[iso]).filter(Boolean);if(!dias.length)return null;return{vmd:somaOuNula(dias.map(d=>d.vmd)),billing:somaOuNula(dias.map(d=>d.billing)),vendaMediaSemana:somaOuNula(dias.map(d=>d.vendaMediaSemana))};}
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
// Botao "+ fim do LE" (usuaria, 2026-10-19): estende a tabela/grafico ate' o ultimo dia com LE (max 30 dias).
// Os dias extras vem de fontes/extensao/<regiao>, baixados so' no 1o clique (a carga normal fica com 15 dias).
let extensaoAtiva=false,extensaoCarregada=false;
function horizonteRecorte(registros){
 if(!extensaoAtiva||!registros?.length)return 15;
 const ultimo=registros.flatMap(r=>Object.keys(r.bi?.days||{})).sort().at(-1);
 const dias=ultimo?Math.round((new Date(ultimo+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000)+1:15;
 return Math.max(15,Math.min(30,dias));
}
async function alternarExtensao(){
 if(!extensaoAtiva&&!extensaoCarregada){
  if(!window.SIM_CLOUD?.carregarExtensao){message('Dias extras disponíveis só no portal online.');return;}
  message('Carregando os dias até o fim do LE…');
  try{
   const ext=await window.SIM_CLOUD.carregarExtensao();
   if(!Object.keys(ext).length){message('Os dias até o fim do LE ainda não estão disponíveis (aguarde a próxima atualização das fontes).');return;}
   for(const r of D.records)if(ext[r.id])Object.assign(r.bi.days,ext[r.id]);
   extensaoCarregada=true;
  }catch(e){console.error(e);message('Não foi possível carregar os dias extras. Tente de novo.');return;}
 }
 extensaoAtiva=!extensaoAtiva;
 select();
 message(extensaoAtiva?`Mostrando até ${label(n-1)} (fim do LE deste recorte).`:'De volta aos 15 dias.');
}
function select(){
 const registros=registrosAtuais().filter(r=>r.product===$('product').value);
 avisosSugestao={};
 modoCombinado=registros.length>1;
 if(!registros.length)record=undefined;
 else if(!modoCombinado)record=registros[0];
 // Filtro de regiao pode deixar a lista de bases vazia (ex.: nao ha base dessa regiao pra este login);
 // sem guarda, fresh(undefined) quebra o resto do render e trava a tela com os chips desatualizados.
 if(!registros.length){for(const id of ['grid','cards','alerts','chart','semana-progresso'])$(id).innerHTML='';if($('bi-measures'))$('bi-measures').innerHTML='';message(registrosAtuais().length?'Nenhuma base disponível para este filtro. Ajuste a região ou escolha outra base.':'Escolha cidade, depósito(s), empresa(s) e produto acima para começar.');return;}
 n=horizonteRecorte(registros);
 if(modoCombinado){const {baseline:combinada,openingSomado}=freshCombinado(registros);record=construirRegistroCombinado(registros,openingSomado);baseline=combinada;}
 else baseline=fresh(record);
 state=structuredClone(baseline);try{const saved=localStorage.getItem(key());if(saved){const candidate=E.validate(JSON.parse(saved));if(candidate.id===record.id&&candidate.date===D.date){state=mergeSource(candidate,baseline);}}}catch{message('Cenário local inválido ou indisponível. Abertura original carregada.');}
 // Com filtro de Status da viagem ligado, FOB/CIF/Transferencia de hoje em diante vem sempre do filtro (2026-10-19).
 if(filtroStatusAtivo())for(const k of ['fob','cif','transferIn'])for(let i=0;i<n;i++)if(day(i)>=simulationToday())state.movements[k][i]=baseline.movements[k][i];
 // Rascunho salvo antes da linha de transferencia sair (2026-10-20): o que estava nela vai pro FOB.
 for(let i=0;i<30;i++)if(state.movements.transferIn[i]){state.movements.fob[i]+=state.movements.transferIn[i];state.movements.transferIn[i]=0;}E.rows.find(r=>r[0]==='sale')[1]=({VMD:'Vendas · VMD reprojetada',LE:'Vendas · LE vigente',['Pedidos em tela']:'Vendas · Pedidos em tela',Real:'Vendas · Faturado (Real)',['Disp MIS']:'Vendas · Disp. MIS'})[state.scenario]||'Vendas';premises();render(true);}
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
function premises(){$('name').value=state.name;$('clamp').checked=state.clamp;$('premises').innerHTML=parameters.map(([k,l])=>`<label>${l}<input type="number" readonly data-param="${k}" aria-label="${l}" value="${state[k]===null?'':Math.round(state[k])}" placeholder="Ausente na fonte" title="Valor fixo, carregado da planilha de política."><small>${k==='opening'?(aberturaAtrasada()?`⚠ Abertura de ${new Date(record.aberturaEm+'T12:00:00').toLocaleDateString('pt-BR')} (não é de hoje)`:'Abertura importada'):(k==='capacity'?(semCapacidade()?'Sem capacidade estabelecida':'Planilha de tancagem'):`Política: ${fmt(baseline[k])} m³`)}</small></label>`).join('');}
// Capacidade 0 = base/produto fora da planilha de tancagem (venda no bico): "Sem capacidade estabelecida".
function semCapacidade(){return record?.capacidadeFisica===0;}
function history(i){return D.history?.[day(i)]?.[record.base+'|'+record.product];}
// Dias passados da grade: o que realmente aconteceu (mesmas fontes do BI): abertura da planilha do dia,
// vendas realizadas (VA05 fornecido), FOB/CIF realizados (trânsito publicado) e fechamento = abertura do dia seguinte.
// Cor da abertura pela ocupacao do tanque: vermelho abaixo de 70% da capacidade, amarelo ate 75%, verde acima.
// Transferencias entre bases (pedido da usuaria, 2026-10-15): detalhe por dia (bi.days[iso].transferenciasSaida /
// transferenciasEntrada, montado em fontes_arquivos.py) e popup "pra onde vai / de onde vem" nas duas linhas.
// Transferencia de entrada ainda PLANEJADA no dia (programada no portal sem placa ou na cadencia MIS): o
// que nao esta' no transito real. Usada pela sugestao de cadencia e pra nao repetir no Prog. Rodoviario.
function transfPlanejadaDia(i){return transferencias(i,'transferenciasEntrada').filter(t=>t.conta!=='fob'&&t.conta!=='cif').reduce((s,t)=>s+(t.volume||0),0);}
// Transferencia de entrada EM VIAGEM = com Status Viagem da Herrlog (T1 Programado ... T5 Viagem finalizada).
// No grafico fica roxa; sem status (ex.: Placa Enviada ainda sem rastreio), Backlog ou cadencia ganha outra cor
// (usuaria, 2026-10-16: "um ta em branco e outro em T2, quero que separe essas cores").
const emViagemTransf=t=>Boolean(t.statusViagem);
function transferencias(i,campo){return registrosReais().flatMap(r=>campo==='transferenciasEntrada'?(entradasTransfPorDia(r)[day(i)]||[]):(r.bi?.days?.[day(i)]?.[campo]||[]));}
function marcarTransferencias(){
 for(const [row,campo] of [['transferIn','transferenciasEntrada'],['transferOut','transferenciasSaida']])
  document.querySelectorAll(`#grid input[data-row="${row}"]`).forEach(input=>{const i=+input.dataset.day,td=input.parentElement;
   const itens=transferencias(i,campo);
   if(itens.length){td.dataset.transf=campo;td.dataset.day=i;input.removeAttribute('title');td.classList.add('transf-com-detalhe');
    // Borda na mesma cor do grafico (usuaria, 2026-10-19): roxa = com Status Viagem (T1-T5), rosa = sem status;
    // as duas juntas = rosa com faixa roxa a esquerda.
    if(campo==='transferenciasEntrada'){const comStatus=itens.some(emViagemTransf),semStatus=itens.some(t=>!emViagemTransf(t));
     td.classList.toggle('transf-viagem',comStatus&&!semStatus);td.classList.toggle('transf-sem-status',semStatus&&!comStatus);td.classList.toggle('transf-misto',comStatus&&semStatus);}}});
 // Bombeio de hoje vindo da aba Aberturas (Receb. Efetuado + Receb. Programado): mesmo popup, com o que ja'
 // aconteceu e o que ainda vai acontecer (usuaria, 2026-10-20).
 document.querySelectorAll('#grid input[data-row="pump"]').forEach(input=>{const i=+input.dataset.day,td=input.parentElement;
  if(bombeioPortalDia(i)||bombeioMisDia(i).length){td.dataset.transf='bombeioPortal';td.dataset.day=i;input.removeAttribute('title');td.classList.add('transf-com-detalhe');}});
}
function bombeioPortalDia(i){const itens=registrosReais().map(r=>r.bi?.days?.[day(i)]?.bombeioPortal).filter(Boolean);
 return itens.length?{efetuado:itens.reduce((s,b)=>s+(b.efetuado||0),0),programado:itens.reduce((s,b)=>s+(b.programado||0),0),
  informativo:itens.some(b=>b.informativo)}:null;}
// Origem de cada bombeio da cadencia MIS (frete DAP) no dia (usuaria, 2026-10-27: "da onde e' esse bombeio, qual origem").
function bombeioMisDia(i){return i<0?[]:registrosReais().flatMap(r=>r.bi?.days?.[day(i)]?.bombeioMis||[]);}
function bombeioMisHtml(i,titulo){const itens=bombeioMisDia(i);if(!itens.length)return '';
 return `<p><strong>${titulo} (${fmt(itens.reduce((s,b)=>s+(b.volume||0),0))} m³)</strong></p><dl class="viagens">${itens.map(b=>`<div><dt>${esc(b.origem||'Origem não informada')} · ${fmt(b.volume)} m³</dt><dd>Origem: ${esc(b.origem||'—')} → Destino: ${esc(b.destino||'—')}${b.oc?` · Pedido MIS ${esc(b.oc)}`:''}</dd></div>`).join('')}</dl>`;}
function popupBombeioPortal(i){const b=bombeioPortalDia(i);
 if(!b)return `<strong>Bombeio · ${esc(label(i))}</strong>`+bombeioMisHtml(i,'Cadência MIS · bombeio');
 // Informativo (usuaria, 2026-10-28): a conta usa a cadencia MIS, igual ao BI; colunas 2 e 3 da aba Aberturas so' aparecem.
 if(b.informativo)return `<strong>Bombeio · ${esc(label(i))}</strong>`+bombeioMisHtml(i,'Cadência MIS · bombeio (entra na conta)')
  +`<p><strong>Informado pela base na aba Aberturas · ${fmt(b.efetuado+b.programado)} m³</strong> <small>(só informativo, não entra na conta)</small></p>`
  +`<dl class="viagens"><div><dt>✓ Receb. Efetuado / Disponível · ${fmt(b.efetuado)} m³</dt><dd>o que já aconteceu</dd></div>`
  +`<div><dt>⏳ Receb. Programado Dia · ${fmt(b.programado)} m³</dt><dd>o que ainda vai acontecer</dd></div></dl>`;
 return `<strong>Bombeio · ${esc(label(i))} · aba Aberturas</strong><p>${fmt(b.efetuado+b.programado)} m³ informados pela base (soma das colunas 2 e 3)</p>`
  +`<dl class="viagens"><div><dt>✓ Já recebido · ${fmt(b.efetuado)} m³</dt><dd>Receb. Efetuado / Disponível — o que já aconteceu</dd></div>`
  +`<div><dt>⏳ Ainda vai chegar · ${fmt(b.programado)} m³</dt><dd>Receb. Programado Dia — o que vai acontecer</dd></div></dl>`
  +bombeioMisHtml(i,'Planejado na cadência MIS · referência');}
// Transferencias de entrada que ENTRAM na conta do dia (mesma regra do fresh()): pro popup do dia, ja' que desde
// 2026-10-20 elas somam no Trânsito FOB sem linha nem barra propria.
function transfEntradaContadas(i){
 const entrada=entradaNoDia($('entrada')?.value||'auto',day(i));if(entrada==='cadencia')return [];
 const itens=transferencias(i,'transferenciasEntrada');
 if(filtroStatusAtivo())return itens.filter(t=>{const m=/^T([1-5])/.exec(String(t.statusViagem||''));
  return filtroStatusViagem.has(m?'T'+m[1]:(!t.viagem||t.conta==='naoprog')?'backlog':'sem');});
 return itens.filter(t=>incluiNaoProg(entrada)||(t.conta&&t.conta!=='naoprog'&&emViagemTransf(t)));
}
const dataTransf=iso=>iso?new Date(iso+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}):'—';
function popupTransferencia(campo,i){
 const saida=campo==='transferenciasSaida',itens=transferencias(i,campo);
 const total=itens.reduce((s,t)=>s+(t.volume||0),0);
 return `<strong>Transferência · ${saida?'saída':'entrada'} · ${esc(label(i))}</strong><p>${fmt(total)} m³ ${saida?'saindo desta base para outras bases da rede':'chegando de outras bases da rede'}</p>`
  +`<dl class="viagens">${itens.map(t=>`<div><dt>${saida?'→ '+esc(cidadeBase(t.para)):'← '+esc(cidadeBase(t.de))} · ${fmt(t.volume)} m³${saida?'':emViagemTransf(t)?` · <span style="color:#C4B5FD">${esc(t.statusViagem)}</span>`:' · <span style="color:#F9A8D4">sem status de viagem</span>'}</dt><dd>carregamento ${dataTransf(t.carga)} · descarga ${dataTransf(t.descarga)} · ${esc(t.fonte)}${t.viagem?` · ${esc(t.viagem)}`:''}${t.status?` (${esc(t.status)})`:''}${!saida&&t.conta&&t.conta!=='naoprog'?` · retirada do Trânsito ${t.conta==='cif'?'CIF':'FOB'} para não somar duas vezes`:''}${!saida&&!emViagemTransf(t)&&!incluiNaoProg($('entrada')?.value)?' · <em>sem status de viagem: só entra na conta em "Trânsito real + Não programado" e "LE"</em>':''}</dd></div>`).join('')}</dl>`;
}
function mostrarPopupTransf(el){const pop=$('transf-popover');if(!pop)return;pop.innerHTML=el.dataset.transf==='bombeioPortal'?popupBombeioPortal(+el.dataset.day):popupTransferencia(el.dataset.transf,+el.dataset.day);pop.hidden=false;
 const r=el.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight;pop.style.left=`${Math.min(Math.max(8,r.left+r.width/2-w/2),innerWidth-w-8)}px`;pop.style.top=`${r.bottom+8+h<=innerHeight-8?r.bottom+8:Math.max(8,r.top-h-8)}px`;}
document.addEventListener('pointerover',e=>{const el=e.target.closest?.('#grid [data-transf]');if(el)mostrarPopupTransf(el);});
document.addEventListener('pointerout',e=>{if(e.target.closest?.('#grid [data-transf]')&&$('transf-popover'))$('transf-popover').hidden=true;});
// Aviso de capacidade excedida (pedido da usuaria, 2026-10-14: "se extrapolar a capacidade maxima, aparece
// um recado avisando o porque"). Mesma regua da sugestao de cadencia: fechamento do dia (abertura + entradas
// - vendas) acima da capacidade do tanque, de hoje em diante. Explica o dia, quanto passou e de onde veio
// o volume; marca a celula "Total de entradas" desses dias. Sem capacidade estabelecida, nao avisa.
const NOMES_ENTRADA={fob:'Trânsito FOB',cif:'Trânsito CIF',pump:'Bombeio',planned:'Cadência sugerida',received:'Recebimento adicional',transferIn:'Transferência'};
function avisoCapacidade(result){
 let el=$('aviso-capacidade');
 if(!el){const secao=$('grid').closest('section');el=document.createElement('div');el.id='aviso-capacidade';el.className='aviso-capacidade';el.setAttribute('role','alert');el.hidden=true;secao.querySelector('.table-scroll').before(el);}
 document.querySelectorAll('#grid td.excede-capacidade').forEach(td=>{td.classList.remove('excede-capacidade');td.removeAttribute('title');});
 const cap=capacidadeDoTanque();
 const hoje=Math.max(0,Math.round((new Date(simulationToday()+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000));
 const dias=cap>0?result.map((r,i)=>({r,i})).filter(({r,i})=>i>=hoje&&r.close>cap+1e-6):[];
 if(!dias.length){el.hidden=true;el.innerHTML='';return;}
 const detalhe=({r,i})=>{const partes=Object.entries(NOMES_ENTRADA).map(([k,n])=>[n,state.movements[k]?.[i]||0]).filter(([,v])=>v>0).map(([n,v])=>`${n} ${fmt(v)}`);
  return `abertura ${fmt(r.opening)} + entradas ${fmt(r.incoming)}${partes.length?` (${partes.join(', ')})`:''} − vendas ${fmt(r.outgoing)} = ${fmt(r.close)} m³`;};
 // Causa = dia que estoura COM entrada; os dias seguintes so' carregam o excesso (nao adianta mandar
 // rever entrada onde nao chega nada).
 const causas=dias.filter(d=>d.r.incoming>0),ultimo=dias.at(-1);
 const periodo=dias.length>1?`de ${esc(label(dias[0].i))} a ${esc(label(ultimo.i))}`:`em ${esc(label(dias[0].i))}`;
 el.innerHTML=`<strong>⚠ O estoque passa da capacidade do tanque (${fmt(cap)} m³) ${periodo}.</strong> `
  +(causas.length
   ?causas.slice(0,3).map(d=>`Em ${esc(label(d.i))}: ${detalhe(d)}, ${fmt(d.r.close-cap)} m³ a mais do que cabe.`).join(' ')
    +(causas.length>3?` E em mais ${causas.length-3} dia(s).`:'')
    +` Chega mais produto do que o tanque comporta para a venda prevista: reveja as entradas de ${causas.map(d=>esc(label(d.i))).join(', ')} (FOB, CIF, bombeio ou cadência sugerida).`
   :`A abertura (${fmt(dias[0].r.opening)} m³) já está acima da capacidade: confira a abertura ou a capacidade cadastrada do tanque.`)
  +(dias.length>causas.length&&causas.length?` Nos outros dias o excesso só continua no tanque, até as vendas trazerem o estoque de volta para baixo da capacidade.`:'');
 // Faixa de texto desligada (usuaria, 2026-10-20: "essas mensagens pode desativar"); ficam so' as celulas
 // marcadas, com a mesma explicacao no passar do mouse.
 el.hidden=true;
 // Cinza listrado (usuaria: "um cinza, alguma coisa com aspecto ruim"), pra nao confundir com o vermelho de
 // falta: as entradas do dia que estoura e a abertura do dia seguinte, onde o volume que nao cabe aparece.
 for(const d of dias){const dica=`${label(d.i)}: ${detalhe(d)}. Capacidade do tanque: ${fmt(cap)} m³ (passa ${fmt(d.r.close-cap)} m³).`;
  for(const td of [d.r.incoming>0?document.querySelector(`#grid td[data-result="incoming"][data-day="${d.i}"]`):null,document.querySelector(`#grid td[data-result="opening"][data-day="${d.i+1}"]`)])
   if(td){td.classList.add('excede-capacidade');td.title=dica;}}
}
function capBand(v){const cap=record.capacidadeFisica;if(v==null||!cap)return'';const p=v/cap;return p<0.70?'danger':p<=0.75?'warn':'high';}
// No modo combinado soma o passado de cada registro real por tras da soma (o record sintetico nao tem emp_dep).
const registrosReais=()=>record._registrosCombinados||[record];
function transitoPassado(i,k){const vs=registrosReais().map(r=>D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material]?.[day(i)]?.[k]);return somaOuNula(vs);}
// Recebimento realizado no SAP (planilhas mensais de movimentacao, por data de lancamento) — so' dias
// passados; mesma regra do "Recebimentos realizados" do BI (pedido da usuaria, 2026-10-08).
function recebidoPassado(i){return somaOuNula(registrosReais().map(r=>r.bi?.days?.[day(i)]?.recebidoSap));}
function vendaRealPassado(i){return somaOuNula(registrosReais().map(r=>r.bi?.days?.[day(i)]?.vendaReal));}
// Viagens do portal (detalhe de D.transitoAoVivo) que entram no dia, com o destino = cidade/deposito/
// empresa do registro — pedido da usuaria, 2026-10-09: ver id da viagem, origem e destino tambem nos
// dias passados (o que chegou) e no grafico. Usado pelos popups da grade (cenarios.js) e do grafico.
function viagensDoDia(i,modal){return registrosReais().flatMap(r=>{const ids=idsTransfEntrada(r);return (D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material]?.[day(i)]?.viagens||[]).filter(v=>(!modal||v.modal===modal)&&!ids.has(v.idViagem))
  // Com filtro de Status da viagem, o popup lista so' as viagens do status marcado (usuaria, 2026-10-19) e
  // cada viagem mostra o Status Viagem da Herrlog junto do status do portal.
  .filter(v=>!filtroStatusAtivo()||filtroStatusViagem.has(categoriaViagem(v)))
  .map(v=>({...v,status:v.statusViagem?`${v.status} · ${v.statusViagem}`:v.status,destino:[cidadeDe(r),depositoDe(r),empresaDe(r)].filter(Boolean).join(' · ')}));});}
// Volume FOB do dia que so' esta' nele pela regra das 15h (ETA Herrlog >= 15h -> D+1, inbound.py:
// HORA_CORTE_DESCARGA) — pintado de roxo no grafico e na grade (pedido da usuaria, 2026-10-09).
const COR_FOB_D1='#C084FC';
const COR_NAO_PROG='#7DB9E8';
// Transferencia entre bases no formato de uma linha de viagem (popup unificado do botao LE, 2026-10-21).
// Com viagem no portal, usa a MESMA linha das viagens (origem → destino, transportador, placa, status, km, ETA) com a
// etiqueta "⇄ Transferência" (usuaria, 2026-10-21: "coloca no mesmo bloco, com origem, destino, ETA, as mesmas info").
function viagemDaTransf(t,i){
 if(!t.viagem)return null;
 for(const r of registrosReais()){const porDia=D.transitoAoVivo?.[r.bi?.emp_dep]?.[r.bi?.material]||{};
  for(const iso of [day(i),...Object.keys(porDia)]){const v=(porDia[iso]?.viagens||[]).find(x=>x.idViagem===t.viagem);if(v)return v;}}
 return null;
}
// Cor (usuaria, 2026-10-21): AZUL se a transferencia ja' tem tempos (ETA, chegada ou Status Viagem da Herrlog),
// LARANJA se ainda nao tem. A etiqueta "⇄ Transferencia de..." vai na mesma cor da linha.
// Origem da transferencia = CIDADE + base que esta' transferindo (usuaria, 2026-10-21: "quero saber a cidade de origem,
// qual base esta' transferindo"), no lugar do nome do fornecedor do portal (que pra transferencia e' so' "NEXTA"/"SIM").
function cidadeBase(nome){
 const r=nome&&D.records.find(x=>x.base===nome);if(!r)return nome||'—';
 const cidade=cidadeDe(r),resto=nome.startsWith(cidade+' ')?nome.slice(cidade.length+1):nome;
 return `${cidade} · ${resto}`;
}
const origemTransf=t=>cidadeBase(t.de);
function linhaTransfHtml(t,i){
 const v=viagemDaTransf(t,i),temTempos=Boolean(v?.eta||v?.chegadaReal||v?.statusViagem||t.statusViagem),cor=temTempos?'#60A5FA':'#F97316';
 const origem=origemTransf(t),destino=record?.base||t.para||'—';
 if(v)return linhaViagemHtml({...v,volume:t.volume??v.volume,fornecedor:origem,destino:v.destino||destino})
  .replace(/^<div style="color:[^"]*">/,`<div style="color:${cor}">`).replace('<dt>',`<dt>⇄ Transferência de ${esc(origem)} · `);
 return `<div style="color:${cor}"><dt>⇄ Transferência de ${esc(origem)} · ${t.viagem?`Viagem ${esc(t.viagem)}`:'sem viagem no portal'}</dt><dd>Origem: ${esc(origem)} → Destino: ${esc(destino)}<br>${fmt(t.volume)} m³${t.statusViagem?' · '+esc(t.statusViagem):' · sem status de viagem'}${t.status?' · '+esc(t.status):''} · carregamento ${dataTransf(t.carga)} · descarga ${dataTransf(t.descarga)} · ${esc(t.fonte||'')}</dd></div>`;
}
// FOB nao programado (sem placa) que esta' na conta do dia: so' nos botoes que incluem o nao programado e, com
// filtro de Status da viagem, so' se "Backlog (sem placa)" estiver marcado.
function fobNaoProgramadoDia(i){
 if(i<0||!incluiNaoProg(entradaNoDia($('entrada')?.value||'auto',day(i))))return 0;
 if(filtroStatusAtivo()&&!filtroStatusViagem.has('backlog'))return 0;
 return registrosReais().reduce((s,r)=>s+(fobNaoProgramado(r,day(i))||0),0);
}
function fobAposCorte(i){return somaOuNula(viagensDoDia(i,'fob').filter(v=>v.aposCorte&&v.grupo!=='programado').map(v=>v.volume||0));}
function linhaViagemHtml(v){const prog=v.grupo==='programado',quando=v.chegadaReal?'chegou '+new Date(v.chegadaReal).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):v.eta?'ETA '+new Date(v.eta).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
 return `<div style="color:${prog?'#F97316':v.aposCorte?COR_FOB_D1:'#60A5FA'}"><dt>${prog?'Não programado (sem placa) · ':''}${v.modal==='cif'?'CIF · ':''}Viagem ${esc(v.idViagem||'s/ id')}</dt><dd>Origem: ${esc(v.fornecedor||'—')} → Destino: ${esc(v.destino||'—')}<br>${[v.transportador,v.placa].filter(Boolean).map(esc).join(' · ')}${v.transportador||v.placa?' · ':''}${fmt(v.volume)} m³${v.status?' · '+esc(v.status):''}${v.status==='Em Andamento'&&v.kmRestante!=null?' · '+fmt(v.kmRestante)+' km restantes':''}${quando?' · '+quando:''}${v.aposCorte?` · <strong style="color:${COR_FOB_D1}">ETA após 15h → considerado no dia seguinte</strong>`:''}${v.dataProgramacao?' · programação '+esc(v.dataProgramacao):''}</dd></div>`;}
function vendaRealPassado(i){return history(i)?.sale??somaOuNula(registrosReais().map(r=>r.bi?.days?.[day(i)]?.billing));}
function valorPassado(k,i,result){
 if(k==='opening')return history(i)?.opening??null;
 // Lastro e abertura menos lastro tambem no passado (usuaria, 2026-10-27): o lastro e' o da politica (o mesmo de hoje).
 if(k==='lastro')return result[0]?.lastro??null;
 if(k==='openingNet'){const ab=history(i)?.opening;return ab==null?null:ab-(result[0]?.lastro||0);}
 // Igual ao BI nos dias passados (usuaria, 2026-10-27): saida = venda real (vendas_projecao) e entrada = recebimento
 // realizado do SAP (recebimentos_projecao) — o BI nao usa viagem no passado (finalizada quase nunca tem chegada).
 if(k==='outgoing')return vendaRealPassado(i)??history(i)?.sale??null;
 if(k==='incoming'){const sap=recebidoPassado(i);if(sap!=null)return sap;const f=transitoPassado(i,'fob'),c=transitoPassado(i,'cif');return f==null&&c==null?null:(f||0)+(c||0);}
 if(k==='close'){const prox=i+1===0?result[0]?.opening:history(i+1)?.opening;return prox??null;}
 return null;
}
function status(v){return E.stockBand(v,state);}
// Horario da ultima atualizacao de CADA fonte, embaixo do nome da linha (pedido da usuaria, 2026-10-10:
// "em cada um dos campos o ultimo horario que subiu e sincronizou"). Arquivos: hora em que a extracao
// gravou a planilha (bi.fontesAtualizadas); faturamento/VMD: hora da consulta ao banco (extractedAt);
// transito: hora da ultima atualizacao em tempo real (SIM_TRANSITO_EM, online.js).
const NOME_FONTE={abertura:'planilha de abertura',politica:'Premissas Politica Estoques.xlsx',le:'LE vigente',va05:'SAP VA05 (pedidos)',cadencia:'cadência MIS',dispMis:'Disp. MIS',recebimentos:'SAP movimentações',faturamento:'banco de faturamento (DW)',vmd:'LE + faturamento (reprojeção)',transito:'portal inbound + Herrlog (tempo real)'};
function quandoFmt(valor){if(!valor)return null;const d=new Date(valor);if(isNaN(d))return null;const hm=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});return new Date().toDateString()===d.toDateString()?`hoje ${hm}`:`${d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} ${hm}`;}
function horaFonte(fonte){
 if(!fonte)return'';const f=D.bi?.fontesAtualizadas||{};let quando=null;
 if(fonte==='transito')quando=window.SIM_TRANSITO_EM;
 else if(fonte==='faturamento'||fonte==='vmd'){if(f[fonte==='vmd'?'reprojecaoOk':'faturamentoOk']===false)return `<small class="fonte-hora alerta" title="O banco de faturamento não respondeu na última atualização">⚠ banco sem resposta</small>`;quando=D.bi?.extractedAt;}
 else quando=f[fonte];
 const txt=quandoFmt(quando);if(!txt)return'';
 const nome=fonte==='le'&&f.leNome?`LE vigente (${f.leNome})`:NOME_FONTE[fonte]||fonte;
 return `<small class="fonte-hora" data-fonte="${fonte}" title="Fonte: ${esc(nome)} · atualizada em ${new Date(quando).toLocaleString('pt-BR')}">${txt}${fonte==='transito'?' · tempo real':''}</small>`;}
// Qual fonte alimenta a linha de vendas, conforme o botao de cenario escolhido.
const fonteDaVenda=()=>({VMD:'vmd',LE:'le','Pedidos em tela':'va05',Real:'faturamento','Disp MIS':'dispMis'})[state?.scenario]||null;
function render(rebuild=false){const result=E.calculate(state,n),original=E.calculate(baseline,n);
 $('source').textContent=`Abertura real de ${label(0)}/${D.date.slice(0,4)} • ${record.base} • ${record.product}. Próximos 14 dias preenchidos com o LE vigente, FOB/CIF e programação MIS. Extração: ${D.bi.extractedAt.replace('T',' ')}. Todos os volumes em m³.`;
 $('dia-atual-aviso').textContent=`Hoje: ${new Date(simulationToday()+'T12:00:00').toLocaleDateString('pt-BR')} · abertura de referência: ${label(0)} (última planilha preenchida). Dias anteriores a hoje usam o realizado; hoje e os próximos dias usam pedidos e previsão.`;
 $('provenance').textContent=`Fonte: ${D.source} | Aba: ${record.sheet} | Linha: ${record.row}. Abertura original: ${fmt(record.opening)} m³. Histórico extraído das planilhas diárias, sem edição. Ausência de informação é exibida como “—”.`;
 semanaProgresso();
 const low=Math.min(...result.map(x=>Math.min(x.opening,x.close))),last=result.at(-1).close;
 const first=result.findIndex(x=>['danger','warn'].includes(status(x.opening))||['danger','warn'].includes(status(x.close)));
 $('cards').innerHTML=[['Abertura de referência',fmt(state.opening),'m³ · início do dia'],['Fechamento ao fim de 14 dias',fmt(last),`m³ · diferença de ${fmt(last-original.at(-1).close)} vs. original`],['Menor estoque no período',fmt(low),'m³ · abertura e fechamento'],['Primeira atenção',first<0?'Sem alerta de limite':label(first),first<0?'Verifique os limites e campos não preenchidos':'Confira os pontos de atenção abaixo']].map(([title,value,sub],i)=>`<article class="card"><small>${title}</small><strong class="${i===2?status(low):''}">${value}</strong><em>${sub}</em></article>`).join('');
 const passado=mostrarHistoricoGrade?5:0;const offsets=Array.from({length:passado+n},(_,i)=>i-passado);
 if(rebuild){let html=`<thead><tr><th class="row-controls"><button type="button" id="toggle-historico" title="Mostrar ou ocultar o histórico dos 5 dias anteriores">${mostrarHistoricoGrade?'−':'+'} dias</button> <button type="button" id="toggle-info" title="Mostrar ou ocultar as linhas de referência (em itálico)">${mostrarInfoGrade?'−':'+'} linhas</button> <button type="button" id="toggle-extensao" title="Estender a tabela e o gráfico até o último dia do LE vigente (até 30 dias). Os dias extras só são baixados quando você clica.">${extensaoAtiva?'−':'+'} fim do LE</button></th><th class="row-label">Movimento / m³</th>`+offsets.map(i=>`<th class="${i<0?'history':i===0?'today':''}" data-col-day="${i}">${label(i)}<br><span class="dia-semana">${diaSemana(i)}</span><br><small>${i<0?'Histórico':i===0?'Referência':'Simulação'}</small></th>`).join('')+'</tr></thead><tbody>';
 const outputRow=(key,name,fonte)=>`<tr class="total"><th class="row-controls"></th><th class="row-label">${name}${horaFonte(fonte)}</th>${offsets.map(i=>`<td data-result="${key}" data-day="${i}"></td>`).join('')}</tr>`;
 html+=outputRow('opening','Estoque inicial · abertura','abertura');html+=outputRow('lastro','Lastro mínimo','politica');html+=outputRow('openingNet','Abertura menos lastro');
 // 4 linhas informativas (so' leitura, nao entram no calculo) mostrando as referencias da venda antes
 // da linha editavel que realmente debita do estoque — pedido da usuaria, 2026-09-30: ver as 4 fontes
 // (VMD reprojetada, LE original sem reprojecao, Pedidos em tela = VA05 total do dia/todos os status,
 // faturamento real) fixas, lado a lado com o que foi aplicado (que o usuario escolhe puxar ou digitar).
 // dentroDoGrupo: linha no meio do rowspan da coluna de botoes — nao emite a celula de controle.
 // Recolhidas por padrao, igual ao historico; botao "+ linhas" no canto (pedido da usuaria, 2026-10-09).
 const infoRow=(titulo,getter,dentroDoGrupo=false,fonte=null)=>!mostrarInfoGrade?'':`<tr class="info-row">${dentroDoGrupo?'':'<th class="row-controls"></th>'}<th class="row-label">↳ ${titulo}${horaFonte(fonte)}</th>${offsets.map(i=>`<td class="history${i===0?' today':''}">${fmt(getter(i))}</td>`).join('')}</tr>`;
 // Pedido da usuaria, 2026-10-01: "Recebimento adicional manual" e "Programação adicional manual"
 // tiradas da tabela (ficavam sempre zeradas, so' poluiam a visao). O calculo continua somando o que
 // ja estiver salvo nesses campos (E.rows/motor.js inalterado); so' nao aparecem mais como linha editavel.
 // Coluna de controle (rowspan) pros botoes "Puxar entrada de"/"Puxar vendas de" — pedido da usuaria,
 // 2026-10-02: "chegue um ponto a tabela pra direita e deixe esse botoes aqui na parte de entrada e as
 // saidas mesmo, e eu selecione pelo lado mesmo". A 1a linha de cada grupo (entrada: fob/cif/pump/
 // transferIn; saida: sale/transferOut) recebe um <th rowspan> vazio que o cenarios.js preenche depois
 // (ver #entrada-controls-cell/#scenario-controls-cell); as demais linhas do mesmo grupo nao emitem
 // celula nenhuma nessa coluna, porque o rowspan da 1a linha ja' a ocupa.
 // Sem a linha "Transferência · entrada" (2026-10-20): ela soma no Trânsito FOB.
 const linhasVisiveis=E.rows.filter(([k])=>!['received','transferIn'].includes(k));
 // "Cadência sugerida" (movimento 'planned', voltou a aparecer em 2026-10-12 com outro papel) logo depois
 // do Bombeio, como a linha "Cadencia" da planilha da usuaria; preenchida pelo botao #sugerir-cadencia.
 {const [p]=linhasVisiveis.splice(linhasVisiveis.findIndex(r=>r[0]==='planned'),1);linhasVisiveis.splice(linhasVisiveis.findIndex(r=>r[0]==='pump')+1,0,p);}
 const entradaKeys=linhasVisiveis.filter(([,,sign])=>sign>0).map(([k])=>k);
 const saidaKeys=linhasVisiveis.filter(([,,sign])=>sign<0).map(([k])=>k);
 for(const [k,l,sign] of linhasVisiveis){
  // "+ linhas" so' com as referencias de VENDA, dentro do bloco de Vendas, logo abaixo da linha que debita
  // (usuaria, 2026-10-19: "as entradas nao precisa trazer"). As 4 linhas entram no rowspan dos botoes de venda.
  const INFO_VENDAS=5;
  const controlCell=k===entradaKeys[0]?`<th rowspan="${entradaKeys.length}" class="row-controls" id="entrada-controls-cell"></th>`
   :k===saidaKeys[0]?`<th rowspan="${saidaKeys.length+(mostrarInfoGrade&&saidaKeys[0]==='sale'?INFO_VENDAS:0)}" class="row-controls" id="scenario-controls-cell"></th>`:'';
  const rotulo=(k==='fob'?'Trânsito FOB · programado (com placa)':k==='planned'?'Cadência sugerida':l)+horaFonte({fob:'transito',cif:'transito',pump:'cadencia',sale:fonteDaVenda()}[k]);
  html+=`<tr class="${sign>0?'entry':'exit'}">${controlCell}<th class="row-label">${sign>0?'+':'−'} ${rotulo}</th>`+offsets.map(i=>i<0?`<td class="history${i===0?' today':''}"${['fob','cif'].includes(k)?` data-transito="${k}" data-day="${i}"`:''} title="${k==='sale'?'Venda real do dia (faturamento), igual ao BI':['fob','cif'].includes(k)?'':'Informação histórica da fonte'}">${fmt(['fob','cif'].includes(k)?transitoPassado(i,k):k==='planned'?null:k==='sale'?(vendaRealPassado(i)??history(i)?.sale):history(i)?.[k])}</td>`:`<td class="${i===0?'today':''}"><input type="number" step="any" min="0" data-row="${k}" data-day="${i}" aria-label="${l} ${label(i)}" value="${Math.round(state.movements[k][i])}" title="${esc(sourceNote(k,i))}"></td>`).join('')+'</tr>';
  if(k==='sale'){
   html+=infoRow('VMD reprojetada',i=>record.bi?.days[day(i)]?.vmd,true,'vmd');
   html+=infoRow('LE vigente (sem reprojeção)',i=>record.bi?.days?.[day(i)]?.le??record.bi?.semana?.porDia?.[day(i)]?.le,true,'le');
   html+=infoRow('Pedidos em tela',i=>record.bi?.days[day(i)]?.billing,true,'va05');
   // Disp. MIS do dia (usuaria, 2026-10-27: "retroativo de VMD / disp / venda real"), tambem nos 5 dias passados.
   html+=infoRow('Disp. MIS',i=>somaOuNula(registrosReais().map(r=>r.bi?.days?.[day(i)]?.scenarios?.['Disp MIS']?.availability)),true,'dispMis');
   // Mesma venda real do botao "Real" (deposito; passado = faturamento, hoje = VA05 do dia).
   html+=infoRow('Real',i=>{const d=record.bi?.days?.[day(i)];return d&&'vendaReal' in d?d.vendaReal:record.bi?.semana?.porDia?.[day(i)]?.real;},true,'faturamento');
  } }
 for(const [k,l] of [['incoming','Total de entradas'],['outgoing','Total de saídas']])html+=outputRow(k,l);
 $('grid').innerHTML=html+'</tbody>';}
 // Celula de abertura (dia 0) ganha um aviso visual quando a leitura nao e' de hoje — pedido da
 // usuaria, 2026-10-05: "mostra a ultima data que puxou... uma cor diferente pra mostrar que nao e'
 // a do dia". O detalhe de qual base exatamente (no combinado) fica no popup, ao passar o mouse/clicar.
 document.querySelectorAll('[data-result]').forEach(td=>{const i=+td.dataset.day,k=td.dataset.result;const v=i<0?valorPassado(k,i,result):result[i][k];const ehAbertura=k==='opening'&&i===0,dias=ehAbertura?diasAtrasoAbertura():0;td.textContent=(dias>0?'⚠ ':'')+fmt(v);td.className=(i<0?'history ': '')+(i===0?'today ':'')+(dias>0?(dias>=DIAS_ABERTURA_GRAVE?'atrasada-grave ':'atrasada '):'')+(k==='opening'?capBand(v):(['close','available'].includes(k)?(v==null?'':status(v)):''));});
 // Borda roxa no FOB que tem volume empurrado pra D+1 pela regra das 15h (detalhe no popup da celula).
 // Borda roxa do D+1 na celula saiu em 2026-10-21 (so' o aviso no popup).
 document.querySelectorAll('[data-row="fob"]').forEach(input=>{const i=+input.dataset.day;input.parentElement.classList.remove('fob-d1');
  // No "Tudo": borda amarela tracejada no FOB do dia que tem cadencia MIS que ainda nao virou viagem (usuaria,
  // 2026-10-19: "so' pra realmente o analista saber").
  const mis=cadenciaAmbar(i);
  input.parentElement.classList.toggle('fob-cadencia',mis>0);
  if(mis>0)input.title=`Inclui ${fmt(mis)} m³ de cadência do MIS (só planejamento, ainda sem viagem no portal).`;});
 document.querySelectorAll('[data-row]').forEach(input=>input.parentElement.classList.toggle('edited',state.movements[input.dataset.row][+input.dataset.day]!==baseline.movements[input.dataset.row][+input.dataset.day]));
 document.querySelectorAll('[data-row="planned"]').forEach(input=>{const aviso=avisosSugestao[+input.dataset.day];input.parentElement.classList.toggle('sugestao-nao-cabe',Boolean(aviso));if(aviso)input.title=`O estoque fica abaixo ${aviso.motivo||`de ${Math.round(GATILHO_SUGESTAO*100)}% do tanque`} neste dia (${fmt(aviso.semSugestao)} m³), mas uma carga de ${CARGA_SUGESTAO} m³ não cabe${aviso.limite?' '+aviso.limite:''}${aviso.diaLimite>+input.dataset.day?' por causa da entrada já prevista em '+label(aviso.diaLimite):''}.`;});
 // Grafico com os MESMOS dias da tabela (o botao "+ dias" vale pros dois), pra ficar no mesmo eixo x.
 chart(result,original,offsets);alerts(result);avisoCapacidade(result);marcarTransferencias();
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
// Series de movimento. Dias passados (i<0), igual ao grafico do BI (pedido da usuaria, 2026-10-08):
// Recebimentos = realizado no SAP, FOB/CIF = o que chegou pelo portal; as linhas de venda mostram o real.
const movSeries=[
 ['received','Recebimentos','#C8F2EC',i=>i>=0?state.movements.received[i]:recebidoPassado(i)],
 ['pump','Prog. Bombeio','#9EDFD6',i=>i>=0?state.movements.pump[i]:null],
 // Prog. Rodoviario so' no grafico (nao entra na conta); tira o que ja' virou "Transferencia · entrada"
 // (2026-10-15), senao a mesma carga aparece duas vezes na barra.
 // Idem com o FOB sem placa (2026-10-16): o Rodoviario ja' inclui essas viagens; na origem "Programado + Nao
 // programado" elas entram no FOB e a barra mostrava 60 + 60 com so' 60 na conta.
 // Em "Cadencia MIS" o FOB/CIF da tabela ja' e' a propria cadencia (rodoviaria inclusa): o bloco nao aparece.
 // 2026-10-19 (usuaria: "se esta em transito real, por que colocou esse em amarelo? nao tem logica"): o grafico
 // mostra so' o que entra na conta. Rodoviario e cadencia MIS sem viagem nao contam em nenhum botao exceto
 // "Tudo" — e no "Tudo" a cadencia entra dentro do FOB (pedaco com borda ambar tracejada, ver chart()).
 ['progRoad','Prog. Rodoviário','#7FC4BA',i=>{if(true)return null;if(i<0||$('entrada')?.value==='cadencia')return null;const v=record.bi?.days[day(i)]?.progRoad;if(v==null)return null;
  // Transferencia planejada sempre sai do Rodoviario: ela tem bloco proprio (rosa), contando ou nao.
  const tudo=incluiNaoProg($('entrada')?.value);
  const naoProg=tudo?(somaOuNula(registrosReais().map(r=>fobNaoProgramado(r,day(i))))||0):0;
  const total=Math.max(0,v-transfPlanejadaDia(i)-naoProg);
  // So' a parte que ja' tem viagem no portal (sem placa); o resto e' cadencia MIS sem viagem (bloco abaixo).
  return tudo?0:Math.min(total,somaOuNula(registrosReais().map(r=>fobNaoProgramado(r,day(i))))||0);}],
 // Cadencia rodoviaria do MIS que ainda nao virou viagem no portal (usuaria, 2026-10-19: "deixa uma borda com
 // uma cor diferente, tipo cadencia nao programada ainda"). Informativo: nao entra na conta em nenhum botao.
 ['progRoadMis','Cadência MIS · sem viagem no portal','#7FC4BA',i=>{if(true)return null;if(i<0||['cadencia','auto+tudo'].includes($('entrada')?.value))return null;const v=record.bi?.days[day(i)]?.progRoad;if(v==null)return null;
  const naoProg=somaOuNula(registrosReais().map(r=>fobNaoProgramado(r,day(i))))||0;
  return Math.max(0,v-transfPlanejadaDia(i)-naoProg);}],
 // Transferencia de entrada nao tem mais barra propria (roxo/rosa ate' 2026-10-20): soma no Trânsito FOB (cinza)
 // e aparece destacada no popup do dia.
 ['planned','Cadência sugerida','#A3E635',i=>i>=0?state.movements.planned[i]:null],
 // Passado igual a tabela e ao BI: com recebimento do SAP no dia, o transito nao entra de novo (senao soma duas vezes).
 ['fob','Trânsito FOB','#B0B0B0',i=>i>=0?state.movements.fob[i]:recebidoPassado(i)!=null?null:transitoPassado(i,'fob')],
 ['cif','Trânsito CIF','#F4F08A',i=>i>=0?state.movements.cif[i]:recebidoPassado(i)!=null?null:transitoPassado(i,'cif')],
 // Linhas de venda/Disp. MIS tambem nos 5 dias passados, como no grafico do BI (usuaria, 2026-10-27).
 ['vmd','VMD reprojetada','#FFFFFF',i=>record.bi?.days?.[day(i)]?.vmd??null],
 ['plannedSales','Vendas Planejadas','#D9F99D',i=>{const d=record.bi?.days?.[day(i)];return d?.scenarios?.LE?.plannedSales??(i<0?d?.le??record.bi?.semana?.porDia?.[day(i)]?.le:null)??null;}],
 ['actualSales','Vendas Real','#C8C8C8',i=>i>=0?(record.bi?.days[day(i)]?.scenarios?.Real?.actualSales??null):vendaRealPassado(i)],
 ['availability','Disp. MIS','#39FF14',i=>i>=0?(record.bi?.days[day(i)]?.scenarios?.['Disp MIS']?.availability??null):somaOuNula(registrosReais().map(r=>r.bi?.days?.[day(i)]?.scenarios?.['Disp MIS']?.availability))],
];
// Entradas viram blocos empilhados sobre a abertura (igual ao grafico do BI); as demais series seguem em linha.
const ENTRADAS_BLOCO=['received','pump','progRoad','progRoadMis','planned','fob','cif'];
const valorMov=(k,i)=>(movSeries.find(m=>m[0]===k)[3](i))||0;
const aberturaGrafico=(result,i)=>i<0?history(i)?.opening:result[i]?.opening;
const topoPilha=(result,i)=>Math.max(aberturaGrafico(result,i)??0,0)+ENTRADAS_BLOCO.reduce((s,k)=>s+Math.max(valorMov(k,i),0),0);
let chartContext=null;
// Os 5 dias passados e as linhas de referencia (VMD, LE, Pedidos, Disp. MIS, Real) abrem RECOLHIDOS, igual ao
// "+ fim do LE" (usuaria, 2026-10-28: "como padrao ... os botoes todos fechados"); antes abriam visiveis (27/10).
let mostrarHistoricoGrade=false;
let mostrarInfoGrade=false;
document.addEventListener('click',e=>{if(e.target.closest('#toggle-historico')){mostrarHistoricoGrade=!mostrarHistoricoGrade;render(true);}if(e.target.closest('#toggle-info')){mostrarInfoGrade=!mostrarInfoGrade;render(true);}if(e.target.closest('#toggle-extensao'))alternarExtensao();});
// Grafico no formato do Power BI (pedido da usuaria, 2026-10-09: "deixar + parecido o grafico de barras"):
// barra larga empilhada = Lastro (faixa laranja na base) + Abertura − Lastro + entradas do dia (Recebimentos,
// Bombeio, Rodoviario, FOB, CIF), rotulo dentro de cada pedaco, mesma cor em todos os dias; linhas de venda,
// Disp. MIS por cima; eixo com dia da semana em cima e data embaixo.
// Escala comeca no zero: estoque negativo nao aparece no grafico (2026-10-09); o valor continua na tabela.
const COR_LASTRO='#F9B96B',COR_ABERTURA='#3AAE9C',COR_FUNDO_TRANSF='#B0B0B0';
// Eixo x da grade (pedido da usuaria, 2026-10-14: "a tabela com o dia abaixo do grafico, no mesmo eixo x"):
// cada barra fica em cima da coluna do mesmo dia na tabela logo abaixo. Mede as colunas de verdade (a
// largura muda com a tela e com a rolagem horizontal) e converte pra unidade do viewBox; sem grade
// visivel (tela ainda escondida), devolve null e o grafico usa o espacamento uniforme de antes.
function eixoDaGrade(offsets,W){
 const box=$('chart')?.getBoundingClientRect();if(!box?.width)return null;
 const k=W/box.width,cols={};
 for(const th of document.querySelectorAll('#grid thead th[data-col-day]')){const r=th.getBoundingClientRect();cols[+th.dataset.colDay]={c:(r.left+r.width/2-box.left)*k,w:r.width*k};}
 if(!offsets.every(i=>cols[i]?.w>0))return null;
 const rotulos=document.querySelector('#grid thead th.row-label')?.getBoundingClientRect();
 const primeira=cols[offsets[0]];
 return {x:i=>cols[i].c,cw:primeira.w,L:rotulos?.width?(rotulos.right-box.left)*k:primeira.c-primeira.w/2};
}
function chart(result,original,offsets){
 chartContext={result,original,offsets};
 // Altura acompanha a largura da tela (style.css: height:auto) — ocupa a tela toda (usuaria, 2026-10-09).
 const W=1200,H=320,R=12,T=16,B=36;
 const eixo=eixoDaGrade(offsets,W);
 const L=eixo?eixo.L:50,cw=eixo?eixo.cw:(W-L-R)/offsets.length,bw=cw*.78,x=eixo?eixo.x:(i=>L+(i-offsets[0]+.5)*cw);
 const fim=eixo?Math.min(W,x(offsets.at(-1))+cw/2):W-R;
 const lastro=Math.max(state.lastro??0,0);
 const movValores=movSeries.flatMap(([,,,f])=>offsets.map(f)).filter(v=>v!=null);
 // Sem linha de fechamento/cenario original (usuaria, 2026-10-09: "n precisa disso"): escala so' pelas barras e linhas.
 const values=result.map(x=>x.opening).concat(offsets.map(i=>topoPilha(result,i)),
  parameters.slice(1).map(([k])=>state[k]).filter(v=>v!==null),movValores,[0]);
 const hi=Math.max(...values),span=Math.max(hi,1);
 const y=v=>T+(hi+span*.1-Math.max(v,0))/(span*1.2)*(H-T-B);
 const today=simulationToday();
 // Recorte na borda das colunas fixas de rotulo: com rolagem horizontal (tela estreita), os dias que
 // passam por baixo dos rotulos da tabela tambem somem do grafico.
 let fundo=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histórico de abertura e projeção de estoque em metros cúbicos"><clipPath id="chart-recorte"><rect x="${L}" y="0" width="${Math.max(0,W-L)}" height="${H}"/></clipPath><rect x="${L}" y="0" width="${Math.max(0,x(0)-L-cw/2)}" height="${H-B}" fill="#ffffff04"/>`;
 for(let j=0;j<5;j++){const v=hi*j/4;fundo+=`<path d="M${L} ${y(v)}H${fim}" stroke="#314A32"/><text x="${L-8}" y="${y(v)+4}" fill="#7FA069" text-anchor="end" font-size="11">${fmt(v)}</text>`;}
 const hojeI=offsets.find(i=>day(i)===today);
 if(hojeI!=null)fundo+=`<rect x="${x(hojeI)-cw/2}" y="0" width="${cw}" height="${H-B}" fill="#EEFE7A" opacity=".08"><title>Hoje</title></rect>`;
 // Barras empilhadas + rotulos (caixinha clara no meio de cada pedaco com altura suficiente).
 let barras='',rot='';
 const rotulo=(cx,cy,valor,cor='#14210F')=>{const t=fmt(valor),w=Math.max(24,t.length*7+8);return `<rect x="${cx-w/2}" y="${cy-8.5}" width="${w}" height="17" rx="4" fill="#EAF6E8" opacity=".92"/><text x="${cx}" y="${cy+4}" text-anchor="middle" fill="${cor}" font-size="11" font-weight="700">${t}</text>`;};
 for(const i of offsets){
  const ab=aberturaGrafico(result,i);
  const pedacos=[];
  if(ab!=null){const pos=Math.max(ab,0),l=Math.min(lastro,pos);pedacos.push(['Lastro mínimo',l,COR_LASTRO,false],['Abertura − lastro',pos-l,COR_ABERTURA,true]);}
  for(const k of ENTRADAS_BLOCO){
   const [,nome,cor,valorEm]=movSeries.find(m=>m[0]===k),v=Math.max(valorEm(i)||0,0);
   // FOB empurrado pra D+1 pela regra das 15h: sem pedaco roxo desde 2026-10-21 (usuaria: "a corzinha em roxo
   // pode tirar, deixa so' o indicativo no popup") — o aviso continua na lista de viagens do popup.
   const d1=0;
   // Transferencia: fundo cinza igual ao FOB e a cor (roxo em viagem / rosa sem status) so' na borda
   // (usuaria, 2026-10-17: "coloca o fundo cinza mesmo da barrinha, so coloca a borda de outra cor").
   // No "Tudo", a parte do FOB que e' cadencia MIS sem viagem no portal fica num pedaco proprio (cinza, borda
   // ambar tracejada): conta, mas ainda e' so' planejamento.
   const misFob=k==='fob'?Math.min(Math.max(v-d1,0),cadenciaAmbar(i)):0;
   // Nao programado (viagens do portal sem placa) em azul claro, separado do FOB com placa (usuaria, 2026-10-21:
   // "na visao LE / programado e nao programado, coloca essa outra cor + azul pra falar que nao ta programado").
   const npFob=k==='fob'?Math.min(Math.max(v-d1-misFob,0),fobNaoProgramadoDia(i)):0;
   pedacos.push([nome,v-d1-misFob-npFob,cor,true,k.startsWith('transferIn'),false]);
   if(npFob>0)pedacos.push(['Trânsito FOB · não programado (sem placa)',npFob,COR_NAO_PROG,true,false,false]);
   if(misFob>0)pedacos.push(['Trânsito FOB · cadência MIS (planejamento)',misFob,cor,true,false,true]);
   if(d1>0)pedacos.push(['Trânsito FOB · ETA após 15h do dia anterior (D+1)',d1,COR_FOB_D1,true]);
  }
  let cum=0;
  for(const [nome,v,cor,comRotulo,borda,tracejado] of pedacos){
   if(v<=0)continue;
   const topo=y(cum+v),alt=Math.max(1,y(cum)-topo);
   // Borda por dentro do pedaco (recuo de meio traco) pra nao invadir o bloco vizinho.
   const sw=borda&&alt>=4?2.5:0;
   // Fecha o <rect> nos dois casos (2026-10-19: o da borda ficava aberto e "engolia" o resto do grafico —
   // barras dos dias seguintes, rotulos e linhas da politica sumiam a partir da 1a transferencia).
   const dica=`<title>${label(i)} · ${nome}: ${fmt(v)} m³${nome==='Abertura − lastro'?` (abertura ${fmt(ab)} m³)`:''}</title>`;
   // Cadencia MIS sem viagem no portal: mesma cor do Rodoviario, com borda ambar tracejada.
   if(tracejado&&alt>=4){barras+=`<rect x="${x(i)-bw/2+1}" y="${topo+1}" width="${bw-2}" height="${alt-2}" fill="${cor}" stroke="#FBBF24" stroke-width="2" stroke-dasharray="5 3">${dica}</rect>`;if(comRotulo&&alt>=18)rot+=rotulo(x(i),topo+alt/2,v);cum+=v;continue;}
   barras+=sw?`<rect x="${x(i)-bw/2+sw/2}" y="${topo+sw/2}" width="${bw-sw}" height="${alt-sw}" fill="${COR_FUNDO_TRANSF}" stroke="${cor}" stroke-width="${sw}">${dica}</rect>`
    :`<rect x="${x(i)-bw/2}" y="${topo}" width="${bw}" height="${alt}" fill="${borda?COR_FUNDO_TRANSF:cor}">${dica}</rect>`;
   if(comRotulo&&alt>=18)rot+=rotulo(x(i),topo+alt/2,v);
   cum+=v;
  }
  // Abertura negativa: nem barra nem rotulo (usuaria, 2026-10-09: "o que for negativo, nao precisa mostrar").
  const ehHoje=day(i)===today;
  barras+=`<text x="${x(i)}" y="${H-20}" text-anchor="middle" fill="${ehHoje?'#EEFE7A':'#BFD4A8'}" font-size="11" font-weight="${ehHoje?'700':'400'}">${diaSemana(i)}</text><text x="${x(i)}" y="${H-6}" text-anchor="middle" fill="${ehHoje?'#EEFE7A':'#7FA069'}" font-size="10" font-weight="${ehHoje?'700':'400'}">${label(i)}</text>`;
 }
 // Linhas de politica (sem o lastro, que ja' e' a faixa laranja da barra).
 let politica='';
 for(const [k,cor,traco,nome] of [['min','#FF4D4D','3 4','Estoque mínimo'],['mid','#9CA3AF','3 4','Estoque médio'],['max','#4CAF1F','3 4','Estoque máximo'],['capacity','#38BDF8','','Capacidade']])if(state[k]!==null)politica+=`<path d="M${L} ${y(state[k])}H${fim}" stroke="${cor}" stroke-width="${k==='capacity'?2:1.5}" stroke-dasharray="${traco}"><title>${nome}: ${fmt(state[k])} m³</title></path>`;
 // Linhas de venda/Disp. MIS por cima das barras.
 let linhas='';
 for(const [,nome,cor,valorEm] of movSeries.filter(m=>!ENTRADAS_BLOCO.includes(m[0]))){const pontos=offsets.map(i=>[i,valorEm(i)]).filter(([,v])=>v!=null);if(!pontos.length)continue;linhas+=`<polyline points="${pontos.map(([i,v])=>`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${cor}" stroke-width="2"/>`;for(const [i,v] of pontos)linhas+=`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${cor}"><title>${label(i)} · ${nome}: ${fmt(v)} m³</title></circle>`;}
 // Area invisivel por dia, por cima de tudo, pra abrir o popup com o detalhamento completo do dia.
 let alvos='';
 for(const i of offsets)alvos+=`<rect x="${x(i)-cw/2}" y="0" width="${cw}" height="${H-B}" fill="transparent" data-chart-day="${i}" tabindex="0" aria-label="Detalhes de ${esc(label(i))}"/>`;
 $('chart').innerHTML=fundo+`<g clip-path="url(#chart-recorte)">`+barras+politica+linhas+rot+alvos+'</g></svg>';
}
// Redesenha o grafico quando as colunas da tabela mudam de lugar (janela redimensionada, tabela rolada
// na horizontal, tela que acabou de aparecer depois do login), pra manter o mesmo eixo x.
let redesenhoGrafico=0;
function redesenharGrafico(){if(redesenhoGrafico||!chartContext)return;redesenhoGrafico=requestAnimationFrame(()=>{redesenhoGrafico=0;const {result,original,offsets}=chartContext;chart(result,original,offsets);});}
window.addEventListener('resize',redesenharGrafico);
document.addEventListener('scroll',e=>{if(e.target?.classList?.contains('table-scroll'))redesenharGrafico();},true);
if(window.ResizeObserver&&$('grid'))new ResizeObserver(redesenharGrafico).observe($('grid'));
function popupGrafico(i){
 const {result,offsets}=chartContext||{};if(!result)return'';
 const futuro=i>=0;
 const linhas=[];
 linhas.push(['Abertura',futuro?result[i]?.opening:history(i)?.opening]);
 // Passado: fechamento = abertura do dia seguinte e totais iguais aos da tabela (usuaria, 2026-10-27).
 linhas.push(['Fechamento',futuro?result[i]?.close:valorPassado('close',i,result)]);
 if(!futuro)linhas.push(['Total de entradas (realizado)',valorPassado('incoming',i,result)]);
 linhas.push([futuro?'Vendas aplicada (debita)':'Venda real (debita)',futuro?state.movements.sale[i]:valorPassado('outgoing',i,result)]);
 for(const [,nome,,valorEm] of movSeries){const v=valorEm(i);if(v!=null)linhas.push([nome,v]);}
 const semanaDia=record.bi?.semana?.porDia?.[day(i)],depositoDia=record.bi?.semanaPorDeposito?.porDia?.[day(i)];
 let semanaHtml='';
 if(semanaDia||depositoDia){
  const linha=(titulo,d)=>d?`<div><dt>${esc(titulo)}</dt><dd>${fmt(d.real)} de ${fmt(d.le)} m³ (${d.le?Math.round(d.real/d.le*100):0}%)</dd></div>`:'';
  semanaHtml=`<p><strong>LE da semana · já realizado</strong></p><dl>${linha('Cidade (consolidado)',semanaDia)}${linha('Este depósito',depositoDia)}</dl>`;
 }
 // Politica de estoque no popup (pedido da usuaria, 2026-10-16): mesmos valores das linhas tracejadas do grafico.
 const politicaPopup=[['Lastro mínimo','lastro'],['Estoque mínimo','min'],['Estoque médio','mid'],['Estoque máximo','max'],['Capacidade','capacity']].filter(([,k])=>state[k]!=null);
 const politicaHtml=politicaPopup.length?`<p><strong>Política de estoque</strong></p><dl class="valores">${politicaPopup.map(([n,k])=>`<div><dt>${esc(n)}</dt><dd>${fmt(state[k])} m³</dd></div>`).join('')}</dl>`:'';
 const viagens=viagensDoDia(i).filter(v=>v.grupo!=='programado');
 // No botao LE as transferencias entram no MESMO bloco das viagens (usuaria, 2026-10-21: "unificar as
 // transferencias junto, no mesmo bloco, nao separe"); nos outros botoes continuam na secao propria.
 // Transferencias no MESMO bloco das viagens em todos os botoes (2026-10-21).
 const unificaTransf=futuro,transfJunto=unificaTransf?transfEntradaContadas(i):[];
 const nViagens=viagens.length+transfJunto.length;
 const viagensHtml=nViagens?`<p><strong>Viagens ${day(i)>=simulationToday()?'previstas':'que chegaram'} (${nViagens})</strong></p><dl class="viagens">${viagens.map(linhaViagemHtml).join('')}${transfJunto.map(t=>linhaTransfHtml(t,i)).join('')}</dl>`:'';
 // Viagens nao programadas (sem placa) do dia, quando entram na conta (2026-10-21: "o popup do nao programado
 // aparecer aqui pra mim tbm").
 const naoProg=futuro&&fobNaoProgramadoDia(i)>0?viagensDoDia(i,'fob').filter(v=>v.grupo==='programado'):[];
 const naoProgHtml=naoProg.length?`<p><strong style="color:#F97316">Não programado · sem placa (${naoProg.length} · ${fmt(naoProg.reduce((s,v)=>s+(v.volume||0),0))} m³)</strong></p><dl class="viagens">${naoProg.map(linhaViagemHtml).join('')}</dl>`:'';
 const transf=futuro&&!unificaTransf?transfEntradaContadas(i):[];
 const transfHtml=transf.length?`<p><strong style="color:#C4B5FD">⇄ Transferências entre bases · já somadas no Trânsito FOB (${fmt(transf.reduce((s,t)=>s+(t.volume||0),0))} m³)</strong></p><dl class="viagens">${transf.map(t=>`<div><dt><span style="color:#C4B5FD">← ${esc(t.de||'—')}</span> · ${fmt(t.volume)} m³${t.statusViagem?` · ${esc(t.statusViagem)}`:' · sem status de viagem'}</dt><dd>carregamento ${dataTransf(t.carga)} · descarga ${dataTransf(t.descarga)} · ${esc(t.fonte)}${t.viagem?` · ${esc(t.viagem)}`:''}${t.status?` (${esc(t.status)})`:''}</dd></div>`).join('')}</dl>`:'';
 return `<strong>${esc(label(i))} · ${esc(record.base)} · ${esc(record.product)}</strong><dl class="valores">${linhas.map(([n,v])=>`<div><dt>${esc(n)}</dt><dd>${v==null?'Sem dado':fmt(v)+' m³'}</dd></div>`).join('')}</dl>${politicaHtml}${viagensHtml}${naoProgHtml}${transfHtml}${futuro&&state.movements.pump[i]>0?bombeioMisHtml(i,'Bombeio · origem (cadência MIS)'):''}${semanaHtml}`;
}
function mostrarPopupGrafico(el){
 const i=+el.dataset.chartDay,popup=$('chart-popover');
 const fixado=diaFixadoGrafico===i;
 popup.innerHTML=(fixado?'<p class="aviso-fixado">Selecione o texto para copiar · clique no mesmo dia, fora do gráfico ou Esc para fechar</p>':'')+popupGrafico(i);
 popup.classList.toggle('fixado',fixado);popup.hidden=false;
 const rect=el.getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight;
 // Abre AO LADO da coluna do dia (direita, ou esquerda se nao couber) e sempre inteiro dentro da tela —
 // abrindo embaixo, o popup passava do fim da janela e cortava as viagens (2026-10-09).
 const direita=rect.right+8,esquerda=rect.left-width-8;
 popup.style.left=(direita+width<=innerWidth-8?direita:Math.max(8,esquerda))+'px';
 popup.style.top=Math.max(8,Math.min(rect.top,innerHeight-height-8))+'px';
}
// Popup FIXO ao clicar (pedido da usuaria, 2026-10-16): passar o mouse so' mostra; clicar num dia fixa o popup
// (nao some ao tirar o mouse nem troca ao passar por outro dia). Clicar no mesmo dia, fora do grafico/popup ou
// apertar Esc solta. Clicar em outro dia fixa o outro.
let diaFixadoGrafico=null;
function fecharPopupGrafico(){diaFixadoGrafico=null;$('chart-popover').classList.remove('fixado');$('chart-popover').hidden=true;}
// So' abre ao CLICAR (usuaria, 2026-10-20: "so' aparecer quando clica, ao inves de quando passa o mouse"); pelo
// teclado, Enter/Espaco no dia focado faz o mesmo.
document.addEventListener('keydown',e=>{const el=e.target.closest?.('[data-chart-day]');if(!el||!['Enter',' '].includes(e.key))return;e.preventDefault();
 const i=+el.dataset.chartDay;if(diaFixadoGrafico===i){fecharPopupGrafico();return;}diaFixadoGrafico=i;mostrarPopupGrafico(el);});
document.addEventListener('pointerdown',e=>{
 const el=e.target.closest('[data-chart-day]');
 if(el){const i=+el.dataset.chartDay;if(diaFixadoGrafico===i){fecharPopupGrafico();return;}diaFixadoGrafico=i;mostrarPopupGrafico(el);}
 else if(!$('chart-popover').contains(e.target))fecharPopupGrafico();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&diaFixadoGrafico!==null)fecharPopupGrafico();});
function alerts(result){const items=['O histórico de vendas realizadas não é carregado nesta versão; as vendas futuras usam o LE vigente e, hoje, o maior entre o LE e os pedidos do SAP.',`Valores futuros carregados das fontes (${D.bi.extractedAt.replace('T',' ')}). Portal carregado até ${D.bi.coverage.portal_max.slice(0,10)}; cadências MIS até ${D.bi.coverage.cadencia_max.slice(0,10)}.`];if(parameters.slice(1).some(([k])=>state[k]===null))items.push('A planilha de política tem campos vazios neste recorte; os alertas correspondentes estão indisponíveis.');result.forEach((r,i)=>{const low=Math.min(r.opening,r.close),high=Math.max(r.opening,r.close),a=[];if(low<0)a.push(`déficit físico de ${fmt(-low)} m³`);if(state.lastro!==null&&low<state.lastro)a.push('estoque abaixo do lastro');if(state.min!==null&&low<=state.min)a.push(`no mínimo ou abaixo em ${fmt(state.min-low)} m³`);if(state.capacity>0&&high>state.capacity)a.push(`capacidade excedida em ${fmt(high-state.capacity)} m³`);else if(state.max!==null&&high>state.max)a.push('acima do estoque máximo');if(a.length)items.push(label(i)+': '+a.join(' • '));});$('alerts').innerHTML=items.map(s=>`<div class="alert">${esc(s)}</div>`).join('');}
// Selecionar pelo <select> nativo sempre colapsa pra 1 so' (troca o Set inteiro) — e' a ferramenta de
// "escolher so' esse"; os chips (abaixo) sao quem permite ligar varios ao mesmo tempo sem perder os
// outros ja ativos.
$('cidade').onchange=()=>{depositosAtivos=new Set();empresasAtivas=new Set();refreshDepositoOptions();products();};
$('deposito').onchange=()=>{depositosAtivos=$('deposito').value?new Set([$('deposito').value]):new Set();refreshEmpresaOptions();products();};
$('empresa').onchange=()=>{empresasAtivas=$('empresa').value?new Set([$('empresa').value]):new Set();products();};
$('product').onchange=select;
$('grid').oninput=e=>{const input=e.target,k=input.dataset.row;if(!k)return;if(k==='planned')delete avisosSugestao[+input.dataset.day];if(!input.validity.valid||input.value===''||!Number.isFinite(input.valueAsNumber))return;try{E.setMovement(state,k,+input.dataset.day,input.valueAsNumber);}catch(err){message(err.message);input.value=Math.round(state.movements[k][+input.dataset.day]);return;}persist();render();};
$('grid').addEventListener('focusout',e=>{const input=e.target;if(input.dataset.row)input.value=Math.round(state.movements[input.dataset.row][+input.dataset.day]);});
$('clamp').onchange=()=>{state.clamp=$('clamp').checked;persist();render();};$('name').onchange=()=>{state.name=$('name').value;persist();};
// Pedido da usuaria, 2026-10-02: tirar da tela os botoes "Restaurar dados da fonte"/"Exportar CSV"/
// "Salvar cenario JSON"/"Abrir cenario" (topo). "Restaurar" continua disponivel via #reset-tabela (↺
// Restaurar, junto da tabela) — mesma acao, so' que exposta num unico lugar agora. Exportar CSV/Salvar
// JSON/Abrir cenario (arquivo local) nao tem mais botao na tela; o Firebase ("Salvar na equipe") segue
// disponivel pra compartilhar cenarios com a equipe.
function restaurarDaFonte(){avisosSugestao={};$('entrada').value='auto';if(modoCombinado){const registros=registrosAtuais().filter(r=>r.product===$('product').value);const {baseline:combinada,openingSomado}=freshCombinado(registros);record=construirRegistroCombinado(registros,openingSomado);baseline=combinada;}else baseline=fresh(record);state=structuredClone(baseline);persist();premises();render(true);message('Recorte restaurado aos dados da fonte (origem da entrada voltou para Trânsito real).');}
$('entrada').onchange=()=>{persist();select();};
$('reset-tabela').onclick=restaurarDaFonte;
// Sugestao de cadencia (pedido da usuaria, 2026-10-12, a partir de uma planilha dela): preenche a linha
// "Cadência sugerida" de amanha em diante com o que o motor (sugestao.js) calcular. Gatilho e teto pela
// CAPACIDADE DO TANQUE ("vai pela capacidade do tanque mesmo"): sugere carga de 60 m3 quando o saldo do dia
// fica abaixo de 70% do tanque (mesma faixa vermelha da linha de abertura, capBand) e nunca deixa passar de
// 100%. O estoque minimo da politica NAO serve de gatilho: em 44 de 154 recortes ele e' maior que o proprio
// tanque. Capacidade = tanque informado no MIS; sem ele, a capacidade da politica.
// Recalcula do zero a cada clique (ignora o que ja' estava na linha) e considera FOB/CIF/Bombeio do jeito que
// estao na tela, inclusive editados. Antecedencia, cargas por dia e dias sem recebimento ainda nao entram.
// Capacidade = planilha de tancagem (0 = fora da planilha, venda no bico); a politica so' entra se o
// snapshot for antigo e nao trouxer capacidadeFisica.
function capacidadeDoTanque(){return record?.capacidadeFisica??state?.capacity??null;}
// Tres objetivos de cadencia (pedido da usuaria, 2026-10-15), todos em cargas de 60 m3, de amanha em diante
// e sem nunca passar da capacidade do tanque:
//  'tanque' = Encher o tanque: sugere quando o saldo fica abaixo de 70% do tanque, ate' voltar a 70%;
//  'minimo' = Atingir o estoque minimo: sugere quando o saldo fica abaixo do minimo da politica, ate' atingi-lo;
//  'media'  = Venda media da rede: alvo = "Vendas media semana" (media seg-sex da venda da Rede na semana);
//             cargas que deixam o fechamento o mais perto possivel dela ("teto atingivel"), sem deixar faltar.
const OBJETIVOS_CADENCIA={
 tanque:{nome:'Encher o tanque',motivo:cap=>`de ${Math.round(GATILHO_SUGESTAO*100)}% do tanque`,opcoes:cap=>({gatilho:cap*GATILHO_SUGESTAO})},
 // 'minimo' com o minimo como TETO (usuaria, 2026-10-16: "que ele nao ultrapasse o estoque minimo"): so' entra
 // carga se o saldo, com ela e com as entradas ja' previstas dos dias seguintes, nao passar do minimo. Pode
 // ficar abaixo do minimo em alguns dias (quando 60 m3 nao cabem ate' ele) — escolha dela.
 minimo:{nome:'Atingir o estoque mínimo',motivo:()=>`do estoque mínimo (${fmt(state.min)} m³)`,limite:()=>`sem passar do estoque mínimo de ${fmt(state.min)} m³`,opcoes:cap=>({gatilho:state.min,teto:Math.min(state.min,cap)})},
 media:{nome:'Venda média da rede',motivo:()=>'da venda média da rede na semana',opcoes:()=>({gatilho:i=>record.bi?.days?.[day(i)]?.vendaMediaSemana??null,modo:'proximo'})},
};
// Parte PLANEJADA das entradas do dia (o que a sugestao substitui): Bombeio da cadencia MIS, transferencias
// programadas e, na origem "Programado + Nao programado", as viagens FOB sem placa. Em "Cadencia MIS" tudo e'
// planejado. Transito real (com placa/em viagem) e transferencia ja' em viagem ficam.
function planejadoDoDia(i){
 const m=state.movements,entrada=entradaNoDia($('entrada')?.value||'auto',day(i));
 if(entrada==='cadencia')return {pump:m.pump[i],fob:m.fob[i],cif:m.cif[i]};
 const out={pump:m.pump[i]};
 // Transferencia planejada so' esta' na conta no "Programado + Nao programado" (2026-10-16); desde 2026-10-20
 // ela soma no FOB, entao entra na parte planejada do FOB.
 const s1=somaCadenciaS1($('entrada')?.value,day(i)),cad=k=>s1?registrosReais().reduce((s,r)=>{const c=r.bi?.days?.[day(i)]?.cadencia;return s+(c?.[k+'Pendente']??c?.[k]??0);},0):0;
 if(incluiNaoProg(entrada))out.fob=Math.min(m.fob[i],(somaOuNula(registrosReais().map(r=>fobNaoProgramado(r,day(i))))||0)
  +transfPlanejadaDia(i)+cad('fob')
  +(entrada==='auto+tudo'?registrosReais().reduce((s,r)=>s+cadenciaMisSemViagem(r,day(i)),0):0));
 if(s1)out.cif=Math.min(m.cif[i],cad('cif'));
 return out;
}
function sugerirCadencia(objetivo='tanque'){
 const obj=OBJETIVOS_CADENCIA[objetivo];
 if(!record){message('Escolha cidade, depósito e produto antes de sugerir a cadência.');return;}
 const capacidade=capacidadeDoTanque();
 if(!capacidade){message(semCapacidade()?'Sem capacidade estabelecida para este recorte; não é possível sugerir a cadência.':'Este recorte não tem a capacidade do tanque informada; não é possível sugerir a cadência.');return;}
 if(objetivo==='minimo'&&!(state.min>0)){message('Este recorte não tem estoque mínimo na política; não é possível sugerir por esse objetivo.');return;}
 const hojeI=Math.max(0,Math.round((new Date(simulationToday()+'T12:00:00')-new Date(D.date+'T12:00:00'))/86400000));
 if(objetivo==='media'&&!Array.from({length:n},(_,i)=>i).some(i=>i>hojeI&&record.bi?.days?.[day(i)]?.vendaMediaSemana>0)){message('Não há venda média da rede para este recorte nos próximos dias; não é possível sugerir por esse objetivo.');return;}
 // A sugestao propoe a cadencia do zero (pedido da usuaria, 2026-10-15: "entrada + transitos reais - saidas;
 // as cadencias planejadas saem fora quando for simular"): de amanha em diante, tira da conta E da tabela o
 // Bombeio (cadencia MIS) e as transferencias ainda programadas; ficam abertura, transito real e as saidas.
 // "Restaurar" traz a cadencia planejada de volta.
 let retirado=0;
 for(let i=hojeI+1;i<n;i++){const p=planejadoDoDia(i);for(const [k,v] of Object.entries(p))if(v>0){state.movements[k][i]-=v;retirado+=v;}}
 const semSugestao=structuredClone(state);semSugestao.movements.planned=Array(30).fill(0);
 const plano=E.suggest(semSugestao,n,{carga:CARGA_SUGESTAO,teto:capacidade,inclusive:false,inicio:hojeI+1,...obj.opcoes(capacidade)});
 avisosSugestao={};
 plano.forEach((d,i)=>{state.movements.planned[i]=d.volume;if(d.situacao==='nao-cabe')avisosSugestao[i]={...d,motivo:obj.motivo(capacidade),limite:obj.limite?.()};});
 persist();render(true);
 const cargas=plano.reduce((s,d)=>s+d.cargas,0),semEspaco=plano.filter(d=>d.situacao==='nao-cabe').length;
 const aviso=semEspaco?` Em ${semEspaco} dia(s) o estoque fica abaixo ${obj.motivo(capacidade)}, mas uma carga de ${CARGA_SUGESTAO} m³ não cabe ${obj.limite?obj.limite():'no tanque'} (células em vermelho).`:'';
 const tirou=retirado>0?` Cadência planejada retirada de amanhã em diante: ${fmt(retirado)} m³ (bombeio e transferências programadas; ↺ Restaurar traz de volta).`:'';
 message((cargas?`${obj.nome}: ${cargas} carga(s) de ${CARGA_SUGESTAO} m³, ${fmt(cargas*CARGA_SUGESTAO)} m³ no total (${obj.limite?obj.limite():`tanque de ${fmt(capacidade)} m³`}).${aviso}`
  :semEspaco?`${obj.nome}: nenhuma carga sugerida.${aviso}`:`${obj.nome}: nenhuma carga necessária nos próximos dias.`)+tirou);
}
for(const [objetivo,id] of [['tanque','sugerir-cadencia'],['minimo','sugerir-cadencia-minimo'],['media','sugerir-cadencia-media']])if($(id))$(id).onclick=()=>sugerirCadencia(objetivo);
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
// Aparece pra todo perfil logado: sem segregacao por regiao desde 2026-10-09, todo mundo ve as 3 regioes.
const perfilVeTudo=!!window.SIM_AUTH?.profile;
if(perfilVeTudo)$('regiao-filtro-label').hidden=false;
$('regiao-filtro')?.addEventListener('change',()=>{refreshBaseOptions();products();});
// Pedido da usuaria, 2026-10-01: nada pre-selecionado ao abrir (antes tinha um default fixo em
// "Duque de Caxias" + "Gasolina A", resquicio de teste que nunca devia ter ficado).
refreshBaseOptions();options($('product'),[]);select();$('date').value=D.date;
