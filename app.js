/* App chọn chỗ: Host tạo phòng → mã phòng → Guest nhập mã, ghi tên, chọn ghế.
   Kết thúc (bấm hoặc hết giờ): phòng khoá lại, mọi người vẫn xem được tên / vị trí trong 2 giờ,
   danh sách lưu vào máy host. Hết 2 giờ: máy host xoá phòng khỏi máy chủ. Muốn host lại: tạo phòng mới. */
'use strict';
(function () {
  const S = window.Seats;
  const { call, store, esc, toast, errText, errCode, isOffline, showCode, normCode, seatName, fmtDT, fmtHM, fmtLeft, endInfo, KEEP_MS, END_TAG } = S;
  const $ = (id) => document.getElementById(id);
  const sb = S.client();
  if (!sb) { document.querySelector('.wrap').innerHTML = '<div class="card">Chưa cấu hình máy chủ (config.js).</div>'; return; }
  const token = S.deviceToken();

  /* ---------- Lưu trên máy ---------- */
  const hosted = () => store.get('seat-hosted', []);            // [{code, key, title, expires_at}]
  const setHosted = (v) => store.set('seat-hosted', v);
  const removeHosted = (code) => setHosted(hosted().filter((x) => x.code !== code));
  const patchHosted = (code, p) => setHosted(hosted().map((x) => (x.code === code ? { ...x, ...p } : x)));
  const joined = () => store.get('seat-joined', []);            // [{code, title, at}]
  const history = () => store.get('seat-history', []);          // dữ liệu phòng đã kết thúc
  function addHistory(room) {
    const h = history().filter((x) => x.code !== room.code);
    h.unshift(room);
    store.set('seat-history', h.slice(0, 30));
  }
  function rememberJoined(room) {
    const j = joined().filter((x) => x.code !== room.code);
    j.unshift({ code: room.code, title: room.title, at: Date.now() });
    store.set('seat-joined', j.slice(0, 6));
  }
  const joinLink = (code) => location.href.split('#')[0] + '#/join/' + normCode(code);

  /* ---------- Hộp thoại ---------- */
  const dlg = $('dlg');
  let pending = null;
  function settle(v) { const p = pending; pending = null; if (dlg.open) dlg.close(); if (onDlgClose) { const f = onDlgClose; onDlgClose = null; f(); } if (p) p(v); }
  let onDlgClose = null;
  function openDlg(html, wide = false) {
    if (pending) { const p = pending; pending = null; p(false); }
    if (onDlgClose) { const f = onDlgClose; onDlgClose = null; f(); }
    dlg.classList.toggle('wide', wide);
    $('dlgBody').innerHTML = html;
    if (!dlg.open) dlg.showModal();
    $('dlgBody').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => settle(false)));
    return $('dlgBody');
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); settle(false); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) settle(false); });
  function ask(title, text, okLabel = 'Đồng ý', danger = false) {
    return new Promise((resolve) => {
      const body = openDlg(`<h2>${esc(title)}</h2>${text ? `<p class="note">${text}</p>` : ''}
        <div class="acts"><button class="btn" data-close>Huỷ</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`);
      pending = resolve;
      body.querySelector('[data-ok]').onclick = () => settle(true);
    });
  }

  /* ---------- Điều hướng (#/, #/create, #/host/MA, #/join/MA) ---------- */
  let timers = [];
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  function show(v) {
    document.querySelectorAll('.view').forEach((el) => { el.hidden = el.id !== 'v-' + v; });
    $('backBtn').hidden = v === 'home';
    window.scrollTo(0, 0);
  }
  function route() {
    clearTimers();
    if (dlg.open) settle(false);
    netReset();
    const [, page, arg] = (location.hash || '#/').split('/');
    if (page === 'create') {
      show('create');
      if (reuse) {
        // Host lại từ phòng cũ: dùng lại tên, ghi chú, sơ đồ
        if (createEd) createEd.destroy();
        createEd = window.LayoutEditor($('createLayout'), { rows: reuse.rows, cols: reuse.cols, blocked: reuse.blocked || [], labels: reuse.labels || [] });
        $('createForm').title.value = reuse.title || '';
        $('createForm').note.value = reuse.note || '';
        reuse = null;
      } else if (!createEd) createEd = window.LayoutEditor($('createLayout'), window.LayoutEditor.defaults()); else createEd.redraw();
      return;
    }
    if (page === 'host' && arg) return openHost(normCode(arg));
    if (page === 'join' && arg) return openJoin(normCode(arg));
    renderHome();
  }
  window.addEventListener('hashchange', route);
  $('backBtn').onclick = () => { location.hash = '#/'; };
  /* Báo mất mạng: chỉ báo khi lỗi mạng liên tiếp ≥ 3 lần trong ≥ 8 giây (hoặc máy báo offline thật).
     Một lần lỗi lẻ (đổi Wi-Fi/4G, mở lại tab, mạng trường chậm) sẽ tự thử lại, không báo. */
  const net = { fails: 0, since: 0 };
  function netReport(error) {
    if (error && isOffline(error)) {
      if (!net.fails) net.since = Date.now();
      net.fails++;
      if (navigator.onLine === false || (net.fails >= 3 && Date.now() - net.since >= 8000)) $('offline').hidden = false;
    } else netReset();
  }
  function netReset() { net.fails = 0; net.since = 0; $('offline').hidden = true; }
  window.addEventListener('offline', () => { $('offline').hidden = false; });

  /* ================= TRANG ĐẦU ================= */
  function renderHome() {
    show('home');
    document.title = 'Chọn chỗ';
    const now = Date.now();
    const hs = hosted();
    $('hostedBox').hidden = !hs.length;
    $('hostedList').innerHTML = hs.map((h) => {
      if (h.ended_at) {
        return `<div class="item"><div class="grow"><b>${esc(h.title)}</b><small>Mã ${showCode(h.code)} · đã kết thúc · mọi người xem được đến ${fmtHM(Date.parse(h.ended_at) + KEEP_MS)}</small></div>
          <a class="btn sm" href="#/host/${h.code}">Xem</a></div>`;
      }
      const left = Date.parse(h.expires_at) - now;
      return `<div class="item"><div class="grow"><b>${esc(h.title)}</b><small>Mã ${showCode(h.code)} · ${left > 0 ? 'còn ' + fmtLeft(left) : 'hết giờ — đang chốt danh sách…'}</small></div>
        <a class="btn sm primary" href="#/host/${h.code}">Mở</a></div>`;
    }).join('');
    const js = joined();
    $('joinedBox').hidden = !js.length;
    $('joinedList').innerHTML = js.map((j) => `<div class="item"><div class="grow"><b>${esc(j.title)}</b><small>Mã ${showCode(j.code)}</small></div>
      <a class="btn sm" href="#/join/${j.code}">Vào</a></div>`).join('');
    const hi = history();
    $('historyBox').hidden = !hi.length;
    $('historyList').innerHTML = hi.map((r, i) => `<div class="item"><div class="grow"><b>${esc(r.title)}</b>
      <small>Mã ${showCode(r.code)} · ${r.taken.length} người · kết thúc ${fmtDT(r.ended_at)}</small></div>
      <button class="btn sm primary" data-dl="${i}">Tải về</button>${r.rows ? `<button class="btn sm" data-again="${i}">Host lại</button>` : ''}<button class="btn sm ghost" data-del="${i}" aria-label="Xoá khỏi máy">✕</button></div>`).join('');
    $('historyList').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => exportDlg(history()[+b.dataset.dl])));
    $('historyList').querySelectorAll('[data-again]').forEach((b) => (b.onclick = () => hostAgain(history()[+b.dataset.again])));
    $('historyList').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const r = history()[+b.dataset.del];
      if (!(await ask('Xoá khỏi máy?', `Xoá danh sách <b>${esc(r.title)}</b> khỏi máy này.`, 'Xoá', true))) return;
      store.set('seat-history', history().filter((x) => x.code !== r.code));
      renderHome();
    }));
    housekeep();
  }

  /* Dọn phòng của máy host (chạy khi mở trang đầu và mỗi phút):
     - hết giờ mà chưa chốt → chốt (khoá, lưu danh sách vào máy)
     - đã kết thúc quá 2 giờ → xoá khỏi máy chủ */
  function housekeep() {
    const now = Date.now();
    for (const h of hosted()) {
      if (h.ended_at) { if (now > Date.parse(h.ended_at) + KEEP_MS) purge(h); }
      else if (Date.parse(h.expires_at) <= now && !(H && H.code === h.code)) finishRoom(h, true);
    }
  }
  setInterval(housekeep, 60000);

  /* Hộp thoại xuất file: Excel theo sơ đồ hoặc danh sách CSV */
  function exportDlg(room, title = 'Tải danh sách', text = '') {
    const body = openDlg(`<h2>${esc(title)}</h2>${text ? `<p class="note">${text}</p>` : ''}
      <div class="exp">
        <button class="btn primary" type="button" data-f="xlsx">Excel theo sơ đồ (.xlsx)<small>Giống sơ đồ trên màn hình: ô ghế ghi tên người chọn, lối đi gộp thành ô trống. Kèm trang danh sách.</small></button>
        <button class="btn" type="button" data-f="csv">Danh sách (.csv)<small>STT · Ghế · Họ tên · Thời gian chọn</small></button>
      </div>
      <div class="acts"><button class="btn" type="button" data-close>Đóng</button></div>`);
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = async () => {
      try { await S.saveFile(room, true, b.dataset.f); } catch (e) { toast('Không tạo được file: ' + (e.message || e), true); }
    }));
  }

  /* Host lại = tạo phòng MỚI, dùng lại tên + sơ đồ phòng cũ */
  let reuse = null;
  function hostAgain(r) {
    reuse = { title: r.title, note: endInfo(r).note, rows: r.rows, cols: r.cols, blocked: r.blocked, labels: r.labels };
    if (location.hash === '#/create') route(); else location.hash = '#/create';
    toast('Đã chép sơ đồ phòng cũ — kiểm tra rồi bấm "Tạo phòng".');
  }

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normCode(e.currentTarget.code.value);
    if (code.length !== 8) { $('joinMsg').textContent = 'Mã phòng gồm 8 ký tự, ví dụ K7QM-2XPA.'; return; }
    $('joinMsg').textContent = '';
    location.hash = '#/join/' + code;
  });
  $('joinForm').code.addEventListener('input', (e) => {
    const n = normCode(e.target.value).slice(0, 8);
    e.target.value = n.length > 4 ? n.slice(0, 4) + '-' + n.slice(4) : n;
  });
  $('newRoomBtn').onclick = () => { location.hash = '#/create'; };

  /* ================= TẠO PHÒNG ================= */
  let createEd = null;
  $('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = f.querySelector('button.primary:not([type=button])');
    const L = createEd.get();
    if (L.seats < 1) { $('createMsg').textContent = 'Sơ đồ chưa có ghế nào.'; return; }
    btn.disabled = true; $('createMsg').textContent = '';
    const { data, error } = await call(sb, 'seat_room_create', {
      p_title: f.title.value, p_note: f.note.value, p_rows: L.rows, p_cols: L.cols,
      p_minutes: +f.minutes.value, p_allow_change: f.allow_change.checked, p_show_names: f.show_names.checked,
      p_blocked: L.blocked, p_labels: L.labels,
    });
    btn.disabled = false;
    if (error) { $('createMsg').textContent = errText(error); return; }
    setHosted([{ code: data.code, key: data.host_key, title: data.title, expires_at: data.expires_at }, ...hosted()]);
    f.reset();
    createEd.destroy(); createEd = null; $('createLayout').innerHTML = '';
    location.hash = '#/host/' + data.code;
    setTimeout(() => showQr(), 400);
  });

  /* ================= HOST ================= */
  let H = null;
  async function openHost(code) {
    const h = hosted().find((x) => x.code === code);
    if (!h) { toast('Máy này không giữ khoá host của phòng đó.', true); location.hash = '#/'; return; }
    H = { ...h, room: null, zoom: 1, retryAt: 0, loading: false, ended: !!h.ended_at };
    show('host');
    $('hCode').textContent = showCode(code);
    $('hTitle').textContent = h.title;
    $('hGrid').innerHTML = '<p class="note">Đang tải…</p>';
    await loadHost();
    timers.push(setInterval(() => { if (!document.hidden && !dlg.open) loadHost(); }, 4000));
    timers.push(setInterval(tickHost, 1000));
  }

  async function loadHost() {
    if (!H || H.loading) return;
    const h = H;
    h.loading = true;
    const { data, error } = await call(sb, 'seat_room_host_view', { p_code: h.code, p_key: h.key }, { retry: true });
    h.loading = false;
    if (H !== h) return;
    netReport(error);
    if (error) {
      if (isOffline(error)) return;
      const c = errCode(error);
      if (c === 'NO_ROOM' || c === 'BAD_KEY') { removeHosted(H.code); toast('Phòng không còn trên máy chủ.', true); location.hash = '#/'; }
      else toast(errText(error), true);
      return;
    }
    H.room = data;
    H.offset = (Date.parse(data.now) - Date.now()) || 0;
    patchHosted(H.code, { title: data.title, expires_at: data.expires_at });
    drawHost();
    // Phòng đã hết giờ nhưng máy này chưa chốt → chốt
    const hs = hosted().find((x) => x.code === H.code);
    if (endInfo(data).ended && hs && !hs.ended_at) finishRoom(H, true);
  }

  function drawHost() {
    const r = H.room, E = endInfo(r);
    H.ended = E.ended; H.until = E.until;
    document.title = r.title + ' · Host';
    $('hTitle').textContent = r.title;
    $('hNote').textContent = E.note;
    $('hStatus').textContent = E.ended ? 'Đã kết thúc' : r.is_open ? 'Đang mở' : 'Tạm khoá';
    $('hStatus').className = 'pill' + (r.open && !E.ended ? '' : ' off');
    $('hToggle').textContent = r.is_open ? 'Tạm khoá' : 'Mở lại';
    ['hToggle', 'hAdd', 'hLayout', 'hSettings', 'hHelp', 'hEndCard'].forEach((id) => { $(id).hidden = E.ended; });
    $('hEndedCard').hidden = !E.ended;
    if (E.ended) {
      $('hEndedText').innerHTML = `Kết thúc lúc <b>${fmtHM(E.at)}</b>. Mọi người vẫn vào xem được tên và vị trí (không sửa được) đến <b>${fmtHM(E.until)}</b>, sau đó phòng tự xoá khỏi máy chủ. Danh sách đã lưu ở mục <b>Đã kết thúc</b> trên máy này.`;
    }
    S.fit($('hScroll'), r.cols, H.zoom);
    const s = S.render($('hGrid'), r, { host: true, onSeat: hostSeat });
    $('hStats').textContent = `${s.taken}/${s.total} đã chọn · ${r.blocked.length} không dùng${r.allow_change ? '' : ' · không cho đổi'}`;
    drawHostList();
    tickHost();
  }

  function drawHostList() {
    const q = $('hQ').value.trim().toLowerCase();
    const rows = H.room.taken.filter((t) => !q || (t[2] || '').toLowerCase().includes(q));
    $('hList').innerHTML = rows.map((t) => `<tr><td><b>${seatName(H.room, t[0], t[1])}</b></td><td>${esc(t[2])}</td><td class="small">${fmtDT(t[3])}</td>
      <td style="text-align:right">${H.ended ? '' : `<button class="btn sm danger" data-free="${t[0]},${t[1]}">Giải phóng</button>`}</td></tr>`).join('')
      || '<tr><td colspan="4" class="note">Chưa có ai chọn.</td></tr>';
  }
  $('hQ').oninput = () => H && H.room && drawHostList();
  $('hList').onclick = (e) => { const b = e.target.closest('[data-free]'); if (b) { const [r, c] = b.dataset.free.split(',').map(Number); hostFree(r, c); } };

  function tickHost() {
    if (!H || !H.room) return;
    const now = Date.now() + (H.offset || 0);
    if (H.ended) {
      const left = H.until - now;
      $('hTimer').textContent = left > 0 ? 'Xem được thêm ' + fmtLeft(left) : 'Đang đóng phòng…';
      $('hTimer').classList.remove('warn');
      if (left <= 0) purge(H);
      return;
    }
    const left = Date.parse(H.room.expires_at) - now;
    $('hTimer').textContent = left > 0 ? 'Còn ' + fmtLeft(left) : 'Hết giờ';
    $('hTimer').classList.toggle('warn', left > 0 && left < 5 * 60000);
    if (left <= 0 && !ending.has(H.code) && Date.now() > H.retryAt) { H.retryAt = Date.now() + 15000; finishRoom(H, true); }
  }

  async function hostSeat(r, c, state, info) {
    if (H.ended) {
      if (state === 'taken') openDlg(`<h2>Ghế ${seatName(H.room, r, c)}</h2><p><b>${esc(info[2])}</b><br/><span class="note small">Chọn lúc ${fmtDT(info[3])}</span></p><div class="acts"><button class="btn" data-close>Đóng</button></div>`);
      return;
    }
    if (state === 'taken') {
      if (await ask(`Ghế ${seatName(H.room, r, c)}`, `<b>${esc(info[2])}</b><br/>Chọn lúc ${fmtDT(info[3])}`, 'Giải phóng ghế', true)) hostFree(r, c, true);
      return;
    }
    const { data, error } = await call(sb, 'seat_room_host_block', { p_code: H.code, p_key: H.key, p_row: r, p_col: c });
    if (error) return toast(errText(error), true);
    toast(data ? 'Đã đổi thành lối đi' : 'Đã đổi thành ghế');
    loadHost();
  }

  async function hostFree(r, c, confirmed) {
    if (!confirmed && !(await ask(`Giải phóng ghế ${seatName(H.room, r, c)}?`, 'Người đã chọn sẽ mất chỗ.', 'Giải phóng', true))) return;
    const { error } = await call(sb, 'seat_room_host_free', { p_code: H.code, p_key: H.key, p_row: r, p_col: c });
    if (error) return toast(errText(error), true);
    toast('Đã giải phóng ' + seatName(H.room, r, c));
    loadHost();
  }

  async function hostUpdate(patch) {
    const r = H.room;
    if (H.ended) return false;
    const p = {
      p_code: H.code, p_key: H.key, p_title: r.title, p_note: r.note, p_rows: r.rows, p_cols: r.cols,
      p_open: r.is_open, p_allow_change: r.allow_change, p_show_names: r.show_names, p_add_minutes: 0, ...patch,
    };
    const { data, error } = await call(sb, 'seat_room_host_update', p);
    if (error) { toast(errText(error), true); return false; }
    H.room = data; H.offset = (Date.parse(data.now) - Date.now()) || 0;
    patchHosted(H.code, { title: data.title, expires_at: data.expires_at });
    drawHost();
    return true;
  }
  $('hToggle').onclick = () => hostUpdate({ p_open: !H.room.is_open });
  $('hAdd').onclick = async () => { if (await hostUpdate({ p_add_minutes: 30 })) toast('Đã gia hạn thêm 30 phút'); };
  $('hSettings').onclick = () => {
    const r = H.room;
    const body = openDlg(`<h2>Cài đặt phòng</h2>
      <form id="setForm">
        <label class="f">Tên buổi<input name="title" maxlength="120" required value="${esc(r.title)}"/></label>
        <label class="f">Ghi chú<textarea name="note" rows="2" maxlength="1000">${esc(r.note)}</textarea></label>
        <label class="f check"><input type="checkbox" name="allow_change" ${r.allow_change ? 'checked' : ''}/> Cho tự đổi / huỷ chỗ</label>
        <label class="f check"><input type="checkbox" name="show_names" ${r.show_names ? 'checked' : ''}/> Cho mọi người thấy tên</label>
        <div class="acts"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary">Lưu</button></div>
      </form>`);
    body.querySelector('#setForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const ok = await hostUpdate({ p_title: f.title.value, p_note: f.note.value,
        p_allow_change: f.allow_change.checked, p_show_names: f.show_names.checked });
      if (ok) { settle(false); toast('Đã lưu'); }
    };
  };
  $('hLayout').onclick = () => {
    const r = H.room;
    const body = openDlg(`<h2>Bố trí sơ đồ</h2>
      <p class="note small">Ghế đang có người hiện màu xám, không tô đè được. Tên ghế được đánh lại theo sơ đồ mới.</p>
      <div id="hLe"></div><p class="msg" id="hLeMsg"></p>
      <div class="acts"><button type="button" class="btn" data-close>Huỷ</button><button type="button" class="btn primary" id="hLeSave">Lưu bố trí</button></div>`, true);
    const ed = window.LayoutEditor(body.querySelector('#hLe'), {
      rows: r.rows, cols: r.cols, blocked: r.blocked, labels: r.labels || [], locked: r.taken.map((t) => [t[0], t[1]]),
    });
    onDlgClose = () => ed.destroy();
    body.querySelector('#hLeSave').onclick = async () => {
      const L = ed.get();
      if (L.seats < 1) { $('hLeMsg').textContent = 'Sơ đồ chưa có ghế nào.'; return; }
      const { data, error } = await call(sb, 'seat_room_host_layout', { p_code: H.code, p_key: H.key, p_rows: L.rows, p_cols: L.cols, p_blocked: L.blocked, p_labels: L.labels });
      if (error) { $('hLeMsg').textContent = errText(error); return; }
      H.room = data; settle(false); drawHost(); toast('Đã lưu bố trí');
    };
  };
  $('hCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(showCode(H.code)); toast('Đã copy mã ' + showCode(H.code)); } catch (_) { toast('Mã: ' + showCode(H.code)); }
  };
  $('hShare').onclick = async () => {
    const url = joinLink(H.code);
    const text = `Chọn chỗ "${H.room ? H.room.title : H.title}" — mã phòng ${showCode(H.code)}`;
    if (navigator.share) { try { await navigator.share({ title: text, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text + '\n' + url); toast('Đã copy link mời'); } catch (_) { toast(url); }
  };
  function showQr() {
    if (!H) return;
    const url = joinLink(H.code);
    let svg = '';
    try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); svg = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } catch (_) { svg = ''; }
    openDlg(`<div class="qr-box">
      <p class="kicker">QUÉT ĐỂ VÀO PHÒNG</p>
      ${svg ? `<div class="qr">${svg}</div>` : ''}
      <div class="big-code">${showCode(H.code)}</div>
      <p class="note small" style="word-break:break-all">${esc(url)}</p>
      <div class="acts" style="justify-content:center"><button class="btn" data-close>Đóng</button><button class="btn primary" id="qrFull">Toàn màn hình</button></div>
    </div>`);
    $('qrFull').onclick = () => { const el = document.querySelector('.qr-box'); (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); };
  }
  $('hQr').onclick = showQr;
  $('hIn').onclick = () => { H.zoom = Math.min(2.2, H.zoom * 1.2); drawHost(); };
  $('hOut').onclick = () => { H.zoom = Math.max(0.5, H.zoom / 1.2); drawHost(); };
  $('hEnd').onclick = async () => {
    const n = H.room ? H.room.taken.length : 0;
    if (!(await ask('Kết thúc phòng?', `Mọi người <b>không chọn hay đổi chỗ được nữa</b>, nhưng vẫn vào xem được tên và vị trí trong <b>2 giờ</b>. Sau đó phòng tự xoá khỏi máy chủ.<br/><br/>Danh sách ${n} người được lưu trên máy này. Muốn mở lại thì bấm <b>Host lại</b> (tạo phòng mới với sơ đồ cũ).`, 'Kết thúc', true))) return;
    const btn = $('hEnd');
    btn.disabled = true;
    const rec = await finishRoom(H, false);
    btn.disabled = false;
    if (rec) exportDlg(rec, 'Đã kết thúc phòng', `Danh sách ${rec.taken.length} người đã lưu trên máy này. Tải về:`);
  };
  $('hExport').onclick = $('hExport2').onclick = () => {
    if (!H || !H.room) return;
    const E = endInfo(H.room);
    exportDlg({ ...H.room, code: H.code, note: E.note, ended_at: E.ended ? new Date(E.at).toISOString() : null });
  };
  $('hAgain').onclick = () => { if (H && H.room) hostAgain(H.room); };

  /* Chốt phòng: khoá (không chọn / đổi được nữa), ghi dấu kết thúc, lưu danh sách vào máy.
     Phòng vẫn ở trên máy chủ thêm 2 giờ cho mọi người xem. auto = hết giờ tự chốt. */
  const ending = new Set();
  async function finishRoom(h, auto) {
    if (ending.has(h.code)) return false;
    ending.add(h.code);
    try {
      const v = await call(sb, 'seat_room_host_view', { p_code: h.code, p_key: h.key }, { retry: true });
      if (v.error) {
        const c = errCode(v.error);
        if (c === 'NO_ROOM' || c === 'BAD_KEY') { removeHosted(h.code); if (!auto) toast('Phòng không còn trên máy chủ.', true); }
        else if (!auto) toast(errText(v.error), true);
        return false;
      }
      let room = v.data, E = endInfo(room);
      if (!E.ended) {
        const offset = (Date.parse(room.now) - Date.now()) || 0;
        const at = new Date(Date.now() + offset).toISOString();
        const u = await call(sb, 'seat_room_host_update', {
          p_code: h.code, p_key: h.key, p_title: room.title, p_note: (END_TAG + at + '\n' + (room.note || '')).slice(0, 1000),
          p_rows: room.rows, p_cols: room.cols, p_open: false, p_allow_change: false, p_show_names: room.show_names, p_add_minutes: 0,
        });
        if (u.error) {
          if (errCode(u.error) !== 'EXPIRED') { if (!auto) toast(errText(u.error), true); return false; }
          room = { ...room, expired: true, open: false };   // vừa hết giờ đúng lúc bấm
        } else room = u.data;
        E = endInfo(room);
        if (!E.ended) { const t = Date.parse(at); E = { ...E, ended: true, at: t, until: t + KEEP_MS }; }
      }
      const endedAt = new Date(E.at).toISOString();
      patchHosted(h.code, { ended_at: endedAt, title: room.title });
      const rec = { ...room, code: h.code, note: E.note, ended_at: endedAt };
      addHistory(rec);
      if (auto) toast(`"${room.title}" đã hết giờ — danh sách đã lưu ở mục "Đã kết thúc".`);
      if (H && H.code === h.code) { H.room = room; H.offset = (Date.parse(room.now) - Date.now()) || H.offset || 0; drawHost(); }
      else if (!$('v-home').hidden) renderHome();
      return rec;
    } finally { ending.delete(h.code); }
  }

  /* Hết 2 giờ xem: xoá phòng khỏi máy chủ (danh sách vẫn còn trên máy host) */
  const purgeTry = new Map();
  async function purge(h) {
    if (Date.now() - (purgeTry.get(h.code) || 0) < 30000) return;
    purgeTry.set(h.code, Date.now());
    const { error } = await call(sb, 'seat_room_end', { p_code: h.code, p_key: h.key });
    if (error && !['NO_ROOM', 'BAD_KEY'].includes(errCode(error))) return;   // lỗi mạng: thử lại sau
    removeHosted(h.code);
    if (H && H.code === h.code) { H = null; toast('Đã hết 2 giờ xem — phòng đã xoá khỏi máy chủ. Danh sách vẫn ở mục "Đã kết thúc".'); location.hash = '#/'; }
    else if (!$('v-home').hidden) renderHome();
  }

  /* ================= GUEST ================= */
  let G = null;
  async function openJoin(code) {
    G = { code, room: null, zoom: 1, name: store.get('seat-name', ''), gone: false, loading: false, last: 0 };
    const ok = await loadGuest(true);
    if (!ok) return;
    rememberJoined(G.room);
    if (G.room.mine) { G.name = G.room.mine[2]; showGuest(); }
    else if (endInfo(G.room).ended) showGuest();      // phòng đã kết thúc: vào xem luôn, không cần nhập tên
    else showNameStep();
  }

  async function loadGuest(first) {
    if (!G || G.gone) return false;
    if (G.loading && !first) return true;
    const g = G;
    g.loading = true;
    const { data, error } = await call(sb, 'seat_room_view', { p_code: g.code, p_token: token }, { retry: true });
    g.loading = false;
    if (G !== g) return false;
    netReport(error);
    if (error) {
      if (isOffline(error) && !first) return true;
      if (first) {
        renderHome(); location.hash = '#/';
        $('joinForm').code.value = showCode(G.code);
        $('joinMsg').textContent = errText(error);
        return false;
      }
      if (errCode(error) === 'NO_ROOM') roomGone();
      return false;
    }
    G.room = data;
    G.offset = (Date.parse(data.now) - Date.now()) || 0;
    G.last = Date.now();
    const E = endInfo(data);
    if (E.ended && Date.now() + G.offset > E.until) {
      // Đã quá 2 giờ sau khi kết thúc
      if (first) {
        renderHome(); location.hash = '#/';
        $('joinForm').code.value = showCode(G.code);
        $('joinMsg').textContent = 'Phòng đã kết thúc và đã đóng.';
        store.set('seat-joined', joined().filter((x) => x.code !== G.code));
        return false;
      }
      roomGone();
      return false;
    }
    if (!$('v-guest').hidden) drawGuest();
    return true;
  }

  function roomGone() {
    G.gone = true;
    clearTimers();
    $('gMine').hidden = false;
    $('gMine').className = 'banner off';
    $('gMine').innerHTML = 'Phòng đã đóng. Cảm ơn bạn đã tham gia!';
    $('gStatus').textContent = 'Đã đóng'; $('gStatus').className = 'pill off';
    $('gTimer').textContent = '';
    $('gListCard').hidden = true;
    $('gGrid').querySelectorAll('.seat').forEach((b) => { b.disabled = true; });
    store.set('seat-joined', joined().filter((x) => x.code !== G.code));
  }

  function showNameStep() {
    show('name');
    const r = G.room;
    $('nCode').textContent = 'PHÒNG ' + showCode(r.code);
    $('nTitle').textContent = r.title;
    $('nNote').textContent = r.note || '';
    $('nameForm').name.value = G.name || '';
    setTimeout(() => $('nameForm').name.focus(), 50);
  }
  $('nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    G.name = e.currentTarget.name.value.trim().replace(/\s+/g, ' ');
    store.set('seat-name', G.name);
    showGuest();
  });

  function showGuest() {
    show('guest');
    drawGuest();
    clearTimers();
    timers.push(setInterval(() => {
      if (document.hidden || dlg.open || !G) return;
      if (G.ended && Date.now() - G.last < 60000) return;   // phòng đã kết thúc: 1 phút cập nhật 1 lần
      loadGuest(false);
    }, 4000));
    timers.push(setInterval(tickGuest, 1000));
  }

  function drawGuest() {
    const r = G.room, E = endInfo(r);
    G.ended = E.ended; G.until = E.until;
    if (E.ended) r.open = false;                       // đã kết thúc: chỉ xem
    document.title = r.title;
    $('gCode').textContent = 'PHÒNG ' + showCode(r.code);
    $('gTitle').textContent = r.title;
    $('gNote').textContent = E.note;
    $('gName').textContent = G.name || '—';
    $('gRename').hidden = E.ended;
    $('gStatus').textContent = E.ended ? 'Đã kết thúc' : r.is_open ? 'Đang mở' : 'Host đang tạm khoá';
    $('gStatus').className = 'pill' + (r.open ? '' : ' off');
    S.fit($('gScroll'), r.cols, G.zoom);
    const s = S.render($('gGrid'), r, { onSeat: (row, col, state) => { if (state === 'free') pickSeat(row, col); else if (state === 'mine') cancelSeat(); } });
    $('gStats').textContent = E.ended ? `${s.taken}/${s.total} ghế có người` : `Còn ${s.free}/${s.total} ghế trống`;
    drawGuestList(E.ended);
    const can = r.open && r.allow_change !== false;
    if (E.ended) {
      $('gMine').hidden = false;
      $('gMine').className = r.mine ? 'banner' : 'banner off';
      $('gMine').innerHTML = (r.mine
        ? `Phòng đã kết thúc. Chỗ của bạn: ghế <b>${seatName(r, r.mine[0], r.mine[1])}</b> — ${esc(r.mine[2])}.`
        : 'Phòng đã kết thúc. Máy này không chọn ghế nào trong phòng.')
        + ` <span class="small">Xem được đến ${fmtHM(E.until)}.</span>`;
    } else if (r.mine) {
      $('gMine').hidden = false; $('gMine').className = 'banner';
      $('gMine').innerHTML = `Bạn đã chọn ghế <b>${seatName(r, r.mine[0], r.mine[1])}</b> — ${esc(r.mine[2])}.`
        + (can ? ' Muốn đổi thì bấm vào ghế trống khác. <button class="btn sm danger" id="gCancel" type="button">Huỷ chỗ</button>' : '');
      if (can) $('gCancel').onclick = cancelSeat;
    } else if (!r.open) {
      $('gMine').hidden = false; $('gMine').className = 'banner off';
      $('gMine').textContent = r.expired ? 'Phòng đã hết giờ chọn chỗ.' : 'Host đang tạm khoá chọn chỗ. Vui lòng đợi.';
    } else $('gMine').hidden = true;
    tickGuest();
  }

  // Danh sách tên (chỉ hiện khi phòng đã kết thúc và host cho thấy tên)
  function drawGuestList(ended) {
    const r = G.room;
    const named = ended ? r.taken.filter((t) => t[2]) : [];
    $('gListCard').hidden = !named.length;
    if (!named.length) return;
    const q = $('gQ').value.trim().toLowerCase();
    const rows = named.filter((t) => !q || t[2].toLowerCase().includes(q)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    $('gList').innerHTML = rows.map((t) => `<tr><td><b>${seatName(r, t[0], t[1])}</b></td><td>${esc(t[2])}</td></tr>`).join('')
      || '<tr><td colspan="2" class="note">Không tìm thấy.</td></tr>';
  }
  $('gQ').oninput = () => G && G.room && drawGuestList(G.ended);

  function tickGuest() {
    if (!G || !G.room || G.gone) return;
    if (G.ended) {
      const left = G.until - (Date.now() + (G.offset || 0));
      $('gTimer').textContent = left > 0 ? 'Xem được thêm ' + fmtLeft(left) : '';
      if (left <= 0) roomGone();
      return;
    }
    const left = Date.parse(G.room.expires_at) - (Date.now() + (G.offset || 0));
    $('gTimer').textContent = left > 0 ? 'Còn ' + fmtLeft(left) : 'Hết giờ';
    if (left <= 0 && G.room.open) { G.room.open = false; G.room.expired = true; drawGuest(); }
  }

  let busy = false;
  async function pickSeat(r, c) {
    const room = G.room;
    if (!room.open || busy) return;
    const moving = !!room.mine;
    const ok = await ask(moving ? `Chuyển sang ghế ${seatName(G.room, r, c)}?` : `Chọn ghế ${seatName(G.room, r, c)}?`,
      moving ? `Ghế cũ <b>${seatName(room, room.mine[0], room.mine[1])}</b> sẽ được nhả cho người khác. Nếu ghế mới vừa có người lấy trước, bạn vẫn giữ ghế cũ.`
        : `Tên: <b>${esc(G.name)}</b>${room.allow_change === false ? '<br/>Phòng này <b>không cho đổi chỗ</b> sau khi chọn.' : ''}`,
      moving ? 'Đổi chỗ' : 'Chọn ghế này');
    if (!ok) return;
    busy = true;
    const { error } = await call(sb, 'seat_room_take', { p_code: G.code, p_row: r, p_col: c, p_name: G.name, p_token: token });
    busy = false;
    if (error) { toast(errText(error), true); if (errCode(error) === 'NO_ROOM') return roomGone(); return loadGuest(false); }
    netReset();
    toast(moving ? `Đã chuyển sang ghế ${seatName(G.room, r, c)}` : `Đã giữ ghế ${seatName(G.room, r, c)}`);
    loadGuest(false);
  }

  async function cancelSeat() {
    const m = G.room.mine;
    if (!m || busy) return;
    if (!(await ask(`Huỷ ghế ${seatName(G.room, m[0], m[1])}?`, 'Ghế sẽ trống cho người khác chọn.', 'Huỷ chỗ', true))) return;
    busy = true;
    const { error } = await call(sb, 'seat_room_cancel', { p_code: G.code, p_token: token });
    busy = false;
    if (error) { toast(errText(error), true); return loadGuest(false); }
    toast('Đã huỷ chỗ');
    loadGuest(false);
  }

  $('gRename').onclick = () => {
    const body = openDlg(`<h2>Đổi tên</h2><form id="rnForm"><label class="f">Họ và tên<input name="name" required minlength="2" maxlength="60" value="${esc(G.name)}"/></label>
      <div class="acts"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary">Lưu</button></div></form>`);
    body.querySelector('#rnForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = e.currentTarget.name.value.trim().replace(/\s+/g, ' ');
      const m = G.room.mine;
      if (m) {
        const { error } = await call(sb, 'seat_room_take', { p_code: G.code, p_row: m[0], p_col: m[1], p_name: name, p_token: token });
        if (error) { toast(errText(error), true); return; }
      }
      G.name = name; store.set('seat-name', name);
      settle(false); toast('Đã đổi tên'); loadGuest(false); drawGuest();
    };
  };
  $('gIn').onclick = () => { G.zoom = Math.min(2.2, G.zoom * 1.2); drawGuest(); };
  $('gOut').onclick = () => { G.zoom = Math.max(0.5, G.zoom / 1.2); drawGuest(); };

  window.addEventListener('resize', () => {
    if (H && H.room && !$('v-host').hidden) S.fit($('hScroll'), H.room.cols, H.zoom);
    if (G && G.room && !$('v-guest').hidden) S.fit($('gScroll'), G.room.cols, G.zoom);
  });
  window.addEventListener('online', () => { netReset(); if (H && !$('v-host').hidden) loadHost(); if (G && !$('v-guest').hidden) loadGuest(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    netReset();      // vừa mở lại tab: không báo lỗi cũ, tải lại ngay
    if (H && !$('v-host').hidden) loadHost();
    if (G && !$('v-guest').hidden) loadGuest(false);
  });

  // Bản thuần web: gỡ bộ nhớ đệm của bản "app" cũ nếu máy từng mở (để luôn tải bản mới nhất)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('seat-')).forEach((k) => caches.delete(k))).catch(() => {});
  }

  route();
  housekeep();
})();
