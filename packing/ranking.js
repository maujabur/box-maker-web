/*
 * Classificação das soluções, separada dos algoritmos de posicionamento.
 *
 * Solução: { sheets: [{ rects: [{ item, x, y, w, h, rot }] }] }
 *   x, y, w, h em mm, na área útil da chapa (a margem de descarte já foi tirada);
 *   w e h são o tamanho real da peça, sem a folga (gap).
 * Problema: { width, height, gap, items, minUseful? } (width/height = área útil de cada chapa;
 *   minUseful = menor lado, em mm, de uma sobra útil; padrão 50).
 *
 * Ordem de prioridade (a validade é verificada antes, em engine.js, e é obrigatória):
 *   1. menos chapas;
 *   2. maior sobra retangular do trabalho (área do maior retângulo livre, em qualquer chapa);
 *   3. maior área de sobras úteis, sem sobreposição (retângulos livres com os dois lados >= minUseful);
 *   4. menos retângulos úteis (menos fragmentação);
 *   4b. maior alcance das sobras ("bolsões"): soma, para L = 2 e 3 vezes o menor lado útil, da área livre
 *      onde cabe um quadrado L × L (rects.reachArea). Vão preso entre peças conta pouco; o mesmo vão junto
 *      de uma faixa livre conta com a largura somada das duas.
 *   5. menor fronteira: comprimento da borda entre as peças e a sobra (sem contar as bordas da chapa).
 *      Peças juntas, encostadas nos cantos e nas bordas, e sobra em uma região só, têm fronteira curta;
 *      sobras em ilhas ou em "pente" têm fronteira longa. Mede compactação e continuidade de uma vez.
 * Os critérios 2 a 5 são calculados só quando necessários (quando os anteriores empatam).
 * As tolerâncias são relativas ao tamanho da chapa, para diferenças pequenas não decidirem sozinhas.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const R = ns.rects || (typeof require === 'function' ? require('./rects.js') : null);

  const DEFAULTS = { minUseful: 50, maxUseful: 8, reachLevels: [2, 3] };

  // value(m) -> número; dir: 'max' | 'min'; tol(m): diferença abaixo da qual há empate (m.sheetArea = área útil de uma chapa)
  const CRITERIA = [
    { id: 'sheets', dir: 'min', tol: () => 0, value: m => m.sheets },
    { id: 'bigArea', dir: 'max', tol: m => 0.0025 * m.sheetArea, value: m => m.get('bigArea') },
    { id: 'usefulArea', dir: 'max', tol: m => 0.01 * m.sheetArea, value: m => m.get('usefulArea') },
    { id: 'usefulCount', dir: 'min', tol: () => 0, value: m => m.get('usefulCount') },
    { id: 'reach', dir: 'max', tol: m => 0.005 * m.sheetArea, value: m => m.get('reach') },
    { id: 'frontier', dir: 'min', tol: m => 0.005 * (m.width + m.height), value: m => m.get('frontier') },
  ];

  // Critérios da busca iterativa (mais baratos que os do ranking final): além do número de chapas, guia a busca
  // para esvaziar a chapa mais vazia (concentra a sobra numa chapa), depois maior sobra e fronteira.
  const SEARCH_CRITERIA = [
    CRITERIA[0],
    { id: 'tailUsed', dir: 'min', tol: m => 0.002 * m.sheetArea, value: m => m.get('tailUsed') },
    CRITERIA[1],
    CRITERIA[5],
  ];

  // Comprimento da borda das peças voltada para a sobra, sem as bordas da chapa (compressão de coordenadas).
  function frontier(rects, problem) {
    const W = problem.width, H = problem.height;
    if (!rects.length) return 0;
    const xs = [0, W], ys = [0, H];
    for (const q of rects) { xs.push(q.x, q.x + q.w); ys.push(q.y, q.y + q.h); }
    const ux = [...new Set(xs.map(v => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
    const uy = [...new Set(ys.map(v => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
    const ix = new Map(ux.map((v, i) => [v, i])), iy = new Map(uy.map((v, i) => [v, i]));
    const nx = ux.length - 1, ny = uy.length - 1;
    const occ = new Uint8Array(nx * ny);
    for (const q of rects) {
      const a = ix.get(Math.round(q.x * 1e4) / 1e4), b = ix.get(Math.round((q.x + q.w) * 1e4) / 1e4);
      const c = iy.get(Math.round(q.y * 1e4) / 1e4), d = iy.get(Math.round((q.y + q.h) * 1e4) / 1e4);
      for (let i = a; i < b; i++) for (let j = c; j < d; j++) occ[i * ny + j] = 1;
    }
    let len = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (!occ[i * ny + j]) continue;
      if (i > 0 && !occ[(i - 1) * ny + j]) len += uy[j + 1] - uy[j];
      if (i < nx - 1 && !occ[(i + 1) * ny + j]) len += uy[j + 1] - uy[j];
      if (j > 0 && !occ[i * ny + j - 1]) len += ux[i + 1] - ux[i];
      if (j < ny - 1 && !occ[i * ny + j + 1]) len += ux[i + 1] - ux[i];
    }
    return len;
  }

  const box = p => ({ x0: 0, y0: 0, x1: p.width, y1: p.height });

  // Métricas de uma solução; os valores caros são calculados sob demanda (por chapa) e guardados.
  function evaluate(solution, problem, options) {
    // menor lado de uma sobra útil: das opções, do problema (configuração do usuário) ou o padrão
    const opt = Object.assign({}, DEFAULTS, problem.minUseful != null ? { minUseful: problem.minUseful } : {}, options);
    const b = box(problem);
    const cache = {};
    const sheets = solution.sheets;
    const info = sheets.map(() => ({}));
    const part = (i, name) => {
      const o = info[i];
      if (!(name in o)) {
        const rects = sheets[i].rects;
        switch (name) {
          case 'used': o.used = rects.reduce((a, r) => a + r.w * r.h, 0); break;
          case 'envelope': { let x1 = 0, y1 = 0; for (const r of rects) { x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); } o.envelope = x1 * y1; break; }
          case 'big': o.big = R.largestEmptyRect(rects, b, 0); break;
          case 'useful': o.useful = R.usefulRects(rects, b, opt.minUseful, opt.maxUseful); break;
          case 'frontier': o.frontier = frontier(rects, problem); break;
          case 'reach': o.reach = opt.reachLevels.reduce((a, k) => a + R.reachArea(rects, b, Math.max(1, k * opt.minUseful)), 0); break;
          default: throw new Error('métrica de chapa desconhecida: ' + name);
        }
      }
      return o[name];
    };
    const idx = sheets.map((_, i) => i);
    const m = {
      sheets: sheets.length, width: problem.width, height: problem.height, sheetArea: problem.width * problem.height,
      get(name) {
        if (!(name in cache)) cache[name] = compute(name);
        return cache[name];
      },
    };
    function compute(name) {
      switch (name) {
        case 'perSheet': return idx.map(i => ({ used: part(i, 'used'), big: part(i, 'big'), useful: part(i, 'useful'), envelope: part(i, 'envelope'), frontier: part(i, 'frontier') }));
        case 'bigArea': return idx.reduce((a, i) => { const r = part(i, 'big'); return Math.max(a, r ? R.area(r) : 0); }, 0);
        case 'usefulArea': return idx.reduce((a, i) => a + part(i, 'useful').reduce((c, r) => c + R.area(r), 0), 0);
        case 'usefulCount': return idx.reduce((a, i) => a + part(i, 'useful').length, 0);
        case 'frontier': return idx.reduce((a, i) => a + part(i, 'frontier'), 0);
        case 'reach': return idx.reduce((a, i) => a + part(i, 'reach'), 0);
        case 'tailUsed': return idx.length ? Math.min(...idx.map(i => part(i, 'used'))) : 0; // área ocupada na chapa mais vazia
        default: throw new Error('métrica desconhecida: ' + name);
      }
    }
    return m;
  }

  // > 0 se `a` é melhor que `b`, < 0 se pior, 0 se empatam em todos os critérios
  function compare(a, b, criteria) {
    for (const c of (criteria || CRITERIA)) {
      const va = c.value(a), vb = c.value(b);
      if (Math.abs(va - vb) <= c.tol(a)) continue;
      return (c.dir === 'max' ? va - vb : vb - va) > 0 ? 1 : -1;
    }
    return 0;
  }

  const api = { DEFAULTS, CRITERIA, SEARCH_CRITERIA, evaluate, compare, frontier };
  ns.ranking = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
