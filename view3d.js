/*
 * Visualização 3D da caixa montada (three.js, carregado como script comum).
 * Uso: const v = BoxView3D.create(elemento); v.update(resultadoDoBuild, ajustesPorPeca);
 * Ajustes por peça: { front: { mode: 'solid'|'ghost', color: '#rrggbb', explode: bool }, ... }
 *   solid = opaca, ghost = só as arestas. explode afasta a peça para fora por `dist` mm.
 */
(function (root) {
  'use strict';
  const T = root.THREE;

  // Sistema da caixa: X comprimento, Y largura, Z altura. Three.js: Y para cima, então
  // (X, Y, Z)_caixa -> (X, Z, -Y)_three.
  const toThree = v => [v[0], v[2], -v[1]];

  // Para cada peça: imagens dos eixos locais (a, b) e da extrusão (k), e origem, no sistema da caixa.
  function placement(name, W, D, H, t) {
    switch (name) {
      case 'front':  return { a: [1, 0, 0], b: [0, 0, 1], k: [0, 1, 0], o: [0, 0, 0] };
      case 'back':   return { a: [1, 0, 0], b: [0, 0, 1], k: [0, 1, 0], o: [0, D - t, 0] };
      case 'left':   return { a: [0, 1, 0], b: [0, 0, 1], k: [1, 0, 0], o: [0, 0, 0] };
      case 'right':  return { a: [0, 1, 0], b: [0, 0, 1], k: [1, 0, 0], o: [W - t, 0, 0] };
      case 'bottom': return { a: [1, 0, 0], b: [0, 1, 0], k: [0, 0, 1], o: [0, 0, 0] };
      case 'lid':    return { a: [1, 0, 0], b: [0, 1, 0], k: [0, 0, 1], o: [0, 0, H - t] };
    }
    return null;
  }

  // Direção "para fora" de cada peça, no sistema da caixa.
  const OUT = { front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], bottom: [0, 0, -1], lid: [0, 0, 1] };

  // Cor das arestas: mesma matiz da peça, mas com luminosidade limitada para sempre
  // contrastar com o fundo claro (branco vira cinza-escuro).
  function edgeColorFor(color, ghost) {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const l = ghost ? Math.min(hsl.l * 0.7, 0.36) : Math.min(hsl.l * 0.55, 0.38);
    return new T.Color().setHSL(hsl.h, hsl.s, l);
  }

  function holeInside(h, w, hgt) {
    const th = (h.ang * Math.PI) / 180;
    const hx = ((h.len - h.wid) / 2) * Math.abs(Math.cos(th)) + h.wid / 2;
    const hy = ((h.len - h.wid) / 2) * Math.abs(Math.sin(th)) + h.wid / 2;
    return h.cx - hx > 0 && h.cx + hx < w && h.cy - hy > 0 && h.cy + hy < hgt;
  }

  function holePoints(h) {
    const r = h.wid / 2, half = Math.max((h.len - h.wid) / 2, 0);
    const th = (h.ang * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const pts = [];
    const N = 20;
    const put = (x, y) => pts.push(new T.Vector2(h.cx + x * c - y * s, h.cy + x * s + y * c));
    for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (Math.PI * i) / N; put(half + r * Math.cos(a), r * Math.sin(a)); }
    for (let i = 0; i <= N; i++) { const a = Math.PI / 2 + (Math.PI * i) / N; put(-half + r * Math.cos(a), r * Math.sin(a)); }
    return pts;
  }

  function create(el) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(32, 1, 1, 20000);
    scene.add(new T.HemisphereLight(0xffffff, 0x9a8f80, 1.15));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-600, 900, 700);
    scene.add(sun);
    const fill = new T.DirectionalLight(0xffffff, 0.5);
    fill.position.set(700, 200, -500);
    scene.add(fill);

    const group = new T.Group();
    scene.add(group);
    let grid = null;

    // órbita: ângulos e distância em torno de um alvo
    const st = { theta: -0.65, phi: 1.1, dist: 1200, target: new T.Vector3(0, 0, 0), size: 600, fitted: false };
    let dirty = true, raf = 0;

    function placeCamera() {
      st.phi = Math.min(Math.max(st.phi, 0.05), Math.PI - 0.05);
      st.dist = Math.min(Math.max(st.dist, st.size * 0.3), st.size * 12);
      const sp = Math.sin(st.phi);
      camera.position.set(
        st.target.x + st.dist * sp * Math.sin(st.theta),
        st.target.y + st.dist * Math.cos(st.phi),
        st.target.z + st.dist * sp * Math.cos(st.theta));
      camera.lookAt(st.target);
    }
    function render() { raf = 0; placeCamera(); renderer.render(scene, camera); dirty = false; }
    function invalidate() { dirty = true; if (!raf) raf = requestAnimationFrame(render); }

    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px';
      renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else window.addEventListener('resize', resize);

    // ---- mouse / toque ----
    const ptrs = new Map();
    let last = null, pinch = 0;
    const dom = renderer.domElement;
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => {
      dom.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    dom.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) st.dist *= pinch / d;
        pinch = d;
        invalidate();
        return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;
      if (last.pan) {
        const k = (st.dist * Math.tan((camera.fov * Math.PI) / 360) * 2) / dom.clientHeight;
        const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
        st.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else {
        st.theta -= (dx / dom.clientHeight) * Math.PI * 1.2;
        st.phi -= (dy / dom.clientHeight) * Math.PI * 1.2;
      }
      invalidate();
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      st.dist *= Math.exp(e.deltaY * 0.0012);
      invalidate();
    }, { passive: false });
    dom.addEventListener('dblclick', () => resetCamera());

    function resetCamera() {
      st.theta = -0.65; st.phi = 1.1; st.dist = st.size * 2.3; st.target.set(0, 0, 0);
      invalidate();
    }

    function clearGroup() {
      while (group.children.length) {
        const o = group.children.pop();
        o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
      }
    }

    function update(res, view, dist) {
      const away = +dist || 0;
      clearGroup();
      const { W, D, H, t } = res.dims;
      const m4 = new T.Matrix4();
      let order = 0;
      for (const p of res.panels) {
        const pl = placement(p.name, W, D, H, t);
        if (!pl) continue;
        const v = (view && view[p.name]) || { mode: 'solid', color: '#e0c48f' };

        const shape = new T.Shape(p.nominal.map(q => new T.Vector2(q[0], q[1])));
        // furo que sai da peça quebra a triangulação e esconde o modelo todo: no 3D ele é omitido
        // (o aviso já aparece na lista, e o desenho de corte continua mostrando o furo como definido)
        for (const h of p.holes) if (holeInside(h, p.w, p.h)) shape.holes.push(new T.Path(holePoints(h)));
        const geo = new T.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, steps: 1 });

        const out = v.explode ? OUT[p.name] : [0, 0, 0];
        const org = [pl.o[0] + out[0] * away, pl.o[1] + out[1] * away, pl.o[2] + out[2] * away];
        const a = toThree(pl.a), b = toThree(pl.b), k = toThree(pl.k), o = toThree(org);
        m4.makeBasis(new T.Vector3(...a), new T.Vector3(...b), new T.Vector3(...k));
        m4.setPosition(new T.Vector3(...o));

        const holder = new T.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(m4);

        const color = new T.Color(v.color || '#e0c48f');
        if (v.mode !== 'ghost') {
          const mat = new T.MeshStandardMaterial({
            color, roughness: 0.85, metalness: 0, side: T.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          });
          holder.add(new T.Mesh(geo, mat));
        }
        const edgeColor = edgeColorFor(color, v.mode === 'ghost');
        const lines = new T.LineSegments(new T.EdgesGeometry(geo, 25), new T.LineBasicMaterial({ color: edgeColor }));
        holder.add(lines);
        group.add(holder);
        order++;
      }
      // centraliza a caixa na origem
      const c = toThree([W / 2, D / 2, H / 2]);
      group.position.set(-c[0], -c[1], -c[2]);

      if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
      const size = Math.max(W, D, H);
      const span = Math.ceil((size * 3) / 100) * 100;
      grid = new T.GridHelper(span, span / 50, 0xb9b2a6, 0xd9d4ca);
      const lowest = view && view.bottom && view.bottom.explode ? away : 0;
      grid.position.y = -H / 2 - 0.5 - lowest;
      grid.material.transparent = true;
      grid.material.opacity = 0.55;
      scene.add(grid);

      // primeira vez: enquadra; depois, só acompanha a escala (mantém o ângulo escolhido)
      if (!st.fitted) { st.size = size; st.fitted = true; resetCamera(); }
      else if (Math.abs(st.size - size) > 1e-6) { st.dist *= size / st.size; st.size = size; }
      invalidate();
    }

    return { update, resize, resetCamera, invalidate };
  }

  root.BoxView3D = { create };
})(window);
