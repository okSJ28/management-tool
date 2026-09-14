/* ============================================================
   views/analytics.js - 多観点分析
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var A = {
    type: 'mfg', dim: 'assignee1', metric: 'convStep', from: '', to: '', project: '',
    system: '', resource: '', resourceGroup: '', kubun: '',
    sortKey: 'value', sortAsc: false, breakdown: 'resourceGroup', expanded: {}
  };

  var DIMS = [
    { key: 'assignee1', label: '担当者' },
    { key: 'project', label: '案件' },
    { key: 'resource', label: 'リソース区分' },
    { key: '_resourceGroup', label: 'リソース分類' },
    { key: 'system', label: 'システム' },
    { key: 'kubun', label: '区分' },
    { key: 'editor', label: '使用エディタ' },
    { key: '_month', label: '月（終了日）' },
    { key: '_fy', label: '年度（終了日）' },
    { key: 'effectiveStatus', label: 'ステータス' }
  ];

  var BREAKDOWNS = [
    { key: 'resourceGroup', label: 'リソース分類' },
    { key: 'resource', label: 'リソース区分' },
    { key: 'system', label: 'システム' },
    { key: 'kubun', label: '区分' },
    { key: 'project', label: '案件' },
    { key: '', label: '（なし）' }
  ];

  function resourceGroupOf(value) {
    var groups = State.masters.resourceGroups || {};
    var keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
      if ((groups[keys[i]] || []).some(function (v) {
        return String(v).toLowerCase() === String(value || '').toLowerCase();
      })) return keys[i];
    }
    return value ? 'その他' : '(未設定)';
  }

  var METRICS = [
    { key: '_count', label: '件数', agg: 'count', dec: 0, unit: '件' },
    { key: 'convStep', label: '換算step 合計', agg: 'sum', dec: 0 },
    { key: 'newStep', label: '新規step 合計', agg: 'sum', dec: 0 },
    { key: 'modStep', label: '修正step 合計', agg: 'sum', dec: 0 },
    { key: 'totalHour', label: '総工数 合計(h)', agg: 'sum', dec: 1, unit: 'h' },
    { key: 'hourMake', label: '製造工数 合計(h)', agg: 'sum', dec: 1, unit: 'h' },
    { key: 'issueTotal', label: '指摘 合計', agg: 'sum', dec: 0, unit: '件' },
    { key: 'defect', label: '障害 合計', agg: 'sum', dec: 0, unit: '件' },
    { key: 'prodMonth', label: '月換算生産性 平均', agg: 'avg', dec: 1 },
    { key: 'quality', label: '品質(指摘/KS) 平均', agg: 'avg', dec: 2 },
    { key: 'testRatio', label: 'テスト比率 平均(%)', agg: 'avg', dec: 1, unit: '%' },
    { key: 'durationDays', label: '期間 平均(日)', agg: 'avg', dec: 1, unit: '日' },
    { key: 'pages', label: '設計書頁数 合計', agg: 'sum', dec: 0, unit: '頁' },
    { key: 'hourDesign', label: '詳細設計時間 合計(h)', agg: 'sum', dec: 1, unit: 'h' }
  ];

  function dimValue(t, key) {
    if (key === '_month') return U.monthKey(t.endDate || t.startDate) || '(未設定)';
    if (key === '_resourceGroup') return resourceGroupOf(t.resource);
    if (key === '_fy') {
      var d = U.parseDate(t.endDate || t.startDate);
      return d ? U.fiscalYear(d, State.settings().fiscalStartMonth) + '年度' : '(未設定)';
    }
    return t[key] || '(未設定)';
  }

  function aggregate(rows, dim, metric) {
    var m = METRICS.filter(function (x) { return x.key === metric; })[0] || METRICS[0];
    var g = U.groupBy(rows, function (t) { return dimValue(t, dim); });
    var out = [];
    g.forEach(function (list, key) {
      var value;
      if (m.agg === 'count') value = list.length;
      else if (m.agg === 'sum') value = U.sum(list, function (t) { return t[m.key]; });
      else value = U.avg(list, function (t) { return t[m.key]; });
      out.push({ label: key, value: value === null ? 0 : Math.round(value * 100) / 100, count: list.length, rows: list });
    });
    if (dim === '_month' || dim === '_fy') out.sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    else out.sort(function (a, b) { return b.value - a.value; });
    return { items: out, meta: m };
  }

  function filterRows() {
    return State.tasks.filter(function (t) {
      if (A.type !== 'all' && t.type !== A.type) return false;
      if (A.project && t.project !== A.project) return false;
      if (A.system && t.system !== A.system) return false;
      if (A.resource && t.resource !== A.resource) return false;
      if (A.kubun && t.kubun !== A.kubun) return false;
      if (A.resourceGroup && resourceGroupOf(t.resource) !== A.resourceGroup) return false;
      var d = t.endDate || t.startDate || '';
      if (A.from && d && d < A.from) return false;
      if (A.to && d && d > A.to) return false;
      return true;
    });
  }

  /* ---------------------------------------------- 集計表 */
  var TABLE_GROUPS = [
    {
      label: '規模', color: '#eef4ff', cols: [
        { key: 'count', label: '件数', dec: 0, fn: function (l, m) { return l.length; } },
        { key: 'convStep', label: '換算step', dec: 0, fn: function (l, m) { return U.sum(m, function (t) { return t.convStep; }); } },
        { key: 'newStep', label: '新規', dec: 0, fn: function (l, m) { return U.sum(m, function (t) { return t.newStep; }); } },
        { key: 'modStep', label: '修正', dec: 0, fn: function (l, m) { return U.sum(m, function (t) { return t.modStep; }); } },
        { key: 'pages', label: '設計頁', dec: 0, fn: function (l) { return U.sum(l, function (t) { return t.pages; }); } }
      ]
    },
    {
      label: '工数', color: '#f0fdf4', cols: [
        { key: 'totalHour', label: '総工数h', dec: 1, fn: function (l) { return U.sum(l, function (t) { return t.totalHour; }); } },
        { key: 'hourMake', label: '製造h', dec: 1, fn: function (l, m) { return U.sum(m, function (t) { return t.hourMake; }); } },
        { key: 'testRatio', label: 'テスト比率%', dec: 1, fn: function (l, m) { return U.avg(m, function (t) { return t.testRatio; }); } }
      ]
    },
    {
      label: '品質', color: '#fff7ed', cols: [
        { key: 'issueTotal', label: '指摘', dec: 0, fn: function (l) { return U.sum(l, function (t) { return t.issueTotal; }); } },
        { key: 'defect', label: '障害', dec: 0, fn: function (l, m) { return U.sum(m, function (t) { return t.defect; }); } },
        { key: 'quality', label: '指摘/KS', dec: 2, fn: function (l, m) { return U.avg(m, function (t) { return t.quality; }); } }
      ]
    },
    {
      label: '生産性', color: '#faf5ff', cols: [
        { key: 'prodMonth', label: '月換算', dec: 0, fn: function (l, m) { return U.avg(m, function (t) { return t.prodMonth; }); } },
        { key: 'prodNew', label: '新規/h', dec: 1, fn: function (l, m) { return U.avg(m, function (t) { return t.prodNew; }); } },
        { key: 'prodMod', label: '修正/h', dec: 1, fn: function (l, m) { return U.avg(m, function (t) { return t.prodMod; }); } }
      ]
    }
  ];

  function allCols() {
    return TABLE_GROUPS.reduce(function (a, g) { return a.concat(g.cols); }, []);
  }

  function rowValues(list) {
    var mfg = list.filter(function (t) { return t.type === 'mfg'; });
    var out = {};
    allCols().forEach(function (c) {
      var v = c.fn(list, mfg);
      out[c.key] = (v === null || v === undefined || isNaN(v)) ? null : v;
    });
    return out;
  }

  function buildTable(agg, dimLabel, rows) {
    var cols = allCols();
    var settings = State.settings();
    var data = agg.items.map(function (it) {
      return { label: it.label, rows: it.rows, vals: rowValues(it.rows) };
    });
    var sortKey = A.sortKey;
    data.sort(function (a, b) {
      var av = sortKey === 'label' ? a.label : a.vals[sortKey];
      var bv = sortKey === 'label' ? b.label : b.vals[sortKey];
      if (sortKey === 'label') return A.sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
      av = av === null || av === undefined ? -Infinity : av;
      bv = bv === null || bv === undefined ? -Infinity : bv;
      return A.sortAsc ? av - bv : bv - av;
    });
    var maxStep = Math.max.apply(null, data.map(function (d) { return d.vals.convStep || 0; }).concat([1]));

    var card = U.el('div', { class: 'card mt16' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('h3', { text: dimLabel + '別 集計表' }),
      U.el('span', { class: 'sub', text: '列見出しクリックで並べ替え／行の ▶ で内訳展開' }),
      U.el('div', { class: 'tools' }, [
        U.el('span', { class: 'muted', style: { fontSize: '11px' }, text: '内訳:' }),
        (function () {
          var s = U.el('select', {
            style: { padding: '3px 6px', border: '1px solid var(--border-strong)', borderRadius: '6px' },
            onchange: function () { A.breakdown = this.value; A.expanded = {}; App.render(); }
          });
          BREAKDOWNS.forEach(function (b) { s.appendChild(U.el('option', { value: b.key, text: b.label, selected: A.breakdown === b.key })); });
          return s;
        })(),
        U.el('button', { class: 'btn btn-sm', text: '⬇ CSV', onclick: function () { exportTable(data, dimLabel); } })
      ])
    ]));

    var wrap = U.el('div', { class: 'table-wrap' });
    var tbl = U.el('table', { class: 'grid-table' });

    var gr = U.el('tr');
    gr.appendChild(U.el('th', { class: 'col-pin', rowspan: 2, style: { minWidth: '200px' }, onclick: function () { sortBy('label'); } }, [
      document.createTextNode(dimLabel),
      A.sortKey === 'label' ? U.el('span', { class: 'sort', text: A.sortAsc ? '▲' : '▼' }) : null
    ]));
    TABLE_GROUPS.forEach(function (g) {
      gr.appendChild(U.el('th', {
        colspan: g.cols.length, class: 'center',
        style: { background: g.color, borderBottom: '1px solid var(--border)' }, text: g.label
      }));
    });
    gr.appendChild(U.el('th', { rowspan: 2, class: 'center', style: { minWidth: '110px' }, text: '換算step構成比' }));

    var hr = U.el('tr');
    TABLE_GROUPS.forEach(function (g) {
      g.cols.forEach(function (c) {
        hr.appendChild(U.el('th', {
          class: 'right', style: { background: g.color, top: '26px' },
          onclick: function () { sortBy(c.key); }
        }, [
          document.createTextNode(c.label),
          A.sortKey === c.key ? U.el('span', { class: 'sort', text: A.sortAsc ? '▲' : '▼' }) : null
        ]));
      });
    });
    tbl.appendChild(U.el('thead', {}, [gr, hr]));

    var tb = U.el('tbody');
    data.forEach(function (d) {
      var tr = U.el('tr');
      var color = U.colorOf(d.label);
      tr.appendChild(U.el('td', { class: 'col-pin' }, [
        A.breakdown ? U.el('button', {
          class: 'icon-btn', style: { width: '18px', height: '18px', fontSize: '10px' },
          text: A.expanded[d.label] ? '▼' : '▶',
          onclick: function (e) { e.stopPropagation(); A.expanded[d.label] = !A.expanded[d.label]; App.render(); }
        }) : null,
        U.el('span', {
          class: 'chip dot', style: { background: color + '1f', color: color, cursor: 'pointer' },
          title: '明細を表示', text: d.label,
          onclick: function () { drill(dimLabel, { label: d.label, rows: d.rows }); }
        })
      ]));
      cols.forEach(function (c) {
        var v = d.vals[c.key];
        var td = U.el('td', { class: 'num', text: v === null ? '' : U.fmtNum(v, c.dec) });
        if (c.key === 'quality' && v !== null && v > (settings.targetQuality || 50)) { td.style.color = 'var(--danger)'; td.style.fontWeight = '700'; }
        if (c.key === 'prodMonth' && v !== null) td.style.color = v >= (settings.targetProdMonth || 800) ? 'var(--ok)' : 'var(--text)';
        tr.appendChild(td);
      });
      tr.appendChild(U.el('td', {}, [
        U.el('div', { class: 'progress' }, [U.el('span', { style: { width: ((d.vals.convStep || 0) / maxStep * 100) + '%', background: color } })])
      ]));
      tb.appendChild(tr);

      if (A.breakdown && A.expanded[d.label]) {
        var sub = U.groupBy(d.rows, function (t) {
          return A.breakdown === 'resourceGroup' ? resourceGroupOf(t.resource) : (t[A.breakdown] || '(未設定)');
        });
        Array.from(sub.entries()).sort(function (a, b) { return b[1].length - a[1].length; }).forEach(function (e) {
          var vals = rowValues(e[1]);
          var str = U.el('tr', { style: { background: '#fbfdff' } });
          str.appendChild(U.el('td', { class: 'col-pin', style: { background: '#fbfdff', paddingLeft: '30px' } }, [
            U.el('span', { class: 'muted', text: '└ ' }),
            U.el('span', { class: 'tag', text: e[0] })
          ]));
          cols.forEach(function (c) {
            str.appendChild(U.el('td', { class: 'num muted', text: vals[c.key] === null ? '' : U.fmtNum(vals[c.key], c.dec) }));
          });
          str.appendChild(U.el('td', {}, [
            U.el('div', { class: 'progress', style: { opacity: .6 } }, [U.el('span', { style: { width: ((vals.convStep || 0) / maxStep * 100) + '%' } })])
          ]));
          tb.appendChild(str);
        });
      }
    });

    var totals = rowValues(rows);
    var totalRow = U.el('tr', { style: { background: 'var(--surface-2)', fontWeight: '700' } });
    totalRow.appendChild(U.el('td', { class: 'col-pin strong', style: { background: 'var(--surface-2)' }, text: '合計 / 平均' }));
    cols.forEach(function (c) {
      totalRow.appendChild(U.el('td', { class: 'num', text: totals[c.key] === null ? '' : U.fmtNum(totals[c.key], c.dec) }));
    });
    totalRow.appendChild(U.el('td', {}));
    tb.appendChild(totalRow);

    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    return card;
  }

  function sortBy(key) {
    if (A.sortKey === key) A.sortAsc = !A.sortAsc;
    else { A.sortKey = key; A.sortAsc = key === 'label'; }
    App.render();
  }

  function exportTable(data, dimLabel) {
    var cols = allCols();
    var lines = [[dimLabel].concat(cols.map(function (c) { return c.label; })).join(',')];
    data.forEach(function (d) {
      lines.push(['"' + String(d.label).replace(/"/g, '""') + '"']
        .concat(cols.map(function (c) { return d.vals[c.key] === null ? '' : d.vals[c.key]; })).join(','));
    });
    U.download('集計_' + dimLabel + '.csv', new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
  }

  Views.analytics = {
    title: '分析',
    desc: '観点（軸）と指標を切り替えて多角的に分析',
    icon: '📈',
    render: function (root) {
      var bar = U.el('div', { class: 'filterbar' });

      var seg = U.el('div', { class: 'seg' });
      State.schema.types.concat([{ key: 'all', label: 'すべて' }]).forEach(function (t) {
        seg.appendChild(U.el('button', { class: A.type === t.key ? 'on' : '', text: t.label, onclick: function () { A.type = t.key; App.render(); } }));
      });
      bar.appendChild(seg);

      function selector(label, list, cur, onChange, valueKey, labelKey) {
        var s = U.el('select', { onchange: function () { onChange(this.value); } });
        list.forEach(function (o) {
          var v = valueKey ? o[valueKey] : o, l = labelKey ? o[labelKey] : o;
          s.appendChild(U.el('option', { value: v, text: l, selected: cur === v }));
        });
        s.value = cur;
        bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: label }), s]));
        return s;
      }
      selector('観点（軸）', DIMS, A.dim, function (v) { A.dim = v; A.expanded = {}; App.render(); }, 'key', 'label');
      selector('指標', METRICS, A.metric, function (v) { A.metric = v; App.render(); }, 'key', 'label');
      selector('システム', [''].concat(U.uniq(State.tasks.map(function (t) { return t.system; })).sort()),
        A.system, function (v) { A.system = v; App.render(); });
      selector('リソース分類', [''].concat(Object.keys(State.masters.resourceGroups || {}).concat(['その他'])),
        A.resourceGroup, function (v) { A.resourceGroup = v; App.render(); });
      selector('リソース区分', [''].concat(U.uniq(State.tasks.map(function (t) { return t.resource; })).sort()),
        A.resource, function (v) { A.resource = v; App.render(); });
      selector('区分', [''].concat(State.options('kubun')), A.kubun, function (v) { A.kubun = v; App.render(); });
      selector('案件', [''].concat(State.projects()), A.project, function (v) { A.project = v; App.render(); });

      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '期間 From' }),
      U.el('input', { type: 'date', value: A.from, onchange: function () { A.from = this.value; App.render(); } })]));
      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '期間 To' }),
      U.el('input', { type: 'date', value: A.to, onchange: function () { A.to = this.value; App.render(); } })]));
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: '⟲ クリア', onclick: function () {
          A.from = ''; A.to = ''; A.project = ''; A.system = ''; A.resource = ''; A.resourceGroup = ''; A.kubun = '';
          App.render();
        }
      }));
      root.appendChild(bar);

      var rows = filterRows();
      var agg = aggregate(rows, A.dim, A.metric);
      var dimLabel = (DIMS.filter(function (d) { return d.key === A.dim; })[0] || {}).label;

      var chips = U.el('div', { class: 'row-flex', style: { marginBottom: '10px' } });
      [['システム', A.system], ['リソース分類', A.resourceGroup], ['リソース区分', A.resource],
      ['区分', A.kubun], ['案件', A.project]].forEach(function (c) {
        if (!c[1]) return;
        chips.appendChild(U.el('span', { class: 'chip', style: { background: 'var(--primary-soft)', color: 'var(--primary)' }, text: c[0] + ': ' + c[1] }));
      });
      if (chips.children.length) {
        chips.insertBefore(U.el('span', { class: 'muted', text: '絞り込み中:' }), chips.firstChild);
        root.appendChild(chips);
      }

      /* --- KPI --- */
      var mfg = rows.filter(function (t) { return t.type === 'mfg'; });
      root.appendChild(U.el('div', { class: 'grid k4' }, [
        Views._helpers.kpi('対象件数', String(rows.length), '件', dimLabel + ' ' + agg.items.length + '区分', 'blue'),
        Views._helpers.kpi('換算step 合計', U.fmtNum(U.sum(mfg, function (t) { return t.convStep; }), 0), '', '新規 ' + U.fmtNum(U.sum(mfg, function (t) { return t.newStep; }), 0) + ' / 修正 ' + U.fmtNum(U.sum(mfg, function (t) { return t.modStep; }), 0), 'violet'),
        Views._helpers.kpi('総工数', U.fmtNum(U.sum(rows, function (t) { return t.totalHour; }), 1), 'h', 'テスト比率平均 ' + U.fmtNum(U.avg(mfg, function (t) { return t.testRatio; }), 1) + '%', 'green'),
        Views._helpers.kpi('品質 平均', U.fmtNum(U.avg(mfg, function (t) { return t.quality; }), 2), '指摘/KS', '障害 ' + U.fmtNum(U.sum(mfg, function (t) { return t.defect; }), 0) + '件', 'amber')
      ]));

      /* --- メイン集計 --- */
      var main = U.el('div', { class: 'grid k23 mt16' });
      main.appendChild(Views._helpers.chartCard(dimLabel + '別 ' + agg.meta.label, function (box) {
        if (A.dim === '_month' || A.dim === '_fy') {
          Charts.bar(box, {
            labels: agg.items.map(function (i) { return A.dim === '_month' ? U.monthLabel(i.label) : i.label; }),
            values: agg.items.map(function (i) { return i.value; }),
            unit: agg.meta.unit || '', height: 280, color: '#2563eb'
          });
        } else {
          Charts.hbar(box, {
            items: agg.items.slice(0, 20).map(function (i) { return { label: i.label, value: i.value, color: U.colorOf(i.label) }; }),
            labelWidth: 200, labelMax: 26, unit: agg.meta.unit || ''
          });
        }
      }));
      main.appendChild(Views._helpers.chartCard('構成比', function (box) {
        Charts.donut(box, {
          items: agg.items.slice(0, 9).map(function (i) { return { label: i.label, value: Math.max(0, i.value) }; }),
          width: 400, size: 190, centerLabel: agg.meta.unit || ''
        });
      }));
      root.appendChild(main);

      /* --- 集計テーブル --- */
      root.appendChild(buildTable(agg, dimLabel, rows));

      /* --- 追加チャート --- */
      var g2 = U.el('div', { class: 'grid k2 mt16' });
      g2.appendChild(Views._helpers.chartCard('月次推移（' + dimLabel + '別 件数 積み上げ）', function (box) {
        var months = U.uniq(rows.map(function (t) { return U.monthKey(t.endDate); })).sort().slice(-12);
        var top = agg.items.slice(0, 6).map(function (i) { return i.label; });
        Charts.stacked(box, {
          labels: months.map(U.monthLabel),
          series: top.map(function (lab, i) {
            return {
              name: lab.length > 12 ? lab.slice(0, 11) + '…' : lab, color: U.colorOf(lab),
              values: months.map(function (mk) {
                return rows.filter(function (t) { return U.monthKey(t.endDate) === mk && dimValue(t, A.dim) === lab; }).length;
              })
            };
          }), height: 270
        });
      }));
      g2.appendChild(Views._helpers.chartCard('規模と工数の関係（換算step × 総工数）', function (box) {
        Charts.scatter(box, {
          points: mfg.map(function (t) {
            return {
              x: U.num(t.convStep), y: U.num(t.totalHour), color: U.colorOf(t.assignee1 || ''),
              label: (t.programId || '') + ' / ' + (t.assignee1 || '')
            };
          }).filter(function (p) { return p.x && p.y; }),
          xLabel: '換算step', yLabel: '総工数(h)', height: 270
        });
      }));
      root.appendChild(g2);

      var g3 = U.el('div', { class: 'grid k2 mt16' });
      g3.appendChild(Views._helpers.chartCard('生産性 × 品質（右下ほど良い）', function (box) {
        Charts.scatter(box, {
          points: mfg.map(function (t) {
            return {
              x: U.num(t.prodMonth), y: U.num(t.quality), color: U.colorOf(t.assignee1 || ''),
              label: (t.programId || '') + ' / ' + (t.assignee1 || '')
            };
          }).filter(function (p) { return p.x !== null && p.y !== null; }),
          xLabel: '月換算生産性', yLabel: '品質(指摘/KS)', height: 270
        });
      }));
      g3.appendChild(Views._helpers.chartCard('品質(指摘/KS) 分布', function (box) {
        var vals = mfg.map(function (t) { return U.num(t.quality); }).filter(function (v) { return v !== null; });
        var bins = [0, 10, 25, 50, 75, 100, 150, 200];
        var labels = [], values = [];
        for (var i = 0; i < bins.length; i++) {
          var lo = bins[i], hi = bins[i + 1];
          labels.push(hi === undefined ? lo + '以上' : lo + '〜' + hi);
          values.push(vals.filter(function (v) { return v >= lo && (hi === undefined || v < hi); }).length);
        }
        Charts.bar(box, { labels: labels, values: values, color: '#0891b2', height: 270, unit: '件' });
      }));
      root.appendChild(g3);
    }
  };

  function drill(dimLabel, item) {
    var body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', text: dimLabel + ' = ' + item.label + ' に該当する ' + item.rows.length + ' 件' }));
    var tbl = U.el('table', { class: 'grid-table' });
    tbl.appendChild(U.el('thead', {}, [U.el('tr', {}, ['ID', '案件', '担当', '終了日', '換算step', '工数'].map(function (h) { return U.el('th', { text: h }); }))]));
    var tb = U.el('tbody');
    item.rows.forEach(function (t) {
      tb.appendChild(U.el('tr', { style: { cursor: 'pointer' }, onclick: function () { U.closeDrawer(); Form.openViewer(t, function () { App.render(); }); } }, [
        U.el('td', { class: 'mono strong', text: t.programId || '' }),
        U.el('td', { style: { maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' }, title: t.project || '', text: t.project || '' }),
        U.el('td', { text: t.assignee1 || '' }),
        U.el('td', { class: 'mono', text: U.fmtDateFull(t.endDate) }),
        U.el('td', { class: 'num', text: U.fmtNum(t.convStep, 0) }),
        U.el('td', { class: 'num', text: U.fmtNum(t.totalHour, 1) })
      ]));
    });
    tbl.appendChild(tb);
    body.appendChild(tbl);
    U.openDrawer('ドリルダウン: ' + item.label, body, [
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: '閉じる', onclick: U.closeDrawer })
    ]);
  }
})(window);
