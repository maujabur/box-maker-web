/*
 * Motor do plano de corte: reúne soluções candidatas de várias estratégias, descarta as inválidas,
 * classifica as válidas (ranking.js) e fica com a melhor.
 *
 * Estratégia: { id, passes?, run(problem, opts) }
 *   run devolve uma Solução, uma lista de Soluções ou null; ou ainda um gerador (function*) que
 *   emite { pieces, placed } de tempos em tempos (andamento) e devolve o mesmo no final.
 *   Cada estratégia só posiciona; não valida nem classifica.
 *
 * Problema: { items, width, height, gap }
 *   item: { id, w, h, fixed, shape }   fixed: -1 = livre (0° ou 90°), 0 = não gira, 1 = gira 90°
 *   shape: chave de forma (peças com a mesma chave têm geometria e restrições idênticas)
 *
 * A solução com menos chapas (e melhor sobra) entre todas as válidas vence; empate: a primeira
 * estratégia da lista. Por isso a estratégia de referência (legacy) vai primeiro e o motor nunca
 * devolve pior que ela.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const R = ns.rects || (typeof require === 'function' ? require('./rects.js') : null);
  const RK = ns.ranking || (typeof require === 'function' ? require('./ranking.js') : null);

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const TOL = 1e-6;

  // Erros de uma solução (vazio = válida): todas as peças exatamente uma vez, orientação permitida,
  // tamanho preservado, dentro da área útil, sem sobreposição e respeitando a distância mínima.
  function validate(solution, problem) {
    const errs = [];
    const seen = new Set();
    const b = { x0: 0, y0: 0, x1: problem.width, y1: problem.height };
    solution.sheets.forEach((sh, si) => {
      for (const q of sh.rects) {
        const it = q.item;
        if (seen.has(it)) errs.push(`chapa ${si + 1}: peça ${it.id} repetida`);
        seen.add(it);
        if (it.fixed === 0 && q.rot) errs.push(`peça ${it.id}: girada, mas o veio não permite`);
        if (it.fixed === 1 && !q.rot) errs.push(`peça ${it.id}: sem girar, mas o veio exige 90°`);
        const w = q.rot ? it.h : it.w, h = q.rot ? it.w : it.h;
        if (Math.abs(q.w - w) > TOL || Math.abs(q.h - h) > TOL) errs.push(`peça ${it.id}: tamanho alterado`);
      }
      for (const e of R.validateSheet(sh.rects, b, problem.gap)) errs.push(`chapa ${si + 1}: ${e}`);
    });
    if (seen.size !== problem.items.length) errs.push(`${seen.size} peças posicionadas, esperadas ${problem.items.length}`);
    return errs;
  }

  // assinatura de uma solução (peça, posição e giro), para não refinar duas vezes o mesmo arranjo
  const signature = sol => sol.sheets.map(sh => sh.rects.map(q => `${q.item.id}:${Math.round(q.x * 10)},${Math.round(q.y * 10)},${q.rot}`).sort().join('|')).sort().join('||');

  /*
   * opts.refine = { level: 'light' | 'full', pool: n }: depois das estratégias, as `pool` melhores soluções
   * distintas passam por refine.improve (compactação, redistribuição entre chapas...) e voltam como candidatas.
   * opts.shouldStop(): se devolver true, o motor para na próxima oportunidade e devolve a melhor até ali.
   *
   * Uma estratégia geradora pode emitir { candidate: solução } no meio da execução (busca iterativa):
   * a candidata é validada e classificada na hora. As etapas emitidas pelo motor trazem `improved: true`
   * quando a melhor solução mudou, e `best` (a melhor até ali), para a exibição progressiva.
   * Estratégias recebem um terceiro argumento `state` com top(k): as k melhores soluções distintas até ali.
   */
  function* run(problem, strategies, options) {
    const opts = Object.assign({}, options);
    const refineOn = !!(opts.refine && opts.refine.pool > 0);
    const poolMax = Math.max(refineOn ? opts.refine.pool : 0, 6);
    const passes = strategies.reduce((a, s) => a + (s.passes || 1), 0) + (refineOn ? opts.refine.pool : 0);
    const pool = []; // melhores soluções distintas (fora as já refinadas), da melhor para a pior
    const report = [], rejected = [];
    const all = opts.collect ? [] : null;
    const stop = () => !!(opts.shouldStop && opts.shouldStop());
    let best = null, pass = 0, improved = false, stopped = false;

    const consider = (sol, s, ms) => {
      sol.name = sol.name || s.id;
      const errors = validate(sol, problem);
      if (errors.length) { rejected.push({ name: sol.name, errors }); return; }
      const metrics = RK.evaluate(sol, problem, opts.rank);
      report.push({ name: sol.name, strategy: s.id, sheets: sol.sheets.length, ms });
      if (all) all.push({ solution: sol, metrics });
      if (!best || RK.compare(metrics, best.metrics) > 0) { best = { solution: sol, metrics, strategy: s.id }; improved = true; }
      if (s.id !== 'refine') {
        const sig = signature(sol);
        if (!pool.some(e => e.sig === sig)) {
          let at = pool.findIndex(e => RK.compare(metrics, e.metrics) > 0);
          if (at < 0) at = pool.length;
          if (at < poolMax) { pool.splice(at, 0, { sol, metrics, sig }); if (pool.length > poolMax) pool.pop(); }
        }
      }
    };
    const step = (extra, s) => {
      const out = Object.assign({ pieces: problem.items.length, placed: problem.items.length }, extra,
        { pass: Math.min(pass + 1, passes), passes, strategy: s, best, improved });
      delete out.candidate;
      improved = false;
      return out;
    };
    // notes: informações que uma estratégia deixa para as seguintes (ex.: minSheets provado pela busca exata)
    const state = { top: k => pool.slice(0, k).map(e => e.sol), best: () => best, notes: {} };

    for (const s of strategies) {
      if (stop()) { stopped = true; break; }
      yield step({}, s.id); // avisa a estratégia que vai começar (algumas demoram, sem etapas intermediárias)
      if (stop()) { stopped = true; break; }
      const t0 = now();
      let out = s.run(problem, opts, state);
      if (out && typeof out.next === 'function') {
        let r = out.next();
        while (!r.done) {
          if (r.value && r.value.candidate) consider(r.value.candidate, s, now() - t0);
          yield step(r.value, s.id);
          if (stop()) { stopped = true; break; }
          r = out.next();
        }
        out = r.done ? r.value : null;
      }
      pass += s.passes || 1;
      const ms = now() - t0;
      const list = !out ? [] : Array.isArray(out) ? out : [out];
      for (const sol of list) consider(sol, s, ms);
      yield step({}, s.id);
      if (stopped) break;
    }
    if (refineOn && !stopped) {
      const RF = ns.refine || (typeof require === 'function' ? require('./refine.js') : null);
      for (const e of pool.slice(0, opts.refine.pool)) {
        if (stop()) { stopped = true; break; }
        yield step({}, 'refine');
        const t0 = now();
        const better = RF.improve(problem, e.sol, opts.refine.level);
        pass++;
        if (better !== e.sol) consider(better, { id: 'refine' }, now() - t0);
      }
      yield step({}, 'refine');
    }
    return { best, report, rejected, all, stopped, notes: state.notes };
  }

  // Execução síncrona (testes, benchmarks)
  function runSync(problem, strategies, options) {
    const it = run(problem, strategies, options);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  const api = { validate, run, runSync };
  ns.engine = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
