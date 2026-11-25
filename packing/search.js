/*
 * Busca iterativa (modos equilibrado e intensivo).
 *
 * Uma solução é codificada por: ordem de inserção das peças, orientação de cada peça livre
 * (-1 = o algoritmo escolhe, 0/1 = forçada) e o algoritmo que decodifica (MaxRects com uma heurística,
 * ou Guillotine). A decodificação é o próprio empacotamento de strategies.js, então toda solução
 * gerada respeita veio, gap e limites da chapa (o motor valida de novo, de qualquer forma).
 *
 * Aceitação: Late Acceptance Hill Climbing (Burke & Bykov): aceita a vizinha se não for pior que a
 * solução de L passos atrás. Simples, sem parâmetros de temperatura, e escapa de ótimos locais rasos.
 * Reinício: sem melhora por muito tempo, recomeça de outra semente e de outro decodificador.
 *
 * Custo (menor = melhor), barato de calcular a cada passo:
 *   chapas + (área ocupada na chapa mais vazia) / (área da chapa) − 0,1 × (maior sobra da chapa mais vazia) / (área)
 * Esvaziar a chapa mais vazia é o caminho para eliminar uma chapa e concentra a sobra numa só.
 * A melhor de cada trecho vai para o motor como candidata, onde passa pelo ranking completo.
 *
 * Movimentos: passar uma peça da chapa mais vazia para antes na ordem; trocar duas peças; mover uma
 * peça; inverter um trecho; mudar a orientação de uma peça livre; trocar o decodificador.
 *
 * Reprodutível: com a mesma semente e o mesmo número de avaliações, o resultado é sempre o mesmo.
 * Com limite de tempo, o número de avaliações (e portanto o resultado) depende da máquina.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const dep = (n, f) => ns[n] || (typeof require === 'function' ? require(f) : null);
  const R = dep('rects', './rects.js');
  const S = dep('strategies', './strategies.js');

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // gerador pseudoaleatório com semente (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // semente padrão: depende só do problema (o mesmo trabalho gera sempre a mesma busca)
  function problemSeed(p) {
    let h = 2166136261 >>> 0;
    const mix = v => { h ^= Math.round(v * 100) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(p.width); mix(p.height); mix(p.gap); mix(p.items.length);
    for (const it of p.items) { mix(it.w); mix(it.h); mix(it.fixed + 2); }
    return h;
  }

  const DECODERS = [
    { algo: 'maxrects', heur: 'bssf' },
    { algo: 'maxrects', heur: 'bl' },
    { algo: 'maxrects', heur: 'baf' },
    { algo: 'maxrects', heur: 'cp' },
    { algo: 'guillotine', heur: 'baf', split: 'sas' },
  ];

  function lowerBound(p) {
    const a = p.items.reduce((s, it) => s + it.w * it.h, 0);
    return Math.max(1, Math.ceil(a / (p.width * p.height) - 1e-9));
  }

  // custo de uma solução decodificada (ver comentário no topo)
  function cost(p, sol) {
    const A = p.width * p.height;
    let tail = null, tailUsed = Infinity;
    for (const sh of sol.sheets) {
      const u = sh.rects.reduce((s, q) => s + q.w * q.h, 0);
      if (u < tailUsed) { tailUsed = u; tail = sh; }
    }
    const big = R.largestEmptyRect(tail.rects, { x0: 0, y0: 0, x1: p.width, y1: p.height }, 0);
    return sol.sheets.length + tailUsed / A - 0.1 * (big ? big.w * big.h : 0) / A;
  }

  // codificação a partir de uma solução: peças por chapa (na ordem das chapas), dentro dela por y e x
  function encode(sol, dec) {
    const seq = [], forces = [];
    for (const sh of sol.sheets) {
      const rs = sh.rects.slice().sort((a, b) => a.y - b.y || a.x - b.x);
      for (const q of rs) { seq.push(q.item); forces.push(q.item.fixed === -1 ? q.rot : -1); }
    }
    return { seq, forces, dec };
  }

  function decode(p, st) {
    return S.pack(p, st.seq, DECODERS[st.dec], st.forces);
  }

  function mutate(st, sol, rand) {
    const n = st.seq.length;
    const seq = st.seq.slice(), forces = st.forces.slice();
    let dec = st.dec;
    const ri = k => Math.floor(rand() * k);
    const r = rand();
    if (r < 0.3 && sol && sol.sheets.length > 1) {
      // uma peça da chapa mais vazia vai para uma posição anterior
      let tail = sol.sheets[0], tu = Infinity;
      for (const sh of sol.sheets) { const u = sh.rects.reduce((s, q) => s + q.w * q.h, 0); if (u < tu) { tu = u; tail = sh; } }
      const it = tail.rects[ri(tail.rects.length)].item;
      const from = seq.indexOf(it);
      if (from > 0) {
        const to = ri(from);
        const [x] = seq.splice(from, 1), [f] = forces.splice(from, 1);
        seq.splice(to, 0, x); forces.splice(to, 0, f);
      }
    } else if (r < 0.55) {
      const a = ri(n), b = ri(n);
      [seq[a], seq[b]] = [seq[b], seq[a]]; [forces[a], forces[b]] = [forces[b], forces[a]];
    } else if (r < 0.7) {
      const a = ri(n), b = ri(n);
      const [x] = seq.splice(a, 1), [f] = forces.splice(a, 1);
      seq.splice(b, 0, x); forces.splice(b, 0, f);
    } else if (r < 0.8) {
      const a = ri(n), len = 2 + ri(Math.min(6, n));
      const b = Math.min(n, a + len);
      const s1 = seq.slice(a, b).reverse(), f1 = forces.slice(a, b).reverse();
      seq.splice(a, b - a, ...s1); forces.splice(a, b - a, ...f1);
    } else if (r < 0.96) {
      // orientação de uma peça livre (não quadrada): -1 (o algoritmo escolhe), 0 ou 1
      for (let t = 0; t < 4; t++) {
        const k = ri(n);
        if (seq[k].fixed !== -1 || Math.abs(seq[k].w - seq[k].h) < 1e-7) continue;
        const opts = [-1, 0, 1].filter(v => v !== forces[k]);
        forces[k] = opts[ri(2)];
        break;
      }
    } else {
      dec = (dec + 1 + ri(DECODERS.length - 1)) % DECODERS.length;
    }
    return { seq, forces, dec };
  }

  /*
   * Gerador. seeds: soluções iniciais (as melhores das estratégias). opts:
   *   seed       semente (padrão: derivada do problema)
   *   maxEvals   número máximo de avaliações (padrão: sem limite)
   *   timeLimit  ms (padrão: sem limite; ao menos um dos dois deve existir)
   *   stall      avaliações sem melhora antes de reiniciar (padrão: proporcional ao número de peças)
   * Emite { evals, elapsed, limit, candidate? } a cada ~20 ms; devolve a melhor solução.
   */
  function* search(p, seeds, opts) {
    const o = Object.assign({}, opts);
    const n = p.items.length;
    if (n < 2) return null;
    const rand = rng(o.seed != null ? o.seed : problemSeed(p));
    const maxEvals = o.maxEvals > 0 ? o.maxEvals : Infinity;
    const limit = o.timeLimit > 0 ? o.timeLimit : Infinity;
    if (maxEvals === Infinity && limit === Infinity) throw new Error('busca sem limite de avaliações nem de tempo');
    const stall = o.stall > 0 ? o.stall : Math.max(400, 40 * n);
    const L = 40;
    // limite inferior: por área, ou o provado pela busca exata (o.minSheets)
    const lb = Math.max(lowerBound(p), o.minSheets || 0);
    const knownMin = seeds.reduce((m, s) => Math.min(m, s.sheets.length), Infinity);
    const t0 = now();

    // pontos de partida: sementes recebidas (com cada decodificador) e ordenações simples
    const starts = [];
    seeds.forEach((s, i) => starts.push(encode(s, i % DECODERS.length)));
    for (const ord of ['area', 'longest', 'perimeter']) {
      const seq = S.sortBy(p.items, ord);
      starts.push({ seq, forces: seq.map(() => -1), dec: starts.length % DECODERS.length });
    }

    let best = null, bestC = Infinity, evals = 0, lastYield = t0, startIdx = 0, lastGain = 0;
    // no limite inferior de chapas: com encaixe perfeito não há o que melhorar; senão, para após uma
    // longa sequência sem melhora (2 × stall avaliações, somando os reinícios)
    const area = p.items.reduce((s, it) => s + (it.w + p.gap) * (it.h + p.gap), 0);
    const perfect = Math.abs(area - lb * (p.width + p.gap) * (p.height + p.gap)) < 1e-6 * area;
    const atLb = () => Math.min(knownMin, best ? best.sheets.length : Infinity) <= lb;
    const done = () => atLb() && (perfect || evals - lastGain > 2 * stall);
    if (atLb() && perfect) return null; // encaixe perfeito já encontrado: nada a melhorar
    let pending = null; // melhor ainda não enviada ao motor
    const timeUp = () => evals >= maxEvals || now() - t0 >= limit;

    while (!timeUp() && !done()) {
      // (re)início
      let cur = starts[startIdx % starts.length];
      if (startIdx >= starts.length) cur = Object.assign({}, cur, { dec: (cur.dec + Math.floor(startIdx / starts.length)) % DECODERS.length });
      startIdx++;
      let curSol = decode(p, cur);
      evals++;
      if (!curSol) continue;
      let curC = cost(p, curSol);
      if (curC < bestC - 1e-12) { best = curSol; bestC = curC; pending = curSol; lastGain = evals; }
      const hist = new Array(L).fill(curC);
      let since = 0;
      while (!timeUp() && since < stall && !done()) {
        const cand = mutate(cur, curSol, rand);
        const sol = decode(p, cand);
        evals++; since++;
        if (sol) {
          const c = cost(p, sol);
          const v = evals % L;
          if (c <= hist[v] + 1e-12 || c <= curC + 1e-12) { cur = cand; curSol = sol; curC = c; }
          if (curC < hist[v]) hist[v] = curC;
          if (c < bestC - 1e-12) { best = sol; bestC = c; pending = sol; since = 0; lastGain = evals; }
        }
        const t = now();
        if (t - lastYield > 20) {
          lastYield = t;
          const y = { evals, elapsed: t - t0, limit, sheets: best ? best.sheets.length : 0, lowerBound: lb };
          if (pending) { pending.name = 'busca'; y.candidate = pending; pending = null; }
          yield y;
        }
      }
    }
    if (best) best.name = 'busca';
    return best;
  }

  const api = { search, rng, problemSeed, lowerBound, DECODERS, cost, encode, decode };
  ns.search = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
