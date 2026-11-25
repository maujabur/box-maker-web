'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../packing/rects.js');
require('../packing/ranking.js');
const E = require('../packing/engine.js');
const S = require('../packing/strategies.js');
const H = require('./lib/harness.js');

function items(specs) {
  const out = [];
  for (const [w, h, n, fixed] of specs) for (let i = 0; i < (n || 1); i++) {
    out.push({ id: out.length, w, h, fixed: fixed == null ? -1 : fixed, shape: `${w}x${h}#${fixed == null ? -1 : fixed}` });
  }
  return out;
}

test('blockShapes: soma das peças, e cada bloco cabe na chapa', () => {
  for (const mode of ['rows', 'cols', 'square']) {
    for (const n of [2, 5, 7, 12, 13, 40, 150]) {
      const shapes = S.blockShapes(n, 100, 50, 1000, 800, mode);
      assert.strictEqual(shapes.reduce((a, s) => a + s.c * s.r, 0), n, `${mode} ${n}`);
      for (const s of shapes) assert.ok(s.c * 100 <= 1000 && s.r * 50 <= 800, `${mode} ${n} ${JSON.stringify(s)}`);
    }
  }
});

test('todas as estratégias geram soluções válidas (fast e balanced), com e sem gap', () => {
  const rand = H.rng(2024);
  for (const gap of [0, 3]) {
    for (let t = 0; t < 6; t++) {
      const specs = [];
      for (let k = 0; k < 4; k++) specs.push([40 + Math.floor(rand() * 20) * 10, 30 + Math.floor(rand() * 15) * 10, 1 + Math.floor(rand() * 6), [-1, -1, 0, 1][Math.floor(rand() * 4)]]);
      const p = { items: items(specs), width: 600, height: 400, gap };
      for (const mode of ['fast', 'balanced']) {
        const out = E.runSync(p, S.build(p, mode), { collect: true });
        assert.deepStrictEqual(out.rejected, [], `${mode} gap ${gap}: ${JSON.stringify(out.rejected[0])}`);
        assert.ok(out.report.length > 0);
      }
    }
  }
});

test('blocos: peças iguais saem em grade, com o gap entre elas e o giro do bloco aplicado às peças', () => {
  const its = items([[100, 50, 12]]);
  const p = { items: its, width: 400, height: 300, gap: 4 };
  const packables = S.makeBlocks(p, 'rows', 'best');
  assert.ok(packables.some(b => b.members), 'esperava ao menos um bloco');
  for (const o of ['area']) {
    const sol = S.pack(p, S.sortBy(packables, o), { algo: 'maxrects', heur: 'bssf' });
    assert.deepStrictEqual(E.validate(sol, p), []);
  }
  // bloco girado: 3 colunas x 2 fileiras de 100x50 vira 2 colunas x 3 fileiras de 50x100
  const blk = { id: -1, w: 308, h: 104, fixed: -1, shape: 'block', members: [] };
  const mem = its.slice(0, 6);
  mem.forEach((m, i) => blk.members.push({ item: m, dx: (i % 3) * 104, dy: Math.floor(i / 3) * 54, w: 100, h: 50, rot: 0 }));
  const sol = S.expandBlocks({ sheets: [{ rects: [{ item: blk, x: 10, y: 20, w: 104, h: 308, rot: 1 }] }] });
  const rs = sol.sheets[0].rects;
  assert.strictEqual(rs.length, 6);
  for (const r of rs) { assert.strictEqual(r.w, 50); assert.strictEqual(r.h, 100); assert.strictEqual(r.rot, 1); }
});

test('blocos respeitam veio fixo e não misturam formas diferentes só pelas dimensões', () => {
  const a = items([[100, 50, 4, 0]]);
  const b = items([[100, 50, 4, -1]]).map(i => Object.assign(i, { id: i.id + 100 }));
  const p = { items: a.concat(b), width: 1000, height: 800, gap: 0 };
  const pk = S.makeBlocks(p, 'rows', 'best');
  for (const blk of pk.filter(x => x.members)) {
    assert.ok(blk.members.every(m => m.item.shape === blk.members[0].item.shape));
    if (blk.members[0].item.fixed === 0) assert.strictEqual(blk.fixed, 0);
  }
  const out = E.runSync(p, S.build(p, 'balanced'), {});
  assert.deepStrictEqual(out.rejected, []);
});

test('ótimo conhecido: faixas, orientação mista e 24 peças iguais em 2 chapas', () => {
  const cases = [
    [items([[300, 100, 12]]), 900, 400, 1],
    [items([[300, 100, 6], [100, 300, 6]]), 600, 600, 1],
    [items([[100, 200, 24]]), 600, 400, 2],
    [items([[500, 400, 4]]), 1000, 800, 1],
    [items([[100, 700, 9], [900, 100, 1]]), 1000, 800, 1],
  ];
  for (const [its, W, Hh, opt] of cases) {
    const p = { items: its, width: W, height: Hh, gap: 0 };
    const out = E.runSync(p, S.build(p, 'balanced'), {});
    assert.strictEqual(out.best.solution.sheets.length, opt);
  }
});

test('distância mínima positiva é respeitada pelos blocos e algoritmos', () => {
  // 3 colunas de 300 + 2 gaps de 5 = 910 cabem em 910 exatos; com 905 só cabem 2 colunas
  const p = { items: items([[300, 100, 3]]), width: 910, height: 100, gap: 5 };
  assert.strictEqual(E.runSync(p, S.build(p, 'balanced'), {}).best.solution.sheets.length, 1);
  const q = Object.assign({}, p, { width: 905 });
  assert.strictEqual(E.runSync(q, S.build(q, 'balanced'), {}).best.solution.sheets.length, 2);
});
