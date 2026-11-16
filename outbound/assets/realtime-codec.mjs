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
  otimizador_parametros: 'parametrosOtimizador', whatsapp_robo: 'whatsappRobo', whatsapp_fila: 'whatsappFila'
});

export function recordPath(collection, id) {
  if (!COLLECTION_PATHS[collection]) throw new Error('Colecao nao mapeada: ' + collection);
  return COLLECTION_PATHS[collection] + '/' + encodeKey(id);
}
