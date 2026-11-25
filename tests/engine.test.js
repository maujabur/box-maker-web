'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../packing/rects.js');
const RK = require('../packing/ranking.js');
const E = require('../packing/engine.js');

// problema simples: chapa útil 100x100, gap 0
const item = (id, w, h, fixed) => ({ id, w, h, fixed: fixed == null ? -1 : fixed, shape: w + 'x' + h });
const rect = (it, x, y, rot) => ({ item: it, x, y, w: rot ? it.h : it.w, h: rot ? it.w : it.h, rot: rot ? 1 : 0 });
const problem = items => ({ items, width: 100, height: 100, gap: 0 });

test('validate: aceita contato, recusa sobreposição, peça faltando e tamanho alterado', () => {
  const a = item(0, 50, 50), b = item(1, 50, 50);
  const p = problem([a, b]);
  assert.deepStrictEqual(E.validate({ sheets: [{ rects: [rect(a, 0, 0), rect(b, 50, 0)] }] }, p), []);
  assert.ok(E.validate({ sheets: [{ rects: [rect(a, 0, 0), rect(b, 40, 0)] }] }, p).length > 0);
  assert.ok(E.validate({ sheets: [{ rects: [rect(a, 0, 0)] }] }, p).length > 0);
  const bad = rect(b, 50, 0); bad.w = 49;
  assert.ok(E.validate({ sheets: [{ rects: [rect(a, 0, 0), bad] }] }, p).length > 0);
});

test('validate: respeita a restrição de veio e o gap', () => {
  const a = item(0, 60, 30, 0), b = item(1, 30, 60, 1);
  assert.ok(E.validate({ sheets: [{ rects: [rect(a, 0, 0, true)] }] }, problem([a])).length > 0);
  assert.ok(E.validate({ sheets: [{ rects: [rect(b, 0, 0, false)] }] }, problem([b])).length > 0);
  const c = item(0, 50, 50), d = item(1, 50, 50);
  const p = { items: [c, d], width: 100, height: 100, gap: 2 };
  assert.ok(E.validate({ sheets: [{ rects: [rect(c, 0, 0), rect(d, 50, 0)] }] }, p).length > 0);
});

test('o motor descarta candidatas inválidas e escolhe a melhor entre as válidas', () => {
  const a = item(0, 50, 50), b = item(1, 50, 50);
  const p = problem([a, b]);
  const strategies = [
    { id: 'duas-chapas', run: () => ({ sheets: [{ rects: [rect(a, 0, 0)] }, { rects: [rect(b, 0, 0)] }] }) },
    { id: 'sobreposta', run: () => ({ sheets: [{ rects: [rect(a, 0, 0), rect(b, 10, 10)] }] }) },
    { id: 'uma-chapa', run: () => ({ sheets: [{ rects: [rect(a, 0, 0), rect(b, 50, 0)] }] }) },
  ];
  const out = E.runSync(p, strategies, {});
  assert.strictEqual(out.best.strategy, 'uma-chapa');
  assert.deepStrictEqual(out.rejected.map(r => r.name), ['sobreposta']);
  assert.strictEqual(out.report.length, 2);
});

test('empate total: vale a primeira estratégia da lista (a de referência)', () => {
  const a = item(0, 50, 50);
  const mk = id => ({ id, run: () => ({ sheets: [{ rects: [rect(a, 0, 0)] }] }) });
  assert.strictEqual(E.runSync(problem([a]), [mk('ref'), mk('outra')], {}).best.strategy, 'ref');
});

test('estratégia geradora emite andamento e devolve a solução', () => {
  const a = item(0, 50, 50);
  const gen = { id: 'g', run: function* () { yield { pieces: 1, placed: 0 }; return { sheets: [{ rects: [rect(a, 0, 0)] }] }; } };
  const it = E.run(problem([a]), [gen], {});
  const seen = [];
  let r = it.next();
  while (!r.done) { seen.push(r.value); r = it.next(); }
  assert.ok(seen.length >= 1 && seen[0].strategy === 'g' && seen[0].passes === 1);
  assert.strictEqual(r.value.best.strategy, 'g');
});

test('ranking: menos chapas vence tudo; depois a maior sobra do trabalho', () => {
  const a = item(0, 50, 50), b = item(1, 50, 50), c = item(2, 100, 20);
  const p = problem([a, b, c]);
  const one = { sheets: [{ rects: [rect(a, 0, 0), rect(b, 50, 0), rect(c, 0, 50)] }] };
  const two = { sheets: [{ rects: [rect(a, 0, 0), rect(b, 50, 0)] }, { rects: [rect(c, 0, 0)] }] };
  assert.ok(RK.compare(RK.evaluate(one, p), RK.evaluate(two, p)) > 0);

  // mesmas 2 chapas, mesma área livre; juntar a sobra num retângulo grande ganha
  const p2 = problem([a, b]);
  const junta = { sheets: [{ rects: [rect(a, 0, 0), rect(b, 50, 0)] }] }; // livre: faixa 100x50
  const espalha = { sheets: [{ rects: [rect(a, 0, 0), rect(b, 50, 50)] }] }; // livre: dois quadrados 50x50 em diagonal
  const mj = RK.evaluate(junta, p2), me = RK.evaluate(espalha, p2);
  assert.strictEqual(mj.get('bigArea'), 5000);
  assert.strictEqual(me.get('bigArea'), 2500);
  // áreas úteis sem contar sobreposição: a livre total é 5000 nos dois, nunca mais que isso
  assert.ok(mj.get('usefulArea') <= 5000 + 1e-6 && me.get('usefulArea') <= 5000 + 1e-6);
  assert.ok(RK.compare(mj, me) > 0, 'sobra de uma peça só deve vencer a sobra partida em duas');
});

test('ranking: sobra do trabalho concentrada numa chapa vence a espalhada', () => {
  const a = item(0, 100, 50), b = item(1, 100, 50), c = item(2, 100, 50), d = item(3, 100, 50);
  const p = problem([a, b, c, d]);
  // 3 peças cheias + 1 num canto, vs. 2+2 de metades
  const conc = { sheets: [{ rects: [rect(a, 0, 0), rect(b, 0, 50)] }, { rects: [rect(c, 0, 0)] }, { rects: [rect(d, 0, 0)] }] };
  const esp = { sheets: [{ rects: [rect(a, 0, 0)] }, { rects: [rect(b, 0, 0)] }, { rects: [rect(c, 0, 0)] }, { rects: [rect(d, 0, 0)] }] };
  assert.ok(RK.compare(RK.evaluate(conc, p), RK.evaluate(esp, p)) > 0);
});

test('ranking (bolsões): vão junto à faixa livre vence o mesmo vão preso entre peças', () => {
  // chapa 2 das 2 caixas 500x300x200 (gap 5, área útil 990 x 790): mesmas peças, mesmas sobras em área
  const p = { items: [], width: 990, height: 790, gap: 5 };
  const r = (x, y, w, h) => ({ item: item(x * 1000 + y, w, h), x, y, w, h, rot: 0 });
  const atual = [r(0, 0, 300, 500), r(305, 0, 300, 500), r(0, 505, 500, 200), r(610, 0, 300, 200), r(610, 205, 300, 500)];
  const alt = [r(0, 0, 300, 200), r(0, 205, 300, 500), r(305, 0, 300, 500), r(610, 0, 300, 500), r(305, 505, 500, 200)];
  const ma = RK.evaluate({ sheets: [{ rects: atual }] }, p), mb = RK.evaluate({ sheets: [{ rects: alt }] }, p);
  // os critérios anteriores empatam
  for (const id of ['bigArea', 'usefulArea', 'usefulCount']) {
    const c = RK.CRITERIA.find(x => x.id === id);
    assert.ok(Math.abs(c.value(ma) - c.value(mb)) <= c.tol(ma), id);
  }
  assert.ok(mb.get('reach') > ma.get('reach'));
  assert.ok(RK.compare(mb, ma) > 0);
});
