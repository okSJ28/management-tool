/* ============================================================
   views/pivot.js - クロス集計（ピボット）
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var P = { type: 'mfg', row: 'assignee1', col: '_month', metric: 'convStep', heat: true, from: '', to: '' };

  var DIMS = [
    { key: 'assignee1', label: '担当者' },
    { key: 'project', label: '案件' },
    { key: 'resource', label: 'リソース区分' },
    { key: 'system', label: 'システム' },
    { key: 'kubun', label: '区分' },
    { key: 'effectiveStatus', label: 'ステータス' },
    { key: '_month', label: '月（終了日）' },
    { key: '_fy', label: '年度' },
    { key: '_none', label: '（なし）' }
  ];
  var METRICS = [
    { key: '_count', label: '件数', agg: 'count', dec: 0 },
    { key: 'convStep', label: '換算step', agg: 'sum', dec: 0 },
    { key: 'newStep', label: '新規step', agg: 'sum', dec: 0 },
    { key: 'modStep', label: '修正step', agg: 'sum', dec: 0 },
    { key: 'totalHour', label: '総工数(h)', agg: 'sum', dec: 1 },
    { key: 'issueTotal', label: '指摘件数', agg: 'sum', dec: 0 },
    { key: 'defect', label: '障害件数', agg: 'sum', dec: 0 },
    { key: 'pages', label: '設計書頁数', agg: 'sum', dec: 0 },
    { key: 'prodMonth', label: '月換算生産性(平均)', agg: 'avg', dec: 1 },
    { key: 'quality', label: '品質 指摘/KS(平均)', agg: 'avg', dec: 2 },
    { key: 'testRatio', label: 'テスト比率(平均)', agg: 'avg', dec: 1 }
  ];

  function dimValue(t, key) {
    if (key === '_none') return '合計';
    if (key === '_month') return U.monthKey(t.endDate || t.startDate) || '(未設定)';
    if (key === '_fy') {
      var d = U.parseDate(t.endDate || t.startDate);
      return d ? U.fiscalYear(d, State.settings().fiscalStartMonth) + '年度' : '(未設定)';
    }
    return t[key] || '(未設定)';
  }

  function calc(list, metric) {
    var m = METRICS.filter(function (x) { return x.key === metric; })[0];
    if (!list.length) return null;
    if (m.agg === 'count') return list.length;
    if (m.agg === 'sum') return U.sum(list, function (t) { return t[m.key]; });
    return U.avg(list, function (t) { return t[m.key]; });
  }

  Views.pivot = {
    title: 'クロス集計',
    desc: '行×列の任意の組み合わせで数値を突き合わせ',
    icon: '🔀',
    render: function (root) {
      var bar = U.el('div', { class: 'filterbar' });
      var seg = U.el('div', { class: 'seg' });
      State.schema.types.concat([{ key: 'all', label: 'すべて' }]).forEach(function (t) {
        seg.appendChild(U.el('button', { class: P.type === t.key ? 'on' : '', text: t.label, onclick: function () { P.type = t.key; App.render(); } }));
      });
      bar.appendChild(seg);

      function sel(label, key, list) {
        var s = U.el('select', { onchange: function () { P[key] = this.value; App.render(); } });
        list.forEach(function (o) { s.appendChild(U.el('option', { value: o.key, text: o.label, selected: P[key] === o.key })); });
        s.value = P[key];
        bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: label }), s]));
      }
      sel('行', 'row', DIMS);
      sel('列', 'col', DIMS);
      sel('値', 'metric', METRICS);

      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '期間 From' }),
      U.el('input', { type: 'date', value: P.from, onchange: function () { P.from = this.value; App.render(); } })]));
      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '期間 To' }),
      U.el('input', { type: 'date', value: P.to, onchange: function () { P.to = this.value; App.render(); } })]));
      bar.appendChild(U.el('label', { class: 'row-flex', style: { marginTop: '12px', fontSize: '11.5px' } }, [
        U.el('input', { type: 'checkbox', checked: P.heat, onchange: function () { P.heat = this.checked; App.render(); } }),
        document.createTextNode(' ヒートマップ')
      ]));
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', { class: 'btn btn-sm', text: '⬇ CSV出力', onclick: function () { exportPivot(); } }));
      root.appendChild(bar);

      var rows = State.tasks.filter(function (t) {
        if (P.type !== 'all' && t.type !== P.type) return false;
        var d = t.endDate || t.startDate || '';
        if (P.from && d && d < P.from) return false;
        if (P.to && d && d > P.to) return false;
        return true;
      });

      var rowKeys = U.uniq(rows.map(function (t) { return dimValue(t, P.row); })).sort(sorter(P.row));
      var colKeys = U.uniq(rows.map(function (t) { return dimValue(t, P.col); })).sort(sorter(P.col));
      var m = METRICS.filter(function (x) { return x.key === P.metric; })[0];

      var matrix = {};
      var maxVal = 0;
      rowKeys.forEach(function (rk) {
        matrix[rk] = {};
        colKeys.forEach(function (ck) {
          var list = rows.filter(function (t) { return dimValue(t, P.row) === rk && dimValue(t, P.col) === ck; });
          var v = calc(list, P.metric);
          matrix[rk][ck] = v;
          if (v !== null && v > maxVal) maxVal = v;
        });
      });

      var card = U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [
          U.el('h3', { text: labelOf(DIMS, P.row) + ' × ' + labelOf(DIMS, P.col) + ' : ' + m.label }),
          U.el('span', { class: 'sub', text: rows.length + '件が対象' })
        ])
      ]);
      var wrap = U.el('div', { class: 'table-wrap' });
      var tbl = U.el('table', { class: 'grid-table' });
      var hr = U.el('tr');
      hr.appendChild(U.el('th', { class: 'col-pin', text: labelOf(DIMS, P.row) }));
      colKeys.forEach(function (ck) { hr.appendChild(U.el('th', { class: 'right', text: P.col === '_month' ? U.monthLabel(ck) : ck })); });
      hr.appendChild(U.el('th', { class: 'right', text: '合計' }));
      tbl.appendChild(U.el('thead', {}, [hr]));

      var tb = U.el('tbody');
      rowKeys.forEach(function (rk) {
        var tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'col-pin strong', title: rk, style: { maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }, text: P.row === '_month' ? U.monthLabel(rk) : rk }));
        colKeys.forEach(function (ck) {
          var v = matrix[rk][ck];
          var td = U.el('td', { class: 'num', text: v === null ? '' : U.fmtNum(v, m.dec) });
          if (P.heat && v !== null && maxVal) {
            var ratio = Math.min(1, v / maxVal);
            td.style.background = 'rgba(37,99,235,' + (0.06 + ratio * 0.42).toFixed(3) + ')';
            if (ratio > 0.62) td.style.color = '#fff';
          }
          if (v !== null) {
            td.style.cursor = 'pointer';
            td.onclick = function () { drill(rk, ck, rows.filter(function (t) { return dimValue(t, P.row) === rk && dimValue(t, P.col) === ck; })); };
          }
          tr.appendChild(td);
        });
        var rowList = rows.filter(function (t) { return dimValue(t, P.row) === rk; });
        tr.appendChild(U.el('td', { class: 'num strong', style: { background: 'var(--surface-2)' }, text: U.fmtNum(calc(rowList, P.metric), m.dec) }));
        tb.appendChild(tr);
      });
      var totalRow = U.el('tr', { style: { background: 'var(--surface-2)' } });
      totalRow.appendChild(U.el('td', { class: 'col-pin strong', style: { background: 'var(--surface-2)' }, text: '合計' }));
      colKeys.forEach(function (ck) {
        var list = rows.filter(function (t) { return dimValue(t, P.col) === ck; });
        totalRow.appendChild(U.el('td', { class: 'num strong', text: U.fmtNum(calc(list, P.metric), m.dec) }));
      });
      totalRow.appendChild(U.el('td', { class: 'num strong', text: U.fmtNum(calc(rows, P.metric), m.dec) }));
      tb.appendChild(totalRow);
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      card.appendChild(wrap);
      root.appendChild(card);

      root.appendChild(Views._helpers.chartCard('行合計の比較', function (box) {
        Charts.hbar(box, {
          items: rowKeys.map(function (rk) {
            var v = calc(rows.filter(function (t) { return dimValue(t, P.row) === rk; }), P.metric);
            return { label: P.row === '_month' ? U.monthLabel(rk) : rk, value: v === null ? 0 : Math.round(v * 100) / 100, color: U.colorOf(rk) };
          }).sort(function (a, b) { return b.value - a.value; }).slice(0, 20),
          labelWidth: 200, labelMax: 26
        });
      }));

      Views.pivot._export = function () {
        var lines = [[labelOf(DIMS, P.row)].concat(colKeys, ['合計']).map(csvCell).join(',')];
        rowKeys.forEach(function (rk) {
          var line = [csvCell(rk)];
          colKeys.forEach(function (ck) { var v = matrix[rk][ck]; line.push(v === null ? '' : v); });
          line.push(calc(rows.filter(function (t) { return dimValue(t, P.row) === rk; }), P.metric) || '');
          lines.push(line.join(','));
        });
        U.download('クロス集計.csv', new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
      };
    }
  };

  function exportPivot() { Views.pivot._export && Views.pivot._export(); }
  function csvCell(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }
  function labelOf(list, key) { var f = list.filter(function (x) { return x.key === key; })[0]; return f ? f.label : key; }
  function sorter(dim) {
    if (dim === '_month' || dim === '_fy') return function (a, b) { return a < b ? -1 : 1; };
    return function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  }

  function drill(rk, ck, list) {
    var body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', text: rk + ' × ' + ck + ' : ' + list.length + '件' }));
    var tbl = U.el('table', { class: 'grid-table' });
    tbl.appendChild(U.el('thead', {}, [U.el('tr', {}, ['ID', '案件', '担当', '終了日', '換算step', '工数'].map(function (h) { return U.el('th', { text: h }); }))]));
    var tb = U.el('tbody');
    list.forEach(function (t) {
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
    U.openDrawer('明細', body, [U.el('div', { class: 'spacer' }), U.el('button', { class: 'btn', text: '閉じる', onclick: U.closeDrawer })]);
  }
})(window);
