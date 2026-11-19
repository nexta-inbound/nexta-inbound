// Contrato v1: envelope por registro preserva nulos, mapas vazios e listas.
export function encodeKey(value) {
  if (typeof value !== 'string' || !value) throw new Error('Chave vazia ou invalida.');
  const encoded = /[.#$\[\]/\x00-\x1f\x7f]/.test(value) || value.startsWith('~')
    ? '~' + btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    : value;
  if (new TextEncoder().encode(encoded).length > 768) throw new Error('Chave excede limite Realtime.');
  return encoded;
}

export function decodeKey(value) {
  if (!value.startsWith('~')) return value;
  const text = value.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
}

const OMIT = Symbol('omit');
export function toEnvelope(original) {
  const formats = [], visited = new Set();
  function normalize(value, path, depth) {
    // Prefixo de colecao/registro, envelope/dados e campos: maximo 32 niveis.
    if (depth + 3 > 32) throw new Error('Profundidade excede o limite Realtime.');
    if (value === null) { formats.push([path, 'null']); return OMIT; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Numero nao representavel com seguranca.');
      return value;
    }
    if (['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value !== 'object' || visited.has(value)) throw new Error('Tipo nao suportado ou referencia circular.');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Objeto exige conversao explicita.');
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Chaves simbolicas nao suportadas.');
    visited.add(value);
    let entries;
    if (Array.isArray(value)) {
      formats.push([path, 'array']);
      entries = Array.from(value, (child, i) => ['i' + String(i).padStart(8, '0'), child]);
    } else {
      entries = Object.entries(value).map(([k, v]) => [encodeKey(k), v]);
      if (!entries.length) formats.push([path, 'emptyMap']);
    }
    const result = [];
    for (const [k, v] of entries) {
      const child = normalize(v, path + '/' + k, depth + 1);
      if (child !== OMIT) result.push([k, child]);
    }
    visited.delete(value);
    return result.length ? Object.fromEntries(result) : OMIT;
  }
  const data = normalize(original, '', 0);
  const envelope = {existe: true};
  if (data !== OMIT) envelope.dados = data;
  if (formats.length) envelope.formatos = Object.fromEntries(formats.map(([p, kind]) => [encodeKey('p' + p), kind]));
  return envelope;
}

export function fromEnvelope(envelope) {
  if (!envelope || envelope.existe !== true) return undefined;
  const formats = Object.fromEntries(Object.entries(envelope.formatos || {}).map(([k, v]) => [decodeKey(k).slice(1), v]));
  function restore(value, path) {
    const kind = formats[path];
    if (kind === 'null') return null;
    if (kind === 'emptyMap') return {};
    if (kind === 'array' || value === OMIT || (value && typeof value === 'object')) {
      const current = value !== OMIT && value && typeof value === 'object' ? value : {};
      // SDK Realtime pode materializar mapas numericos como arrays com buracos null.
      // Nulos reais ficam nos metadados, nunca nas folhas persistidas.
      const children = new Set(Object.keys(current).filter(child => current[child] !== null));
      const prefix = path + '/';
      for (const special of Object.keys(formats)) {
        if (special.startsWith(prefix)) children.add(special.slice(prefix.length).split('/')[0]);
      }
      const names = [...children].sort();
      const pairs = names.map(child => [child, restore(Object.hasOwn(current, child) ? current[child] : OMIT, prefix + child)]);
      if (kind === 'array') {
        if (names.some((name, i) => name !== 'i' + String(i).padStart(8, '0'))) throw new Error('Lista nao contigua no Realtime.');
        return pairs.map(([, child]) => child);
      }
      return Object.fromEntries(pairs.map(([name, child]) => [decodeKey(name), child]));
    }
    return value;
  }
  return restore(Object.hasOwn(envelope, 'dados') ? envelope.dados : OMIT, '');
}

export const COLLECTION_PATHS = Object.freeze({
  availability: 'disponibilidades', locks: 'bloqueiosDisponibilidade', sob_ciclos: 'ciclos',
  telao_programacao: 'programacaoDiaria', devolucoesReentregas: 'devolucoesReentregas',
  freteSimulacoes: 'simulacoesFrete', otimizador_eventos: 'eventosOtimizador',
  archives: 'arquivosHistoricos', config: 'configuracoesLegadas',
  otimizador_parametros: 'parametrosOtimizador', whatsapp_robo: 'whatsappRobo', whatsapp_fila: 'whatsappFila',
  // Listas "so' acrescenta" (17/11/2026): cada acao/aviso e' um registro novo, em vez de regravar um documento
  // unico com tudo (config/audit_log e config/notifications), o que o transportador nao pode fazer.
  auditoria: 'auditoria', notificacoes: 'notificacoes'
});

export function recordPath(collection, id) {
  if (!COLLECTION_PATHS[collection]) throw new Error('Colecao nao mapeada: ' + collection);
  return COLLECTION_PATHS[collection] + '/' + encodeKey(id);
}
