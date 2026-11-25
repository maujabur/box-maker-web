'use strict';
// Desenha em texto as chapas de um plano.  node tests/show.js [qty] [gap] [margin]
const H = require('./lib/harness.js');
const qty = +process.argv[2] || 2, gap = process.argv[3] != null ? +process.argv[3] : 5, margin = process.argv[4] != null ? +process.argv[4] : 5;
const panels = H.boxPanels({}, 1);
const conf = { sheetW: 1000, sheetH: 800, gap, margin, grain: 'none', qty, pieceGrain: {} };
const plan = H.G.layout({ panels }, conf);
console.log(`${plan.sheets.length} chapas; estratégia ${plan.stats.strategy}; maior sobra do trabalho ${JSON.stringify(plan.stats.big && { x: Math.round(plan.stats.big.x), y: Math.round(plan.stats.big.y), w: Math.round(plan.stats.big.w), h: Math.round(plan.stats.big.h) })}`);
plan.sheets.forEach((sh, i) => {
  console.log(`chapa ${i + 1}: uso ${(sh.usage * 100).toFixed(0)}%  maior sobra ${sh.leftover && sh.leftover.big ? [sh.leftover.big.x, sh.leftover.big.y, sh.leftover.big.w, sh.leftover.big.h].map(Math.round).join(',') : '-'}`);
  for (const it of sh.items) { const b = H.bboxOf(it.poly); console.log(`   ${it.label.padEnd(10)} x ${b.x.toFixed(0).padStart(4)} y ${b.y.toFixed(0).padStart(4)}  ${b.w.toFixed(0)}x${b.h.toFixed(0)}${it.rotated ? ' girada' : ''}`); }
});
