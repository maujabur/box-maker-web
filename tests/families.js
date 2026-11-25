'use strict';
// Quem vence em cada cenário: melhor número de chapas do legacy x das estratégias novas.   node tests/families.js
const H = require('./lib/harness.js');
const { all } = require('./lib/scenarios.js');
require('../packing/rects.js'); require('../packing/ranking.js');
const E = require('../packing/engine.js');
const S = require('../packing/strategies.js');
const G = H.G;
let newWins = 0, legacyWins = 0, ties = 0;
for (const sc of all()) {
  const out = (() => {
    const it = G.layoutSteps({ panels: sc.panels }, sc.conf); let r = it.next(); while (!r.done) r = it.next(); return r.value;
  })();
  const st = out.stats;
  const tag = st.strategy.startsWith('legacy') ? 'legacy' : 'novo';
  console.log(`${tag.padEnd(7)}${st.strategy.padEnd(26)}${String(out.sheets.length).padStart(3)} chapas  ${sc.name}`);
}
