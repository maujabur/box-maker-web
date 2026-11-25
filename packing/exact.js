/*
 * Busca em profundidade para usar menos chapas (estratégia "exata" com limite de esforço).
 *
 * Pergunta: as peças cabem em T chapas? A área livre total permitida é fixa:
 *   folga = T × (área da chapa) − (área das peças).
 * A busca preenche sempre o ponto livre mais baixo e mais à esquerda (linha do horizonte, "skyline"):
 * ou põe ali uma peça que caiba (todas as orientações permitidas), ou declara aquele trecho como
 * sobra, elevando-o até o vizinho mais baixo; a sobra declarada consome a folga, e o ramo morre quando
 * ela acaba. Toda disposição "encostada embaixo e à esquerda" é alcançável; para encaixes perfeitos ou
 * quase perfeitos a busca é completa (só o limite de nós a interrompe).
 *
 * Peças com o mesmo tamanho e a mesma restrição de veio formam um tipo só: a busca escolhe tipos, não
 * peças, o que elimina permutações equivalentes (muito comum com várias caixas iguais).
 *
 * A distância mínima (gap) é tratada como nos demais algoritmos: chapa e peças infladas pelo gap.
 */
(function boxpackModule(root) {
  'use strict';
  const ns = root.BoxPack || (root.BoxPack = {});
  const E = 1e-7;

  function typesOf(items, gap) {
    const map = new Map();
    for (const it of items) {
      const k = `${it.w.toFixed(4)}x${it.h.toFixed(4)}#${it.fixed}`;
      if (!map.has(k)) {
        const ors = [];
        const add = r => ors.push({ r, w: (r ? it.h : it.w) + gap, h: (r ? it.w : it.h) + gap });
        if (it.fixed === -1) { add(0); if (Math.abs(it.w - it.h) > E) add(1); } else add(it.fixed);
        map.set(k, { items: [], ors, area: (it.w + gap) * (it.h + gap) });
      }
      map.get(k).items.push(it);
    }
    // maiores primeiro: falham cedo (poda) e deixam as pequenas para tapar o fim
    return [...map.values()].sort((a, b) => b.area - a.area);
  }

  /*
   * Tenta pôr todas as peças em `target` chapas. Devolve a solução ou null (impossível dentro do limite).
   * opts.nodes: limite de nós (padrão 200 000).
   */
  function packInto(problem, target, opts) {
    const gap = problem.gap;
    const W = problem.width + gap, H = problem.height + gap;
    const types = typesOf(problem.items, gap);
    const count = types.map(t => t.items.length);
    let budget = target * W * H - types.reduce((s, t) => s + t.area * t.items.length, 0);
    if (budget < -E) return null;
    const maxNodes = (opts && opts.nodes) || 200000;
    let nodes = 0, left = problem.items.length;
    const minSide = () => {
      let m = Infinity;
      types.forEach((t, i) => { if (count[i]) for (const o of t.ors) m = Math.min(m, o.w); });
      return m;
    };

    const sheets = []; // [{ placed: [{ type, r, x, y }] }]
    let sky = null, cur = null;

    // Maior soma de larguras de peças restantes (com repetição limitada pela quantidade) que cabe em L.
    // A parte de L que nenhuma combinação cobre vira sobra, inevitavelmente. Guardado por (L, quantidades).
    const memo = new Map();
    const q = v => Math.round(v * 1e4);
    function coverable(L) {
      const key = q(L) + ':' + count.join(',');
      let v = memo.get(key);
      if (v !== undefined) return v;
      let sums = new Set([0]), bestS = 0;
      const lim = q(L);
      types.forEach((t, i) => {
        if (!count[i]) return;
        const ws = [...new Set(t.ors.map(o => q(o.w)))];
        for (let c = 0; c < count[i]; c++) {
          const next = new Set(sums);
          for (const a of sums) for (const w of ws) { const b = a + w; if (b <= lim) { next.add(b); if (b > bestS) bestS = b; } }
          if (next.size === sums.size) break;
          sums = next;
          if (bestS === lim || sums.size > 4000) break;
        }
      });
      v = (sums.size > 4000 && bestS < lim) ? L : bestS / 1e4; // conjunto grande demais: sem poda
      if (memo.size > 200000) memo.clear();
      memo.set(key, v);
      return v;
    }
    let minH = Infinity;
    types.forEach(t => t.ors.forEach(o => { minH = Math.min(minH, o.h); }));

    function lowest() {
      let bi = 0;
      for (let i = 1; i < sky.length; i++) if (sky[i].y < sky[bi].y - E) bi = i;
      return bi;
    }
    function merge() {
      for (let i = sky.length - 2; i >= 0; i--) {
        if (Math.abs(sky[i].y - sky[i + 1].y) <= E) { sky[i].w += sky[i + 1].w; sky.splice(i + 1, 1); }
      }
    }

    // profundidade: cada passo põe uma peça ou eleva um trecho; o limite protege a pilha do navegador
    const maxDepth = Math.min(1500, 4 * problem.items.length + 200);
    let depth = 0, depthCut = false;
    const deadline = opts && opts.deadline;
    function dfs() {
      if (++nodes > maxNodes) return false;
      if (deadline && (nodes & 1023) === 0 && Date.now() > deadline) { nodes = maxNodes + 1; return false; }
      if (depth > maxDepth) { depthCut = true; return false; }
      depth++;
      const r = dfsIn();
      depth--;
      return r;
    }
    function dfsIn() {
      if (left === 0) return true;
      const i = lowest(), s = sky[i];
      if (s.y >= H - E) {
        // chapa cheia: abre a próxima, se ainda houver
        if (sheets.length >= target) return false;
        const saveSky = sky, saveCur = cur;
        cur = { placed: [] }; sheets.push(cur); sky = [{ x: 0, w: W, y: 0 }];
        if (dfs()) return true;
        sheets.pop(); sky = saveSky; cur = saveCur;
        return false;
      }
      // poda: largura do trecho que nenhuma combinação de peças cobre -> sobra mínima garantida
      {
        const ny0 = Math.min(i > 0 ? sky[i - 1].y : H, i < sky.length - 1 ? sky[i + 1].y : H);
        const unc = s.w - coverable(s.w);
        if (unc > E && unc * Math.min(minH, ny0 - s.y) > budget + E) return false;
      }
      // peças que cabem no trecho mais baixo, encostadas à esquerda
      const tried = new Set();
      // candidatos: primeiro os que fecham a largura do trecho (ou a altura até o vizinho), depois por área
      const cands = [];
      const nyN = Math.min(i > 0 ? sky[i - 1].y : H, i < sky.length - 1 ? sky[i + 1].y : H);
      for (let t = 0; t < types.length; t++) {
        if (!count[t]) continue;
        for (const o of types[t].ors) {
          if (o.w > s.w + E || s.y + o.h > H + E) continue;
          const fit = (Math.abs(o.w - s.w) <= E ? 2 : 0) + (Math.abs(s.y + o.h - nyN) <= E ? 1 : 0);
          cands.push({ t, o, fit });
        }
      }
      cands.sort((a, b) => b.fit - a.fit || a.t - b.t);
      for (const { t, o } of cands) {
        {
          const key = o.w.toFixed(4) + 'x' + o.h.toFixed(4);
          if (tried.has(key)) continue; // mesmo tamanho de outro tipo já tentado (ex.: a outra orientação)
          tried.add(key);
          const saveSky = sky.map(q => Object.assign({}, q));
          const rest = s.w - o.w;
          const seg = { x: s.x, w: o.w, y: s.y + o.h };
          sky.splice(i, 1, ...(rest > E ? [seg, { x: s.x + o.w, w: rest, y: s.y }] : [seg]));
          merge();
          count[t]--; left--;
          cur.placed.push({ type: t, r: o.r, x: s.x, y: s.y });
          if (dfs()) return true;
          cur.placed.pop();
          count[t]++; left++;
          sky = saveSky;
          if (nodes > maxNodes) return false;
        }
      }
      // ou: o trecho fica de sobra (sobe até o vizinho mais baixo, ou até o topo)
      const ny = Math.min(i > 0 ? sky[i - 1].y : H, i < sky.length - 1 ? sky[i + 1].y : H);
      const waste = s.w * (ny - s.y);
      if (waste > budget + E) return false;
      // se cabe alguma peça aqui, gastar a folga só vale se a peça não couber "inteira" depois; poda simples:
      // trecho mais largo que a menor peça e com altura livre também é candidato a sobra (necessário para
      // ótimos com folga), então a opção fica sempre disponível.
      const saveSky = sky.map(q => Object.assign({}, q));
      budget -= waste;
      sky[i].y = ny; // (não `s`: o horizonte foi restaurado por cópia depois das tentativas acima)
      merge();
      if (dfs()) return true;
      budget += waste;
      sky = saveSky;
      return false;
    }

    cur = { placed: [] }; sheets.push(cur); sky = [{ x: 0, w: W, y: 0 }];
    if (minSide() === Infinity) return null;
    if (!dfs()) {
      // sem estourar o limite de nós, de tempo ou de profundidade, a busca foi completa: é impossível em `target`
      packInto.lastProven = nodes <= maxNodes && !depthCut;
      return null;
    }
    packInto.lastProven = false;

    // tipos -> peças
    const next = types.map(() => 0);
    return {
      name: 'exata-' + target,
      sheets: sheets.filter(sh => sh.placed.length).map(sh => ({
        rects: sh.placed.map(p => {
          const t = types[p.type], it = t.items[next[p.type]++];
          const o = t.ors.find(q => q.r === p.r);
          return { item: it, x: p.x, y: p.y, w: o.w - gap, h: o.h - gap, rot: p.r };
        }),
      })),
      nodes,
    };
  }

  /*
   * Estratégia: tenta usar menos chapas que a melhor solução encontrada até aqui (state.best()),
   * descendo enquanto der, até o limite inferior por área.
   */
  function run(problem, opts, state) {
    const best = state && state.best && state.best();
    const A = problem.width * problem.height;
    const area = problem.items.reduce((s, it) => s + it.w * it.h, 0);
    const lb = Math.max(1, Math.ceil(area / A - 1e-9));
    let target = (best ? best.solution.sheets.length : problem.items.length) - 1;
    let found = null;
    while (target >= lb) {
      const sol = packInto(problem, target, opts);
      if (!sol) {
        // provado: não cabe em `target` chapas (a melhor conhecida é ótima em número de chapas)
        if (packInto.lastProven && state && state.notes) state.notes.minSheets = target + 1;
        break;
      }
      found = sol;
      target = sol.sheets.length - 1;
    }
    if (target < lb && state && state.notes) state.notes.minSheets = lb;
    return found;
  }

  const api = { packInto, run, typesOf };
  ns.exact = api;
  (root.__BoxPackMods = root.__BoxPackMods || []).push(boxpackModule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
