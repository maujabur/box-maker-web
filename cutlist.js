/*
 * Lista de corte: regras puras, sem DOM e sem dependências.
 * Funciona no navegador (window.BoxCut) e no Node (module.exports), como geometry.js.
 *
 * Linha da lista: { id, name, qty, excluir: { peça: n }, box }
 *   qty      quantidade de caixas da linha
 *   excluir  unidades de cada peça que ficam fora do plano (já produzidas ou adiadas)
 *   box      configuração da caixa (a mesma de G.build)
 * A quantidade a cortar de uma peça é qty menos o que foi excluído (mínimo 0).
 */
(function (root) {
  'use strict';

  // nomes internos das peças (os mesmos de G.build: panel.name)
  const PIECE_KEYS = ['front', 'back', 'left', 'right', 'bottom', 'lid'];
  const MAX_QTY = 999;
  const clamp = n => Math.min(MAX_QTY, Math.max(0, Math.round(+n || 0)));

  // { peça: n } só com chaves de peça conhecidas e n inteiro > 0
  function cleanExcl(x) {
    const o = {};
    if (x && typeof x === 'object') for (const k of PIECE_KEYS) { const n = clamp(x[k]); if (n > 0) o[k] = n; }
    return o;
  }

  // unidades da peça que ainda serão cortadas
  const leftOf = (e, name) => Math.max(0, e.qty - ((e.excluir && e.excluir[name]) || 0));
  // total de unidades a cortar da linha, e total sem exclusões (res = G.build da caixa)
  const totalLeft = (e, res) => (res ? res.panels.reduce((a, p) => a + leftOf(e, p.name), 0) : 0);
  const totalAll = (e, res) => (res ? res.panels.length * e.qty : 0);
  // a linha entra no plano: quantidade > 0 e alguma peça ainda a cortar (sem res, a caixa tem erro: conta)
  const hasWork = (e, res) => e.qty > 0 && (!res || res.panels.some(p => leftOf(e, p.name) > 0));

  // Linha vinda de projeto salvo (aceita campos ausentes, de versões antigas).
  // deps: { uid(), boxName(box), normBox(box) }
  function normalizeEntry(e, deps) {
    return {
      id: typeof e.id === 'string' && e.id ? e.id : deps.uid(),
      name: String(e.name || deps.boxName(e.box)).slice(0, 80),
      qty: clamp(e.qty),
      excluir: cleanExcl(e.excluir),
      box: deps.normBox(e.box),
    };
  }
  const normalizeList = (list, deps) => (Array.isArray(list) ? list : []).filter(e => e && e.box).map(e => normalizeEntry(e, deps));

  // cópia independente da linha, com novo id e nome (exclusões incluídas)
  const cloneEntry = (e, id, name) => ({ id, name, qty: e.qty, excluir: Object.assign({}, e.excluir), box: JSON.parse(JSON.stringify(e.box)) });

  // Linhas que entram no plano, com o resultado de build(box) ({ res } ou { error }) já anexado.
  function activeEntries(list, build) {
    return list.filter(e => e.qty > 0).map(e => Object.assign({}, e, build(e.box))).filter(e => hasWork(e, e.res));
  }

  // O que muda o plano na lista: se algo aqui muda, o plano em cache vale menos.
  const keyEntries = list => list.filter(e => e.qty > 0).map(e => [e.name, e.qty, e.box, e.excluir]);

  // Linhas -> jobs de G.planSetup / G.layout / G.toCSV
  const toJobs = entries => entries.map(e => ({
    res: e.res, qty: e.qty, excl: e.excluir, name: e.name, pieceGrain: e.box.pieceGrain || {}, t: e.box.t, kerf: e.box.kerf,
  }));

  const api = { PIECE_KEYS, cleanExcl, leftOf, totalLeft, totalAll, hasWork, normalizeEntry, normalizeList, cloneEntry, activeEntries, keyEntries, toJobs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BoxCut = api;
})(typeof window !== 'undefined' ? window : globalThis);
