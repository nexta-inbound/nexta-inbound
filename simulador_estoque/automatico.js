'use strict';
$('scenario').onchange=()=>{select();describeScenario();};
function describeScenario(){$('scenario-note').textContent=$('scenario').value==='Inbound + MIS'?`A partir de ${D.bi.inbound.switchDate}, FOB = MIS (FOB + DAP) e CIF = MIS (CIF). Bombeio e programação rodoviária permanecem visíveis como componentes do trânsito MIS; entram uma vez no total. Editar esses componentes ajusta o FOB para refletir a variação. Antes dessa data, usa o CSV Inbound.`:'Trânsito do CSV Inbound: FOB em andamento/finalizado e CIF, por data de descarga do portal.';}
describeScenario();
async function updateSources(){
 if(window.SIM_CLOUD)return;
 if(D.validationStart){$('auto-status').textContent=D.validationWarning;return;}
 if(location.protocol==='file:'){$('auto-status').innerHTML='Para atualização automática, abra <a href="http://127.0.0.1:8766/">o simulador local automático</a>. Este arquivo mantém o último snapshot.';return;}
 try{
  const response=await fetch('/api/snapshot',{cache:'no-store'});if(!response.ok)throw Error();const payload=await response.json();
  const info=payload.status;
  $('auto-status').textContent=info.error|| (info.running?'Atualizando as fontes automaticamente…':`Atualização automática ativa · última leitura ${info.lastSuccess||D.bi.extractedAt} · intervalo de 5 minutos.`);
  if(payload.data.revision!==D.revision && !document.activeElement.matches('input,select')){
   persist();const cidade=$('cidade').value,deposito=$('deposito').value,empresa=$('empresa').value,product=$('product').value;D=payload.data;window.ESTOQUE_DATA=D;
   refreshBaseOptions();if([...$('cidade').options].some(o=>o.value===cidade))$('cidade').value=cidade;refreshDepositoOptions();if([...$('deposito').options].some(o=>o.value===deposito))$('deposito').value=deposito;refreshEmpresaOptions();if([...$('empresa').options].some(o=>o.value===empresa))$('empresa').value=empresa;products();if([...$('product').options].some(o=>o.value===product)){$('product').value=product;select();}
   $('date').value=D.date;describeScenario();message('Fontes atualizadas. Alterações da simulação preservadas para esta referência.');
  }
 }catch{$('auto-status').textContent='Conexão com a atualização local indisponível. Últimos dados carregados preservados.';}
}
updateSources();if(location.protocol!=='file:')setInterval(updateSources,15000);
