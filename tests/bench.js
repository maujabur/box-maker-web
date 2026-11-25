'use strict';
/*
 * Benchmark do plano de corte.
 *   node tests/bench.js [--mode fast|balanced|intensive] [--time s] [--filter texto]
 *                       [--save arquivo.json] [--compare arquivo.json]
 * Roda o motor (G.layout) em todos os cenários e mostra: chapas, maior sobra, sobras úteis, alcance das
 * sobras (bolsões), tempo e problemas de validade. --save grava o resultado; --compare compara com um
 * resultado gravado (tests/baseline.json = algoritmo original, antes do novo motor).
 */
const fs = require('fs');
const H = require('./lib/harness.js');
const { all } = require('./lib/scenarios.js');

function run(sc, layoutFn, extra) {
  const conf = Object.assign({}, sc.conf, extra || {});
  const t0 = process.hrtime.bigint();
  const plan = layoutFn({ panels: sc.panels }, conf);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const m = H.measure(plan, sc.panels, sc.conf);
  const lb = H.lowerBound(sc.panels, sc.conf);
  return { name: sc.name, optimum: sc.optimum || null, lowerBound: lb.sheets, sheets: m.sheets, oversize: m.oversize,
    bigArea: Math.round(m.bigArea), bigW: m.big ? Math.round(m.big.w) : 0, bigH: m.big ? Math.round(m.big.h) : 0,
    usefulArea: Math.round(m.usefulArea), usefulCount: m.usefulCount, reach: Math.round(m.reach), ms: Math.round(ms), errors: m.errors,
    strategy: plan.stats && plan.stats.strategy,
    sheetArea: (sc.conf.sheetW - 2 * sc.conf.margin) * (sc.conf.sheetH - 2 * sc.conf.margin) };
}

function table(rows) {
  const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
  console.log(pad('cenário', 62) + lp('chapas', 7) + lp('ótimo', 6) + lp('maior sobra', 14) + lp('úteis', 9) + lp('n', 3) + lp('alcance', 9) + lp('ms', 7) + '  erros');
  for (const r of rows) {
    console.log(pad(r.name.slice(0, 61), 62) + lp(r.sheets, 7) + lp(r.optimum || r.lowerBound + '*', 6) +
      lp(`${r.bigW}x${r.bigH}`, 14) + lp(r.usefulArea, 9) + lp(r.usefulCount, 3) + lp(r.reach != null ? r.reach : '-', 9) + lp(r.ms, 7) + (r.errors.length ? '  ' + r.errors.length + ' ERRO(S)' : ''));
  }
  console.log('* = limite inferior por área (não é necessariamente alcançável)');
}

// compara com um resultado gravado: chapas, maior sobra e sobras úteis (+ melhor, - pior)
function compare(rows, file) {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sign = (a, b) => (a > b ? '+' : a < b ? '-' : '=');
  let better = 0, worse = 0;
  console.log('\ncomparação com ' + file + '  (chapas / maior sobra / úteis / tempo)');
  for (const r of rows) {
    const b = base.find(x => x.name === r.name);
    if (!b) continue;
    const s = r.sheets < b.sheets ? '+' : r.sheets > b.sheets ? '-' : '=';
    // diferenças abaixo da tolerância do ranking contam como empate (0,25% da chapa na maior sobra, 1% nas úteis)
    const tolSign = (a, c, t) => (Math.abs(a - c) <= t ? '=' : a > c ? '+' : '-');
    const g = tolSign(r.bigArea, b.bigArea, 0.0025 * r.sheetArea), u = tolSign(r.usefulArea, b.usefulArea, 0.01 * r.sheetArea);
    if (s === '+' || (s === '=' && (g === '+' || (g === '=' && u === '+')))) better++;
    if (s === '-' || (s === '=' && (g === '-' || (g === '=' && u === '-')))) worse++;
    console.log(`  ${s} ${g} ${u}  ${r.name.slice(0, 55).padEnd(56)} chapas ${b.sheets}→${r.sheets}  sobra ${b.bigArea}→${r.bigArea}  ${b.ms}→${r.ms} ms`);
  }
  console.log(`melhores: ${better}, piores: ${worse}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const save = args.includes('--save') ? args[args.indexOf('--save') + 1] : null;
  const filter = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : null;
  const extra = {};
  if (args.includes('--mode')) extra.optMode = args[args.indexOf('--mode') + 1];
  if (args.includes('--time')) extra.optTime = +args[args.indexOf('--time') + 1];
  const rows = all().filter(s => !filter || s.name.includes(filter)).map(s => run(s, H.G.layout, extra));
  table(rows);
  for (const r of rows) for (const e of r.errors) console.log(`  [${r.name}] ${e}`);
  if (args.includes('--compare')) compare(rows, args[args.indexOf('--compare') + 1]);
  if (save) { fs.writeFileSync(save, JSON.stringify(rows, null, 1)); console.log('gravado em ' + save); }
}
module.exports = { run, table };
