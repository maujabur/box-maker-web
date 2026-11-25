'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../packing/rects.js');

const box = (w, h) => ({ x0: 0, y0: 0, x1: w, y1: h });
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('chapa vazia: o maior retângulo é a chapa toda', () => {
  const r = R.largestEmptyRect([], box(100, 50));
  assert.deepStrictEqual(r, { x: 0, y: 0, w: 100, h: 50 });
});

test('uma peça no canto: sobra em L, vence a faixa maior', () => {
  // peça 40x30 no canto inferior esquerdo de 100x50: faixa à direita 60x50=3000, faixa de cima 100x20=2000
  const r = R.largestEmptyRect([{ x: 0, y: 0, w: 40, h: 30 }], box(100, 50));
  assert.ok(near(R.area(r), 3000), JSON.stringify(r));
});

test('peça no meio: retângulo livre não passa por cima da peça', () => {
  const r = R.largestEmptyRect([{ x: 40, y: 20, w: 20, h: 10 }], box(100, 50));
  // opções: 40x50, 100x20, 100x20 (acima/abaixo), 40|... a maior é 100x20 = 2000 ou 40x50 = 2000; acima: 100x20
  assert.ok(near(R.area(r), 2000), JSON.stringify(r));
});

test('contato com a borda (distância 0) não bloqueia o vizinho', () => {
  const obs = [{ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 }];
  assert.strictEqual(R.largestEmptyRect(obs, box(100, 50)), null);
  const r = R.largestEmptyRect([{ x: 0, y: 0, w: 50, h: 50 }], box(100, 50));
  assert.deepStrictEqual(r, { x: 50, y: 0, w: 50, h: 50 });
});

test('obstáculo só tocando a área não conta', () => {
  const r = R.largestEmptyRect([{ x: 100, y: 0, w: 10, h: 50 }], box(100, 50));
  assert.ok(near(R.area(r), 5000));
});

test('minSide descarta faixas estreitas', () => {
  const r = R.largestEmptyRect([{ x: 0, y: 0, w: 95, h: 50 }], box(100, 50), 10);
  assert.strictEqual(r, null);
});

test('usefulRects não conta área duas vezes', () => {
  const obs = [{ x: 0, y: 0, w: 40, h: 30 }];
  const list = R.usefulRects(obs, box(100, 50), 1, 8);
  const sum = list.reduce((a, r) => a + R.area(r), 0);
  // área livre real = 5000 - 1200 = 3800; a soma dos retângulos disjuntos nunca passa disso
  assert.ok(sum <= 3800 + 1e-6, 'soma ' + sum);
  // e cobre toda ela, pois minSide é 1
  assert.ok(near(sum, 3800), 'soma ' + sum);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
    assert.ok(!ov, 'retângulos sobrepostos');
  }
});

test('validateSheet: contato com gap 0 é válido; sobreposição, não', () => {
  const b = box(100, 100);
  assert.deepStrictEqual(R.validateSheet([{ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 }], b, 0), []);
  assert.strictEqual(R.validateSheet([{ x: 0, y: 0, w: 50, h: 50 }, { x: 49, y: 10, w: 50, h: 50 }], b, 0).length, 1);
});

test('validateSheet: gap positivo e limites da chapa', () => {
  const b = box(100, 100);
  assert.strictEqual(R.validateSheet([{ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 }], b, 5).length, 1);
  assert.strictEqual(R.validateSheet([{ x: 0, y: 0, w: 50, h: 50 }, { x: 55, y: 0, w: 45, h: 50 }], b, 5).length, 0);
  assert.strictEqual(R.validateSheet([{ x: 60, y: 0, w: 50, h: 50 }], b, 0).length, 1);
});

test('unionArea: sobreposição contada uma vez', () => {
  assert.ok(near(R.unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }]), 175));
  assert.ok(near(R.unionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }]), 100));
  assert.strictEqual(R.unionArea([]), 0);
});

test('reachArea: vão estreito preso entre peças conta pouco; junto da faixa livre conta a largura somada', () => {
  const b = box(1000, 800);
  // faixa livre de 80 mm à direita; vão de 110 x 200 encostado nela ou separado por uma peça
  const junto = [{ x: 0, y: 0, w: 810, h: 600 }, { x: 0, y: 600, w: 700, h: 200 }]; // vão 110x200 em x 700..810, colado na faixa
  const preso = [{ x: 0, y: 0, w: 920, h: 600 }, { x: 0, y: 600, w: 700, h: 200 }, { x: 810, y: 600, w: 110, h: 200 }];
  // L = 150: no "junto", a região 300 x 200 (vão + faixa de 190) recebe quadrados de 150; no "preso", nada
  assert.ok(R.reachArea(junto, b, 150) > 0);
  assert.strictEqual(R.reachArea(preso, b, 150), 0);
});
