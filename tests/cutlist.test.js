'use strict';
// Regras da lista de corte (cutlist.js): normalização, exclusões, o que entra no plano, chave de recálculo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./lib/harness.js');
const BC = require('../cutlist.js');
const G = H.G;

const boxA = H.boxCfg({ W: 200, D: 300, H: 500 }), boxB = H.boxCfg({ W: 100, D: 150, H: 300 });
const build = box => ({ res: G.build(box) });
const deps = { uid: () => 'novo', boxName: b => `${b.W}x${b.D}x${b.H}`, normBox: b => b };
const conf = { sheetW: 1000, sheetH: 800, gap: 2, margin: 5, grain: 'none', optMode: 'fast' };

test('chaves de peça: iguais às de G.build e às de PIECES em app.js', () => {
  const names = G.build(boxA).panels.map(p => p.name).sort();
  assert.deepStrictEqual([...BC.PIECE_KEYS].sort(), names);
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const m = src.match(/const PIECES = \[([^;]*)\];/);
  assert.ok(m, 'PIECES não encontrado em app.js');
  const keys = [...m[1].matchAll(/\['(\w+)'/g)].map(x => x[1]).sort();
  assert.deepStrictEqual(keys, names);
});

test('cleanExcl: só peças conhecidas, inteiros positivos, no máximo 999', () => {
  assert.deepStrictEqual(BC.cleanExcl({ left: 2, front: 0, back: -1, lid: '3', bottom: 1.6, xx: 5, right: 'a' }), { left: 2, lid: 3, bottom: 2 });
  assert.deepStrictEqual(BC.cleanExcl({ left: 5000 }), { left: 999 });
  for (const v of [undefined, null, 'x', 7, []]) assert.deepStrictEqual(BC.cleanExcl(v), {});
});

test('leftOf, totalLeft, totalAll: quantidade a cortar nunca fica negativa', () => {
  const res = G.build(boxA), n = res.panels.length;
  const e = { qty: 3, excluir: { left: 1, lid: 9 } };
  assert.strictEqual(BC.leftOf(e, 'left'), 2);
  assert.strictEqual(BC.leftOf(e, 'lid'), 0);
  assert.strictEqual(BC.leftOf(e, 'front'), 3);
  assert.strictEqual(BC.leftOf({ qty: 3 }, 'front'), 3, 'sem excluir');
  assert.strictEqual(BC.totalAll(e, res), n * 3);
  assert.strictEqual(BC.totalLeft(e, res), n * 3 - 1 - 3);
  assert.strictEqual(BC.totalLeft(e, undefined), 0);
});

test('hasWork: quantidade 0 ou tudo excluído fica fora; caixa com erro (sem res) conta', () => {
  const res = G.build(boxA);
  const all = Object.fromEntries(BC.PIECE_KEYS.map(k => [k, 2]));
  assert.strictEqual(BC.hasWork({ qty: 2, excluir: {} }, res), true);
  assert.strictEqual(BC.hasWork({ qty: 0, excluir: {} }, res), false);
  assert.strictEqual(BC.hasWork({ qty: 2, excluir: all }, res), false);
  assert.strictEqual(BC.hasWork({ qty: 2, excluir: Object.assign({}, all, { lid: 1 }) }, res), true, 'sobrou uma tampa');
  assert.strictEqual(BC.hasWork({ qty: 2, excluir: all }, undefined), true);
});

test('normalizeList: projetos antigos (sem excluir, campos ausentes ou inválidos)', () => {
  const list = BC.normalizeList([
    { id: 'a', name: 'Alta', qty: 2, box: boxA },
    { qty: '3', box: boxB, excluir: { left: 1, zzz: 4 } },
    { name: 'sem caixa', qty: 1 },
    null,
    { name: 'x'.repeat(200), qty: 5000, box: boxA },
    { qty: -2, box: boxA },
  ], deps);
  assert.strictEqual(list.length, 4);
  assert.deepStrictEqual(list[0], { id: 'a', name: 'Alta', qty: 2, excluir: {}, box: boxA });
  assert.deepStrictEqual([list[1].id, list[1].name, list[1].qty, list[1].excluir], ['novo', '100x150x300', 3, { left: 1 }]);
  assert.strictEqual(list[2].name.length, 80);
  assert.strictEqual(list[2].qty, 999);
  assert.strictEqual(list[3].qty, 0);
  assert.deepStrictEqual(BC.normalizeList(undefined, deps), []);
  assert.deepStrictEqual(BC.normalizeList('x', deps), []);
});

test('normalizeList é idempotente (salvar e abrir de novo não muda nada)', () => {
  const once = BC.normalizeList([{ id: 'a', name: 'A', qty: 4, box: boxA, excluir: { left: 2, lid: 1 } }], deps);
  const twice = BC.normalizeList(JSON.parse(JSON.stringify(once)), deps);
  assert.deepStrictEqual(twice, once);
});

test('cloneEntry: cópia independente, com as exclusões', () => {
  const e = { id: 'a', name: 'A', qty: 2, excluir: { left: 1 }, box: { W: 1, nested: { x: 1 } } };
  const c = BC.cloneEntry(e, 'b', 'A (2)');
  assert.deepStrictEqual(c, { id: 'b', name: 'A (2)', qty: 2, excluir: { left: 1 }, box: { W: 1, nested: { x: 1 } } });
  c.excluir.left = 2; c.box.nested.x = 9;
  assert.strictEqual(e.excluir.left, 1);
  assert.strictEqual(e.box.nested.x, 1);
});

test('activeEntries: tira quantidade 0 e linhas totalmente excluídas; mantém caixa com erro e a ordem', () => {
  const all = Object.fromEntries(BC.PIECE_KEYS.map(k => [k, 1]));
  const bad = { W: -1 };
  const list = [
    { id: '1', name: 'A', qty: 1, excluir: {}, box: boxA },
    { id: '2', name: 'Zero', qty: 0, excluir: {}, box: boxB },
    { id: '3', name: 'Tudo excluído', qty: 1, excluir: all, box: boxB },
    { id: '4', name: 'Com erro', qty: 1, excluir: {}, box: bad },
    { id: '5', name: 'B', qty: 2, excluir: { lid: 2 }, box: boxB },
  ];
  const act = BC.activeEntries(list, b => (b === bad ? { error: 'inválida' } : build(b)));
  assert.deepStrictEqual(act.map(e => e.id), ['1', '4', '5']);
  assert.ok(act[0].res && act[1].error && !act[1].res);
  assert.strictEqual(list[0].res, undefined, 'não altera a lista original');
});

test('keyEntries: muda com nome, quantidade, caixa e exclusões; não muda com o resto', () => {
  const base = () => [{ id: 'a', name: 'A', qty: 2, excluir: { left: 1 }, box: boxA }];
  const key = l => JSON.stringify(BC.keyEntries(l));
  const k0 = key(base());
  assert.strictEqual(key(base()), k0);
  let l = base(); l[0].excluir = { left: 2 }; assert.notStrictEqual(key(l), k0, 'exclusão');
  l = base(); l[0].excluir = {}; assert.notStrictEqual(key(l), k0, 'zerar exclusões');
  l = base(); l[0].qty = 3; assert.notStrictEqual(key(l), k0, 'quantidade');
  l = base(); l[0].name = 'B'; assert.notStrictEqual(key(l), k0, 'nome');
  l = base(); l[0].box = boxB; assert.notStrictEqual(key(l), k0, 'caixa');
  l = base(); l[0].id = 'outro'; assert.strictEqual(key(l), k0, 'o id não importa');
  l = base(); l.push({ id: 'z', name: 'Z', qty: 0, excluir: {}, box: boxB }); assert.strictEqual(key(l), k0, 'qtd 0 fica fora');
});

test('toJobs + layout: a lista inteira vira o plano com as exclusões (seu exemplo)', () => {
  const list = [{ id: '1', name: 'Alta', qty: 3, excluir: { left: 1 }, box: boxA }];
  const entries = BC.activeEntries(list, build);
  const jobs = BC.toJobs(entries);
  assert.deepStrictEqual(jobs[0].excl, { left: 1 });
  assert.strictEqual(jobs[0].t, boxA.t);
  const plan = G.layout({ jobs }, conf);
  const labels = plan.sheets.flatMap(sh => sh.items.map(it => it.label));
  assert.strictEqual(labels.filter(l => l.includes('Esquerda')).length, 2);
  assert.strictEqual(labels.length, G.build(boxA).panels.length * 3 - 1);
  const csv = G.toCSV({ jobs }, conf, 'Lista').split('\r\n').filter(l => l.startsWith('P,'));
  assert.ok(csv.some(r => r.includes(',2,,Alta · Esquerda,Alta')));
  assert.ok(csv.some(r => r.includes(',3,,Alta · Direita,Alta')));
});
