/* ============================================================
   views/plan_assign.js - 取組み予定（期間）＋ 日次実績の紐づけ状況
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var A = { start: null, span: 28, member: '', project: '', grade: '', gradeInit: false, status: '', showDone: true, changedOnly: false };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  function me() { return State.me(); }

  function projectDatalist() {
    var dl = document.getElementById('dl_assign_project');
    if (dl) dl.remove();
    dl = U.el('datalist', { id: 'dl_assign_project' });
    State.projects().forEach(function (p) { dl.appendChild(U.el('option', { value: p })); });
    document.body.appendChild(dl);
    return 'dl_assign_project';
  }

  /* 「開発タスクと紐付け」の選択肢（担当者のタスクのみ。紐付け済みのタスクは担当外でも残す） */
  function fillTaskOptions(sel, member, selectedId) {
    U.clear(sel);
    sel.appendChild(U.el('option', { value: '', text: '（紐付けなし）' }));
    var list = member ? State.tasksOfMember(member) : [];
    if (selectedId && !list.some(function (t) { return t.id === selectedId; })) {
      list = list.concat(State.tasks.filter(function (t) { return t.id === selectedId; }));
    }
    list.slice().sort(function (a, b) { return (b.startDate || '') < (a.startDate || '') ? -1 : 1; })
      .slice(0, 400).forEach(function (t) {
        sel.appendChild(U.el('option', {
          value: t.id, selected: selectedId === t.id,
          text: (t.programId || '(ID未設定)') + ' / ' + (t.assignee1 || '') + ' / ' + (t.project || '')
        }));
      });
    sel.value = selectedId || '';
  }

  /* ------------------------------------------------ 予定の変更（期間・予定工数のリスケ） */
  /* 予定の変更理由の候補（自由入力もできる。理由は必須） */
  var RESCHEDULE_REASONS = ['仕様変更', '他作業の優先', '見積りの見直し', '前工程・回答待ち', '体制・休暇'];

  function hoursOf(v) { return v === null || v === undefined || v === '' ? null : Number(v); }
  /* 当初の予定（1 件目の変更の変更前。変更していなければ今の予定） */
  function baseline(a) {
    var h = (a.reschedules || [])[0];
    if (!h) return { date: a.date, endDate: a.endDate || a.date, hours: hoursOf(a.hours) };
    // 予定工数を記録していない変更（工数を変更前後とも持たない）は、今の予定工数を当初とみなす
    var noHours = hoursOf(h.fromHours) === null && hoursOf(h.toHours) === null;
    return {
      date: h.fromDate, endDate: h.fromEndDate || h.fromDate,
      hours: noHours ? hoursOf(a.hours) : hoursOf(h.fromHours)
    };
  }
  function dayDiff(from, to) { return Math.round((U.parseDate(to) - U.parseDate(from)) / 86400000); }
  /* 予定を変更した取組み予定の、当初からの終了日のずれ（日）・予定工数の増減（h）・変更回数。変更していなければ null */
  function slip(a) {
    var n = (a.reschedules || []).length;
    if (!n) return null;
    var b = baseline(a);
    return {
      count: n, base: b, latest: a.reschedules[n - 1],
      days: dayDiff(b.endDate, a.endDate || a.date),
      hours: Math.round(((hoursOf(a.hours) || 0) - (b.hours || 0)) * 100) / 100
    };
  }
  function signedDays(d) { return (d > 0 ? '+' : '−') + Math.abs(d) + '日'; }
  function signedHours(h) { return (h > 0 ? '+' : '−') + U.fmtH(Math.abs(h)) + 'h'; }
  /* 「延長 +7日・工数 +8h（変更 2回）」 */
  function slipText(sl) {
    var parts = [];
    if (sl.days > 0) parts.push('延長 ' + signedDays(sl.days));
    if (sl.days < 0) parts.push('前倒し ' + signedDays(sl.days));
    if (sl.hours) parts.push('工数 ' + signedHours(sl.hours));
    return (parts.length ? parts.join('・') : '予定を変更') + '（変更 ' + sl.count + '回）';
  }
  function period(from, to) {
    return U.fmtDate(from) + '(' + WD[U.parseDate(from).getDay()] + ')〜' + U.fmtDate(to || from) + '(' + WD[U.parseDate(to || from).getDay()] + ')';
  }
  function hoursLabel(h) { return h === null || h === undefined ? '—' : U.fmtH(h) + 'h'; }
  /* マウスを重ねたときに出す変更履歴 */
  function historyTitle(a) {
    var b = baseline(a);
    return ['当初: ' + period(b.date, b.endDate) + '　' + hoursLabel(b.hours)].concat((a.reschedules || []).map(function (h, i) {
      var hrs = h.fromHours !== h.toHours ? '　工数 ' + hoursLabel(h.fromHours) + '→' + hoursLabel(h.toHours) : '';
      return (i + 1) + '回目 ' + (h.at || '').slice(0, 10) + '  ' + period(h.fromDate, h.fromEndDate) + ' → ' + period(h.toDate, h.toEndDate)
        + hrs + (h.reason ? '  理由: ' + h.reason : '') + (h.by ? '（' + h.by + '）' : '');
    })).join('\n');
  }
  function nowStamp() {
    var d = new Date();
    return U.iso(d) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  /* 予定の変更履歴の表（エディタ用） */
  function historyTable(a) {
    var b = baseline(a);
    var tbl = U.el('table', { class: 'grid-table', style: { fontSize: '11px' } });
    tbl.appendChild(U.el('thead', {}, [U.el('tr', {}, ['', '変更日', '期間', '終了日', '予定工数', '理由', '変更者'].map(function (h) {
      return U.el('th', { text: h });
    }))]));
    var tb = U.el('tbody');
    tb.appendChild(U.el('tr', { style: { background: 'var(--surface-2)' } }, [
      U.el('td', { class: 'strong', text: '当初' }), U.el('td', {}),
      U.el('td', { text: period(b.date, b.endDate) }), U.el('td', {}),
      U.el('td', { class: 'num', text: hoursLabel(b.hours) }), U.el('td', {}), U.el('td', {})
    ]));
    (a.reschedules || []).forEach(function (h, i) {
      var d = dayDiff(h.fromEndDate || h.fromDate, h.toEndDate || h.toDate);
      var moved = h.fromDate !== h.toDate || (h.fromEndDate || h.fromDate) !== (h.toEndDate || h.toDate);
      var dh = h.fromHours === undefined ? 0 : Math.round(((h.toHours || 0) - (h.fromHours || 0)) * 100) / 100;
      tb.appendChild(U.el('tr', {}, [
        U.el('td', { class: 'strong', text: (i + 1) + '回目' }),
        U.el('td', { class: 'mono', text: (h.at || '').slice(5, 16).replace('-', '/') }),
        U.el('td', { class: moved ? 'strong' : 'muted', title: '変更前 ' + period(h.fromDate, h.fromEndDate), text: period(h.toDate, h.toEndDate) }),
        U.el('td', {
          class: 'num strong', style: { color: d > 0 ? 'var(--warn)' : d < 0 ? 'var(--info)' : null },
          text: d ? signedDays(d) : '±0'
        }),
        U.el('td', {
          class: 'num' + (dh ? ' strong' : ' muted'), style: { color: dh > 0 ? 'var(--warn)' : dh < 0 ? 'var(--info)' : null },
          text: dh ? hoursLabel(h.fromHours) + '→' + hoursLabel(h.toHours) : hoursLabel(h.toHours)
        }),
        U.el('td', { text: h.reason || '' }),
        U.el('td', { text: h.by || '' })
      ]));
    });
    tbl.appendChild(tb);
    return U.el('div', { class: 'table-wrap' }, [tbl]);
  }

  /* ------------------------------------------------ 登録・編集 */
  function editor(base, onSaved) {
    var draft = Object.assign({
      kind: 'assignment', member: me(),
      category: (State.masters.planCategories[0] || {}).value,
      status: '予定', hours: null
    }, base || {});
    draft.kind = 'assignment';
    // 一般ユーザーは他の担当者の取組み予定を閲覧のみ
    var editable = State.canEdit(draft.member);

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

    var memberSel = select(State.isAdmin() ? State.members() : [draft.member], 'member');
    memberSel.disabled = !State.isAdmin();
    field('担当者', memberSel);
    field('工程（作業区分）', select(State.masters.planCategories || [], 'category', 'value'));
    // 登録済みの取組み予定の期間・予定工数は「📅 予定を変更」からだけ変える（変更前後の予定と理由を履歴に残す）
    var resched = null, reasonIn = null;
    if (base && base.id) {
      var sl = slip(base);
      var changeBox = U.el('div', { class: 'field span2 pa-resched', style: { display: 'none' } });
      var openBtn = U.el('button', {
        type: 'button', class: 'btn pa-resched-btn', text: '📅 予定を変更（期間・予定工数）',
        onclick: function () {
          resched = { reason: null, correction: false };
          changeBox.style.display = '';
          openBtn.style.display = 'none';
        }
      });
      field('期間・予定工数', U.el('div', {}, [
        U.el('div', { class: 'strong', text: period(base.date, base.endDate) + '　予定 ' + hoursLabel(hoursOf(base.hours)) }),
        sl ? U.el('div', {
          class: 'pa-slip', title: historyTitle(base),
          text: '📅 ' + slipText(sl) + '　当初 ' + period(sl.base.date, sl.base.endDate) + '・' + hoursLabel(sl.base.hours)
        }) : null,
        // 他の担当者の取組み予定（閲覧のみ）では変更ボタンを出さない
        editable ? U.el('div', { style: { marginTop: '8px' } }, [openBtn]) : null
      ]), true);
      var reasonList = U.el('datalist', { id: 'dl_resched_reason' });
      RESCHEDULE_REASONS.forEach(function (r) { reasonList.appendChild(U.el('option', { value: r })); });
      reasonIn = U.el('input', { type: 'text', list: 'dl_resched_reason', placeholder: '例）仕様変更（候補から選ぶか自由に入力）' });
      reasonIn.addEventListener('input', function () { resched.reason = this.value.trim() || null; });
      var corr = U.el('input', { type: 'checkbox' });
      corr.addEventListener('change', function () {
        resched.correction = this.checked;
        reasonIn.disabled = this.checked;
      });
      changeBox.appendChild(U.el('label', { text: '予定の変更' }));
      changeBox.appendChild(U.el('div', { class: 'pa-resched-grid' }, [
        U.el('div', {}, [U.el('div', { class: 'hint', text: '新しい開始日' }), input({ type: 'date', value: draft.date || '' }, 'date')]),
        U.el('div', {}, [U.el('div', { class: 'hint', text: '新しい終了日' }), input({ type: 'date', value: draft.endDate || '' }, 'endDate')]),
        U.el('div', {}, [U.el('div', { class: 'hint', text: '新しい予定工数(h)' }), input({
          type: 'number', step: '0.5', min: '0',
          value: draft.hours === null || draft.hours === undefined ? '' : draft.hours
        }, 'hours', U.num)]),
        U.el('div', { class: 'pa-resched-reason' }, [U.el('div', { class: 'hint', text: '変更の理由（必須）' }), reasonIn, reasonList])
      ]));
      changeBox.appendChild(U.el('label', { class: 'row-flex', style: { fontSize: '11.5px', fontWeight: 400, marginTop: '6px' } }, [
        corr, document.createTextNode('入力ミスの訂正（変更の履歴に残さない。理由は不要）')
      ]));
      grid.appendChild(changeBox);
    } else {
      var startIn = input({ type: 'date', value: draft.date || '' }, 'date');
      var endIn = input({ type: 'date', value: draft.endDate || '' }, 'endDate');
      field('開始日', startIn);
      field('終了日', endIn);
      field('予定工数(h)', input({
        type: 'number', step: '0.5', min: '0',
        value: draft.hours === null || draft.hours === undefined ? '' : draft.hours
      }, 'hours', U.num), false, '期間全体の合計工数');
    }
    // 予定・実施中・完了は、紐づく実績を保存したときに自動で切り替わる（手で変えた値も上書き。中止は変えない）
    field('ステータス', select(State.masters.planStatuses || [], 'status', 'value'), false,
      '実績を保存すると自動で切り替わります（実績なし＝予定／実績あり＝実施中／最新の進捗 100%＝完了。中止は変えません）');

    var projectInput = U.el('input', { type: 'text', value: draft.project || '', list: projectDatalist() });
    projectInput.addEventListener('input', function () { draft.project = this.value || null; });
    field('案件名', projectInput, true);

    var titleInput = input({
      type: 'text', value: draft.title || '',
      placeholder: '例）SDLP341 製造・単体テスト'
    }, 'title');
    field('作業内容', titleInput, true);

    var linkSel = U.el('select', { style: { width: '100%' } });
    fillTaskOptions(linkSel, draft.member, draft.taskId);
    // 担当者を切り替えたら（管理者のみ）その人のタスクに入れ替える
    memberSel.addEventListener('change', function () { fillTaskOptions(linkSel, draft.member, draft.taskId); });
    linkSel.addEventListener('change', function () {
      draft.taskId = this.value || null;
      var t = State.tasks.filter(function (x) { return x.id === draft.taskId; })[0];
      if (!t) return;
      draft.programId = t.programId;
      draft.project = t.project;
      projectInput.value = t.project || '';
      if (!draft.title) { draft.title = t.programId + ' ' + (t.kubun || ''); titleInput.value = draft.title; }
      // 新規登録では、空いている期間（開始日は初期値の今日のままなら）をタスクの期間で埋めて画面にも出す。
      // 登録済みの期間は「📅 予定を変更」からだけ変えるため触らない
      if (startIn) {
        if (t.startDate && (!draft.date || draft.date === (base || {}).date)) { draft.date = t.startDate; startIn.value = t.startDate; }
        if (t.endDate && !draft.endDate) { draft.endDate = t.endDate; endIn.value = t.endDate; }
      }
    });
    field('開発タスクと紐付け', linkSel, true, '担当者の開発タスクから選べます（開発プログラム管理のタスクと突き合わせできます）');

    var note = U.el('textarea', { text: draft.note || '' });
    note.addEventListener('input', function () { draft.note = this.value || null; });
    field('備考', note, true);

    if (base && (base.reschedules || []).length) {
      field('予定の変更履歴', historyTable(base), true);
    }

    if (base && base.id) {
      var roll = State.assignmentRollup(base);
      var linked = State.dailyOf(base.id).length;
      field('日次の紐づき', U.el('div', { class: 'muted', style: { fontSize: '11.5px' } }, [
        U.el('div', { text: '紐づく日次入力: ' + linked + '件（実績 ' + roll.results.length + '件）' }),
        U.el('div', { text: '実績工数の積上: ' + U.fmtH(roll.actualHours) + 'h' }),
        U.el('div', { text: '最新進捗: ' + (roll.progress === null ? '—' : roll.progress + '%' + (roll.progressAt ? '（' + U.fmtDateFull(roll.progressAt) + '）' : '')) })
      ]), true);
    }

    if (!editable) {
      U.openDrawer('取組み予定を表示', grid, [
        U.el('span', { class: 'muted', text: '他の担当者の取組み予定は変更できません' }),
        U.el('div', { class: 'spacer' }),
        U.el('button', { class: 'btn', text: '閉じる', onclick: U.closeDrawer })
      ]);
      return;
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
        if (draft.hours !== null && draft.hours !== undefined && !(draft.hours >= 0)) {
          U.toast('予定工数は 0 以上の数値で入力してください', 'warn'); return;
        }
        // 期間・予定工数を変えたら変更の履歴に追加する（理由は必須。入力ミスの訂正は残さない）
        if (base && base.id && resched && !resched.correction
          && (draft.date !== base.date || draft.endDate !== (base.endDate || base.date)
            || hoursOf(draft.hours) !== hoursOf(base.hours))) {
          if (!resched.reason) {
            U.toast('予定を変更する理由を入力してください（入力ミスの訂正なら「入力ミスの訂正」にチェック）', 'warn');
            reasonIn.focus();
            return;
          }
          draft.reschedules = (base.reschedules || []).concat([{
            at: nowStamp(), by: State.user(), reason: resched.reason,
            fromDate: base.date, fromEndDate: base.endDate || base.date, toDate: draft.date, toEndDate: draft.endDate,
            fromHours: hoursOf(base.hours), toHours: hoursOf(draft.hours)
          }]);
        }
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

  /* 開始日を過ぎても、日次入力の実績が 1 件も紐づいていない取組み予定（完了・中止は除く）。遅延と同じく赤く目立たせる */
  function noResultYet(a, roll, todayIso) {
    return a.status !== '完了' && a.status !== '中止' && !!a.date && a.date < todayIso && !roll.results.length;
  }

  /* ------------------------------------------------ 予定表 */
  Views.planAssign = {
    title: '取組み予定',
    desc: '一定期間で取り組む作業を登録し、日次の実績を紐づけて進捗を追跡します',
    icon: '📌',
    app: 'plan',
    searchable: true,
    render: function (root) {
      if (!A.start) A.start = U.addDays(U.today(), -7);
      var todayIso = U.iso(U.today());
      var days = [];
      for (var i = 0; i < A.span; i++) days.push(U.addDays(A.start, i));
      var from = U.iso(days[0]), to = U.iso(days[days.length - 1]);
      // 一般ユーザーは最初に開いたとき自分の年次で絞り込む（チーム予定ボードと同じ。以後は選んだ条件を保持）
      if (!A.gradeInit) {
        A.gradeInit = true;
        if (!State.isAdmin()) A.grade = State.memberAttr(State.user(), 'grade');
      }
      var attrs = Views.planBoard._attrs;
      function inGrade(m) { return attrs.match(A, m, ['grade']); }
      var candidates = State.members().filter(inGrade);
      if (A.member && candidates.indexOf(A.member) < 0) A.member = '';

      var all = State.assignments().filter(function (a) {
        if (A.member && a.member !== A.member) return false;
        if (!inGrade(a.member)) return false;
        if (A.project && a.project !== A.project) return false;
        if (A.status && a.status !== A.status) return false;
        if (!A.showDone && a.status === '完了') return false;
        if (A.changedOnly && !(a.reschedules || []).length) return false;
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
      attrs.fields(A, ['grade']).forEach(function (f) { bar.appendChild(f); });
      sel('担当者', 'member', candidates);
      sel('案件', 'project', State.projects());
      sel('ステータス', 'status', (State.masters.planStatuses || []).map(function (s) { return s.value; }));
      bar.appendChild(U.el('label', { class: 'row-flex', style: { fontSize: '11.5px', marginTop: '12px' } }, [
        U.el('input', {
          type: 'checkbox', checked: A.showDone,
          onchange: function () { A.showDone = this.checked; App.render(); }
        }),
        document.createTextNode('完了も表示')
      ]));
      bar.appendChild(U.el('label', { class: 'row-flex', style: { fontSize: '11.5px', marginTop: '12px' } }, [
        U.el('input', {
          type: 'checkbox', checked: A.changedOnly,
          onchange: function () { A.changedOnly = this.checked; App.render(); }
        }),
        document.createTextNode('📅 予定を変更したものだけ')
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
          && (!A.member || p.member === A.member) && inGrade(p.member)
          && (!A.project || p.project === A.project);
      }).length;
      root.appendChild(U.el('div', { class: 'grid k4' }, [
        Views._helpers.kpi('取組み予定', String(all.length), '件',
          '表示期間内 ' + list.length + '件 / 完了 ' + done + '件 / 予定変更 '
          + all.filter(function (a) { return (a.reschedules || []).length; }).length + '件', 'blue'),
        Views._helpers.kpi('予定工数', U.fmtH(planned), 'h',
          '約 ' + U.fmtNum(planned / (State.settings().workHoursPerDay || 7.5), 1) + ' 人日', 'violet'),
        Views._helpers.kpi('実績積上', U.fmtH(actual), 'h',
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
        var missing = noResultYet(a, roll, todayIso);
        // 予定を変更した取組み予定は、当初の期間を点線、当初の期間の外に出た日を斜線で表示する
        // （予定工数だけを変えて期間が当初のままなら、点線・斜線は出さない）
        var sl = slip(a);
        var b = sl && (sl.base.date !== a.date || sl.base.endDate !== (a.endDate || a.date)) ? sl.base : null;
        var tr = U.el('tr', {
          style: { cursor: 'pointer', background: missing ? 'var(--danger-soft)' : null },
          title: missing ? '開始日（' + U.fmtDateFull(a.date) + '）を過ぎていますが、日次入力の実績が 1 件も紐づいていません' : null,
          onclick: function () { editor(a, function () { App.render(); }); }
        });
        tr.appendChild(U.el('td', { class: 'col-pin', style: { boxShadow: missing ? 'inset 3px 0 0 var(--danger)' : null } }, [
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
          missing ? U.el('div', {
            class: 'strong', text: '⚠ 実績なし',
            style: { display: 'inline-block', background: 'var(--danger)', color: '#fff', borderRadius: '3px', padding: '0 4px', marginBottom: '1px', fontSize: '10px' }
          }) : null,
          U.el('div', { class: 'strong', style: { fontSize: '11.5px' }, text: a.title || '(作業内容未設定)' }),
          sl ? U.el('div', { class: 'pa-slip', title: historyTitle(a), text: '📅 ' + slipText(sl) }) : null,
          U.el('div', {
            class: 'muted', style: {
              fontSize: '10.5px', maxWidth: '220px', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }, title: a.project || '', text: a.project || ''
          })
        ]));
        tr.appendChild(U.el('td', { class: 'col-pin num', text: a.hours ? U.fmtH(a.hours) : '' }));
        tr.appendChild(U.el('td', {
          class: 'col-pin num', style: { color: roll.actualHours ? 'var(--ok)' : null },
          text: roll.actualHours ? U.fmtH(roll.actualHours) : ''
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
            class: missing ? 'strong' : 'muted',
            style: { fontSize: '10px', marginTop: '2px', color: missing ? 'var(--danger)' : null },
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
          var inBase = b && iso >= b.date && iso <= b.endDate;
          // 当初の期間の外に出た日（延長・後ろ倒しした日）
          var moved = b && inSpan && !inBase;
          if (inSpan) {
            cell.appendChild(U.el('div', {
              title: U.fmtDateFull(iso) + (hasResult ? ' / 実績あり' : hasPlan ? ' / 予定あり' : '')
                + (moved ? ' / 当初の期間の外（予定の変更で追加した日）' : ''),
              style: {
                height: '14px', borderRadius: '3px',
                background: hasResult ? color
                  : moved ? 'repeating-linear-gradient(135deg, var(--warn-soft) 0 3px, ' + color + '40 3px 6px)' : color + '2e',
                border: moved ? '1px solid var(--warn)' : hasPlan && !hasResult ? '1px dashed ' + color : null,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '9px', color: '#fff', fontWeight: 700
              },
              text: hasResult ? '✓' : ''
            }));
          }
          if (inBase) {
            cell.appendChild(U.el('div', {
              title: '当初の期間 ' + period(b.date, b.endDate),
              style: { borderTop: '2px dotted var(--warn)', marginTop: inSpan ? '2px' : '16px' }
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
          U.el('span', { text: ' / 破線 = 日次予定のみ / ' }),
          U.el('span', { style: { fontWeight: 700, color: 'var(--warn)' }, text: '📅 = 予定を変更（下の点線 = 当初の期間、斜線 = 当初の期間の外に出た日）' }),
          U.el('span', { text: ' / ' }),
          U.el('span', { style: { fontWeight: 700, color: 'var(--danger)' }, text: '赤い行（⚠ 実績なし）= 開始日を過ぎても実績が紐づいていない' }),
          U.el('span', { text: '　行クリックで編集' })
        ])
      ]));
      root.appendChild(card);
    }
  };

  Views.planAssign._editor = editor;
  // チーム予定ボード・予定サマリでも同じ判定・表示を使う
  Views.planAssign._resched = {
    baseline: baseline, slip: slip, slipText: slipText, period: period,
    historyTitle: historyTitle, hoursLabel: hoursLabel, signedDays: signedDays, signedHours: signedHours
  };
  Views.planAssign._fillTaskOptions = fillTaskOptions;
})(window);
