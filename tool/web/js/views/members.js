/* ============================================================
   views/members.js - 製造者（担当者）の動きビュー
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};
  var selectedMember = null;

  function monthStats(tasks, monthKey) {
    var inMonth = tasks.filter(function (t) { return U.monthKey(t.endDate) === monthKey; });
    var mfg = inMonth.filter(function (t) { return t.type === 'mfg'; });
    return {
      count: inMonth.length,
      step: U.sum(mfg, function (t) { return t.convStep; }),
      hour: U.sum(inMonth, function (t) { return t.totalHour; }),
      issue: U.sum(inMonth, function (t) { return t.issueTotal; }),
      prod: U.avg(mfg, function (t) { return t.prodMonth; }),
      quality: U.avg(mfg, function (t) { return t.quality; })
    };
  }

  function memberCard(name, onOpen) {
    var E = State.enums.status;
    var all = State.tasksOfMember(name);
    var now = Logic.currentWork(name);
    var next = Logic.upcoming(name, 60);
    var late = all.filter(function (t) { return t.isLate; });
    var thisMonth = U.monthKey(U.iso(U.today()));
    var st = monthStats(all, thisMonth);
    var color = U.colorOf(name);

    var card = U.el('div', { class: 'card member-card' });
    card.appendChild(U.el('div', { class: 'member-top' }, [
      U.el('div', { class: 'avatar', style: { background: color }, text: U.initials(name) }),
      U.el('div', { style: { flex: 1 } }, [
        U.el('div', { class: 'member-name', text: name }),
        U.el('div', { class: 'member-sub', text: '担当 ' + all.length + '件 / 進行中 ' + now.length + '件' + (late.length ? ' / ⚠遅延 ' + late.length : '') })
      ]),
      U.el('button', { class: 'btn btn-sm', text: '詳細', onclick: function () { onOpen(name); } })
    ]));

    card.appendChild(U.el('div', { class: 'muted', style: { fontSize: '10.5px', fontWeight: 700, marginTop: '2px' }, text: '▶ いまの作業' }));
    if (now.length) {
      now.slice(0, 3).forEach(function (t) {
        card.appendChild(U.el('div', {
          class: 'work-now', style: { cursor: 'pointer' },
          onclick: function () { Form.openViewer(t, function () { App.render(); }); }
        }, [
          U.el('div', {}, [
            U.el('span', { class: 'pid', text: t.programId || '(ID未設定)' }),
            U.el('span', { class: 'tag', style: { marginLeft: '6px' }, text: t.kubun || '' }),
            U.el('span', { class: 'tag', style: { marginLeft: '4px' }, text: t.resource || '' })
          ]),
          U.el('div', { class: 'muted', style: { fontSize: '11px' }, text: t.project || '' }),
          U.el('div', { class: 'row-flex', style: { marginTop: '4px', fontSize: '11px' } }, [
            U.el('span', { text: U.fmtDate(t.startDate) + ' 〜 ' + U.fmtDate(t.endDate) }),
            t.isLate ? U.el('span', { style: { color: 'var(--danger)', fontWeight: 700 }, text: '遅延中' }) : null,
            U.el('div', { class: 'progress', style: { flex: 1 } }, [U.el('span', { style: { width: (U.num(t.progress) || datePct(t)) + '%' } })])
          ])
        ]));
      });
    } else {
      card.appendChild(U.el('div', { class: 'work-none', text: '進行中の作業はありません' }));
    }

    card.appendChild(U.el('div', { class: 'muted', style: { fontSize: '10.5px', fontWeight: 700, marginTop: '4px' }, text: '▶ 予定作業' }));
    if (next.length) {
      var list = U.el('div', { class: 'mini-list' });
      next.slice(0, 4).forEach(function (t) {
        list.appendChild(U.el('div', {
          class: 'mini-row', style: { cursor: 'pointer' },
          onclick: function () { Form.openViewer(t, function () { App.render(); }); }
        }, [
          U.el('span', { class: 'mono strong', text: t.programId || '—' }),
          U.el('span', { class: 'grow muted', text: t.project || '' }),
          U.el('span', { class: 'nowrap muted', text: U.fmtDate(t.startDate) + '〜' })
        ]));
      });
      card.appendChild(list);
    } else {
      card.appendChild(U.el('div', { class: 'work-none', text: '登録された予定作業はありません' }));
    }

    card.appendChild(U.el('div', { class: 'stat-row mt8' }, [
      U.el('div', { class: 'stat' }, [U.el('b', { text: String(st.count) }), U.el('span', { text: '今月完了(件)' })]),
      U.el('div', { class: 'stat' }, [U.el('b', { text: U.fmtNum(st.step, 0) }), U.el('span', { text: '換算step' })]),
      U.el('div', { class: 'stat' }, [U.el('b', { text: U.fmtNum(st.hour, 1) }), U.el('span', { text: '工数(h)' })]),
      U.el('div', { class: 'stat' }, [U.el('b', { text: st.prod === null ? '—' : U.fmtNum(st.prod, 0) }), U.el('span', { text: '月換算生産性' })])
    ]));

    var todayPlans = State.plansOnDate(U.iso(U.today()), name).filter(function (p) {
      return State.planKind(p) !== 'assignment';
    });
    if (todayPlans.length) {
      card.appendChild(U.el('div', { class: 'muted', style: { fontSize: '10.5px', fontWeight: 700, marginTop: '4px' }, text: '▶ 本日の予定 / 実績' }));
      card.appendChild(U.el('div', { class: 'pill-group' }, todayPlans.map(function (p) {
        var c = State.planColor(p.category);
        var result = p.kind === 'result';
        var tail = result
          ? (p.progress === null || p.progress === undefined ? '' : ' ' + p.progress + '%')
          : (p.hours ? ' ' + U.fmtNum(p.hours, 1) + 'h' : '');
        return U.el('span', {
          class: 'chip', style: {
            background: result ? 'transparent' : c + '1f', color: c, cursor: 'pointer',
            border: result ? '1px dashed ' + c : null
          },
          title: (result ? '実績' : '予定') + ' / ' + (p.title || '') + ' ' + (p.project || ''),
          onclick: function (e) { e.stopPropagation(); Views.planInput._editor(p, function () { App.render(); }); },
          text: (result ? '🌙 ' : '☀ ') + p.category + tail
        });
      })));
    }
    return card;
  }

  function datePct(t) {
    var s = U.parseDate(t.startDate), e = U.parseDate(t.endDate);
    if (!s || !e || e <= s) return 50;
    var total = U.diffDays(s, e) + 1;
    var done = U.diffDays(s, U.today()) + 1;
    return Math.max(0, Math.min(100, Math.round(done / total * 100)));
  }

  /* --------------------------------------------------- 詳細 */
  function detail(root, name) {
    var E = State.enums.status;
    var all = State.tasksOfMember(name).slice().sort(function (a, b) {
      return (a.startDate || '') < (b.startDate || '') ? 1 : -1;
    });
    var color = U.colorOf(name);

    root.appendChild(U.el('div', { class: 'row-flex', style: { marginBottom: '12px' } }, [
      U.el('button', { class: 'btn btn-sm', text: '‹ 一覧に戻る', onclick: function () { selectedMember = null; App.render(); } }),
      U.el('div', { class: 'avatar', style: { background: color }, text: U.initials(name) }),
      U.el('h2', { text: name, style: { fontSize: '18px' } }),
      U.el('div', { class: 'spacer', style: { flex: 1 } }),
      U.el('button', { class: 'btn btn-sm', text: 'この担当者で一覧を開く', onclick: function () { App.go('tasks', { assignee: name }); } }),
      U.el('button', { class: 'btn btn-sm btn-primary', text: '＋ タスク追加', onclick: function () { Form.openEditor({ type: 'mfg', assignee1: name }, function () { App.render(); }); } })
    ]));

    var months = Views._helpers.recentMonths(12);
    var mfgAll = all.filter(function (t) { return t.type === 'mfg'; });
    var kpiRow = U.el('div', { class: 'grid k4' }, [
      Views._helpers.kpi('担当タスク', String(all.length), '件', '製造 ' + mfgAll.length + ' / 設計 ' + (all.length - mfgAll.length), 'blue'),
      Views._helpers.kpi('進行中', String(Logic.currentWork(name).length), '件', '予定 ' + Logic.upcoming(name, 90).length + '件', 'violet'),
      Views._helpers.kpi('累計 換算step', U.fmtNum(U.sum(mfgAll, function (t) { return t.convStep; }), 0), '', '累計工数 ' + U.fmtNum(U.sum(all, function (t) { return t.totalHour; }), 1) + 'h', 'green'),
      Views._helpers.kpi('平均 品質(指摘/KS)', U.fmtNum(U.avg(mfgAll, function (t) { return t.quality; }), 1), '', '平均生産性 ' + U.fmtNum(U.avg(mfgAll, function (t) { return t.prodMonth; }), 0), 'amber')
    ]);
    root.appendChild(kpiRow);

    var charts = U.el('div', { class: 'grid k2 mt16' });
    charts.appendChild(Views._helpers.chartCard('月次 完了件数 / 換算step', function (box) {
      Charts.line(box, {
        labels: months.map(U.monthLabel), area: true,
        series: [
          { name: '完了件数', color: '#2563eb', values: months.map(function (m) { return all.filter(function (t) { return U.monthKey(t.endDate) === m; }).length; }) },
          { name: '換算step(÷10)', color: '#7c3aed', values: months.map(function (m) { return Math.round(U.sum(mfgAll.filter(function (t) { return U.monthKey(t.endDate) === m; }), function (t) { return t.convStep; }) / 10); }) }
        ], height: 230
      });
    }));
    charts.appendChild(Views._helpers.chartCard('月次 生産性 / 品質', function (box) {
      Charts.line(box, {
        labels: months.map(U.monthLabel),
        series: [
          { name: '月換算生産性', color: '#16a34a', values: months.map(function (m) { return round1(U.avg(mfgAll.filter(function (t) { return U.monthKey(t.endDate) === m; }), function (t) { return t.prodMonth; })); }) },
          { name: '品質(指摘/KS)', color: '#dc2626', values: months.map(function (m) { return round1(U.avg(mfgAll.filter(function (t) { return U.monthKey(t.endDate) === m; }), function (t) { return t.quality; })); }) }
        ], height: 230
      });
    }));
    root.appendChild(charts);

    var charts2 = U.el('div', { class: 'grid k2 mt16' });
    charts2.appendChild(Views._helpers.chartCard('案件別 担当件数', function (box) {
      var g = U.groupBy(all, function (t) { return t.project; });
      Charts.hbar(box, {
        items: Array.from(g.entries()).map(function (e) { return { label: e[0], value: e[1].length }; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 10),
        labelWidth: 230, labelMax: 28, unit: '件'
      });
    }));
    charts2.appendChild(Views._helpers.chartCard('リソース区分別 換算step', function (box) {
      var g = U.groupBy(mfgAll, function (t) { return t.resource; });
      Charts.donut(box, {
        items: Array.from(g.entries()).map(function (e) { return { label: e[0], value: Math.round(U.sum(e[1], function (t) { return t.convStep; })) }; })
          .filter(function (i) { return i.value > 0; }).sort(function (a, b) { return b.value - a.value; }),
        centerLabel: 'step'
      });
    }));
    root.appendChild(charts2);

    /* 個人タイムライン */
    root.appendChild(Views._helpers.chartCard('作業タイムライン（直近90日）', function (box) {
      Gantt.renderInto(box, all, { days: 90, groupBy: null, height: 'auto' });
    }));

    /* タスク一覧 */
    var card = U.el('div', { class: 'card mt16' }, [
      U.el('div', { class: 'card-head' }, [U.el('h3', { text: '担当タスク一覧' }), U.el('span', { class: 'sub', text: all.length + '件' })])
    ]);
    var wrap = U.el('div', { class: 'table-wrap' });
    var tbl = U.el('table', { class: 'grid-table' });
    tbl.appendChild(U.el('thead', {}, [U.el('tr', {}, ['ステータス', '種別', 'プログラムID', '案件名', '区分', '開始', '終了', '換算step', '工数', '指摘'].map(function (h) { return U.el('th', { text: h }); }))]));
    var tb = U.el('tbody');
    all.forEach(function (t) {
      tb.appendChild(U.el('tr', {
        class: t.isLate ? 'row-late' : '', style: { cursor: 'pointer' },
        onclick: function () { Form.openViewer(t, function () { App.render(); }); }
      }, [
        U.el('td', {}, [Form.statusChip(t.effectiveStatus)]),
        U.el('td', {}, [U.el('span', { class: 'tag', text: State.typeLabel(t.type) })]),
        U.el('td', { class: 'mono strong', text: t.programId || '' }),
        U.el('td', { style: { maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }, title: t.project || '', text: t.project || '' }),
        U.el('td', { text: t.kubun || '' }),
        U.el('td', { class: 'mono', text: U.fmtDateFull(t.startDate) }),
        U.el('td', { class: 'mono', text: U.fmtDateFull(t.endDate) }),
        U.el('td', { class: 'num', text: U.fmtNum(t.convStep, 0) }),
        U.el('td', { class: 'num', text: U.fmtNum(t.totalHour, 1) }),
        U.el('td', { class: 'num', text: U.fmtNum(t.issueTotal, 0) })
      ]));
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    root.appendChild(card);
  }

  function round1(v) { return v === null || v === undefined ? null : Math.round(v * 10) / 10; }

  Views.members = {
    title: '担当者ビュー',
    desc: '誰が今なにをしていて、次に何をするのかを可視化',
    icon: '👥',
    onEnter: function (params) { if (params && params.member) selectedMember = params.member; },
    render: function (root) {
      if (selectedMember && State.members().indexOf(selectedMember) >= 0) {
        return detail(root, selectedMember);
      }
      selectedMember = null;
      var members = State.members();
      if (!members.length) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">👥</span>担当者データがありません。まずExcelを取り込んでください。' }));
        return;
      }

      var E = State.enums.status;
      var bar = U.el('div', { class: 'filterbar' }, [
        U.el('strong', { text: '稼働サマリ' }),
        U.el('span', { class: 'muted', text: '進行中 ' + State.tasks.filter(function (t) { return t.effectiveStatus === E.doing; }).length + '件 / 担当者 ' + members.length + '名' }),
        U.el('div', { class: 'spacer' }),
        U.el('button', { class: 'btn btn-sm', text: 'ガントで見る', onclick: function () { App.go('gantt'); } })
      ]);
      root.appendChild(bar);

      var grid = U.el('div', { class: 'grid k3' });
      members.forEach(function (m) {
        grid.appendChild(memberCard(m, function (name) { selectedMember = name; App.render(); }));
      });
      root.appendChild(grid);

      root.appendChild(U.el('div', { class: 'grid k2 mt16' }, [
        Views._helpers.chartCard('担当者別 累計 換算step', function (box) {
          Charts.hbar(box, {
            items: members.map(function (m) {
              return { label: m, value: Math.round(U.sum(State.tasksOfMember(m).filter(function (t) { return t.type === 'mfg'; }), function (t) { return t.convStep; })), color: U.colorOf(m) };
            }).sort(function (a, b) { return b.value - a.value; }), labelWidth: 110, unit: ' step'
          });
        }),
        Views._helpers.chartCard('担当者別 累計工数(h)', function (box) {
          Charts.hbar(box, {
            items: members.map(function (m) {
              return { label: m, value: Math.round(U.sum(State.tasksOfMember(m), function (t) { return t.totalHour; }) * 10) / 10, color: U.colorOf(m) };
            }).sort(function (a, b) { return b.value - a.value; }), labelWidth: 110, unit: ' h'
          });
        })
      ]));
    }
  };
})(window);
