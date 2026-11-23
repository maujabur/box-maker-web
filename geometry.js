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
   * fit: positivo estreita a boca do rasgo (aperto/interferência); negativo alarga (folga).
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
        const c = Math.max(0, Math.min(edge.chamfer || 0, d, w / 2 - 0.01));
        pts.push(P(a, 0), P(a, d - c), P(a + c, d), P(b - c, d), P(b, d - c), P(b, 0));
      } else {
        const fitHalf = (edge.fit || 0) / 2;
        const e = fitHalf >= 0 ? Math.min(fitHalf, w / 2 - 0.05) : Math.max(fitHalf, -(w / 2 - 0.05));
        // chanfro: bisela a borda do material na boca do rasgo, entrando para dentro do rasgo
        // (de a+e até a+e+c), nunca para fora (o que invadiria o dente vizinho)
        const d = edge.depth != null ? edge.depth : t;
        const c = Math.max(0, Math.min(edge.chamfer || 0, d, w / 2 - Math.abs(e) - 0.01));
        pts.push(P(a + e, 0), P(a + e + c, -c), P(a + e + c, -d), P(b - e - c, -d), P(b - e - c, -c), P(b - e, 0));
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
    // folga da tampa (cfg.lidFit): o oposto da interferência geral. Alarga o rasgo que recebe o
    // dente da tampa (não encolhe o dente), para um encaixe mais solto só na tampa.
    const fitLid = fit - Math.max(0, +cfg.lidFit || 0);
    const comp = cfg.kerfComp ? kerf / 2 : 0;
    let W = +cfg.W, D = +cfg.D, H = +cfg.H;
    const lid = lidState(cfg);
    const bot = cfg.bottomMode === 'plateTabs' ? 'plateTabs' : 'wallTabs';
    // Recuo da tampa: desloca para dentro o retângulo-guia (fundo dos recessos / base dos dentes)
    // da tampa. guia = medida - 2*(t + recuo). Recuo 0 = antiga tampa lisa por dentro.
    // O tamanho da tampa (ponta dos dentes) não muda. Negativo não é checado.
    const cl = +cfg.lidClearance || 0;
    const lg = t + cl;
    const hasLid = lid !== 'none';
    if (cfg.dimMode === 'inner') { W += 2 * t; D += 2 * t; H += t + (hasLid ? t : 0); }
    if (!(t > 0)) throw new Error('Espessura inválida.');
    if (W < 4 * t || D < 4 * t || H < 4 * t) throw new Error('Dimensões muito pequenas para a espessura.');

    // largura alvo dos dentes por eixo (X = comprimento, Y = largura, Z = altura)
    const pick = (a, b) => (+a > 0 ? +a : +b);
    const tv = pick(cfg.toothVert, 20);
    const tbx = pick(cfg.toothBaseX, cfg.toothBase), tby = pick(cfg.toothBaseY, cfg.toothBase);
    const tlx = pick(cfg.toothLidX, cfg.toothLid), tly = pick(cfg.toothLidY, cfg.toothLid);
    const warnings = [];
    const info = [];
    const zlo = bot === 'plateTabs' ? 0 : t;
    const zhi = (lid === 'wallTabs' || lid === 'overlay') ? H - t : H;
    if (lid !== 'none' && lid !== 'overlay') {
      if (lg <= 0.01) throw new Error('Recuo da tampa negativo demais: espessura + recuo deve ser positivo.');
      if (W - 2 * lg <= 0 || D - 2 * lg <= 0) throw new Error('Recuo da tampa grande demais: o retângulo-guia da tampa não tem tamanho.');
    }
    if (zhi - zlo < 2 * t) throw new Error('Altura insuficiente para os dentes verticais.');

    const cMain = +cfg.chamfer || 0, cLid = +cfg.chamferLid || 0;

    // divisões (número ímpar, pontas lisas) e largura real, por eixo
    const minC = 2 * t;                       // canto mínimo geral: zona da peça vizinha + ponte
    const minCL = 2 * t + Math.max(cl, 0);    // arestas da tampa: o recuo aprofunda a zona
    const mkDiv = (L, tooth, mc, nome) => {
      const d = toothLayout(L, tooth, mc);
      if (d.adj) warnings.push(`${nome}: dente de ${tooth} mm não cabe em ${L.toFixed(1)} mm com canto mínimo de ${mc.toFixed(1)} mm; usando ${d.m.toFixed(2)} mm.`);
      return { n: d.n, L, w: d.m, c: d.c };
    };
    const divs = {
      vert: mkDiv(H, tv, minC, 'Arestas verticais'),
      baseX: mkDiv(W, tbx, minC, 'Fundo X'), baseY: mkDiv(D, tby, minC, 'Fundo Y'),
      lidX: null, lidY: null,
    };
    if (lid === 'wallTabs' || lid === 'plateTabs') { divs.lidX = mkDiv(W, tlx, minCL, 'Tampa X'); divs.lidY = mkDiv(D, tly, minCL, 'Tampa Y'); }
    const fmt = (nm, d) => `${nm}: ${d.n} divisões, ${(d.n - 1) / 2} dentes de ${d.w.toFixed(2)} mm, cantos de ${d.c.toFixed(2)} mm`;
    info.push(fmt('Arestas verticais (Z)', divs.vert));
    info.push(fmt('Fundo X', divs.baseX) + '; ' + fmt('Y', divs.baseY));
    if (divs.lidX) info.push(fmt('Tampa X', divs.lidX) + '; ' + fmt('Y', divs.lidY));
    // aresta horizontal de uma parede (junção com fundo ou tampa)
    const wallEdge = (state, len, tooth, chamfer, mc, fitHere) => {
      const full = { fullA: 0, fullB: len, minC: mc };
      if (state === 'wallTabs') return Object.assign({ mode: 'tab', a: t, b: len - t, tooth, chamfer, fit: 0 }, full);
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
        const s = (a, b, tooth) => ({ mode: 'tab', a, b, tooth, chamfer, fit: 0, depth: g, fullA: 0, fullB: b + t, minC: mc });
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
        left: { mode: 'tab', a: zlo, b: zhi, tooth: tv, chamfer: cMain, fit: 0, fullA: 0, fullB: H, minC },
        right: { mode: 'tab', a: zlo, b: zhi, tooth: tv, chamfer: cMain, fit: 0, fullA: 0, fullB: H, minC },
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
        for (const h of face.holes || []) {
          const wid = +h.width || 0;
          const len = Math.max(+h.length || 0, wid);
          if (!(wid > 0)) continue;
          const x = +h.x || 0, y = +h.y || 0;
          const xs = (h.mirror === 'x' && Math.abs(x) > 1e-6) ? [x, -x] : [x];
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
            if (cx - hx < t - EPS || cx + hx > sp.w - t + EPS || cy - hy < t - EPS || cy + hy > sp.h - t + EPS) {
              warnings.push(`${tag}: furo (horizontal ${xx.toFixed(0)}, vertical ${y.toFixed(0)}) invade a faixa de encaixe (${t} mm da borda) ou sai da peça.`);
            }
            const L2 = Math.max(len - (cfg.kerfComp ? kerf : 0), 0.1);
            const W2 = Math.max(wid - (cfg.kerfComp ? kerf : 0), 0.1);
            holes.push({ cx, cy, len: L2, wid: Math.min(W2, L2), ang });
          }
        }
      }
      return { name: sp.name, label: FACE_NAME[sp.name], w: sp.w, h: sp.h, nominal, poly, holes };
    });

    return { panels, warnings, info, lidInfo, divs, dims: { W, D, H, t } };
  }

  // ---------- layout na chapa ----------

  function bbox(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x0, y0, x1, y1 };
  }

  /*
   * Organização das peças em chapas (retângulos envolventes, com rotação de 90° quando o veio permite).
   * Para cada chapa testa todas as ordens e rotações das peças que sobraram (MaxRects) e fica com o
   * arranjo que acomoda a maior área. O que não coube segue para a próxima chapa.
   */
  function packOne(pieces, order, rotMask, aw, ah, gap) {
    let free = [{ x: 0, y: 0, w: aw, h: ah }];
    const placed = [];
    for (let k = 0; k < order.length; k++) {
      const pc = pieces[order[k]];
      const rot = (rotMask >> k) & 1;
      const w = (rot ? pc.h : pc.w) + gap, h = (rot ? pc.w : pc.h) + gap;
      let best = null, bs = Infinity;
      for (const f of free) {
        if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
          const sc = Math.min(f.w - w, f.h - h);
          if (sc < bs) { bs = sc; best = f; }
        }
      }
      if (!best) continue; // esta peça não coube; tenta as seguintes
      const u = { x: best.x, y: best.y, w, h };
      placed.push({ pc, x: u.x, y: u.y, rot, w, h });
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
    }
    return placed;
  }

  function permutations(a) {
    if (a.length <= 1) return [a];
    const out = [];
    a.forEach((x, i) => permutations(a.filter((_, j) => j !== i)).forEach(p => out.push([x, ...p])));
    return out;
  }

  // fixedRot[i]: -1 = livre (0° ou 90°), 0 = não gira, 1 = gira 90° (por causa do veio)
  function bestSheet(pieces, aw, ah, gap, fixedRot) {
    const n = pieces.length;
    const orders = n <= 6 ? permutations([...Array(n).keys()]) : [[...Array(n).keys()].sort((i, j) => pieces[j].w * pieces[j].h - pieces[i].w * pieces[i].h)];
    let best = null, bestScore = -Infinity;
    for (const order of orders) {
      let fixedBits = 0;
      const freePos = [];
      order.forEach((idx, k) => {
        if (fixedRot[idx] === 1) fixedBits |= (1 << k);
        else if (fixedRot[idx] === -1 && freePos.length < 8) freePos.push(k);
      });
      for (let sub = 0; sub < (1 << freePos.length); sub++) {
        let mask = fixedBits;
        for (let j = 0; j < freePos.length; j++) if ((sub >> j) & 1) mask |= (1 << freePos[j]);
        const placed = packOne(pieces, order, mask, aw, ah, gap);
        if (!placed.length) continue;
        let area = 0, mx = 0, my = 0;
        for (const q of placed) { area += (q.w - gap) * (q.h - gap); mx = Math.max(mx, q.x + q.w); my = Math.max(my, q.y + q.h); }
        const score = area * 1e3 - (mx * my) * 1e-3; // maior área; empate: arranjo mais compacto
        if (score > bestScore) { bestScore = score; best = placed; }
      }
    }
    return best || [];
  }

  const rot90 = p => [-p[1], p[0]];

  function layout(res, cfg) {
    const SW = Math.max(50, +cfg.sheetW || 1000), SH = Math.max(50, +cfg.sheetH || 800);
    const gap = Math.max(0, +cfg.gap || 0), margin = Math.max(0, +cfg.margin || 0);
    const grain = cfg.grain === 'h' || cfg.grain === 'v' ? cfg.grain : 'none';
    const aw = SW - 2 * margin + gap, ah = SH - 2 * margin + gap;
    // veio: o eixo de veio da peça (u = x local, v = y local) deve ficar paralelo ao veio da chapa
    const pg = cfg.pieceGrain || {};
    const grainOf = p => (pg[p.name] === 'u' || pg[p.name] === 'v' ? pg[p.name] : 'none');
    let remaining = res.panels.map(p => {
      const b = bbox(p.poly);
      const g = grainOf(p);
      let fixed = -1;
      if (grain !== 'none' && g !== 'none') fixed = grain === 'h' ? (g === 'u' ? 0 : 1) : (g === 'u' ? 1 : 0);
      return { p, w: b.x1 - b.x0, h: b.y1 - b.y0, g, fixed };
    });
    const sheets = [];
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
        name: pc.p.name, label: pc.p.label, rotated: !!rot, grained: grain !== 'none' && pc.g !== 'none',
        poly: poly.map(q => [q[0] + dx, q[1] + dy]),
        holes: holes.map(h => Object.assign(h, { cx: h.cx + dx, cy: h.cy + dy })),
        cx: ox + (b.x1 - b.x0) / 2, cy: oy + (b.y1 - b.y0) / 2, w: pc.p.w, h: pc.p.h,
      };
    };
    while (remaining.length) {
      const placed = bestSheet(remaining, aw, ah, gap, remaining.map(pc => pc.fixed));
      if (!placed.length) {
        // peça maior que a chapa: vai sozinha, em uma chapa ampliada, com aviso
        const pc = remaining.shift();
        res.warnings.push(`${pc.p.label} (${pc.w.toFixed(0)} × ${pc.h.toFixed(0)} mm) não cabe na chapa de ${SW} × ${SH} mm (com margem de ${margin} mm).`);
        sheets.push({ items: [mkItem(pc, pc.fixed === 1 ? 1 : 0, margin, margin)], width: Math.max(SW, pc.w + 2 * margin), height: Math.max(SH, pc.h + 2 * margin), oversize: true, grain });
        continue;
      }
      const items = placed.map(q => mkItem(q.pc, q.rot, margin + q.x, margin + q.y));
      sheets.push({ items, width: SW, height: SH, grain });
      const used = new Set(placed.map(q => q.pc));
      remaining = remaining.filter(pc => !used.has(pc));
    }
    sheets.forEach(sh => {
      const area = sh.items.reduce((a, it) => a + (bbox(it.poly).x1 - bbox(it.poly).x0) * (bbox(it.poly).y1 - bbox(it.poly).y0), 0);
      sh.usage = area / (sh.width * sh.height);
    });
    return { sheets };
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

  const api = { combineSheets, toCSV, toothLayout, outerDims, build, layout, toSVG, toDXF, oddCount, offsetPoly, buildOutline, FACE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BoxGeom = api;
})(typeof window !== 'undefined' ? window : globalThis);
