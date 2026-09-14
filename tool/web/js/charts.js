/* ============================================================
   charts.js - 依存ライブラリなしのSVGチャート
   ============================================================ */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function n(tag, attrs, children) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }
  function text(x, y, str, attrs) {
    var t = n('text', Object.assign({ x: x, y: y, 'font-size': 11, fill: '#475569' }, attrs || {}));
    t.textContent = str;
    return t;
  }
  function tip(node, str) {
    var t = document.createElementNS(NS, 'title');
    t.textContent = str;
    node.appendChild(t);
    return node;
  }
  function root(w, h) {
    var svg = n('svg', {
      viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h,
      preserveAspectRatio: 'xMidYMid meet', style: 'display:block;max-width:100%'
    });
    return svg;
  }
  function niceMax(v) {
    if (!v || v <= 0) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / exp;
    var step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return step * exp;
  }
  function fmt(v) {
    if (v === null || v === undefined) return '';
    if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + '万';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
    return Math.abs(v) < 10 && v % 1 !== 0 ? v.toFixed(1) : String(Math.round(v * 10) / 10);
  }
  function mount(container, svg) {
    U.clear(container);
    container.appendChild(svg);
    return svg;
  }
  function empty(container, msg) {
    U.clear(container);
    container.appendChild(U.el('div', { class: 'empty', html: '<span class="big">📊</span>' + U.esc(msg || 'データがありません') }));
  }

  /* --------------------------------------------------- 縦棒 */
  function bar(container, opt) {
    var labels = opt.labels || [], values = opt.values || [];
    if (!labels.length) return empty(container);
    var w = opt.width || 780, h = opt.height || 240;
    var pad = { l: 46, r: 12, t: 14, b: 46 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var max = niceMax(Math.max.apply(null, values.concat([0])));
    var svg = root(w, h);
    for (var g = 0; g <= 4; g++) {
      var y = pad.t + ih - (ih * g / 4);
      svg.appendChild(n('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, stroke: '#e2e8f0' }));
      svg.appendChild(text(pad.l - 6, y + 4, fmt(max * g / 4), { 'text-anchor': 'end', 'font-size': 10, fill: '#94a3b8' }));
    }
    var bw = iw / labels.length;
    var barW = Math.min(46, bw * 0.62);
    labels.forEach(function (lab, i) {
      var v = values[i] || 0;
      var bh = max ? (v / max) * ih : 0;
      var x = pad.l + bw * i + (bw - barW) / 2;
      var color = opt.colors ? opt.colors[i] : (opt.color || '#2563eb');
      var rect = n('rect', {
        x: x, y: pad.t + ih - bh, width: barW, height: Math.max(bh, v > 0 ? 1.5 : 0),
        rx: 3, fill: color, opacity: .92
      });
      tip(rect, lab + ' : ' + fmt(v) + (opt.unit || ''));
      svg.appendChild(rect);
      if (opt.showValue !== false && bh > 14) {
        svg.appendChild(text(x + barW / 2, pad.t + ih - bh - 4, fmt(v),
          { 'text-anchor': 'middle', 'font-size': 10, fill: '#334155' }));
      }
      var tx = pad.l + bw * i + bw / 2;
      var lbl = text(tx, h - pad.b + 14, shorten(lab, opt.labelMax || 10),
        { 'text-anchor': 'middle', 'font-size': 10 });
      if (labels.length > 10 || (opt.rotate)) {
        lbl.setAttribute('transform', 'rotate(-35 ' + tx + ' ' + (h - pad.b + 14) + ')');
        lbl.setAttribute('text-anchor', 'end');
      }
      tip(lbl, lab);
      svg.appendChild(lbl);
    });
    svg.appendChild(n('line', { x1: pad.l, y1: pad.t + ih, x2: w - pad.r, y2: pad.t + ih, stroke: '#cbd5e1' }));
    return mount(container, svg);
  }

  /* --------------------------------------------------- 横棒 */
  function hbar(container, opt) {
    var items = (opt.items || []).slice();
    if (!items.length) return empty(container);
    var w = opt.width || 780;
    var rowH = opt.rowH || 24;
    var pad = { l: opt.labelWidth || 150, r: 54, t: 8, b: 8 };
    var h = pad.t + pad.b + items.length * rowH;
    var iw = w - pad.l - pad.r;
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value) || 0; }).concat([0])) || 1;
    var svg = root(w, h);
    items.forEach(function (it, i) {
      var y = pad.t + i * rowH;
      var bw = Math.max((Math.abs(it.value) / max) * iw, it.value ? 2 : 0);
      svg.appendChild(text(pad.l - 8, y + rowH / 2 + 4, shorten(it.label, opt.labelMax || 18),
        { 'text-anchor': 'end', 'font-size': 11, fill: '#334155' }));
      var rect = n('rect', {
        x: pad.l, y: y + 4, width: bw, height: rowH - 9, rx: 3,
        fill: it.color || opt.color || U.colorOf(it.label), opacity: .9
      });
      tip(rect, it.label + ' : ' + fmt(it.value) + (opt.unit || ''));
      svg.appendChild(rect);
      svg.appendChild(text(pad.l + bw + 6, y + rowH / 2 + 4, fmt(it.value) + (opt.unit || ''),
        { 'font-size': 10.5, fill: '#475569' }));
    });
    return mount(container, svg);
  }

  /* --------------------------------------------------- 積み上げ棒 */
  function stacked(container, opt) {
    var labels = opt.labels || [], series = opt.series || [];
    if (!labels.length || !series.length) return empty(container);
    var w = opt.width || 780, h = opt.height || 260;
    var pad = { l: 46, r: 12, t: 14, b: 52 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var totals = labels.map(function (_, i) {
      return series.reduce(function (a, s) { return a + (s.values[i] || 0); }, 0);
    });
    var max = niceMax(Math.max.apply(null, totals.concat([0])));
    var svg = root(w, h);
    for (var g = 0; g <= 4; g++) {
      var y = pad.t + ih - (ih * g / 4);
      svg.appendChild(n('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, stroke: '#e2e8f0' }));
      svg.appendChild(text(pad.l - 6, y + 4, fmt(max * g / 4), { 'text-anchor': 'end', 'font-size': 10, fill: '#94a3b8' }));
    }
    var bw = iw / labels.length, barW = Math.min(48, bw * 0.62);
    labels.forEach(function (lab, i) {
      var acc = 0;
      var x = pad.l + bw * i + (bw - barW) / 2;
      series.forEach(function (s, si) {
        var v = s.values[i] || 0;
        if (!v) return;
        var bh = (v / max) * ih;
        acc += bh;
        var rect = n('rect', {
          x: x, y: pad.t + ih - acc, width: barW, height: bh, rx: 2,
          fill: s.color || U.PALETTE[si % U.PALETTE.length], opacity: .92
        });
        tip(rect, lab + ' / ' + s.name + ' : ' + fmt(v));
        svg.appendChild(rect);
      });
      var tx = pad.l + bw * i + bw / 2;
      var lbl = text(tx, h - pad.b + 14, shorten(lab, 10), { 'text-anchor': 'middle', 'font-size': 10 });
      if (labels.length > 10) {
        lbl.setAttribute('transform', 'rotate(-35 ' + tx + ' ' + (h - pad.b + 14) + ')');
        lbl.setAttribute('text-anchor', 'end');
      }
      svg.appendChild(lbl);
    });
    var lx = pad.l;
    series.forEach(function (s, si) {
      svg.appendChild(n('rect', { x: lx, y: h - 14, width: 9, height: 9, rx: 2, fill: s.color || U.PALETTE[si % U.PALETTE.length] }));
      svg.appendChild(text(lx + 13, h - 6, s.name, { 'font-size': 10 }));
      lx += 22 + s.name.length * 6.4;
    });
    return mount(container, svg);
  }

  /* --------------------------------------------------- 折れ線 */
  function line(container, opt) {
    var labels = opt.labels || [], series = opt.series || [];
    if (!labels.length) return empty(container);
    var w = opt.width || 780, h = opt.height || 250;
    var pad = { l: 48, r: 14, t: 16, b: 46 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); });
    var max = niceMax(Math.max.apply(null, all.concat([0])));
    var svg = root(w, h);
    for (var g = 0; g <= 4; g++) {
      var y = pad.t + ih - (ih * g / 4);
      svg.appendChild(n('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, stroke: '#e2e8f0' }));
      svg.appendChild(text(pad.l - 6, y + 4, fmt(max * g / 4), { 'text-anchor': 'end', 'font-size': 10, fill: '#94a3b8' }));
    }
    var step = labels.length > 1 ? iw / (labels.length - 1) : 0;
    labels.forEach(function (lab, i) {
      var tx = pad.l + step * i;
      var lbl = text(tx, h - pad.b + 15, shorten(lab, 8), { 'text-anchor': 'middle', 'font-size': 10 });
      if (labels.length > 12) {
        lbl.setAttribute('transform', 'rotate(-35 ' + tx + ' ' + (h - pad.b + 15) + ')');
        lbl.setAttribute('text-anchor', 'end');
      }
      svg.appendChild(lbl);
    });
    series.forEach(function (s, si) {
      var color = s.color || U.PALETTE[si % U.PALETTE.length];
      var pts = [];
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        pts.push([pad.l + step * i, pad.t + ih - (max ? (v / max) * ih : 0)]);
      });
      if (pts.length > 1) {
        if (opt.area) {
          var area = 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') +
            ' L' + pts[pts.length - 1][0] + ',' + (pad.t + ih) + ' L' + pts[0][0] + ',' + (pad.t + ih) + ' Z';
          svg.appendChild(n('path', { d: area, fill: color, opacity: .1 }));
        }
        svg.appendChild(n('polyline', {
          points: pts.map(function (p) { return p.join(','); }).join(' '),
          fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linejoin': 'round'
        }));
      }
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        var c = n('circle', {
          cx: pad.l + step * i, cy: pad.t + ih - (max ? (v / max) * ih : 0),
          r: 3.4, fill: '#fff', stroke: color, 'stroke-width': 2
        });
        tip(c, labels[i] + ' / ' + s.name + ' : ' + fmt(v));
        svg.appendChild(c);
      });
    });
    var lx = pad.l;
    series.forEach(function (s, si) {
      var color = s.color || U.PALETTE[si % U.PALETTE.length];
      svg.appendChild(n('rect', { x: lx, y: h - 13, width: 9, height: 9, rx: 2, fill: color }));
      svg.appendChild(text(lx + 13, h - 5, s.name, { 'font-size': 10 }));
      lx += 22 + s.name.length * 6.4;
    });
    return mount(container, svg);
  }

  /* --------------------------------------------------- ドーナツ */
  function donut(container, opt) {
    var items = (opt.items || []).filter(function (i) { return i.value > 0; });
    if (!items.length) return empty(container);
    var size = opt.size || 210;
    var w = opt.width || 420, h = size + 14;
    var cx = size / 2 + 6, cy = h / 2, r = size / 2 - 8, ir = r * (opt.inner || 0.6);
    var total = items.reduce(function (a, i) { return a + i.value; }, 0);
    var svg = root(w, h);
    var angle = -Math.PI / 2;
    items.forEach(function (it, idx) {
      var frac = it.value / total;
      var a2 = angle + frac * Math.PI * 2;
      var large = frac > 0.5 ? 1 : 0;
      var color = it.color || U.PALETTE[idx % U.PALETTE.length];
      var d = [
        'M', cx + r * Math.cos(angle), cy + r * Math.sin(angle),
        'A', r, r, 0, large, 1, cx + r * Math.cos(a2), cy + r * Math.sin(a2),
        'L', cx + ir * Math.cos(a2), cy + ir * Math.sin(a2),
        'A', ir, ir, 0, large, 0, cx + ir * Math.cos(angle), cy + ir * Math.sin(angle), 'Z'
      ].join(' ');
      var path = n('path', { d: d, fill: color, opacity: .93 });
      tip(path, it.label + ' : ' + fmt(it.value) + ' (' + (frac * 100).toFixed(1) + '%)');
      svg.appendChild(path);
      angle = a2;
    });
    svg.appendChild(text(cx, cy - 2, fmt(total), { 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: '#0f172a' }));
    svg.appendChild(text(cx, cy + 15, opt.centerLabel || '合計', { 'text-anchor': 'middle', 'font-size': 10, fill: '#94a3b8' }));
    var ly = 20, lx = size + 22;
    items.slice(0, 10).forEach(function (it, idx) {
      var color = it.color || U.PALETTE[idx % U.PALETTE.length];
      svg.appendChild(n('rect', { x: lx, y: ly - 8, width: 9, height: 9, rx: 2, fill: color }));
      svg.appendChild(text(lx + 14, ly, shorten(it.label, 14), { 'font-size': 11, fill: '#334155' }));
      svg.appendChild(text(w - 6, ly, fmt(it.value), { 'font-size': 11, 'text-anchor': 'end', fill: '#64748b' }));
      ly += 18;
    });
    return mount(container, svg);
  }

  /* --------------------------------------------------- 散布図 */
  function scatter(container, opt) {
    var pts = (opt.points || []).filter(function (p) { return p.x !== null && p.y !== null; });
    if (!pts.length) return empty(container);
    var w = opt.width || 780, h = opt.height || 300;
    var pad = { l: 54, r: 16, t: 14, b: 44 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var maxX = niceMax(Math.max.apply(null, pts.map(function (p) { return p.x; })));
    var maxY = niceMax(Math.max.apply(null, pts.map(function (p) { return p.y; })));
    var svg = root(w, h);
    for (var g = 0; g <= 4; g++) {
      var y = pad.t + ih - ih * g / 4;
      svg.appendChild(n('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, stroke: '#e2e8f0' }));
      svg.appendChild(text(pad.l - 6, y + 4, fmt(maxY * g / 4), { 'text-anchor': 'end', 'font-size': 10, fill: '#94a3b8' }));
      var x = pad.l + iw * g / 4;
      svg.appendChild(n('line', { x1: x, y1: pad.t, x2: x, y2: pad.t + ih, stroke: '#f1f5f9' }));
      svg.appendChild(text(x, h - pad.b + 15, fmt(maxX * g / 4), { 'text-anchor': 'middle', 'font-size': 10, fill: '#94a3b8' }));
    }
    pts.forEach(function (p) {
      var c = n('circle', {
        cx: pad.l + (p.x / maxX) * iw, cy: pad.t + ih - (p.y / maxY) * ih,
        r: p.r || 5, fill: p.color || '#2563eb', opacity: .62, stroke: '#fff', 'stroke-width': 1
      });
      tip(c, (p.label || '') + '\n' + (opt.xLabel || 'X') + ': ' + fmt(p.x) + '\n' + (opt.yLabel || 'Y') + ': ' + fmt(p.y));
      svg.appendChild(c);
    });
    svg.appendChild(text(w / 2, h - 6, opt.xLabel || '', { 'text-anchor': 'middle', 'font-size': 10.5, fill: '#64748b' }));
    var yl = text(0, 0, opt.yLabel || '', { 'font-size': 10.5, fill: '#64748b', 'text-anchor': 'middle' });
    yl.setAttribute('transform', 'translate(12,' + (pad.t + ih / 2) + ') rotate(-90)');
    svg.appendChild(yl);
    return mount(container, svg);
  }

  function shorten(s, max) {
    s = String(s === null || s === undefined ? '' : s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  global.Charts = {
    bar: bar, hbar: hbar, stacked: stacked, line: line, donut: donut, scatter: scatter,
    empty: empty, fmt: fmt
  };
})(window);
