/* Trình bố trí sơ đồ cho host: tô ghế / lối đi (kéo để tô nhiều ô), vẽ khối ghi chú, đổi kích thước.
   const ed = LayoutEditor(container, { rows, cols, blocked:[[r,c]], labels:[{r,c,w,h,t,k}], locked:[[r,c]] })
   ed.get() -> { rows, cols, blocked, labels, seats } */
'use strict';
(function () {
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const COLORS = [
    ['stage', 'Tím'], ['info', 'Xanh'], ['green', 'Lục'], ['warn', 'Cam'], ['gray', 'Xám'],
  ];
  const SUGGEST = ['SÂN KHẤU', 'BẢNG', 'CỬA RA VÀO', 'LỐI THOÁT HIỂM', 'WC', 'Bàn tiếp tân', 'Khu khách mời', 'Khu giáo viên', 'Lối đi'];
  const touchDev = matchMedia('(pointer: coarse)').matches;
  const AREA = touchDev ? '<b>giữ ngón tay ~½ giây rồi kéo</b>' : '<b>chuột phải + kéo</b> (hoặc Shift + kéo)';
  const TIPS = {
    toggle: `Bấm 1 ô: <b>ghế ⇄ lối đi</b>. Kéo qua nhiều ô: tô theo ô đầu tiên. Tô cả vùng A×B: ${AREA}.`,
    zone: 'Kéo một hình chữ nhật để tạo <b>khối ghi chú</b> (sân khấu, cửa, WC…). Bấm vào khối có sẵn để sửa / xoá.',
    move: 'Chế độ xem: vuốt để cuộn sơ đồ, không tô gì.',
  };

  window.LayoutEditor = function (root, init) {
    const st = {
      rows: init.rows || 25, cols: init.cols || 25,
      blocked: new Set((init.blocked || []).map((b) => b[0] + ',' + b[1])),
      labels: (init.labels || []).map((z) => ({ ...z })),
      locked: new Set((init.locked || []).map((b) => b[0] + ',' + b[1])),   // ghế đang có người (không tô được)
    };
    let tool = 'toggle', zoom = 1;
    const touch = touchDev;
    if (touch) tool = 'move';

    root.innerHTML = `<div class="le">
      <div class="le-bar">
        <label class="mini">Hàng <input type="number" min="1" max="60" data-rows value="${st.rows}"/></label>
        <label class="mini">Cột <input type="number" min="1" max="60" data-cols value="${st.cols}"/></label>
        <span class="le-count" data-count></span>
        <span class="grow"></span>
        <span class="zoom"><button type="button" class="btn sm" data-zout aria-label="Thu nhỏ">−</button><button type="button" class="btn sm" data-zin aria-label="Phóng to">+</button></span>
      </div>
      <div class="le-tools" role="tablist">
        <button type="button" class="tool" data-tool="toggle">🪑 Ghế ⇄ lối đi</button>
        <button type="button" class="tool" data-tool="zone">▭ Khối ghi chú</button>
        <button type="button" class="tool" data-tool="move">✋ Xem / cuộn</button>
      </div>
      <div class="le-presets">
        <span class="small note">Mẫu nhanh:</span>
        <button type="button" class="btn sm" data-p="all">Tất cả là ghế</button>
        <button type="button" class="btn sm" data-p="mid">Lối đi giữa</button>
        <button type="button" class="btn sm" data-p="sides">Lối đi 2 bên</button>
        <button type="button" class="btn sm" data-p="stage">+ Khối sân khấu</button>
        <button type="button" class="btn sm" data-p="nozone">Xoá mọi khối</button>
      </div>
      <p class="note small le-tip" data-tip></p>
      <div class="le-legend"><span><i class="s"></i>Ghế</span><span><i class="a"></i>Lối đi / trống</span>${(init.locked || []).length ? '<span><i class="l"></i>Đang có người</span>' : ''}</div>
      <div class="le-scroll" data-scroll><div class="le-grid" data-grid></div></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    const grid = $('[data-grid]');
    const scroll = $('[data-scroll]');

    // Hộp thoại riêng của trình bố trí (sửa khối)
    const dlg = document.createElement('dialog');
    dlg.className = 'le-dlg';
    document.body.appendChild(dlg);

    const key = (r, c) => r + ',' + c;
    function coveredSet() {
      const s = new Set();
      for (const z of st.labels) for (let r = z.r; r < z.r + z.h; r++) for (let c = z.c; c < z.c + z.w; c++) s.add(key(r, c));
      return s;
    }
    function seatCount() {
      const cov = coveredSet(); let n = 0;
      for (let r = 1; r <= st.rows; r++) for (let c = 1; c <= st.cols; c++) { const k = key(r, c); if (!cov.has(k) && !st.blocked.has(k)) n++; }
      return n;
    }
    function clip() {
      for (const k of [...st.blocked]) { const [r, c] = k.split(',').map(Number); if (r > st.rows || c > st.cols) st.blocked.delete(k); }
      st.labels = st.labels.filter((z) => z.r <= st.rows && z.c <= st.cols)
        .map((z) => ({ ...z, w: Math.min(z.w, st.cols - z.c + 1), h: Math.min(z.h, st.rows - z.r + 1) }));
    }
    function fitSize() {
      const avail = scroll.clientWidth - 8;
      const base = Math.floor(avail / st.cols) - 2;
      const s = Math.max(touch ? 20 : 14, Math.min(34, base)) * zoom;
      scroll.style.setProperty('--c', Math.round(Math.max(10, Math.min(60, s))) + 'px');
    }

    function draw() {
      fitSize();
      const cov = coveredSet();
      grid.style.gridTemplateColumns = `repeat(${st.cols}, var(--c))`;
      grid.style.gridTemplateRows = `repeat(${st.rows}, var(--c))`;
      const parts = [];
      for (let r = 1; r <= st.rows; r++) for (let c = 1; c <= st.cols; c++) {
        const k = key(r, c);
        if (cov.has(k)) continue;
        const cls = st.locked.has(k) ? 'cell seat lock' : st.blocked.has(k) ? 'cell aisle' : 'cell seat';
        parts.push(`<div class="${cls}" style="grid-area:${r}/${c}" data-r="${r}" data-c="${c}"></div>`);
      }
      st.labels.forEach((z, i) => parts.push(`<div class="zone k-${esc(z.k || 'info')}" data-z="${i}" style="grid-area:${z.r}/${z.c}/span ${z.h}/span ${z.w}"><span>${esc(z.t) || '(trống)'}</span></div>`));
      parts.push('<div class="zone preview" data-prev hidden></div>');
      grid.innerHTML = parts.join('');
      updateCount();
    }
    function updateCount() {
      const n = seatCount();
      $('[data-count]').innerHTML = `<b>${n}</b> ghế · ${st.labels.length} khối`;
    }
    function setTool(t) {
      tool = t;
      root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
      $('[data-tip]').innerHTML = TIPS[t];
      grid.classList.toggle('painting', t !== 'move');
    }

    // ---------- Tô bằng chuột / ngón tay ----------
    // drag.kind: 'paint' (kéo tô từng ô) | 'area' (tô cả vùng A×B) | 'zone' (vẽ khối ghi chú)
    let drag = null, holdTimer = null;
    const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest && el.closest('.le-grid .cell'); };
    const isSeat = (el) => el.classList.contains('seat');
    function setCell(el, target) {
      if (!el || el.classList.contains('lock')) return;
      const k = key(+el.dataset.r, +el.dataset.c);
      if (target === 'seat') { st.blocked.delete(k); el.className = 'cell seat'; }
      else { st.blocked.add(k); el.className = 'cell aisle'; }
    }
    // Tô cả các ô nằm giữa 2 lần di chuyển (kéo nhanh không bị sót ô)
    function paint(el) {
      if (!el) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      const last = drag.last;
      if (last && (Math.abs(last.r - r) > 1 || Math.abs(last.c - c) > 1)) {
        const n = Math.max(Math.abs(last.r - r), Math.abs(last.c - c));
        for (let i = 1; i < n; i++) {
          const rr = Math.round(last.r + (r - last.r) * i / n), cc = Math.round(last.c + (c - last.c) * i / n);
          setCell(grid.querySelector(`.cell[data-r="${rr}"][data-c="${cc}"]`), drag.target);
        }
      }
      setCell(el, drag.target);
      drag.last = { r, c };
    }
    function showPrev(a, b, label) {
      const p = grid.querySelector('[data-prev]');
      const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r), c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c);
      const rect = { r: r1, c: c1, h: r2 - r1 + 1, w: c2 - c1 + 1 };
      p.hidden = false;
      p.className = 'zone preview' + (label ? ' area-' + label : '');
      p.style.gridArea = `${r1}/${c1}/span ${rect.h}/span ${rect.w}`;
      p.innerHTML = `<span>${rect.h} × ${rect.w}${label ? (label === 'seat' ? ' · ghế' : ' · lối đi') : ''}</span>`;
      return rect;
    }
    function startArea(d) { d.kind = 'area'; d.rect = showPrev(d.a, d.a, d.target); }
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
    grid.addEventListener('pointerdown', (e) => {
      const areaKey = e.button === 2 || e.shiftKey;
      if (tool === 'move' && !areaKey) return;
      const z = e.target.closest('.zone:not(.preview)');
      if (z) { if (e.button === 0) { e.preventDefault(); editZone(+z.dataset.z); } return; }
      const el = e.target.closest('.cell');
      if (!el) return;
      e.preventDefault();
      const a = { r: +el.dataset.r, c: +el.dataset.c };
      if (tool === 'zone') { drag = { kind: 'zone', a, rect: showPrev(a, a) }; return; }
      // Trạng thái mới = ngược với ô đầu tiên chạm vào
      const target = isSeat(el) || el.classList.contains('lock') ? 'aisle' : 'seat';
      drag = { kind: 'paint', a, target, last: null };
      if (areaKey) { startArea(drag); return; }
      paint(el);
      // Điện thoại: giữ yên ~½ giây thì chuyển sang tô vùng
      if (e.pointerType === 'touch') {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { if (drag && drag.kind === 'paint' && drag.last && drag.last.r === a.r && drag.last.c === a.c) { startArea(drag); if (navigator.vibrate) navigator.vibrate(15); } }, 450);
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const el = cellAt(e.clientX, e.clientY);
      if (!el) return;
      const b = { r: +el.dataset.r, c: +el.dataset.c };
      if (drag.kind === 'paint') { if (b.r !== drag.a.r || b.c !== drag.a.c) clearTimeout(holdTimer); paint(el); }
      else drag.rect = showPrev(drag.a, b, drag.kind === 'area' ? drag.target : '');
    });
    window.addEventListener('pointerup', () => {
      clearTimeout(holdTimer);
      if (!drag) return;
      const d = drag; drag = null;
      if (d.kind === 'paint') { updateCount(); return; }
      grid.querySelector('[data-prev]').hidden = true;
      const R = d.rect;
      if (d.kind === 'area') {
        for (let r = R.r; r < R.r + R.h; r++) for (let c = R.c; c < R.c + R.w; c++) {
          const k = key(r, c);
          if (st.locked.has(k)) continue;
          if (d.target === 'seat') st.blocked.delete(k); else st.blocked.add(k);
        }
        draw();
        return;
      }
      // khối mới không được đè ghế đang có người
      for (const k of st.locked) {
        const [r, c] = k.split(',').map(Number);
        if (r >= R.r && r < R.r + R.h && c >= R.c && c < R.c + R.w) { alert('Khối không được đè lên ghế đang có người ngồi.'); return; }
      }
      editZone(-1, R);
    });

    // ---------- Sửa / tạo khối ghi chú ----------
    function editZone(i, rect) {
      const z = i >= 0 ? st.labels[i] : { ...rect, t: '', k: rect.h === 1 && rect.w >= Math.ceil(st.cols / 2) ? 'stage' : 'info' };
      dlg.innerHTML = `<form method="dialog" class="le-form">
        <h2>${i >= 0 ? 'Sửa khối ghi chú' : 'Khối ghi chú mới'}</h2>
        <p class="note small">Rộng ${z.w} × cao ${z.h} ô. Người tham gia không chọn được khối này.</p>
        <label class="f">Nội dung<input name="t" maxlength="60" value="${esc(z.t)}" placeholder="VD: SÂN KHẤU, CỬA RA VÀO, WC…" required/></label>
        <div class="chips">${SUGGEST.map((s) => `<button type="button" class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <div class="f">Màu<div class="colors">${COLORS.map(([k, n]) => `<label><input type="radio" name="k" value="${k}" ${k === (z.k || 'info') ? 'checked' : ''}/><span class="sw k-${k}">${n}</span></label>`).join('')}</div></div>
        <div class="acts">
          ${i >= 0 ? '<button type="button" class="btn danger" data-del>Xoá khối</button><span class="grow"></span>' : ''}
          <button type="button" class="btn" data-cancel>Huỷ</button><button class="btn primary">${i >= 0 ? 'Lưu' : 'Thêm khối'}</button>
        </div></form>`;
      const f = dlg.querySelector('form');
      dlg.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { f.t.value = b.dataset.s; }));
      dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
      const del = dlg.querySelector('[data-del]');
      if (del) del.onclick = () => { st.labels.splice(i, 1); dlg.close(); draw(); };
      f.onsubmit = (e) => {
        e.preventDefault();
        const nz = { r: z.r, c: z.c, w: z.w, h: z.h, t: f.t.value.trim().slice(0, 60), k: f.k.value };
        if (i >= 0) st.labels[i] = nz;
        else {
          // khối mới đè lên khối cũ thì bỏ khối cũ
          st.labels = st.labels.filter((o) => o.r + o.h <= nz.r || nz.r + nz.h <= o.r || o.c + o.w <= nz.c || nz.c + nz.w <= o.c);
          st.labels.push(nz);
        }
        dlg.close(); draw();
      };
      dlg.showModal();
      setTimeout(() => f.t.focus(), 30);
    }

    // ---------- Thanh công cụ ----------
    root.querySelectorAll('.tool').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    const sizeChange = () => {
      st.rows = Math.max(1, Math.min(60, +$('[data-rows]').value || 1));
      st.cols = Math.max(1, Math.min(60, +$('[data-cols]').value || 1));
      clip(); draw();
    };
    $('[data-rows]').onchange = sizeChange;
    $('[data-cols]').onchange = sizeChange;
    $('[data-zin]').onclick = () => { zoom = Math.min(2.5, zoom * 1.2); draw(); };
    $('[data-zout]').onclick = () => { zoom = Math.max(0.4, zoom / 1.2); draw(); };
    const cov = () => coveredSet();
    const PRE = {
      all: () => { st.blocked.clear(); },
      mid: () => {
        const cs = st.cols % 2 ? [Math.ceil(st.cols / 2)] : [st.cols / 2, st.cols / 2 + 1];
        const cv = cov();
        for (let r = 1; r <= st.rows; r++) for (const c of cs) if (!cv.has(key(r, c)) && !st.locked.has(key(r, c))) st.blocked.add(key(r, c));
      },
      sides: () => {
        const cv = cov();
        for (let r = 1; r <= st.rows; r++) for (const c of [1, st.cols]) if (!cv.has(key(r, c)) && !st.locked.has(key(r, c))) st.blocked.add(key(r, c));
      },
      stage: () => {
        const z = { r: 1, c: 1, w: st.cols, h: 1, t: 'SÂN KHẤU / BẢNG', k: 'stage' };
        for (const k of st.locked) if (+k.split(',')[0] === 1) { alert('Hàng đầu đang có người ngồi, không đặt khối được.'); return; }
        st.labels = st.labels.filter((o) => o.r > 1);
        st.labels.push(z);
      },
      nozone: () => { st.labels = []; },
    };
    root.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { PRE[b.dataset.p](); draw(); }));
    window.addEventListener('resize', () => { if (root.isConnected) fitSize(); });

    setTool(tool);
    draw();

    return {
      get() {
        clip();
        const cv = coveredSet();
        return {
          rows: st.rows, cols: st.cols,
          blocked: [...st.blocked].filter((k) => !cv.has(k)).map((k) => k.split(',').map(Number)),
          labels: st.labels.map((z) => ({ ...z })),
          seats: seatCount(),
        };
      },
      redraw: draw,
      destroy() { dlg.remove(); },
    };
  };

  // Sơ đồ mặc định: 25 × 25 ghế + 1 hàng sân khấu ở trên
  window.LayoutEditor.defaults = () => ({ rows: 26, cols: 25, blocked: [], labels: [{ r: 1, c: 1, w: 25, h: 1, t: 'SÂN KHẤU / BẢNG', k: 'stage' }] });
})();
