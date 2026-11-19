import { COLLECTION_PATHS, recordPath, decodeKey, encodeKey, fromEnvelope, toEnvelope } from './realtime-codec.mjs';
import { applyQuery } from './realtime-query.mjs';

// Colecoes com a transportadora em cada registro (campo dentro de dados/). Para o perfil transportador, o
// Firebase so' aceita a consulta filtrada por esse campo = transportadora do perfil (regras do banco,
// gerar_regras_outbound.py): "de jeito NENHUM a transportadora A ve dados da B" (usuaria, 2026-11-17).
export const CAMPO_TRANSPORTADORA = Object.freeze({
  availability: 'carrier', locks: 'carrier', sob_ciclos: 'carrier', devolucoesReentregas: 'transportadora'});
// Documentos de config que o transportador le inteiros: so' numeros e a lista de operacoes.
const CONFIG_LIVRE = new Set(['alert_cutoff', 'meta_disp', 'meta_sla', 'operacoes']);
// Documentos de config separados por chave: o transportador le so' a chave dele.
const CONFIG_POR_TRANSPORTADORA = new Set(['plates', 'drivers']);

const ehInterno = p => ['administrador', 'interno'].includes(p?.perfil);
const ehTransportador = p => p?.perfil === 'transportador' && typeof p.transportadorNome === 'string' && !!p.transportadorNome;
const negado = e => /permission|denied|permiss/i.test(String(e?.code || '') + ' ' + String(e?.message || ''));

// Sub-arvore lida sem os metadados (formatos) do registro: listas voltam pelas chaves i00000000, i00000001...
function semFormatos(value) {
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value).filter(k => value[k] !== null);
  if (keys.length && keys.sort().every((k, i) => k === 'i' + String(i).padStart(8, '0'))) return keys.map(k => semFormatos(value[k]));
  return Object.fromEntries(keys.map(k => [decodeKey(k), semFormatos(value[k])]));
}

export function createRealtimeReader({sdk, database, authorize}) {
  if (typeof authorize !== 'function') throw new Error('Verificacao de acesso obrigatoria.');
  const check = async () => {
    const profile = await authorize();
    if (!profile?.ativo || !(ehInterno(profile) || ehTransportador(profile))) {
      throw new Error('Perfil sem acesso ao Outbound.');
    }
    return profile;
  };
  function documentSnapshot(collection, id, envelope) {
    const value = fromEnvelope(envelope);
    return Object.freeze({id, exists: () => value !== undefined,
      data: () => value === undefined ? undefined : structuredClone(value),
      ref: Object.freeze({collection, id})});
  }
  const ausente = (collection, id) => documentSnapshot(collection, id, null);
  // Documento montado aqui (so' a parte do transportador): mesmo formato do banco, com listas marcadas.
  const envelopeDe = dados => toEnvelope(dados);

  // ---- transportador: o que ele pode ler e como pedir ao Firebase -------------------------------------------
  async function lerOuNada(alvo) {
    try { return (await sdk.get(alvo)).val(); } catch (e) { if (negado(e)) return null; throw e; }
  }
  async function getDocTransportador(profile, collection, id) {
    const nome = profile.transportadorNome;
    if (collection === 'config') {
      if (CONFIG_LIVRE.has(id)) return documentSnapshot(collection, id, await lerOuNada(sdk.ref(database, recordPath(collection, id))));
      if (CONFIG_POR_TRANSPORTADORA.has(id)) {
        const meu = await lerOuNada(sdk.ref(database, recordPath(collection, id) + '/dados/data/' + encodeKey(nome)));
        return documentSnapshot(collection, id, envelopeDe({data: meu == null ? {} : {[nome]: semFormatos(meu)}}));
      }
      if (id === 'users' && profile.idLegado) {
        // Lista de usuarios: so' a propria linha (o app procura o login pelo codigo legado)
        const eu = await lerOuNada(sdk.ref(database, recordPath(collection, id) + '/dados/data/' + encodeKey(profile.idLegado)));
        return documentSnapshot(collection, id, eu == null ? null : envelopeDe({data: {[profile.idLegado]: semFormatos(eu)}}));
      }
      if (id === 'carriers') return documentSnapshot(collection, id, envelopeDe({list: [nome]}));
      return ausente(collection, id);
    }
    // Registro de outra transportadora ou inexistente: o Firebase nega e aqui vira "nao existe".
    if (CAMPO_TRANSPORTADORA[collection]) return documentSnapshot(collection, id, await lerOuNada(sdk.ref(database, recordPath(collection, id))));
    return ausente(collection, id);
  }
  // Consulta que o Firebase aceita para o transportador (ou null quando o pedido e' de outra transportadora)
  function consultaTransportador(profile, collection, constraints) {
    const campo = CAMPO_TRANSPORTADORA[collection];
    if (!campo) return null;
    const nome = profile.transportadorNome;
    for (const c of constraints) {
      if (c.kind === 'where' && c.field === campo) {
        if (c.op === '==' && c.value !== nome) return null;
        if (c.op === 'in' && !(Array.isArray(c.value) && c.value.includes(nome))) return null;
      }
    }
    return sdk.query(sdk.ref(database, COLLECTION_PATHS[collection]), sdk.orderByChild('dados/' + campo), sdk.equalTo(nome));
  }

  async function getDoc(collection, id) {
    const profile = await check();
    if (ehTransportador(profile)) return getDocTransportador(profile, collection, id);
    const snapshot = await sdk.get(sdk.ref(database, recordPath(collection, id)));
    return documentSnapshot(collection, id, snapshot.val());
  }
  // ── Desempenho (2026-11-19: "Carregando dashboard" eterno / tela piscando) ──────────────────────────────────
  // Antes cada getDocs baixava a COLECAO INTEIRA (ex.: ~4.000 disponibilidades) e filtrava aqui; o Daily Briefing
  // faz dezenas de consultas por transportadora+dia. Agora: (1) filtro por campo com indice (regras: .indexOn) vai
  // pro servidor; (2) leituras iguais disparadas juntas (ate' 5 s) viram uma so'.
  const INDICES = {availability: ['carrier', 'plate', 'dateStr'], locks: ['carrier', 'dateStr'],
    sob_ciclos: ['carrier', 'status'], devolucoesReentregas: ['transportadora', 'criadoEm'], telao_programacao: ['mes']};
  const JANELA_MS = 5000;
  const emVoo = new Map();
  function lerUmaVez(chave, alvo) {
    const agora = Date.now(), atual = emVoo.get(chave);
    if (atual && agora - atual.em < JANELA_MS) return atual.promessa;
    const promessa = sdk.get(alvo).then(s => s.val()).catch(e => { emVoo.delete(chave); throw e; });
    emVoo.set(chave, {em: agora, promessa});
    return promessa;
  }
  function filtrosServidor(collection, constraints) {
    const idx = INDICES[collection] || [];
    const simples = v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
    const igual = constraints.find(c => c.kind === 'where' && c.op === '==' && idx.includes(c.field) && simples(c.value));
    if (igual) return [{campo: igual.field, valor: igual.value}];
    const lista = constraints.find(c => c.kind === 'where' && c.op === 'in' && idx.includes(c.field)
      && Array.isArray(c.value) && c.value.length <= 10 && c.value.every(simples));
    if (lista) return [...new Set(lista.value)].map(valor => ({campo: lista.field, valor}));
    return null;
  }
  async function getDocs(collection, constraints = []) {
    const profile = await check();
    if (!COLLECTION_PATHS[collection]) throw new Error('Colecao nao mapeada.');
    if (ehTransportador(profile)) {
      const alvo = consultaTransportador(profile, collection, constraints);
      return querySnapshot(collection, constraints, alvo ? (await sdk.get(alvo)).val() : null);
    }
    const caminho = COLLECTION_PATHS[collection];
    const filtros = sdk.query && sdk.orderByChild && sdk.equalTo ? filtrosServidor(collection, constraints) : null;
    if (filtros) {
      const partes = await Promise.all(filtros.map(f => lerUmaVez(`${caminho}|${f.campo}|${f.valor}`,
        sdk.query(sdk.ref(database, caminho), sdk.orderByChild('dados/' + f.campo), sdk.equalTo(f.valor)))));
      return querySnapshot(collection, constraints, Object.assign({}, ...partes.map(p => p || {})));
    }
    return querySnapshot(collection, constraints, await lerUmaVez(caminho, sdk.ref(database, caminho)));
  }
  function querySnapshot(collection, constraints, value, previous = []) {
    const raw = value || {};
    const rows = Object.entries(raw).map(([id, envelope]) => ({id: decodeKey(id), data: fromEnvelope(envelope)}))
      .filter(row => row.data !== undefined);
    const docs = applyQuery(rows, constraints).map(row => Object.freeze({id: row.id,
      exists: () => true, data: () => structuredClone(row.data), ref: Object.freeze({collection, id: row.id})}));
    const oldById = new Map(previous.map((doc, index) => [doc.id, {doc, index}]));
    const newById = new Map(docs.map((doc, index) => [doc.id, {doc, index}]));
    const changes = [];
    for (const [id, old] of oldById) {
      if (!newById.has(id)) changes.push({type: 'removed', doc: old.doc, oldIndex: old.index, newIndex: -1});
    }
    for (const [id, current] of newById) {
      const old = oldById.get(id);
      if (!old || JSON.stringify(old.doc.data()) !== JSON.stringify(current.doc.data())) {
        changes.push({type: old ? 'modified' : 'added', doc: current.doc, oldIndex: old?.index ?? -1, newIndex: current.index});
      }
    }
    return Object.freeze({docs: Object.freeze(docs), size: docs.length, empty: docs.length === 0,
      docChanges: () => changes.map(change => ({...change})),
      forEach: callback => docs.forEach(callback)});
  }
  // alvo(profile): referencia/consulta a escutar, ou null = nada a escutar (entrega um vazio e para)
  function watch(alvo, convert, next, onError = () => {}) {
    if (typeof next !== 'function' || typeof onError !== 'function') throw new Error('Callbacks invalidos.');
    if (typeof sdk.onValue !== 'function') throw new Error('SDK sem suporte a listeners.');
    let closed = false;
    let detach = () => {};
    let events = Promise.resolve();
    const stop = () => { if (closed) return; closed = true; detach(); };
    const fail = error => {
      if (closed) return;
      stop();
      onError(error);
    };
    Promise.resolve().then(check).then(profile => {
      if (closed) return;
      const target = alvo(profile);
      if (target === null) { next(convert(null)); return; }  // nada que ele possa ver: entrega vazio
      if (target === undefined) return;                       // alvo ja' respondeu sozinho (leitura unica)
      // Varias consultas (ex.: dateStr "in" [hoje, amanha], 2026-11-19): escuta cada uma e entrega a uniao, so' depois
      // que todas responderam a 1a vez (sem entregar meia lista).
      const alvos = Array.isArray(target) ? target : [target];
      const valores = new Array(alvos.length), recebido = new Array(alvos.length).fill(false);
      const desligar = alvos.map((alvoK, k) => sdk.onValue(alvoK, snapshot => {
        valores[k] = snapshot.val(); recebido[k] = true;
        if (!recebido.every(Boolean)) return;
        const valor = alvos.length === 1 ? valores[0] : Object.assign({}, ...valores.map(v => v || {}));
        events = events.then(async () => {
          if (closed) return;
          // Revalida antes de entregar cada evento; as regras do banco continuam obrigatorias.
          await check();
          if (!closed) next(convert(valor));
        }).catch(fail);
      }, fail));
      detach = () => desligar.forEach(f => f());
      if (closed) detach();
    }).catch(fail);
    return stop;
  }
  function watchDoc(collection, id, next, onError) {
    let entregue = false;
    return watch(profile => {
      if (!ehTransportador(profile)) return sdk.ref(database, recordPath(collection, id));
      // Transportador: escuta so' o que a leitura dele permite; o resto chega como "nao existe".
      if (CAMPO_TRANSPORTADORA[collection] || (collection === 'config' && CONFIG_LIVRE.has(id))) return sdk.ref(database, recordPath(collection, id));
      getDocTransportador(profile, collection, id).then(s => { if (!entregue) { entregue = true; next(s); } }).catch(onError || (() => {}));
      return undefined;
    }, value => documentSnapshot(collection, id, value), snap => { entregue = true; next(snap); }, error => {
      // Registro de outra transportadora/inexistente para o transportador: "nao existe", sem derrubar a tela
      if (negado(error)) next(ausente(collection, id)); else (onError || (() => {}))(error);
    });
  }
  function watchDocs(collection, constraints, next, onError) {
    if (!COLLECTION_PATHS[collection]) throw new Error('Colecao nao mapeada.');
    let previous = [];
    return watch(profile => {
      if (ehTransportador(profile)) return consultaTransportador(profile, collection, constraints);
      // Equipe interna: escuta so' o filtro com indice (ex.: so' hoje e amanha), nao a colecao inteira (2026-11-19).
      const caminho = COLLECTION_PATHS[collection];
      const filtros = sdk.query && sdk.orderByChild && sdk.equalTo ? filtrosServidor(collection, constraints) : null;
      return filtros
        ? filtros.map(f => sdk.query(sdk.ref(database, caminho), sdk.orderByChild('dados/' + f.campo), sdk.equalTo(f.valor)))
        : sdk.ref(database, caminho);
    }, value => {
      const snapshot = querySnapshot(collection, constraints, value, previous);
      previous = snapshot.docs;
      return snapshot;
    }, next, onError);
  }
  return Object.freeze({getDoc, getDocs, watchDoc, watchDocs});
}
