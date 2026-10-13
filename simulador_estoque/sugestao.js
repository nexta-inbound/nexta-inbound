'use strict';
// Sugestao de cadencia — versao basica (pedido da usuaria, 2026-10-12: "vamos fazer o basicao primeiro").
// Regra da planilha dela: dia a dia, se o saldo do fim do dia (abertura + entradas ja previstas − saidas)
// encostar no gatilho (estoque minimo), sugere carga(s); nunca sugere se o saldo com a carga passar do
// teto (capacidade) — "NAO PODE SUGERIR, PQ FICA > CAPACIDADE DO DIA". A sugestao de um dia ja' conta na
// abertura do dia seguinte. So' calcula: nao mexe no cenario (quem aplica e' a tela).
// Ficam pra depois (ela ainda nao tem os dados): cargas por dia, dias sem recebimento e antecedencia,
// que depende de origem/destino.
(function(root){
const E=root.StockEngine;
// opcoes: carga (m3 por carga), gatilho (padrao: minimo da politica), teto (padrao: capacidade),
// inclusive (true = sugere com saldo IGUAL ao gatilho; false = so' abaixo), inicio (1o dia que pode sugerir).
function suggest(s,n,opcoes){
 const o=Object.assign({carga:60,gatilho:s.min,teto:s.capacity,inclusive:true,inicio:0},opcoes);
 const previsto=E.calculate(s,n),precisa=v=>o.gatilho!==null&&(o.inclusive?v<=o.gatilho:v<o.gatilho);
 let abertura=s.opening;
 return previsto.map((dia,i)=>{
  const semSugestao=abertura+dia.incoming-dia.outgoing;
  let cargas=0,situacao='sem-necessidade',diaLimite=null;
  if(i>=o.inicio&&o.carga>0&&precisa(semSugestao)){
   // Maior saldo de hoje em diante so' com o que ja' esta' previsto: a carga sugerida hoje continua no
   // tanque nos dias seguintes, entao tambem nao pode estourar o teto quando chegar um transito/cadencia
   // ja' programado (na planilha dela: nao sugere no dia 6 porque o transito do dia 7 ja' resolve).
   let pico=semSugestao,saldo=semSugestao;diaLimite=i;
   for(let j=i+1;j<n;j++){saldo+=previsto[j].incoming-previsto[j].outgoing;if(saldo>pico){pico=saldo;diaLimite=j;}}
   while(precisa(semSugestao+cargas*o.carga)&&(o.teto===null||pico+(cargas+1)*o.carga<=o.teto))cargas++;
   situacao=cargas===0?'nao-cabe':precisa(semSugestao+cargas*o.carga)?'parcial':'sugerido';
  }
  const fechamento=semSugestao+cargas*o.carga;
  // volume e' sempre multiplo da carga (60 m3). diaLimite: dia cujo saldo previsto limitou a sugestao.
  const resultado={abertura,entradas:dia.incoming,saidas:dia.outgoing,semSugestao,cargas,volume:cargas*o.carga,fechamento,situacao,
   diaLimite:situacao==='nao-cabe'||situacao==='parcial'?diaLimite:null,
   // Entrada JA' prevista (transito/cadencia) que sozinha estoura o teto: so' avisa, nao e' a sugestao que causa.
   acimaDoTeto:o.teto!==null&&fechamento>o.teto};
  abertura=fechamento;return resultado;
 });
}
E.suggest=suggest;
})(typeof window!=='undefined'?window:globalThis);
