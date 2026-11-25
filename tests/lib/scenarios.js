'use strict';
/*
 * Cenários de teste e benchmark. Cada um: { name, tags, panels, conf, optimum? }
 *   conf     : sheetW, sheetH, gap, margin, grain, qty, pieceGrain (qty vale para todas as peças)
 *   optimum  : número de chapas ótimo conhecido (quando se sabe), para medir a qualidade do motor
 * tags: 'dificil' = ótimo conhecido que o modo equilibrado ainda não alcança (só a intensiva, às vezes).
 * Vários modelos de caixa no mesmo plano = painéis de modelos diferentes na mesma lista (qty 1).
 */
const H = require('./harness.js');
const { boxPanels, rectPanels, perfectTiling, boxCfg } = H;

function grainMapOf(panels) {
  const m = {};
  for (const p of panels) { const g = /:([uv])$/.exec(p.name); if (g) m[p.name] = g[1]; }
  return m;
}

function make(name, tags, panels, conf, optimum) {
  const c = Object.assign({ sheetW: 1000, sheetH: 800, gap: 0, margin: 0, grain: 'none', qty: 1 }, conf || {});
  c.pieceGrain = Object.assign(grainMapOf(panels), c.pieceGrain || {});
  return { name, tags, panels, conf: c, optimum };
}

function tilingSpecs(w, h, parts, seed) {
  return perfectTiling(w, h, parts, seed).map(r => [r.w, r.h, 1]);
}

function all() {
  const S = [];

  // ---- caixas reais ----
  S.push(make('caixa única 500x300x200, gap 0', ['caixa'], boxPanels({}), {}));
  S.push(make('caixa única, gap 5 margem 5', ['caixa', 'gap'], boxPanels({}), { gap: 5, margin: 5 }));
  S.push(make('2 caixas 500x300x200, gap 5 margem 5 (sobra contínua)', ['caixa', 'repetidas', 'gap', 'sobras'], boxPanels({}, 2), { gap: 5, margin: 5 }));
  S.push(make('10 caixas 500x300x200, gap 5 margem 5', ['caixa', 'repetidas', 'gap', 'reorganizar'], boxPanels({}, 10), { gap: 5, margin: 5 }));
  S.push(make('4 caixas iguais 500x300x200', ['caixa', 'repetidas'], boxPanels({}, 4), {}));
  S.push(make('10 caixas pequenas 100x80x60, chapa 600x400', ['caixa', 'repetidas'], boxPanels({ W: 100, D: 80, H: 60, t: 3, toothVert: 10, toothBaseX: 10, toothBaseY: 10, toothLidX: 20, toothLidY: 20 }, 10), { sheetW: 600, sheetH: 400 }));
  S.push(make('caixa grande em chapa pequena 1200x600', ['caixa', 'chapa'], boxPanels({ W: 400, D: 300, H: 250 }, 2), { sheetW: 1200, sheetH: 600 }));
  S.push(make('kerf 0,3 e fit 0,2, gap 2', ['caixa', 'kerf'], boxPanels({ kerf: 0.3, fit: 0.2 }, 3), { gap: 2, margin: 3 }));
  S.push(make('sem compensação de kerf', ['caixa', 'kerf'], boxPanels({ kerfComp: false }, 3), {}));
  S.push(make('veio horizontal na chapa, peças com veio', ['caixa', 'veio'], boxPanels({}, 3, ''), {
    grain: 'h', pieceGrain: { front: 'u', back: 'u', left: 'u', right: 'u', bottom: 'v', lid: 'v' },
  }));
  // vários modelos no mesmo plano (preparação para a lista de modelos)
  S.push(make('modelos: 1× 200x300x500 + 2× 100x150x300', ['caixa', 'modelos'],
    boxPanels({ W: 200, D: 300, H: 500 }, 1, 'A').concat(boxPanels({ W: 100, D: 150, H: 300 }, 2, 'B')), {}));
  S.push(make('modelos: 3 tamanhos, chapa 800x600, margem 10', ['caixa', 'modelos', 'gap'],
    boxPanels({ W: 250, D: 180, H: 120 }, 2, 'A').concat(boxPanels({ W: 120, D: 90, H: 60, t: 4 }, 4, 'B'), boxPanels({ W: 300, D: 200, H: 80 }, 1, 'C')),
    { sheetW: 800, sheetH: 600, margin: 10, gap: 1 }));

  // ---- ótimo conhecido ----
  S.push(make('ótimo: 4 peças 500x400 em 1000x800', ['otimo'], rectPanels([[500, 400, 4]]), {}, 1));
  S.push(make('ótimo: 12 peças 300x100 (faixas) em 900x400', ['otimo', 'faixas'], rectPanels([[300, 100, 12]]), { sheetW: 900, sheetH: 400 }, 1));
  S.push(make('ótimo: 2 chapas de peças 100x200 (12 por chapa 600x400)', ['otimo', 'faixas'], rectPanels([[100, 200, 24]]), { sheetW: 600, sheetH: 400 }, 2));
  S.push(make('ótimo: faixas verticais 100x700 + horizontais 900x100', ['otimo', 'faixas'], rectPanels([[100, 700, 9], [900, 100, 1]]), {}, 1));
  S.push(make('ótimo: orientação mista (peças 300x100 e 100x300)', ['otimo', 'mista'], rectPanels([[300, 100, 6], [100, 300, 6]]), { sheetW: 600, sheetH: 600 }, 1));
  S.push(make('ótimo: tiling guilhotinado 12 peças (sem veio)', ['otimo', 'tiling'], rectPanels(tilingSpecs(1000, 800, 12, 11)), {}, 1));
  S.push(make('ótimo: tiling guilhotinado 24 peças (sem veio)', ['otimo', 'tiling', 'dificil'], rectPanels(tilingSpecs(1000, 800, 24, 5)), {}, 1));
  S.push(make('ótimo: 2 tilings de 14 peças', ['otimo', 'tiling', 'dificil'], rectPanels(tilingSpecs(1000, 800, 14, 3).concat(tilingSpecs(1000, 800, 14, 9))), {}, 2));
  S.push(make('ótimo: tiling 20 peças, chapa 900x500', ['otimo', 'tiling', 'dificil'], rectPanels(tilingSpecs(900, 500, 20, 21)), { sheetW: 900, sheetH: 500 }, 1));

  // ---- outros casos ----
  S.push(make('veio vertical força orientação (peças 300x100 com veio v)', ['veio'], rectPanels([[300, 100, 8, 'u'], [100, 300, 4, 'v']]), { sheetW: 600, sheetH: 600, grain: 'v' }));
  S.push(make('sobras fragmentadas: muitas pequenas e poucas grandes', ['fragmentacao'], rectPanels([[480, 380, 4], [90, 60, 30], [60, 40, 40]]), {}));
  S.push(make('eliminar uma chapa por reorganização', ['reorganizar'], rectPanels([[600, 400, 3], [400, 400, 2], [200, 400, 3], [300, 200, 3], [200, 300, 3]]), {}));
  S.push(make('muitas peças pequenas iguais (100x50 ×150)', ['repetidas', 'carga'], rectPanels([[100, 50, 150]]), {}));
  S.push(make('mistura aleatória de 60 peças', ['carga'], (() => {
    const r = H.rng(77), s = [];
    for (let i = 0; i < 60; i++) s.push([30 + Math.floor(r() * 25) * 10, 30 + Math.floor(r() * 25) * 10, 1]);
    return rectPanels(s);
  })(), {}));
  S.push(make('gap positivo: 12 peças 300x100 com gap 5 em 900x400', ['gap'], rectPanels([[300, 100, 8]]), { sheetW: 900, sheetH: 400, gap: 5 }));
  S.push(make('peça maior que a chapa', ['borda'], rectPanels([[1200, 100, 1], [300, 200, 3]]), {}));
  return S;
}

module.exports = { all, make, boxCfg };
