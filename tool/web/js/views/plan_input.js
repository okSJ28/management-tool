/* ============================================================
   views/plan_input.js - 日次入力（始業前=予定 / 終業前=実績）
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var P = { date: null, member: null, rows: null, removed: null, key: null };

  var PHASE = {
    plan: {
      kind: 'plan', icon: '☀', label: '始業前入力', short: '始業前',
      head: '本日やる作業', sub: '始業前に、今日やる作業を登録します',
      accent: '#d97706', soft: '#fffbeb', hourKey: 'hours', hourLabel: '予定(h)'
    },
    result: {
      kind: 'result', icon: '🌙', label: '終業前入力', short: '終業前',
      head: '本日やったこと', sub: '終業前に、実施した工程と進捗率を登録します',
      accent: '#4f46e5', soft: '#eef2ff', hourKey: 'actualHours', hourLabel: '実績(h)'
    }
  };

  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function kindOf(p) {
    return p && (p.kind === 'result' || p.kind === 'assignment') ? p.kind : 'plan';
  }
  function me() { return P.member || State.user() || (State.members()[0] || ''); }
  function todayIso() { return U.iso(U.today()); }
  function curDate() { return P.date || todayIso(); }

  function plansOf(iso, member, kind) {
    return State.plansOnDate(iso, member).filter(function (p) { return kindOf(p) === kind; });
  }

  /* 対象日にかかっている取組み予定 */
  function assignmentsForDay() {
    return State.assignmentsOn(curDate(), me()).sort(function (a, b) {
      return (a.date || '') < (b.date || '') ? -1 : 1;
    });
  }

  function assignmentLabel(a) {
    return (a.category || '—') + ' / ' + (a.title || a.project || '(未設定)')
      + '　' + U.fmtDate(a.date) + '〜' + U.fmtDate(a.endDate || a.date);
  }

  /* ------------------------------------------------ ドラフト管理 */
  function emptyRow(kind) {
    return {
      id: null, kind: kind, member: me(), date: curDate(), endDate: curDate(),
      category: null, project: null, title: null, programId: null, taskId: null,
      projectCode: null, workCode: null,
      hours: null, actualHours: null, progress: null, sourceId: null, note: null,
      assignmentId: null,
      status: kind === 'plan' ? '予定' : '実施中'
    };
  }

  function isBlank(row) {
    return !row.category && !row.title && !row.project && !row.assignmentId &&
      !row.projectCode && !row.workCode &&
      row.hours === null && row.actualHours === null && row.progress === null;
  }

  function syncDrafts(force) {
    var key = curDate() + '|' + me();
    if (!force && P.key === key && P.rows) return;
    P.key = key;
    P.removed = { plan: [], result: [] };
    P.rows = {
      plan: plansOf(curDate(), me(), 'plan').map(function (p) { return Object.assign({}, p); }),
      result: plansOf(curDate(), me(), 'result').map(function (p) { return Object.assign({}, p); })
    };
  }

  var dlReady = false;

  function projectDatalist() {
    if (dlReady && document.getElementById('dl_plan_project')) return 'dl_plan_project';
    var dl = document.getElementById('dl_plan_project');
    if (dl) dl.remove();
    dl = U.el('datalist', { id: 'dl_plan_project' });
    State.projects().forEach(function (p) { dl.appendChild(U.el('option', { value: p })); });
    document.body.appendChild(dl);
    dlReady = true;
    return 'dl_plan_project';
  }

  /* ------------------------------------------------ 入力シート */
  function sheet(conf) {
    var kind = conf.kind;
    var card = U.el('div', { class: 'card', style: { display: 'flex', flexDirection: 'column' } });
    var tbody = U.el('tbody');
    var footNote = U.el('div', { class: 'muted', style: { fontSize: '11px' } });

    function totals() {
      var rows = P.rows[kind].filter(function (r) { return !isBlank(r); });
      var h = U.sum(rows, function (r) { return r[conf.hourKey]; });
      var target = State.settings().workHoursPerDay || 7.5;
      var text = rows.length + ' 件 / ' + U.fmtNum(h, 1) + 'h（基準 ' + target + 'h）';
      if (kind === 'result') {
        var avg = rows.length ? U.sum(rows, function (r) { return r.progress; }) / rows.length : 0;
        text += ' / 平均進捗 ' + U.fmtNum(avg, 0) + '%';
      }
      footNote.textContent = text;
    }

    function paint() {
      U.clear(tbody);
      if (!P.rows[kind].length) P.rows[kind].push(emptyRow(kind));
      P.rows[kind].forEach(function (row) { tbody.appendChild(rowNode(conf, row, paint, totals)); });
      totals();
    }

    var head = U.el('div', {
      class: 'card-head',
      style: { background: conf.soft, borderBottom: '2px solid ' + conf.accent }
    }, [
      U.el('div', {}, [
        U.el('h3', { style: { color: conf.accent }, text: conf.icon + ' ' + conf.label + ' — ' + conf.head }),
        U.el('div', { class: 'muted', style: { fontSize: '11px' }, text: conf.sub })
      ]),
      U.el('div', { class: 'tools' }, [
        kind === 'result' ? U.el('button', {
          class: 'btn btn-sm', text: '⇩ 予定から取り込む', title: '始業前に入力した予定を実績行にコピーします',
          onclick: function () { importFromPlan(paint); }
        }) : null,
        U.el('button', {
          class: 'btn btn-sm', text: '＋ 行を追加',
          onclick: function () { P.rows[kind].push(emptyRow(kind)); paint(); }
        })
      ])
    ]);

    var cols = kind === 'plan'
      ? [['取組み予定', 118], ['PJCD', 112], ['作業コード', 112],
         ['工程（作業区分）', 96], ['案件名', 112], ['作業内容', null],
         [conf.hourLabel, 64], ['', 38]]
      : [['取組み予定', 118], ['工程（作業区分）', 96], ['案件名', 112], ['作業内容', null],
         [conf.hourLabel, 64], ['進捗率', 84], ['状況', 80], ['', 38]];

    // 幅指定のない「作業内容」が潰れないよう、最小幅を確保して足りなければ横スクロールさせる
    var TITLE_MIN = 220;
    var fixedTotal = cols.reduce(function (a, c) { return a + (c[1] || 0); }, 0);
    var table = U.el('table', {
      class: 'grid-table',
      style: { tableLayout: 'fixed', width: '100%', minWidth: (fixedTotal + TITLE_MIN) + 'px' }
    });
    var hr = U.el('tr');
    cols.forEach(function (c) {
      // 幅を指定しない列（作業内容）が残り幅をすべて受け取る
      hr.appendChild(U.el('th', { style: c[1] ? { width: c[1] + 'px' } : null, text: c[0] }));
    });
    table.appendChild(U.el('thead', {}, [hr]));
    table.appendChild(tbody);

    card.appendChild(head);
    card.appendChild(U.el('div', { class: 'table-wrap', style: { flex: 1 } }, [table]));
    card.appendChild(U.el('div', {
      class: 'card-body tight', style: { display: 'flex', alignItems: 'center', gap: '10px' }
    }, [
      footNote,
      U.el('div', { class: 'spacer' }),
      U.el('button', {
        class: 'btn btn-primary btn-sm', text: '💾 ' + conf.label + 'を保存',
        onclick: function () { save(conf); }
      })
    ]));

    paint();
    return card;
  }

  function codeSelect(masterKey, row, field) {
    var sel = U.el('select', { style: { width: '100%' }, title: State.codeLabel(masterKey, row[field]) });
    sel.appendChild(U.el('option', { value: '', text: '— 選択 —' }));
    State.codeList(masterKey).forEach(function (c) {
      sel.appendChild(U.el('option', {
        value: c.code, selected: row[field] === c.code,
        text: c.code + (c.name ? '　' + c.name : '')
      }));
    });
    // マスタから削除されたコードが残っている場合も選択肢に保持する
    if (row[field] && !State.codeList(masterKey).some(function (c) { return c.code === row[field]; })) {
      sel.appendChild(U.el('option', { value: row[field], text: row[field] + '（マスタ未登録）', selected: true }));
    }
    sel.value = row[field] || '';
    sel.addEventListener('change', function () {
      row[field] = this.value || null;
      this.title = State.codeLabel(masterKey, row[field]);
    });
    return sel;
  }

  function rowNode(conf, row, paint, totals) {
    var kind = conf.kind;
    var tr = U.el('tr');
    function accent() { return State.planColor(row.category); }
    tr.style.borderLeft = '3px solid ' + (row.category ? accent() : 'transparent');

    /* 取組み予定（期間）との紐づけ */
    var assigns = assignmentsForDay();
    var asg = U.el('select', { style: { width: '100%' } });
    asg.appendChild(U.el('option', { value: '', text: '（紐づけなし）' }));
    assigns.forEach(function (a) {
      asg.appendChild(U.el('option', { value: a.id, text: assignmentLabel(a), selected: row.assignmentId === a.id }));
    });
    // 期間外の取組み予定に既に紐づいている場合も選択肢を残す
    if (row.assignmentId && !assigns.some(function (a) { return a.id === row.assignmentId; })) {
      var old = State.assignmentById(row.assignmentId);
      if (old) asg.appendChild(U.el('option', { value: old.id, text: assignmentLabel(old), selected: true }));
    }
    asg.value = row.assignmentId || '';
    asg.addEventListener('change', function () {
      row.assignmentId = this.value || null;
      var a = State.assignmentById(row.assignmentId);
      if (a) {
        row.category = a.category;
        row.project = a.project;
        row.programId = a.programId;
        row.taskId = a.taskId;
        if (!row.title) row.title = a.title;
      }
      paint();
    });
    tr.appendChild(U.el('td', {}, [asg]));

    /* PJCD / 作業コード（始業前のみ列表示。実績には取り込み時に引き継がれる） */
    if (kind === 'plan') {
      tr.appendChild(U.el('td', {}, [codeSelect('projectCodes', row, 'projectCode')]));
      tr.appendChild(U.el('td', {}, [codeSelect('workCodes', row, 'workCode')]));
    }

    /* 工程（作業区分） */
    var cat = U.el('select', {
      style: { width: '100%' },
      onchange: function () {
        row.category = this.value || null;
        tr.style.borderLeft = '3px solid ' + (row.category ? accent() : 'transparent');
        this.style.color = row.category ? accent() : '';
      }
    });
    cat.appendChild(U.el('option', { value: '', text: '— 選択 —' }));
    (State.masters.planCategories || []).forEach(function (c) {
      cat.appendChild(U.el('option', { value: c.value, text: c.value, selected: row.category === c.value }));
    });
    cat.value = row.category || '';
    cat.style.color = row.category ? accent() : '';
    tr.appendChild(U.el('td', {}, [cat]));

    /* 案件名 */
    var proj = U.el('input', { type: 'text', value: row.project || '', list: projectDatalist(), style: { width: '100%' } });
    proj.addEventListener('input', function () { row.project = this.value || null; });
    tr.appendChild(U.el('td', {}, [proj]));

    /* 作業内容 */
    var title = U.el('input', {
      type: 'text', value: row.title || '', style: { width: '100%' },
      placeholder: kind === 'plan' ? '例）SDLP341 修正・単体テスト' : '例）SDLP341 単体テスト消化（20/30件）'
    });
    title.addEventListener('input', function () { row.title = this.value || null; });
    tr.appendChild(U.el('td', {}, [title]));

    /* 工数 */
    var hour = U.el('input', {
      type: 'number', step: '0.5', min: '0', class: 'num', style: { width: '100%' },
      value: row[conf.hourKey] === null || row[conf.hourKey] === undefined ? '' : row[conf.hourKey]
    });
    hour.addEventListener('input', function () { row[conf.hourKey] = U.num(this.value); totals(); });
    tr.appendChild(U.el('td', {}, [hour]));

    /* 進捗率（実績のみ） */
    if (kind === 'result') {
      var bar = U.el('div', { class: 'progress', style: { marginTop: '4px' } }, [
        U.el('span', { style: { width: (row.progress || 0) + '%' } })
      ]);
      var prog = U.el('input', {
        type: 'number', step: '10', min: '0', max: '100', class: 'num', style: { width: '100%' },
        value: row.progress === null || row.progress === undefined ? '' : row.progress
      });
      prog.addEventListener('input', function () {
        var v = U.num(this.value);
        row.progress = v === null ? null : Math.max(0, Math.min(100, v));
        bar.firstChild.style.width = (row.progress || 0) + '%';
        totals();
      });
      tr.appendChild(U.el('td', {}, [prog, bar]));

      var st = U.el('select', {
        style: { width: '100%' },
        onchange: function () { row.status = this.value || null; }
      });
      (State.masters.planStatuses || []).forEach(function (s) {
        st.appendChild(U.el('option', { value: s.value, text: s.value, selected: row.status === s.value }));
      });
      st.value = row.status || '実施中';
      tr.appendChild(U.el('td', {}, [st]));
    }

    /* 削除 */
    tr.appendChild(U.el('td', {}, [
      U.el('button', {
        class: 'icon-btn', text: '✕', title: 'この行を削除',
        onclick: function () {
          var i = P.rows[kind].indexOf(row);
          if (i < 0) return;
          if (row.id) P.removed[kind].push(row.id);
          P.rows[kind].splice(i, 1);
          paint();
        }
      })
    ]));
    return tr;
  }

  /* ------------------------------------------------ 保存 / 取り込み */
  function save(conf) {
    var kind = conf.kind;
    var rows = P.rows[kind].filter(function (r) { return !isBlank(r); });
    if (rows.some(function (r) { return !r.category; })) {
      U.toast('工程（作業区分）を選択してください', 'warn'); return;
    }
    if (kind === 'result' && rows.some(function (r) { return r.progress === null; })) {
      U.toast('実績には進捗率(%)を入力してください', 'warn'); return;
    }

    var toDelete = P.removed[kind].slice();
    P.rows[kind].forEach(function (r) { if (r.id && isBlank(r)) toDelete.push(r.id); });

    var payload = rows.map(function (r) {
      return Object.assign({}, r, { kind: kind, member: me(), date: curDate(), endDate: curDate() });
    });

    U.loading(true);
    API.savePlans(payload, toDelete)
      .then(function () { return State.reloadPlans(); })
      .then(function () {
        P.key = null;
        U.toast(conf.label + 'を保存しました（' + rows.length + '件）', 'ok');
        App.render();
      })
      .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
      .finally(function () { U.loading(false); });
  }

  function importFromPlan(paint) {
    var src = P.rows.plan.filter(function (r) { return !isBlank(r); });
    if (!src.length) { U.toast('始業前の予定が入力されていません', 'warn'); return; }
    var seen = {};
    P.rows.result.forEach(function (r) { if (r.sourceId) seen[r.sourceId] = true; });
    var added = 0;
    src.forEach(function (r) {
      if (r.id && seen[r.id]) return;
      P.rows.result.push(Object.assign(emptyRow('result'), {
        category: r.category, project: r.project, title: r.title,
        programId: r.programId, taskId: r.taskId, assignmentId: r.assignmentId,
        projectCode: r.projectCode, workCode: r.workCode,
        actualHours: r.hours, sourceId: r.id || null
      }));
      added++;
    });
    P.rows.result = P.rows.result.filter(function (r) { return !isBlank(r); });
    paint();
    U.toast(added ? added + ' 件を取り込みました。進捗率を入力してください' : '取り込み済みです', added ? 'ok' : 'warn');
  }

  /* ------------------------------------------------ 状況表示 */
  function statusStrip(date, member) {
    var isToday = date === todayIso();
    var box = U.el('div', { class: 'row-flex mt12', style: { gap: '10px', flexWrap: 'wrap' } });
    ['plan', 'result'].forEach(function (kind) {
      var conf = PHASE[kind];
      var list = plansOf(date, member, kind);
      var done = list.length > 0;
      box.appendChild(U.el('div', {
        class: 'card', style: {
          flex: '1 1 260px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px',
          borderLeft: '4px solid ' + (done ? 'var(--ok)' : (isToday ? 'var(--danger)' : 'var(--border)')),
          background: done ? null : (isToday ? '#fef2f2' : null)
        }
      }, [
        U.el('span', { style: { fontSize: '20px' }, text: conf.icon }),
        U.el('div', {}, [
          U.el('div', { class: 'strong', text: conf.label }),
          U.el('div', {
            class: 'muted', style: { fontSize: '11px' },
            text: done
              ? '入力済み ' + list.length + '件 / ' + U.fmtNum(U.sum(list, function (p) { return p[conf.hourKey]; }), 1) + 'h'
              : (isToday ? '未入力です' : '入力がありません')
          })
        ]),
        U.el('span', {
          class: 'chip', style: {
            marginLeft: 'auto',
            background: done ? 'var(--ok-soft)' : '#fee2e2',
            color: done ? 'var(--ok)' : 'var(--danger)'
          }, text: done ? '✓ 入力済' : '未入力'
        })
      ]));
    });
    return box;
  }

  function teamStatus(date) {
    var card = U.el('div', { class: 'card mt16' }, [
      U.el('div', { class: 'card-head' }, [
        U.el('h3', { text: '👥 チームの入力状況（' + U.fmtDateFull(date) + '）' })
      ])
    ]);
    var tbl = U.el('table', { class: 'grid-table' });
    tbl.appendChild(U.el('thead', {}, [
      U.el('tr', {}, ['担当者', '始業前', '終業前', '予定(h)', '実績(h)', '平均進捗'].map(function (h, i) {
        return U.el('th', { class: i >= 3 ? 'right' : '', text: h });
      }))
    ]));
    var tb = U.el('tbody');
    var members = State.members();
    if (!members.length) {
      card.appendChild(U.el('div', { class: 'empty', html: '<span class="big">👥</span>メンバーが登録されていません' }));
      return card;
    }
    members.forEach(function (m) {
      var pl = plansOf(date, m, 'plan');
      var rs = plansOf(date, m, 'result');
      var avg = rs.length ? U.sum(rs, function (p) { return p.progress; }) / rs.length : null;
      function mark(ok) {
        return U.el('span', {
          class: 'chip', style: {
            background: ok ? 'var(--ok-soft)' : '#fee2e2', color: ok ? 'var(--ok)' : 'var(--danger)'
          }, text: ok ? '✓ 済' : '未'
        });
      }
      tb.appendChild(U.el('tr', {
        style: { cursor: 'pointer' },
        onclick: function () { P.member = m; State.setUser(m); P.key = null; App.render(); }
      }, [
        U.el('td', { class: 'strong' }, [
          U.el('span', {
            class: 'avatar', style: {
              background: U.colorOf(m), width: '20px', height: '20px', flex: '0 0 20px',
              fontSize: '9px', display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px'
            }, text: U.initials(m)
          }),
          document.createTextNode(m)
        ]),
        U.el('td', {}, [mark(pl.length > 0)]),
        U.el('td', {}, [mark(rs.length > 0)]),
        U.el('td', { class: 'num', text: U.fmtNum(U.sum(pl, function (p) { return p.hours; }), 1) }),
        U.el('td', { class: 'num', text: U.fmtNum(U.sum(rs, function (p) { return p.actualHours; }), 1) }),
        U.el('td', { class: 'num', text: avg === null ? '' : U.fmtNum(avg, 0) + '%' })
      ]));
    });
    tbl.appendChild(tb);
    card.appendChild(U.el('div', { class: 'table-wrap' }, [tbl]));
    return card;
  }

  /* ------------------------------------------------ ビュー */
  Views.planInput = {
    title: '日次入力',
    desc: '始業前に本日の予定、終業前に本日の実績（工程・進捗率）を入力します',
    icon: '📝',
    app: 'plan',
    render: function (root) {
      var member = me();
      var date = curDate();
      dlReady = false;
      syncDrafts();

      var bar = U.el('div', { class: 'filterbar' });
      bar.appendChild(U.el('div', { class: 'fld' }, [
        U.el('label', { text: '担当者（自分）' }),
        (function () {
          var s = U.el('select', {
            style: { minWidth: '150px' },
            onchange: function () { P.member = this.value; State.setUser(this.value); P.key = null; App.render(); }
          });
          State.members().forEach(function (m) { s.appendChild(U.el('option', { value: m, text: m, selected: m === member })); });
          if (!State.members().length) s.appendChild(U.el('option', { value: '', text: '（メンバー未登録）' }));
          s.value = member;
          return s;
        })()
      ]));
      bar.appendChild(U.el('div', { class: 'fld' }, [
        U.el('label', { text: '対象日' }),
        U.el('input', {
          type: 'date', value: date,
          onchange: function () { P.date = this.value || todayIso(); P.key = null; App.render(); }
        })
      ]));
      bar.appendChild(U.el('div', { class: 'row-flex', style: { marginTop: '12px' } }, [
        U.el('button', { class: 'btn btn-sm', text: '‹ 前日', onclick: function () { P.date = U.iso(U.addDays(U.parseDate(date), -1)); P.key = null; App.render(); } }),
        U.el('button', { class: 'btn btn-sm', text: '本日', onclick: function () { P.date = todayIso(); P.key = null; App.render(); } }),
        U.el('button', { class: 'btn btn-sm', text: '翌日 ›', onclick: function () { P.date = U.iso(U.addDays(U.parseDate(date), 1)); P.key = null; App.render(); } }),
        U.el('strong', {
          style: { marginLeft: '8px', color: date === todayIso() ? 'var(--primary)' : null },
          text: U.fmtDateFull(date) + '（' + WD[U.parseDate(date).getDay()] + '）' + (date === todayIso() ? ' ＝ 本日' : '')
        })
      ]));
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: '📌 取組み予定を登録',
        title: '一定期間取り組む作業を登録します（日次入力から選べるようになります）',
        onclick: function () {
          Views.planAssign._editor({ member: member, date: date }, function () { P.key = null; App.render(); });
        }
      }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: '⧉ 前営業日の予定を複製',
        onclick: function () { copyPreviousDay(); }
      }));
      root.appendChild(bar);

      if (!member) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">📝</span>担当者（自分）を設定してください' }));
        return;
      }

      root.appendChild(statusStrip(date, member));

      var sheets = U.el('div', {
        class: 'mt16',
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(880px, 1fr))', gap: '12px', alignItems: 'start' }
      });
      sheets.appendChild(sheet(PHASE.plan));
      sheets.appendChild(sheet(PHASE.result));
      root.appendChild(sheets);

      var pl = plansOf(date, member, 'plan');
      var rs = plansOf(date, member, 'result');
      var planned = U.sum(pl, function (p) { return p.hours; });
      var actual = U.sum(rs, function (p) { return p.actualHours; });
      var target = State.settings().workHoursPerDay || 7.5;
      root.appendChild(U.el('div', { class: 'grid k4 mt16' }, [
        Views._helpers.kpi('本日の予定工数', U.fmtNum(planned, 1), 'h', '基準 ' + target + 'h', planned > target ? 'red' : 'blue'),
        Views._helpers.kpi('本日の実績工数', U.fmtNum(actual, 1), 'h', planned ? '予定比 ' + U.fmtNum(actual / planned * 100, 0) + '%' : '—', 'green'),
        Views._helpers.kpi('実績登録', String(rs.length), '件', '完了 ' + rs.filter(function (p) { return p.status === '完了'; }).length + '件', 'violet'),
        Views._helpers.kpi('平均進捗', rs.length ? U.fmtNum(U.sum(rs, function (p) { return p.progress; }) / rs.length, 0) : '—', '%', '実績行の平均', 'amber')
      ]));

      root.appendChild(teamStatus(date));
    }
  };

  function copyPreviousDay() {
    var cur = U.parseDate(curDate());
    var src = [], probe = cur;
    for (var i = 0; i < 7 && !src.length; i++) {
      probe = U.addDays(probe, -1);
      src = plansOf(U.iso(probe), me(), 'plan');
    }
    if (!src.length) { U.toast('直近7日間に予定がありません', 'warn'); return; }
    src.forEach(function (p) {
      P.rows.plan.push(Object.assign(emptyRow('plan'), {
        category: p.category, project: p.project, title: p.title,
        programId: p.programId, taskId: p.taskId, assignmentId: p.assignmentId,
        projectCode: p.projectCode, workCode: p.workCode,
        hours: p.hours
      }));
    });
    P.rows.plan = P.rows.plan.filter(function (r) { return !isBlank(r); });
    U.toast(U.fmtDate(U.iso(probe)) + ' の予定 ' + src.length + ' 件を複製しました（未保存）', 'ok');
    App.render();
  }

  /* ------------------------------------------------ 単票エディタ（他ビューから利用） */
  function planEditor(base, onSaved) {
    if (base && kindOf(base) === 'assignment') {
      return Views.planAssign._editor(base, onSaved);
    }
    var draft = Object.assign({
      member: me(), kind: 'plan', category: (State.masters.planCategories[0] || {}).value,
      status: '予定', hours: State.settings().workHoursPerDay, allDay: true
    }, base || {});
    draft.kind = kindOf(draft);

    var grid = U.el('div', { class: 'form-grid' });
    function field(label, node, span, hint) {
      grid.appendChild(U.el('div', { class: 'field' + (span ? ' span2' : '') }, [
        U.el('label', { text: label }), node,
        hint ? U.el('div', { class: 'hint', text: hint }) : null
      ]));
    }
    function input(attrs, key, parse) {
      var el = U.el('input', attrs);
      function set() { draft[key] = parse ? parse(el.value) : (el.value || null); }
      el.addEventListener('input', set);
      el.addEventListener('change', set);
      return el;
    }
    function select(list, key, valueKey) {
      var s = U.el('select', { onchange: function () { draft[key] = this.value || null; } });
      s.appendChild(U.el('option', { value: '', text: '—' }));
      list.forEach(function (o) {
        var v = valueKey ? o[valueKey] : o;
        s.appendChild(U.el('option', { value: v, text: v, selected: draft[key] === v }));
      });
      s.value = draft[key] || '';
      return s;
    }
    function codeField(masterKey, key) {
      var s = U.el('select', { onchange: function () { draft[key] = this.value || null; } });
      s.appendChild(U.el('option', { value: '', text: '— 選択 —' }));
      State.codeList(masterKey).forEach(function (c) {
        s.appendChild(U.el('option', {
          value: c.code, selected: draft[key] === c.code,
          text: c.code + (c.name ? '　' + c.name : '')
        }));
      });
      if (draft[key] && !State.codeList(masterKey).some(function (c) { return c.code === draft[key]; })) {
        s.appendChild(U.el('option', { value: draft[key], text: draft[key] + '（マスタ未登録）', selected: true }));
      }
      s.value = draft[key] || '';
      return s;
    }

    var kindSel = U.el('select', { onchange: function () { draft.kind = this.value; } }, [
      U.el('option', { value: 'plan', text: '☀ 予定（始業前入力）', selected: draft.kind === 'plan' }),
      U.el('option', { value: 'result', text: '🌙 実績（終業前入力）', selected: draft.kind === 'result' })
    ]);
    kindSel.value = draft.kind;
    field('種別', kindSel);
    field('担当者', select(State.members(), 'member'));
    field('PJCD', codeField('projectCodes', 'projectCode'));
    field('作業コード', codeField('workCodes', 'workCode'));
    field('工程（作業区分）', select(State.masters.planCategories || [], 'category', 'value'));
    field('対象日', input({ type: 'date', value: draft.date || '' }, 'date'));
    field('予定工数(h)', input({ type: 'number', step: '0.5', value: draft.hours === null || draft.hours === undefined ? '' : draft.hours }, 'hours', U.num));
    field('実績工数(h)', input({ type: 'number', step: '0.5', value: draft.actualHours === null || draft.actualHours === undefined ? '' : draft.actualHours }, 'actualHours', U.num));
    field('ステータス', select(State.masters.planStatuses || [], 'status', 'value'));
    field('進捗率(%)', input({ type: 'number', step: '10', min: '0', max: '100', value: draft.progress === null || draft.progress === undefined ? '' : draft.progress }, 'progress', U.num));

    var projectInput = U.el('input', { type: 'text', value: draft.project || '', list: projectDatalist() });
    projectInput.addEventListener('input', function () { draft.project = this.value || null; });
    field('案件名', projectInput, true);

    var linkSel = U.el('select', { style: { width: '100%' } });
    linkSel.appendChild(U.el('option', { value: '', text: '（紐付けなし）' }));
    State.tasks.slice().sort(function (a, b) { return (b.startDate || '') < (a.startDate || '') ? -1 : 1; })
      .slice(0, 400).forEach(function (t) {
        linkSel.appendChild(U.el('option', {
          value: t.id, selected: draft.taskId === t.id,
          text: (t.programId || '(ID未設定)') + ' / ' + (t.assignee1 || '') + ' / ' + (t.project || '')
        }));
      });
    linkSel.addEventListener('change', function () {
      draft.taskId = this.value || null;
      var t = State.tasks.filter(function (x) { return x.id === draft.taskId; })[0];
      if (t) {
        draft.programId = t.programId;
        draft.project = t.project;
        projectInput.value = t.project || '';
        if (!draft.title) { draft.title = t.programId + ' ' + (t.kubun || ''); titleInput.value = draft.title; }
      }
    });
    field('開発タスクと紐付け', linkSel, true, '紐付けると開発プログラム管理の実績と突き合わせできます');

    var titleInput = input({ type: 'text', value: draft.title || '', placeholder: '例）SDLP341 修正・単体テスト' }, 'title');
    field('作業内容', titleInput, true);
    var note = U.el('textarea', { text: draft.note || '' });
    note.addEventListener('input', function () { draft.note = this.value || null; });
    field('備考', note, true);

    var foot = [];
    if (base && base.id) {
      foot.push(U.el('button', {
        class: 'btn btn-danger', text: '削除', onclick: function () {
          U.confirmDialog('削除確認', 'この記録を削除します。', '削除する').then(function (ok) {
            if (!ok) return;
            U.loading(true);
            API.deletePlan(base.id).then(function () {
              U.toast('削除しました', 'ok'); U.closeDrawer(); return State.reloadPlans();
            }).then(function () { P.key = null; onSaved && onSaved(); })
              .catch(function (e) { U.toast(e.message, 'err'); })
              .finally(function () { U.loading(false); });
          });
        }
      }));
    }
    foot.push(U.el('div', { class: 'spacer' }));
    foot.push(U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }));
    foot.push(U.el('button', {
      class: 'btn btn-primary', text: base && base.id ? '保存' : '登録', onclick: function () {
        if (!draft.member) { U.toast('担当者を選択してください', 'warn'); return; }
        if (!draft.date) { U.toast('対象日を入力してください', 'warn'); return; }
        draft.endDate = draft.date;
        U.loading(true);
        (base && base.id ? API.updatePlan(base.id, draft) : API.addPlan(draft))
          .then(function () {
            U.toast('保存しました', 'ok'); U.closeDrawer(); return State.reloadPlans();
          })
          .then(function () { P.key = null; onSaved && onSaved(); })
          .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
          .finally(function () { U.loading(false); });
      }
    }));

    U.openDrawer(base && base.id ? '記録を編集' : '業務予定を登録', grid, foot);
  }

  Views.planInput._editor = planEditor;
  Views.planInput._kindOf = kindOf;
  Views.planInput._PHASE = PHASE;
})(window);
