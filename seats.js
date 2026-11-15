/* Lõi dùng chung: kết nối, vẽ sơ đồ, lỗi, lưu trên máy, xuất file */
'use strict';
(function () {
  const cfg = window.SEAT_CONFIG || {};
  const ok = /^https:\/\/.+/.test(cfg.url || '') && !cfg.url.includes('YOUR-') && cfg.key && !String(cfg.key).includes('YOUR-');

  function client() {
    if (!ok || !window.supabase) return null;
    return window.supabase.createClient(cfg.url.replace(/\/+$/, ''), cfg.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  // Gọi hàm trên máy chủ; luôn trả { data, error } kể cả khi mất mạng.
  // Chờ tối đa 15 giây. opts.retry: lỗi mạng thì thử lại 1 lần sau 1,5 giây (chỉ dùng cho lệnh xem).
  async function call(sb, fn, args, opts = {}) {
    const once = async () => {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), opts.timeout || 15000) : 0;
      try {
        let q = sb.rpc(fn, args);
        if (ctl && q && typeof q.abortSignal === 'function') q = q.abortSignal(ctl.signal);
        return await q;
      } catch (e) { return { data: null, error: e }; } finally { clearTimeout(t); }
    };
    let res = await once();
    if (opts.retry && res.error && isOffline(res.error)) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await once();
    }
    return res;
  }

  /* Phòng đã kết thúc: host bấm "Kết thúc" (ghi dấu vào đầu ghi chú) hoặc hết giờ.
     Sau khi kết thúc, mọi người vẫn xem được thêm KEEP_MS rồi phòng bị xoá. */
  const KEEP_MS = 2 * 3600 * 1000;
  const END_TAG = '⏹END:';
  function endInfo(room) {
    const raw = (room && room.note) || '';
    const m = raw.startsWith(END_TAG) ? /^⏹END:(\S+)\n?/.exec(raw) : null;
    const note = m ? raw.slice(m[0].length) : raw;
    let at = m ? Date.parse(m[1]) : NaN;
    if (!(at > 0) && room && room.expired) at = Date.parse(room.expires_at);
    const ended = at > 0;
    return { ended, at: ended ? at : 0, until: ended ? at + KEEP_MS : 0, note };
  }

  const rowLabel = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  /* Phân tích sơ đồ: ô nào là ghế, tên ghế (hàng chỉ tính các hàng có ghế, số ghế bỏ qua lối đi) */
  const layoutCache = new WeakMap();
  function layoutOf(map) {
    if (layoutCache.has(map)) return layoutCache.get(map);
    const blocked = new Set((map.blocked || []).map((b) => b[0] + ',' + b[1]));
    const covered = new Set();
    for (const z of map.labels || []) for (let r = z.r; r < z.r + z.h; r++) for (let c = z.c; c < z.c + z.w; c++) covered.add(r + ',' + c);
    const names = new Map(), num = new Map(), rowL = new Map();
    let ri = 0, seats = 0;
    for (let r = 1; r <= map.rows; r++) {
      let n = 0;
      for (let c = 1; c <= map.cols; c++) {
        const k = r + ',' + c;
        if (blocked.has(k) || covered.has(k)) continue;
        if (!n) { ri++; rowL.set(r, rowLabel(ri)); }
        n++; seats++;
        names.set(k, rowL.get(r) + n); num.set(k, n);
      }
    }
    const L = { blocked, covered, names, num, rowL, seats };
    layoutCache.set(map, L);
    return L;
  }
  const seatName = (map, r, c) => layoutOf(map).names.get(r + ',' + c) || `${rowLabel(r)}${c}`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const showCode = (c) => { const n = normCode(c); return n.length === 8 ? n.slice(0, 4) + '-' + n.slice(4) : n; };

  function toast(text, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), err ? 5000 : 2800);
  }

  const ERR = {
    NO_ROOM: 'Mã phòng không đúng, hoặc phòng đã kết thúc.',
    BAD_KEY: 'Máy này không phải máy host của phòng.',
    EXPIRED: 'Phòng đã hết giờ.',
    TAKEN: 'Ghế này vừa có người chọn trước. Vui lòng chọn ghế khác.',
    ALREADY: 'Bạn đã có ghế, và phòng này không cho đổi chỗ.',
    LOCKED: 'Phòng này không cho đổi hoặc huỷ chỗ.',
    CLOSED: 'Host đang tạm khoá chọn chỗ.',
    BLOCKED: 'Ghế này không sử dụng.',
    BAD_NAME: 'Họ tên cần từ 2 đến 60 ký tự.',
    BAD_SEAT: 'Ghế không hợp lệ.',
    BAD_SIZE: 'Số hàng/cột phải từ 1 đến 60.',
    BAD_TIME: 'Thời gian host từ 5 phút đến 7 ngày.',
    TOO_MANY: 'Hệ thống đang có quá nhiều phòng. Vui lòng thử lại sau.',
    TRY_AGAIN: 'Có lỗi tạm thời, vui lòng thử lại.',
    BAD_TOKEN: 'Trình duyệt không hỗ trợ. Hãy thử trình duyệt khác.',
  };
  function errCode(e) { const m = e?.message || String(e); return Object.keys(ERR).find((k) => m.includes(k)) || null; }
  function isOffline(e) { return /Failed to fetch|NetworkError|Load failed|network|abort|timed? ?out|ERR_/i.test((e?.name || '') + ' ' + (e?.message || String(e))); }
  function errText(e) {
    const k = errCode(e);
    if (k) return ERR[k];
    const m = e?.message || String(e);
    const out = m.match(/SEATS_OUTSIDE:(\d+)/);
    if (out) return `Còn ${out[1]} ghế đã có người nằm ngoài kích thước mới. Hãy giải phóng các ghế đó trước.`;
    if (isOffline(e)) return 'Không có mạng. Kiểm tra kết nối rồi thử lại.';
    if (/Could not find the function|does not exist/i.test(m)) return 'Máy chủ chưa được cài đặt.';
    return m;
  }

  /* Vẽ sơ đồ.
     opts.host = true : bấm được mọi ô (quản lý), hiện chữ viết tắt tên, hiện ô lối đi mờ
     opts.onSeat(r, c, state, info) với state: free | taken | blocked | mine */
  function render(el, map, opts = {}) {
    const L = layoutOf(map);
    const taken = new Map(map.taken.map((t) => [t[0] + ',' + t[1], t]));
    const mine = map.mine ? map.mine[0] + ',' + map.mine[1] : null;
    const canChange = map.open && map.allow_change !== false;
    const canPick = map.open && (!map.mine || canChange);
    const lw = window.innerWidth <= 640 ? 16 : 24;
    el.style.gridTemplateColumns = `${lw}px repeat(${map.cols}, var(--s)) ${lw}px`;
    el.style.gridTemplateRows = `repeat(${map.rows}, var(--s))`;
    const parts = [];
    for (let r = 1; r <= map.rows; r++) {
      const RL = L.rowL.get(r);
      if (RL) {
        parts.push(`<span class="lab" style="grid-area:${r}/1">${RL}</span><span class="lab" style="grid-area:${r}/${map.cols + 2}">${RL}</span>`);
      }
      for (let c = 1; c <= map.cols; c++) {
        const k = r + ',' + c;
        if (L.covered.has(k)) continue;
        const pos = `style="grid-area:${r}/${c + 1}" data-r="${r}" data-c="${c}"`;
        if (L.blocked.has(k)) {
          if (opts.host) parts.push(`<button class="seat b" ${pos} title="Lối đi (bấm để thành ghế)"></button>`);
          continue;
        }
        const name = L.names.get(k), t = taken.get(k);
        let cls = '', title = `Ghế ${name} · Trống`, dis = !opts.host && !canPick, txt = L.num.get(k);
        if (k === mine) { cls = 'm'; title = `Ghế ${name} · Chỗ của bạn${canChange ? ' (bấm để huỷ)' : ''}`; dis = !canChange; txt = '✓'; }
        else if (t) {
          cls = 't'; title = `Ghế ${name} · Đã có người${t[2] ? ': ' + t[2] : ''}`; dis = !opts.host;
          txt = opts.host ? esc((t[2] || '?').trim().split(/\s+/).pop().slice(0, 2)) : '';
        }
        parts.push(`<button class="seat ${cls}" ${pos} title="${esc(title)}" aria-label="${esc(title)}" ${dis ? 'disabled' : ''}>${txt}</button>`);
      }
    }
    for (const z of map.labels || []) {
      parts.push(`<div class="zone k-${esc(z.k || 'info')}" style="grid-area:${z.r}/${z.c + 1}/span ${z.h}/span ${z.w}" title="${esc(z.t)}"><span>${esc(z.t)}</span></div>`);
    }
    el.innerHTML = parts.join('');
    el.classList.toggle('host', !!opts.host);
    el.onclick = (e) => {
      const b = e.target.closest('.seat');
      if (!b || b.disabled || !opts.onSeat) return;
      const r = +b.dataset.r, c = +b.dataset.c, k = r + ',' + c;
      const state = k === mine ? 'mine' : taken.has(k) ? 'taken' : L.blocked.has(k) ? 'blocked' : 'free';
      opts.onSeat(r, c, state, taken.get(k));
    };
    return { total: L.seats, taken: map.taken.length, free: L.seats - map.taken.length };
  }

  // Cỡ ghế vừa bề ngang; trên điện thoại tối thiểu 22px cho dễ bấm (vuốt ngang để xem hết)
  function fit(scrollEl, cols, zoom = 1) {
    const small = window.innerWidth <= 640;
    const avail = scrollEl.clientWidth - (small ? 40 : 56);
    const base = Math.floor(avail / cols) - (small ? 2 : 3);
    const s = Math.max(small ? 22 : 18, Math.min(40, base)) * zoom;
    scrollEl.style.setProperty('--s', Math.round(Math.max(10, Math.min(64, s))) + 'px');
  }

  // Lưu trên máy (an toàn khi trình duyệt chặn bộ nhớ)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  };

  function deviceToken() {
    let t = store.get('seat-token', null);
    if (!t) {
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      t = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      store.set('seat-token', t);
    }
    return t;
  }

  const fmtDT = (s) => s ? new Date(s).toLocaleString('vi-VN', { hour12: false }) : '';
  const fmtHM = (s) => { const d = new Date(s); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`; };
  function fmtLeft(ms) {
    if (ms <= 0) return 'Hết giờ';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return d ? `${d} ngày ${p(h)}:${p(m)}` : h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
  }

  // Bảng CSV (Excel mở được tiếng Việt nhờ BOM)
  function roomCsv(room) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [...room.taken].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lines = [
      [q('Buổi'), q(room.title)].join(','),
      [q('Mã phòng'), q(showCode(room.code))].join(','),
      [q('Kết thúc'), q(fmtDT(room.ended_at || new Date()))].join(','),
      [q('Số người'), q(rows.length)].join(','),
      '',
      ['STT', 'Ghế', 'Họ tên', 'Thời gian chọn'].map(q).join(','),
      ...rows.map((t, i) => [i + 1, seatName(room, t[0], t[1]), t[2], fmtDT(t[3])].map(q).join(',')),
    ];
    return '﻿' + lines.join('\r\n');
  }
  function fileName(room, ext = 'csv') {
    const slug = String(room.title || 'cho-ngoi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'cho-ngoi';
    const d = new Date(room.ended_at || Date.now());
    return `${slug}_${normCode(room.code)}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.${ext}`;
  }

  /* ---------- Excel (.xlsx) theo đúng sơ đồ — tự tạo file, không cần thư viện ----------
     Sheet "Sơ đồ": mỗi ô sơ đồ = 1 ô Excel. Ghế ghi tên người chọn, khối ghi chú (BẢNG, CỬA…) gộp ô,
     lối đi liền nhau gộp thành 1 ô trống. Sheet "Danh sách": STT · Ghế · Họ tên · Thời gian chọn. */
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const d = new Date();
    const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const size = central.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const xesc = (t) => String(t ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const ref = (r, c) => rowLabel(c) + r;
  // Kiểu ô (thứ tự khớp cellXfs trong styles.xml)
  const X = { title: 1, sub: 2, seat: 3, free: 4, zone: 5, head: 6, cell: 7, center: 8, key: 9 };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FF4C1D95"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE9FE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF6B7280"/></left><right style="thin"><color rgb="FF6B7280"/></right><top style="thin"><color rgb="FF6B7280"/></top><bottom style="thin"><color rgb="FF6B7280"/></bottom><diagonal/></border><border><left style="medium"><color rgb="FF7C3AED"/></left><right style="medium"><color rgb="FF7C3AED"/></right><top style="medium"><color rgb="FF7C3AED"/></top><bottom style="medium"><color rgb="FF7C3AED"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function Sheet() {
    const cells = new Map(), merges = [], colW = {}, rowH = {};
    return {
      set(r, c, v, s) { if (!cells.has(r)) cells.set(r, new Map()); cells.get(r).set(c, { v, s }); },
      merge(r1, c1, r2, c2) { if (r2 > r1 || c2 > c1) merges.push(`${ref(r1, c1)}:${ref(r2, c2)}`); },
      colW, rowH,
      xml(landscape) {
        const cols = Object.keys(colW).map(Number).sort((a, b) => a - b)
          .map((c) => `<col min="${c}" max="${c}" width="${colW[c]}" customWidth="1"/>`).join('');
        const rowsNo = [...new Set([...cells.keys(), ...Object.keys(rowH).map(Number)])].sort((a, b) => a - b);
        const data = rowsNo.map((r) => {
          const row = cells.get(r) || new Map();
          const cs = [...row.keys()].sort((a, b) => a - b).map((c) => {
            const { v, s } = row.get(c), st = s ? ` s="${s}"` : '';
            if (v === '' || v == null) return `<c r="${ref(r, c)}"${st}/>`;
            if (typeof v === 'number') return `<c r="${ref(r, c)}"${st}><v>${v}</v></c>`;
            return `<c r="${ref(r, c)}"${st} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
          }).join('');
          const h = rowH[r] ? ` ht="${rowH[r]}" customHeight="1"` : '';
          return `<row r="${r}"${h}>${cs}</row>`;
        }).join('');
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
          + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>`
          + (cols ? `<cols>${cols}</cols>` : '') + `<sheetData>${data}</sheetData>`
          + (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
          + `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>`
          + `<pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
      },
    };
  }

  function mapSheet(room) {
    const L = layoutOf(room);
    const taken = new Map((room.taken || []).map((t) => [t[0] + ',' + t[1], t]));
    const sh = Sheet(), cols = Math.max(1, room.cols), top = 3;   // hàng 1: tên buổi · hàng 2: thông tin · sơ đồ từ hàng 4
    sh.set(1, 1, room.title || 'Sơ đồ chỗ ngồi', X.title); sh.merge(1, 1, 1, cols); sh.rowH[1] = 24;
    const info = `Mã phòng ${showCode(room.code)} · ${(room.taken || []).length}/${L.seats} ghế có người · ${room.ended_at ? 'Kết thúc ' : 'Xuất lúc '}${fmtDT(room.ended_at || new Date())}`;
    sh.set(2, 1, info, X.sub); sh.merge(2, 1, 2, cols);
    for (let c = 2; c <= cols; c++) { sh.set(1, c, '', X.title); sh.set(2, c, '', X.sub); }
    // Khối ghi chú (BẢNG, SÂN KHẤU, CỬA…): gộp ô
    for (const z of room.labels || []) {
      const r2 = Math.min(z.r + z.h - 1, room.rows), c2 = Math.min(z.c + z.w - 1, room.cols);
      for (let r = z.r; r <= r2; r++) for (let c = z.c; c <= c2; c++) sh.set(top + r, c, r === z.r && c === z.c ? z.t || '' : '', X.zone);
      sh.merge(top + z.r, z.c, top + r2, c2);
    }
    // Ghế: ghi tên người chọn
    const seatCols = new Set(), seatRows = new Set(), zoneRows = new Set();
    for (const z of room.labels || []) for (let r = z.r; r < z.r + z.h; r++) zoneRows.add(r);
    for (let r = 1; r <= room.rows; r++) for (let c = 1; c <= room.cols; c++) {
      const k = r + ',' + c;
      if (L.covered.has(k) || L.blocked.has(k)) continue;
      const t = taken.get(k);
      sh.set(top + r, c, t ? (t[2] || '?') : '', t ? X.seat : X.free);
      seatCols.add(c); seatRows.add(r);
    }
    // Lối đi: các ô liền nhau gộp thành 1 ô trống (ưu tiên gộp theo cột dọc)
    const used = new Set();
    const isAisle = (r, c) => r <= room.rows && c <= room.cols && L.blocked.has(r + ',' + c) && !L.covered.has(r + ',' + c) && !used.has(r + ',' + c);
    for (let c = 1; c <= room.cols; c++) for (let r = 1; r <= room.rows; r++) {
      if (!isAisle(r, c)) continue;
      let r2 = r; while (isAisle(r2 + 1, c)) r2++;
      let c2 = c;
      const colFree = (cc) => { for (let rr = r; rr <= r2; rr++) if (!isAisle(rr, cc)) return false; return true; };
      while (colFree(c2 + 1)) c2++;
      for (let rr = r; rr <= r2; rr++) for (let cc = c; cc <= c2; cc++) used.add(rr + ',' + cc);
      sh.merge(top + r, c, top + r2, c2);
    }
    for (let c = 1; c <= room.cols; c++) sh.colW[c] = seatCols.has(c) ? 16 : 4;
    for (let r = 1; r <= room.rows; r++) sh.rowH[top + r] = seatRows.has(r) ? 32 : zoneRows.has(r) ? 26 : 12;
    return sh.xml(room.cols > 6);
  }

  function listSheet(room) {
    const sh = Sheet();
    const rows = [...(room.taken || [])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    [['Buổi', room.title], ['Mã phòng', showCode(room.code)], [room.ended_at ? 'Kết thúc' : 'Xuất lúc', fmtDT(room.ended_at || new Date())], ['Số người', rows.length]]
      .forEach(([k, v], i) => { sh.set(i + 1, 1, k, X.key); sh.set(i + 1, 2, v); sh.merge(i + 1, 2, i + 1, 4); });
    ['STT', 'Ghế', 'Họ tên', 'Thời gian chọn'].forEach((h, i) => sh.set(6, i + 1, h, X.head));
    rows.forEach((t, i) => {
      sh.set(7 + i, 1, i + 1, X.center); sh.set(7 + i, 2, seatName(room, t[0], t[1]), X.center);
      sh.set(7 + i, 3, t[2] || '', X.cell); sh.set(7 + i, 4, fmtDT(t[3]), X.cell);
    });
    Object.assign(sh.colW, { 1: 10, 2: 10, 3: 32, 4: 22 });
    return sh.xml(false);
  }

  function roomXlsx(room) {
    const hasMap = room.rows > 0 && room.cols > 0;
    const sheets = hasMap ? [['Sơ đồ', mapSheet(room)], ['Danh sách', listSheet(room)]] : [['Danh sách', listSheet(room)]];
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map(([n], i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map(([, xml], i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
    ];
    return zip(files);
  }

  // Tải file về máy. fmt: 'xlsx' (Excel theo sơ đồ) | 'csv' (danh sách).
  // share=true: trên điện thoại mở bảng chia sẻ (lưu vào Files/Drive/Zalo...)
  async function saveFile(room, share, fmt = 'csv') {
    const xl = fmt === 'xlsx';
    const name = fileName(room, xl ? 'xlsx' : 'csv');
    const blob = xl ? roomXlsx(room) : new Blob([roomCsv(room)], { type: 'text/csv;charset=utf-8' });
    if (share && navigator.canShare) {
      const file = new File([blob], name, { type: blob.type.split(';')[0] });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: room.title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }

  window.Seats = { ok, client, call, rowLabel, seatName, layoutOf, esc, normCode, showCode, toast, errCode, errText, isOffline, render, fit, store, deviceToken, fmtDT, fmtHM, fmtLeft, saveFile, roomXlsx, endInfo, KEEP_MS, END_TAG };
})();
