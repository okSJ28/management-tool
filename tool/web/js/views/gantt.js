/* ============================================================
   views/gantt.js - ガント / タイムライン
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var G = { groupBy: 'assignee1', scale: 'day', range: 'q', filterProject: '', filterAssignee: '', onlyOpen: false };

  function rangeDates(tasks, opt) {
    var today = U.today();
    if (opt && opt.days) {
      return { from: U.addDays(today, -Math.round(opt.days / 3)), to: U.addDays(today, Math.round(opt.days * 2 / 3)) };
    }
    if (G.range === 'm') return { from: U.addDays(today, -14), to: U.addDays(today, 30) };
    if (G.range === 'q') return { from: U.addDays(today, -30), to: U.addDays(today, 75) };
    if (G.range === 'h') return { from: U.addDays(today, -60), to: U.addDays(today, 150) };
    var dates = [];
    tasks.forEach(function (t) {
      var s = U.parseDate(t.startDate), e = U.parseDate(t.endDate);
      if (s) dates.push(s); if (e) dates.push(e);
    });
    if (!dates.length) return { from: U.addDays(today, -14), to: U.addDays(today, 30) };
    return {
      from: new Date(Math.min.apply(null, dates)),
      to: new Date(Math.max.apply(null, dates))
    };
  }

  function renderInto(container, tasks, opt) {
    opt = opt || {};
    var r = rangeDates(tasks, opt);
    var span = Math.min(U.diffDays(r.from, r.to) + 1, 400);
    if (span < 1) span = 30;
    var days = [];
    for (var i = 0; i < span; i++) days.push(U.addDays(r.from, i));
    var fromIso = U.iso(days[0]), toIso = U.iso(days[days.length - 1]);
    var todayIso = U.iso(U.today());

    var visible = tasks.filter(function (t) { return Logic.overlaps(t, fromIso, toIso); });
    U.clear(container);
    if (!visible.length) {
      container.appendChild(U.el('div', { class: 'empty', html: '<span class="big">📆</span>この期間に該当するタスクがありません' }));
      return;
    }

    var groupKey = opt.groupBy !== undefined ? opt.groupBy : G.groupBy;
    var groups;
    if (!groupKey) {
      groups = new Map([['', visible]]);
    } else {
      groups = U.groupBy(visible, function (t) { return t[groupKey]; });
      groups = new Map(Array.from(groups.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }));
    }

    var wrap = U.el('div', { class: 'gantt' });
    var table = U.el('table');

    /* ヘッダ: 月行 + 日行 */
    var thead = U.el('thead');
    var monthRow = U.el('tr');
    monthRow.appendChild(U.el('th', { class: 'lbl', text: '' }));
    var mAcc = null, mCount = 0, mCells = [];
    days.forEach(function (d, idx) {
      var key = d.getFullYear() + '/' + (d.getMonth() + 1);
      if (key !== mAcc) {
        if (mAcc !== null) mCells.push([mAcc, mCount]);
        mAcc = key; mCount = 1;
      } else mCount++;
      if (idx === days.length - 1) mCells.push([mAcc, mCount]);
    });
    mCells.forEach(function (c) {
      monthRow.appendChild(U.el('th', { colspan: c[1], text: c[0], style: { fontSize: '10.5px' } }));
    });
    thead.appendChild(monthRow);

    var dayRow = U.el('tr');
    dayRow.appendChild(U.el('th', { class: 'lbl', text: (groupKey === 'assignee1' ? '担当者 / タスク' : groupKey === 'project' ? '案件 / タスク' : 'タスク') }));
    days.forEach(function (d) {
      var cls = U.isWeekend(d) ? 'wk' : '';
      if (U.iso(d) === todayIso) cls += ' today';
      dayRow.appendChild(U.el('th', { class: cls, text: String(d.getDate()), style: { fontSize: '9.5px', color: U.isWeekend(d) ? '#94a3b8' : '#475569' } }));
    });
    thead.appendChild(dayRow);
    table.appendChild(thead);

    var tbody = U.el('tbody');
    groups.forEach(function (list, gname) {
      if (groupKey) {
        var gr = U.el('tr', { class: 'grp-row' });
        gr.appendChild(U.el('td', { class: 'lbl', style: { background: '#eef2f8' } }, [
          U.el('span', { class: 'avatar', style: { background: U.colorOf(gname), width: '18px', height: '18px', flex: '0 0 18px', fontSize: '9px', display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px' }, text: U.initials(gname) }),
          U.el('b', { text: gname }),
          U.el('span', { class: 'muted', text: '  (' + list.length + ')' })
        ]));
        gr.appendChild(U.el('td', { colspan: days.length, style: { background: '#eef2f8' } }));
        tbody.appendChild(gr);
      }
      list.sort(function (a, b) { return (a.startDate || '9999') < (b.startDate || '9999') ? -1 : 1; });
      list.forEach(function (t) {
        var tr = U.el('tr');
        tr.appendChild(U.el('td', {
          class: 'lbl', style: { cursor: 'pointer' }, title: (t.programId || '') + ' / ' + (t.project || ''),
          onclick: function () { Form.openViewer(t, function () { App.render(); }); }
        }, [
          U.el('span', { class: 'mono strong', text: t.programId || '(未設定)' }),
          U.el('span', { class: 'muted', text: '  ' + (t.kubun || '') }),
          groupKey === 'assignee1' ? U.el('span', { class: 'muted', text: '  ' + shorten(t.project || '', 16) }) :
            U.el('span', { class: 'muted', text: '  ' + (t.assignee1 || '') })
        ]));
        var s = t.startDate || t.endDate, e = t.endDate || t.startDate;
        var si = s ? U.diffDays(days[0], U.parseDate(s)) : -1;
        var ei = e ? U.diffDays(days[0], U.parseDate(e)) : -1;
        si = Math.max(0, si); ei = Math.min(days.length - 1, ei);
        var color = statusColorOf(t);
        for (var d = 0; d < days.length; d++) {
          var cls = 'cell' + (U.isWeekend(days[d]) ? ' wk' : '') + (U.iso(days[d]) === todayIso ? ' today' : '');
          var td = U.el('td', { class: cls });
          if (d >= si && d <= ei && si >= 0) {
            var bar = U.el('div', {
              class: 'bar',
              style: {
                background: color,
                borderTopLeftRadius: d === si ? '4px' : '0',
                borderBottomLeftRadius: d === si ? '4px' : '0',
                borderTopRightRadius: d === ei ? '4px' : '0',
                borderBottomRightRadius: d === ei ? '4px' : '0'
              },
              title: (t.programId || '') + ' ' + U.fmtDateFull(t.startDate) + '〜' + U.fmtDateFull(t.endDate) + '\n' + (t.project || '')
            });
            td.appendChild(bar);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  function statusColorOf(t) {
    if (t.isLate) return '#dc2626';
    return State.statusColor(t.effectiveStatus);
  }
  function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  Views.gantt = {
    title: 'ガントチャート',
    desc: '担当者・案件ごとの作業期間を俯瞰',
    icon: '📆',
    searchable: true,
    render: function (root) {
      var bar = U.el('div', { class: 'filterbar' });

      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: 'グループ' }),
      (function () {
        var s = U.el('select', { onchange: function () { G.groupBy = this.value || null; App.render(); } });
        [['assignee1', '担当者'], ['project', '案件'], ['resource', 'リソース区分'], ['', 'なし']].forEach(function (o) {
          s.appendChild(U.el('option', { value: o[0], text: o[1], selected: (G.groupBy || '') === o[0] }));
        });
        return s;
      })()]));

      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '表示期間' }),
      (function () {
        var s = U.el('select', { onchange: function () { G.range = this.value; App.render(); } });
        [['m', '約1.5ヶ月'], ['q', '約3.5ヶ月'], ['h', '約7ヶ月'], ['all', '全期間']].forEach(function (o) {
          s.appendChild(U.el('option', { value: o[0], text: o[1], selected: G.range === o[0] }));
        });
        return s;
      })()]));

      function sel(label, key, options) {
        var s = U.el('select', { onchange: function () { G[key] = this.value; App.render(); } });
        s.appendChild(U.el('option', { value: '', text: '(すべて)' }));
        options.forEach(function (o) { s.appendChild(U.el('option', { value: o, text: o, selected: G[key] === o })); });
        bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: label }), s]));
      }
      sel('案件', 'filterProject', State.projects());
      sel('担当者', 'filterAssignee', State.members());

      bar.appendChild(U.el('label', { class: 'row-flex', style: { fontSize: '11.5px', marginTop: '12px' } }, [
        U.el('input', { type: 'checkbox', checked: G.onlyOpen, onchange: function () { G.onlyOpen = this.checked; App.render(); } }),
        document.createTextNode(' 未完了のみ')
      ]));

      bar.appendChild(U.el('div', { class: 'spacer' }));
      var legend = U.el('div', { class: 'legend' });
      (State.masters.statuses || []).forEach(function (s) {
        legend.appendChild(U.el('span', {}, [U.el('i', { style: { background: s.color } }), document.createTextNode(s.value)]));
      });
      legend.appendChild(U.el('span', {}, [U.el('i', { style: { background: '#dc2626' } }), document.createTextNode('遅延')]));
      bar.appendChild(legend);
      root.appendChild(bar);

      var E = State.enums.status;
      var tasks = State.tasks.filter(function (t) {
        if (G.filterProject && t.project !== G.filterProject) return false;
        if (G.filterAssignee && t.assignee1 !== G.filterAssignee && t.assignee2 !== G.filterAssignee) return false;
        if (G.onlyOpen && t.effectiveStatus === E.done) return false;
        if (State.search) {
          var hay = [t.programId, t.project, t.assignee1].filter(Boolean).join(' ').toLowerCase();
          if (hay.indexOf(State.search.toLowerCase()) < 0) return false;
        }
        return true;
      });

      var box = U.el('div', { class: 'card' }, []);
      var inner = U.el('div');
      box.appendChild(inner);
      root.appendChild(box);
      renderInto(inner, tasks, {});
    }
  };

  global.Gantt = { renderInto: renderInto };
})(window);
