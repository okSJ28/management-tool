/* ============================================================
   views/dashboard.js - ダッシュボード
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  function kpi(label, value, unit, foot, accent) {
    return U.el('div', { class: 'card kpi accent-' + (accent || 'blue') }, [
      U.el('div', { class: 'label', text: label }),
      U.el('div', { class: 'value' }, [
        document.createTextNode(value),
        unit ? U.el('small', { text: unit }) : null
      ]),
      foot ? U.el('div', { class: 'foot', html: foot }) : null
    ]);
  }

  function miniTaskRow(t, extra) {
    return U.el('div', {
      class: 'mini-row', style: { cursor: 'pointer' },
      onclick: function () { Form.openViewer(t, function () { App.render(); }); }
    }, [
      U.el('span', { class: 'chip dot', style: { background: State.statusColor(t.effectiveStatus) + '22', color: State.statusColor(t.effectiveStatus) }, text: t.effectiveStatus }),
      U.el('b', { class: 'mono', text: t.programId || '—' }),
      U.el('span', { class: 'grow muted', text: t.project || '' }),
      U.el('span', { class: 'muted nowrap', text: extra || (U.fmtDate(t.startDate) + '〜' + U.fmtDate(t.endDate)) })
    ]);
  }

  /* 指定日の業務予定を「作業」単位にまとめる。実績は sourceId で予定と対応づけ、残りは予定外とする */
  function dayItems(iso, member) {
    var list = State.plansOnDate(iso, member);
    var results = list.filter(function (p) { return State.planKind(p) === 'result'; });
    var used = {};
    var items = list.filter(function (p) { return State.planKind(p) === 'plan'; }).map(function (p) {
      var res = null;
      results.some(function (r) {
        if (!used[r.id] && r.sourceId && r.sourceId === p.id) { used[r.id] = true; res = r; return true; }
        return false;
      });
      return { member: p.member, plan: p, result: res, base: p };
    });
    results.forEach(function (r) {
      if (!used[r.id]) items.push({ member: r.member, plan: null, result: r, base: r });
    });
    return items;
  }
  function itemPlanH(it) { return it.plan ? (it.plan.hours || 0) : 0; }
  function itemActualH(it) {
    if (!it.result) return 0;
    return it.result.actualHours != null ? it.result.actualHours : itemPlanH(it);
  }
  function itemHoursText(it) {
    var plan = it.plan && it.plan.hours ? U.fmtH(it.plan.hours) + 'h' : '';
    if (!it.result) return plan;
    return (plan || '予定外') + ' → ' + U.fmtH(itemActualH(it)) + 'h';
  }

  /* ------------------------------- 担当者別 実施本数（システム別2行 × 区分 / リソース区分） */
  var VOL = { period: 'fy', scope: 'done', type: 'all' };
  var SYS_ROWS = ['ES', 'NET'];
  var SYS_COLOR = { 'ES': '#0d9488', 'NET': '#d97706', 'その他': '#94a3b8' };

  function volumeCard() {
    var E = State.enums.status;
    var startMonth = State.settings().fiscalStartMonth || 4;
    var today = U.today();
    var thisMonth = U.monthKey(U.iso(today));
    var thisFy = U.fiscalYear(today, startMonth);

    var rows = State.tasks.filter(function (t) {
      if (VOL.type !== 'all' && t.type !== VOL.type) return false;
      if (VOL.scope === 'done' && t.effectiveStatus !== E.done) return false;
      if (VOL.period === 'all') return true;
      var d = U.parseDate(t.endDate);
      if (!d) return false;
      return VOL.period === 'month'
        ? U.monthKey(t.endDate) === thisMonth
        : U.fiscalYear(d, startMonth) === thisFy;
    });

    // マスタ順を優先し、列が多すぎる場合は下位を「その他」に畳む
    function makeCol(label, color, raw, master, maxCols) {
      var count = {};
      rows.forEach(function (t) { var v = raw(t); count[v] = (count[v] || 0) + 1; });
      var ordered = (master || []).filter(function (v) { return count[v]; });
      Object.keys(count)
        .filter(function (v) { return ordered.indexOf(v) < 0; })
        .sort(function (a, b) { return count[b] - count[a]; })
        .forEach(function (v) { ordered.push(v); });

      var folded = {};
      if (ordered.length > maxCols) {
        ordered.slice(maxCols - 1).forEach(function (v) { folded[v] = true; });
        ordered = ordered.slice(0, maxCols - 1).concat(['その他']);
      }
      return {
        label: label, color: color, values: ordered,
        get: function (t) { var v = raw(t); return folded[v] ? 'その他' : v; }
      };
    }

    var cols = [
      makeCol('区分', '#2563eb', function (t) { return t.kubun || '未設定'; },
        State.masters.kubuns || [], 6),
      makeCol('リソース区分', '#0891b2', function (t) { return t.resource || '未設定'; },
        State.masters.resources || [], 12)
    ];

    function sysOf(t) {
      var s = t.system || '';
      return SYS_ROWS.indexOf(s) >= 0 ? s : 'その他';
    }

    var byMember = {};
    var sysTotal = {};
    rows.forEach(function (t) {
      var name = t.assignee1 || '未割当';
      var sys = sysOf(t);
      var m = byMember[name] || (byMember[name] = { name: name, total: 0, sys: {} });
      var s = m.sys[sys] || (m.sys[sys] = { total: 0, cells: {} });
      m.total += 1;
      s.total += 1;
      sysTotal[sys] = (sysTotal[sys] || 0) + 1;
      cols.forEach(function (c, ci) {
        var key = ci + '|' + c.get(t);
        s.cells[key] = (s.cells[key] || 0) + 1;
      });
    });

    var sysRows = SYS_ROWS.slice();
    if (sysTotal['その他']) sysRows.push('その他');

    var list = Object.keys(byMember).map(function (k) { return byMember[k]; })
      .sort(function (a, b) { return b.total - a.total; });
    var maxCell = 1;
    list.forEach(function (m) {
      sysRows.forEach(function (s) { maxCell = Math.max(maxCell, (m.sys[s] || {}).total || 0); });
    });

    function picker(key, options) {
      var s = U.el('select', {
        style: { fontSize: '11.5px', padding: '3px 6px' },
        onchange: function () { VOL[key] = this.value; App.render(); }
      });
      options.forEach(function (o) {
        s.appendChild(U.el('option', { value: o[0], text: o[1], selected: VOL[key] === o[0] }));
      });
      s.value = VOL[key];
      return s;
    }

    var card = U.el('div', { class: 'card mt16' }, [
      U.el('div', { class: 'card-head' }, [
        U.el('div', {}, [
          U.el('h3', { text: '📊 担当者別 実施本数' }),
          U.el('span', {
            class: 'sub',
            text: '担当者①ベース / システム別 / 対象 ' + rows.length + '件'
          })
        ]),
        U.el('div', { class: 'tools' }, [
          picker('period', [['month', '今月'], ['fy', '今年度'], ['all', '全期間']]),
          picker('scope', [['done', '完了のみ'], ['all', '全ステータス']]),
          picker('type', [['all', '製造＋詳細設計'], ['mfg', '製造'], ['dd', '詳細設計']]),
          U.el('button', { class: 'btn btn-sm', text: '一覧へ', onclick: function () { App.go('tasks'); } })
        ])
      ])
    ]);

    if (!list.length) {
      card.appendChild(U.el('div', {
        class: 'empty', html: '<span class="big">📊</span>該当するタスクがありません<br><small>期間や対象を変更してください</small>'
      }));
      return card;
    }

    var tbl = U.el('table', { class: 'grid-table vol-table' });
    var sep = { borderLeft: '2px solid var(--border)' };

    var gh = U.el('tr', {}, [
      U.el('th', { rowspan: 2, class: 'vpin vpin-1', style: { width: '116px', minWidth: '116px' }, text: '担当者' }),
      U.el('th', { rowspan: 2, class: 'vpin vpin-2', style: { width: '70px', minWidth: '70px' }, text: 'システム' }),
      U.el('th', { rowspan: 2, class: 'right', style: { width: '104px', minWidth: '104px' }, text: '本数' })
    ]);
    var ch = U.el('tr');
    cols.forEach(function (c) {
      gh.appendChild(U.el('th', {
        colspan: c.values.length, class: 'center',
        style: Object.assign({ color: c.color, background: c.color + '12' }, sep),
        text: c.label
      }));
      c.values.forEach(function (v, vi) {
        ch.appendChild(U.el('th', {
          class: 'right', style: Object.assign({ minWidth: '54px', fontSize: '11px' }, vi === 0 ? sep : {}),
          title: v, text: v
        }));
      });
    });
    tbl.appendChild(U.el('thead', {}, [gh, ch]));

    function countCell(value, color, first, bold) {
      return U.el('td', {
        class: 'num', style: Object.assign(
          { color: value ? color : 'var(--text-3)', fontWeight: value ? (bold ? 800 : 700) : 400 },
          first ? sep : {})
      }, [document.createTextNode(value ? String(value) : '·')]);
    }

    function sysChip(sys) {
      return U.el('span', {
        class: 'chip', style: {
          background: SYS_COLOR[sys] + '1f', color: SYS_COLOR[sys],
          fontWeight: 700, padding: '0 7px'
        }, text: sys
      });
    }

    var tb = U.el('tbody');
    list.forEach(function (m) {
      sysRows.forEach(function (sys, si) {
        var s = m.sys[sys] || { total: 0, cells: {} };
        var topBorder = si === 0 ? { borderTop: '2px solid var(--border)' } : {};
        var tr = U.el('tr', {
          style: Object.assign({ cursor: 'pointer' }, s.total ? {} : { opacity: 0.55 }),
          onclick: function () { App.go('members', { member: m.name }); }
        });
        if (si === 0) {
          tr.appendChild(U.el('td', {
            rowspan: sysRows.length, class: 'vpin vpin-1 strong',
            style: Object.assign({
              verticalAlign: 'middle', maxWidth: '116px', overflow: 'hidden', textOverflow: 'ellipsis'
            }, topBorder),
            title: m.name
          }, [
            U.el('span', {
              class: 'avatar', style: {
                background: U.colorOf(m.name), width: '20px', height: '20px', flex: '0 0 20px',
                fontSize: '9px', display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px'
              }, text: U.initials(m.name)
            }),
            document.createTextNode(m.name),
            U.el('div', { class: 'muted', style: { fontSize: '10.5px' }, text: '計 ' + m.total + '本' })
          ]));
        }
        tr.appendChild(U.el('td', { class: 'vpin vpin-2', style: topBorder }, [sysChip(sys)]));
        tr.appendChild(U.el('td', { style: topBorder }, [
          U.el('div', { class: 'row-flex', style: { gap: '6px' } }, [
            U.el('b', { class: 'mono', style: { minWidth: '24px', textAlign: 'right' }, text: String(s.total) }),
            U.el('div', { class: 'progress', style: { flex: 1 } }, [
              U.el('span', { style: { width: (s.total / maxCell * 100) + '%', background: SYS_COLOR[sys] } })
            ])
          ])
        ]));
        cols.forEach(function (c, ci) {
          c.values.forEach(function (v, vi) {
            var cell = countCell(s.cells[ci + '|' + v] || 0, c.color, vi === 0);
            Object.assign(cell.style, topBorder);
            tr.appendChild(cell);
          });
        });
        tb.appendChild(tr);
      });
    });

    sysRows.forEach(function (sys, si) {
      var foot = U.el('tr', { style: { background: 'var(--surface-2)' } }, [
        si === 0 ? U.el('td', {
          rowspan: sysRows.length, class: 'vpin vpin-1 strong',
          style: { verticalAlign: 'middle', borderTop: '2px solid var(--text-3)' }, text: '合計'
        }) : null,
        U.el('td', {
          class: 'vpin vpin-2',
          style: si === 0 ? { borderTop: '2px solid var(--text-3)' } : {}
        }, [sysChip(sys)]),
        U.el('td', {
          class: 'num strong',
          style: si === 0 ? { borderTop: '2px solid var(--text-3)' } : {},
          text: String(sysTotal[sys] || 0)
        })
      ]);
      cols.forEach(function (c, ci) {
        c.values.forEach(function (v, vi) {
          var sum = list.reduce(function (a, m) {
            return a + (((m.sys[sys] || {}).cells || {})[ci + '|' + v] || 0);
          }, 0);
          var cell = countCell(sum, c.color, vi === 0, true);
          if (si === 0) cell.style.borderTop = '2px solid var(--text-3)';
          foot.appendChild(cell);
        });
      });
      tb.appendChild(foot);
    });

    tbl.appendChild(tb);
    card.appendChild(U.el('div', { class: 'table-wrap vol-wrap' }, [tbl]));
    card.appendChild(U.el('div', { class: 'card-body tight' }, [
      U.el('div', {
        class: 'muted', style: { fontSize: '11px' },
        text: '← 横スクロールで全列を確認できます（担当者・システム列は固定）　行クリックで担当者ビューへ'
      })
    ]));
    return card;
  }

  Views.dashboard = {
    title: 'ダッシュボード',
    desc: '全体状況をひと目で把握',
    icon: '🏠',
    render: function (root) {
      var E = State.enums.status;
      var tasks = State.tasks;
      var td = U.today(), tdIso = U.iso(td);
      var thisMonth = U.monthKey(tdIso);

      var doing = tasks.filter(function (t) { return t.effectiveStatus === E.doing || t.effectiveStatus === E.review; });
      var late = tasks.filter(function (t) { return t.isLate; });
      var soon = tasks.filter(function (t) {
        return t.effectiveStatus === E.todo && t.startDate && t.startDate > tdIso && t.startDate <= U.iso(U.addDays(td, 14));
      }).sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
      var dueSoon = doing.filter(function (t) {
        return t.endDate && t.endDate >= tdIso && t.endDate <= U.iso(U.addDays(td, 7));
      }).sort(function (a, b) { return a.endDate < b.endDate ? -1 : 1; });
      var doneThisMonth = tasks.filter(function (t) {
        return t.effectiveStatus === E.done && U.monthKey(t.endDate) === thisMonth;
      });
      var mfgMonth = doneThisMonth.filter(function (t) { return t.type === 'mfg'; });

      /* --- KPI --- */
      var kpis = U.el('div', { class: 'grid k4' }, [
        kpi('進行中タスク', String(doing.length), '件',
          '担当者 ' + U.uniq(doing.map(function (t) { return t.assignee1; })).length + '名が稼働中', 'blue'),
        kpi('遅延タスク', String(late.length), '件',
          late.length ? '<span class="trend-down">要対応</span>' : '遅延なし', late.length ? 'red' : 'green'),
        kpi('今月完了', String(doneThisMonth.length), '件',
          '換算 ' + U.fmtNum(U.sum(mfgMonth, function (t) { return t.convStep; }), 0) + ' step', 'green'),
        kpi('直近14日の着手予定', String(soon.length), '件',
          '今週締切 ' + dueSoon.length + '件', 'violet')
      ]);
      root.appendChild(kpis);

      var prodAvg = U.avg(mfgMonth, function (t) { return t.prodMonth; });
      var qualAvg = U.avg(mfgMonth, function (t) { return t.quality; });
      var hourSum = U.sum(doneThisMonth, function (t) { return t.totalHour; });
      var kpis2 = U.el('div', { class: 'grid k4 mt12' }, [
        kpi('月換算生産性(今月平均)', prodAvg === null ? '—' : U.fmtNum(prodAvg, 0), '',
          '目標 ' + U.fmtNum(State.settings().targetProdMonth, 0), 'blue'),
        kpi('品質 指摘/KS(今月平均)', qualAvg === null ? '—' : U.fmtNum(qualAvg, 1), '',
          '目標 ' + U.fmtNum(State.settings().targetQuality, 0) + ' 以下', 'amber'),
        kpi('今月投入工数', U.fmtNum(hourSum, 1), 'h',
          '約 ' + U.fmtNum(hourSum / (State.settings().workHoursPerDay || 7.5), 1) + ' 人日', 'violet'),
        kpi('登録総件数', String(tasks.length), '件',
          '製造 ' + State.of('mfg').length + ' / 詳細設計 ' + State.of('dd').length, 'green')
      ]);
      root.appendChild(kpis2);

      /* --- いま何をしているか --- */
      var members = State.members();
      var nowCard = U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [
          U.el('h3', { text: '🧑‍💻 いまの作業状況' }),
          U.el('span', { class: 'sub', text: tdIso + ' 時点' }),
          U.el('div', { class: 'tools' }, [
            U.el('button', { class: 'btn btn-sm', text: '担当者ビューへ', onclick: function () { App.go('members'); } })
          ])
        ])
      ]);
      var nowBody = U.el('div', { class: 'card-body' });
      var nowGrid = U.el('div', { class: 'grid k3' });
      var activeMembers = members.filter(function (m) { return Logic.currentWork(m).length > 0; });
      var idleMembers = members.filter(function (m) { return Logic.currentWork(m).length === 0; });
      if (!activeMembers.length) {
        nowBody.appendChild(U.el('div', { class: 'empty', html: '<span class="big">💤</span>進行中のタスクがありません' }));
      }
      activeMembers.forEach(function (m) {
        var work = Logic.currentWork(m);
        var head = work[0];
        var color = U.colorOf(m);
        var todayPlans = dayItems(tdIso, m);
        nowGrid.appendChild(U.el('div', { class: 'card member-card', style: { cursor: 'pointer' }, onclick: function () { App.go('members', { member: m }); } }, [
          U.el('div', { class: 'member-top' }, [
            U.el('div', { class: 'avatar', style: { background: color }, text: U.initials(m) }),
            U.el('div', {}, [
              U.el('div', { class: 'member-name', text: m }),
              U.el('div', { class: 'member-sub', text: '進行中 ' + work.length + '件' })
            ])
          ]),
          U.el('div', { class: 'work-now' }, [
            U.el('div', {}, [
              U.el('span', { class: 'pid', text: head.programId || '(ID未設定)' }),
              U.el('span', { class: 'muted', text: ' / ' + (head.kubun || '') + ' ' + (head.resource || '') })
            ]),
            U.el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px' }, text: head.project || '' }),
            U.el('div', { style: { fontSize: '11px', marginTop: '4px' }, text: '期間 ' + U.fmtDate(head.startDate) + ' 〜 ' + U.fmtDate(head.endDate) + (head.isLate ? '  ⚠遅延' : '') })
          ]),
          work.length > 1 ? U.el('div', { class: 'muted', style: { fontSize: '11px' }, text: 'ほか ' + (work.length - 1) + '件を並行' }) : null,
          todayPlans.length ? U.el('div', { style: { fontSize: '11px' } }, [
            U.el('div', { class: 'muted', style: { fontWeight: 700, fontSize: '10.5px' }, text: '▶ 本日の業務予定' }),
            U.el('div', { class: 'pill-group', style: { marginTop: '3px' } }, todayPlans.slice(0, 4).map(function (it) {
              var p = it.base;
              var c = State.planColor(p.category);
              var h = it.plan ? itemPlanH(it) : itemActualH(it);
              return U.el('span', { class: 'chip', style: { background: c + '1f', color: c }, title: p.title || '', text: (p.category || '—') + (h ? ' ' + U.fmtH(h) + 'h' : '') });
            }))
          ]) : null
        ]));
      });
      nowBody.appendChild(nowGrid);
      if (idleMembers.length) {
        nowBody.appendChild(U.el('div', { class: 'mt12 muted', style: { fontSize: '11.5px' }, text: '手空き / 未割当: ' + idleMembers.join('、') }));
      }
      nowCard.appendChild(nowBody);
      root.appendChild(U.el('div', { class: 'mt16' }, [nowCard]));

      /* --- 2カラム: 予定 と 遅延 --- */
      var col = U.el('div', { class: 'grid k2 mt16' });
      col.appendChild(listCard('📅 直近の予定作業（14日以内に着手）', soon, '予定はありません', function (t) {
        return '着手 ' + U.fmtDate(t.startDate) + ' / ' + (t.assignee1 || '未割当');
      }));
      col.appendChild(listCard('⚠ 遅延・今週締切', late.concat(dueSoon), '遅延はありません', function (t) {
        return '締切 ' + U.fmtDate(t.endDate) + ' / ' + (t.assignee1 || '未割当');
      }));
      root.appendChild(col);

      /* --- 本日の業務予定（予定と実績は 1 作業 1 行にまとめる） --- */
      var todayAll = dayItems(tdIso);
      var todayActual = U.sum(todayAll, itemActualH);
      var planCard = U.el('div', { class: 'card mt16' }, [
        U.el('div', { class: 'card-head' }, [
          U.el('h3', { text: '📝 本日の業務予定' }),
          U.el('span', { class: 'sub', text: todayAll.length + '件 / 予定工数 ' + U.fmtH(U.sum(todayAll, itemPlanH)) + 'h' +
            (todayAll.some(function (it) { return it.result; }) ? ' / 実績 ' + U.fmtH(todayActual) + 'h' : '') }),
          U.el('div', { class: 'tools' }, [
            U.el('button', { class: 'btn btn-sm', text: '業務予定を開く', onclick: function () { App.go('planBoard'); } })
          ])
        ])
      ]);
      var planBody = U.el('div', { class: 'card-body tight' });
      if (!todayAll.length) {
        planBody.appendChild(U.el('div', { class: 'empty', html: '<span class="big">📝</span>本日の業務予定は登録されていません<br><small>「業務予定管理」から入力できます</small>' }));
      } else {
        var byMember = U.groupBy(todayAll, function (it) { return it.member; });
        var grid = U.el('div', { class: 'grid k3', style: { padding: '6px' } });
        byMember.forEach(function (list, name) {
          var hasRes = list.some(function (it) { return it.result; });
          grid.appendChild(U.el('div', { style: { border: '1px solid var(--border)', borderRadius: '9px', padding: '8px 10px' } }, [
            U.el('div', { class: 'row-flex' }, [
              U.el('span', { class: 'avatar', style: { background: U.colorOf(name), width: '22px', height: '22px', flex: '0 0 22px', fontSize: '9px' }, text: U.initials(name) }),
              U.el('b', { text: name }),
              U.el('span', { class: 'muted mono', style: { marginLeft: 'auto' }, title: hasRes ? '予定 → 実績' : '予定',
                text: U.fmtH(U.sum(list, itemPlanH)) + 'h' + (hasRes ? ' → ' + U.fmtH(U.sum(list, itemActualH)) + 'h' : '') })
            ]),
            U.el('div', { class: 'mini-list', style: { marginTop: '4px' } }, list.map(function (it) {
              var p = it.base;
              var c = State.planColor(p.category);
              return U.el('div', { class: 'mini-row' }, [
                U.el('span', { class: 'chip', style: { background: c + '1f', color: c }, text: p.category || '—' }),
                U.el('span', { class: 'grow', text: p.title || p.project || '' }),
                U.el('span', { class: 'muted mono nowrap', text: itemHoursText(it) })
              ]);
            }))
          ]));
        });
        planBody.appendChild(grid);
      }
      planCard.appendChild(planBody);
      root.appendChild(planCard);

      /* --- チャート --- */
      var chartGrid = U.el('div', { class: 'grid k2 mt16' });
      chartGrid.appendChild(chartCard('月次推移（完了件数・換算step）', function (box) {
        var months = recentMonths(12);
        var doneCount = months.map(function (mk) {
          return tasks.filter(function (t) { return t.effectiveStatus === E.done && U.monthKey(t.endDate) === mk; }).length;
        });
        var steps = months.map(function (mk) {
          return U.sum(tasks.filter(function (t) { return t.type === 'mfg' && U.monthKey(t.endDate) === mk; }), function (t) { return t.convStep; });
        });
        Charts.line(box, {
          labels: months.map(U.monthLabel), area: true,
          series: [
            { name: '完了件数', values: doneCount, color: '#2563eb' },
            { name: '換算step', values: steps.map(function (v) { return Math.round(v); }), color: '#7c3aed', axis: 'right' }
          ], height: 240
        });
      }));
      chartGrid.appendChild(chartCard('リソース区分別 件数', function (box) {
        var g = U.groupBy(tasks, function (t) { return t.resource; });
        var items = Array.from(g.entries()).map(function (e) { return { label: e[0], value: e[1].length }; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
        Charts.donut(box, { items: items, centerLabel: '件' });
      }));
      root.appendChild(chartGrid);

      /* --- 担当者別 実施本数 --- */
      root.appendChild(volumeCard());

      var chartGrid2 = U.el('div', { class: 'grid k2 mt16' });
      chartGrid2.appendChild(chartCard('案件別 進捗（完了 / 全体）', function (box) {
        var g = U.groupBy(tasks, function (t) { return t.project; });
        var rows = Array.from(g.entries()).map(function (e) {
          var done = e[1].filter(function (t) { return t.effectiveStatus === E.done; }).length;
          return { label: e[0], total: e[1].length, done: done, rate: e[1].length ? done / e[1].length * 100 : 0 };
        }).sort(function (a, b) { return b.total - a.total; }).slice(0, 12);
        U.clear(box);
        if (!rows.length) return Charts.empty(box);
        var tbl = U.el('table', { class: 'grid-table' });
        var tb = U.el('tbody');
        rows.forEach(function (r) {
          tb.appendChild(U.el('tr', { style: { cursor: 'pointer' }, onclick: function () { App.go('tasks', { project: r.label }); } }, [
            U.el('td', { style: { maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis' }, title: r.label, text: r.label }),
            U.el('td', { style: { width: '160px' } }, [
              U.el('div', { class: 'progress' }, [U.el('span', { style: { width: r.rate.toFixed(0) + '%', background: r.rate >= 100 ? 'var(--ok)' : 'var(--primary)' } })])
            ]),
            U.el('td', { class: 'num', text: r.done + ' / ' + r.total })
          ]));
        });
        tbl.appendChild(tb);
        box.appendChild(tbl);
      }));
      chartGrid2.appendChild(chartCard('担当者別 稼働件数（進行中/予定/完了）', function (box) {
        var names = members.slice(0, 14);
        Charts.stacked(box, {
          labels: names,
          series: [
            { name: '進行中', color: '#2563eb', values: names.map(function (m) { return State.tasksOfMember(m).filter(function (t) { return t.effectiveStatus === E.doing || t.effectiveStatus === E.review; }).length; }) },
            { name: '予定', color: '#94a3b8', values: names.map(function (m) { return State.tasksOfMember(m).filter(function (t) { return t.effectiveStatus === E.todo; }).length; }) },
            { name: '完了', color: '#16a34a', values: names.map(function (m) { return State.tasksOfMember(m).filter(function (t) { return t.effectiveStatus === E.done; }).length; }) }
          ], height: 250
        });
      }));
      root.appendChild(chartGrid2);
    }
  };

  function listCard(title, list, emptyMsg, extraFn) {
    var card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [
        U.el('h3', { text: title }),
        U.el('span', { class: 'sub', text: list.length + '件' })
      ])
    ]);
    var body = U.el('div', { class: 'card-body tight' });
    if (!list.length) body.appendChild(U.el('div', { class: 'empty', text: emptyMsg }));
    var seen = {};
    list.slice(0, 12).forEach(function (t) {
      if (seen[t.id]) return; seen[t.id] = 1;
      body.appendChild(miniTaskRow(t, extraFn ? extraFn(t) : null));
    });
    card.appendChild(body);
    return card;
  }

  function chartCard(title, renderFn, tools) {
    var box = U.el('div');
    var card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [U.el('h3', { text: title }), tools || null]),
      U.el('div', { class: 'card-body' }, [box])
    ]);
    setTimeout(function () { renderFn(box); }, 0);
    return card;
  }

  function recentMonths(count) {
    var out = [], d = U.today();
    d.setDate(1);
    for (var i = count - 1; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(x.getFullYear() + '-' + U.pad(x.getMonth() + 1));
    }
    return out;
  }

  Views._helpers = { kpi: kpi, listCard: listCard, chartCard: chartCard, recentMonths: recentMonths, miniTaskRow: miniTaskRow };
})(window);
