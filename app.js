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
      bottomMode: 'wallTabs', lidEnabled: true, lidPos: 'outer', lidTeeth: true, lidClearance: 0, lidFitSame: false, lidFit: -0.1, piecesOpen: true,
      sheetW: 1000, sheetH: 800, gap: 0, margin: 5, grain: 'none', optMode: 'balanced', optTime: 15, showLeftover: true, minLeftover: 50,
      cutList: [], editing: null, sheetZoom: 'fit', drawerOpen: false,
      faces: defaultFaces(),
      tab: '3d',
      pieceGrain: defaultGrain(),
      explode: 100,
      view: defaultView(),
    };
  }

  // ---------- caixa x trabalho de corte ----------
  // O que pertence ao trabalho de corte (vale para a lista toda) ou só à tela; o resto é da caixa e vai
  // junto quando ela entra na lista.
  const JOB_KEYS = ['sheetW', 'sheetH', 'gap', 'margin', 'grain', 'optMode', 'optTime', 'showLeftover', 'minLeftover', 'cutList', 'editing', 'sheetZoom', 'drawerOpen'];
  const VIEW_KEYS = ['view', 'tab', 'explode', 'piecesOpen'];
  const NOT_BOX = new Set(JOB_KEYS.concat(VIEW_KEYS, ['qty']));
  // cópia só com as chaves da caixa
  function boxOf(c) {
    const b = {};
    for (const k of Object.keys(c)) if (!NOT_BOX.has(k)) b[k] = c[k];
    return JSON.parse(JSON.stringify(b));
  }
  const boxKey = b => JSON.stringify(b);
  let uidSeq = 0;
  const uid = () => 'c' + Date.now().toString(36) + (uidSeq++).toString(36);
  // nome sugerido: medidas da caixa (a espessura aparece no grupo de chapas e na linha da lista)
  const boxName = b => `${+b.W}×${+b.D}×${+b.H}`;
  // "Excluir" de cada linha da lista: { peça: n } = unidades da peça que ficam fora do plano (já produzidas ou
  // adiadas). A quantidade a cortar da peça é a da linha menos isso (mínimo 0).
  function cleanExcl(x) {
    const o = {};
    if (x && typeof x === 'object') for (const [k] of PIECES) { const n = Math.min(999, Math.max(0, Math.round(+x[k] || 0))); if (n > 0) o[k] = n; }
    return o;
  }
  const leftOf = (e, name) => Math.max(0, e.qty - ((e.excluir && e.excluir[name]) || 0));

  // Mescla com os padrões para aceitar projetos antigos ou incompletos.
  function normalize(src, asBox) {
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
    if (asBox) return c;
    // lista de corte: cada caixa é normalizada como um projeto (aceita caixas salvas por versões antigas)
    const list = Array.isArray(src && src.cutList) ? src.cutList : [];
    c.cutList = list.filter(e => e && e.box).map(e => ({
      id: typeof e.id === 'string' && e.id ? e.id : uid(),
      name: String(e.name || boxName(e.box)).slice(0, 80),
      qty: Math.min(999, Math.max(0, Math.round(+e.qty || 0))),
      excluir: cleanExcl(e.excluir),
      box: boxOf(normalize(e.box, true)),
    }));
    // projetos antigos: "Caixas" (quantidade única) vira a lista com esta caixa
    if (src && !Array.isArray(src.cutList) && Math.round(+src.qty || 1) > 1) {
      const id = uid();
      c.cutList = [{ id, name: boxName(c), qty: Math.min(999, Math.round(+src.qty)), excluir: {}, box: boxOf(c) }];
      c.editing = id;
    }
    delete c.qty;
    if (!c.cutList.some(e => e.id === c.editing)) c.editing = null;
    const z = c.sheetZoom;
    c.sheetZoom = z === 'fit' || z === 'width' ? z : (isFinite(+z) && +z > 0 ? Math.min(400, Math.max(10, Math.round(+z))) : 'fit');
    c.drawerOpen = !!c.drawerOpen;
    if (!['fast', 'balanced', 'intensive'].includes(c.optMode)) c.optMode = 'balanced';
    c.optTime = Math.min(300, Math.max(2, Math.round(+c.optTime || 15)));
    c.showLeftover = c.showLeftover !== false;
    c.minLeftover = Math.min(2000, Math.max(0, isFinite(+c.minLeftover) && c.minLeftover !== '' && c.minLeftover != null ? +c.minLeftover : 50));
    c.tab = '3d'; // sempre abre na montagem 3D
    return c;
  }

  // ---------- ajuda ----------
  const HELP = {
    dims: `<strong>Medidas</strong><p>Externas: o comprimento, a largura e a altura informados são as do lado de fora da caixa montada.</p><p>Internas: a página soma as espessuras necessárias (2× em X e Y, e em Z soma a espessura do fundo e, se houver, da tampa) e usa isso como medida externa.</p>`,
    teeth: `<strong>Dentes de encaixe</strong><p>Cada eixo (arestas verticais, fundo e tampa, em X e Y) tem uma largura alvo em mm e um número de divisões. Editar um recalcula o outro.</p><p>Divisões é sempre ímpar: as duas pontas são cantos lisos, que absorvem a sobra da divisão, e o miolo tem dentes e intervalos exatamente do tamanho digitado.</p><p>O chanfro arredonda a ponta dos dentes e a boca dos rasgos, nos dois lados do encaixe, para facilitar a montagem.</p>`,
    lid: `<strong>Fundo e tampa</strong><p>Por fora cobre as paredes; por dentro fica entre elas. Com dentes, o encaixe usa os mesmos dentes da seção 3; sem dentes, a peça é lisa, só encostada.</p><p><em>Recuo da tampa</em>: desloca para dentro o retângulo-guia da tampa (a base dos dentes, ou o fundo dos rasgos quando a tampa é por fora): guia = medida − 2 × (espessura + recuo). O tamanho da tampa, na ponta dos dentes, não muda. Não pode ser negativo; 0 = sem recuo.</p><p><em>Ajuste da tampa</em>: diferença total de largura entre os dentes e os rasgos da junção da tampa, independente da interferência da seção 1. Fica dividida meio a meio: positivo = aperto (o dente cresce metade e o rasgo encolhe metade); zero = encaixe nominal; negativo = folga (o dente encolhe metade e o rasgo cresce metade). Padrão −0,1 mm (folga). Marque "Ajuste da tampa igual à interferência geral" para a tampa seguir o valor da seção 1.</p>`,
    holes: `<strong>Furos oblongos</strong><p>Cada parede tem seu próprio conjunto de furos. Na tampa e no fundo, cada um dos quatro lados (frente, trás, esquerda, direita) tem o seu.</p><p>Horizontal: distância a partir do centro do lado, positivo para a direita (vista de fora, ou de pé diante do lado). Vertical: distância da borda até a borda mais próxima do furo. O furo é sempre paralelo ao lado.</p><p>"Centralizar" calcula o deslocamento vertical que deixa o furo no meio da parede (altura) ou do lado da tampa/fundo.</p>`,
    sheet: `<strong>Chapa e organização</strong><p>O plano de corte organiza as peças em chapas do tamanho informado; o que não couber em uma vai para a próxima. Ele é calculado ao abrir a aba "Peças para corte", pelo botão "Calcular plano" e, se estiver desatualizado, ao baixar o SVG ou o DXF.</p><p>O modo de otimização e as opções das sobras ficam no botão "Otimização", acima das chapas.</p><p>Espaço entre peças: distância mínima entre os contornos já compensados (kerf e interferência). Com 0, as peças podem encostar, mas nunca se sobrepõem; as linhas coincidentes continuam sendo cortadas duas vezes (a fusão de linhas fica com o software da cortadora).</p><p>Lista de corte: "Adicionar ao corte", no topo, guarda uma cópia da caixa do painel. Na aba "Peças para corte", o botão "Lista de corte" abre a lista, onde cada caixa tem nome e quantidade (0 = guardada, fora do plano) e pode ser editada (carrega no painel), atualizada (grava o painel nela), duplicada ou removida. "Excluir peças do plano", em cada linha, tira unidades de uma peça (já produzidas ou adiadas) sem mudar a quantidade da caixa; o plano e o CSV usam só o que resta. Com a lista vazia, o plano usa a caixa do painel. Caixas de espessuras diferentes vão para chapas separadas, e o SVG, o DXF e o CSV saem um arquivo por espessura. As peças ganham o nome da caixa e o número da cópia.</p><p>Zoom: "Inteira" mostra a chapa toda na área visível; "Largura" ocupa a largura; o campo em % é relativo à largura.</p><p>Veio da chapa: direção do veio em relação à chapa. O veio de cada peça fica na seção 5.</p><p>"Baixar SVG" e "Baixar DXF", no topo, juntam todas as chapas em um arquivo só, empilhadas, cada uma com seu contorno em azul (só de referência, não é corte).</p>`,
    opt: `<strong>Otimização do plano</strong><p>Critério, em ordem: menos chapas; depois, a maior sobra retangular do trabalho (medida na geometria, sem a margem, que é descarte); depois, mais área em sobras aproveitáveis (com os dois lados de pelo menos o "menor lado de sobra aproveitável", padrão 50 mm), em menos pedaços; depois, sobras mais largas: um vão junto de uma faixa livre vale mais que o mesmo vão preso entre peças (conta a área onde cabe um quadrado de 2 e de 3 vezes o menor lado aproveitável); por fim, peças mais juntas, com a sobra numa região só.</p><p>Modos de otimização: <em>Rápida</em> testa poucas combinações e atualiza o plano enquanto você edita (com a aba aberta); <em>Equilibrada</em> (padrão) testa vários algoritmos (MaxRects, Guillotine, prateleiras, blocos de peças iguais), uma busca exata por menos chapas e uma busca curta, sempre com o mesmo resultado para o mesmo projeto; <em>Intensiva</em> continua buscando até o tempo máximo e mostra a melhor solução encontrada até ali. "Parar" encerra e fica com a melhor.</p><p>Menor lado de sobra aproveitável: sobras com algum lado menor que isso não contam (nem na classificação, nem no destaque da tela).</p>`,
    grain: `<strong>Veio das peças</strong><p>Se a chapa tiver veio (horizontal ou vertical), cada peça marcada com veio só gira 90° se isso mantiver seu eixo de veio paralelo ao da chapa. Peças sem veio marcado giram livremente.</p><p>u = horizontal e v = vertical, em relação à peça montada (nas paredes, v é a altura). O veio é da caixa: vai junto quando ela entra na lista de corte.</p>`,
    csv: `<strong>Lista de corte (CSV)</strong><p>Gera um arquivo com o tamanho de cada peça (sem furos nem dentes, que esse formato não representa), no formato do <a href="https://www.opticutter.com/cut-list-optimizer/import/csv" target="_blank" rel="noopener">Cutlist Optimizer</a> (opticutter.com).</p><p>Com a lista de corte vazia, o arquivo traz as peças da caixa do painel; com a lista, traz as peças de todas as caixas com quantidade, cada uma como um grupo, com a quantidade de cada caixa (um arquivo por espessura). A chapa e o veio da chapa informados na seção 6 já entram no arquivo.</p><p>O desenho detalhado de cada peça, com furos e dentes, continua saindo pelo SVG e pelo DXF.</p>`,
  };
  function initHelp() {
    const pop = $('#help-pop'), body = $('#help-pop-body');
    // fora do cabeçalho: lá dentro o z-index só vale no contexto do cabeçalho e a gaveta da lista ficaria por cima
    document.body.append(pop);
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
    $('#opt-wrap').hidden = tab !== '2d';
    if (tab !== '2d') setOptPop(false);
    $('#cut-drawer').hidden = !cfg.drawerOpen || tab !== '2d';
    if (tab === '2d') { applyZoom(); renderList(); }
    if (tab === '2d' && planPossible() && !planCurrent() && !(planJob && planJob.key === planKey())) computePlan(autoMode());
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
      last = { res, key: boxKey(boxOf(cfg)) };
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
    renderList();
    renderPlan();
    autoPlan();
  }
  // avisos do cálculo das peças + avisos do plano de corte (só se o plano estiver em dia)
  let buildIssues = [];
  function refreshIssues() {
    const extra = planCurrent() ? plan.lay.warnings : [];
    lastIssues = buildIssues.concat(listIssues, extra);
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
  function canDownload(fromPlan) {
    flushUpdate();
    if (fromPlan ? !planPossible() : !last) {
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
  // Modos: fast (Rápida), balanced (Equilibrada), intensive (Intensiva). O cálculo roda num Web Worker
  // (montado em Blob, funciona por file:// e offline); sem Worker, roda na página, em etapas.
  // Entrada: a lista de corte (cfg.cutList); vazia, usa a caixa do painel (1 unidade). Caixas de espessuras
  // diferentes não dividem chapa: cada espessura é um grupo, otimizado à parte.
  const MODE_RANK = { fast: 0, balanced: 1, intensive: 2 };
  const MODE_NAME = { fast: 'Rápida', balanced: 'Equilibrada', intensive: 'Intensiva' };
  const AUTO_FAST_MAX = 200; // peças: acima disso, a edição não recalcula sozinha (o Rápido já leva segundos)
  const PLAN_JOB_KEYS = ['sheetW', 'sheetH', 'gap', 'margin', 'grain', 'minLeftover'];

  // peças de cada caixa da lista, calculadas uma vez por configuração
  const buildCache = new Map();
  function buildBox(box) {
    const k = boxKey(box);
    if (last && last.key === k) return { res: last.res };
    let r = buildCache.get(k);
    if (!r) {
      try { r = { res: G.build(box) }; } catch (e) { r = { error: e.message }; }
      if (buildCache.size > 50) buildCache.clear();
      buildCache.set(k, r);
    }
    return r;
  }
  // caixas que entram no plano: [{ id, name, qty, box, res?, error? }]
  function planEntries() {
    if (!cfg.cutList.length) return last ? [{ id: null, name: boxName(cfg), qty: 1, box: boxOf(cfg), res: last.res }] : [];
    return cfg.cutList.filter(e => e.qty > 0).map(e => Object.assign({}, e, buildBox(e.box)))
      .filter(e => !e.res || e.res.panels.some(p => leftOf(e, p.name) > 0)); // linha com tudo excluído sai do plano
  }
  // linha que entra no plano: quantidade > 0 e alguma peça ainda a cortar
  function inPlan(e) {
    if (!(e.qty > 0)) return false;
    const r = buildBox(e.box).res;
    return !r || r.panels.some(p => leftOf(e, p.name) > 0);
  }
  // a configuração que muda o plano: chapa, distâncias, veio da chapa, menor sobra e as caixas
  function planKey() {
    const job = {};
    for (const k of PLAN_JOB_KEYS) job[k] = cfg[k];
    const entries = cfg.cutList.length ? cfg.cutList.filter(e => e.qty > 0).map(e => [e.name, e.qty, e.box, e.excluir]) : [boxOf(cfg)];
    return JSON.stringify({ job, entries });
  }
  // plano em dia; com minMode, também exige que tenha sido calculado num modo pelo menos tão bom
  const planCurrent = minMode => !!(plan && plan.key === planKey() && (!minMode || MODE_RANK[plan.mode] >= MODE_RANK[minMode]));
  const planPossible = () => (cfg.cutList.length ? planEntries().some(e => e.res) : !!last);
  // modo ao abrir a aba e ao baixar: o escolhido, mas a intensiva só roda quando pedida (botão)
  const autoMode = () => (cfg.optMode === 'intensive' ? 'balanced' : cfg.optMode);
  const chapas = n => plural(n, 'chapa', 'chapas');
  const m2 = a => (a / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
  const mm = r => `${Math.round(r.w)} × ${Math.round(r.h)} mm`;
  const tmm = t => `${(+t).toLocaleString('pt-BR')} mm`;
  // fase do cálculo, pelo id da estratégia em andamento
  const phaseOf = p => {
    const id = (p && p.strategy) || '';
    if (id === 'exata') return 'busca exata por menos chapas';
    if (id === 'busca') return 'busca iterativa' + (p.evals ? ` · ${p.evals.toLocaleString('pt-BR')} arranjos avaliados` : '');
    if (id === 'refine') return 'refinamento (compactação e redistribuição)';
    if (id.startsWith('legacy')) return 'algoritmo de referência';
    return id ? 'heurísticas de posicionamento' : 'preparando';
  };
  const secs = ms => (ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: ms < 10000 ? 1 : 0 }) + ' s';

  // Grupos por espessura, cada um com seu problema (planSetup). Caixas com erro ficam de fora (com aviso).
  let listIssues = [];
  function planGroups(conf) {
    const entries = planEntries();
    listIssues = entries.filter(e => e.error).map(e => ({ level: 'warn', text: `Lista de corte: "${e.name}" ficou fora do plano (${e.error})`, keys: [] }));
    const ok = entries.filter(e => e.res);
    const byT = new Map();
    for (const e of ok) {
      const t = +e.box.t;
      if (!byT.has(t)) byT.set(t, []);
      byT.get(t).push(e);
    }
    const groups = [...byT.entries()].sort((a, b) => b[0] - a[0]).map(([t, list]) => ({
      t, label: tmm(t), entries: list,
      setup: G.planSetup({ jobs: list.map(e => ({ res: e.res, qty: e.qty, excl: e.excluir, name: e.name, pieceGrain: e.box.pieceGrain || {} })) }, conf),
    }));
    // a intensiva divide o tempo entre os grupos
    if (groups.length > 1) groups.forEach(g => { g.setup.opts.timeLimit = Math.max(2, g.setup.opts.timeLimit / groups.length); });
    return groups;
  }

  // junta os planos dos grupos num só (chapas em sequência, cada uma sabe seu grupo)
  function combineGroups(groups, partial) {
    const sheets = [], warnings = [];
    let qty = 0, stopped = false;
    const done = groups.filter(g => g.lay || (partial && g === partial.group));
    done.forEach(g => {
      const lay = g.lay || partial.lay;
      lay.sheets.forEach((sh, k) => { sh.group = { t: g.t, label: g.label, k, n: lay.sheets.length, multi: groups.length > 1 }; sheets.push(sh); });
      warnings.push(...lay.warnings);
      qty += lay.qty;
      if (lay.stats && lay.stats.stopped) stopped = true;
    });
    const big = sheets.reduce((m, sh, i) => (sh.leftover && sh.leftover.big && (!m || sh.leftover.big.w * sh.leftover.big.h > m.w * m.h) ? Object.assign({ sheet: i }, sh.leftover.big) : m), null);
    return { sheets, warnings, qty, groups: done.map(g => ({ t: g.t, label: g.label, count: (g.lay || partial.lay).sheets.length })), stats: { big, stopped } };
  }

  let workerOk = true; // vira false se o Worker falhar: os cálculos seguintes rodam na página
  let planTimer = 0;
  function computePlan(mode) {
    if (!planPossible()) return Promise.resolve(null);
    const m = MODE_RANK[mode] != null ? mode : autoMode();
    const key = planKey();
    if (planJob && planJob.key === key && planJob.mode === m) return planJob.promise;
    if (planJob) cancelJob(planJob);
    const conf = JSON.parse(JSON.stringify(cfg));
    conf.optMode = m;
    let groups;
    try { groups = planGroups(conf); } catch (e) { toast('Não foi possível preparar o plano: ' + e.message); return Promise.resolve(null); }
    refreshIssues();
    if (!groups.length) return Promise.resolve(null);
    const job = { key, mode: m, conf, groups, gi: 0, t0: performance.now(), best: null, progress: null, cancelled: false, stopRequested: false };
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    planJob = job;
    clearInterval(planTimer);
    planTimer = setInterval(() => { if (planJob === job) renderPlan(); }, 250);
    renderPlan();
    setTimeout(() => runGroups(job), 30);
    return job.promise;
  }
  // um grupo de cada vez; "Parar" encerra o grupo atual com a melhor solução e calcula os restantes no Rápido
  async function runGroups(job) {
    for (let i = 0; i < job.groups.length; i++) {
      if (job.cancelled) return;
      const g = job.groups[i];
      job.gi = i; job.best = null; job.progress = null;
      let lay = await runGroup(job, g, job.stopRequested ? 'fast' : job.mode);
      if (job.cancelled) return;
      if (!lay && job.stopRequested) lay = await runGroup(job, g, 'fast'); // parado antes da primeira solução
      if (job.cancelled) return;
      if (!lay) { failJob(job, job.error || 'nenhuma solução'); return; }
      if (job.stopRequested && job.groups.length > 1) lay.stats.stopped = true;
      g.lay = lay;
    }
    finishJob(job);
  }
  function runGroup(job, g, mode) {
    return new Promise(resolve => {
      job.groupDone = lay => { job.groupDone = null; job.worker = null; resolve(lay); };
      const opts = Object.assign({}, g.setup.opts, { mode });
      if (workerOk) runInWorker(job, g, opts); else runInPage(job, g, opts);
    });
  }
  function endJob(job) {
    if (job.worker) { job.worker.terminate(); job.worker = null; }
    if (planJob === job) { planJob = null; clearInterval(planTimer); }
  }
  // outra configuração ou outro cálculo: descarta este
  function cancelJob(job) { job.cancelled = true; endJob(job); job.resolve(null); }
  // "Parar": fica com a melhor solução encontrada até aqui
  function stopJob(job) {
    job.stopRequested = true;
    if (job.worker) {
      job.worker.terminate(); job.worker = null;
      const lay = job.best; if (lay) lay.stats.stopped = true;
      if (job.groupDone) job.groupDone(lay);
    } // na página: o motor para na próxima etapa e devolve a melhor
  }
  // melhor solução parcial do grupo atual (exibição progressiva)
  function setBest(job, g, solution, strategy) {
    try { job.best = g.setup.materialize(solution, { strategy, mode: job.mode }); } catch (e) { /* ignora a parcial inválida */ }
  }
  function finishJob(job) {
    if (job.cancelled) return;
    endJob(job);
    const lay = combineGroups(job.groups);
    // veio: compara com o plano sem restrição (Rápida, só com poucas peças e um grupo, para não pesar)
    let grainNote = '';
    const conf = job.conf;
    const g0 = job.groups[0];
    const anyGrain = conf.grain !== 'none' && job.groups.some(g => g.entries.some(e => Object.values(e.box.pieceGrain || {}).some(v => v !== 'none')));
    const nPieces = job.groups.reduce((a, g) => a + g.setup.problem.items.length, 0);
    if (anyGrain && job.groups.length === 1 && nPieces <= 36) {
      try {
        const nf = G.layout({ jobs: g0.entries.map(e => ({ res: e.res, qty: e.qty, excl: e.excluir, name: e.name, pieceGrain: e.box.pieceGrain })) }, Object.assign({}, conf, { grain: 'none', optMode: 'fast' })).sheets.length;
        grainNote = `Veio: ${chapas(lay.sheets.length)} com as restrições; ${chapas(nf)} sem restrição de veio (cálculo rápido).`;
      } catch (e) { /* ignora */ }
    }
    plan = { key: job.key, lay, mode: job.mode, grainNote, elapsed: performance.now() - job.t0, stopped: !!lay.stats.stopped };
    refreshIssues();
    renderPlan();
    job.resolve(plan);
  }
  function failJob(job, message) {
    if (job.cancelled) return;
    endJob(job);
    toast('Plano de corte não calculado: ' + message);
    renderPlan();
    job.resolve(null);
  }

  function runInWorker(job, g, opts) {
    const w = window.BoxPack && window.BoxPack.plan.createWorker();
    if (!w) { workerOk = false; runInPage(job, g, opts); return; }
    job.worker = w;
    let heard = false;
    const done = lay => { if (job.groupDone) job.groupDone(lay); };
    w.onmessage = ev => {
      heard = true;
      if (job.cancelled || job.worker !== w) return;
      const d = ev.data;
      if (d.progress) job.progress = d.progress;
      if (d.type === 'best') setBest(job, g, d.solution, d.strategy);
      else if (d.type === 'done') {
        w.terminate();
        let lay = job.best;
        try { if (d.solution) lay = g.setup.materialize(d.solution, { strategy: d.strategy, candidates: d.candidates, mode: d.mode }); } catch (e) { /* fica a parcial */ }
        done(lay);
      } else if (d.type === 'error') { w.terminate(); job.error = d.message; done(null); }
    };
    w.onerror = ev => {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (job.cancelled || job.worker !== w) return;
      w.terminate(); job.worker = null;
      // o Worker não chegou a funcionar (navegador, política de segurança): calcula na página
      if (!heard) { workerOk = false; runInPage(job, g, opts); } else { job.error = (ev && ev.message) || 'erro no cálculo'; done(null); }
    };
    w.postMessage({ problem: g.setup.liteProblem, opts });
  }

  function runInPage(job, g, opts) {
    const BP = window.BoxPack;
    const done = lay => { if (job.groupDone) job.groupDone(lay); };
    let it;
    try { it = BP.plan.steps(g.setup.problem, Object.assign({}, opts, { shouldStop: () => job.stopRequested })); }
    catch (e) { job.error = e.message; done(null); return; }
    const step = () => {
      if (job.cancelled) return;
      const t0 = performance.now();
      let r;
      try {
        do {
          r = it.next();
          if (!r.done) {
            job.progress = BP.plan.progressOf(r.value);
            if (r.value.improved && r.value.best) setBest(job, g, r.value.best.solution, r.value.best.strategy);
          }
        } while (!r.done && performance.now() - t0 < 40);
      } catch (e) { job.error = e.message; done(null); return; }
      if (!r.done) { setTimeout(step, 0); return; }
      const out = r.value;
      if (!out.best) { job.error = 'nenhuma solução válida'; done(null); return; }
      let lay = null;
      try { lay = g.setup.materialize(out.best.solution, { strategy: out.best.strategy, candidates: out.report.length, mode: out.mode, stopped: out.stopped }); }
      catch (e) { job.error = e.message; }
      done(lay);
    };
    step();
  }

  // A barra é montada uma vez e depois só tem textos atualizados: se o botão fosse recriado a cada
  // recálculo, o clique que tira o foco de um campo (e dispara o recálculo) se perderia no meio.
  let planUi = null, shownPlan = null, shownStale = null, shownLeft = null;
  function planBar() {
    if (planUi) return planUi;
    const bar = $('#plan-bar');
    const msg = document.createElement('div'); msg.className = 'msg';
    const strong = document.createElement('strong'), small = document.createElement('small');
    msg.append(strong, small);
    const pr = document.createElement('progress');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn small primary';
    btn.onclick = () => computePlan(btn.dataset.mode);
    const stop = document.createElement('button');
    stop.type = 'button'; stop.className = 'btn small';
    stop.textContent = 'Parar';
    stop.title = 'Encerra o cálculo e fica com a melhor solução encontrada até aqui';
    stop.onclick = () => { if (planJob) stopJob(planJob); };
    bar.append(msg, pr, btn, stop);
    planUi = { bar, msg, strong, small, pr, btn, stop };
    return planUi;
  }
  // desenha as chapas só quando o plano mostrado (ou seu estado) muda
  function showSheets(lay, stale) {
    const prev = $('#preview');
    prev.className = stale ? 'stale' : '';
    const left = !!cfg.showLeftover;
    if (shownPlan === lay && shownStale === stale && shownLeft === left) return;
    shownPlan = lay; shownStale = stale; shownLeft = left;
    if (lay) renderSheets(prev, lay, stale); else prev.innerHTML = '';
  }
  // resumo do plano: aproveitamento, material restante, maior sobra do trabalho
  function planSummary(lay) {
    let used = 0, total = 0;
    lay.sheets.forEach(sh => { used += sh.usage * sh.width * sh.height; total += sh.width * sh.height; });
    const parts = [];
    if (lay.groups.length > 1) parts.push(lay.groups.map(g => `${g.label}: ${chapas(g.count)}`).join(', '));
    parts.push(`aproveitamento ${(100 * used / total).toFixed(0)}%`, `material restante ${m2(total - used)}`);
    const big = lay.stats && lay.stats.big;
    if (big) parts.push(`maior sobra ${mm(big)} (${m2(big.w * big.h)}, chapa ${big.sheet + 1})`);
    return parts.join(' · ');
  }
  const caixas = n => plural(n, 'caixa', 'caixas');
  function renderPlan() {
    const ui = planBar();
    renderListChip();
    renderOptBtn();
    ui.bar.classList.remove('stale', 'busy');
    ui.pr.hidden = true;
    ui.btn.hidden = true;
    ui.stop.hidden = true;
    ui.msg.hidden = false;
    if (!planPossible()) {
      ui.msg.hidden = true;
      shownPlan = null; shownStale = null;
      const prev = $('#preview');
      prev.className = '';
      prev.innerHTML = cfg.cutList.length && !cfg.cutList.some(inPlan)
        ? '<div class="empty">Não há nada a cortar: todas as caixas da lista estão com quantidade 0 ou com todas as peças excluídas.</div>'
        : '<div class="empty">Não há peças para mostrar: corrija o erro indicado.</div>';
      return;
    }
    const job = planJob;
    if (job) {
      ui.bar.classList.add('busy');
      const p = job.progress, el = performance.now() - job.t0;
      const part = job.best ? combineGroups(job.groups, { group: job.groups[job.gi], lay: job.best }) : null;
      const bestTxt = part ? ` · melhor até agora: ${chapas(part.sheets.length)}${part.stats.big ? ', maior sobra ' + mm(part.stats.big) : ''}` : '';
      const grp = job.groups.length > 1 ? ` · ${job.groups[job.gi].label} (${job.gi + 1} de ${job.groups.length})` : '';
      ui.pr.hidden = false;
      ui.stop.hidden = false;
      if (job.mode === 'intensive') {
        const lim = job.groups.reduce((a, g) => a + g.setup.opts.timeLimit, 0) * 1000;
        ui.strong.textContent = `Busca intensiva… ${secs(el)} de ${secs(lim)}${grp}`;
        ui.small.textContent = phaseOf(p) + bestTxt;
        ui.pr.max = lim; ui.pr.value = Math.min(el, lim);
      } else {
        ui.strong.textContent = `Calculando plano de corte (${MODE_NAME[job.mode]})… ${secs(el)}${grp}`;
        ui.small.textContent = (p ? `etapa ${p.pass} de ${p.passes}: ${phaseOf(p)}` : 'preparando') + bestTxt;
        if (p) { ui.pr.max = p.passes; ui.pr.value = p.pass; } else ui.pr.removeAttribute('value');
      }
      // mostra a melhor parcial (troca no máximo a cada meio segundo, para não pesar), senão o plano anterior
      const t = performance.now();
      if (part && job.best !== job.shownBestRaw && (!job.shownAt || t - job.shownAt > 500)) { job.shownBestRaw = job.best; job.shownBest = part; job.shownAt = t; }
      if (job.shownBest) showSheets(job.shownBest, false);
      else if (plan) showSheets(plan.lay, true);
      return;
    }
    if (planCurrent()) {
      const lay = plan.lay;
      const q = lay.qty > 1 ? ` · ${caixas(lay.qty)}` : '';
      ui.strong.textContent = `${chapas(lay.sheets.length)} de ${cfg.sheetW} × ${cfg.sheetH} mm${q}`;
      const how = `${MODE_NAME[plan.mode]}${plan.stopped ? ', interrompida' : ''}, ${secs(plan.elapsed)}`;
      ui.small.textContent = planSummary(lay) + ` · ${how}` + (plan.grainNote ? ' · ' + plan.grainNote : '');
      // próximo passo de otimização, se houver
      const next = plan.mode === 'fast' ? (cfg.optMode === 'fast' ? null : 'balanced')
        : (plan.mode === 'balanced' || plan.stopped) ? 'intensive' : null;
      if (next) {
        ui.btn.dataset.mode = next;
        ui.btn.textContent = next === 'balanced' ? 'Otimizar (equilibrada)' : `Busca intensiva (${cfg.optTime} s)`;
        ui.btn.hidden = false;
      }
      showSheets(lay, false);
      return;
    }
    ui.bar.classList.add('stale');
    ui.strong.textContent = plan ? 'Plano desatualizado' : 'Plano de corte ainda não calculado';
    ui.small.textContent = plan ? 'A configuração ou a lista de corte mudou depois do último cálculo.' : 'Ele também é calculado ao baixar o SVG ou o DXF.';
    ui.btn.dataset.mode = cfg.optMode;
    ui.btn.textContent = (plan ? 'Recalcular plano' : 'Calcular plano de corte') + (cfg.optMode === 'balanced' ? '' : ` (${MODE_NAME[cfg.optMode].toLowerCase()})`);
    ui.btn.hidden = false;
    showSheets(plan ? plan.lay : null, true);
  }
  // durante a edição, com a aba aberta: recalcula no modo Rápido (só com poucas peças)
  function autoPlan() {
    if (cfg.tab !== '2d' || !planPossible() || planCurrent()) return;
    if (planJob && planJob.key === planKey()) return; // já há um cálculo desta configuração (ex.: intensiva)
    const n = planEntries().reduce((a, e) => a + (e.res ? e.res.panels.reduce((s, p) => s + leftOf(e, p.name), 0) : 0), 0);
    if (n <= AUTO_FAST_MAX) computePlan('fast');
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
      const big = sh.leftover && sh.leftover.big;
      const left = sh.oversize ? ' · chapa ampliada (peça maior que a chapa)' : big ? ` · maior sobra ${mm(big)} (${m2(big.w * big.h)})` : ' · sem sobra retangular';
      const g = sh.group;
      const which = g && g.multi ? `${g.label} · chapa ${g.k + 1} de ${g.n}` : `Chapa ${i + 1} de ${n}`;
      title.innerHTML = `<strong>${which}</strong> · ${sh.items.length} ${sh.items.length === 1 ? 'peça' : 'peças'} · aproveitamento ${(sh.usage * 100).toFixed(0)}%${left}<br><small></small>`;
      title.querySelector('small').textContent = names;
      const btns = document.createElement('span');
      btns.className = 'sheet-btns';
      for (const fmt of ['svg', 'dxf']) {
        const b = document.createElement('button');
        b.className = 'btn small primary';
        b.textContent = fmt.toUpperCase();
        b.onclick = () => downloadSheet(i, fmt);
        b.disabled = !!stale || !planCurrent() || plan.lay !== lay;
        btns.append(b);
      }
      head.append(title, btns);
      const svg = document.createElement('div');
      svg.className = 'sheet-svg';
      svg.innerHTML = G.toSVG(sh, { preview: true, leftover: !!cfg.showLeftover });
      wrap.append(head, svg);
      box.append(wrap);
    });
    applyZoom();
  }

  // ---------- zoom das chapas ----------
  // 'fit' = a chapa inteira na área visível; 'width' = largura da área; número = % da largura da área
  function zoomBase() {
    const pane = $('#pane2d'), prev = $('#preview');
    const cw = Math.max(100, prev.clientWidth - 14); // descontado o recuo interno da chapa
    const tools = $('#plan-tools');
    const head = prev.querySelector('.sheet-head');
    const ch = pane.clientHeight - (tools ? tools.offsetHeight : 0) - (head ? head.offsetHeight + 8 : 50) - 30;
    return { cw, ch: Math.max(120, ch) };
  }
  function applyZoom() {
    const { cw, ch } = zoomBase();
    let shown = null;
    document.querySelectorAll('#preview .sheet-svg svg').forEach(svg => {
      const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      const ar = vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : 1.25;
      let w;
      if (cfg.sheetZoom === 'width') w = cw;
      else if (cfg.sheetZoom === 'fit') w = Math.min(cw, ch * ar);
      else w = cw * cfg.sheetZoom / 100;
      svg.style.width = Math.round(w) + 'px';
      svg.style.height = 'auto';
      if (shown == null) shown = Math.round(100 * w / cw);
    });
    const z = $('#zoom-pct');
    if (z && document.activeElement !== z) z.value = shown != null ? shown : (typeof cfg.sheetZoom === 'number' ? cfg.sheetZoom : 100);
    document.querySelectorAll('[data-zoom]').forEach(b => b.classList.toggle('on', b.dataset.zoom === cfg.sheetZoom));
  }
  function setZoom(z) {
    cfg.sheetZoom = z;
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
    applyZoom();
  }
  function initZoom() {
    document.querySelectorAll('[data-zoom]').forEach(b => { b.onclick = () => setZoom(b.dataset.zoom); });
    const pct = $('#zoom-pct');
    const cur = () => Math.round(+pct.value || 100);
    pct.onchange = () => setZoom(Math.min(400, Math.max(10, cur())));
    $('#zoom-out').onclick = () => setZoom(Math.max(10, cur() - 10));
    $('#zoom-in').onclick = () => setZoom(Math.min(400, cur() + 10));
    window.addEventListener('resize', () => { if (cfg.tab === '2d') applyZoom(); });
  }

  // ---------- otimização (botão na barra da visualização) ----------
  function setOptPop(open) {
    const pop = $('#opt-pop'), btn = $('#opt-btn');
    if (!pop) return;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function renderOptBtn() {
    const btn = $('#opt-btn');
    if (btn) btn.textContent = `Otimização: ${MODE_NAME[cfg.optMode]}` + (cfg.optMode === 'intensive' ? ` (${cfg.optTime} s)` : '');
  }
  function initOpt() {
    $('#opt-btn').onclick = ev => { ev.stopPropagation(); setOptPop($('#opt-pop').hidden); };
    document.addEventListener('click', ev => { if (!$('#opt-pop').hidden && !ev.target.closest('#opt-wrap') && !ev.target.closest('#help-pop')) setOptPop(false); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') setOptPop(false); });
  }

  // ---------- lista de corte ----------
  // Cada caixa da lista é uma cópia da caixa do painel no momento em que foi adicionada (ou atualizada).
  // "Editar" carrega a caixa no painel; "Atualizar" grava o painel de volta na caixa.
  const unidades = n => plural(n, 'unidade', 'unidades');
  const panelKey = () => boxKey(boxOf(cfg));
  const editingEntry = () => cfg.cutList.find(e => e.id === cfg.editing) || null;
  const panelInList = () => cfg.cutList.some(e => boxKey(e.box) === panelKey());
  function listChanged() {
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
    renderList();
    update();
  }
  function uniqueName(name) {
    const names = new Set(cfg.cutList.map(e => e.name));
    if (!names.has(name)) return name;
    let k = 2;
    while (names.has(`${name} (${k})`)) k++;
    return `${name} (${k})`;
  }
  function addToList() {
    flushUpdate();
    if (!last) { toast('A caixa do painel tem erro: corrija antes de adicionar ao corte.'); return; }
    const e = { id: uid(), name: uniqueName(boxName(cfg)), qty: 1, excluir: {}, box: boxOf(cfg) };
    cfg.cutList.push(e);
    cfg.editing = e.id;
    toast(`"${e.name}" adicionada à lista de corte (${plural(cfg.cutList.length, 'caixa', 'caixas')}).`);
    listChanged();
  }
  function editEntry(e) {
    const ed = editingEntry();
    const dirty = ed ? boxKey(ed.box) !== panelKey() : (cfg.cutList.length && !panelInList());
    if (dirty && !confirm(ed
      ? `A caixa do painel tem alterações que não foram gravadas em "${ed.name}". Carregar "${e.name}" e descartá-las?`
      : `A caixa do painel não está na lista de corte. Carregar "${e.name}" e descartá-la?`)) return;
    Object.assign(cfg, JSON.parse(JSON.stringify(e.box)));
    cfg.editing = e.id;
    bindStatic(); renderFaces();
    listChanged();
  }
  function updateEntry(e) {
    flushUpdate();
    if (!last) { toast('A caixa do painel tem erro: corrija antes de atualizar.'); return; }
    e.box = boxOf(cfg);
    toast(`"${e.name}" atualizada com a caixa do painel.`);
    listChanged();
  }
  function duplicateEntry(e) {
    const c = { id: uid(), name: uniqueName(e.name), qty: e.qty, excluir: Object.assign({}, e.excluir), box: JSON.parse(JSON.stringify(e.box)) };
    cfg.cutList.splice(cfg.cutList.indexOf(e) + 1, 0, c);
    listChanged();
  }
  function removeEntry(e) {
    if (!confirm(`Remover "${e.name}" da lista de corte?`)) return;
    cfg.cutList.splice(cfg.cutList.indexOf(e), 1);
    if (cfg.editing === e.id) cfg.editing = null;
    listChanged();
  }
  // resumo na barra de ferramentas das chapas (abre a gaveta)
  function renderListChip() {
    const chip = $('#list-chip');
    if (!chip) return;
    const active = cfg.cutList.filter(inPlan);
    const units = active.reduce((a, e) => a + e.qty, 0);
    chip.textContent = cfg.cutList.length
      ? `Lista de corte: ${caixas(cfg.cutList.length)}${active.length < cfg.cutList.length ? ` (${active.length} no plano)` : ''} · ${unidades(units)}`
      : 'Lista de corte: vazia (usa a caixa do painel)';
    chip.setAttribute('aria-expanded', cfg.drawerOpen ? 'true' : 'false');
    const ed = editingEntry();
    chip.classList.toggle('warn', !!(cfg.cutList.length && (ed ? boxKey(ed.box) !== panelKey() : !panelInList())));
  }
  function setDrawer(open) {
    cfg.drawerOpen = !!open;
    $('#cut-drawer').hidden = !cfg.drawerOpen || cfg.tab !== '2d';
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignora */ }
    renderList();
  }
  // "Excluir" por peça: quantas unidades de cada peça da linha ficam fora do plano (já produzidas ou adiadas)
  const exclOpen = new Set(); // linhas com o bloco aberto (a lista é redesenhada a cada mudança)
  function exclBlock(e) {
    const res = buildBox(e.box).res;
    const det = document.createElement('details');
    det.className = 'cut-excl';
    if (!res) return document.createDocumentFragment(); // caixa com erro: sem peças para listar
    const cut = res.panels.reduce((a, p) => a + leftOf(e, p.name), 0), total = res.panels.length * e.qty;
    const sum = document.createElement('summary');
    sum.textContent = cut === total ? 'Excluir peças do plano' : `Excluir peças do plano · ${cut} de ${total} a cortar`;
    sum.title = 'Tira da lista peças que já foram produzidas ou que não serão produzidas agora (por exemplo, uma tampa a menos)';
    det.append(sum);
    det.open = exclOpen.has(e.id);
    det.ontoggle = () => { if (det.open) exclOpen.add(e.id); else exclOpen.delete(e.id); };
    res.panels.forEach(p => {
      const line = document.createElement('div');
      line.className = 'cut-excl-row';
      const lab = document.createElement('span'); lab.textContent = p.label;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = e.qty; inp.step = 1;
      inp.value = Math.min(e.qty, (e.excluir && e.excluir[p.name]) || 0);
      inp.title = `Unidades de "${p.label}" que não entram no plano (de ${e.qty})`;
      inp.disabled = e.qty <= 0;
      inp.onchange = () => {
        const n = Math.min(e.qty, Math.max(0, Math.round(+inp.value || 0)));
        e.excluir = Object.assign({}, e.excluir);
        if (n > 0) e.excluir[p.name] = n; else delete e.excluir[p.name];
        listChanged();
      };
      const rest = document.createElement('small');
      rest.textContent = `a cortar: ${leftOf(e, p.name)}`;
      line.append(lab, inp, rest);
      det.append(line);
    });
    if (e.excluir && Object.keys(e.excluir).length) {
      const z = document.createElement('button');
      z.type = 'button'; z.className = 'btn small'; z.textContent = 'Zerar exclusões';
      z.onclick = () => { e.excluir = {}; listChanged(); };
      det.append(z);
    }
    return det;
  }
  function renderList() {
    renderListChip();
    const dr = $('#cut-drawer');
    if (!dr || dr.hidden) return;
    // logo abaixo da barra de ferramentas das chapas (o zoom continua visível)
    const tools = $('#plan-tools'), view = $('#view');
    if (tools && view) dr.style.top = Math.round(tools.getBoundingClientRect().bottom - view.getBoundingClientRect().top + 4) + 'px';
    const body = $('#cut-list');
    body.innerHTML = '';
    const pk = panelKey();
    const ed = editingEntry();
    // aviso sobre a caixa do painel
    const note = $('#cut-note');
    note.hidden = true;
    if (!cfg.cutList.length) {
      note.hidden = false;
      note.innerHTML = 'A lista está vazia: o plano usa a caixa do painel (1 unidade). Use <strong>Adicionar ao corte</strong> para montar a lista.';
    } else if (ed && boxKey(ed.box) !== pk) {
      note.hidden = false;
      note.textContent = `A caixa do painel tem alterações que não estão em "${ed.name}": use Atualizar para gravá-las (o plano usa a versão da lista).`;
    } else if (!ed && !cfg.cutList.some(e => boxKey(e.box) === pk)) {
      note.hidden = false;
      note.textContent = 'A caixa do painel não está na lista: mudanças no painel não entram no plano. Use Adicionar ao corte para incluí-la.';
    }
    cfg.cutList.forEach(e => {
      const row = document.createElement('div');
      const isEd = e.id === cfg.editing;
      const modified = isEd && boxKey(e.box) !== pk;
      row.className = 'cut-row' + (inPlan(e) ? '' : ' off') + (isEd ? ' editing' : '');
      const name = document.createElement('input');
      name.type = 'text'; name.value = e.name; name.className = 'cut-name'; name.maxLength = 80;
      name.title = 'Nome da caixa (aparece nas peças do plano)';
      name.onchange = () => { const v = name.value.trim(); e.name = v || boxName(e.box); listChanged(); };
      const qty = document.createElement('input');
      qty.type = 'number'; qty.min = 0; qty.max = 999; qty.step = 1; qty.value = e.qty; qty.className = 'cut-qty';
      qty.title = 'Quantidade (0 = fica guardada na lista, fora do plano)';
      qty.onchange = () => { e.qty = Math.min(999, Math.max(0, Math.round(+qty.value || 0))); qty.value = e.qty; listChanged(); };
      const info = document.createElement('small');
      const b = e.box;
      info.textContent = `${b.dimMode === 'inner' ? 'internas' : 'externas'} · ${tmm(b.t)}` + (isEd ? (modified ? ' · no painel, modificada' : ' · no painel') : '');
      if (modified) info.className = 'mod';
      const btns = document.createElement('span');
      btns.className = 'cut-btns';
      const mk = (txt, title, fn, dis) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn small'; x.textContent = txt; x.title = title; x.disabled = !!dis; x.onclick = () => fn(e); btns.append(x); };
      mk('Editar', 'Carrega esta caixa no painel', editEntry, isEd && !modified);
      mk('Atualizar', 'Grava a caixa do painel nesta linha', updateEntry, !modified);
      mk('Duplicar', 'Cria uma cópia desta caixa na lista', duplicateEntry);
      mk('Remover', 'Tira esta caixa da lista', removeEntry);
      const top = document.createElement('div'); top.className = 'cut-top';
      const ql = document.createElement('label'); ql.className = 'cut-ql'; ql.append('Qtd', qty);
      top.append(name, ql);
      row.append(top, info, exclBlock(e), btns);
      body.append(row);
    });
  }
  function initList() {
    $('#add-cut').onclick = addToList;
    $('#list-chip').onclick = () => setDrawer(!cfg.drawerOpen);
    $('#cut-close').onclick = () => setDrawer(false);
    $('#cut-add2').onclick = addToList;
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && cfg.drawerOpen && cfg.tab === '2d') setDrawer(false); });
    $('#cut-drawer').hidden = !cfg.drawerOpen || cfg.tab !== '2d';
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
    // aceita o plano em dia calculado pelo menos no modo automático (o Rápido só se ele for o escolhido)
    if (planCurrent(autoMode())) return plan;
    if (planJob && planJob.key === planKey() && MODE_RANK[planJob.mode] >= MODE_RANK[autoMode()]) {
      toast('Aguardando o cálculo do plano de corte…');
    } else toast('Calculando plano de corte…');
    const p = await (planJob && planJob.key === planKey() && MODE_RANK[planJob.mode] >= MODE_RANK[autoMode()] ? planJob.promise : computePlan(autoMode()));
    if (!p || !planCurrent()) { toast('O plano não ficou pronto: a configuração mudou durante o cálculo. Tente de novo.'); return null; }
    toast(`Plano calculado: ${chapas(p.lay.sheets.length)}.`);
    return p;
  }
  // nome base dos arquivos do plano: a caixa (lista vazia ou uma só caixa) ou o trabalho
  function planBaseName() {
    const act = cfg.cutList.filter(inPlan);
    if (act.length <= 1) {
      const b = act.length ? act[0].box : cfg;
      return `caixa_${b.W}x${b.D}x${b.H}_${b.t}mm` + (act.length && act[0].qty > 1 ? `_${act[0].qty}un` : '');
    }
    return `corte_${act.reduce((a, e) => a + e.qty, 0)}caixas`;
  }
  // grupos (espessuras) do plano: [{ t, sheets: [índices] }]
  function planGroupsOf(lay) {
    const m = new Map();
    lay.sheets.forEach((sh, i) => { const t = sh.group ? sh.group.t : 0; if (!m.has(t)) m.set(t, []); m.get(t).push(i); });
    return [...m.entries()].map(([t, idx]) => ({ t, idx }));
  }
  function downloadSheet(i, fmt) {
    if (!canDownload(true) || !planCurrent() || !confirmWarnings()) return;
    const sheets = plan.lay.sheets, sh = sheets[i], g = sh.group;
    const suffix = g && g.multi ? `_${g.t}mm_chapa${g.k + 1}` : (sheets.length > 1 ? '_chapa' + (i + 1) : '');
    const name = planBaseName() + suffix + '.' + fmt;
    if (fmt === 'svg') download(name, G.toSVG(sh), 'image/svg+xml');
    else download(name, G.toDXF(sh), 'application/dxf');
  }
  // um arquivo por espessura com todas as chapas dela, empilhadas na vertical e com o contorno de cada
  // chapa em azul (camada CHAPA no DXF), só de referência, não é linha de corte.
  async function downloadCombined(fmt) {
    if (!canDownload(true)) return;
    const p = await ensurePlan();
    if (!p || !confirmWarnings()) return;
    const groups = planGroupsOf(p.lay);
    groups.forEach((g, k) => {
      const sheets = g.idx.map(i => p.lay.sheets[i]);
      const combo = G.combineSheets(sheets, Math.max(20, +cfg.margin * 4 || 20));
      const n = sheets.length;
      const name = planBaseName() + (groups.length > 1 ? `_${g.t}mm` : '') + (n > 1 ? `_${n}chapas` : '') + '.' + fmt;
      // vários arquivos: um pequeno intervalo entre eles (alguns navegadores bloqueiam downloads simultâneos)
      setTimeout(() => {
        if (fmt === 'svg') download(name, G.toSVG(combo), 'image/svg+xml');
        else download(name, G.toDXF(combo), 'application/dxf');
      }, k * 400);
    });
    if (groups.length > 1) toast(`${groups.length} arquivos, um por espessura (${groups.map(g => tmm(g.t)).join(', ')}).`);
  }
  $('#dl-svg').onclick = () => downloadCombined('svg');
  $('#dl-dxf').onclick = () => downloadCombined('dxf');
  // CSV: lista vazia = a caixa do painel; senão, as caixas da lista com quantidade, um arquivo por espessura
  $('#dl-csv').onclick = () => {
    if (!cfg.cutList.length) {
      if (!canDownload()) return;
      download(planBaseName() + '_cutlist.csv', G.toCSV(last.res, cfg, 1), 'text/csv');
      return;
    }
    const entries = planEntries().filter(e => e.res);
    if (!entries.length) { toast('Nenhuma caixa da lista com quantidade e sem erro.'); return; }
    const byT = new Map();
    for (const e of entries) { const t = +e.box.t; if (!byT.has(t)) byT.set(t, []); byT.get(t).push(e); }
    [...byT.entries()].forEach(([t, list], k) => {
      const jobs = list.map(e => ({ res: e.res, qty: e.qty, excl: e.excluir, name: e.name, pieceGrain: e.box.pieceGrain, t: e.box.t, kerf: e.box.kerf }));
      const name = planBaseName() + (byT.size > 1 ? `_${t}mm` : '') + '_cutlist.csv';
      setTimeout(() => download(name, G.toCSV({ jobs }, cfg, `Lista de corte ${t} mm`), 'text/csv'), k * 400);
    });
  };
  $('#save-json').onclick = () => download((cfg.cutList.length > 1 ? planBaseName() : baseName()) + '.json', JSON.stringify(cfg, null, 2), 'application/json');
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
    if (!confirm('Restaurar TODOS os valores padrão? Os valores atuais e a lista de corte serão perdidos.')) return;
    try { localStorage.removeItem(STORE); } catch (e) { /* ignora */ }
    cfg = normalize(null); bindStatic(); renderFaces(); $('#cut-drawer').hidden = true; showTab(cfg.tab); update();
  }
  // só a caixa do painel volta aos padrões; lista de corte, chapa, otimização, zoom e 3D ficam
  function resetBox() {
    if (!confirm('Restaurar a caixa do painel aos valores padrão? A lista de corte e as opções da chapa não mudam.')) return;
    const def = boxOf(normalize(null));
    for (const k of Object.keys(boxOf(cfg))) if (!(k in def)) delete cfg[k];
    Object.assign(cfg, def);
    cfg.editing = null; // o painel deixa de ser a caixa da lista que estava sendo editada
    bindStatic(); renderFaces(); update();
  }
  $('#reset').onclick = resetBox;
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
  initZoom();
  initList();
  initOpt();
  showTab(cfg.tab);
  render();
})();
