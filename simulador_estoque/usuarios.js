'use strict';
// Aba "Usuarios": desde o login unico dos portais (2026-11-03) o cadastro de pessoas, perfis do Nextoques, senha
// provisoria e desativacao ficam na tela de Usuarios do portal (/usuarios/). A aba so' leva para la' e aparece
// para o admin geral e o key user do Nextoques no login central.
(function () {
  const botaoAba = document.querySelector('#abas-bar [data-aba-alvo="usuarios"]');
  if (!botaoAba) return;
  botaoAba.hidden = !window.SIM_CLOUD?.gerenciaUsuarios?.();
  // Antes do onclick do dia.js (troca de aba): esta aba abre outra pagina
  botaoAba.addEventListener('click', event => {
    event.stopImmediatePropagation();
    location.assign('/usuarios/');
  }, {capture: true});
})();
