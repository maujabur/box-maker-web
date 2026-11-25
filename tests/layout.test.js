'use strict';
/*
 * Validade do plano de corte atual em todos os cenários: peças dentro da chapa, sem sobreposição,
 * distância mínima respeitada e dimensões/contornos preservados.
 * Também fixa o baseline: o motor não pode piorar o número de chapas gravado em tests/baseline.json
 * (algoritmo original) e deve alcançar os ótimos conhecidos (menos os marcados como difíceis).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./lib/harness.js');
const { all } = require('./lib/scenarios.js');
const { run } = require('./bench.js');

const baselineFile = path.join(__dirname, 'baseline.json');
const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : [];

for (const sc of all()) {
  test('plano válido: ' + sc.name, () => {
    const r = run(sc, H.G.layout);
    assert.deepStrictEqual(r.errors, []);
    const b = baseline.find(x => x.name === sc.name);
    if (b) assert.ok(r.sheets <= b.sheets, `${r.sheets} chapas, o baseline tinha ${b.sheets}`);
    // ótimo conhecido: o modo equilibrado deve alcançá-lo (exceto os casos marcados como difíceis)
    if (sc.optimum && !sc.tags.includes('dificil')) assert.strictEqual(r.sheets, sc.optimum, 'ótimo conhecido');
    if (sc.optimum) assert.ok(r.sheets >= sc.optimum, 'menos chapas que o ótimo: medição errada');
  });
}

// Rápido: até FAST_FULL_LEGACY peças roda o algoritmo original completo, então nunca usa mais chapas que ele
const PL = require('../packing/plan.js');
for (const sc of all()) {
  const n = sc.panels.length * (sc.conf.qty || 1);
  if (n > PL.FAST_FULL_LEGACY) continue;
  test('rápido não é pior que o original: ' + sc.name, () => {
    const fast = run(sc, H.G.layout, { optMode: 'fast' }), legacy = run(sc, H.G.layout, { optMode: 'legacy' });
    assert.deepStrictEqual(fast.errors, []);
    assert.ok(fast.sheets <= legacy.sheets, `rápido ${fast.sheets}, original ${legacy.sheets}`);
  });
}
