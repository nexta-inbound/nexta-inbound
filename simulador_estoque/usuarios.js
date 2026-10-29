'use strict';
// Aba "Usuarios" (usuaria, 2026-10-29: "deixa apenas pra mim e pro matheus sanches fazer esse cadastro"): so' aparece
// pra quem tem perfis/<uid>/gerenciaUsuarios. Lista e edita os perfis direto no banco (regras: so' gerenciaUsuarios
// grava perfis); criar login e voltar a senha pra padrao viram pedido em pedidosUsuarios, que a maquina logistica
// executa em segundos (nexta_etl pedidos_usuarios.py) — o navegador nunca tem a credencial admin do Firebase.
(function () {
  const cloud = window.SIM_CLOUD;
  const botaoAba = document.querySelector('#abas-bar [data-aba-alvo="usuarios"]');
  if (!cloud?.gerenciaUsuarios?.()) { if (botaoAba) botaoAba.hidden = true; return; }
  botaoAba.hidden = false;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const PERFIS = [['administrador', 'Administrador'], ['regional', 'Regional'], ['leitura', 'Leitura'], ['base', 'Base']];
  const REGIOES = [['SP', 'SP'], ['MG_RJ', 'MG / RJ'], ['CO', 'Centro-Oeste']];
  const NOME_PERFIL = Object.fromEntries([...PERFIS, ['powerbi', 'Power BI']]);
  const meuUid = window.SIM_AUTH?.uid;

  const view = document.createElement('section');
  view.id = 'usuarios-view'; view.className = 'panel us-view'; view.dataset.aba = 'usuarios';
  view.innerHTML = `
    <div class="section-title"><div><h2>Usuários do simulador</h2>
      <p>Cadastre, altere ou desative acessos. Login novo e reset de senha usam a senha padrão <strong>mudarsenha123</strong>; no 2º acesso a pessoa é obrigada a trocar.</p></div></div>
    <form id="us-form" class="us-form" autocomplete="off">
      <h3 id="us-form-titulo">Novo usuário</h3>
      <div class="us-campos">
        <label>E-mail<input id="us-email" type="email" required placeholder="nome.sobrenome@nexta.com.br"></label>
        <label>Nome<input id="us-nome" type="text" required maxlength="120" placeholder="Nome Sobrenome"></label>
      </div>
      <span class="eyebrow">PERFIL</span><div class="chips us-chips" id="us-perfis"></div>
      <div id="us-bloco-regiao" hidden><span class="eyebrow">REGIÃO</span><div class="chips us-chips" id="us-regioes"></div></div>
      <div id="us-bloco-bases" hidden><span class="eyebrow">TERMINAIS QUE ELE PREENCHE</span><div id="us-bases" class="us-bases"></div></div>
      <div class="us-acoes-form">
        <button type="submit" id="us-salvar" class="primary">Criar acesso</button>
        <button type="button" id="us-cancelar" hidden>Cancelar edição</button>
        <span id="us-status" class="us-status" role="status"></span>
      </div>
    </form>
    <div class="us-lista-topo"><h3>Quem tem acesso</h3><input id="us-busca" type="search" placeholder="Buscar por nome ou e-mail"></div>
    <div class="us-tabela-wrap"><table class="us-tabela"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Região / terminais</th><th>Situação</th><th></th></tr></thead><tbody id="us-linhas"></tbody></table></div>`;
  document.querySelector('main').append(view);

  let perfis = {}, layout = null, editando = null, escolha = {perfil: 'leitura', regiao: null, bases: new Set()};
  const nomeTerminal = {};

  function status(texto, tipo = '') { const s = $('us-status'); s.textContent = texto; s.dataset.tipo = tipo; }
  function chips(id, opcoes, ativo, multiplo = false) {
    $(id).innerHTML = opcoes.map(([v, t]) => {
      const ligado = multiplo ? ativo.has(v) : v === ativo;
      return `<button type="button" data-us-valor="${esc(v)}" class="${ligado ? 'active' : ''}" aria-pressed="${ligado}">${esc(t)}</button>`;
    }).join('');
  }
  function desenharForm() {
    chips('us-perfis', PERFIS, escolha.perfil);
    $('us-bloco-regiao').hidden = escolha.perfil !== 'regional';
    chips('us-regioes', REGIOES, escolha.regiao);
    $('us-bloco-bases').hidden = escolha.perfil !== 'base';
    $('us-bases').innerHTML = (layout?.cidades || []).map(c => `<div class="us-cidade"><strong>${esc(c.cidade)}</strong><div class="chips">${
      (c.terminais || []).map(t => { const l = escolha.bases.has(t.empDep); return `<button type="button" data-us-base="${esc(t.empDep)}" class="${l ? 'active' : ''}" aria-pressed="${l}">${esc(t.nome)}</button>`; }).join('')
    }</div></div>`).join('') || '<p class="muted">Lista de terminais indisponível.</p>';
  }
  function situacao(p) {
    if (p.desativado) return ['Desativado', 'off'];
    if (p.acessoBloqueado) return ['Bloqueado (senha venceu)', 'bloq'];
    if (p.senhaTemporariaEm && !(p.primeiroAcessoEm > p.senhaTemporariaEm)) return ['Senha padrão, ainda não trocou', 'temp'];
    return ['Ativo', 'ok'];
  }
  function detalhe(p) {
    if (p.perfil === 'regional') return REGIOES.find(r => r[0] === p.regiao)?.[1] || '—';
    if (p.perfil === 'base') { const b = Object.keys(p.bases || {}); return b.length ? b.map(e => nomeTerminal[e] || e).join(', ') : '—'; }
    return '—';
  }
  function desenharLista() {
    const busca = $('us-busca').value.trim().toLowerCase();
    const linhas = Object.entries(perfis).filter(([, p]) => p && typeof p === 'object')
      .filter(([, p]) => !busca || `${p.nome} ${p.email}`.toLowerCase().includes(busca))
      .sort((a, b) => String(a[1].nome || a[1].email).localeCompare(String(b[1].nome || b[1].email), 'pt-BR'));
    $('us-linhas').innerHTML = linhas.map(([uid, p]) => {
      const [sit, cls] = situacao(p), editavel = PERFIS.some(([v]) => v === p.perfil), eu = uid === meuUid;
      return `<tr data-us-uid="${esc(uid)}"><td>${esc(p.nome)}${p.gerenciaUsuarios ? ' <span class="us-tag">gerencia usuários</span>' : ''}</td><td>${esc(p.email)}</td>
        <td>${esc(NOME_PERFIL[p.perfil] || p.perfil)}</td><td class="us-det">${esc(detalhe(p))}</td><td><span class="us-sit us-${cls}">${esc(sit)}</span></td>
        <td class="us-acoes">${editavel ? `<button type="button" data-us-acao="editar">Editar</button>
          <button type="button" data-us-acao="resetar">Senha padrão</button>
          <button type="button" data-us-acao="email">E-mail de redefinição</button>
          ${eu ? '' : `<button type="button" data-us-acao="${p.desativado ? 'reativar' : 'desativar'}" class="${p.desativado ? '' : 'us-perigo'}">${p.desativado ? 'Reativar' : 'Desativar'}</button>`}` : '<span class="muted">conta de sistema</span>'}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Ninguém encontrado.</td></tr>';
  }
  async function carregar() {
    try {
      [perfis, layout] = await Promise.all([cloud.listarPerfis(), layout ? Promise.resolve(layout) : cloud.aberturasLayout().catch(() => null)]);
      for (const c of layout?.cidades || []) for (const t of c.terminais || []) nomeTerminal[t.empDep] = t.nome;
      desenharForm(); desenharLista();
    } catch (e) { console.error(e); status('Não foi possível carregar os usuários (as regras novas do Firebase já foram publicadas?).', 'erro'); }
  }
  function limparForm() {
    editando = null; escolha = {perfil: 'leitura', regiao: null, bases: new Set()};
    $('us-form').reset(); $('us-email').readOnly = false;
    $('us-form-titulo').textContent = 'Novo usuário'; $('us-salvar').textContent = 'Criar acesso'; $('us-cancelar').hidden = true;
    desenharForm();
  }
  function editar(uid) {
    const p = perfis[uid]; editando = uid;
    escolha = {perfil: p.perfil, regiao: p.regiao || null, bases: new Set(Object.keys(p.bases || {}))};
    $('us-email').value = p.email; $('us-email').readOnly = true; $('us-nome').value = p.nome || '';
    $('us-form-titulo').textContent = `Editando ${p.nome || p.email}`; $('us-salvar').textContent = 'Salvar alterações'; $('us-cancelar').hidden = false;
    status(''); desenharForm(); view.scrollIntoView({behavior: 'smooth'});
  }
  function validar() {
    const email = $('us-email').value.trim().toLowerCase(), nome = $('us-nome').value.trim();
    if (!/^[^@\s]+@(nexta|simcombustiveis)\.com\.br$/.test(email)) throw new Error('Use um e-mail @nexta.com.br ou @simcombustiveis.com.br.');
    if (!nome) throw new Error('Informe o nome.');
    if (escolha.perfil === 'regional' && !escolha.regiao) throw new Error('Escolha a região do perfil regional.');
    if (escolha.perfil === 'base' && !escolha.bases.size) throw new Error('Marque pelo menos um terminal do perfil base.');
    return {email, nome};
  }
  // Espera o pedido ser executado pela maquina logistica e mostra o resultado.
  function acompanhar(id, rotulo) {
    status(`${rotulo}: enviado, aguardando a máquina logística…`);
    const aviso = setTimeout(() => status(`${rotulo}: ainda aguardando. Se a logística estiver desligada, o pedido é feito quando ela voltar.`, 'aviso'), 30000);
    const parar = cloud.acompanharPedido(id, pedido => {
      if (!pedido || pedido.status === 'pendente') return;
      clearTimeout(aviso); parar();
      status(`${rotulo}: ${pedido.resultado || pedido.status}`, pedido.status === 'feito' ? 'ok' : 'erro');
      if (pedido.status === 'feito') carregar();
    });
  }
  async function salvar(e) {
    e.preventDefault();
    try {
      const {email, nome} = validar();
      const extras = {regiao: escolha.perfil === 'regional' ? escolha.regiao : null,
        bases: escolha.perfil === 'base' ? Object.fromEntries([...escolha.bases].map(k => [k, true])) : null};
      if (editando) {
        if (editando === meuUid && escolha.perfil !== 'administrador' && !confirm('Você está tirando seu próprio perfil de administrador. Continuar?')) return;
        await cloud.salvarPerfil(editando, {nome, perfil: escolha.perfil, admin: escolha.perfil === 'administrador', ...extras});
        status(`Alterações de ${nome} salvas.`, 'ok'); limparForm(); carregar(); return;
      }
      if (Object.values(perfis).some(p => p?.email?.toLowerCase() === email)) throw new Error('Esse e-mail já tem acesso. Use Editar na lista.');
      const pedido = {tipo: 'criar', email, nome, perfil: escolha.perfil};
      if (extras.regiao) pedido.regiao = extras.regiao;
      if (extras.bases) pedido.bases = extras.bases;
      acompanhar(await cloud.pedirUsuario(pedido), `Acesso de ${email}`);
      limparForm();
    } catch (erro) { status(erro.message || 'Não foi possível salvar.', 'erro'); }
  }
  async function acaoLinha(uid, acao) {
    const p = perfis[uid]; if (!p) return;
    try {
      if (acao === 'editar') return editar(uid);
      if (acao === 'resetar') {
        if (!confirm(`Voltar a senha de ${p.nome || p.email} para mudarsenha123?`)) return;
        acompanhar(await cloud.pedirUsuario({tipo: 'resetar', email: p.email, uid}), `Senha de ${p.email}`);
      } else if (acao === 'email') {
        await cloud.enviarRedefinicao(p.email); status(`E-mail de redefinição enviado para ${p.email}.`, 'ok');
      } else if (acao === 'desativar' || acao === 'reativar') {
        const desativar = acao === 'desativar';
        if (desativar && !confirm(`Desativar o acesso de ${p.nome || p.email}? A pessoa deixa de entrar no simulador até ser reativada.`)) return;
        await cloud.salvarPerfil(uid, {desativado: desativar ? true : null});
        status(`${p.nome || p.email}: acesso ${desativar ? 'desativado' : 'reativado'}.`, 'ok'); carregar();
      }
    } catch (erro) { console.error(erro); status(erro.message || 'Não foi possível concluir.', 'erro'); }
  }

  $('us-form').addEventListener('submit', salvar);
  $('us-cancelar').onclick = () => { limparForm(); status(''); };
  $('us-busca').oninput = desenharLista;
  view.addEventListener('click', e => {
    const opcao = e.target.closest('[data-us-valor]');
    if (opcao) {
      if (opcao.closest('#us-perfis')) escolha.perfil = opcao.dataset.usValor;
      else escolha.regiao = opcao.dataset.usValor;
      desenharForm(); return;
    }
    const base = e.target.closest('[data-us-base]');
    if (base) { const k = base.dataset.usBase; escolha.bases.has(k) ? escolha.bases.delete(k) : escolha.bases.add(k); desenharForm(); return; }
    const acao = e.target.closest('[data-us-acao]');
    if (acao) acaoLinha(acao.closest('[data-us-uid]').dataset.usUid, acao.dataset.usAcao);
  });
  botaoAba.addEventListener('click', carregar);
  desenharForm();
})();
