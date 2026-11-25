'use strict';
// Tempo do plano com muitas caixas.  node tests/stress.js [qty ...]
const H = require('./lib/harness.js');
const qtys = process.argv.slice(2).map(Number);
for (const qty of (qtys.length ? qtys : [10, 30, 100])) {
  const panels = H.boxPanels({}, 1);
  for (const optMode of ['legacy', 'fast', 'balanced']) {
    const conf = { sheetW: 1000, sheetH: 800, gap: 0, margin: 0, grain: 'none', qty, pieceGrain: {}, optMode };
    const t0 = Date.now();
    const plan = H.G.layout({ panels }, conf);
    const m = H.measure(plan, panels, conf);
    console.log(`qty ${qty} (${qty * panels.length} peças) ${optMode}: ${plan.sheets.length} chapas (limite por área ${H.lowerBound(panels, conf).sheets}), ${Date.now() - t0} ms, erros ${m.errors.length}, estratégia ${plan.stats.strategy}`);
  }
}
