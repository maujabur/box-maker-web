'use strict';
const test = require('node:test');
const assert = require('node:assert');
for (const m of ['rects', 'ranking', 'engine', 'strategies', 'refine', 'legacy', 'exact', 'search', 'plan']) require('../packing/' + m + '.js');
const BP = globalThis.BoxPack;
const H = require('./lib/harness.js');

let seq = 0;
const items = specs => {
  const out = [];
  for (const [w, h, n, fixed] of specs) for (let i = 0; i < (n || 1); i++) out.push({ id: seq++, w, h, fixed: fixed == null ? -1 : fixed, shape: `${w}x${h}#${fixed == null ? -1 : fixed}` });
  return out;
};
const tiling = (W, Hh, parts, seed) => items(H.perfectTiling(W, Hh, parts, seed).map(r => [r.w, r.h, 1]));
const lite = sol => JSON.stringify(BP.plan.toLite(sol));

test('busca exata: acha encaixe perfeito e respeita veio e gap', () => {
  const p = { items: tiling(1000, 800, 12, 11), width: 1000, height: 800, gap: 0 };
  const sol = BP.exact.packInto(p, 1, { nodes: 200000 });
  assert.ok(sol && sol.sheets.length === 1);
  assert.deepStrictEqual(BP.engine.validate(sol, p), []);
  // veio fixo: 300x100 sem girar em 600x200 cabe (2x2); exigindo girar, não cabe numa chapa
  const a = { items: items([[300, 100, 4, 0]]), width: 600, height: 200, gap: 0 };
  assert.ok(BP.exact.packInto(a, 1, {}));
  const b = { items: items([[300, 100, 4, 1]]), width: 600, height: 200, gap: 0 };
  assert.strictEqual(BP.exact.packInto(b, 1, {}), null);
  assert.strictEqual(BP.exact.packInto.lastProven, true, 'deveria provar que é impossível');
  // gap 5: 3 peças de 300 cabem em 910, não em 905
  assert.ok(BP.exact.packInto({ items: items([[300, 100, 3]]), width: 910, height: 100, gap: 5 }, 1, {}));
  assert.strictEqual(BP.exact.packInto({ items: items([[300, 100, 3]]), width: 905, height: 100, gap: 5 }, 1, {}), null);
});

test('busca exata prova o ótimo da caixa única (2 chapas)', () => {
  const setup = H.G.planSetup({ panels: H.boxPanels({}) }, { sheetW: 1000, sheetH: 800, gap: 0, margin: 0, grain: 'none', qty: 1, pieceGrain: {} });
  assert.strictEqual(BP.exact.packInto(setup.problem, 1, { nodes: 2e6 }), null);
  assert.strictEqual(BP.exact.packInto.lastProven, true);
});

test('busca iterativa: mesma semente e mesmo número de avaliações dão o mesmo resultado', () => {
  const p = { items: tiling(1000, 800, 16, 4), width: 1000, height: 800, gap: 2 };
  const run = seed => { const it = BP.search.search(p, [], { seed, maxEvals: 600 }); let r = it.next(); while (!r.done) r = it.next(); return r.value; };
  const a = run(7), b = run(7);
  assert.strictEqual(lite(a), lite(b));
  assert.deepStrictEqual(BP.engine.validate(a, p), []);
});

test('modo equilibrado é reprodutível (mesmo plano em execuções seguidas)', () => {
  const p = { items: items([[230, 170, 5], [400, 120, 4], [150, 150, 7], [610, 90, 2]]), width: 1000, height: 800, gap: 3 };
  const a = BP.plan.runSync(p, { mode: 'balanced' }), b = BP.plan.runSync(p, { mode: 'balanced' });
  assert.strictEqual(lite(a.best.solution), lite(b.best.solution));
});

test('modos: nunca piores que o algoritmo de referência e sempre válidos', () => {
  const p = { items: items([[300, 200, 9], [500, 120, 5], [180, 180, 6]]), width: 1000, height: 800, gap: 0 };
  const ref = BP.engine.runSync(p, BP.legacy.build(p), {});
  for (const mode of ['fast', 'balanced']) {
    const out = BP.plan.runSync(p, { mode });
    assert.deepStrictEqual(out.rejected, []);
    assert.ok(BP.ranking.compare(out.best.metrics, ref.best.metrics) >= 0, mode);
  }
});

test('intensiva: respeita o limite de tempo e a interrupção preserva a melhor solução', () => {
  const p = { items: tiling(1000, 800, 24, 5).concat(tiling(1000, 800, 20, 8)), width: 1000, height: 800, gap: 0 };
  const t0 = Date.now();
  const out = BP.plan.runSync(p, { mode: 'intensive', timeLimit: 2 });
  const ms = Date.now() - t0;
  assert.ok(out.best && BP.engine.validate(out.best.solution, p).length === 0);
  assert.ok(ms < 2000 + 4000, `levou ${ms} ms`); // limite + estratégias determinísticas e refinamento

  // interrupção: para depois de algumas etapas; a melhor até ali é devolvida, válida
  let steps = 0;
  const it = BP.plan.steps(p, { mode: 'intensive', timeLimit: 30, shouldStop: () => steps > 8 });
  let r = it.next(), lastBest = null;
  while (!r.done) { steps++; if (r.value.best) lastBest = r.value.best; r = it.next(); }
  assert.strictEqual(r.value.stopped, true);
  assert.ok(r.value.best && r.value.best === lastBest);
  assert.deepStrictEqual(BP.engine.validate(r.value.best.solution, p), []);
});

test('Worker: o código montado a partir dos módulos é JavaScript válido e roda o plano', () => {
  const src = BP.plan.workerSource();
  const posted = [];
  const self = { postMessage: m => posted.push(m) };
  new Function('self', src)(self);
  const p = { items: BP.plan.liteItems(items([[300, 200, 6], [200, 100, 4]])), width: 1000, height: 800, gap: 0 };
  self.onmessage({ data: { problem: p, opts: { mode: 'fast' } } });
  const done = posted.find(m => m.type === 'done');
  assert.ok(done && done.solution, JSON.stringify(posted.find(m => m.type === 'error')));
  // a solução leve volta para os itens da página e é válida
  const sol = BP.plan.fromLite(done.solution, p.items);
  assert.deepStrictEqual(BP.engine.validate(sol, p), []);
});
