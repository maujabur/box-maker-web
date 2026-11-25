'use strict';
/*
 * Utilidades de teste e benchmark do plano de corte (Node, sem dependências).
 *  - construtores de peças (caixas reais de G.build e retângulos sintéticos);
 *  - medição independente do resultado: validade, dimensões, sobras e tempo.
 * A medição não usa nada do motor de empacotamento: só o resultado (chapas com peças posicionadas).
 */
const G = require('../../geometry.js');
const R = require('../../packing/rects.js');

const MIN_USEFUL = 50; // menor lado de uma sobra "útil", mm

// configuração base de uma caixa (os mesmos valores padrão do app)
function boxCfg(over) {
  return Object.assign({
    dimMode: 'outer', W: 500, D: 300, H: 200, t: 6, kerf: 0.1, kerfComp: true, fit: 0.1,
    toothVert: 20, toothBaseX: 20, toothBaseY: 20, toothLidX: 100, toothLidY: 100, chamfer: 0.5, chamferLid: 1,
    bottomMode: 'wallTabs', lidEnabled: true, lidPos: 'outer', lidTeeth: true, lidClearance: 0, lidFitSame: false, lidFit: -0.1,
    qty: 1, sheetW: 1000, sheetH: 800, gap: 0, margin: 0, grain: 'none', pieceGrain: {},
  }, over || {});
}

// Peças de uma caixa; `tag` e `count` repetem o modelo (várias caixas do mesmo modelo, vários modelos).
function boxPanels(over, count, tag) {
  const res = G.build(boxCfg(over));
  const out = [];
  for (let c = 1; c <= (count || 1); c++) {
    for (const p of res.panels) {
      out.push(Object.assign({}, p, { name: (tag ? tag + ':' : '') + p.name, label: (tag ? tag + ' ' : '') + p.label, poly: p.poly.map(q => [q[0], q[1]]), holes: [] }));
    }
  }
  return out;
}

// Retângulos lisos: specs = [[w, h, quantidade, veio('none'|'u'|'v')]]
function rectPanels(specs) {
  const out = [];
  let n = 0;
  for (const [w, h, qty, g] of specs) {
    for (let i = 0; i < (qty || 1); i++) {
      n++;
      out.push({ name: 'r' + n + (g && g !== 'none' ? ':' + g : ''), label: `${w}x${h} #${n}`, w, h, holes: [], grainKind: g || 'none', poly: [[0, 0], [w, 0], [w, h], [0, h]] });
    }
  }
  return out;
}

// Gerador pseudoaleatório com semente (cenários reproduzíveis)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Divide w×h em retângulos por cortes guilhotinados: instância cujo ótimo conhecido é 1 chapa (aproveitamento 100%).
function perfectTiling(w, h, parts, seed) {
  const rand = rng(seed);
  let rs = [{ w, h }];
  while (rs.length < parts) {
    // divide a maior peça ao longo do lado maior, em posição aleatória (múltiplo de 10 mm)
    rs.sort((a, b) => b.w * b.h - a.w * a.h);
    const r = rs.shift();
    const vert = r.w >= r.h;
    const L = vert ? r.w : r.h;
    if (L < 40) { rs.push(r); break; }
    const cut = Math.max(10, Math.min(L - 10, Math.round((L * (0.3 + 0.4 * rand())) / 10) * 10));
    rs.push(vert ? { w: cut, h: r.h } : { w: r.w, h: cut }, vert ? { w: L - cut, h: r.h } : { w: r.w, h: L - cut });
  }
  return rs;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
}
function bboxOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const sizeKey = (w, h) => { const a = Math.min(w, h), b = Math.max(w, h); return a.toFixed(3) + 'x' + b.toFixed(3); };

/*
 * Mede um plano. `conf`: cfg usada (sheetW, sheetH, gap, margin).
 * Devolve { sheets, oversize, errors[], leftover: {...} }.
 */
function measure(plan, panels, conf) {
  const margin = Math.max(0, +conf.margin || 0), gap = Math.max(0, +conf.gap || 0);
  const SW = +conf.sheetW, SH = +conf.sheetH;
  const qty = Math.max(1, Math.round(+conf.qty || 1));
  const errors = [];

  // dimensões preservadas: mesma lista de (w, h) e mesma área de contorno, peça a peça
  const want = {}, got = {};
  let wantArea = 0, gotArea = 0;
  for (let c = 0; c < qty; c++) for (const p of panels) {
    const b = bboxOf(p.poly); const k = sizeKey(b.w, b.h);
    want[k] = (want[k] || 0) + 1; wantArea += polyArea(p.poly);
  }
  let items = 0;
  plan.sheets.forEach(sh => sh.items.forEach(it => {
    const b = bboxOf(it.poly); const k = sizeKey(b.w, b.h);
    got[k] = (got[k] || 0) + 1; gotArea += polyArea(it.poly); items++;
  }));
  if (JSON.stringify(Object.entries(want).sort()) !== JSON.stringify(Object.entries(got).sort())) errors.push('lista de dimensões das peças diferente da entrada');
  if (Math.abs(wantArea - gotArea) > 1e-3) errors.push(`área dos contornos mudou (${wantArea.toFixed(2)} → ${gotArea.toFixed(2)})`);

  const perSheet = [];
  let oversize = 0;
  const box = { x0: margin, y0: margin, x1: SW - margin, y1: SH - margin };
  plan.sheets.forEach((sh, si) => {
    if (sh.oversize) { oversize++; perSheet.push({ oversize: true, items: sh.items.length, big: null, useful: [], usage: 1 }); return; }
    if (sh.width !== SW || sh.height !== SH) errors.push(`chapa ${si + 1} com tamanho diferente do pedido`);
    const rects = sh.items.map(it => bboxOf(it.poly));
    for (const e of R.validateSheet(rects, box, gap)) errors.push(`chapa ${si + 1}: ${e}`);
    const big = R.largestEmptyRect(rects, box, 0);
    const useful = R.usefulRects(rects, box, MIN_USEFUL, 8);
    // alcance (bolsões): área onde cabe um quadrado de 2× e de 3× o menor lado útil
    const reach = R.reachArea(rects, box, 2 * MIN_USEFUL) + R.reachArea(rects, box, 3 * MIN_USEFUL);
    const used = rects.reduce((a, r) => a + r.w * r.h, 0);
    perSheet.push({ items: sh.items.length, big, useful, reach, usage: used / ((box.x1 - box.x0) * (box.y1 - box.y0)) });
  });
  if (items !== plan.sheets.reduce((a, s) => a + s.items.length, 0)) errors.push('contagem de peças inconsistente');

  const bigs = perSheet.filter(s => s.big).map(s => s.big);
  const bigJob = bigs.reduce((m, r) => (!m || R.area(r) > R.area(m) ? r : m), null);
  const useful = perSheet.flatMap(s => s.useful);
  return {
    sheets: plan.sheets.length, oversize, errors, pieces: items, perSheet,
    bigArea: bigJob ? R.area(bigJob) : 0, big: bigJob,
    usefulArea: useful.reduce((a, r) => a + R.area(r), 0), usefulCount: useful.length,
    reach: perSheet.reduce((a, s) => a + (s.reach || 0), 0),
  };
}

// área total das peças e limite inferior do número de chapas
function lowerBound(panels, conf) {
  const margin = Math.max(0, +conf.margin || 0);
  const qty = Math.max(1, Math.round(+conf.qty || 1));
  const usable = (conf.sheetW - 2 * margin) * (conf.sheetH - 2 * margin);
  let a = 0;
  for (let c = 0; c < qty; c++) for (const p of panels) { const b = bboxOf(p.poly); a += b.w * b.h; }
  return { area: a, sheets: Math.ceil(a / usable - 1e-9) };
}

module.exports = { G, R, MIN_USEFUL, boxCfg, boxPanels, rectPanels, perfectTiling, rng, measure, lowerBound, polyArea, bboxOf };
