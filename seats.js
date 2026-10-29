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

  // Gọi hàm trên máy chủ; luôn trả { data, error } kể cả khi mất mạng
  async function call(sb, fn, args) {
    try { return await sb.rpc(fn, args); } catch (e) { return { data: null, error: e }; }
  }

  const rowLabel = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const seatName = (r, c) => `${rowLabel(r)}${c}`;
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
  function isOffline(e) { return /Failed to fetch|NetworkError|Load failed|network/i.test(e?.message || String(e)); }
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
     opts.host = true : bấm được mọi ghế (quản lý), hiện chữ viết tắt tên
     opts.onSeat(r, c, state, info) với state: free | taken | blocked | mine */
  function render(el, map, opts = {}) {
    const taken = new Map(map.taken.map((t) => [t[0] + ',' + t[1], t]));
    const blocked = new Set(map.blocked.map((b) => b[0] + ',' + b[1]));
    const mine = map.mine ? map.mine[0] + ',' + map.mine[1] : null;
    const canChange = map.open && map.allow_change !== false;
    const canPick = map.open && (!map.mine || canChange);
    const lw = window.innerWidth <= 640 ? 16 : 24;
    el.style.gridTemplateColumns = `${lw}px repeat(${map.cols}, var(--s)) ${lw}px`;
    const parts = ['<span class="lab row"></span>'];
    for (let c = 1; c <= map.cols; c++) parts.push(`<span class="lab">${c}</span>`);
    parts.push('<span class="lab row"></span>');
    for (let r = 1; r <= map.rows; r++) {
      const L = rowLabel(r);
      parts.push(`<span class="lab row">${L}</span>`);
      for (let c = 1; c <= map.cols; c++) {
        const k = r + ',' + c, name = L + c, t = taken.get(k);
        let cls = '', title = `${name} · Trống`, dis = !opts.host && !canPick, txt = c;
        if (k === mine) { cls = 'm'; title = `${name} · Chỗ của bạn${canChange ? ' (bấm để huỷ)' : ''}`; dis = !canChange; txt = '✓'; }
        else if (t) {
          cls = 't'; title = `${name} · Đã có người${t[2] ? ': ' + t[2] : ''}`; dis = !opts.host;
          txt = opts.host ? esc((t[2] || '?').trim().split(/\s+/).pop().slice(0, 2)) : '';
        } else if (blocked.has(k)) { cls = 'b'; title = `${name} · Không sử dụng`; dis = !opts.host; txt = ''; }
        parts.push(`<button class="seat ${cls}" data-r="${r}" data-c="${c}" title="${esc(title)}" aria-label="${esc(title)}" ${dis ? 'disabled' : ''}>${txt}</button>`);
      }
      parts.push(`<span class="lab row">${L}</span>`);
    }
    el.innerHTML = parts.join('');
    el.classList.toggle('host', !!opts.host);
    el.onclick = (e) => {
      const b = e.target.closest('.seat');
      if (!b || b.disabled || !opts.onSeat) return;
      const r = +b.dataset.r, c = +b.dataset.c, k = r + ',' + c;
      const state = k === mine ? 'mine' : taken.has(k) ? 'taken' : blocked.has(k) ? 'blocked' : 'free';
      opts.onSeat(r, c, state, taken.get(k));
    };
    const total = map.rows * map.cols - map.blocked.length;
    return { total, taken: map.taken.length, free: total - map.taken.length };
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
      ['STT', 'Ghế', 'Hàng', 'Cột', 'Họ tên', 'Thời gian chọn'].map(q).join(','),
      ...rows.map((t, i) => [i + 1, seatName(t[0], t[1]), rowLabel(t[0]), t[1], t[2], fmtDT(t[3])].map(q).join(',')),
    ];
    return '﻿' + lines.join('\r\n');
  }
  function fileName(room) {
    const slug = String(room.title || 'cho-ngoi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'cho-ngoi';
    const d = new Date(room.ended_at || Date.now());
    return `${slug}_${normCode(room.code)}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
  }
  // Tải file về máy. share=true: trên điện thoại mở bảng chia sẻ (lưu vào Files/Drive/Zalo...)
  async function saveFile(room, share) {
    const name = fileName(room);
    const blob = new Blob([roomCsv(room)], { type: 'text/csv;charset=utf-8' });
    if (share && navigator.canShare) {
      const file = new File([blob], name, { type: 'text/csv' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: room.title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return 'downloaded';
  }

  window.Seats = { ok, client, call, rowLabel, seatName, esc, normCode, showCode, toast, errCode, errText, isOffline, render, fit, store, deviceToken, fmtDT, fmtLeft, saveFile };
})();
