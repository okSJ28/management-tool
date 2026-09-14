/* ============================================================
   util.js - DOM / 日付 / 数値 のユーティリティ
   ============================================================ */
(function (global) {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (Array.isArray(children) ? children : children === undefined ? [] : [children])
      .forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      });
    return node;
  }

  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ------------------------------------------------ 日付 */
  var MS_DAY = 86400000;

  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    var m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  function iso(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function diffDays(a, b) { return Math.round((b - a) / MS_DAY); }
  function monthKey(v) { var d = parseDate(v); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) : ''; }
  function monthLabel(key) { var p = String(key).split('-'); return p[0] + '/' + (+p[1]); }
  function fmtDate(v) { var d = parseDate(v); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; }
  function fmtDateFull(v) { var d = parseDate(v); return d ? iso(d) : ''; }
  function isWeekend(d) { var w = d.getDay(); return w === 0 || w === 6; }

  function fiscalYear(d, startMonth) {
    startMonth = startMonth || 4;
    return d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  }
  function fiscalMonths(year, startMonth) {
    startMonth = startMonth || 4;
    var out = [];
    for (var i = 0; i < 12; i++) {
      var m = startMonth + i, y = year;
      if (m > 12) { m -= 12; y += 1; }
      out.push(y + '-' + pad(m));
    }
    return out;
  }

  /* ------------------------------------------------ 数値 */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  function fmtNum(v, dec) {
    var n = num(v);
    if (n === null) return '';
    dec = dec === undefined ? (Math.abs(n) < 10 && n % 1 !== 0 ? 1 : 0) : dec;
    return n.toLocaleString('ja-JP', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function sum(arr, fn) {
    return arr.reduce(function (a, x) { var v = num(fn ? fn(x) : x); return a + (v || 0); }, 0);
  }
  function avg(arr, fn) {
    var vals = arr.map(function (x) { return num(fn ? fn(x) : x); }).filter(function (v) { return v !== null; });
    return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  }
  function groupBy(arr, fn) {
    var map = new Map();
    arr.forEach(function (x) {
      var k = fn(x);
      if (k === null || k === undefined || k === '') k = '(未設定)';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    });
    return map;
  }
  function uniq(arr) { return Array.from(new Set(arr.filter(function (x) { return x !== null && x !== undefined && x !== ''; }))); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  }

  /* ------------------------------------------------ 色 */
  var PALETTE = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626',
    '#db2777', '#4f46e5', '#059669', '#ca8a04', '#9333ea', '#0d9488',
    '#e11d48', '#65a30d', '#0284c7', '#b45309'];

  function colorOf(key, offset) {
    var s = String(key), hash = 0;
    for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[(hash + (offset || 0)) % PALETTE.length];
  }
  function initials(name) {
    var s = String(name || '?').replace(/[\s()（）]/g, '');
    return s.slice(0, 2);
  }

  /* ------------------------------------------------ UI */
  function toast(msg, kind, ms) {
    var box = document.getElementById('toasts');
    var t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    box.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s'; t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, ms || 2800);
  }

  function loading(on, message) {
    document.getElementById('loading').hidden = !on;
    var msg = document.getElementById('loadingMsg');
    if (msg) msg.textContent = on ? (message || '') : '';
  }

  function confirmDialog(title, message, okLabel) {
    return new Promise(function (resolve) {
      var backdrop = document.getElementById('modalBackdrop');
      var modal = document.getElementById('modal');
      clear(modal);
      modal.appendChild(el('div', { class: 'card-head' }, [el('h3', { text: title })]));
      modal.appendChild(el('div', { class: 'card-body', text: message }));
      var foot = el('div', { class: 'drawer-foot' });
      foot.appendChild(el('div', { class: 'spacer' }));
      foot.appendChild(el('button', { class: 'btn', text: 'キャンセル', onclick: function () { close(false); } }));
      foot.appendChild(el('button', { class: 'btn btn-danger', text: okLabel || 'OK', onclick: function () { close(true); } }));
      modal.appendChild(foot);
      backdrop.hidden = false;
      function close(v) { backdrop.hidden = true; resolve(v); }
      backdrop.onclick = function (e) { if (e.target === backdrop) close(false); };
    });
  }

  function openDrawer(title, bodyNode, footNodes) {
    var backdrop = document.getElementById('drawerBackdrop');
    var drawer = document.getElementById('drawer');
    clear(drawer);
    var head = el('div', { class: 'drawer-head' }, [
      el('h2', { text: title }),
      el('div', { class: 'spacer', style: { flex: 1 } }),
      el('button', { class: 'icon-btn', text: '✕', onclick: closeDrawer })
    ]);
    drawer.appendChild(head);
    drawer.appendChild(el('div', { class: 'drawer-body' }, [bodyNode]));
    if (footNodes && footNodes.length) drawer.appendChild(el('div', { class: 'drawer-foot' }, footNodes));
    drawer.hidden = false; backdrop.hidden = false;
    backdrop.onclick = closeDrawer;
  }
  function closeDrawer() {
    document.getElementById('drawer').hidden = true;
    document.getElementById('drawerBackdrop').hidden = true;
  }

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  global.U = {
    el: el, h: h, esc: esc, clear: clear, $: $, $$: $$,
    today: today, parseDate: parseDate, iso: iso, pad: pad, addDays: addDays, diffDays: diffDays,
    monthKey: monthKey, monthLabel: monthLabel, fmtDate: fmtDate, fmtDateFull: fmtDateFull,
    isWeekend: isWeekend, fiscalYear: fiscalYear, fiscalMonths: fiscalMonths, MS_DAY: MS_DAY,
    num: num, fmtNum: fmtNum, sum: sum, avg: avg, groupBy: groupBy, uniq: uniq, debounce: debounce,
    PALETTE: PALETTE, colorOf: colorOf, initials: initials,
    toast: toast, loading: loading, confirmDialog: confirmDialog,
    openDrawer: openDrawer, closeDrawer: closeDrawer, download: download
  };
})(window);
