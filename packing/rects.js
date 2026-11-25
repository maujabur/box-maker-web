/*
 * Geometria de retângulos para o plano de corte: validação e medição das sobras.
 * Sem dependências, sem DOM. Funciona no navegador (BoxPack.rects), no Node e em Web Workers.
 *
 * Retângulo: { x, y, w, h } em mm. Área útil da chapa: { x0, y0, x1, y1 } (já sem a margem,
 * que é descarte).
 */
(function boxpackModule(root) {
  'use strict';

  const TOL = 1e-6; // tolerância de ponto flutuante: distância 0 permite contato, nunca sobreposição

  const area = r => r.w * r.h;

  /*
   * Maior retângulo livre (de lados paralelos aos eixos) dentro de `box`, sem cobrir nenhum obstáculo.
   * Cálculo exato: cada borda esquerda candidata (borda da área ou lado direito de um obstáculo) varre
   * os obstáculos para a direita, mantendo os intervalos verticais ainda livres. Contato com obstáculos
   * não conta como sobreposição. Custo ~ O(n² · intervalos).
   * minSide > 0 ignora retângulos com algum lado menor que isso.
   */
  function largestEmptyRect(obstacles, box, minSide) {
    const ms = minSide > 0 ? minSide : 0;
    const obs = [];
    for (const o of obstacles) {
      const x0 = Math.max(o.x, box.x0), x1 = Math.min(o.x + o.w, box.x1);
      const y0 = Math.max(o.y, box.y0), y1 = Math.min(o.y + o.h, box.y1);
      if (x1 - x0 > TOL && y1 - y0 > TOL) obs.push({ x0, x1, y0, y1 });
    }
    obs.sort((a, b) => a.x0 - b.x0);
    const lefts = [box.x0];
    for (const o of obs) lefts.push(o.x1);
    lefts.sort((a, b) => a - b);

    let best = null, bestA = 0;
    const consider = (xl, xr, g) => {
      const w = xr - xl, h = g[1] - g[0];
      if (w < ms - TOL || h < ms - TOL || w <= TOL || h <= TOL) return;
      const a = w * h;
      if (a > bestA + TOL) { bestA = a; best = { x: xl, y: g[0], w, h }; }
    };
    let prev = NaN;
    for (const xl of lefts) {
      if (xl >= box.x1 - TOL || Math.abs(xl - prev) <= TOL) continue; // sem largura, ou repetida
      prev = xl;
      let gaps = [[box.y0, box.y1]];
      for (const o of obs) {
        if (o.x1 <= xl + TOL) continue; // totalmente à esquerda da borda
        if (o.x0 > xl + TOL) for (const g of gaps) consider(xl, o.x0, g); // largura até este obstáculo
        // o obstáculo corta os intervalos que ele atravessa
        const next = [];
        for (const g of gaps) {
          if (o.y1 <= g[0] + TOL || o.y0 >= g[1] - TOL) { next.push(g); continue; }
          if (o.y0 > g[0] + TOL) next.push([g[0], o.y0]);
          if (o.y1 < g[1] - TOL) next.push([o.y1, g[1]]);
        }
        gaps = next;
        if (!gaps.length) break;
      }
      for (const g of gaps) consider(xl, box.x1, g);
    }
    return best;
  }


  /*
   * Todos os retângulos livres maximais (nenhum contém outro) dentro de `box`, fora dos obstáculos.
   * Mesma varredura de largestEmptyRect; no fim descarta os contidos em outros.
   */
  function maximalEmptyRects(obstacles, box) {
    const obs = [];
    for (const o of obstacles) {
      const x0 = Math.max(o.x, box.x0), x1 = Math.min(o.x + o.w, box.x1);
      const y0 = Math.max(o.y, box.y0), y1 = Math.min(o.y + o.h, box.y1);
      if (x1 - x0 > TOL && y1 - y0 > TOL) obs.push({ x0, x1, y0, y1 });
    }
    obs.sort((a, b) => a.x0 - b.x0);
    const lefts = [box.x0];
    for (const o of obs) lefts.push(o.x1);
    lefts.sort((a, b) => a - b);
    const found = [];
    const emit = (xl, xr, g) => {
      if (xr - xl > TOL && g[1] - g[0] > TOL) found.push({ x: xl, y: g[0], w: xr - xl, h: g[1] - g[0] });
    };
    let prev = NaN;
    for (const xl of lefts) {
      if (xl >= box.x1 - TOL || Math.abs(xl - prev) <= TOL) continue;
      prev = xl;
      let gaps = [[box.y0, box.y1]];
      for (const o of obs) {
        if (o.x1 <= xl + TOL) continue;
        if (o.x0 > xl + TOL) for (const g of gaps) emit(xl, o.x0, g);
        const next = [];
        for (const g of gaps) {
          if (o.y1 <= g[0] + TOL || o.y0 >= g[1] - TOL) { next.push(g); continue; }
          if (o.y0 > g[0] + TOL) next.push([g[0], o.y0]);
          if (o.y1 < g[1] - TOL) next.push([o.y1, g[1]]);
        }
        gaps = next;
        if (!gaps.length) break;
      }
      for (const g of gaps) emit(xl, box.x1, g);
    }
    return found.filter((r, i) => !found.some((q, j) => j !== i &&
      r.x >= q.x - TOL && r.y >= q.y - TOL && r.x + r.w <= q.x + q.w + TOL && r.y + r.h <= q.y + q.h + TOL &&
      (j < i || !(Math.abs(r.x - q.x) <= TOL && Math.abs(r.y - q.y) <= TOL && Math.abs(r.w - q.w) <= TOL && Math.abs(r.h - q.h) <= TOL))));
  }

  // Área da união de retângulos (compressão de coordenadas; para listas pequenas, dezenas de retângulos)
  function unionArea(rects) {
    if (!rects.length) return 0;
    const xs = [...new Set(rects.flatMap(r => [r.x, r.x + r.w]))].sort((a, b) => a - b);
    let a = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      if (x1 - x0 <= TOL) continue;
      const iv = rects.filter(r => r.x <= x0 + TOL && r.x + r.w >= x1 - TOL).map(r => [r.y, r.y + r.h]).sort((p, q) => p[0] - q[0]);
      let len = 0, s = -Infinity, e = -Infinity;
      for (const [y0, y1] of iv) {
        if (y0 > e) { if (e > s) len += e - s; s = y0; e = y1; } else if (y1 > e) e = y1;
      }
      if (e > s) len += e - s;
      a += len * (x1 - x0);
    }
    return a;
  }

  /*
   * Área livre utilizável por peças de lado mínimo L: área coberta pelos retângulos livres maximais com os
   * dois lados >= L (equivale a "onde cabe um quadrado L × L"). Um vão preso entre peças só conta se for
   * largo o bastante; o mesmo vão junto de uma faixa livre conta com a largura das duas somadas.
   */
  function reachArea(obstacles, box, L) {
    return unionArea(maximalEmptyRects(obstacles, box).filter(r => r.w >= L - TOL && r.h >= L - TOL));
  }

  /*
   * Sobras úteis sem sobreposição: tira o maior retângulo livre, trata-o como ocupado e repete.
   * Só conta retângulos com os dois lados >= minSide. Devolve a lista em ordem decrescente de área.
   */
  function usefulRects(obstacles, box, minSide, maxCount) {
    const out = [];
    const occ = obstacles.slice();
    const limit = maxCount > 0 ? maxCount : 8;
    while (out.length < limit) {
      const r = largestEmptyRect(occ, box, minSide);
      if (!r) break;
      out.push(r);
      occ.push(r);
    }
    return out;
  }

  /*
   * Confere uma chapa: peças dentro da área útil e sem sobreposição.
   * `rects`: caixas das peças. `gap`: distância mínima entre contornos (>= 0).
   * Duas peças estão separadas se a distância nos eixos X ou Y é >= gap (como no empacotador).
   * Devolve a lista de problemas (vazia = válida).
   */
  function validateSheet(rects, box, gap) {
    const g = Math.max(0, gap || 0);
    const errs = [];
    rects.forEach((r, i) => {
      if (r.x < box.x0 - TOL || r.y < box.y0 - TOL || r.x + r.w > box.x1 + TOL || r.y + r.h > box.y1 + TOL) {
        errs.push(`peça ${i} fora da área útil`);
      }
    });
    const order = rects.map((r, i) => i).sort((a, b) => rects[a].x - rects[b].x);
    for (let a = 0; a < order.length; a++) {
      const p = rects[order[a]];
      for (let b = a + 1; b < order.length; b++) {
        const q = rects[order[b]];
        if (q.x >= p.x + p.w + g - TOL) break; // ordenado por x: as demais estão ainda mais longe
        const sepY = q.y >= p.y + p.h + g - TOL || p.y >= q.y + q.h + g - TOL;
        if (!sepY) errs.push(`peças ${order[a]} e ${order[b]} sobrepostas ou mais perto que ${g} mm`);
      }
    }
    return errs;
  }

  const api = { TOL, area, largestEmptyRect, maximalEmptyRects, unionArea, reachArea, usefulRects, validateSheet };
  const ns = root.BoxPack || (root.BoxPack = {});
  ns.rects = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
