/*
 * Refinamento de uma solução válida: só desloca e redistribui peças, nunca altera tamanhos nem
 * contornos. Cada operação devolve uma solução nova (a original não é modificada) ou null se não
 * melhorou. Quem decide se o resultado vale é o ranking (engine.js).
 *
 *   compactSheet   desliza as peças até um canto da chapa (4 cantos x 2 ordens de eixo), deixando a
 *                  sobra contínua do lado oposto;
 *   reshapeSheet   reposiciona as peças de uma chapa com todos os algoritmos e fica com o arranjo de
 *                  melhor sobra (a chapa continua com as mesmas peças);
 *   fillHoles      tenta passar as peças de uma chapa para os espaços livres das outras (elimina a chapa);
 *   reduceTail     reempacota as peças das k chapas mais vazias em menos de k chapas.
 *
 * Todas usam as mesmas regras de distância (gap) e de limites da área útil da validação.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const dep = (n, f) => ns[n] || (typeof require === 'function' ? require(f) : null);
  const R = dep('rects', './rects.js');
  const RK = dep('ranking', './ranking.js');
  const TOL = 1e-6;

  const boxOf = p => ({ x0: 0, y0: 0, x1: p.width, y1: p.height });
  const cloneRects = rects => rects.map(q => Object.assign({}, q));
  const usedArea = rects => rects.reduce((a, q) => a + q.w * q.h, 0);
  const getE = () => ns.engine || require('./engine.js');
  const getS = () => ns.strategies || require('./strategies.js');

  // melhor/pior de duas listas de retângulos de UMA chapa (mesmos critérios do ranking, sem o número de chapas)
  function sheetBetter(p, a, b) {
    return RK.compare(RK.evaluate({ sheets: [{ rects: a }] }, p), RK.evaluate({ sheets: [{ rects: b }] }, p)) > 0;
  }

  // ---------- compactação ----------
  // Desliza as peças para o 0 do eixo. Peça q bloqueia p se está antes dela no eixo e não está separada
  // por >= gap no outro eixo (mesma regra da validação).
  function slide(rects, axis, gap) {
    const a = axis, b = axis === 'x' ? 'y' : 'x', la = axis === 'x' ? 'w' : 'h', lb = axis === 'x' ? 'h' : 'w';
    const order = rects.map((_, i) => i).sort((i, j) => rects[i][a] - rects[j][a]);
    let moved = false;
    for (const i of order) {
      const p = rects[i];
      let pos = 0;
      for (const j of order) {
        if (j === i) continue;
        const q = rects[j];
        if (q[a] + q[la] > p[a] + TOL) continue;                                  // não está antes de p
        if (q[b] >= p[b] + p[lb] + gap - TOL || q[b] + q[lb] <= p[b] - gap + TOL) continue; // separada no outro eixo
        pos = Math.max(pos, q[a] + q[la] + gap);
      }
      if (pos < p[a] - TOL) { p[a] = pos; moved = true; }
    }
    return moved;
  }
  const reflect = (rects, W, H, fx, fy) => rects.forEach(q => { if (fx) q.x = W - q.x - q.w; if (fy) q.y = H - q.y - q.h; });

  // Variantes de compactação de uma chapa: [canto x ordem dos eixos]. Cada uma é uma lista nova de retângulos.
  function compactVariants(rects, p) {
    const out = [];
    for (const fx of [false, true]) for (const fy of [false, true]) for (const first of ['x', 'y']) {
      const r = cloneRects(rects);
      reflect(r, p.width, p.height, fx, fy);
      for (let it = 0; it < 6; it++) {
        const m1 = slide(r, first, p.gap), m2 = slide(r, first === 'x' ? 'y' : 'x', p.gap);
        if (!m1 && !m2) break;
      }
      reflect(r, p.width, p.height, fx, fy);
      out.push(r);
    }
    return out;
  }

  // Melhor arranjo entre a chapa atual e suas compactações (null se nenhuma melhora)
  function compactSheet(p, rects) {
    let best = rects, improved = false;
    for (const v of compactVariants(rects, p)) {
      if (sheetBetter(p, v, best)) { best = v; improved = true; }
    }
    return improved ? best : null;
  }

  // ---------- reposicionar uma chapa ----------
  function reshapeSheet(p, rects, level) {
    if (rects.length < 2) return null;
    const E = getE(), S = getS();
    const sub = { items: rects.map(q => q.item), width: p.width, height: p.height, gap: p.gap };
    const out = E.runSync(sub, S.build(sub, level === 'light' ? 'fast' : 'balanced'), {});
    if (!out.best || out.best.solution.sheets.length !== 1) return null;
    const cand = out.best.solution.sheets[0].rects;
    return sheetBetter(p, cand, rects) ? cand : null;
  }

  // ---------- passar peças para os espaços livres de outras chapas ----------
  function freeRects(p, rects) {
    const g = p.gap, b = boxOf(p);
    return R.maximalEmptyRects(rects.map(q => ({ x: q.x - g, y: q.y - g, w: q.w + 2 * g, h: q.h + 2 * g })), b);
  }
  function fitInto(item, free) {
    const rots = item.fixed === -1 ? [0, 1] : [item.fixed];
    let best = null;
    for (const r of rots) {
      const w = r ? item.h : item.w, h = r ? item.w : item.h;
      for (const f of free) {
        if (w > f.w + TOL || h > f.h + TOL) continue;
        const sc = Math.min(f.w - w, f.h - h), sc2 = Math.max(f.w - w, f.h - h);
        if (!best || sc < best.sc - TOL || (Math.abs(sc - best.sc) <= TOL && sc2 < best.sc2)) best = { x: f.x, y: f.y, w, h, rot: r, sc, sc2 };
      }
    }
    return best;
  }

  // Tenta esvaziar a chapa `s` movendo todas as suas peças para os espaços livres das demais.
  function emptySheet(p, sheets, s) {
    const others = sheets.map((sh, i) => (i === s ? null : cloneRects(sh.rects)));
    const caches = others.map(r => (r ? freeRects(p, r) : null));
    const ps = sheets[s].rects.map(q => q.item);
    for (const order of [(a, b) => b.w * b.h - a.w * a.h, (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h)]) {
      const rs = others.map(r => (r ? cloneRects(r) : null)), fr = caches.map(f => (f ? f.slice() : null));
      let ok = true;
      for (const it of ps.slice().sort(order)) {
        let best = null, bi = -1;
        for (let i = 0; i < rs.length; i++) {
          if (!rs[i]) continue;
          const c = fitInto(it, fr[i]);
          if (c && (!best || c.sc < best.sc - TOL)) { best = c; bi = i; }
        }
        if (!best) { ok = false; break; }
        rs[bi].push({ item: it, x: best.x, y: best.y, w: best.w, h: best.h, rot: best.rot });
        fr[bi] = freeRects(p, rs[bi]);
      }
      if (ok) return rs.filter(Boolean);
    }
    return null;
  }

  function fillHoles(p, sol) {
    let sheets = sol.sheets.map(sh => ({ rects: sh.rects }));
    let changed = false;
    for (;;) {
      if (sheets.length < 2) break;
      const order = sheets.map((_, i) => i).sort((i, j) => usedArea(sheets[i].rects) - usedArea(sheets[j].rects));
      let done = false;
      for (const s of order.slice(0, 2)) { // as duas mais vazias
        const rs = emptySheet(p, sheets, s);
        if (rs) { sheets = rs.map(r => ({ rects: r })); changed = true; done = true; break; }
      }
      if (!done) break;
    }
    return changed ? { sheets } : null;
  }

  // ---------- reempacotar a cauda ----------
  function reduceTail(p, sol) {
    const E = getE(), S = getS();
    let sheets = sol.sheets.map(sh => ({ rects: sh.rects }));
    let changed = false, again = true;
    while (again) {
      again = false;
      const order = sheets.map((_, i) => i).sort((i, j) => usedArea(sheets[i].rects) - usedArea(sheets[j].rects));
      for (let k = 2; k <= Math.min(4, sheets.length - 1) && !again; k++) {
        const pick = order.slice(0, k);
        const items = pick.flatMap(i => sheets[i].rects.map(q => q.item));
        const sub = { items, width: p.width, height: p.height, gap: p.gap };
        const out = E.runSync(sub, S.build(sub, items.length > 60 ? 'fast' : 'balanced'), {});
        if (out.best && out.best.solution.sheets.length < k) {
          const keep = sheets.filter((_, i) => !pick.includes(i));
          sheets = keep.concat(out.best.solution.sheets.map(sh => ({ rects: sh.rects })));
          changed = true; again = true;
        }
      }
    }
    return changed ? { sheets } : null;
  }

  /*
   * Refinamento completo de uma solução. level:
   *   'light' só compactação; 'full' redistribuição entre chapas, reposicionamento e compactação.
   * Devolve uma solução nova (ou a mesma, se nada melhorou).
   */
  function improve(problem, solution, level) {
    let sol = { name: solution.name, sheets: solution.sheets.map(sh => ({ rects: sh.rects })) };
    let changed = false;
    if (level !== 'light') {
      for (const step of [fillHoles, reduceTail]) {
        const r = step(problem, sol);
        if (r) { sol = r; changed = true; }
      }
    }
    // chapas mais vazias primeiro; com muitas chapas, só as 8 mais vazias passam pelo reposicionamento
    const order = sol.sheets.map((_, i) => i).sort((i, j) => usedArea(sol.sheets[i].rects) - usedArea(sol.sheets[j].rects));
    const limit = level === 'light' ? 0 : 8;
    sol.sheets = sol.sheets.map(sh => ({ rects: sh.rects }));
    order.forEach((i, rank) => {
      let rects = sol.sheets[i].rects;
      if (rank < limit) {
        const r = reshapeSheet(problem, rects, level);
        if (r) { rects = r; changed = true; }
      }
      if (rank < Math.max(limit, 8)) {
        const c = compactSheet(problem, rects);
        if (c) { rects = c; changed = true; }
      }
      sol.sheets[i] = { rects };
    });
    if (!changed) return solution;
    sol.name = (solution.name || 'solução') + '+refino';
    return sol;
  }

  const api = { compactVariants, compactSheet, reshapeSheet, fillHoles, reduceTail, improve, slide };
  ns.refine = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
