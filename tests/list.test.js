'use strict';
// Plano de corte com lista de caixas ({ jobs }): várias caixas, quantidades, zero, rótulos, CSV.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./lib/harness.js');
const G = H.G;
const conf = { sheetW: 1000, sheetH: 800, gap: 2, margin: 5, grain: 'none', optMode: 'fast' };
const A = G.build(H.boxCfg({ W: 200, D: 300, H: 500 })), B = G.build(H.boxCfg({ W: 100, D: 150, H: 300 }));

test('lista: todas as peças de todas as caixas, válidas, com nome e número da cópia', () => {
  const plan = G.layout({ jobs: [{ res: A, qty: 1, name: 'Alta' }, { res: B, qty: 3, name: 'Baixa' }] }, conf);
  const panels = A.panels.concat(B.panels, B.panels, B.panels);
  const m = H.measure(plan, panels, Object.assign({}, conf, { qty: 1 }));
  assert.deepStrictEqual(m.errors, []);
  assert.strictEqual(plan.qty, 4);
  const labels = plan.sheets.flatMap(sh => sh.items.map(it => it.label));
  assert.ok(labels.includes('Alta · Frente'));
  assert.ok(labels.includes('Baixa #3 · Tampa'));
  assert.strictEqual(new Set(plan.sheets.flatMap(sh => sh.items.map(it => it.name))).size, labels.length, 'nomes únicos');
});

test('lista: quantidade 0 fica fora; uma caixa só equivale ao modo antigo (sem nome nos rótulos)', () => {
  const plan = G.layout({ jobs: [{ res: A, qty: 2, name: 'Alta' }, { res: B, qty: 0, name: 'Baixa' }] }, conf);
  const old = G.layout(A, Object.assign({}, conf, { qty: 2 }));
  const lab = p => p.sheets.flatMap(sh => sh.items.map(it => it.label)).sort();
  assert.deepStrictEqual(lab(plan), lab(old));
  assert.strictEqual(plan.sheets.length, old.sheets.length);
  assert.ok(!lab(plan).some(l => l.includes('Baixa')));
});

test('lista: veio de cada caixa vale só para as peças dela', () => {
  const c = Object.assign({}, conf, { grain: 'h' });
  const plan = G.layout({ jobs: [
    { res: A, qty: 1, name: 'Com veio', pieceGrain: { front: 'v', back: 'v', left: 'v', right: 'v', bottom: 'v', lid: 'v' } },
    { res: B, qty: 1, name: 'Sem veio', pieceGrain: {} },
  ] }, c);
  for (const sh of plan.sheets) for (const it of sh.items) {
    if (it.label.startsWith('Com veio')) assert.ok(it.grained && it.rotated, it.label + ': veio v na chapa h exige girar');
    else assert.ok(!it.grained, it.label);
  }
});

test('CSV da lista: uma linha por peça de cada caixa, com a quantidade dela', () => {
  const csv = G.toCSV({ jobs: [{ res: A, qty: 1, name: 'Alta', t: 6, kerf: 0.1 }, { res: B, qty: 3, name: 'Baixa', t: 6, kerf: 0.1 }, { res: B, qty: 0, name: 'Zero', t: 6, kerf: 0.1 }] }, conf, 'Lista');
  const rows = csv.split('\r\n').filter(l => l.startsWith('P,'));
  assert.strictEqual(rows.length, A.panels.length + B.panels.length);
  assert.ok(rows.some(r => r.includes(',3,,Baixa · Frente,Baixa')));
  assert.ok(!csv.includes('Zero'));
});
