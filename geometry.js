/*
 * Geometria da caixa com encaixes de dentes (finger joints).
 * Sem dependências. Funciona no navegador (window.BoxGeom) e no Node (module.exports).
 *
 * Sistema de coordenadas: mm, Y para cima (igual ao DXF). O SVG é gerado com
 * uma transformação que inverte o eixo Y.
 *
 * Caixa (dimensões externas): X = comprimento (W), Y = largura (D), Z = altura (H).
 *   - Paredes frente/trás (Y=0 e Y=D): largura total W, "fêmeas" nas arestas verticais.
 *   - Paredes esquerda/direita (X=0 e X=W): largura D-2t, com dentes nas arestas verticais.
 *   - Fundo e tampa: placas W x D (ou menores, conforme o tipo de encaixe).
 */
(function (root) {
  'use strict';

  const EPS = 1e-7;

  // ---------- utilidades ----------

  // Número ímpar (>= 3) de divisões iguais de L, próximo de L / tooth.
  // Dentes ficam nas divisões ímpares (1, 3, ...); as duas pontas são trechos lisos
  // (cantos), o que mantém o padrão simétrico e evita geometria impossível nos cantos.
  function oddCount(L, tooth) {
    if (!(tooth > 0) || !(L > 0)) return 3;
    const raw = L / tooth;
    let lo = Math.floor(raw);
    if (lo % 2 === 0) lo -= 1;
    if (lo < 3) lo = 3;
    const hi = lo + 2;
    return Math.abs(raw - lo) <= Math.abs(hi - raw) ? lo : hi;
  }

  /*
   * Divisões de uma aresta de comprimento TOTAL L (da quina à quina, incluindo a espessura
   * das peças vizinhas) com dente de largura m.
   * n ímpar (>= 3): canto liso, (n-1)/2 dentes separados por intervalos, canto liso.
   * Dentes e intervalos do miolo medem exatamente m; os dois cantos absorvem a sobra:
   *   c = (L - (n-2) * m) / 2
   * n é o ímpar mais próximo de L/m, reduzido se o canto ficar menor que minCorner.
   * minCorner = zona da peça vizinha (t, ou t + recuo na tampa) + ponte de material (t).
   * Se nem com n = 3 couber, usa m = L/3 (adj = true).
   */
  function toothLayout(L, m, minCorner) {
    const minC = minCorner > 0 ? minCorner : 0;
    let n = oddCount(L, m);
    let c = (L - (n - 2) * m) / 2;
    while (c < minC && n > 3) { n -= 2; c = (L - (n - 2) * m) / 2; }
    if (c < minC || !(m > 0)) { return { n: 3, m: L / 3, c: L / 3, adj: true }; }
    return { n, m, c, adj: false };
  }

  function signedArea(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return a / 2;
  }

  function cleanPoly(pts) {
    const p = [];
    for (const q of pts) {
      const l = p[p.length - 1];
      if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > EPS) p.push(q);
    }
    if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < EPS) p.pop();
    let changed = true;
    while (changed && p.length > 3) {
      changed = false;
      for (let i = 0; i < p.length; i++) {
        const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) < 1e-9) { p.splice(i, 1); changed = true; break; }
      }
    }
    if (signedArea(p) < 0) p.reverse();
    return p;
  }

  // Offset de polígono anti-horário por d (positivo = para fora), cantos em mitra.
  function offsetPoly(poly, d) {
    if (!d) return poly.map(p => [p[0], p[1]]);
    const n = poly.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
      let e1x = b[0] - a[0], e1y = b[1] - a[1];
      let e2x = c[0] - b[0], e2y = c[1] - b[1];
      const l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y);
      e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
      const n1x = e1y, n1y = -e1x, n2x = e2y, n2y = -e2x;
      const den = 1 + n1x * n2x + n1y * n2y;
      if (den < 1e-6) { out.push([b[0] + d * n2x, b[1] + d * n2y]); continue; }
      out.push([b[0] + d * (n1x + n2x) / den, b[1] + d * (n1y + n2y) / den]);
    }
    return out;
  }

  // ---------- arestas com dentes ----------

  /*
   * edge: null (reta) ou { mode:'tab'|'slot', a, b, tooth, chamfer, fit }
   * a..b: intervalo (coordenada absoluta ao longo do eixo da aresta) onde há dentes.
   * Retorna pontos em ordem crescente do eixo, sem os cantos da base.
   * horizontal: o eixo é X e a base é y=base; senão o eixo é Y e a base é x=base.
   * ns: sinal da normal externa (+1 ou -1).
   * fit: diferença TOTAL de largura da junção (dente - rasgo), dividida meio a meio entre as duas peças:
   *   positivo (aperto) alarga o dente em fit/2 e estreita o rasgo em fit/2 (fit/4 por lado em cada um);
   *   negativo (folga) faz o contrário. As duas peças da junção devem receber o mesmo fit.
   */
  function edgePoints(edge, t, base, horizontal, ns) {
    const pts = [];
    if (!edge) return pts;
    const L = edge.b - edge.a;
    const fullA = edge.fullA != null ? edge.fullA : edge.a;
    const lay = toothLayout(edge.fullB != null ? edge.fullB - fullA : L, edge.tooth, edge.minC != null ? edge.minC : 2 * t);
    const n = lay.n, w = lay.m;
    const P = (axis, off) => (horizontal ? [axis, base + ns * off] : [base + ns * off, axis]);
    for (let i = 1; i < n - 1; i += 2) {
      const a = fullA + lay.c + (i - 1) * w, b = a + w;
      if (edge.mode === 'tab') {
        const d = edge.depth != null ? edge.depth : t; // profundidade (pode ser menor que t = recuo)
        // fit no dente: positivo alarga (aperto), negativo estreita (folga); metade do fit total, fit/4 por lado
        const g = (edge.fit || 0) / 4;
        const eg = Math.max(-(w / 2 - 0.05), Math.min(g, w / 2 - 0.05));
        const ta = a - eg, tb = b + eg;
        const c = Math.max(0, Math.min(edge.chamfer || 0, d, (tb - ta) / 2 - 0.01));
        pts.push(P(ta, 0), P(ta, d - c), P(ta + c, d), P(tb - c, d), P(tb, d - c), P(tb, 0));
      } else {
        // fit no rasgo: positivo estreita (aperto), negativo alarga (folga); metade do fit total, fit/4 por lado
        const fitQ = (edge.fit || 0) / 4;
        const e = fitQ >= 0 ? Math.min(fitQ, w / 2 - 0.05) : Math.max(fitQ, -(w / 2 - 0.05));
        // chanfro nos cantos do material na boca do rasgo (ponta do dente "fêmea")
        const d = edge.depth != null ? edge.depth : t;
        const c = Math.max(0, Math.min(edge.chamfer || 0, d, w / 2 - Math.abs(e) - 0.01));
        pts.push(P(a + e - c, 0), P(a + e, -c), P(a + e, -d), P(b - e, -d), P(b - e, -c), P(b - e + c, 0));
      }
    }
    return pts;
  }

  function buildOutline(rect, edges, t) {
    const { x0, y0, x1, y1 } = rect;
    const e = edges || {};
    const pts = [[x0, y0]];
    pts.push(...edgePoints(e.bottom, t, y0, true, -1));
    pts.push([x1, y0]);
    pts.push(...edgePoints(e.right, t, x1, false, +1));
    pts.push([x1, y1]);
    pts.push(...edgePoints(e.top, t, y1, true, +1).reverse());
    pts.push([x0, y1]);
    pts.push(...edgePoints(e.left, t, x0, false, -1).reverse());
    return cleanPoly(pts);
  }

  // ---------- furos oblongos ----------

  // Vértices de um oblongo (stadium): A,B,C,D + raio. Arcos B->C e D->A (anti-horários).
  function slotGeom(s) {
    const r = s.wid / 2, h = (s.len - s.wid) / 2;
    const th = (s.ang * Math.PI) / 180, c = Math.cos(th), si = Math.sin(th);
    const T = (x, y) => [s.cx + x * c - y * si, s.cy + x * si + y * c];
    return { A: T(-h, -r), B: T(h, -r), C: T(h, r), D: T(-h, r), r, h };
  }

  // ---------- avisos e erros ----------
  // Erro de configuração: `keys` lista os campos (data-k) que o causam, para a interface destacá-los.
  function fail(msg, keys) { const e = new Error(msg); e.keys = keys || []; return e; }

  // ---------- montagem das peças ----------

  // Estado da tampa a partir das opções (ou do antigo lidMode).
  function lidState(cfg) {
    if (cfg.lidEnabled === undefined) return cfg.lidMode;
    if (!cfg.lidEnabled) return 'none';
    const outer = cfg.lidPos !== 'inner';
    if (cfg.lidTeeth !== false) return outer ? 'wallTabs' : 'plateTabs';
    return outer ? 'overlay' : 'inset';
  }

  // Sentido do deslocamento horizontal (+ = direita), visto de fora, de pé diante do lado.
  const SIDE_SU = { front: 1, back: -1, left: -1, right: 1 };
  const SIDES = ['front', 'back', 'left', 'right'];
  const SIDE_NAME = { front: 'frente', back: 'trás', left: 'esquerdo', right: 'direito' };
  const FACE_NAME = { front: 'Frente', back: 'Trás', left: 'Esquerda', right: 'Direita', bottom: 'Fundo', lid: 'Tampa' };

  function build(cfgIn) {
    const cfg = cfgIn;
    const t = +cfg.t;
    const kerf = +cfg.kerf || 0;
    const fit = Math.max(0, +cfg.fit || 0);
    // ajuste da tampa: valor próprio (positivo = aperto, negativo = folga) da junção da tampa,
    // independente da interferência geral; com lidFitSame a tampa segue a interferência geral.
    const fitLid = cfg.lidFitSame ? fit : (+cfg.lidFit || 0);
    const comp = cfg.kerfComp ? kerf / 2 : 0;
    let W = +cfg.W, D = +cfg.D, H = +cfg.H;
    const lid = lidState(cfg);
    const bot = cfg.bottomMode === 'plateTabs' ? 'plateTabs' : 'wallTabs';
    // Recuo da tampa: desloca para dentro o retângulo-guia (fundo dos recessos / base dos dentes)
    // da tampa. guia = medida - 2*(t + recuo). Recuo 0 = antiga tampa lisa por dentro.
    // O tamanho da tampa (ponta dos dentes) não muda. Não pode ser negativo (erro abaixo).
    const cl = +cfg.lidClearance || 0;
    const lg = t + cl;
    const hasLid = lid !== 'none';
    if (cfg.dimMode === 'inner') { W += 2 * t; D += 2 * t; H += t + (hasLid ? t : 0); }
    if (!(t > 0)) throw fail('Espessura inválida.', ['t']);
    if (W < 4 * t || D < 4 * t || H < 4 * t) {
      throw fail('Dimensões muito pequenas para a espessura.', ['t'].concat(W < 4 * t ? ['W'] : [], D < 4 * t ? ['D'] : [], H < 4 * t ? ['H'] : []));
    }

    // largura alvo dos dentes por eixo (X = comprimento, Y = largura, Z = altura)
    const pick = (a, b) => (+a > 0 ? +a : +b);
    const tv = pick(cfg.toothVert, 20);
    const tbx = pick(cfg.toothBaseX, cfg.toothBase), tby = pick(cfg.toothBaseY, cfg.toothBase);
    const tlx = pick(cfg.toothLidX, cfg.toothLid), tly = pick(cfg.toothLidY, cfg.toothLid);
    // avisos: { level: 'info' | 'warn', text, keys: [campos], face?, hole? }
    //   info = o desenho foi adaptado automaticamente; warn = há um problema real no resultado.
    const warnings = [];
    const warn = (level, text, ref) => warnings.push(Object.assign({ level, text }, ref));
    const info = [];
    const zlo = bot === 'plateTabs' ? 0 : t;
    const zhi = (lid === 'wallTabs' || lid === 'overlay') ? H - t : H;
    if (hasLid && cl < 0) throw fail('Recuo da tampa não pode ser negativo.', ['lidClearance']);
    if (lid !== 'none' && lid !== 'overlay') {
      if (W - 2 * lg <= 0 || D - 2 * lg <= 0) throw fail('Recuo da tampa grande demais: o retângulo-guia da tampa não tem tamanho.', ['lidClearance', 'W', 'D', 't']);
    }
    if (zhi - zlo < 2 * t) throw fail('Altura insuficiente para os dentes verticais.', ['H', 't', 'bottomMode', 'lidPos']);

    const cMain = +cfg.chamfer || 0, cLid = +cfg.chamferLid || 0;

    // divisões (número ímpar, pontas lisas) e largura real, por eixo
    const minC = 2 * t;                       // canto mínimo geral: zona da peça vizinha + ponte
    const minCL = 2 * t + Math.max(cl, 0);    // arestas da tampa: o recuo aprofunda a zona
    const mkDiv = (L, tooth, mc, nome, keys) => {
      const d = toothLayout(L, tooth, mc);
      if (d.adj) warn('warn', `${nome}: dente de ${tooth} mm não cabe em ${L.toFixed(1)} mm com canto mínimo de ${mc.toFixed(1)} mm; usando ${d.m.toFixed(2)} mm.`, { keys });
      else if (d.n < oddCount(L, tooth)) warn('info', `${nome}: o canto mínimo de ${mc.toFixed(1)} mm reduziu as divisões de ${oddCount(L, tooth)} para ${d.n} (dente de ${tooth} mm em ${L.toFixed(1)} mm).`, { keys });
      return { n: d.n, L, w: d.m, c: d.c };
    };
    const divs = {
      vert: mkDiv(H, tv, minC, 'Arestas verticais', ['toothVert', 'H', 't']),
      baseX: mkDiv(W, tbx, minC, 'Fundo X', ['toothBaseX', 'W', 't']), baseY: mkDiv(D, tby, minC, 'Fundo Y', ['toothBaseY', 'D', 't']),
      lidX: null, lidY: null,
    };
    if (lid === 'wallTabs' || lid === 'plateTabs') { divs.lidX = mkDiv(W, tlx, minCL, 'Tampa X', ['toothLidX', 'W', 't', 'lidClearance']); divs.lidY = mkDiv(D, tly, minCL, 'Tampa Y', ['toothLidY', 'D', 't', 'lidClearance']); }
    const fmt = (nm, d) => `${nm}: ${d.n} divisões, ${(d.n - 1) / 2} dentes de ${d.w.toFixed(2)} mm, cantos de ${d.c.toFixed(2)} mm`;
    info.push(fmt('Arestas verticais (Z)', divs.vert));
    info.push(fmt('Fundo X', divs.baseX) + '; ' + fmt('Y', divs.baseY));
    if (divs.lidX) info.push(fmt('Tampa X', divs.lidX) + '; ' + fmt('Y', divs.lidY));
    // chanfro maior que o possível: o desenho usa o limite (profundidade do encaixe e metade do dente,
    // descontada a folga/aperto), o valor digitado não muda; aqui só avisamos.
    const chkChamfer = (nome, c, d, w, e, keys) => {
      const lim = Math.max(0, Math.min(d, w / 2 - Math.abs(e) - 0.01));
      if (c > lim + 1e-9) warn('info', `${nome}: chanfro de ${c} mm não cabe; desenhado com ${lim.toFixed(2)} mm (dente de ${w.toFixed(2)} mm, profundidade ${d.toFixed(2)} mm).`, { keys });
    };
    chkChamfer('Chanfro geral (arestas verticais)', cMain, t, divs.vert.w, fit / 4, ['chamfer', 'toothVert', 'fit']);
    chkChamfer('Chanfro geral (fundo X)', cMain, t, divs.baseX.w, fit / 4, ['chamfer', 'toothBaseX', 'fit']);
    chkChamfer('Chanfro geral (fundo Y)', cMain, t, divs.baseY.w, fit / 4, ['chamfer', 'toothBaseY', 'fit']);
    if (divs.lidX) {
      chkChamfer('Chanfro da tampa X', cLid, Math.min(t, lg), divs.lidX.w, fitLid / 4, ['chamferLid', 'toothLidX', 'lidFit']);
      chkChamfer('Chanfro da tampa Y', cLid, Math.min(t, lg), divs.lidY.w, fitLid / 4, ['chamferLid', 'toothLidY', 'lidFit']);
    }
    // aresta horizontal de uma parede (junção com fundo ou tampa)
    const wallEdge = (state, len, tooth, chamfer, mc, fitHere) => {
      const full = { fullA: 0, fullB: len, minC: mc };
      if (state === 'wallTabs') return Object.assign({ mode: 'tab', a: t, b: len - t, tooth, chamfer, fit: fitHere }, full);
      if (state === 'plateTabs') return Object.assign({ mode: 'slot', a: t, b: len - t, tooth, chamfer, fit: fitHere }, full);
      return null;
    };
    const plate = (state, tx, ty, chamfer, clearance, mc, fitHere) => {
      const g = t + clearance; // guia
      if (state === 'wallTabs') {
        const s = (a, b, tooth) => ({ mode: 'slot', a, b, tooth, chamfer, fit: fitHere, depth: g, fullA: 0, fullB: b + t, minC: mc });
        return { rect: { x0: 0, y0: 0, x1: W, y1: D }, edges: { bottom: s(t, W - t, tx), top: s(t, W - t, tx), left: s(t, D - t, ty), right: s(t, D - t, ty) } };
      }
      if (state === 'plateTabs') {
        const s = (a, b, tooth) => ({ mode: 'tab', a, b, tooth, chamfer, fit: fitHere, depth: g, fullA: 0, fullB: b + t, minC: mc });
        return { rect: { x0: g, y0: g, x1: W - g, y1: D - g }, edges: { bottom: s(t, W - t, tx), top: s(t, W - t, tx), left: s(t, D - t, ty), right: s(t, D - t, ty) } };
      }
      if (state === 'inset') {
        return { rect: { x0: g, y0: g, x1: W - g, y1: D - g }, edges: {} };
      }
      return { rect: { x0: 0, y0: 0, x1: W, y1: D }, edges: {} };
    };

    const specs = [];
    const yWall = (name) => ({
      name, w: W, h: H,
      rect: { x0: 0, y0: zlo, x1: W, y1: zhi },
      edges: {
        bottom: wallEdge(bot, W, tbx, cMain, minC, fit),
        top: hasLid ? wallEdge(lid, W, tlx, cLid, minCL, fitLid) : null,
        left: { mode: 'slot', a: zlo, b: zhi, tooth: tv, chamfer: cMain, fit, fullA: 0, fullB: H, minC },
        right: { mode: 'slot', a: zlo, b: zhi, tooth: tv, chamfer: cMain, fit, fullA: 0, fullB: H, minC },
      },
    });
    const xWall = (name) => ({
      name, w: D, h: H,
      rect: { x0: t, y0: zlo, x1: D - t, y1: zhi },
      edges: {
        bottom: wallEdge(bot, D, tby, cMain, minC, fit),
        top: hasLid ? wallEdge(lid, D, tly, cLid, minCL, fitLid) : null,
        left: { mode: 'tab', a: zlo, b: zhi, tooth: tv, chamfer: cMain, fit, fullA: 0, fullB: H, minC },
        right: { mode: 'tab', a: zlo, b: zhi, tooth: tv, chamfer: cMain, fit, fullA: 0, fullB: H, minC },
      },
    });
    specs.push(yWall('front'), yWall('back'), xWall('left'), xWall('right'));
    const pb = plate(bot, tbx, tby, cMain, 0, minC, fit);
    specs.push({ name: 'bottom', w: W, h: D, rect: pb.rect, edges: pb.edges });
    if (hasLid) {
      const pl = plate(lid, tlx, tly, cLid, cl, minCL, fitLid);
      specs.push({ name: 'lid', w: W, h: D, rect: pl.rect, edges: pl.edges });
    }

    let lidInfo = '';
    const guide = `${(W - 2 * lg).toFixed(2)} × ${(D - 2 * lg).toFixed(2)} mm`;
    if (lid === 'inset') {
      lidInfo = `Tampa por dentro, lisa: tamanho real ${guide} (recuo ${cl} mm por lado).`;
    } else if (lid === 'plateTabs') {
      lidInfo = `Tampa por dentro, com dentes: ${W} × ${D} mm na ponta dos dentes; retângulo-guia (base dos dentes) ${guide}.`;
    } else if (lid === 'wallTabs') {
      lidInfo = `Tampa por fora, com dentes: ${W} × ${D} mm; retângulo-guia (fundo dos rasgos) ${guide}.`;
    }

    // sugestão de ajuste por furo ('face:índice' -> { length, width, y }): reduz comprimento e largura na
    // mesma proporção, mantendo o centro, até o furo caber na área útil (fora da faixa de encaixe).
    const holeFixes = {};
    const panels = specs.map(sp => {
      const nominal = buildOutline(sp.rect, sp.edges, t);
      const poly = offsetPoly(nominal, comp);
      const holes = [];
      const isWall = SIDES.indexOf(sp.name) >= 0;
      // Paredes: um conjunto de furos. Tampa/fundo: um conjunto por lado.
      const entries = isWall ? [{ key: sp.name, side: sp.name }] : SIDES.map(sd => ({ key: sp.name + '_' + sd, side: sd }));
      for (const en of entries) {
        const face = cfg.faces && cfg.faces[en.key];
        if (!face || !face.enabled) continue;
        const su = SIDE_SU[en.side];
        const tag = isWall ? FACE_NAME[sp.name] : `${FACE_NAME[sp.name]}, lado ${SIDE_NAME[en.side]}`;
        // faixa de encaixe junto à borda da peça (a referência dos furos é a borda da caixa).
        // Na tampa (exceto lisa por fora), a faixa é espessura + recuo.
        const zone = (sp.name === 'lid' && lid !== 'overlay') ? lg : t;
        let hi = -1;
        for (const h of face.holes || []) {
          hi++;
          const wid = +h.width || 0;
          const len = Math.max(+h.length || 0, wid);
          if (!(wid > 0)) continue;
          const x = +h.x || 0, y = +h.y || 0;
          const xs = (h.mirror === 'x' && Math.abs(x) > 1e-6) ? [x, -x] : [x];
          let fixK = 1, fixable = true;
          for (const xx of xs) {
            // x: deslocamento horizontal a partir do centro do lado; y: distância da borda do lado
            // até a borda mais próxima do furo (furo sempre paralelo ao lado).
            let cx, cy, ang = 0;
            if (isWall) { cx = sp.w / 2 + su * xx; cy = sp.h - y - wid / 2; }
            else if (en.side === 'front') { cx = sp.w / 2 + su * xx; cy = y + wid / 2; }
            else if (en.side === 'back') { cx = sp.w / 2 + su * xx; cy = sp.h - y - wid / 2; }
            else if (en.side === 'left') { cx = y + wid / 2; cy = sp.h / 2 + su * xx; ang = 90; }
            else { cx = sp.w - y - wid / 2; cy = sp.h / 2 + su * xx; ang = 90; }
            const th = (ang * Math.PI) / 180;
            const hx = ((len - wid) / 2) * Math.abs(Math.cos(th)) + wid / 2;
            const hy = ((len - wid) / 2) * Math.abs(Math.sin(th)) + wid / 2;
            const pos = `horizontal ${xx.toFixed(0)}, vertical ${y.toFixed(0)}`;
            if (cx - hx < -EPS || cx + hx > sp.w + EPS || cy - hy < -EPS || cy + hy > sp.h + EPS) {
              warn('warn', `${tag}: furo (${pos}) é maior que a peça ou sai dela; o desenho não foi corrigido.`, { face: en.key, hole: hi });
            } else if (cx - hx < zone - EPS || cx + hx > sp.w - zone + EPS || cy - hy < zone - EPS || cy + hy > sp.h - zone + EPS) {
              warn('warn', `${tag}: furo (${pos}) invade a faixa de encaixe (${zone} mm da borda).`, { face: en.key, hole: hi });
            }
            // escala que faz caber na área útil com o mesmo centro (só possível se o centro estiver nela)
            const ax = Math.min(cx - zone, sp.w - zone - cx), ay = Math.min(cy - zone, sp.h - zone - cy);
            if (ax <= 0 || ay <= 0) fixable = false;
            else fixK = Math.min(fixK, ax / hx, ay / hy);
            const L2 = Math.max(len - (cfg.kerfComp ? kerf : 0), 0.1);
            const W2 = Math.max(wid - (cfg.kerfComp ? kerf : 0), 0.1);
            holes.push({ cx, cy, len: L2, wid: Math.min(W2, L2), ang });
          }
          if (!fixable || fixK < 1 - 1e-9) {
            const fkey = en.key + ':' + hi;
            if (!fixable) holeFixes[fkey] = null; // o centro está na faixa de encaixe ou fora: só movendo o furo
            else {
              const fl = v => Math.floor(v * 10 + 1e-6) / 10; // arredonda para baixo, 0,1 mm
              const w2 = Math.max(0.1, fl(wid * fixK)), l2 = Math.max(w2, fl(len * fixK));
              // y é medido até a borda do furo: com o centro fixo, cresce metade do que a largura encolheu
              holeFixes[fkey] = { length: l2, width: w2, y: Math.round((y + (wid - w2) / 2) * 1000) / 1000 };
            }
          }
        }
      }
      return { name: sp.name, label: FACE_NAME[sp.name], w: sp.w, h: sp.h, nominal, poly, holes };
    });

    return { panels, warnings, info, lidInfo, divs, holeFixes, dims: { W, D, H, t } };
  }

  // ---------- layout na chapa ----------

  function bbox(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x0, y0, x1, y1 };
  }

  /*
   * Organização das peças em chapas (retângulos envolventes, com rotação de 90° quando o veio permite).
   * Chapa a chapa: procura o arranjo das peças que sobraram (MaxRects) e fica com o melhor; o que não
   * coube segue para a próxima chapa. "Melhor", nesta ordem:
   *   1. maior área de peças na chapa (menos chapas no total);
   *   2. maior retângulo livre que sobra (sobra contínua, aproveitável);
   *   3. arranjo mais compacto (menor retângulo que envolve as peças).
   * Até 6 peças testa todas as ordens e rotações; acima disso usa ordens heurísticas e uma busca local
   * com sorteio de semente fixa (o mesmo projeto gera sempre o mesmo plano).
   */

  // rots[k]: 0 = como está, 1 = gira 90°, 2 = livre (escolhe a orientação que encaixa melhor)
  function packOne(pieces, order, rots, aw, ah, gap, dedupe) {
    let free = [{ x: 0, y: 0, w: aw, h: ah }];
    const placed = [];
    // menor medida entre as peças: quando nenhum espaço livre comporta, a chapa está cheia
    let minSide = Infinity;
    for (const i of order) minSide = Math.min(minSide, pieces[i].w + gap, pieces[i].h + gap);
    let failed = dedupe ? new Set() : null; // tamanhos que já não couberam no estado atual (peças repetidas)
    for (let k = 0; k < order.length; k++) {
      const pc = pieces[order[k]];
      const rs = rots[k];
      const key = failed && pc.w + 'x' + pc.h + 'r' + rs;
      if (failed && failed.has(key)) continue;
      let best = null, bs = Infinity, brot = 0;
      for (const r of (rs === 2 ? [0, 1] : [rs])) {
        const w = (r ? pc.h : pc.w) + gap, h = (r ? pc.w : pc.h) + gap;
        for (const f of free) {
          if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
            const sc = Math.min(f.w - w, f.h - h);
            if (sc < bs) { bs = sc; best = f; brot = r; }
          }
        }
      }
      if (!best) { if (failed) failed.add(key); continue; } // esta peça não coube; tenta as seguintes
      const w = (brot ? pc.h : pc.w) + gap, h = (brot ? pc.w : pc.h) + gap;
      const u = { x: best.x, y: best.y, w, h };
      placed.push({ pc, x: u.x, y: u.y, rot: brot, w, h });
      if (failed) failed = new Set();
      const nf = [];
      for (const f of free) {
        if (u.x >= f.x + f.w || u.x + u.w <= f.x || u.y >= f.y + f.h || u.y + u.h <= f.y) { nf.push(f); continue; }
        if (u.x > f.x) nf.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
        if (u.x + u.w < f.x + f.w) nf.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
        if (u.y > f.y) nf.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
        if (u.y + u.h < f.y + f.h) nf.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
      }
      free = nf.filter((r, i) => !nf.some((q, j) => j !== i && r.x >= q.x && r.y >= q.y &&
        r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h && (j < i || !(r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h))));
      if (!free.some(f => Math.max(f.w, f.h) >= minSide - 1e-9 && Math.min(f.w, f.h) >= minSide - 1e-9)) break;
    }
    return { placed, free };
  }

  // nota de um arranjo, comparada em ordem (ver comentário acima); números inteiros para empatar de verdade
  // tie = 'free': desempata pela maior sobra contínua; 'compact': pelo arranjo mais compacto
  function sheetScore(r, gap, tie) {
    let area = 0, mx = 0, my = 0, big = 0;
    for (const q of r.placed) { area += (q.w - gap) * (q.h - gap); mx = Math.max(mx, q.x + q.w); my = Math.max(my, q.y + q.h); }
    for (const f of r.free) big = Math.max(big, f.w * f.h);
    const a = Math.round(area), b = Math.round(big), c = -Math.round(mx * my);
    return tie === 'free' ? [a, b, c] : [a, c, b];
  }
  function better(a, b) {
    if (!b) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }

  function permutations(a) {
    if (a.length <= 1) return [a];
    const out = [];
    a.forEach((x, i) => permutations(a.filter((_, j) => j !== i)).forEach(p => out.push([x, ...p])));
    return out;
  }

  // gerador pseudoaleatório com semente (resultados reproduzíveis)
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // fixedRot[i]: -1 = livre (0° ou 90°), 0 = não gira, 1 = gira 90° (por causa do veio)
  function bestSheet(pieces, aw, ah, gap, fixedRot, tie) {
    const n = pieces.length;
    let best = null, bestS = null;
    const tryIt = (order, rots) => {
      const r = packOne(pieces, order, rots, aw, ah, gap, n > 6);
      if (!r.placed.length) return null;
      const s = sheetScore(r, gap, tie);
      if (better(s, bestS)) { bestS = s; best = r.placed; }
      return s;
    };
    if (n <= 6) {
      for (const order of permutations([...Array(n).keys()])) {
        const base = order.map(i => (fixedRot[i] === 1 ? 1 : 0));
        const freePos = [];
        order.forEach((i, k) => { if (fixedRot[i] === -1) freePos.push(k); });
        for (let sub = 0; sub < (1 << freePos.length); sub++) {
          const rots = base.slice();
          freePos.forEach((k, j) => { if ((sub >> j) & 1) rots[k] = 1; });
          tryIt(order, rots);
        }
      }
      return best || [];
    }
    // muitas peças: ordens heurísticas, com rotação livre escolhida peça a peça
    const rotOf = i => (fixedRot[i] === -1 ? 2 : fixedRot[i]);
    const idx = [...Array(n).keys()];
    const simple = tie === 'simple';
    const keys = simple ? [p => p.w * p.h] : [
      p => p.w * p.h, p => Math.max(p.w, p.h), p => p.w, p => p.h, p => p.w + p.h, p => Math.min(p.w, p.h),
    ];
    let cur = null, curS = null;
    for (const kf of keys) {
      const order = idx.slice().sort((i, j) => kf(pieces[j]) - kf(pieces[i]) || i - j);
      const s = tryIt(order, order.map(rotOf));
      if (s && better(s, curS)) { cur = order; curS = s; }
      // também testa todas as rotações das primeiras peças livres (as demais escolhem sozinhas)
      const freePos = [];
      const maxBits = n > 60 ? 4 : 8; // com muitas peças, menos combinações (o tempo cresce com n)
      order.forEach((i, k) => { if (fixedRot[i] === -1 && freePos.length < maxBits) freePos.push(k); });
      for (let sub = 0; sub < (1 << freePos.length); sub++) {
        const rots = order.map(rotOf);
        freePos.forEach((k, j) => { rots[k] = (sub >> j) & 1; });
        tryIt(order, rots);
      }
    }
    // busca local: troca duas peças de lugar na ordem e fica com o resultado se não piorar
    const iters = simple || n > 200 ? 0 : Math.min(1500, Math.floor(30000 / n));
    const rand = rng(n * 7919 + Math.round(aw) * 31 + Math.round(ah));
    for (let it = 0; cur && it < iters; it++) {
      const o = cur.slice();
      const a = Math.floor(rand() * n), b = Math.floor(rand() * n);
      if (a === b) continue;
      [o[a], o[b]] = [o[b], o[a]];
      const s = tryIt(o, o.map(rotOf));
      if (s && !better(curS, s)) { cur = o; curS = s; }
    }
    return best || [];
  }

  const rot90 = p => [-p[1], p[0]];

  // ---------- várias chapas ao mesmo tempo ----------
  // Encaixe de uma peça no melhor espaço livre de uma chapa (menor sobra no lado mais curto).
  function fitIn(free, pc, rs, gap) {
    let best = null, bs = Infinity;
    for (const r of (rs === 2 ? [0, 1] : [rs])) {
      const w = (r ? pc.h : pc.w) + gap, h = (r ? pc.w : pc.h) + gap;
      for (const f of free) {
        if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
          const sc = Math.min(f.w - w, f.h - h);
          if (sc < bs) { bs = sc; best = { x: f.x, y: f.y, w, h, rot: r }; }
        }
      }
    }
    return best;
  }
  function splitFree(free, u) {
    const nf = [];
    for (const f of free) {
      if (u.x >= f.x + f.w || u.x + u.w <= f.x || u.y >= f.y + f.h || u.y + u.h <= f.y) { nf.push(f); continue; }
      if (u.x > f.x) nf.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (u.x + u.w < f.x + f.w) nf.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
      if (u.y > f.y) nf.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (u.y + u.h < f.y + f.h) nf.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
    }
    return nf.filter((r, i) => !nf.some((q, j) => j !== i && r.x >= q.x && r.y >= q.y &&
      r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h && (j < i || !(r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h))));
  }
  // Coloca as peças na ordem dada, cada uma na primeira chapa onde couber (abre outra se preciso).
  // Diferente do método chapa a chapa, uma chapa não "gasta" as peças pequenas que as outras precisam.
  function packMulti(pieces, order, rots, aw, ah, gap) {
    const bins = [];
    for (let k = 0; k < order.length; k++) {
      const pc = pieces[order[k]];
      let done = false;
      for (const bin of bins) {
        const u = fitIn(bin.free, pc, rots[k], gap);
        if (u) { bin.placed.push(Object.assign({ pc }, u)); bin.free = splitFree(bin.free, u); bin.area += pc.w * pc.h; done = true; break; }
      }
      if (done) continue;
      const bin = { free: [{ x: 0, y: 0, w: aw, h: ah }], placed: [], area: 0 };
      const u = fitIn(bin.free, pc, rots[k], gap);
      if (!u) return null; // não deveria acontecer: peças maiores que a chapa são tiradas antes
      bin.placed.push(Object.assign({ pc }, u)); bin.free = splitFree(bin.free, u); bin.area += pc.w * pc.h;
      bins.push(bin);
    }
    return bins;
  }
  // menos chapas; empate: a última chapa mais vazia (as outras mais cheias)
  const multiScore = bins => [-bins.length, -Math.round(bins[bins.length - 1].area)];

  /*
   * Plano de corte, em etapas, para a interface poder mostrar o andamento.
   * cfg.qty: número de caixas (peças repetidas no mesmo plano).
   * Cada etapa devolve { pieces: total, placed: andamento, pass, passes }; o final é o plano.
   *
   * Dois métodos, e fica o de menos chapas:
   *   - chapa a chapa (variantes free, compact, simple): cada chapa recebe o melhor arranjo das peças
   *     que sobraram; bom para a sobra de cada chapa, mas pode gastar cedo as peças pequenas;
   *   - várias chapas ao mesmo tempo (multi): ordens de peças testadas como um todo; depois cada chapa
   *     é rearranjada pelo critério de sobra contínua, se as mesmas peças couberem.
   * Empate no número de chapas: vale o primeiro da lista (chapa a chapa, sobra contínua).
   */
  function* layoutSteps(res, cfg) {
    const ctx = planContext(res, cfg);
    const plans = [];
    const variants = ['free', 'compact', 'simple', 'multi'];
    // com até 6 peças a busca chapa a chapa já é completa
    if (ctx.pieces.length <= 6) variants.splice(2, 2);
    for (let v = 0; v < variants.length; v++) {
      const it = variants[v] === 'multi' ? multiSteps(ctx) : planSteps(ctx, variants[v]);
      let r = it.next();
      while (!r.done) { yield Object.assign({}, r.value, { pass: v + 1, passes: variants.length }); r = it.next(); }
      plans.push(r.value);
    }
    let best = plans[0];
    for (const p of plans) if (p.sheets.length < best.sheets.length) best = p;
    return best;
  }

  // dados comuns aos métodos: peças (com as cópias), chapa, veio, montagem dos itens finais
  function planContext(res, cfg) {
    const SW = Math.max(50, +cfg.sheetW || 1000), SH = Math.max(50, +cfg.sheetH || 800);
    const gap = Math.max(0, +cfg.gap || 0), margin = Math.max(0, +cfg.margin || 0);
    const grain = cfg.grain === 'h' || cfg.grain === 'v' ? cfg.grain : 'none';
    const qty = Math.min(999, Math.max(1, Math.round(+cfg.qty || 1)));
    const aw = SW - 2 * margin + gap, ah = SH - 2 * margin + gap;
    // veio: o eixo de veio da peça (u = x local, v = y local) deve ficar paralelo ao veio da chapa
    const pg = cfg.pieceGrain || {};
    const grainOf = p => (pg[p.name] === 'u' || pg[p.name] === 'v' ? pg[p.name] : 'none');
    const pieces = [];
    for (let c = 1; c <= qty; c++) {
      for (const p of res.panels) {
        const b = bbox(p.poly);
        const g = grainOf(p);
        let fixed = -1;
        if (grain !== 'none' && g !== 'none') fixed = grain === 'h' ? (g === 'u' ? 0 : 1) : (g === 'u' ? 1 : 0);
        pieces.push({ p, box: qty > 1 ? c : 0, w: b.x1 - b.x0, h: b.y1 - b.y0, g, fixed });
      }
    }
    // peça que não cabe numa chapa vazia (em nenhuma orientação permitida)
    const fitsEmpty = pc => !!fitIn([{ x: 0, y: 0, w: aw, h: ah }], pc, pc.fixed === -1 ? 2 : pc.fixed, gap);
    const mkItem = (pc, rot, ox, oy) => {
      let poly = pc.p.poly.map(q => [q[0], q[1]]);
      let holes = pc.p.holes.map(h => Object.assign({}, h));
      if (rot) {
        poly = poly.map(rot90);
        holes = holes.map(h => { const c = rot90([h.cx, h.cy]); return Object.assign(h, { cx: c[0], cy: c[1], ang: h.ang + 90 }); });
      }
      const b = bbox(poly);
      const dx = ox - b.x0, dy = oy - b.y0;
      return {
        name: pc.p.name + (pc.box ? '_' + pc.box : ''), label: pc.p.label + (pc.box ? ' ' + pc.box : ''), box: pc.box,
        rotated: !!rot, grained: grain !== 'none' && pc.g !== 'none',
        poly: poly.map(q => [q[0] + dx, q[1] + dy]),
        holes: holes.map(h => Object.assign(h, { cx: h.cx + dx, cy: h.cy + dy })),
        cx: ox + (b.x1 - b.x0) / 2, cy: oy + (b.y1 - b.y0) / 2, w: pc.p.w, h: pc.p.h,
      };
    };
    // chapa ampliada para uma peça maior que a chapa, com aviso (um por tipo de peça)
    const oversize = (pc, warnings) => {
      if (!warnings.some(w => w.piece === pc.p.name)) {
        warnings.push({ level: 'warn', piece: pc.p.name, text: `${pc.p.label} (${pc.w.toFixed(0)} × ${pc.h.toFixed(0)} mm) não cabe na chapa de ${SW} × ${SH} mm (com margem de ${margin} mm).`, keys: ['sheetW', 'sheetH', 'margin'] });
      }
      return { items: [mkItem(pc, pc.fixed === 1 ? 1 : 0, margin, margin)], width: Math.max(SW, pc.w + 2 * margin), height: Math.max(SH, pc.h + 2 * margin), oversize: true, grain };
    };
    const sheetOf = placed => ({ items: placed.map(q => mkItem(q.pc, q.rot, margin + q.x, margin + q.y)), width: SW, height: SH, grain });
    const finish = (sheets, warnings) => {
      sheets.forEach(sh => {
        const area = sh.items.reduce((a, it) => { const b = bbox(it.poly); return a + (b.x1 - b.x0) * (b.y1 - b.y0); }, 0);
        sh.usage = area / (sh.width * sh.height);
      });
      return { sheets, warnings, qty };
    };
    return { SW, SH, gap, margin, grain, qty, aw, ah, pieces, fitsEmpty, oversize, sheetOf, finish };
  }

  // método chapa a chapa
  function* planSteps(ctx, tie) {
    const { aw, ah, gap } = ctx;
    const warnings = [];
    let remaining = ctx.pieces.slice();
    const total = remaining.length;
    const sheets = [];
    while (remaining.length) {
      const placed = bestSheet(remaining, aw, ah, gap, remaining.map(pc => pc.fixed), tie);
      if (!placed.length) {
        // nenhuma peça restante cabe: a primeira vai sozinha, em uma chapa ampliada, com aviso
        sheets.push(ctx.oversize(remaining.shift(), warnings));
      } else {
        sheets.push(ctx.sheetOf(placed));
        const used = new Set(placed.map(q => q.pc));
        remaining = remaining.filter(pc => !used.has(pc));
      }
      if (remaining.length) yield { pieces: total, placed: total - remaining.length };
    }
    return ctx.finish(sheets, warnings);
  }

  // método várias chapas ao mesmo tempo
  function* multiSteps(ctx) {
    const { aw, ah, gap } = ctx;
    const warnings = [];
    const sheets = [];
    const pieces = [];
    for (const pc of ctx.pieces) { if (ctx.fitsEmpty(pc)) pieces.push(pc); else sheets.push(ctx.oversize(pc, warnings)); }
    const n = pieces.length;
    if (!n) return ctx.finish(sheets, warnings);
    const rotOf = i => (pieces[i].fixed === -1 ? 2 : pieces[i].fixed);
    const idx = [...Array(n).keys()];
    const keys = [p => p.w * p.h, p => p.w, p => p.h, p => Math.max(p.w, p.h), p => p.w + p.h];
    let best = null, bestS = null, cur = null, curS = null;
    const tryIt = order => {
      const bins = packMulti(pieces, order, order.map(rotOf), aw, ah, gap);
      if (!bins) return null;
      const s = multiScore(bins);
      if (better(s, bestS)) { best = bins; bestS = s; }
      return s;
    };
    for (const kf of keys) {
      const order = idx.slice().sort((i, j) => kf(pieces[j]) - kf(pieces[i]) || i - j);
      const s = tryIt(order);
      if (s && better(s, curS)) { cur = order; curS = s; }
    }
    // busca local na ordem: troca duas peças; aceita se não piorar (anda por planos equivalentes)
    const iters = n > 300 ? 0 : Math.min(4000, Math.floor(120000 / n));
    const rand = rng(n * 104729 + Math.round(aw) * 17 + Math.round(ah));
    for (let it = 0; cur && it < iters; it++) {
      const o = cur.slice();
      const a = Math.floor(rand() * n), b = Math.floor(rand() * n);
      if (a === b) continue;
      [o[a], o[b]] = [o[b], o[a]];
      const s = tryIt(o);
      if (s && !better(curS, s)) { cur = o; curS = s; }
      if (it % 200 === 199) yield { pieces: n, placed: Math.round((n * (it + 1)) / iters) };
    }
    // cada chapa: rearranja as mesmas peças pelo critério de sobra contínua (se todas couberem)
    for (const bin of best) {
      const ps = bin.placed.map(q => q.pc);
      let placed = bin.placed;
      if (ps.length <= 12) {
        const alt = bestSheet(ps, aw, ah, gap, ps.map(pc => pc.fixed), 'free');
        if (alt.length === ps.length) placed = alt;
      }
      sheets.push(ctx.sheetOf(placed));
    }
    return ctx.finish(sheets, warnings);
  }

  // Plano de corte completo, de uma vez (sem etapas). Os avisos do plano vão para res.warnings.
  function layout(res, cfg) {
    const it = layoutSteps(res, cfg);
    let r = it.next();
    while (!r.done) r = it.next();
    if (res.warnings) res.warnings.push(...r.value.warnings);
    return r.value;
  }

  // Junta as chapas em um desenho só, empilhadas na vertical (chapa 1 em cima), cada uma com seu
  // retângulo de contorno (apenas de referência, não é linha de corte).
  function combineSheets(sheets, spacing) {
    const sp = spacing != null ? spacing : 50;
    const width = Math.max(...sheets.map(sh => sh.width));
    const height = sheets.reduce((a, sh) => a + sh.height, 0) + sp * Math.max(sheets.length - 1, 0);
    const items = [], frames = [];
    let cum = 0;
    sheets.forEach((sh, si) => {
      const y0 = height - cum - sh.height;
      frames.push({ x: 0, y: y0, w: sh.width, h: sh.height, id: `chapa${si + 1}` });
      for (const it of sh.items) {
        items.push(Object.assign({}, it, {
          poly: it.poly.map(q => [q[0], q[1] + y0]),
          holes: it.holes.map(h => Object.assign({}, h, { cy: h.cy + y0 })),
          cy: it.cy + y0,
        }));
      }
      cum += sh.height + sp;
    });
    return { items, frames, width, height, grain: null };
  }

  // ---------- exportação ----------

  const f = v => String(Math.round(v * 10000) / 10000);

  function polyPath(poly) {
    return 'M' + poly.map(p => f(p[0]) + ' ' + f(p[1])).join(' L') + ' Z';
  }
  function holePath(h) {
    if (h.len - h.wid < 0.01) {
      const r = h.wid / 2;
      return `M${f(h.cx - r)} ${f(h.cy)} A${f(r)} ${f(r)} 0 1 1 ${f(h.cx + r)} ${f(h.cy)} A${f(r)} ${f(r)} 0 1 1 ${f(h.cx - r)} ${f(h.cy)} Z`;
    }
    const g = slotGeom(h), r = f(g.r);
    return `M${f(g.A[0])} ${f(g.A[1])} L${f(g.B[0])} ${f(g.B[1])} A${r} ${r} 0 0 1 ${f(g.C[0])} ${f(g.C[1])} ` +
      `L${f(g.D[0])} ${f(g.D[1])} A${r} ${r} 0 0 1 ${f(g.A[0])} ${f(g.A[1])} Z`;
  }

  let svgSeq = 0; // ids únicos de clipPath entre os SVGs do preview

  // opts.preview: com preenchimento e rótulos, largura 100%.
  function toSVG(lay, opts) {
    const o = opts || {};
    const W = f(lay.width), H = f(lay.height);
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n';
    s += `<svg xmlns="http://www.w3.org/2000/svg" ${o.preview ? 'width="100%"' : `width="${W}mm" height="${H}mm"`} viewBox="0 0 ${W} ${H}">\n`;
    if (o.preview) {
      s += `<rect x="0.5" y="0.5" width="${f(lay.width - 1)}" height="${f(lay.height - 1)}" fill="#fff" stroke="#9aa6b8" stroke-width="1" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>\n`;
      s += `<g transform="matrix(1 0 0 -1 0 ${H})" fill="#f1e2c4" fill-rule="evenodd" stroke="#c00" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-linejoin="round">\n`;
      const seq = ++svgSeq;
      lay.items.forEach((it, idx) => {
        const d = [polyPath(it.poly)].concat(it.holes.map(holePath)).join(' ');
        s += `<path d="${d}" vector-effect="non-scaling-stroke"/>\n`;
        if (it.grained && (lay.grain === 'h' || lay.grain === 'v')) {
          // riscos do veio, paralelos ao veio da chapa, recortados pelo contorno e pelos furos
          const bb = bbox(it.poly), id = `gr${seq}_${idx}`, step = 8;
          let lines = '';
          if (lay.grain === 'h') for (let y = Math.ceil(bb.y0 / step) * step; y < bb.y1; y += step) lines += `M${f(bb.x0)} ${f(y)}H${f(bb.x1)}`;
          else for (let x = Math.ceil(bb.x0 / step) * step; x < bb.x1; x += step) lines += `M${f(x)} ${f(bb.y0)}V${f(bb.y1)}`;
          s += `<clipPath id="${id}"><path d="${d}" clip-rule="evenodd"/></clipPath>`;
          s += `<path d="${lines}" clip-path="url(#${id})" fill="none" stroke="#8a6a3a" stroke-opacity=".35" stroke-width="0.8" vector-effect="non-scaling-stroke"/>\n`;
        }
      });
      s += '</g>\n';
      const fs = Math.max(6, Math.min(lay.width, lay.height) / 40);
      for (const it of lay.items) {
        s += `<text x="${f(it.cx)}" y="${f(lay.height - it.cy)}" font-family="sans-serif" font-size="${f(fs)}" text-anchor="middle" fill="#555">${it.label}</text>\n`;
        s += `<text x="${f(it.cx)}" y="${f(lay.height - it.cy + fs * 1.2)}" font-family="sans-serif" font-size="${f(fs * 0.75)}" text-anchor="middle" fill="#888">${f(it.w)} × ${f(it.h)}</text>\n`;
      }
    } else {
      // preenchimento claro só para facilitar a visualização (não é parte do corte)
      s += `<g transform="matrix(1 0 0 -1 0 ${H})" fill="#f6ead0" fill-rule="evenodd" stroke="#ff0000" stroke-width="0.1">\n`;
      // retângulos das chapas (azul), só de referência, não é linha de corte
      (lay.frames || []).forEach((fr, i) => {
        s += `<rect id="chapa${i + 1}" x="${f(fr.x)}" y="${f(fr.y)}" width="${f(fr.w)}" height="${f(fr.h)}" fill="none" stroke="#0000ff"/>\n`;
      });
      lay.items.forEach((it, i) => {
        const d = [polyPath(it.poly)].concat(it.holes.map(holePath)).join(' ');
        s += `<path id="${it.name}_${i}" d="${d}"/>\n`;
      });
      s += '</g>\n';
    }
    return s + '</svg>\n';
  }

  function toDXF(lay) {
    const L = [];
    const add = (c, v) => { L.push(String(c)); L.push(String(v)); };
    add(0, 'SECTION'); add(2, 'HEADER'); add(9, '$ACADVER'); add(1, 'AC1009'); add(9, '$INSUNITS'); add(70, 4); add(0, 'ENDSEC');
    add(0, 'SECTION'); add(2, 'TABLES'); add(0, 'TABLE'); add(2, 'LAYER'); add(70, 2);
    add(0, 'LAYER'); add(2, 'CUT'); add(70, 0); add(62, 1); add(6, 'CONTINUOUS');
    add(0, 'LAYER'); add(2, 'CHAPA'); add(70, 0); add(62, 5); add(6, 'CONTINUOUS'); add(0, 'ENDTAB'); add(0, 'ENDSEC');
    add(0, 'SECTION'); add(2, 'ENTITIES');
    const poly = (verts, layer) => {
      const ly = layer || 'CUT';
      add(0, 'POLYLINE'); add(8, ly); add(66, 1); add(70, 1); add(10, 0); add(20, 0); add(30, 0);
      for (const v of verts) {
        add(0, 'VERTEX'); add(8, ly); add(10, f(v[0])); add(20, f(v[1])); add(30, 0);
        if (v[2]) add(42, v[2]);
      }
      add(0, 'SEQEND'); add(8, ly);
    };
    // retângulos das chapas, em camada própria (azul), só de referência
    for (const fr of lay.frames || []) {
      poly([[fr.x, fr.y, 0], [fr.x + fr.w, fr.y, 0], [fr.x + fr.w, fr.y + fr.h, 0], [fr.x, fr.y + fr.h, 0]], 'CHAPA');
    }
    for (const it of lay.items) {
      poly(it.poly.map(p => [p[0], p[1], 0]));
      for (const h of it.holes) {
        if (h.len - h.wid < 0.01) {
          add(0, 'CIRCLE'); add(8, 'CUT'); add(10, f(h.cx)); add(20, f(h.cy)); add(30, 0); add(40, f(h.wid / 2));
        } else {
          const g = slotGeom(h);
          poly([[g.A[0], g.A[1], 0], [g.B[0], g.B[1], 1], [g.C[0], g.C[1], 0], [g.D[0], g.D[1], 1]]);
        }
      }
    }
    add(0, 'ENDSEC'); add(0, 'EOF');
    return L.join('\n') + '\n';
  }

  /*
   * CSV no formato "sheet/panel" do optiCutter (www.opticutter.com/public/doc/import), para organizar
   * o corte de várias caixas de uma vez. Cada peça entra pelo retângulo que a envolve (sem furos nem
   * dentes, que esse formato não representa); o encaixe fino continua sendo feito pelo SVG/DXF.
   */
  function csvRow(cells) {
    return cells.map(c => {
      c = c == null ? '' : String(c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(',') + '\r\n';
  }
  function toCSV(res, cfg, qty) {
    const n = Math.max(1, Math.round(+qty || 1));
    const grain = cfg.grain === 'h' || cfg.grain === 'v' ? cfg.grain : '';
    const pg = cfg.pieceGrain || {};
    let s = '';
    s += csvRow(['@', 'Key', 'Valores']);
    s += csvRow(['N', `Caixa ${cfg.W}x${cfg.D}x${cfg.H}mm`]);
    s += csvRow(['M', `MDF ${cfg.t}mm`]);
    s += csvRow(['K', +cfg.kerf || 0]);
    s += csvRow(['S', +cfg.sheetW || 1000, +cfg.sheetH || 800, '', grain, '', '', '']);
    s += csvRow(['@', 'Comprimento', 'Largura', 'Qtde', 'Veio', 'Rótulo', 'Grupo']);
    for (const p of res.panels) {
      const b = bbox(p.poly);
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      const g = pg[p.name] === 'u' ? 'h' : pg[p.name] === 'v' ? 'v' : '';
      s += csvRow(['P', w.toFixed(2), h.toFixed(2), n, g, p.label, p.name]);
    }
    return s;
  }

  // Dimensões externas da caixa conforme as opções (considera medidas internas).
  function outerDims(cfg) {
    const t = +cfg.t;
    let W = +cfg.W, D = +cfg.D, H = +cfg.H;
    if (cfg.dimMode === 'inner') { W += 2 * t; D += 2 * t; H += t + (lidState(cfg) !== 'none' ? t : 0); }
    return { W, D, H };
  }

  const api = { combineSheets, toCSV, toothLayout, outerDims, build, layout, layoutSteps, toSVG, toDXF, oddCount, offsetPoly, buildOutline, FACE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BoxGeom = api;
})(typeof window !== 'undefined' ? window : globalThis);
