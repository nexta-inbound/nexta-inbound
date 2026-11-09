// Painel "Duvidas" (2026-11-09): chat que responde com trechos do manual (manual.html), sem IA.
// A pessoa pergunta, o painel procura o trecho do manual que mais combina e mostra com o link pro ponto exato.
// O manual e' a fonte unica: editar manual/manual_nextoques.html e publicar; o painel le' sempre a versao do site.
// Quando houver IA, ela entra no lugar de responder() usando os mesmos trechos.
(function(){
'use strict';
const SUGESTOES=['Como é calculada a VMD?','De onde vem a abertura?','Quando o FOB vai para o dia seguinte?',
 'Por que não aparece o ID da viagem?','Por que a VMD ficou zerada?','O que é o lastro?','Como salvar na equipe?','O que significa cada cor?'];
const PARADAS=new Set(('a o as os e é de da do das dos que qual quais como por porque pra para no na nos nas um uma em ' +
 'com se ao aos eu meu minha ele ela isso esse essa este esta tem ter ta tá ficou fica foi ser sao são quando onde ' +
 'o que oque pq quanto quantos sobre me mim voce você vc nao não sim mais menos').split(' '));
// Palavras que as pessoas usam x palavras do manual.
const SINONIMOS={zerada:['zero','0'],zerado:['zero','0'],zero:['zerada'],vmd:['reprojecao','reprojetada','venda'],
 reprojetada:['vmd','reprojecao'],id:['viagem','nxt'],viagem:['fob','id'],caminhao:['fob','viagem'],
 chegada:['eta','fob'],amanha:['seguinte','d+1'],seguinte:['15h','d+1'],cor:['cores','vermelho','verde','amarelo'],
 cores:['cor'],salvar:['equipe','cenario'],senha:['login','acesso'],entrar:['login'],estoque:['abertura','saldo'],
 capacidade:['espaco','tanque'],tanque:['capacidade','lastro'],le:['previsao','meta'],meta:['le'],
 sap:['recebimento','recebimentos'],recebimento:['sap','entrada'],deposito:['destino','base']};
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const palavras=s=>norm(s).split(/[^a-z0-9+]+/).filter(p=>p&&!PARADAS.has(p));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let trechos=null,carregando=null;

function carregarManual(){
 if(carregando)return carregando;
 carregando=fetch('manual.html',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(r.status);return r.text();}).then(html=>{
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.querySelectorAll('.capa,.barra-web,#sumario,.mini-sumario,script,style').forEach(e=>e.remove());
  // Monta o texto com quebras nos blocos, pra resposta ficar legivel.
  const caixa=document.createElement('div');caixa.style.cssText='position:absolute;left:-99999px;top:0;width:700px';
  document.body.appendChild(caixa);
  const titulos=[...doc.querySelectorAll('h2,h3')].filter(h=>h.closest('section'));
  const lista=[];
  titulos.forEach((h,i)=>{
   const sec=h.closest('section');const cap=sec.querySelector('h2');
   const r=doc.createRange();r.setStartAfter(h);
   const prox=titulos[i+1];if(prox&&prox.closest('section')===sec)r.setEndBefore(prox);else r.setEndAfter(sec.lastChild);
   caixa.replaceChildren(document.importNode(r.cloneContents(),true));
   const texto=(caixa.innerText||caixa.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
   const titulo=(h.tagName==='H2'?h.textContent.replace(/^\s*\d+\s*/,''):h.textContent).trim();
   if(!texto&&h.tagName==='H2')return;
   const ancora=h.id?'#'+h.id:'#'+sec.id+':~:text='+encodeURIComponent(h.childNodes[0]?.textContent?.trim()||titulo);
   lista.push({titulo,capitulo:cap?cap.textContent.replace(/^\s*\d+/,'').trim():'',texto,ancora,
    pt:new Set(palavras(titulo)),pc:palavras(texto)});
  });
  caixa.remove();trechos=lista;return lista;
 });
 carregando.catch(()=>{carregando=null;});
 return carregando;
}

function responder(pergunta){
 const base=palavras(pergunta);if(!base.length)return[];
 const termos=new Map(base.map(p=>[p,1]));
 base.forEach(p=>(SINONIMOS[p]||[]).forEach(s=>{if(!termos.has(s))termos.set(s,.5);}));
 const radical=p=>p.length>5?p.slice(0,p.length-2):p; // "reprojetada" ~ "reprojecao", "cores" ~ "cor"
 return trechos.map(t=>{
  let nota=0,achou=0,noTit=0;
  for(const [p,peso] of termos){
   const rp=radical(p);
   const noTitulo=[...t.pt].some(w=>w===p||(rp.length>3&&w.startsWith(rp)));
   const noTexto=t.pc.filter(w=>w===p||(rp.length>3&&w.startsWith(rp))).length;
   if(noTitulo||noTexto)achou+=peso;
   if(noTitulo&&peso===1)noTit++;
   nota+=peso*((noTitulo?10:0)+Math.min(noTexto,4));
  }
  // Prefere trechos cujo titulo tem as palavras da pergunta e que cobrem mais palavras; trecho longo perde um pouco.
  nota*=0.4+achou/base.length;nota*=1+noTit/base.length;nota/=1+t.pc.length/500;
  if(/duvidas frequentes/.test(norm(t.capitulo)))nota*=1.25;
  return{t,nota};
 }).filter(x=>x.nota>0.8).sort((a,b)=>b.nota-a.nota).slice(0,4).map(x=>x.t);
}

const LIMITE=650;
function resumo(texto){
 if(texto.length<=LIMITE)return texto;
 const corte=texto.slice(0,LIMITE);const fim=Math.max(corte.lastIndexOf('\n'),corte.lastIndexOf('. '));
 return (fim>LIMITE*.5?corte.slice(0,fim+1):corte)+' …';
}

function css(){
 if(document.getElementById('duvidas-css'))return;
 const s=document.createElement('style');s.id='duvidas-css';s.textContent=`
#duvidas-painel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:1000;background:var(--surface,#1A2A20);
 border-left:1px solid var(--border,#314A32);box-shadow:-6px 0 24px #0008;display:flex;flex-direction:column;font-family:var(--font,Barlow,Arial,sans-serif)}
#duvidas-painel[hidden]{display:none}
#duvidas-painel header.dv-cab{min-height:0;padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:2px solid #EEFE7A;background:linear-gradient(135deg,#111A0A,#1C2E10 55%,#243A16)}
.dv-cab b{color:#EEFE7A;font:600 20px 'Barlow Condensed',sans-serif}.dv-cab small{display:block;color:var(--dim,#BFD4A8);font-size:11px}
.dv-cab button{margin-left:auto;flex:none;min-width:0}
.dv-msgs{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.dv-msg{max-width:92%;padding:10px 12px;border-radius:12px;line-height:1.45;font-size:13px;white-space:pre-line}
.dv-eu{align-self:flex-end;background:#8DC830;color:#111A0A;border-bottom-right-radius:4px;font-weight:600}
.dv-bot{align-self:flex-start;background:var(--panel,#223528);color:var(--text,#F4F8EE);border:1px solid var(--border,#314A32);border-bottom-left-radius:4px}
.dv-bot .dv-tit{display:block;color:#EEFE7A;font:600 15px 'Barlow Condensed',sans-serif;margin-bottom:4px;white-space:normal}
.dv-bot .dv-cap{display:block;color:var(--muted,#7FA069);font-size:11px;margin-bottom:6px;white-space:normal}
.dv-bot a{color:#EEFE7A;font-weight:600}
.dv-rel{white-space:normal;margin-top:8px;padding-top:8px;border-top:1px solid var(--border,#314A32);font-size:12px;color:var(--dim,#BFD4A8)}
.dv-rel button{display:block;width:100%;text-align:left;margin-top:5px;padding:6px 9px;font-size:12px;border-radius:8px}
.dv-chips{display:flex;flex-wrap:wrap;gap:6px;white-space:normal;margin-top:8px}
.dv-chips button{padding:6px 10px;border-radius:999px;font-size:12px;flex:none;width:auto;min-width:0}
.dv-form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#314A32)}
.dv-form input{flex:1}.dv-form button{flex:none;width:auto;min-width:0}
.dv-rod{padding:0 16px 12px;font-size:11px;color:var(--muted,#7FA069)}.dv-rod a{color:var(--dim,#BFD4A8)}`;
 document.head.appendChild(s);
}

let painel,msgs,campo;
function adicionar(html,quem){const d=document.createElement('div');d.className='dv-msg '+(quem==='eu'?'dv-eu':'dv-bot');d.innerHTML=html;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}
function chips(){return`<div class="dv-chips">${SUGESTOES.map(s=>`<button type="button" data-pergunta="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;}
function trechoHtml(t){
 return`<span class="dv-tit">${esc(t.titulo)}</span>${t.capitulo&&t.capitulo!==t.titulo?`<span class="dv-cap">${esc(t.capitulo)}</span>`:''}`+
  `${esc(resumo(t.texto))}\n<a href="manual.html${esc(t.ancora)}" target="_blank" rel="noopener">📖 Ler no manual →</a>`;
}
async function perguntar(texto){
 texto=String(texto||'').trim();if(!texto)return;
 adicionar(esc(texto),'eu');campo.value='';
 const espera=adicionar('Procurando no manual…','bot');
 try{await carregarManual();}catch(e){espera.innerHTML='Não consegui abrir o manual agora. Tente de novo em instantes ou <a href="manual.html" target="_blank" rel="noopener">abra o manual</a>.';return;}
 const achados=responder(texto);
 if(!achados.length){espera.innerHTML='Não encontrei isso no manual. Tente com outras palavras, veja as sugestões abaixo ou fale com o administrador do simulador.'+chips();return;}
 const [melhor,...outros]=achados;
 espera.innerHTML=trechoHtml(melhor)+(outros.length?`<div class="dv-rel">Também pode ajudar:${outros.map((t,i)=>`<button type="button" data-trecho="${i+1}">${esc(t.titulo)}</button>`).join('')}</div>`:'');
 espera._achados=achados;
}
function abrir(){
 css();
 if(!painel){
  painel=document.createElement('aside');painel.id='duvidas-painel';painel.setAttribute('aria-label','Dúvidas sobre o simulador');
  painel.innerHTML=`<header class="dv-cab"><div><b>❓ Dúvidas</b><small>Respostas tiradas do manual do simulador</small></div><button type="button" class="dv-fechar" title="Fechar">✕</button></header>
   <div class="dv-msgs"></div>
   <form class="dv-form"><input type="text" placeholder="Escreva sua dúvida… ex.: por que a VMD ficou zerada?" maxlength="200" aria-label="Sua dúvida"><button type="submit" class="primary">Perguntar</button></form>
   <div class="dv-rod">Não achou? <a href="manual.html" target="_blank" rel="noopener">Abra o manual completo</a> ou fale com o administrador do simulador.</div>`;
  document.body.appendChild(painel);
  msgs=painel.querySelector('.dv-msgs');campo=painel.querySelector('input');
  painel.querySelector('.dv-fechar').onclick=()=>{painel.hidden=true;};
  painel.querySelector('form').onsubmit=e=>{e.preventDefault();perguntar(campo.value);};
  msgs.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b)return;
   if(b.dataset.pergunta)perguntar(b.dataset.pergunta);
   else if(b.dataset.trecho){const m=b.closest('.dv-msg');const t=m?._achados?.[+b.dataset.trecho];if(t)adicionar(trechoHtml(t),'bot');}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!painel.hidden)painel.hidden=true;});
  adicionar('Olá! Pergunte sobre as regras do simulador: como cada número é calculado, o que significa cada aviso ou cor, e o que fazer quando algo parece errado.\nPode escrever do seu jeito ou clicar numa sugestão:'+chips(),'bot');
  carregarManual().catch(()=>{});
 }
 painel.hidden=false;campo.focus();
}
document.addEventListener('click',e=>{if(e.target.closest('#abrir-duvidas')){e.preventDefault();abrir();}});
window.abrirDuvidas=abrir;
})();
