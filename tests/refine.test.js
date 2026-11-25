'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../packing/rects.js');
require('../packing/ranking.js');
const E = require('../packing/engine.js');
const RF = require('../packing/refine.js');
const RK = require('../packing/ranking.js');
const S = require('../packing/strategies.js');

let seq = 0;
const item = (w, h, fixed) => ({ id: seq++, w, h, fixed: fixed == null ? -1 : fixed, shape: `${w}x${h}` });
const at = (it, x, y, rot) => ({ item: it, x, y, w: rot ? it.h : it.w, h: rot ? it.w : it.h, rot: rot ? 1 : 0 });
const prob = (items, gap) => ({ items, width: 1000, height: 800, gap: gap || 0 });

test('compactação: peças soltas vão para um canto, sem mudar tamanho nem sobrepor', () => {
  const a = item(100, 100), b = item(100, 100), c = item(200, 100);
  const p = prob([a, b, c], 5);
  const rects = [at(a, 300, 300), at(b, 520, 300), at(c, 300, 500)];
  const cs = RF.compactSheet(p, rects);
  assert.ok(cs, 'esperava melhora');
  assert.deepStrictEqual(R.validateSheet(cs, { x0: 0, y0: 0, x1: 1000, y1: 800 }, 5), []);
  assert.ok(RK.compare(RK.evaluate({ sheets: [{ rects: cs }] }, p), RK.evaluate({ sheets: [{ rects }] }, p)) > 0);
  cs.forEach((q, i) => { assert.strictEqual(q.w, rects[i].w); assert.strictEqual(q.h, rects[i].h); assert.strictEqual(q.rot, rects[i].rot); });
  // contato com gap 0 continua permitido: a peça encosta, não entra
  const p0 = prob([a, b], 0);
  const c0 = RF.compactVariants([at(a, 400, 0), at(b, 600, 0)], p0).every(v => R.validateSheet(v, { x0: 0, y0: 0, x1: 1000, y1: 800 }, 0).length === 0);
  assert.ok(c0);
});

test('fillHoles: peça da chapa vazia passa para o buraco de outra e a chapa some', () => {
  const big = [item(500, 800), item(300, 800)]; // sobra 200x800 na chapa 1
  const small = item(150, 600);
  const p = prob(big.concat(small));
  const sol = { sheets: [{ rects: [at(big[0], 0, 0), at(big[1], 500, 0)] }, { rects: [at(small, 0, 0)] }] };
  assert.deepStrictEqual(E.validate(sol, p), []);
  const out = RF.fillHoles(p, sol);
  assert.ok(out && out.sheets.length === 1);
  assert.deepStrictEqual(E.validate(out, p), []);
});

test('fillHoles respeita o gap ao usar o buraco', () => {
  const big = [item(500, 800), item(300, 800)];
  const small = item(196, 600); // com gap 5: 200 livre - 5 de folga = 195 < 196
  const p = prob(big.concat(small), 5);
  const sol = { sheets: [{ rects: [at(big[0], 0, 0), at(big[1], 505, 0)] }, { rects: [at(small, 0, 0)] }] };
  assert.deepStrictEqual(E.validate(sol, p), []);
  assert.strictEqual(RF.fillHoles(p, sol), null);
});

test('reduceTail: peças das chapas mais vazias cabem juntas em uma só', () => {
  const full = [item(500, 400), item(500, 400), item(500, 400), item(500, 400)];
  const m1 = item(500, 300), m2 = item(500, 300);
  const p = prob(full.concat(m1, m2));
  const sol = { sheets: [
    { rects: full.map((it, i) => at(it, (i % 2) * 500, Math.floor(i / 2) * 400)) },
    { rects: [at(m1, 250, 250)] },
    { rects: [at(m2, 250, 250)] },
  ] };
  assert.deepStrictEqual(E.validate(sol, p), []);
  assert.strictEqual(RF.fillHoles(p, sol), null, 'nenhum buraco serve');
  const out = RF.reduceTail(p, sol);
  assert.ok(out && out.sheets.length === 2);
  assert.deepStrictEqual(E.validate(out, p), []);
});

test('improve: nunca devolve solução inválida nem com mais chapas; mantém todas as peças', () => {
  const its = [];
  for (let i = 0; i < 14; i++) its.push(item(120 + (i % 5) * 60, 80 + (i % 3) * 70));
  for (const gap of [0, 4]) {
    const p = prob(its, gap);
    const start = S.build(p, 'fast')[0].run(p);
    const sol = Array.isArray(start) ? start[0] : start;
    for (const level of ['light', 'full']) {
      const r = RF.improve(p, sol, level);
      assert.deepStrictEqual(E.validate(r, p), [], `${level} gap ${gap}`);
      assert.ok(r.sheets.length <= sol.sheets.length);
    }
  }
});

test('engine com refinamento: nunca pior que sem refinamento', () => {
  const its = [];
  for (let i = 0; i < 20; i++) its.push(item(100 + (i % 4) * 70, 90 + (i % 3) * 60));
  const p = prob(its, 2);
  const base = E.runSync(p, S.build(p, 'balanced'), {});
  const ref = E.runSync(p, S.build(p, 'balanced'), { refine: { level: 'full', pool: 3 } });
  assert.deepStrictEqual(ref.rejected, []);
  assert.ok(RK.compare(ref.best.metrics, base.best.metrics) >= 0);
});

test('frontier: peças juntas no canto têm fronteira menor que peças espalhadas', () => {
  const a = item(100, 100), b = item(100, 100);
  const p = prob([a, b]);
  const junto = RK.frontier([at(a, 0, 0), at(b, 100, 0)], p);
  const espalhado = RK.frontier([at(a, 300, 300), at(b, 600, 300)], p);
  assert.ok(junto < espalhado, `${junto} vs ${espalhado}`);
  // peça encostada nas bordas: só conta a fronteira com a sobra (200 + 100 + 100 do canto, sem as paredes)
  assert.strictEqual(RK.frontier([at(a, 0, 0)], p), 200);
});
