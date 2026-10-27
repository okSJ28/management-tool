/* ============================================================
   views/plan_board.js - チーム予定ボード / 予定サマリ
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var B = { start: null, span: 14, category: '', member: '', project: '', kind: '' };
  var R = { from: '', to: '', dim: 'category' };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function kindOf(p) {
    return p && (p.kind === 'result' || p.kind === 'assignment') ? p.kind : 'plan';
  }
  function isPlan(p) { return kindOf(p) === 'plan'; }
  function isResult(p) { return kindOf(p) === 'result'; }
  function isAssignment(p) { return kindOf(p) === 'assignment'; }

  function filteredPlans() {
    return (State.plans || []).filter(function (p) {
      if (isAssignment(p)) return false;
      if (B.kind && kindOf(p) !== B.kind) return false;
      if (B.category && p.category !== B.category) return false;
      if (B.member && p.member !== B.member) return false;
      if (B.project && p.project !== B.project) return false;
      if (State.search) {
        var hay = [p.member, p.title, p.project, p.category, p.note].filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(State.search.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------ ボード */
  Views.planBoard = {
    title: 'チーム予定ボード',
    desc: '全員の業務予定を日付マトリクスで俯瞰',
    icon: '🗓',
    app: 'plan',
    render: function (root) {
      if (!B.start) B.start = U.addDays(U.today(), -2);
      var days = [];
      for (var i = 0; i < B.span; i++) days.push(U.addDays(B.start, i));
      var todayIso = U.iso(U.today());
      var plans = filteredPlans();

      var bar = U.el('div', { class: 'filterbar' });
      bar.appendChild(U.el('div', { class: 'row-flex', style: { marginTop: '12px' } }, [
        U.el('button', { class: 'btn btn-sm', text: '‹‹', onclick: function () { B.start = U.addDays(B.start, -7); App.render(); } }),
        U.el('button', { class: 'btn btn-sm', text: '今日', onclick: function () { B.start = U.addDays(U.today(), -2); App.render(); } }),
        U.el('button', { class: 'btn btn-sm', text: '››', onclick: function () { B.start = U.addDays(B.start, 7); App.render(); } })
      ]));
      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '表示日数' }),
      (function () {
        var s = U.el('select', { onchange: function () { B.span = parseInt(this.value, 10); App.render(); } });
        [7, 14, 21, 31].forEach(function (n) { s.appendChild(U.el('option', { value: n, text: n + '日', selected: B.span === n })); });
        return s;
      })()]));
      function sel(label, key, options) {
        var s = U.el('select', { onchange: function () { B[key] = this.value; App.render(); } });
        s.appendChild(U.el('option', { value: '', text: '(すべて)' }));
        options.forEach(function (o) { s.appendChild(U.el('option', { value: o, text: o, selected: B[key] === o })); });
        bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: label }), s]));
      }
      sel('担当者', 'member', State.members());
      sel('工程（作業区分）', 'category', (State.masters.planCategories || []).map(function (c) { return c.value; }));
      sel('案件', 'project', State.projects());
      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '種別' }),
      (function () {
        var s = U.el('select', { onchange: function () { B.kind = this.value; App.render(); } });
        [['', '(すべて)'], ['plan', '☀ 予定（始業前）'], ['result', '🌙 実績（終業前）']]
          .forEach(function (o) { s.appendChild(U.el('option', { value: o[0], text: o[1], selected: B.kind === o[0] })); });
        return s;
      })()]));
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-primary btn-sm', text: '＋ 予定を登録',
        onclick: function () { Views.planInput._editor({ date: todayIso, endDate: todayIso }, function () { App.render(); }); }
      }));
      bar.appendChild(U.el('button', { class: 'btn btn-sm', text: '⬇ CSV出力', onclick: exportPlans }));
      root.appendChild(bar);

      var members = State.members().filter(function (m) { return !B.member || m === B.member; });
      if (!members.length) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">🗓</span>メンバーが登録されていません' }));
        return;
      }

      var card = U.el('div', { class: 'card' });
      var wrap = U.el('div', { class: 'table-wrap', style: { maxHeight: 'calc(100vh - 300px)' } });
      var tbl = U.el('table', { class: 'grid-table' });
      var hr = U.el('tr');
      hr.appendChild(U.el('th', { class: 'col-pin', style: { minWidth: '120px', width: '120px' }, text: '担当者' }));
      days.forEach(function (d) {
        var iso = U.iso(d);
        hr.appendChild(U.el('th', {
          class: 'center', style: {
            minWidth: '120px', width: '120px',
            background: iso === todayIso ? 'var(--primary-soft)' : (U.isWeekend(d) ? '#fef2f2' : null)
          },
          text: (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'
        }));
      });
      tbl.appendChild(U.el('thead', {}, [hr]));

      var tb = U.el('tbody');
      members.forEach(function (m) {
        var tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'col-pin' }, [
          U.el('span', {
            class: 'avatar', style: {
              background: U.colorOf(m), width: '20px', height: '20px', flex: '0 0 20px',
              fontSize: '9px', display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px'
            }, text: U.initials(m)
          }),
          U.el('b', { text: m })
        ]));
        days.forEach(function (d) {
          var iso = U.iso(d);
          var list = plans.filter(function (p) {
            return p.member === m && p.date && iso >= p.date && iso <= (p.endDate || p.date);
          });
          var td = U.el('td', {
            style: {
              verticalAlign: 'top', padding: '3px', cursor: 'pointer',
              background: iso === todayIso ? '#f5f9ff' : (U.isWeekend(d) ? '#fffafa' : null)
            },
            onclick: function (e) {
              if (e.target !== td) return;
              Views.planInput._editor({ member: m, date: iso, endDate: iso }, function () { App.render(); });
            }
          });
          // 取組み予定（期間）の帯を上部に重ねる
          State.assignmentsOn(iso, m).forEach(function (a) {
            if (B.category && a.category !== B.category) return;
            if (B.project && a.project !== B.project) return;
            var ac = State.planColor(a.category);
            td.appendChild(U.el('div', {
              title: '【取組み予定】' + (a.category || '') + ' ' + (a.title || '') + '\n'
                + U.fmtDateFull(a.date) + '〜' + U.fmtDateFull(a.endDate || a.date)
                + '\n予定 ' + (a.hours || 0) + 'h',
              style: {
                background: ac, color: '#fff', borderRadius: '3px', padding: '1px 4px',
                marginBottom: '2px', fontSize: '9.5px', fontWeight: 700,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              },
              onclick: function (e) { e.stopPropagation(); Views.planAssign._editor(a, function () { App.render(); }); },
              text: '📌 ' + (a.title || a.category || '')
            }));
          });
          list.forEach(function (p) {
            var color = State.planColor(p.category);
            var result = isResult(p);
            td.appendChild(U.el('div', {
              style: {
                background: result ? 'transparent' : color + '1c',
                border: result ? '1px dashed ' + color : null,
                borderLeft: '3px solid ' + color, borderRadius: '4px',
                padding: '2px 5px', marginBottom: '2px', fontSize: '10.5px', whiteSpace: 'normal'
              },
              title: (result ? '実績' : '予定') + ' / ' + (p.category || '') + ' ' + (p.title || '') + '\n' + (p.project || '')
                + '\n' + (result ? '実績 ' + (p.actualHours || 0) + 'h 進捗 ' + (p.progress === null || p.progress === undefined ? '-' : p.progress + '%')
                  : '予定 ' + (p.hours || 0) + 'h'),
              onclick: function (e) { e.stopPropagation(); Views.planInput._editor(p, function () { App.render(); }); }
            }, [
              U.el('div', { class: 'strong', style: { color: color }, text: (result ? '🌙 ' : '☀ ') + (p.category || '—') }),
              p.title ? U.el('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'anywhere' }, text: p.title }) : null,
              U.el('div', { class: 'muted mono' }, [
                document.createTextNode(result
                  ? (p.actualHours ? U.fmtH(p.actualHours) + 'h' : '')
                  : (p.hours ? U.fmtH(p.hours) + 'h' : '')),
                result && p.progress !== null && p.progress !== undefined
                  ? U.el('span', { class: 'strong', style: { marginLeft: '4px', color: color }, text: p.progress + '%' }) : null
              ])
            ]));
          });
          if (!list.length) td.appendChild(U.el('div', { class: 'muted', style: { fontSize: '10px', textAlign: 'center', padding: '4px 0' }, text: '＋' }));
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      card.appendChild(wrap);
      root.appendChild(card);

      root.appendChild(U.el('div', { class: 'card mt12' }, [
        U.el('div', { class: 'card-body' }, [
          U.el('div', { class: 'legend' }, (State.masters.planCategories || []).map(function (c) {
            return U.el('span', {}, [U.el('i', { style: { background: c.color } }), document.createTextNode(c.value)]);
          }))
        ])
      ]));
    }
  };

  /* ------------------------------------------------ サマリ */
  Views.planReport = {
    title: '予定サマリ',
    desc: '業務予定の集計と、開発実績との突き合わせ',
    icon: '📊',
    app: 'plan',
    render: function (root) {
      var plans = (State.plans || []).filter(function (p) {
        if (isAssignment(p)) return false;
        if (R.from && (p.endDate || p.date) < R.from) return false;
        if (R.to && p.date > R.to) return false;
        return true;
      });
      var assigns = (State.plans || []).filter(function (p) {
        if (!isAssignment(p)) return false;
        if (R.from && (p.endDate || p.date) < R.from) return false;
        if (R.to && p.date > R.to) return false;
        return true;
      });

      var bar = U.el('div', { class: 'filterbar' }, [
        U.el('div', { class: 'fld' }, [U.el('label', { text: '期間 From' }),
        U.el('input', { type: 'date', value: R.from, onchange: function () { R.from = this.value; App.render(); } })]),
        U.el('div', { class: 'fld' }, [U.el('label', { text: '期間 To' }),
        U.el('input', { type: 'date', value: R.to, onchange: function () { R.to = this.value; App.render(); } })]),
        U.el('div', { class: 'fld' }, [U.el('label', { text: '集計軸' }),
        (function () {
          var s = U.el('select', { onchange: function () { R.dim = this.value; App.render(); } });
          [['category', '作業区分'], ['member', '担当者'], ['project', '案件'], ['status', 'ステータス']]
            .forEach(function (o) { s.appendChild(U.el('option', { value: o[0], text: o[1], selected: R.dim === o[0] })); });
          return s;
        })()]),
        U.el('div', { class: 'spacer' }),
        U.el('button', { class: 'btn btn-sm', text: '⬇ CSV出力', onclick: exportPlans })
      ]);
      root.appendChild(bar);

      if (!plans.length) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">📊</span>業務予定がまだ登録されていません' }));
        return;
      }

      var planRows = plans.filter(isPlan);
      var resultRows = plans.filter(isResult);
      var planned = U.sum(planRows, function (p) { return p.hours; });
      var actual = U.sum(resultRows, function (p) { return p.actualHours; });
      var avgProgress = resultRows.length
        ? U.sum(resultRows, function (p) { return p.progress; }) / resultRows.length : 0;
      root.appendChild(U.el('div', { class: 'grid k4' }, [
        Views._helpers.kpi('記録件数', String(plans.length), '件',
          '☀ 予定 ' + planRows.length + ' / 🌙 実績 ' + resultRows.length + ' / 📌 取組み ' + assigns.length
          + '（担当 ' + U.uniq(plans.map(function (p) { return p.member; })).length + '名）', 'blue'),
        Views._helpers.kpi('予定工数', U.fmtH(planned), 'h', '約 ' + U.fmtNum(planned / (State.settings().workHoursPerDay || 7.5), 1) + ' 人日', 'violet'),
        Views._helpers.kpi('実績工数', U.fmtH(actual), 'h', planned ? '消化率 ' + U.fmtNum(actual / planned * 100, 0) + '%' : '—', 'green'),
        Views._helpers.kpi('平均進捗率', resultRows.length ? U.fmtNum(avgProgress, 0) : '—', '%',
          '完了 ' + resultRows.filter(function (p) { return p.status === '完了'; }).length + '件', 'amber')
      ]));

      var g = U.groupBy(plans, function (p) { return p[R.dim]; });
      var items = Array.from(g.entries()).map(function (e) {
        return {
          label: e[0], count: e[1].length,
          planned: Math.round(U.sum(e[1].filter(isPlan), function (p) { return p.hours; }) * 100) / 100,
          actual: Math.round(U.sum(e[1].filter(isResult), function (p) { return p.actualHours; }) * 100) / 100
        };
      }).sort(function (a, b) { return b.planned - a.planned; });

      root.appendChild(U.el('div', { class: 'grid k2 mt16' }, [
        Views._helpers.chartCard('集計軸別 予定工数', function (box) {
          Charts.hbar(box, {
            items: items.map(function (i) {
              return { label: i.label, value: i.planned, color: R.dim === 'category' ? State.planColor(i.label) : U.colorOf(i.label) };
            }), labelWidth: 180, labelMax: 22, unit: ' h'
          });
        }),
        Views._helpers.chartCard('日別 予定 / 実績 工数の推移', function (box) {
          var dates = U.uniq(plans.map(function (p) { return p.date; })).sort().slice(-30);
          Charts.line(box, {
            labels: dates.map(function (d) { return U.fmtDate(d); }), area: true,
            series: [{
              name: '予定工数', color: '#2563eb',
              values: dates.map(function (d) { return Math.round(U.sum(State.plansOnDate(d).filter(isPlan), function (p) { return p.hours; }) * 10) / 10; })
            }, {
              name: '実績工数', color: '#16a34a',
              values: dates.map(function (d) { return Math.round(U.sum(State.plansOnDate(d).filter(isResult), function (p) { return p.actualHours; }) * 10) / 10; })
            }], height: 250
          });
        })
      ]));

      var card = U.el('div', { class: 'card mt16' }, [
        U.el('div', { class: 'card-head' }, [U.el('h3', { text: '集計表' })])
      ]);
      var tbl = U.el('table', { class: 'grid-table' });
      tbl.appendChild(U.el('thead', {}, [U.el('tr', {}, ['区分', '件数', '予定工数(h)', '実績工数(h)', '消化率', '構成比'].map(function (h, i) {
        return U.el('th', { class: i ? 'right' : '', text: h });
      }))]));
      var tb = U.el('tbody');
      items.forEach(function (i) {
        tb.appendChild(U.el('tr', {}, [
          U.el('td', { class: 'strong' }, [
            U.el('span', { class: 'chip dot', style: { background: (R.dim === 'category' ? State.planColor(i.label) : U.colorOf(i.label)) + '1f', color: R.dim === 'category' ? State.planColor(i.label) : U.colorOf(i.label) }, text: i.label })
          ]),
          U.el('td', { class: 'num', text: String(i.count) }),
          U.el('td', { class: 'num', text: U.fmtH(i.planned) }),
          U.el('td', { class: 'num', text: U.fmtH(i.actual) }),
          U.el('td', { class: 'num', text: i.planned ? U.fmtNum(i.actual / i.planned * 100, 0) + '%' : '' }),
          U.el('td', {}, [U.el('div', { class: 'progress' }, [U.el('span', { style: { width: (planned ? i.planned / planned * 100 : 0) + '%' } })])])
        ]));
      });
      tb.appendChild(U.el('tr', { style: { background: 'var(--surface-2)' } }, [
        U.el('td', { class: 'strong', text: '合計' }),
        U.el('td', { class: 'num strong', text: String(plans.length) }),
        U.el('td', { class: 'num strong', text: U.fmtH(planned) }),
        U.el('td', { class: 'num strong', text: U.fmtH(actual) }),
        U.el('td', { class: 'num strong', text: planned ? U.fmtNum(actual / planned * 100, 0) + '%' : '' }),
        U.el('td', {})
      ]));
      tbl.appendChild(tb);
      card.appendChild(U.el('div', { class: 'table-wrap' }, [tbl]));
      root.appendChild(card);
    }
  };

  function exportPlans() {
    var head = ['種別', '担当者', '開始日', '終了日', 'PJCD', 'PJ名称', '作業コード', '作業コード名称',
      '工程（作業区分）', '案件名', '作業内容',
      '予定工数', '実績工数', '進捗率', '状況', '取組み予定ID', '備考', '更新者'];
    var label = { plan: '予定', result: '実績', assignment: '取組み予定' };
    var lines = [head.join(',')];
    (State.plans || []).slice().sort(function (a, b) {
      return (a.date || '') === (b.date || '')
        ? (a.member || '').localeCompare(b.member || '')
        : ((a.date || '') < (b.date || '') ? -1 : 1);
    }).forEach(function (p) {
      lines.push([label[kindOf(p)], p.member, p.date, p.endDate,
        p.projectCode, State.codeName('projectCodes', p.projectCode),
        p.workCode, State.codeName('workCodes', p.workCode),
        p.category, p.project, p.title,
        p.hours, p.actualHours, p.progress, p.status, p.assignmentId, p.note, p.updatedBy]
        .map(function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }).join(','));
    });
    U.download('業務予定実績.csv', new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
  }
})(window);
