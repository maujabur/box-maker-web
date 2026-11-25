/*
 * Modos de otimização: monta a lista de estratégias e roda o motor. É o ponto de entrada usado pela
 * página (direto ou num Web Worker) e pelos testes.
 *
 *   fast       Rápida: referência (legacy) reduzida + poucas heurísticas + compactação. Para atualizar
 *              durante a edição.
 *   balanced   Equilibrada (padrão): referência completa, todas as heurísticas, ordenações e blocos,
 *              refinamento das melhores e uma busca iterativa curta, com número fixo de avaliações
 *              (resultado reprodutível em qualquer máquina).
 *   intensive  Intensiva: tudo do equilibrado + busca iterativa até o limite de tempo (ou interrupção).
 *   legacy     (só para benchmarks) apenas o algoritmo original, sem refinamento: referência de comparação.
 *
 * Problema: { items, width, height, gap } (ver engine.js). Solução "leve" (para mensagens entre a página
 * e o Worker): { name, sheets: [{ rects: [{ id, x, y, w, h, rot }] }] }.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const dep = (n, f) => ns[n] || (typeof require === 'function' ? require(f) : null);

  const MODES = ['fast', 'balanced', 'intensive'];
  const FAST_FULL_LEGACY = 120; // peças
  const DEFAULT_TIME = 15; // s, modo intensivo (ver README: benchmarks)

  // avaliações da busca curta do modo equilibrado: menos com muitas peças (cada avaliação custa mais)
  const balancedEvals = n => (n < 4 ? 0 : n <= 40 ? 1500 : n <= 120 ? 600 : n <= 300 ? 150 : 0);

  function strategiesFor(problem, mode, opts) {
    const L = dep('legacy', './legacy.js'), S = dep('strategies', './strategies.js'), SE = dep('search', './search.js');
    const n = problem.items.length;
    let list = L.build(problem);
    // rápido: a referência completa até FAST_FULL_LEGACY peças (nunca pior que o algoritmo original);
    // acima disso, só as variantes baratas (o original completo passa de 1 s)
    if (mode === 'fast' && n > FAST_FULL_LEGACY) list = list.filter(s => s.id === 'legacy-simple' || s.id === 'legacy-multi');
    list = list.concat(S.build(problem, mode === 'fast' ? 'fast' : 'balanced'));
    const X = dep('exact', './exact.js');
    const searchFor = (id, so) => ({ id, run: (p, o, state) => SE.search(p, state.top(4), Object.assign({ minSheets: state.notes.minSheets }, so)) });
    // busca exata por menos chapas (com esforço limitado); usa a melhor solução até ali como alvo
    const exactFor = eo => ({ id: 'exata', run: (p, o, state) => X.run(p, Object.assign({}, eo, eo.time ? { deadline: Date.now() + eo.time } : {}), state) });
    if (mode === 'fast') list.push(exactFor({ nodes: 20000 }));
    if (mode === 'balanced') {
      list.push(exactFor({ nodes: 150000 }));
      const ev = balancedEvals(n);
      if (ev) list.push(searchFor('busca', { maxEvals: ev, seed: opts.seed }));
    }
    if (mode === 'intensive') {
      const ms = Math.max(1, +opts.timeLimit || DEFAULT_TIME) * 1000;
      // 40% do tempo para a busca exata (para quando acha ou prova que não dá), o resto para a busca local
      const t0 = Date.now();
      list.push(exactFor({ nodes: 1e9, time: 0.4 * ms }));
      list.push({ id: 'busca', run: (p, o, state) => SE.search(p, state.top(4), {
        timeLimit: Math.max(500, ms - (Date.now() - t0)), maxEvals: opts.maxEvals, seed: opts.seed, stall: opts.stall,
        minSheets: state.notes.minSheets,
      }) });
    }
    return list;
  }

  // opts: { mode, timeLimit (s), seed, maxEvals, shouldStop }
  function* steps(problem, options) {
    const opts = Object.assign({}, options);
    const mode = MODES.includes(opts.mode) || opts.mode === 'legacy' ? opts.mode : 'balanced';
    const E = dep('engine', './engine.js');
    const strategies = mode === 'legacy' ? dep('legacy', './legacy.js').build(problem) : strategiesFor(problem, mode, opts);
    const refine = mode === 'legacy' ? null : mode === 'fast' ? { level: 'light', pool: 1 } : { level: 'full', pool: 3 };
    const out = yield* E.run(problem, strategies, { refine, shouldStop: opts.shouldStop });
    out.mode = mode;
    return out;
  }
  function runSync(problem, options) {
    const it = steps(problem, options);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  // ---------- soluções leves (mensagens) ----------
  const toLite = sol => sol && {
    name: sol.name,
    sheets: sol.sheets.map(sh => ({ rects: sh.rects.map(q => ({ id: q.item.id, x: q.x, y: q.y, w: q.w, h: q.h, rot: q.rot })) })),
  };
  function fromLite(lite, items) {
    const byId = new Map(items.map(it => [it.id, it]));
    return {
      name: lite.name,
      sheets: lite.sheets.map(sh => ({ rects: sh.rects.map(q => ({ item: byId.get(q.id), x: q.x, y: q.y, w: q.w, h: q.h, rot: q.rot })) })),
    };
  }
  const liteItems = items => items.map(it => ({ id: it.id, w: it.w, h: it.h, fixed: it.fixed, shape: it.shape }));

  // ---------- Web Worker ----------
  /*
   * Código do Worker montado a partir das próprias funções dos módulos (root.__BoxPackMods), num Blob:
   * funciona offline e com a página aberta por file:// (onde new Worker('arquivo.js') é bloqueado).
   * Mensagens: página -> { problem, opts }; Worker -> { type: 'progress' | 'best' | 'done' | 'error', ... }.
   * Para interromper, a página encerra o Worker (terminate) e fica com a última melhor recebida.
   */
  function workerSource() {
    const mods = root.__BoxPackMods || [];
    const body = mods.map(f => '(' + f.toString() + ')(self);').join('\n');
    const main = function () {
      self.onmessage = function (ev) {
        const P = self.BoxPack.plan;
        const problem = ev.data.problem;
        try {
          const it = P.steps(problem, ev.data.opts || {});
          let r = it.next(), lastPost = 0, lastPass = -1, lastStrategy = '';
          while (!r.done) {
            const v = r.value;
            const t = Date.now();
            // andamento: a cada etapa nova (antes de uma estratégia demorada) ou a cada 100 ms
            if (v.improved && v.best) { lastPost = t; lastPass = v.pass; lastStrategy = v.strategy; self.postMessage({ type: 'best', solution: P.toLite(v.best.solution), strategy: v.best.strategy, progress: P.progressOf(v) }); }
            else if (t - lastPost > 100 || v.pass !== lastPass || v.strategy !== lastStrategy) { lastPost = t; lastPass = v.pass; lastStrategy = v.strategy; self.postMessage({ type: 'progress', progress: P.progressOf(v) }); }
            r = it.next();
          }
          const out = r.value;
          self.postMessage({ type: 'done', solution: out.best && P.toLite(out.best.solution), strategy: out.best && out.best.strategy, candidates: out.report.length, rejected: out.rejected.length, mode: out.mode });
        } catch (e) {
          self.postMessage({ type: 'error', message: String(e && e.message || e) });
        }
      };
    };
    return '"use strict";\n' + body + '\n(' + main.toString() + ')();';
  }
  // andamento resumido de uma etapa do motor
  const progressOf = v => ({
    pass: v.pass, passes: v.passes, strategy: v.strategy, pieces: v.pieces, placed: v.placed,
    evals: v.evals, elapsed: v.elapsed, limit: v.limit, sheets: v.best ? v.best.solution.sheets.length : 0,
    bigArea: v.best ? v.best.metrics.get('bigArea') : 0,
  });

  let workerUrl = null;
  function createWorker() {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
    try {
      if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
      return new Worker(workerUrl);
    } catch (e) {
      return null; // navegador sem suporte: a página calcula em etapas, na própria thread
    }
  }

  const api = { MODES, DEFAULT_TIME, FAST_FULL_LEGACY, balancedEvals, strategiesFor, steps, runSync, toLite, fromLite, liteItems, workerSource, createWorker, progressOf };
  ns.plan = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
