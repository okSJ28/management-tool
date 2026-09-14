/* ============================================================
   views/plan_assign.js - 取組み予定（期間）＋ 日次実績の紐づけ状況
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var A = { start: null, span: 28, member: '', status: '', showDone: true };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function me() { return State.user() || (State.members()[0] || ''); }

  function projectDatalist() {
    var dl = document.getElementById('dl_assign_project');
    if (dl) dl.remove();
    dl = U.el('datalist', { id: 'dl_assign_project' });
    State.projects().forEach(function (p) { dl.appendChild(U.el('option', { value: p })); });
    document.body.appendChild(dl);
    return 'dl_assign_project';
  }

  /* ------------------------------------------------ 登録・編集 */
  function editor(base, onSaved) {
    var draft = Object.assign({
      kind: 'assignment', member: me(),
      category: (State.masters.planCategories[0] || {}).value,
      status: '予定', hours: null
    }, base || {});
    draft.kind = 'assignment';

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

    field('担当者', select(State.members(), 'member'));
    field('工程（作業区分）', select(State.masters.planCategories || [], 'category', 'value'));
    field('開始日', input({ type: 'date', value: draft.date || '' }, 'date'));
    field('終了日', input({ type: 'date', value: draft.endDate || '' }, 'endDate'));
    field('予定工数(h)', input({
      type: 'number', step: '0.5', min: '0',
      value: draft.hours === null || draft.hours === undefined ? '' : draft.hours
    }, 'hours', U.num), false, '期間全体の合計工数');
    field('ステータス', select(State.masters.planStatuses || [], 'status', 'value'));

    var projectInput = U.el('input', { type: 'text', value: draft.project || '', list: projectDatalist() });
    projectInput.addEventListener('input', function () { draft.project = this.value || null; });
    field('案件名', projectInput, true);

    var titleInput = input({
      type: 'text', value: draft.title || '',
      placeholder: '例）SDLP341 製造・単体テスト'
    }, 'title');
    field('作業内容', titleInput, true);

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
      if (!t) return;
      draft.programId = t.programId;
      draft.project = t.project;
      projectInput.value = t.project || '';
      if (!draft.title) { draft.title = t.programId + ' ' + (t.kubun || ''); titleInput.value = draft.title; }
      if (!draft.date && t.startDate) { draft.date = t.startDate; }
      if (!draft.endDate && t.endDate) { draft.endDate = t.endDate; }
    });
    field('開発タスクと紐付け', linkSel, true, '開発プログラム管理のタスクと突き合わせできます');

    var note = U.el('textarea', { text: draft.note || '' });
    note.addEventListener('input', function () { draft.note = this.value || null; });
    field('備考', note, true);

    if (base && base.id) {
      var roll = State.assignmentRollup(base);
      var linked = State.dailyOf(base.id).length;
      field('日次の紐づき', U.el('div', { class: 'muted', style: { fontSize: '11.5px' } }, [
        U.el('div', { text: '紐づく日次入力: ' + linked + '件（実績 ' + roll.results.length + '件）' }),
        U.el('div', { text: '実績工数の積上: ' + U.fmtNum(roll.actualHours, 1) + 'h' }),
        U.el('div', { text: '最新進捗: ' + (roll.progress === null ? '—' : roll.progress + '%' + (roll.progressAt ? '（' + U.fmtDateFull(roll.progressAt) + '）' : '')) })
      ]), true);
    }

    var foot = [];
    if (base && base.id) {
      foot.push(U.el('button', {
        class: 'btn btn-danger', text: '削除', onclick: function () {
          var linked = State.dailyOf(base.id).length;
          U.confirmDialog('削除確認',
            'この取組み予定を削除します。' + (linked ? '\n紐づく日次入力 ' + linked + '件は残り、紐づけのみ解除されます。' : ''),
            '削除する').then(function (ok) {
              if (!ok) return;
              U.loading(true);
              var chain = Promise.resolve();
              State.dailyOf(base.id).forEach(function (p) {
                chain = chain.then(function () { return API.updatePlan(p.id, { assignmentId: null }); });
              });
              chain.then(function () { return API.deletePlan(base.id); })
                .then(function () { U.toast('削除しました', 'ok'); U.closeDrawer(); return State.reloadPlans(); })
                .then(function () { onSaved && onSaved(); })
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
        if (!draft.category) { U.toast('工程（作業区分）を選択してください', 'warn'); return; }
        if (!draft.date) { U.toast('開始日を入力してください', 'warn'); return; }
        if (!draft.endDate) draft.endDate = draft.date;
        if (draft.endDate < draft.date) { U.toast('終了日は開始日以降にしてください', 'warn'); return; }
        U.loading(true);
        (base && base.id ? API.updatePlan(base.id, draft) : API.addPlan(draft))
          .then(function () { U.toast('保存しました', 'ok'); U.closeDrawer(); return State.reloadPlans(); })
          .then(function () { onSaved && onSaved(); })
          .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
          .finally(function () { U.loading(false); });
      }
    }));

    U.openDrawer(base && base.id ? '取組み予定を編集' : '取組み予定を登録', grid, foot);
  }

  /* ------------------------------------------------ 予定表 */
  Views.planAssign = {
    title: '取組み予定',
    desc: '一定期間で取り組む作業を登録し、日次の実績を紐づけて進捗を追跡します',
    icon: '📌',
    app: 'plan',
    render: function (root) {
      if (!A.start) A.start = U.addDays(U.today(), -7);
      var todayIso = U.iso(U.today());
      var days = [];
      for (var i = 0; i < A.span; i++) days.push(U.addDays(A.start, i));
      var from = U.iso(days[0]), to = U.iso(days[days.length - 1]);

      var all = State.assignments().filter(function (a) {
        if (A.member && a.member !== A.member) return false;
        if (A.status && a.status !== A.status) return false;
        if (!A.showDone && a.status === '完了') return false;
        if (State.search) {
          var hay = [a.member, a.title, a.project, a.category, a.note].filter(Boolean).join(' ').toLowerCase();
          if (hay.indexOf(State.search.toLowerCase()) < 0) return false;
        }
        return true;
      });
      var list = all.filter(function (a) {
        return a.date && a.date <= to && (a.endDate || a.date) >= from;
      }).sort(function (x, y) {
        if ((x.member || '') !== (y.member || '')) return (x.member || '') < (y.member || '') ? -1 : 1;
        return (x.date || '') < (y.date || '') ? -1 : 1;
      });

      /* --- 操作バー --- */
      var bar = U.el('div', { class: 'filterbar' });
      bar.appendChild(U.el('div', { class: 'row-flex', style: { marginTop: '12px' } }, [
        U.el('button', { class: 'btn btn-sm', text: '‹‹ 前へ', onclick: function () { A.start = U.addDays(A.start, -14); App.render(); } }),
        U.el('button', { class: 'btn btn-sm', text: '今日', onclick: function () { A.start = U.addDays(U.today(), -7); App.render(); } }),
        U.el('button', { class: 'btn btn-sm', text: '次へ ››', onclick: function () { A.start = U.addDays(A.start, 14); App.render(); } }),
        U.el('strong', { style: { marginLeft: '8px' }, text: U.fmtDateFull(from) + ' 〜 ' + U.fmtDateFull(to) })
      ]));
      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: '表示日数' }),
      (function () {
        var s = U.el('select', { onchange: function () { A.span = parseInt(this.value, 10); App.render(); } });
        [14, 28, 42, 60].forEach(function (n) { s.appendChild(U.el('option', { value: n, text: n + '日', selected: A.span === n })); });
        return s;
      })()]));
      function sel(label, key, options) {
        var s = U.el('select', { onchange: function () { A[key] = this.value; App.render(); } });
        s.appendChild(U.el('option', { value: '', text: '(すべて)' }));
        options.forEach(function (o) { s.appendChild(U.el('option', { value: o, text: o, selected: A[key] === o })); });
        bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: label }), s]));
      }
      sel('担当者', 'member', State.members());
      sel('ステータス', 'status', (State.masters.planStatuses || []).map(function (s) { return s.value; }));
      bar.appendChild(U.el('label', { class: 'row-flex', style: { fontSize: '11.5px', marginTop: '12px' } }, [
        U.el('input', {
          type: 'checkbox', checked: A.showDone,
          onchange: function () { A.showDone = this.checked; App.render(); }
        }),
        document.createTextNode('完了も表示')
      ]));
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-primary btn-sm', text: '＋ 取組み予定を登録',
        onclick: function () { editor({ member: me(), date: todayIso }, function () { App.render(); }); }
      }));
      root.appendChild(bar);

      /* --- KPI --- */
      var planned = U.sum(all, function (a) { return a.hours; });
      var actual = 0, done = 0;
      all.forEach(function (a) {
        actual += State.assignmentRollup(a).actualHours || 0;
        if (a.status === '完了') done += 1;
      });
      var unlinked = (State.plans || []).filter(function (p) {
        return State.planKind(p) === 'result' && !p.assignmentId
          && p.date >= from && p.date <= to
          && (!A.member || p.member === A.member);
      }).length;
      root.appendChild(U.el('div', { class: 'grid k4' }, [
        Views._helpers.kpi('取組み予定', String(all.length), '件',
          '表示期間内 ' + list.length + '件 / 完了 ' + done + '件', 'blue'),
        Views._helpers.kpi('予定工数', U.fmtNum(planned, 1), 'h',
          '約 ' + U.fmtNum(planned / (State.settings().workHoursPerDay || 7.5), 1) + ' 人日', 'violet'),
        Views._helpers.kpi('実績積上', U.fmtNum(actual, 1), 'h',
          planned ? '消化率 ' + U.fmtNum(actual / planned * 100, 0) + '%' : '—', 'green'),
        Views._helpers.kpi('未紐づけの実績', String(unlinked), '件',
          '表示期間内で取組み予定に紐づいていない日次実績', unlinked ? 'amber' : 'green')
      ]));

      if (!list.length) {
        root.appendChild(U.el('div', {
          class: 'empty mt16',
          html: '<span class="big">📌</span>表示期間に取組み予定がありません<br><small>「＋ 取組み予定を登録」から追加してください</small>'
        }));
        return;
      }

      /* --- 予定表（ガント + 実績サマリ） --- */
      var card = U.el('div', { class: 'card mt16' });
      var wrap = U.el('div', { class: 'table-wrap', style: { maxHeight: 'calc(100vh - 340px)' } });
      var tbl = U.el('table', { class: 'grid-table' });

      var hr = U.el('tr');
      [['担当者', '108px'], ['工程', '104px'], ['作業内容 / 案件', '230px'],
      ['予定h', '58px'], ['実績h', '58px'], ['消化率', '64px'], ['進捗', '104px']]
        .forEach(function (c) {
          hr.appendChild(U.el('th', { class: 'col-pin', style: { minWidth: c[1] }, text: c[0] }));
        });
      days.forEach(function (d) {
        var iso = U.iso(d);
        hr.appendChild(U.el('th', {
          class: 'center', style: {
            minWidth: '30px', fontSize: '10px', padding: '4px 2px',
            background: iso === todayIso ? 'var(--primary-soft)' : (U.isWeekend(d) ? '#fef2f2' : null)
          },
          text: d.getDate() + ''
        }));
      });
      tbl.appendChild(U.el('thead', {}, [hr]));

      var tb = U.el('tbody');
      list.forEach(function (a) {
        var color = State.planColor(a.category);
        var roll = State.assignmentRollup(a);
        // 日別セルで毎回検索しないよう先に日付を引ける形にしておく
        var resultDays = {}, planDays = {};
        roll.results.forEach(function (r) { resultDays[r.date] = true; });
        State.dailyOf(a.id, 'plan').forEach(function (r) { planDays[r.date] = true; });
        var tr = U.el('tr', {
          style: { cursor: 'pointer' },
          onclick: function () { editor(a, function () { App.render(); }); }
        });
        tr.appendChild(U.el('td', { class: 'col-pin' }, [
          U.el('span', {
            class: 'avatar', style: {
              background: U.colorOf(a.member), width: '18px', height: '18px', flex: '0 0 18px',
              fontSize: '8px', display: 'inline-grid', verticalAlign: 'middle', marginRight: '5px'
            }, text: U.initials(a.member || '')
          }),
          document.createTextNode(a.member || '—')
        ]));
        tr.appendChild(U.el('td', { class: 'col-pin' }, [
          U.el('span', { class: 'chip', style: { background: color + '1f', color: color }, text: a.category || '—' })
        ]));
        tr.appendChild(U.el('td', { class: 'col-pin' }, [
          U.el('div', { class: 'strong', style: { fontSize: '11.5px' }, text: a.title || '(作業内容未設定)' }),
          U.el('div', {
            class: 'muted', style: {
              fontSize: '10.5px', maxWidth: '220px', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }, title: a.project || '', text: a.project || ''
          })
        ]));
        tr.appendChild(U.el('td', { class: 'col-pin num', text: a.hours ? U.fmtNum(a.hours, 1) : '' }));
        tr.appendChild(U.el('td', {
          class: 'col-pin num', style: { color: roll.actualHours ? 'var(--ok)' : null },
          text: roll.actualHours ? U.fmtNum(roll.actualHours, 1) : ''
        }));
        tr.appendChild(U.el('td', {
          class: 'col-pin num',
          style: { color: roll.rate !== null && roll.rate > 110 ? 'var(--danger)' : null },
          text: roll.rate === null ? '' : U.fmtNum(roll.rate, 0) + '%'
        }));
        tr.appendChild(U.el('td', { class: 'col-pin' }, [
          U.el('div', { class: 'progress' }, [
            U.el('span', { style: { width: (roll.progress || 0) + '%', background: color } })
          ]),
          U.el('div', {
            class: 'muted', style: { fontSize: '10px', marginTop: '2px' },
            text: roll.progress === null ? '実績未入力' : roll.progress + '%'
          })
        ]));

        days.forEach(function (d) {
          var iso = U.iso(d);
          var inSpan = a.date && iso >= a.date && iso <= (a.endDate || a.date);
          var hasResult = !!resultDays[iso];
          var hasPlan = !!planDays[iso];
          var cell = U.el('td', {
            style: {
              padding: '2px', textAlign: 'center', verticalAlign: 'middle',
              background: iso === todayIso ? '#f5f9ff' : (U.isWeekend(d) ? '#fffafa' : null)
            }
          });
          if (inSpan) {
            cell.appendChild(U.el('div', {
              title: U.fmtDateFull(iso) + (hasResult ? ' / 実績あり' : hasPlan ? ' / 予定あり' : ''),
              style: {
                height: '14px', borderRadius: '3px',
                background: hasResult ? color : color + '2e',
                border: hasPlan && !hasResult ? '1px dashed ' + color : null,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '9px', color: '#fff', fontWeight: 700
              },
              text: hasResult ? '✓' : ''
            }));
          }
          tr.appendChild(cell);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      card.appendChild(wrap);
      card.appendChild(U.el('div', { class: 'card-body tight' }, [
        U.el('div', { class: 'muted', style: { fontSize: '11px' } }, [
          U.el('span', { text: '帯 = 取組み期間 / ' }),
          U.el('span', { style: { fontWeight: 700 }, text: '✓ 濃い色 = 実績入力あり' }),
          U.el('span', { text: ' / 破線 = 日次予定のみ　行クリックで編集' })
        ])
      ]));
      root.appendChild(card);
    }
  };

  Views.planAssign._editor = editor;
})(window);
