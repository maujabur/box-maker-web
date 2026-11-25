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

// ---------- excluir peças do plano (excl: { peça: n }) ----------
const labelsOf = plan => plan.sheets.flatMap(sh => sh.items.map(it => it.label));
const count = (plan, text) => labelsOf(plan).filter(l => l.includes(text)).length;

test('excluir: 3 caixas com 1 lateral esquerda já pronta dão 2 esquerdas e 3 de cada outra peça', () => {
  const plan = G.layout({ jobs: [{ res: A, qty: 3, name: 'Alta', excl: { left: 1 } }] }, conf);
  assert.strictEqual(count(plan, 'Esquerda'), 2);
  for (const f of ['Direita', 'Frente', 'Trás', 'Fundo', 'Tampa']) assert.strictEqual(count(plan, f), 3, f);
  assert.strictEqual(labelsOf(plan).length, A.panels.length * 3 - 1);
  assert.strictEqual(new Set(plan.sheets.flatMap(sh => sh.items.map(it => it.name))).size, labelsOf(plan).length, 'nomes únicos');
});

test('excluir: o plano mede válido e contém exatamente as peças restantes', () => {
  const plan = G.layout({ jobs: [{ res: A, qty: 3, name: 'Alta', excl: { left: 1, lid: 2 } }] }, conf);
  const left = A.panels.find(p => p.name === 'left'), lid = A.panels.find(p => p.name === 'lid');
  const rest = [];
  for (let c = 1; c <= 3; c++) for (const p of A.panels) {
    if (p === left && c > 2) continue;
    if (p === lid && c > 1) continue;
    rest.push(p);
  }
  const m = H.measure(plan, rest, Object.assign({}, conf, { qty: 1 }));
  assert.deepStrictEqual(m.errors, []);
});

test('excluir: tudo excluído (ou mais que a quantidade) tira a peça; sem exclusões o resultado não muda', () => {
  const plan = G.layout({ jobs: [{ res: A, qty: 2, name: 'Alta', excl: { left: 2, lid: 9 } }] }, conf);
  assert.strictEqual(count(plan, 'Esquerda'), 0);
  assert.strictEqual(count(plan, 'Tampa'), 0);
  assert.strictEqual(count(plan, 'Frente'), 2);
  const a = G.layout({ jobs: [{ res: A, qty: 2, name: 'Alta' }] }, conf);
  const b = G.layout({ jobs: [{ res: A, qty: 2, name: 'Alta', excl: {} }] }, conf);
  const c = G.layout({ jobs: [{ res: A, qty: 2, name: 'Alta', excl: { left: 0, front: -3, back: 'x' } }] }, conf);
  assert.deepStrictEqual(labelsOf(b).sort(), labelsOf(a).sort());
  assert.deepStrictEqual(labelsOf(c).sort(), labelsOf(a).sort(), 'valores inválidos ou zero são ignorados');
});

test('excluir: a exclusão vale só para a caixa da linha', () => {
  const plan = G.layout({ jobs: [{ res: A, qty: 2, name: 'Alta', excl: { left: 2 } }, { res: B, qty: 2, name: 'Baixa' }] }, conf);
  assert.strictEqual(count(plan, 'Alta · Esquerda') + count(plan, 'Alta #1 · Esquerda') + count(plan, 'Alta #2 · Esquerda'), 0);
  assert.strictEqual(labelsOf(plan).filter(l => l.startsWith('Baixa') && l.includes('Esquerda')).length, 2);
});

test('excluir: o CSV traz a quantidade restante e omite a peça totalmente excluída', () => {
  const rows = G.toCSV({ jobs: [{ res: A, qty: 3, name: 'Alta', excl: { left: 1, lid: 3 }, t: 6, kerf: 0.1 }] }, conf, 'Lista')
    .split('\r\n').filter(l => l.startsWith('P,'));
  assert.strictEqual(rows.length, A.panels.length - 1);
  assert.ok(rows.some(r => r.includes(',2,,Alta · Esquerda,Alta')));
  assert.ok(rows.some(r => r.includes(',3,,Alta · Direita,Alta')));
  assert.ok(!rows.some(r => r.includes('Tampa')));
});

test('excluir: pieceQty nunca passa de zero para baixo', () => {
  assert.strictEqual(G.pieceQty(3, { left: 1 }, 'left'), 2);
  assert.strictEqual(G.pieceQty(3, { left: 5 }, 'left'), 0);
  assert.strictEqual(G.pieceQty(3, {}, 'left'), 3);
  assert.strictEqual(G.pieceQty(3, undefined, 'left'), 3);
});
