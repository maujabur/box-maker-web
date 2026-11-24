(function () {
  'use strict';
  const G = window.BoxGeom;
  const STORE = 'boxmaker.cfg.v1';

  // Grupos de furos. Paredes: um conjunto por parede. Tampa e fundo: um conjunto por lado.
  const GROUPS = [
    { title: 'Paredes', hint: 'Horizontal: a partir do centro da parede, + para a direita (vista de fora). Vertical: distância do topo da parede até a borda de cima do furo.',
      items: [['front', 'Frente'], ['back', 'Trás'], ['left', 'Esquerda'], ['right', 'Direita']], kind: 'wall' },
    { title: 'Tampa', hint: 'Cada lado tem seus furos, paralelos ao lado. Horizontal: a partir do centro do lado, + para a direita (de pé diante do lado). Vertical: distância da borda da tampa até a borda mais próxima do furo.',
      items: [['lid_front', 'Lado da frente'], ['lid_back', 'Lado de trás'], ['lid_left', 'Lado esquerdo'], ['lid_right', 'Lado direito']], kind: 'plate' },
    { title: 'Fundo', hint: 'Mesmas regras da tampa.',
      items: [['bottom_front', 'Lado da frente'], ['bottom_back', 'Lado de trás'], ['bottom_left', 'Lado esquerdo'], ['bottom_right', 'Lado direito']], kind: 'plate' },
  ];
  const ALL_KEYS = GROUPS.reduce((a, g) => a.concat(g.items.map(i => i[0])), []);

  const newHole = () => ({ x: 0, y: 30, length: 120, width: 35, mirror: 'none' });

  function defaultFaces() {
    const f = {};
    for (const k of ALL_KEYS) f[k] = { enabled: !k.startsWith('bottom_'), holes: [newHole()] };
    return f;
  }

  // Peças da visualização 3D: modo (solid, glass, ghost) e cor.
  const PIECES = [['front', 'Frente'], ['back', 'Trás'], ['left', 'Esquerda'], ['right', 'Direita'], ['bottom', 'Fundo'], ['lid', 'Tampa']];
  const PIECE_COLORS = { front: '#e8cf9f', back: '#e8cf9f', left: '#dcbd86', right: '#dcbd86', bottom: '#c9a46a', lid: '#f2e2bf' };
  const MODES = [['solid', 'Sólida'], ['ghost', 'Transparente']];
  function defaultView() {
    const v = {};
    for (const [k] of PIECES) v[k] = { mode: 'solid', color: PIECE_COLORS[k], explode: false };
    return v;
  }

  function defaultGrain() {
    const g = {};
    for (const [k] of PIECES) g[k] = 'none';
    return g;
  }

  function defaults() {
    return {
      dimMode: 'outer', W: 500, D: 300, H: 200, t: 6, kerf: 0.1, kerfComp: true, fit: 0.1,
      toothVert: 20, toothBaseX: 20, toothBaseY: 20, toothLidX: 100, toothLidY: 100, chamfer: 0.5, chamferLid: 1,
      bottomMode: 'wallTabs', lidEnabled: true, lidPos: 'outer', lidTeeth: true, lidClearance: 0, lidFitSame: false, lidFit: -0.1, piecesOpen: true, qty: 1,
      sheetW: 1000, sheetH: 800, gap: 5, margin: 5, grain: 'none',
      faces: defaultFaces(),
      tab: '3d',
      pieceGrain: defaultGrain(),
      explode: 100,
      view: defaultView(),
    };
  }

  // Mescla com os padrões para aceitar projetos antigos ou incompletos.
  function normalize(src) {
    const c = Object.assign(defaults(), src || {});
    // projetos antigos: lidMode / fundo liso
    if (src && src.lidEnabled === undefined && src.lidMode) {
      const m = src.lidMode;
      c.lidEnabled = m !== 'none';
      c.lidPos = (m === 'plateTabs' || m === 'inset') ? 'inner' : 'outer';
      c.lidTeeth = m === 'wallTabs' || m === 'plateTabs';
    }
    // projetos antigos: uma largura única para X e Y
    if (src && src.toothBaseX === undefined && src.toothBase > 0) c.toothBaseX = c.toothBaseY = src.toothBase;
    if (src && src.toothLidX === undefined && src.toothLid > 0) c.toothLidX = c.toothLidY = src.toothLid;
    ['toothBase', 'toothLid', 'toothLidNx', 'toothLidNy'].forEach(k => delete c[k]);
    if (c.bottomMode !== 'plateTabs') c.bottomMode = 'wallTabs';
    delete c.lidMode;
    // furos: formato antigo (u, v, ângulo, faces lid/bottom) é descartado e volta ao padrão
    const sf = src && src.faces;
    const oldFmt = !sf || ('lid' in sf) || ('bottom' in sf) ||
      Object.keys(sf).some(k => (sf[k].holes || []).some(h => 'u' in h || 'v' in h));
    const faces = defaultFaces();
    if (!oldFmt) {
      for (const k of ALL_KEYS) {
        const fc = sf[k];
        if (!fc) continue;
        faces[k] = {
          enabled: !!fc.enabled,
          holes: Array.isArray(fc.holes) ? fc.holes.map(h => ({
            x: +h.x || 0, y: +h.y || 0, length: +h.length || 0, width: +h.width || 0,
            mirror: h.mirror === 'x' ? 'x' : 'none',
          })) : [],
        };
      }
    }
    c.faces = faces;
    const view = defaultView();
    if (src && src.view) for (const [k] of PIECES) {
      const sv = src.view[k];
      if (sv) view[k] = { mode: sv.mode === 'ghost' ? 'ghost' : 'solid', color: /^#[0-9a-f]{6}$/i.test(sv.color) ? sv.color : view[k].color, explode: !!sv.explode };
    }
    c.view = view;
    if (!['none', 'h', 'v'].includes(c.grain)) c.grain = 'none';
    const pgr = defaultGrain();
    if (src && src.pieceGrain) for (const [k] of PIECES) if (src.pieceGrain[k] === 'u' || src.pieceGrain[k] === 'v') pgr[k] = src.pieceGrain[k];
    c.pieceGrain = pgr;
    c.explode = Math.min(Math.max(+c.explode || 0, 0), 600);
    c.lidFit = +c.lidFit;
    if (!isFinite(c.lidFit)) c.lidFit = -0.1;
    c.lidFitSame = !!c.lidFitSame;
    c.qty = Math.min(999, Math.max(1, Math.round(+c.qty || 1)));
    c.tab = '3d'; // sempre abre na montagem 3D
    return c;
  }

  // ---------- ajuda ----------
  const HELP = {
    dims: `<strong>Medidas</strong><p>Externas: o comprimento, a largura e a altura informados são as do lado de fora da caixa montada.</p><p>Internas: a página soma as espessuras necessárias (2× em X e Y, e em Z soma a espessura do fundo e, se houver, da tampa) e usa isso como medida externa.</p>`,
    teeth: `<strong>Dentes de encaixe</strong><p>Cada eixo (arestas verticais, fundo e tampa, em X e Y) tem uma largura alvo em mm e um número de divisões. Editar um recalcula o outro.</p><p>Divisões é sempre ímpar: as duas pontas são cantos lisos, que absorvem a sobra da divisão, e o miolo tem dentes e intervalos exatamente do tamanho digitado.</p><p>O chanfro arredonda a ponta dos dentes e a boca dos rasgos, nos dois lados do encaixe, para facilitar a montagem.</p>`,
    lid: `<strong>Fundo e tampa</strong><p>Por fora cobre as paredes; por dentro fica entre elas. Com dentes, o encaixe usa os mesmos dentes da seção 3; sem dentes, a peça é lisa, só encostada.</p><p><em>Recuo da tampa</em>: desloca para dentro o retângulo-guia da tampa (a base dos dentes, ou o fundo dos rasgos quando a tampa é por fora): guia = medida − 2 × (espessura + recuo). O tamanho da tampa, na ponta dos dentes, não muda. Não pode ser negativo; 0 = sem recuo.</p><p><em>Ajuste da tampa</em>: diferença total de largura entre os dentes e os rasgos da junção da tampa, independente da interferência da seção 1. Fica dividida meio a meio: positivo = aperto (o dente cresce metade e o rasgo encolhe metade); zero = encaixe nominal; negativo = folga (o dente encolhe metade e o rasgo cresce metade). Padrão −0,1 mm (folga). Marque "Ajuste da tampa igual à interferência geral" para a tampa seguir o valor da seção 1.</p>`,
    holes: `<strong>Furos oblongos</strong><p>Cada parede tem seu próprio conjunto de furos. Na tampa e no fundo, cada um dos quatro lados (frente, trás, esquerda, direita) tem o seu.</p><p>Horizontal: distância a partir do centro do lado, positivo para a direita (vista de fora, ou de pé diante do lado). Vertical: distância da borda até a borda mais próxima do furo. O furo é sempre paralelo ao lado.</p><p>"Centralizar" calcula o deslocamento vertical que deixa o furo no meio da parede (altura) ou do lado da tampa/fundo.</p>`,
    sheet: `<strong>Chapa e organização</strong><p>O plano de corte organiza as peças em chapas do tamanho informado; o que não couber em uma vai para a próxima. Ele é calculado ao abrir a aba "Peças para corte", pelo botão "Calcular plano" e, se estiver desatualizado, ao baixar o SVG ou o DXF.</p><p>Critério, em ordem: menos chapas; depois, a sobra mais contínua (um retângulo livre grande, aproveitável); depois, o arranjo mais compacto.</p><p>"Caixas", no topo, repete as peças no plano para fabricar várias caixas de uma vez (as peças ganham o número da caixa).</p><p>Veio: se a chapa tiver veio (horizontal ou vertical), cada peça marcada com veio só gira 90° se isso mantiver seu eixo de veio paralelo ao da chapa. Peças sem veio marcado giram livremente.</p><p>"Baixar SVG" e "Baixar DXF", no topo, juntam todas as chapas em um arquivo só, empilhadas, cada uma com seu contorno em azul (só de referência, não é corte).</p>`,
    csv: `<strong>Lista de corte (CSV)</strong><p>Gera um arquivo com o tamanho de cada peça (sem furos nem dentes, que esse formato não representa), no formato do <a href="https://www.opticutter.com/cut-list-optimizer/import/csv" target="_blank" rel="noopener">Cutlist Optimizer</a> (opticutter.com).</p><p>"Caixas", no topo, multiplica a lista pelo número de caixas que você vai fabricar (o mesmo número vale para o plano de corte do SVG/DXF). A chapa e o veio informados nas seções 1 e 5 já entram no arquivo.</p><p>O desenho detalhado de cada peça, com furos e dentes, continua saindo pelo SVG e pelo DXF.</p>`,
  };
  function initHelp() {
    const pop = $('#help-pop'), body = $('#help-pop-body');
    let openBtn = null;
    const close = () => { pop.hidden = true; openBtn = null; };
    document.querySelectorAll('.help-btn').forEach(btn => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (openBtn === btn) { close(); return; }
        body.innerHTML = HELP[btn.dataset.help] || '';
        pop.hidden = false;
        const r = btn.getBoundingClientRect();
        const pw = pop.offsetWidth || 320;
        let left = r.left + window.scrollX;
        if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
        pop.style.left = Math.max(12, left) + 'px';
        pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
        openBtn = btn;
      };
    });
    document.addEventListener('click', (ev) => { if (openBtn && !pop.contains(ev.target)) close(); });
    window.addEventListener('resize', close);
  }

  let cfg;
  try { cfg = normalize(JSON.parse(localStorage.getItem(STORE))); } catch (e) { cfg = normalize(null); }

  const $ = s => document.querySelector(s);
  let last = null; // último resultado do cálculo das peças { res }
  // plano de corte: calculado sob demanda (botão, ao abrir a aba ou ao baixar). key = configuração usada.
  let plan = null, planJob = null;

  // ---------- campos estáticos ----------
  function bindStatic() {
    document.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (el.dataset.tip == null) el.dataset.tip = el.title || '';
      if (el.type === 'checkbox') el.checked = !!cfg[k]; else el.value = cfg[k];
      const apply = () => {
        if (el.type === 'checkbox') cfg[k] = el.checked;
        else if (el.type === 'number') { const v = parseFloat(el.value); if (isNaN(v)) return false; cfg[k] = v; }
        else cfg[k] = el.value;
        return true;
      };
      // digitando: espera uma pausa antes de recalcular (evita erros passageiros); ao confirmar, recalcula já
      el.oninput = () => { if (apply()) update(el.type === 'number' ? TYPING_DELAY : 0); };
      el.onchange = () => { if (apply()) update(); };
    });
  }

  // ---------- divisões por eixo ----------
  // A largura em mm é a aplicada a dentes e intervalos; os cantos absorvem a sobra.
  // Editar as divisões grava mm = comprimento / n (cantos iguais ao dente).
  function bindDivs() {
    document.querySelectorAll('[data-div]').forEach(el => {
      el.onchange = () => {
        const dv = last && last.res.divs[el.dataset.div];
        if (!dv) return;
        let n = Math.round(parseFloat(el.value));
        if (isNaN(n)) return;
        if (n % 2 === 0) n += 1;
        n = Math.max(3, n);
        const key = el.dataset.key;
        cfg[key] = Math.round((dv.L / n) * 1000) / 1000;
        el.value = n;
        const mm = document.querySelector(`[data-k="${key}"]`);
        if (mm) mm.value = cfg[key];
        update();
      };
    });
  }

  function showDivs(res) {
    document.querySelectorAll('[data-div]').forEach(el => {
      const id = el.dataset.div;
      const dv = res && res.divs[id];
      const real = document.querySelector(`[data-real="${id}"]`);
      el.disabled = !dv;
      if (!dv) { if (document.activeElement !== el) el.value = ''; real.textContent = '–'; return; }
      if (document.activeElement !== el) el.value = dv.n;
      const k = (dv.n - 1) / 2;
      real.textContent = `${k} ${k === 1 ? 'dente' : 'dentes'} · cantos ${dv.c.toFixed(2)} mm`;
    });
  }

  // ---------- furos ----------
  function numInput(label, obj, key, onChange) {
    const l = document.createElement('label');
    l.append(label);
    const i = document.createElement('input');
    i.type = 'number'; i.step = 'any'; i.value = obj[key];
    i.oninput = () => { const v = parseFloat(i.value); if (isNaN(v)) return; obj[key] = v; update(TYPING_DELAY); };
    i.onchange = () => update();
    l.append(i);
    if (onChange) onChange(i);
    return l;
  }

  // Deslocamento vertical que deixa o furo centralizado na altura da parede / na largura da tampa.
  function centeredY(kind, key, hole) {
    const d = G.outerDims(cfg);
    let extent;
    if (kind === 'wall') extent = d.H;
    else extent = (key.endsWith('_front') || key.endsWith('_back')) ? d.D : d.W;
    return Math.round(((extent - hole.width) / 2) * 1000) / 1000;
  }

  function renderFaces() {
    const box = $('#faces');
    box.innerHTML = '';
    for (const grp of GROUPS) {
      const det = document.createElement('details');
      det.className = 'sub';
      const sum = document.createElement('summary');
      sum.textContent = grp.title;
      det.append(sum);
      const hint = document.createElement('p');
      hint.className = 'hint'; hint.textContent = grp.hint;
      det.append(hint);

      for (const [key, title] of grp.items) {
        const face = cfg.faces[key];
        const wrap = document.createElement('div');
        wrap.className = 'face';
        wrap.dataset.face = key;
        const head = document.createElement('div');
        head.className = 'head';
        const lab = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = face.enabled;
        cb.onchange = () => { face.enabled = cb.checked; update(); };
        lab.append(cb, ' ' + title);
        const add = document.createElement('button');
        add.textContent = '+ furo';
        add.onclick = () => { face.holes.push(newHole()); face.enabled = true; renderFaces(); update(); };
        head.append(lab, add);
        wrap.append(head);

        face.holes.forEach((h, idx) => {
          const hb = document.createElement('div');
          hb.className = 'hole';
          hb.dataset.face = key;
          hb.dataset.hole = idx;
          const g = document.createElement('div');
          g.className = 'grid';
          let yInput = null;
          g.append(
            numInput('Horizontal, do centro (mm)', h, 'x'),
            numInput('Vertical, da borda (mm)', h, 'y', i => { yInput = i; }),
            numInput('Comprimento (mm)', h, 'length'),
            numInput('Largura (mm)', h, 'width'));
          const row = document.createElement('div');
          row.className = 'row';
          const sel = document.createElement('select');
          [['none', 'Sem espelho'], ['x', 'Espelhar na horizontal']].forEach(([v, t]) => {
            const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o);
          });
          sel.value = h.mirror;
          sel.onchange = () => { h.mirror = sel.value; update(); };
          const ctr = document.createElement('button');
          ctr.textContent = 'Centralizar';
          ctr.title = 'Ajusta o deslocamento vertical para o furo ficar centralizado';
          ctr.onclick = () => {
            h.y = centeredY(grp.kind, key, h);
            if (yInput) yInput.value = h.y;
            update();
          };
          // ajuste automático: só aparece quando o furo não cabe (ver updateFixButtons)
          const fix = document.createElement('button');
          fix.textContent = 'Ajustar ao espaço';
          fix.className = 'fix-btn';
          fix.hidden = true;
          fix.dataset.fix = key + ':' + idx;
          fix.onclick = () => {
            const fx = last && last.res.holeFixes[fix.dataset.fix];
            if (!fx) return;
            Object.assign(h, fx);
            renderFaces();
            update();
          };
          const del = document.createElement('button');
          del.textContent = 'Remover';
          del.onclick = () => { face.holes.splice(idx, 1); renderFaces(); update(); };
          row.append(sel, ctr, fix, del);
          hb.append(g, row);
          wrap.append(hb);
        });
        det.append(wrap);
      }
      box.append(det);
    }
  }

  // ---------- veio ----------
  // Ícone: retângulo com riscos na direção do veio (u = horizontal, v = vertical) ou tracejado ("sem").
  function grainIcon(kind, w, h, sel) {
    const stroke = sel ? '#2f6fdc' : '#8a7a5e';
    const fill = kind === 'u' ? 'url(#gu)' : kind === 'v' ? 'url(#gv)' : '#fbf8f2';
    const dash = kind === 'none' ? ' stroke-dasharray="3 2"' : '';
    const txt = kind === 'none' ? `<text x="${w / 2 + 2}" y="${h / 2 + 6}" font-size="10" text-anchor="middle" fill="#8a7a5e">sem</text>` : '';
    return `<svg width="${w + 4}" height="${h + 4}" viewBox="0 0 ${w + 4} ${h + 4}"><rect x="2" y="2" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${sel ? 1.8 : 1.1}"${dash}/>${txt}</svg>`;
  }

  function renderGrain() {
    const sheetBox = $('#grain-sheet'), box = $('#grain-pieces');
    if (!sheetBox || !box) return;
    const mk = (cls, html) => { const b = document.createElement('button'); b.className = cls; b.innerHTML = html; return b; };

    sheetBox.innerHTML = '';
    [['none', 'none', 'Sem veio'], ['h', 'u', 'Horizontal'], ['v', 'v', 'Vertical']].forEach(([val, kind, label]) => {
      const b = mk('gbtn' + (cfg.grain === val ? ' on' : ''), grainIcon(kind, 36, 28, cfg.grain === val) + `<span>${label}</span>`);
      b.onclick = () => { cfg.grain = val; renderGrain(); update(); };
      sheetBox.append(b);
    });

    box.innerHTML = '';
    box.classList.toggle('muted', cfg.grain === 'none');
    const d = G.outerDims(cfg);
    const dims = { front: [d.W, d.H], back: [d.W, d.H], left: [d.D, d.H], right: [d.D, d.H], bottom: [d.W, d.D], lid: [d.W, d.D] };
    const list = PIECES.filter(([k]) => k !== 'lid' || cfg.lidEnabled);
    const STATES = [['none', 'Sem veio'], ['u', 'Ao longo de u ↔'], ['v', 'Ao longo de v ↕']];

    const head = document.createElement('div');
    head.className = 'grow ghead';
    head.append(document.createElement('span'));
    STATES.forEach(([, t]) => { const s = document.createElement('span'); s.textContent = t; head.append(s); });
    box.append(head);

    const row = (title, sub, keys, size) => {
      const r = document.createElement('div');
      r.className = 'grow';
      const nm = document.createElement('div');
      nm.className = 'gname';
      nm.innerHTML = `<strong>${title}</strong><small>${sub}</small>`;
      r.append(nm);
      STATES.forEach(([st]) => {
        const sel = keys.every(k => cfg.pieceGrain[k] === st);
        const b = mk('gbtn small' + (sel ? ' on' : ''), grainIcon(st, size[0], size[1], sel));
        b.title = STATES.find(x => x[0] === st)[1];
        b.onclick = () => { keys.forEach(k => { cfg.pieceGrain[k] = st; }); renderGrain(); update(); };
        r.append(b);
      });
      return r;
    };
    // atalhos
    box.append(row('Todas as paredes', 'atalho', ['front', 'back', 'left', 'right'], [30, 18]));
    box.append(row('Todas as peças', 'atalho', list.map(([k]) => k), [30, 18]));
    // por peça, com ícone na proporção da peça montada
    for (const [k, name] of list) {
      const [w, h] = dims[k];
      const sc = 44 / Math.max(w, h);
      box.append(row(name, `${Math.round(w)} × ${Math.round(h)}`, [k], [Math.max(14, Math.round(w * sc)), Math.max(12, Math.round(h * sc))]));
    }
  }

  // ---------- abas e 3D ----------
  let view3d = null, dirty3d = true, pieceLid = null;

  function ensure3d() {
    if (view3d) return view3d;
    const err = $('#gl-error');
    try {
      if (!window.THREE || !window.BoxView3D) throw new Error('three.js não carregou');
      view3d = window.BoxView3D.create($('#gl'));
      err.hidden = true;
    } catch (e) {
      err.hidden = false;
      err.textContent = 'Não foi possível iniciar o 3D neste navegador (' + e.message + ').';
      view3d = null;
    }
    return view3d;
  }

  function refresh3d() {
    const v = ensure3d();
    if (!v || !last) return;
    v.resize();
    v.update(last.res, cfg.view, cfg.explode);
    dirty3d = false;
  }

  function showTab(tab) {
    cfg.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#pane2d').hidden = tab !== '2d';
    $('#pane3d').hidden = tab !== '3d';
    if (tab === '3d') { applyPiecesOpen(); renderPieces(); refresh3d(); }
    $('#plan-bar').hidden = tab !== '2d';
    if (tab === '2d' && last && !planCurrent()) computePlan();
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
  }

  function renderPieces() {
    const box = $('#pieces');
    box.innerHTML = '';
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const list = PIECES.filter(([k]) => k !== 'lid' || cfg.lidEnabled);

    // ações para todas as peças
    const bulk = mk('div', 'bulk');
    const allSolid = list.every(([k]) => cfg.view[k].mode === 'solid');
    const allGhost = list.every(([k]) => cfg.view[k].mode === 'ghost');
    const allExpl = list.every(([k]) => cfg.view[k].explode);
    const bSolid = mk('button', 'chip' + (allSolid ? ' on' : ''), 'Sólidas');
    const bGhost = mk('button', 'chip' + (allGhost ? ' on' : ''), 'Transparentes');
    const bExpl = mk('button', 'chip' + (allExpl ? ' on' : ''), 'Explodidas');
    bSolid.onclick = () => { list.forEach(([k]) => { cfg.view[k].mode = 'solid'; }); renderPieces(); push3d(); };
    bGhost.onclick = () => { list.forEach(([k]) => { cfg.view[k].mode = 'ghost'; }); renderPieces(); push3d(); };
    bExpl.onclick = () => {
      const on = !allExpl;
      list.forEach(([k]) => { cfg.view[k].explode = on; });
      if (on && cfg.explode < 1) cfg.explode = 100;
      renderPieces(); push3d();
    };
    bulk.append(mk('strong', null, 'Peças'), bSolid, bGhost, bExpl);
    box.append(bulk);

    // um único controle de afastamento
    const sl = mk('label', 'slider');
    const lbl = mk('span', null, 'Afastamento das peças explodidas');
    const val = mk('output', null, cfg.explode + ' mm');
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = 0; rng.max = 400; rng.step = 5; rng.value = cfg.explode;
    rng.oninput = () => { cfg.explode = +rng.value; val.textContent = cfg.explode + ' mm'; push3d(); };
    const top = mk('div', 'slider-top'); top.append(lbl, val);
    sl.append(top, rng);
    box.append(sl);

    for (const [k, name] of list) {
      const v = cfg.view[k];
      const row = mk('div', 'piece');
      const color = document.createElement('input');
      color.type = 'color'; color.value = v.color; color.title = 'Cor de ' + name;
      color.oninput = () => { v.color = color.value; push3d(); };
      const seg = mk('div', 'seg');
      MODES.forEach(([m, t]) => {
        const b = mk('button', v.mode === m ? 'on' : '', t);
        b.onclick = () => { v.mode = m; renderPieces(); push3d(); };
        seg.append(b);
      });
      const ex = mk('button', 'chip small' + (v.explode ? ' on' : ''), 'Explodir');
      ex.onclick = () => {
        v.explode = !v.explode;
        if (v.explode && cfg.explode < 1) cfg.explode = 100;
        renderPieces(); push3d();
      };
      row.append(color, mk('span', null, name), seg, ex);
      box.append(row);
    }
  }

  function push3d() {
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
    if (view3d && last) view3d.update(last.res, cfg.view, cfg.explode);
  }

  document.querySelectorAll('.tab').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
  $('#cam-reset').onclick = () => { if (view3d) view3d.resetCamera(); };
  function applyPiecesOpen() {
    const open = cfg.piecesOpen !== false;
    $('#pieces-wrap').classList.toggle('closed', !open);
    $('#pieces-toggle').setAttribute('aria-expanded', open);
  }
  $('#pieces-toggle').onclick = () => {
    cfg.piecesOpen = cfg.piecesOpen === false;
    applyPiecesOpen();
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
  };

  // ---------- atualização ----------
  let pending = false, typingTimer = 0;
  const TYPING_DELAY = 250; // ms de pausa na digitação antes de recalcular
  function update(delay) {
    if (delay > 0) {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { typingTimer = 0; update(); }, delay);
      return;
    }
    clearTimeout(typingTimer); typingTimer = 0;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }
  // se há uma digitação ainda esperando para recalcular, recalcula agora (usado antes de baixar arquivos)
  function flushUpdate() {
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = 0; render(); }
  }

  function render() {
    applyRelevance();
    renderGrain();
    if (cfg.tab === '3d' && pieceLid !== cfg.lidEnabled) { pieceLid = cfg.lidEnabled; renderPieces(); }
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
    const prev = $('#preview'), info = $('#info');
    info.innerHTML = '';
    let issues = [], failure = null;
    try {
      const res = G.build(cfg);
      last = { res };
      dirty3d = true;
      if (cfg.tab === '3d') refresh3d();
      issues = res.warnings.slice();
      const d = res.dims;
      const li0 = document.createElement('li');
      li0.textContent = `Caixa externa: ${d.W} × ${d.D} × ${d.H} mm.`;
      info.append(li0);
      $('#lid-size').textContent = res.lidInfo || '';
      showDivs(res);
      res.info.forEach(t => { const li = document.createElement('li'); li.textContent = t; info.append(li); });
    } catch (e) {
      last = null;
      failure = e;
      issues = [{ level: 'error', text: e.message, keys: e.keys || [] }];
      showDivs(null);
    }
    buildIssues = issues; lastFailure = failure;
    updateFixButtons(last && last.res);
    refreshIssues();
    renderPlan();
  }
  // avisos do cálculo das peças + avisos do plano de corte (só se o plano estiver em dia)
  let buildIssues = [];
  function refreshIssues() {
    const extra = planCurrent() ? plan.lay.warnings : [];
    lastIssues = buildIssues.concat(extra);
    showIssues(lastIssues, lastFailure);
  }

  // ---------- campos que não se aplicam ----------
  // Desabilita (e explica no título) os campos sem efeito na configuração atual.
  function applyRelevance() {
    const lidOn = !!cfg.lidEnabled, teeth = lidOn && cfg.lidTeeth !== false;
    const why = {
      lidPos: !lidOn && 'Sem tampa.', lidTeeth: !lidOn && 'Sem tampa.',
      lidClearance: !lidOn ? 'Sem tampa.' : (!teeth && cfg.lidPos !== 'inner') && 'A tampa lisa por fora não tem recuo.',
      lidFit: !teeth ? (lidOn ? 'Tampa sem dentes.' : 'Sem tampa.') : cfg.lidFitSame && 'Segue a interferência geral.',
      lidFitSame: !teeth && (lidOn ? 'Tampa sem dentes.' : 'Sem tampa.'),
      toothLidX: !teeth && (lidOn ? 'Tampa sem dentes.' : 'Sem tampa.'),
      toothLidY: !teeth && (lidOn ? 'Tampa sem dentes.' : 'Sem tampa.'),
      chamferLid: !teeth && (lidOn ? 'Tampa sem dentes.' : 'Sem tampa.'),
    };
    for (const [k, reason] of Object.entries(why)) {
      document.querySelectorAll(`[data-k="${k}"]`).forEach(el => {
        el.disabled = !!reason;
        const lab = el.closest('label, td');
        if (reason) { el.title = 'Sem efeito: ' + reason; if (lab) lab.classList.add('na'); }
        else { if (el.title.startsWith('Sem efeito')) el.title = el.dataset.tip || ''; if (lab) lab.classList.remove('na'); }
      });
    }
    // linhas "Tampa X/Y" da tabela de dentes
    document.querySelectorAll('[data-real="lidX"], [data-real="lidY"]').forEach(td => td.closest('tr').classList.toggle('na', !teeth));
  }
  function updateFixButtons(res) {
    document.querySelectorAll('.fix-btn').forEach(b => {
      const fx = res && res.holeFixes ? res.holeFixes[b.dataset.fix] : undefined;
      b.hidden = fx === undefined;
      b.disabled = fx === null;
      b.title = fx === null ? 'O centro do furo está na faixa de encaixe ou fora da peça: mova o furo (horizontal/vertical).'
        : fx ? `Reduz para ${fx.length} × ${fx.width} mm, mantendo o centro, para caber fora da faixa de encaixe.` : '';
    });
  }

  // ---------- avisos e erros ----------
  let lastIssues = [], lastFailure = null;
  const LVL = { error: { rank: 3, ico: '✖', cls: 'f-err', m: 'm-err' }, warn: { rank: 2, ico: '⚠', cls: 'f-warn', m: 'm-warn' }, info: { rank: 1, ico: 'ℹ', cls: 'f-info', m: 'm-info' } };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  function fieldEls(k) { return [...document.querySelectorAll(`[data-k="${k}"], [data-key="${k}"]`)]; }
  function issueTargets(it) {
    if (it.face != null) return [...document.querySelectorAll(`.hole[data-face="${it.face}"][data-hole="${it.hole}"]`)];
    return fieldEls((it.keys || [])[0]);
  }
  function clearMarks() {
    document.querySelectorAll('.f-err, .f-warn, .f-info, .f-rel, .m-err, .m-warn, .m-info').forEach(el => {
      el.classList.remove('f-err', 'f-warn', 'f-info', 'f-rel', 'm-err', 'm-warn', 'm-info');
      delete el.dataset.sev;
    });
  }
  // marca o campo principal de cada aviso (todos os campos, no caso de erros) e as seções que o contêm
  function markIssues(issues) {
    clearMarks();
    const mark = (el, lv) => {
      const cur = +el.dataset.sev || 0;
      if (lv.rank > cur) {
        el.classList.remove('f-err', 'f-warn', 'f-info', 'f-rel');
        el.classList.add(lv.cls);
        el.dataset.sev = lv.rank;
      }
      for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
        const dr = +d.dataset.sev || 0;
        if (lv.rank > dr) { d.classList.remove('m-err', 'm-warn', 'm-info'); d.classList.add(lv.m); d.dataset.sev = lv.rank; }
      }
    };
    for (const it of issues) {
      const lv = LVL[it.level];
      if (!lv) continue;
      if (it.face != null) { issueTargets(it).forEach(el => mark(el, lv)); continue; }
      const keys = it.keys || [];
      keys.forEach((k, i) => fieldEls(k).forEach(el => {
        if (it.level === 'error' || i === 0) mark(el, lv);
        else if (!el.dataset.sev) el.classList.add('f-rel');
      }));
    }
  }
  // leva o usuário ao campo do aviso: abre as seções, rola, foca e pisca
  function focusIssue(it) {
    const el = issueTargets(it)[0] || (it.keys || []).map(fieldEls).map(a => a[0]).find(Boolean);
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const input = el.matches('input, select') ? el : el.querySelector('input, select');
    if (input) input.focus({ preventScroll: true });
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 1300);
  }
  function setStatusOpen(open) {
    const list = $('#status-list'), btn = $('#status');
    list.hidden = !open;
    btn.setAttribute('aria-expanded', open);
  }
  function showIssues(issues, failure) {
    markIssues(issues);
    // 3D e peças: sinaliza quando não há modelo válido
    const inv = $('#gl-invalid');
    inv.hidden = !failure;
    inv.innerHTML = '';
    if (failure) {
      const b = document.createElement('strong'); b.textContent = 'Modelo inválido';
      const m = document.createElement('span'); m.textContent = failure.message + ' Corrija o campo destacado.';
      inv.append(b, m);
    }
    const btn = $('#status'), list = $('#status-list');
    const n = { error: 0, warn: 0, info: 0 };
    issues.forEach(it => { if (n[it.level] != null) n[it.level]++; });
    const total = n.error + n.warn + n.info;
    btn.hidden = total === 0;
    if (!total) { setStatusOpen(false); list.innerHTML = ''; return; }
    const top = n.error ? 'error' : n.warn ? 'warn' : 'info';
    btn.className = 'status lvl-' + top;
    const parts = [];
    if (n.error) parts.push(plural(n.error, 'erro', 'erros'));
    if (n.warn) parts.push(plural(n.warn, 'aviso', 'avisos'));
    if (n.info) parts.push(plural(n.info, 'informação', 'informações'));
    btn.textContent = LVL[top].ico + ' ' + parts.join(' · ');
    list.innerHTML = '';
    [...issues].sort((a, b) => LVL[b.level].rank - LVL[a.level].rank).forEach(it => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'issue lvl-' + it.level;
      const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = LVL[it.level].ico;
      const tx = document.createElement('span'); tx.textContent = it.text;
      b.append(ico, tx);
      b.onclick = () => { setStatusOpen(false); focusIssue(it); };
      list.append(b);
    });
  }
  $('#status').onclick = () => setStatusOpen($('#status-list').hidden);
  document.addEventListener('click', ev => {
    if (!ev.target.closest('.viewbar')) setStatusOpen(false);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') setStatusOpen(false); });

  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }
  // antes de gerar um arquivo: sem modelo válido não há o que baixar
  function canDownload() {
    flushUpdate();
    if (!last) {
      toast('Não foi possível gerar o arquivo: ' + (lastFailure ? lastFailure.message : 'o modelo não foi calculado.'));
      return false;
    }
    return true;
  }
  // com avisos reais (das peças ou do plano), pede confirmação
  function confirmWarnings() {
    const warns = lastIssues.filter(it => it.level === 'warn');
    if (warns.length) {
      const lines = warns.slice(0, 5).map(it => '• ' + it.text).join('\n') + (warns.length > 5 ? `\n… e mais ${warns.length - 5}` : '');
      return confirm(`${plural(warns.length, 'aviso', 'avisos')} no projeto:\n\n${lines}\n\nBaixar mesmo assim?`);
    }
    return true;
  }

  // ---------- plano de corte ----------
  // a configuração que muda o plano (ignora o que é só da visualização 3D)
  function planKey() {
    const o = Object.assign({}, cfg);
    ['view', 'tab', 'explode', 'piecesOpen'].forEach(k => delete o[k]);
    return JSON.stringify(o);
  }
  const planCurrent = () => !!(plan && last && plan.key === planKey());
  const chapas = n => plural(n, 'chapa', 'chapas');

  // calcula em etapas (uma chapa por vez), devolvendo o controle à página entre elas
  function computePlan() {
    if (!last) return Promise.resolve(null);
    const key = planKey();
    if (planJob && planJob.key === key) return planJob.promise;
    const job = { key, cancelled: false };
    if (planJob) planJob.cancelled = true;
    planJob = job;
    const res = last.res, conf = JSON.parse(JSON.stringify(cfg));
    job.promise = new Promise(resolve => {
      const it = G.layoutSteps(res, conf);
      let progress = null;
      renderPlan({ busy: true });
      const step = () => {
        if (job.cancelled) { resolve(null); return; }
        const t0 = performance.now();
        let r;
        do { r = it.next(); if (!r.done) progress = r.value; } while (!r.done && performance.now() - t0 < 40);
        if (!r.done) { renderPlan({ busy: true, progress }); setTimeout(step, 0); return; }
        const lay = r.value;
        // veio: compara com o plano sem restrição (só com poucas peças, para não pesar)
        let grainNote = '';
        const anyGrain = conf.grain !== 'none' && PIECES.some(([k]) => conf.pieceGrain[k] !== 'none' && (k !== 'lid' || conf.lidEnabled));
        if (anyGrain && res.panels.length * lay.qty <= 36) {
          const nf = G.layout({ panels: res.panels }, Object.assign({}, conf, { grain: 'none' })).sheets.length;
          grainNote = `Veio: ${chapas(lay.sheets.length)} com as restrições; ${chapas(nf)} sem restrição de veio.`;
        }
        plan = { key, lay, grainNote };
        if (planJob === job) planJob = null;
        refreshIssues();
        renderPlan();
        resolve(plan);
      };
      setTimeout(step, 30); // deixa a página mostrar "calculando" antes de começar
    });
    return job.promise;
  }

  // A barra é montada uma vez e depois só tem textos atualizados: se o botão fosse recriado a cada
  // recálculo, o clique que tira o foco de um campo (e dispara o recálculo) se perderia no meio.
  let planUi = null, shownPlan = null, shownStale = null;
  function planBar() {
    if (planUi) return planUi;
    const bar = $('#plan-bar');
    const msg = document.createElement('div'); msg.className = 'msg';
    const strong = document.createElement('strong'), small = document.createElement('small');
    msg.append(strong, small);
    const pr = document.createElement('progress');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn small primary';
    btn.onclick = () => computePlan();
    bar.append(msg, pr, btn);
    planUi = { bar, msg, strong, small, pr, btn };
    return planUi;
  }
  // desenha as chapas só quando o plano mostrado (ou seu estado) muda
  function showSheets(lay, stale) {
    const prev = $('#preview');
    prev.className = stale ? 'stale' : '';
    if (shownPlan === lay && shownStale === stale) return;
    shownPlan = lay; shownStale = stale;
    if (lay) renderSheets(prev, lay, stale); else prev.innerHTML = '';
  }
  function renderPlan(state) {
    const st = state || {};
    const ui = planBar();
    ui.bar.classList.remove('stale', 'busy');
    ui.pr.hidden = true;
    ui.btn.hidden = true;
    ui.msg.hidden = false;
    if (!last) {
      ui.msg.hidden = true;
      shownPlan = null; shownStale = null;
      const prev = $('#preview');
      prev.className = '';
      prev.innerHTML = '<div class="empty">Não há peças para mostrar: corrija o erro indicado.</div>';
      return;
    }
    if (st.busy) {
      ui.bar.classList.add('busy');
      const p = st.progress;
      ui.strong.textContent = 'Calculando plano de corte…';
      ui.small.textContent = p ? `${p.placed} de ${p.pieces} peças posicionadas · passada ${p.pass} de ${p.passes}` : 'Preparando…';
      ui.pr.hidden = false;
      if (p) { ui.pr.max = p.pieces * p.passes; ui.pr.value = (p.pass - 1) * p.pieces + p.placed; }
      else ui.pr.removeAttribute('value');
      if (plan) showSheets(plan.lay, true);
      return;
    }
    if (planCurrent()) {
      const lay = plan.lay;
      const q = lay.qty > 1 ? ` · ${lay.qty} caixas` : '';
      ui.strong.textContent = `${chapas(lay.sheets.length)} de ${cfg.sheetW} × ${cfg.sheetH} mm${q}`;
      ui.small.textContent = plan.grainNote || 'Plano em dia com a configuração.';
      showSheets(lay, false);
      return;
    }
    ui.bar.classList.add('stale');
    ui.strong.textContent = plan ? 'Plano desatualizado' : 'Plano de corte ainda não calculado';
    ui.small.textContent = plan ? 'A configuração mudou depois do último cálculo.' : 'Ele também é calculado ao baixar o SVG ou o DXF.';
    ui.btn.textContent = plan ? 'Recalcular plano' : 'Calcular plano de corte';
    ui.btn.hidden = false;
    showSheets(plan ? plan.lay : null, true);
  }

  // ---------- chapas ----------
  function renderSheets(box, lay, stale) {
    box.innerHTML = '';
    const n = lay.sheets.length;
    lay.sheets.forEach((sh, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'sheet';
      const head = document.createElement('div');
      head.className = 'sheet-head';
      const title = document.createElement('span');
      const names = sh.items.map(it => it.label + (it.rotated ? ' (girada)' : '')).join(', ');
      title.innerHTML = `<strong>Chapa ${i + 1} de ${n}</strong> · ${sh.items.length} ${sh.items.length === 1 ? 'peça' : 'peças'} · aproveitamento ${(sh.usage * 100).toFixed(0)}%<br><small></small>`;
      title.querySelector('small').textContent = names;
      const btns = document.createElement('span');
      btns.className = 'sheet-btns';
      for (const fmt of ['svg', 'dxf']) {
        const b = document.createElement('button');
        b.className = 'btn small primary';
        b.textContent = fmt.toUpperCase();
        b.onclick = () => downloadSheet(i, fmt);
        b.disabled = !!stale;
        btns.append(b);
      }
      head.append(title, btns);
      const svg = document.createElement('div');
      svg.className = 'sheet-svg';
      svg.innerHTML = G.toSVG(sh, { preview: true });
      wrap.append(head, svg);
      box.append(wrap);
    });
  }

  // ---------- arquivos ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const baseName = () => `caixa_${cfg.W}x${cfg.D}x${cfg.H}_${cfg.t}mm`;

  // garante o plano em dia; se precisar calcular, avisa (o cálculo pode levar alguns segundos)
  async function ensurePlan() {
    if (planCurrent()) return plan;
    toast('Calculando plano de corte…');
    const p = await computePlan();
    if (!p || !planCurrent()) { toast('O plano não ficou pronto: a configuração mudou durante o cálculo. Tente de novo.'); return null; }
    toast(`Plano calculado: ${chapas(p.lay.sheets.length)}.`);
    return p;
  }
  function downloadSheet(i, fmt) {
    if (!canDownload() || !planCurrent() || !confirmWarnings()) return;
    const sheets = plan.lay.sheets;
    const name = baseName() + (sheets.length > 1 ? '_chapa' + (i + 1) : '') + '.' + fmt;
    if (fmt === 'svg') download(name, G.toSVG(sheets[i]), 'image/svg+xml');
    else download(name, G.toDXF(sheets[i]), 'application/dxf');
  }
  // um único arquivo com todas as chapas, empiladas na vertical e com o contorno de cada
  // chapa em azul (camada CHAPA no DXF), só de referência, não é linha de corte.
  async function downloadCombined(fmt) {
    if (!canDownload()) return;
    const p = await ensurePlan();
    if (!p || !confirmWarnings()) return;
    const combo = G.combineSheets(p.lay.sheets, Math.max(20, +cfg.margin * 4 || 20));
    const n = p.lay.sheets.length;
    const name = baseName() + (n > 1 ? `_${n}chapas` : '') + '.' + fmt;
    if (fmt === 'svg') download(name, G.toSVG(combo), 'image/svg+xml');
    else download(name, G.toDXF(combo), 'application/dxf');
  }
  $('#dl-svg').onclick = () => downloadCombined('svg');
  $('#dl-dxf').onclick = () => downloadCombined('dxf');
  // quantidade de caixas (plano e CSV): inteiro de 1 a 999 (o campo é corrigido na tela)
  function clampQty() {
    const el = $('#csv-qty');
    const q = Math.min(999, Math.max(1, Math.round(+el.value || cfg.qty || 1)));
    el.value = q;
    if (cfg.qty !== q) { cfg.qty = q; update(); }
    return q;
  }
  $('#csv-qty').addEventListener('change', clampQty);
  $('#dl-csv').onclick = () => {
    if (!canDownload()) return;
    const qty = clampQty();
    download(baseName() + '_cutlist.csv', G.toCSV(last.res, cfg, qty), 'text/csv');
  };
  $('#save-json').onclick = () => download(baseName() + '.json', JSON.stringify(cfg, null, 2), 'application/json');
  $('#load-json').onclick = () => $('#file-json').click();
  $('#file-json').onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try { cfg = normalize(JSON.parse(r.result)); bindStatic(); renderFaces(); showTab(cfg.tab); update(); }
      catch (e) { alert('Arquivo inválido: ' + e.message); }
    };
    r.readAsText(file);
    ev.target.value = '';
  };
  function resetAll() {
    if (!confirm('Restaurar TODOS os valores padrão? Os valores atuais serão perdidos.')) return;
    try { localStorage.removeItem(STORE); } catch (e) { /* ignora */ }
    cfg = normalize(null); bindStatic(); renderFaces(); showTab(cfg.tab); update();
  }
  $('#reset').onclick = resetAll;
  $('#reset2').onclick = resetAll;

  // A roda do mouse sobre um campo numérico focado altera o valor e trava a rolagem da página.
  // Tira o foco do campo para a rolagem seguir normalmente (vale também para campos criados depois).
  document.addEventListener('wheel', ev => {
    const el = document.activeElement;
    if (el && el.type === 'number' && ev.target === el) el.blur();
  }, { passive: true });
  // em tela estreita (celular) o painel de peças cobriria quase todo o 3D: começa recolhido
  if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) cfg.piecesOpen = false;
  bindStatic();
  bindDivs();
  renderFaces();
  initHelp();
  showTab(cfg.tab);
  render();
})();
