/*
 * Estratégias de posicionamento: só posicionam; validação e classificação ficam em engine.js e ranking.js.
 *
 * Algoritmos (todos sobre retângulos, com giro de 90° quando o item permite):
 *   - MaxRects, com as heurísticas BSSF, BLSF, BAF, Bottom-Left e Contact Point;
 *   - Guillotine, com regras de escolha (BAF, BSSF, BLSF) e de divisão (horizontal, vertical, eixo curto/longo...);
 *   - Shelf (prateleiras horizontais ou verticais);
 *   - Blocos de peças iguais: peças com a mesma forma viram retângulos (fileiras x colunas) que são
 *     posicionados como uma peça só pelos algoritmos acima (híbrido); o que sobra é preenchido por eles.
 * Cada algoritmo é combinado com várias ordenações das peças.
 *
 * Item: { id, w, h, fixed, shape }.  fixed: -1 livre, 0 não gira, 1 gira 90° (obrigatório).
 * Problema: { items, width, height, gap }. Dentro dos algoritmos o espaço é "inflado" pelo gap
 * (chapa width+gap, peça w+gap), de modo que a distância mínima vale também nas bordas internas;
 * as soluções saem com o tamanho real das peças.
 *
 * Os algoritmos são independentes da origem das peças (qualquer caixa, qualquer modelo): só veem itens.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const E = 1e-9;
  const close = (a, b) => Math.abs(a - b) <= 1e-7;

  // ---------- ordenações ----------
  const ORDERS = {
    area: it => it.w * it.h,
    perimeter: it => it.w + it.h,
    longest: it => Math.max(it.w, it.h),
    width: it => it.w,
    height: it => it.h,
    ratio: it => Math.max(it.w, it.h) / Math.max(Math.min(it.w, it.h), 1e-6),
  };
  const sortBy = (items, name) => {
    const f = ORDERS[name];
    return items.slice().sort((a, b) => f(b) - f(a) || b.w * b.h - a.w * a.h || a.id - b.id);
  };

  // orientações permitidas; force (0/1) escolhe uma delas para item livre (gene da busca iterativa)
  const orientations = (it, force) => (it.fixed !== -1 ? [it.fixed] : close(it.w, it.h) ? [0] : force === 0 || force === 1 ? [force] : [0, 1]);

  // ---------- MaxRects ----------
  function prune(list) {
    return list.filter((r, i) => !list.some((q, j) => j !== i && r.x >= q.x - E && r.y >= q.y - E &&
      r.x + r.w <= q.x + q.w + E && r.y + r.h <= q.y + q.h + E &&
      (j < i || !(close(r.x, q.x) && close(r.y, q.y) && close(r.w, q.w) && close(r.h, q.h)))));
  }
  function splitMaxRects(free, u) {
    const nf = [];
    for (const f of free) {
      if (u.x >= f.x + f.w - E || u.x + u.w <= f.x + E || u.y >= f.y + f.h - E || u.y + u.h <= f.y + E) { nf.push(f); continue; }
      if (u.x > f.x + E) nf.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (u.x + u.w < f.x + f.w - E) nf.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
      if (u.y > f.y + E) nf.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (u.y + u.h < f.y + f.h - E) nf.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
    }
    return prune(nf);
  }
  const overlap1 = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  function contactScore(bin, x, y, w, h, W, H) {
    let s = 0;
    if (close(x, 0) || close(x + w, W)) s += h;
    if (close(y, 0) || close(y + h, H)) s += w;
    for (const p of bin.placed) {
      if (close(p.x, x + w) || close(p.x + p.w, x)) s += overlap1(y, y + h, p.y, p.y + p.h);
      if (close(p.y, y + h) || close(p.y + p.h, y)) s += overlap1(x, x + w, p.x, p.x + p.w);
    }
    return s;
  }
  // pontuação (menor = melhor) de pôr w×h no canto do retângulo livre f
  function mrScore(heur, f, w, h, bin, W, H) {
    const lw = f.w - w, lh = f.h - h;
    switch (heur) {
      case 'bssf': return [Math.min(lw, lh), Math.max(lw, lh)];
      case 'blsf': return [Math.max(lw, lh), Math.min(lw, lh)];
      case 'baf': return [f.w * f.h - w * h, Math.min(lw, lh)];
      case 'bl': return [f.y + h, f.x];
      case 'cp': return [-contactScore(bin, f.x, f.y, w, h, W, H), Math.min(lw, lh)];
      default: throw new Error('heurística desconhecida: ' + heur);
    }
  }
  const lessScore = (a, b) => a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1] - 1e-9);

  const maxRectsOps = (W, H, gap, heur) => ({
    newBin: () => ({ free: [{ x: 0, y: 0, w: W, h: H }], placed: [] }),
    find(bin, it, force) {
      let best = null;
      for (const r of orientations(it, force)) {
        const w = (r ? it.h : it.w) + gap, h = (r ? it.w : it.h) + gap;
        for (const f of bin.free) {
          if (w > f.w + E || h > f.h + E) continue;
          const sc = mrScore(heur, f, w, h, bin, W, H);
          if (!best || lessScore(sc, best.sc)) best = { x: f.x, y: f.y, w, h, rot: r, sc };
        }
      }
      return best;
    },
    commit(bin, it, pl) {
      bin.placed.push({ item: it, x: pl.x, y: pl.y, w: pl.w, h: pl.h, rot: pl.rot });
      bin.free = splitMaxRects(bin.free, pl);
    },
  });

  // ---------- Guillotine ----------
  function mergeFree(free) {
    let again = true;
    while (again) {
      again = false;
      for (let i = 0; i < free.length && !again; i++) {
        for (let j = i + 1; j < free.length; j++) {
          const a = free[i], b = free[j];
          if (close(a.y, b.y) && close(a.h, b.h) && (close(a.x + a.w, b.x) || close(b.x + b.w, a.x))) {
            free[i] = { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h }; free.splice(j, 1); again = true; break;
          }
          if (close(a.x, b.x) && close(a.w, b.w) && (close(a.y + a.h, b.y) || close(b.y + b.h, a.y))) {
            free[i] = { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h }; free.splice(j, 1); again = true; break;
          }
        }
      }
    }
  }
  function guScore(heur, f, w, h) {
    const lw = f.w - w, lh = f.h - h;
    switch (heur) {
      case 'baf': return [f.w * f.h - w * h, Math.min(lw, lh)];
      case 'bssf': return [Math.min(lw, lh), Math.max(lw, lh)];
      case 'blsf': return [Math.max(lw, lh), Math.min(lw, lh)];
      default: throw new Error('heurística desconhecida: ' + heur);
    }
  }
  // true = divisão horizontal: a sobra da direita fica só na altura da peça e a de cima na largura toda
  function splitHorizontal(rule, f, w, h) {
    const lw = f.w - w, lh = f.h - h;
    switch (rule) {
      case 'h': return true;
      case 'v': return false;
      case 'sas': return lw <= lh;          // eixo curto da sobra
      case 'las': return lw > lh;           // eixo longo da sobra
      case 'minarea': return w * lh > lw * h; // deixa uma das sobras o maior possível
      case 'maxarea': return w * lh <= lw * h;
      default: throw new Error('regra de divisão desconhecida: ' + rule);
    }
  }
  const guillotineOps = (W, H, gap, heur, rule) => ({
    newBin: () => ({ free: [{ x: 0, y: 0, w: W, h: H }], placed: [] }),
    find(bin, it, force) {
      let best = null;
      for (const r of orientations(it, force)) {
        const w = (r ? it.h : it.w) + gap, h = (r ? it.w : it.h) + gap;
        bin.free.forEach((f, fi) => {
          if (w > f.w + E || h > f.h + E) return;
          const sc = guScore(heur, f, w, h);
          if (!best || lessScore(sc, best.sc)) best = { x: f.x, y: f.y, w, h, rot: r, sc, fi };
        });
      }
      return best;
    },
    commit(bin, it, pl) {
      const f = bin.free[pl.fi];
      bin.placed.push({ item: it, x: pl.x, y: pl.y, w: pl.w, h: pl.h, rot: pl.rot });
      const rw = f.w - pl.w, rh = f.h - pl.h;
      const hor = splitHorizontal(rule, f, pl.w, pl.h);
      const right = hor ? { x: f.x + pl.w, y: f.y, w: rw, h: pl.h } : { x: f.x + pl.w, y: f.y, w: rw, h: f.h };
      const top = hor ? { x: f.x, y: f.y + pl.h, w: f.w, h: rh } : { x: f.x, y: f.y + pl.h, w: pl.w, h: rh };
      bin.free.splice(pl.fi, 1);
      if (right.w > E && right.h > E) bin.free.push(right);
      if (top.w > E && top.h > E) bin.free.push(top);
      if (bin.free.length < 400) mergeFree(bin.free);
    },
  });

  // ---------- Shelf ----------
  // dir 'h': prateleiras horizontais (empilhadas em y); 'v': verticais (lado a lado em x).
  // pref: orientação das peças livres dentro da prateleira: 'wide' (lado maior ao longo dela), 'tall', 'any'.
  function shelfOps(W, H, gap, dir, pref) {
    const U = dir === 'h' ? W : H, V = dir === 'h' ? H : W; // U ao longo da prateleira, V entre prateleiras
    const frame = (it, r) => {
      const w = (r ? it.h : it.w) + gap, h = (r ? it.w : it.h) + gap;
      return dir === 'h' ? [w, h, w, h] : [h, w, w, h]; // [u, v, w, h]
    };
    return {
      newBin: () => ({ shelves: [], vUsed: 0, placed: [] }),
      find(bin, it, force) {
        const attempt = usePref => {
          let best = null;
          for (const r of orientations(it, force)) {
            const [u, v, w, h] = frame(it, r);
            if (usePref && it.fixed === -1 && !close(u, v) && (pref === 'wide' ? u < v : u > v)) continue;
            if (u > U + E || v > V + E) continue;
            bin.shelves.forEach((s, si) => {
              if (v <= s.v + E && s.u + u <= U + E) {
                const sc = s.v - v;
                if (!best || sc < best.sc) best = { shelf: si, w, h, rot: r, sc, dirU: u, dirV: v };
              }
            });
            if (bin.vUsed + v <= V + E) {
              const sc = 1e9 + v;
              if (!best || sc < best.sc) best = { shelf: -1, w, h, rot: r, sc, dirU: u, dirV: v };
            }
          }
          return best;
        };
        // preferência de orientação; se não houver lugar assim, aceita qualquer orientação permitida
        return attempt(pref !== 'any') || (pref !== 'any' ? attempt(false) : null);
      },
      commit(bin, it, pl) {
        if (pl.shelf === -1) { bin.shelves.push({ pos: bin.vUsed, v: pl.dirV, u: 0 }); bin.vUsed += pl.dirV; }
        const s = bin.shelves[pl.shelf === -1 ? bin.shelves.length - 1 : pl.shelf];
        const x = dir === 'h' ? s.u : s.pos, y = dir === 'h' ? s.pos : s.u;
        s.u += pl.dirU;
        bin.placed.push({ item: it, x, y, w: pl.w, h: pl.h, rot: pl.rot });
      },
    };
  }

  // ---------- empacotamento em várias chapas ----------
  // Cada item vai para a primeira chapa onde couber; senão abre outra. null se algum item não cabe numa chapa vazia.
  // forces[k] (opcional): orientação forçada do k-ésimo item da ordem (-1 = o algoritmo escolhe)
  function multiBin(order, ops, forces) {
    const bins = [];
    for (let k = 0; k < order.length; k++) {
      const it = order[k], f = forces ? forces[k] : -1;
      let done = false;
      for (const bin of bins) {
        const pl = ops.find(bin, it, f);
        if (pl) { ops.commit(bin, it, pl); done = true; break; }
      }
      if (done) continue;
      const bin = ops.newBin();
      const pl = ops.find(bin, it, f);
      if (!pl) return null;
      ops.commit(bin, it, pl);
      bins.push(bin);
    }
    return bins;
  }

  // ---------- blocos de peças iguais ----------
  /*
   * Divide `count` peças iguais (célula a×b, já com gap) em blocos c×r (colunas × fileiras) que cabem
   * na chapa W×H. mode: 'rows' = fileiras de largura total; 'cols' = colunas de altura total;
   * 'square' = blocos próximos de um quadrado.
   */
  function blockShapes(count, a, b, W, H, mode) {
    const cmax = Math.max(1, Math.floor(W / a + 1e-9)), rmax = Math.max(1, Math.floor(H / b + 1e-9));
    const out = [];
    let left = count;
    while (left > 0) {
      let c, r;
      if (mode === 'rows') { c = cmax; r = Math.min(rmax, Math.floor(left / c)); if (r < 1) { c = left; r = 1; } }
      else if (mode === 'cols') { r = rmax; c = Math.min(cmax, Math.floor(left / r)); if (c < 1) { r = left; c = 1; } }
      else {
        c = Math.min(cmax, Math.max(1, Math.round(Math.sqrt(left * b / a))));
        r = Math.min(rmax, Math.floor(left / c));
        if (r < 1) { r = 1; c = left; }
      }
      out.push({ c, r });
      left -= c * r;
    }
    return out;
  }

  let blockSeq = 0;
  /*
   * Troca grupos de peças iguais por blocos. Devolve a lista de "embalagens" (blocos e peças soltas).
   * orient: 'base' mantém a orientação dos itens; 'best' escolhe a que cabe mais por chapa;
   *         'mixed' faz metade do grupo em cada orientação (só para itens livres).
   */
  function makeBlocks(problem, mode, orient) {
    const { width: W0, height: H0, gap } = problem;
    const W = W0 + gap, H = H0 + gap;
    const groups = new Map();
    for (const it of problem.items) {
      if (!groups.has(it.shape)) groups.set(it.shape, []);
      groups.get(it.shape).push(it);
    }
    const out = [];
    for (const list of groups.values()) {
      if (list.length < 2) { out.push(...list); continue; }
      const it0 = list[0];
      const free = it0.fixed === -1;
      // [orientação-base dos membros, quantos] por parte do grupo
      let parts;
      const perSheet = r => {
        const a = (r ? it0.h : it0.w) + gap, b = (r ? it0.w : it0.h) + gap;
        return Math.floor(W / a + 1e-9) * Math.floor(H / b + 1e-9);
      };
      if (!free) parts = [[it0.fixed, list.length]];
      else if (orient === 'mixed') parts = [[0, Math.ceil(list.length / 2)], [1, Math.floor(list.length / 2)]];
      else if (orient === 'best') parts = [[perSheet(1) > perSheet(0) ? 1 : 0, list.length]];
      else parts = [[0, list.length]];
      let at = 0;
      for (const [base, n] of parts) {
        if (!n) continue;
        const members = list.slice(at, at + n); at += n;
        const mw = base ? it0.h : it0.w, mh = base ? it0.w : it0.h;
        const a = mw + gap, b = mh + gap;
        let k = 0;
        for (const { c, r } of blockShapes(n, a, b, W, H, mode)) {
          const cell = members.slice(k, k + c * r); k += c * r;
          if (cell.length === 1) { out.push(cell[0]); continue; }
          out.push({
            id: -1 - (blockSeq++), w: c * a - gap, h: r * b - gap, fixed: free ? -1 : 0, shape: 'block',
            members: cell.map((m, i) => ({ item: m, dx: (i % c) * a, dy: Math.floor(i / c) * b, w: mw, h: mh, rot: base })),
          });
        }
      }
    }
    return out;
  }

  // Troca os blocos de uma solução pelas peças que os formam (mesmo giro do bloco aplicado a cada peça).
  function expandBlocks(sol) {
    for (const sh of sol.sheets) {
      if (!sh.rects.some(q => q.item.members)) continue;
      const rects = [];
      for (const q of sh.rects) {
        if (!q.item.members) { rects.push(q); continue; }
        for (const m of q.item.members) {
          rects.push(q.rot
            ? { item: m.item, x: q.x + m.dy, y: q.y + m.dx, w: m.h, h: m.w, rot: m.rot ^ 1 }
            : { item: m.item, x: q.x + m.dx, y: q.y + m.dy, w: m.w, h: m.h, rot: m.rot });
        }
      }
      sh.rects = rects;
    }
    return sol;
  }

  // ---------- montagem de soluções ----------
  function opsFor(spec, problem) {
    const W = problem.width + problem.gap, H = problem.height + problem.gap, gap = problem.gap;
    switch (spec.algo) {
      case 'maxrects': return maxRectsOps(W, H, gap, spec.heur);
      case 'guillotine': return guillotineOps(W, H, gap, spec.heur, spec.split);
      case 'shelf': return shelfOps(W, H, gap, spec.dir, spec.pref);
      default: throw new Error('algoritmo desconhecido: ' + spec.algo);
    }
  }
  function pack(problem, order, spec, forces) {
    const bins = multiBin(order, opsFor(spec, problem), forces);
    if (!bins) return null;
    const g = problem.gap;
    return expandBlocks({
      sheets: bins.map(b => ({ rects: b.placed.map(q => ({ item: q.item, x: q.x, y: q.y, w: q.w - g, h: q.h - g, rot: q.rot })) })),
    });
  }

  const label = spec => [spec.algo, spec.heur || spec.dir, spec.split || spec.pref].filter(Boolean).join('-');

  // Soluções de um algoritmo, uma por ordenação.
  function runSpec(problem, spec, orders, packables) {
    const out = [];
    for (const o of orders) {
      const sol = pack(problem, sortBy(packables || problem.items, o), spec);
      if (sol) { sol.name = label(spec) + ':' + o + (spec.blocks ? ':' + spec.blocks : ''); out.push(sol); }
    }
    return out;
  }

  const ALL_ORDERS = ['area', 'perimeter', 'longest', 'width', 'height', 'ratio'];
  const MR_HEURS = ['bssf', 'blsf', 'baf', 'bl', 'cp'];

  /*
   * Lista de estratégias de um modo:
   *   fast     poucas combinações, para atualização frequente durante a edição;
   *   balanced MaxRects (5 heurísticas x 6 ordenações), Guillotine, Shelf e blocos de peças iguais.
   * (A busca iterativa do modo intensivo é montada à parte.)
   */
  function build(problem, mode) {
    const fast = mode === 'fast';
    const strategies = [];
    const add = (id, fn) => strategies.push({ id, run: fn });

    for (const h of (fast ? ['bssf', 'baf', 'cp'] : MR_HEURS)) {
      add('maxrects-' + h, p => runSpec(p, { algo: 'maxrects', heur: h }, fast ? ['area', 'longest'] : ALL_ORDERS));
    }
    const gu = fast ? [['baf', 'sas']] : [['baf', 'sas'], ['baf', 'las'], ['baf', 'h'], ['baf', 'v'], ['bssf', 'sas'], ['bssf', 'minarea'], ['blsf', 'sas'], ['blsf', 'maxarea']];
    for (const [h, s] of gu) add(`guillotine-${h}-${s}`, p => runSpec(p, { algo: 'guillotine', heur: h, split: s }, fast ? ['area', 'longest'] : ['area', 'perimeter', 'longest', 'width', 'height']));
    const shelves = fast ? [['h', 'wide']] : [['h', 'wide'], ['h', 'tall'], ['v', 'wide'], ['v', 'tall']];
    for (const [d, pr] of shelves) add(`shelf-${d}-${pr}`, p => runSpec(p, { algo: 'shelf', dir: d, pref: pr }, ['height', 'area', 'longest']));

    // blocos de peças iguais + preenchimento pelos demais algoritmos
    const repeated = new Set(problem.items.map(i => i.shape)).size < problem.items.length;
    if (repeated) {
      const modes = fast ? ['rows', 'cols'] : ['rows', 'cols', 'square'];
      const orients = fast ? ['best'] : ['best', 'mixed', 'base'];
      const packers = fast ? [{ algo: 'maxrects', heur: 'bssf' }, { algo: 'maxrects', heur: 'cp' }]
        : [{ algo: 'maxrects', heur: 'bssf' }, { algo: 'maxrects', heur: 'baf' }, { algo: 'maxrects', heur: 'cp' }, { algo: 'maxrects', heur: 'bl' }, { algo: 'guillotine', heur: 'baf', split: 'sas' }];
      for (const m of modes) for (const o of orients) {
        add(`blocks-${m}-${o}`, p => {
          const packables = makeBlocks(p, m, o);
          const out = [];
          for (const pk of packers) out.push(...runSpec(p, Object.assign({ blocks: m + '/' + o }, pk), fast ? ['area'] : ['area', 'longest'], packables));
          return out;
        });
      }
    }
    return strategies;
  }

  const api = { ORDERS, ALL_ORDERS, MR_HEURS, sortBy, blockShapes, makeBlocks, expandBlocks, pack, runSpec, build, label };
  ns.strategies = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
