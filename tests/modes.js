'use strict';
/*
 * Benchmark dos modos.   node tests/modes.js [--time s] [--filter texto] [--modes fast,balanced,intensive]
 * Para cada cenário: chapas, maior sobra e tempo de cada modo. O intensivo usa o limite de tempo dado.
 */
const H = require('./lib/harness.js');
const { all } = require('./lib/scenarios.js');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const time = +arg('--time', 5), filter = arg('--filter', null);
const modes = arg('--modes', 'fast,balanced,intensive').split(',');
const rows = [];
for (const sc of all().filter(s => !filter || s.name.includes(filter))) {
  const row = { name: sc.name, opt: sc.optimum || H.lowerBound(sc.panels, sc.conf).sheets + '*' };
  for (const m of modes) {
    const conf = Object.assign({}, sc.conf, { optMode: m, optTime: time });
    const t0 = Date.now();
    const plan = H.G.layout({ panels: sc.panels }, conf);
    const ms = Date.now() - t0;
    const me = H.measure(plan, sc.panels, conf);
    if (me.errors.length) console.log('  ERRO', sc.name, m, me.errors[0]);
    row[m] = `${me.sheets} ${me.big ? Math.round(me.big.w) + 'x' + Math.round(me.big.h) : '-'} ${ms}ms ${plan.stats.strategy}`;
  }
  rows.push(row);
  console.log(row.name.slice(0, 50).padEnd(51) + String(row.opt).padStart(3) + '  ' + modes.map(m => row[m].padEnd(40)).join(''));
}
