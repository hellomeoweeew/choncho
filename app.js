/* App chọn chỗ: Host tạo phòng → mã phòng → Guest nhập mã, ghi tên, chọn ghế.
   Kết thúc (bấm hoặc hết giờ): tải danh sách về máy host, xoá phòng khỏi máy chủ. */
'use strict';
(function () {
  const S = window.Seats;
  const { call, store, esc, toast, errText, errCode, isOffline, showCode, normCode, seatName, fmtDT, fmtLeft } = S;
  const $ = (id) => document.getElementById(id);
  const sb = S.client();
  if (!sb) { document.querySelector('.wrap').innerHTML = '<div class="card">Chưa cấu hình máy chủ (config.js).</div>'; return; }
  const token = S.deviceToken();

  /* ---------- Lưu trên máy ---------- */
  const hosted = () => store.get('seat-hosted', []);            // [{code, key, title, expires_at}]
  const setHosted = (v) => store.set('seat-hosted', v);
  const removeHosted = (code) => setHosted(hosted().filter((x) => x.code !== code));
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
    const [, page, arg] = (location.hash || '#/').split('/');
    if (page === 'create') {
      show('create');
      if (!createEd) createEd = window.LayoutEditor($('createLayout'), window.LayoutEditor.defaults()); else createEd.redraw();
      return;
    }
    if (page === 'host' && arg) return openHost(normCode(arg));
    if (page === 'join' && arg) return openJoin(normCode(arg));
    renderHome();
  }
  window.addEventListener('hashchange', route);
  $('backBtn').onclick = () => { location.hash = '#/'; };
  const setOffline = (err) => { $('offline').hidden = !(err && isOffline(err)); };

  /* ================= TRANG ĐẦU ================= */
  function renderHome() {
    show('home');
    document.title = 'Chọn chỗ';
    const now = Date.now();
    const hs = hosted();
    $('hostedBox').hidden = !hs.length;
    $('hostedList').innerHTML = hs.map((h) => {
      const left = Date.parse(h.expires_at) - now;
      return `<div class="item"><div class="grow"><b>${esc(h.title)}</b><small>Mã ${showCode(h.code)} · ${left > 0 ? 'còn ' + fmtLeft(left) : 'hết giờ — đang xuất…'}</small></div>
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
      <button class="btn sm" data-dl="${i}">Tải .csv</button><button class="btn sm ghost" data-del="${i}" aria-label="Xoá khỏi máy">✕</button></div>`).join('');
    $('historyList').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => S.saveFile(history()[+b.dataset.dl], true)));
    $('historyList').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const r = history()[+b.dataset.del];
      if (!(await ask('Xoá khỏi máy?', `Xoá danh sách <b>${esc(r.title)}</b> khỏi máy này. Máy chủ đã không còn bản nào.`, 'Xoá', true))) return;
      store.set('seat-history', history().filter((x) => x.code !== r.code));
      renderHome();
    }));
    // Phòng đã hết giờ: xuất về máy + xoá khỏi máy chủ
    hs.filter((h) => Date.parse(h.expires_at) <= now).forEach((h) => endRoom(h, true));
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
    H = { ...h, room: null, zoom: 1, ending: false, retryAt: 0 };
    show('host');
    $('hCode').textContent = showCode(code);
    $('hTitle').textContent = h.title;
    $('hGrid').innerHTML = '<p class="note">Đang tải…</p>';
    await loadHost();
    timers.push(setInterval(() => { if (!document.hidden && !dlg.open) loadHost(); }, 4000));
    timers.push(setInterval(tickHost, 1000));
  }

  async function loadHost() {
    if (!H) return;
    const { data, error } = await call(sb, 'seat_room_host_view', { p_code: H.code, p_key: H.key });
    setOffline(error);
    if (error) {
      if (isOffline(error)) return;
      const c = errCode(error);
      if (c === 'NO_ROOM' || c === 'BAD_KEY') { removeHosted(H.code); toast('Phòng không còn trên máy chủ.', true); location.hash = '#/'; }
      else toast(errText(error), true);
      return;
    }
    H.room = data;
    H.offset = Date.parse(data.now) - Date.now();
    setHosted(hosted().map((x) => (x.code === H.code ? { ...x, title: data.title, expires_at: data.expires_at } : x)));
    drawHost();
  }

  function drawHost() {
    const r = H.room;
    document.title = r.title + ' · Host';
    $('hTitle').textContent = r.title;
    $('hNote').textContent = r.note || '';
    $('hStatus').textContent = r.expired ? 'Hết giờ' : r.is_open ? 'Đang mở' : 'Tạm khoá';
    $('hStatus').className = 'pill' + (r.open ? '' : ' off');
    $('hToggle').textContent = r.is_open ? 'Tạm khoá' : 'Mở lại';
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
      <td style="text-align:right"><button class="btn sm danger" data-free="${t[0]},${t[1]}">Giải phóng</button></td></tr>`).join('')
      || '<tr><td colspan="4" class="note">Chưa có ai chọn.</td></tr>';
  }
  $('hQ').oninput = () => H && H.room && drawHostList();
  $('hList').onclick = (e) => { const b = e.target.closest('[data-free]'); if (b) { const [r, c] = b.dataset.free.split(',').map(Number); hostFree(r, c); } };

  function tickHost() {
    if (!H || !H.room) return;
    const left = Date.parse(H.room.expires_at) - (Date.now() + (H.offset || 0));
    $('hTimer').textContent = left > 0 ? 'Còn ' + fmtLeft(left) : 'Hết giờ';
    $('hTimer').classList.toggle('warn', left > 0 && left < 5 * 60000);
    if (left <= 0 && !H.ending && Date.now() > H.retryAt) endRoom(H, true);
  }

  async function hostSeat(r, c, state, info) {
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
    const p = {
      p_code: H.code, p_key: H.key, p_title: r.title, p_note: r.note, p_rows: r.rows, p_cols: r.cols,
      p_open: r.is_open, p_allow_change: r.allow_change, p_show_names: r.show_names, p_add_minutes: 0, ...patch,
    };
    const { data, error } = await call(sb, 'seat_room_host_update', p);
    if (error) { toast(errText(error), true); return false; }
    H.room = data; H.offset = Date.parse(data.now) - Date.now();
    setHosted(hosted().map((x) => (x.code === H.code ? { ...x, title: data.title, expires_at: data.expires_at } : x)));
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
    if (!(await ask('Kết thúc phòng?', `Danh sách <b>${n} người</b> sẽ được tải về máy này, sau đó phòng bị <b>xoá khỏi máy chủ</b>. Mọi người không chọn được nữa.`, 'Kết thúc & tải về', true))) return;
    endRoom(H, false);
  };

  // Kết thúc: máy chủ trả toàn bộ dữ liệu rồi xoá phòng; app lưu lịch sử + tải file
  const ending = new Set();
  async function endRoom(h, auto) {
    if (ending.has(h.code)) return;
    ending.add(h.code);
    if (H && H.code === h.code) H.ending = true;
    const { data, error } = await call(sb, 'seat_room_end', { p_code: h.code, p_key: h.key });
    ending.delete(h.code);
    if (error) {
      if (H && H.code === h.code) { H.ending = false; H.retryAt = Date.now() + 15000; }
      const c = errCode(error);
      if (c === 'NO_ROOM' || c === 'BAD_KEY') { removeHosted(h.code); if (!auto) toast('Phòng không còn trên máy chủ.', true); }
      else if (!auto) toast(errText(error), true);
      return false;
    }
    addHistory(data);
    removeHosted(h.code);
    await S.saveFile(data, !auto);
    toast(auto ? `"${data.title}" đã hết giờ — danh sách đã lưu về máy, phòng đã xoá khỏi máy chủ.`
      : `Đã kết thúc — danh sách ${data.taken.length} người đã lưu về máy.`);
    if (H && H.code === h.code) { H = null; location.hash = '#/'; }
    else if (!$('v-home').hidden) renderHome();
    return true;
  }

  /* ================= GUEST ================= */
  let G = null;
  async function openJoin(code) {
    G = { code, room: null, zoom: 1, name: store.get('seat-name', ''), gone: false };
    const ok = await loadGuest(true);
    if (!ok) return;
    rememberJoined(G.room);
    if (G.room.mine) { G.name = G.room.mine[2]; showGuest(); } else showNameStep();
  }

  async function loadGuest(first) {
    if (!G || G.gone) return false;
    const { data, error } = await call(sb, 'seat_room_view', { p_code: G.code, p_token: token });
    setOffline(error);
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
    G.offset = Date.parse(data.now) - Date.now();
    if (!$('v-guest').hidden) drawGuest();
    return true;
  }

  function roomGone() {
    G.gone = true;
    clearTimers();
    $('gMine').hidden = false;
    $('gMine').className = 'banner off';
    $('gMine').innerHTML = 'Phòng đã kết thúc. Cảm ơn bạn đã tham gia!';
    $('gStatus').textContent = 'Đã kết thúc'; $('gStatus').className = 'pill off';
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
    timers.push(setInterval(() => { if (!document.hidden && !dlg.open) loadGuest(false); }, 4000));
    timers.push(setInterval(tickGuest, 1000));
  }

  function drawGuest() {
    const r = G.room;
    document.title = r.title;
    $('gCode').textContent = 'PHÒNG ' + showCode(r.code);
    $('gTitle').textContent = r.title;
    $('gNote').textContent = r.note || '';
    $('gName').textContent = G.name;
    $('gStatus').textContent = r.expired ? 'Hết giờ' : r.is_open ? 'Đang mở' : 'Host đang tạm khoá';
    $('gStatus').className = 'pill' + (r.open ? '' : ' off');
    S.fit($('gScroll'), r.cols, G.zoom);
    const s = S.render($('gGrid'), r, { onSeat: (row, col, state) => { if (state === 'free') pickSeat(row, col); else if (state === 'mine') cancelSeat(); } });
    $('gStats').textContent = `Còn ${s.free}/${s.total} ghế trống`;
    const can = r.open && r.allow_change !== false;
    if (r.mine) {
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

  function tickGuest() {
    if (!G || !G.room || G.gone) return;
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
  window.addEventListener('online', () => { if (H && !$('v-host').hidden) loadHost(); if (G && !$('v-guest').hidden) loadGuest(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (H && !$('v-host').hidden) loadHost();
    if (G && !$('v-guest').hidden) loadGuest(false);
  });

  // Bản thuần web: gỡ bộ nhớ đệm của bản "app" cũ nếu máy từng mở (để luôn tải bản mới nhất)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('seat-')).forEach((k) => caches.delete(k))).catch(() => {});
  }

  route();
})();
