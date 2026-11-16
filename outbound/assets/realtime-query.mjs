// Filtros de compatibilidade para piloto interno; nao e autorizacao de transportador.
export function fieldValue(value, path) {
  return path.split('.').reduce((current, field) => current != null && Object.hasOwn(current, field) ? current[field] : undefined, value);
}

function compare(a, b) {
  const rank = v => v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : -1;
  const ra = rank(a), rb = rank(b);
  if (ra < 0 || rb < 0) throw new Error('Ordenacao de objetos ou valores ausentes nao suportada.');
  return ra !== rb ? Math.sign(ra - rb) : a === b ? 0 : a < b ? -1 : 1;
}

export function applyQuery(records, constraints = []) {
  let rows = [...records];
  const orders = [];
  let maximum;
  for (const c of constraints) {
    if (c.kind === 'where') {
      if (!['==', '<', '<=', '>', '>=', 'in'].includes(c.op)) throw new Error('Operador nao suportado: ' + c.op);
      if (c.op === 'in' && (!Array.isArray(c.value) || !c.value.length)) throw new Error('Filtro in exige lista nao vazia.');
      rows = rows.filter(row => {
        const value = fieldValue(row.data, c.field);
        if (value === undefined) return false;
        if (c.op === '==') return value === c.value;
        if (c.op === 'in') return c.value.includes(value);
        if (value === null || c.value === null || typeof value !== typeof c.value) return false;
        const n = compare(value, c.value);
        return c.op === '<' ? n < 0 : c.op === '<=' ? n <= 0 : c.op === '>' ? n > 0 : n >= 0;
      });
    } else if (c.kind === 'orderBy') {
      if (!['asc', 'desc'].includes(c.direction)) throw new Error('Direcao de ordenacao invalida.');
      orders.push(c);
    } else if (c.kind === 'limit') {
      if (!Number.isInteger(c.count) || c.count < 1 || maximum !== undefined) throw new Error('Limite invalido ou repetido.');
      maximum = c.count;
    } else throw new Error('Restricao desconhecida.');
  }
  rows = rows.filter(row => orders.every(c => fieldValue(row.data, c.field) !== undefined));
  rows.sort((a, b) => {
    for (const c of orders) {
      const n = compare(fieldValue(a.data, c.field), fieldValue(b.data, c.field));
      if (n) return n * (c.direction === 'desc' ? -1 : 1);
    }
    return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * (orders.at(-1)?.direction === 'desc' ? -1 : 1);
  });
  return maximum === undefined ? rows : rows.slice(0, maximum);
}
