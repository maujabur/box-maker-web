/*
 * Algoritmo de empacotamento original do Box Maker (referência e candidato do motor).
 * Código movido de geometry.js sem alteração de lógica, para poder rodar também em Web Worker.
 * Sempre entra na lista de candidatos, de modo que o motor nunca devolva pior que ele.
 *
 * Funciona sobre itens { id, w, h, fixed } e devolve soluções do motor ({ sheets: [{ rects }] }).
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});

  /*
   * Organização das peças em chapas (retângulos envolventes, com rotação de 90° quando o veio permite).
   * Chapa a chapa: procura o arranjo das peças que sobraram (MaxRects) e fica com o melhor; o que não
   * coube segue para a próxima chapa. "Melhor", nesta ordem:
   *   1. maior área de peças na chapa (menos chapas no total);
   *   2. maior retângulo livre que sobra (sobra contínua, aproveitável);
   *   3. arranjo mais compacto (menor retângulo que envolve as peças).
   * Até 6 peças testa todas as ordens e rotações; acima disso usa ordens heurísticas e uma busca local
   * com sorteio de semente fixa (o mesmo projeto gera sempre o mesmo plano).
   */

  // rots[k]: 0 = como está, 1 = gira 90°, 2 = livre (escolhe a orientação que encaixa melhor)
  function packOne(pieces, order, rots, aw, ah, gap, dedupe) {
    let free = [{ x: 0, y: 0, w: aw, h: ah }];
    const placed = [];
    // menor medida entre as peças: quando nenhum espaço livre comporta, a chapa está cheia
    let minSide = Infinity;
    for (const i of order) minSide = Math.min(minSide, pieces[i].w + gap, pieces[i].h + gap);
    let failed = dedupe ? new Set() : null; // tamanhos que já não couberam no estado atual (peças repetidas)
    for (let k = 0; k < order.length; k++) {
      const pc = pieces[order[k]];
      const rs = rots[k];
      const key = failed && pc.w + 'x' + pc.h + 'r' + rs;
      if (failed && failed.has(key)) continue;
      let best = null, bs = Infinity, brot = 0;
      for (const r of (rs === 2 ? [0, 1] : [rs])) {
        const w = (r ? pc.h : pc.w) + gap, h = (r ? pc.w : pc.h) + gap;
        for (const f of free) {
          if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
            const sc = Math.min(f.w - w, f.h - h);
            if (sc < bs) { bs = sc; best = f; brot = r; }
          }
        }
      }
      if (!best) { if (failed) failed.add(key); continue; } // esta peça não coube; tenta as seguintes
      const w = (brot ? pc.h : pc.w) + gap, h = (brot ? pc.w : pc.h) + gap;
      const u = { x: best.x, y: best.y, w, h };
      placed.push({ pc, x: u.x, y: u.y, rot: brot, w, h });
      if (failed) failed = new Set();
      const nf = [];
      for (const f of free) {
        if (u.x >= f.x + f.w || u.x + u.w <= f.x || u.y >= f.y + f.h || u.y + u.h <= f.y) { nf.push(f); continue; }
        if (u.x > f.x) nf.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
        if (u.x + u.w < f.x + f.w) nf.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
        if (u.y > f.y) nf.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
        if (u.y + u.h < f.y + f.h) nf.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
      }
      free = nf.filter((r, i) => !nf.some((q, j) => j !== i && r.x >= q.x && r.y >= q.y &&
        r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h && (j < i || !(r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h))));
      if (!free.some(f => Math.max(f.w, f.h) >= minSide - 1e-9 && Math.min(f.w, f.h) >= minSide - 1e-9)) break;
    }
    return { placed, free };
  }

  // nota de um arranjo, comparada em ordem (ver comentário acima); números inteiros para empatar de verdade
  // tie = 'free': desempata pela maior sobra contínua; 'compact': pelo arranjo mais compacto
  function sheetScore(r, gap, tie) {
    let area = 0, mx = 0, my = 0, big = 0;
    for (const q of r.placed) { area += (q.w - gap) * (q.h - gap); mx = Math.max(mx, q.x + q.w); my = Math.max(my, q.y + q.h); }
    for (const f of r.free) big = Math.max(big, f.w * f.h);
    const a = Math.round(area), b = Math.round(big), c = -Math.round(mx * my);
    return tie === 'free' ? [a, b, c] : [a, c, b];
  }
  function better(a, b) {
    if (!b) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }

  function permutations(a) {
    if (a.length <= 1) return [a];
    const out = [];
    a.forEach((x, i) => permutations(a.filter((_, j) => j !== i)).forEach(p => out.push([x, ...p])));
    return out;
  }

  // gerador pseudoaleatório com semente (resultados reproduzíveis)
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // fixedRot[i]: -1 = livre (0° ou 90°), 0 = não gira, 1 = gira 90° (por causa do veio)
  function bestSheet(pieces, aw, ah, gap, fixedRot, tie) {
    const n = pieces.length;
    let best = null, bestS = null;
    const tryIt = (order, rots) => {
      const r = packOne(pieces, order, rots, aw, ah, gap, n > 6);
      if (!r.placed.length) return null;
      const s = sheetScore(r, gap, tie);
      if (better(s, bestS)) { bestS = s; best = r.placed; }
      return s;
    };
    if (n <= 6) {
      for (const order of permutations([...Array(n).keys()])) {
        const base = order.map(i => (fixedRot[i] === 1 ? 1 : 0));
        const freePos = [];
        order.forEach((i, k) => { if (fixedRot[i] === -1) freePos.push(k); });
        for (let sub = 0; sub < (1 << freePos.length); sub++) {
          const rots = base.slice();
          freePos.forEach((k, j) => { if ((sub >> j) & 1) rots[k] = 1; });
          tryIt(order, rots);
        }
      }
      return best || [];
    }
    // muitas peças: ordens heurísticas, com rotação livre escolhida peça a peça
    const rotOf = i => (fixedRot[i] === -1 ? 2 : fixedRot[i]);
    const idx = [...Array(n).keys()];
    const simple = tie === 'simple';
    const keys = simple ? [p => p.w * p.h] : [
      p => p.w * p.h, p => Math.max(p.w, p.h), p => p.w, p => p.h, p => p.w + p.h, p => Math.min(p.w, p.h),
    ];
    let cur = null, curS = null;
    for (const kf of keys) {
      const order = idx.slice().sort((i, j) => kf(pieces[j]) - kf(pieces[i]) || i - j);
      const s = tryIt(order, order.map(rotOf));
      if (s && better(s, curS)) { cur = order; curS = s; }
      // também testa todas as rotações das primeiras peças livres (as demais escolhem sozinhas)
      const freePos = [];
      const maxBits = n > 60 ? 4 : 8; // com muitas peças, menos combinações (o tempo cresce com n)
      order.forEach((i, k) => { if (fixedRot[i] === -1 && freePos.length < maxBits) freePos.push(k); });
      for (let sub = 0; sub < (1 << freePos.length); sub++) {
        const rots = order.map(rotOf);
        freePos.forEach((k, j) => { rots[k] = (sub >> j) & 1; });
        tryIt(order, rots);
      }
    }
    // busca local: troca duas peças de lugar na ordem e fica com o resultado se não piorar
    const iters = simple || n > 200 ? 0 : Math.min(1500, Math.floor(30000 / n));
    const rand = rng(n * 7919 + Math.round(aw) * 31 + Math.round(ah));
    for (let it = 0; cur && it < iters; it++) {
      const o = cur.slice();
      const a = Math.floor(rand() * n), b = Math.floor(rand() * n);
      if (a === b) continue;
      [o[a], o[b]] = [o[b], o[a]];
      const s = tryIt(o, o.map(rotOf));
      if (s && !better(curS, s)) { cur = o; curS = s; }
    }
    return best || [];
  }


  // ---------- várias chapas ao mesmo tempo ----------
  // Encaixe de uma peça no melhor espaço livre de uma chapa (menor sobra no lado mais curto).
  function fitIn(free, pc, rs, gap) {
    let best = null, bs = Infinity;
    for (const r of (rs === 2 ? [0, 1] : [rs])) {
      const w = (r ? pc.h : pc.w) + gap, h = (r ? pc.w : pc.h) + gap;
      for (const f of free) {
        if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
          const sc = Math.min(f.w - w, f.h - h);
          if (sc < bs) { bs = sc; best = { x: f.x, y: f.y, w, h, rot: r }; }
        }
      }
    }
    return best;
  }
  function splitFree(free, u) {
    const nf = [];
    for (const f of free) {
      if (u.x >= f.x + f.w || u.x + u.w <= f.x || u.y >= f.y + f.h || u.y + u.h <= f.y) { nf.push(f); continue; }
      if (u.x > f.x) nf.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (u.x + u.w < f.x + f.w) nf.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
      if (u.y > f.y) nf.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (u.y + u.h < f.y + f.h) nf.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
    }
    return nf.filter((r, i) => !nf.some((q, j) => j !== i && r.x >= q.x && r.y >= q.y &&
      r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h && (j < i || !(r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h))));
  }
  // Coloca as peças na ordem dada, cada uma na primeira chapa onde couber (abre outra se preciso).
  // Diferente do método chapa a chapa, uma chapa não "gasta" as peças pequenas que as outras precisam.
  function packMulti(pieces, order, rots, aw, ah, gap) {
    const bins = [];
    for (let k = 0; k < order.length; k++) {
      const pc = pieces[order[k]];
      let done = false;
      for (const bin of bins) {
        const u = fitIn(bin.free, pc, rots[k], gap);
        if (u) { bin.placed.push(Object.assign({ pc }, u)); bin.free = splitFree(bin.free, u); bin.area += pc.w * pc.h; done = true; break; }
      }
      if (done) continue;
      const bin = { free: [{ x: 0, y: 0, w: aw, h: ah }], placed: [], area: 0 };
      const u = fitIn(bin.free, pc, rots[k], gap);
      if (!u) return null; // não deveria acontecer: peças maiores que a chapa são tiradas antes
      bin.placed.push(Object.assign({ pc }, u)); bin.free = splitFree(bin.free, u); bin.area += pc.w * pc.h;
      bins.push(bin);
    }
    return bins;
  }
  // menos chapas; empate: a última chapa mais vazia (as outras mais cheias)
  const multiScore = bins => [-bins.length, -Math.round(bins[bins.length - 1].area)];


  // método chapa a chapa (referência/legacy). Devolve uma solução do motor.
  function* planSteps(ctx, tie) {
    const { aw, ah, gap } = ctx;
    let remaining = ctx.pieces.slice();
    const total = remaining.length;
    const sheets = [];
    while (remaining.length) {
      const placed = bestSheet(remaining, aw, ah, gap, remaining.map(pc => pc.fixed), tie);
      if (!placed.length) throw new Error('Peça sem lugar numa chapa vazia (deveria ter sido separada como grande demais).');
      sheets.push(ctx.sheetOf(placed));
      const used = new Set(placed.map(q => q.pc));
      remaining = remaining.filter(pc => !used.has(pc));
      if (remaining.length) yield { pieces: total, placed: total - remaining.length };
    }
    return { sheets };
  }

  // método várias chapas ao mesmo tempo (referência/legacy)
  function* multiSteps(ctx) {
    const { aw, ah, gap } = ctx;
    const sheets = [];
    const pieces = ctx.pieces;
    const n = pieces.length;
    if (!n) return { sheets };
    const rotOf = i => (pieces[i].fixed === -1 ? 2 : pieces[i].fixed);
    const idx = [...Array(n).keys()];
    const keys = [p => p.w * p.h, p => p.w, p => p.h, p => Math.max(p.w, p.h), p => p.w + p.h];
    let best = null, bestS = null, cur = null, curS = null;
    const tryIt = order => {
      const bins = packMulti(pieces, order, order.map(rotOf), aw, ah, gap);
      if (!bins) return null;
      const s = multiScore(bins);
      if (better(s, bestS)) { best = bins; bestS = s; }
      return s;
    };
    for (const kf of keys) {
      const order = idx.slice().sort((i, j) => kf(pieces[j]) - kf(pieces[i]) || i - j);
      const s = tryIt(order);
      if (s && better(s, curS)) { cur = order; curS = s; }
    }
    // busca local na ordem: troca duas peças; aceita se não piorar (anda por planos equivalentes)
    const iters = n > 300 ? 0 : Math.min(4000, Math.floor(120000 / n));
    const rand = rng(n * 104729 + Math.round(aw) * 17 + Math.round(ah));
    for (let it = 0; cur && it < iters; it++) {
      const o = cur.slice();
      const a = Math.floor(rand() * n), b = Math.floor(rand() * n);
      if (a === b) continue;
      [o[a], o[b]] = [o[b], o[a]];
      const s = tryIt(o);
      if (s && !better(curS, s)) { cur = o; curS = s; }
      if (it % 200 === 199) yield { pieces: n, placed: Math.round((n * (it + 1)) / iters) };
    }
    // cada chapa: rearranja as mesmas peças pelo critério de sobra contínua (se todas couberem)
    for (const bin of best) {
      const ps = bin.placed.map(q => q.pc);
      let placed = bin.placed;
      if (ps.length <= 12) {
        const alt = bestSheet(ps, aw, ah, gap, ps.map(pc => pc.fixed), 'free');
        if (alt.length === ps.length) placed = alt;
      }
      sheets.push(ctx.sheetOf(placed));
    }
    return { sheets };
  }


  // Estratégias de referência. Até 6 peças a busca chapa a chapa já é completa.
  function build(problem) {
    const { items, width, height, gap } = problem;
    const ctx = {
      aw: width + gap, ah: height + gap, gap, pieces: items,
      // posições do método (com a folga embutida no tamanho) -> chapa da solução (tamanho real das peças)
      sheetOf: placed => ({ rects: placed.map(q => ({ item: q.pc, x: q.x, y: q.y, w: q.w - gap, h: q.h - gap, rot: q.rot })) }),
    };
    const variants = ['free', 'compact', 'simple', 'multi'];
    if (items.length <= 6) variants.splice(2, 2);
    return variants.map(v => ({ id: 'legacy-' + v, run: () => (v === 'multi' ? multiSteps(ctx) : planSteps(ctx, v)) }));
  }

  const api = { build, fitIn };
  ns.legacy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
})(typeof window !== 'undefined' ? window : globalThis);
