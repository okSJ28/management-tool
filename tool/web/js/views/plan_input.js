/* ============================================================
   views/plan_input.js - 日次入力（予実一体シート）
   1 作業 = 1 行。左が始業前の予定、右が終業前の実績。
   予定(kind=plan) と実績(kind=result) は別レコードのまま、
   実績の sourceId で予定と対応づけて 1 行に組み立てる。
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var P = { date: null, member: null, rows: null, leaves: [], removed: null, key: null, dirty: false, teamOpen: false, prevOpen: true };

  var PHASE = {
    plan: {
      kind: 'plan', icon: '☀', label: '始業前入力', short: '始業前',
      accent: '#d97706', soft: '#fffbeb', hourKey: 'hours', hourLabel: '予定(h)'
    },
    result: {
      kind: 'result', icon: '🌙', label: '終業前入力', short: '終業前',
      accent: '#4f46e5', soft: '#eef2ff', hourKey: 'actualHours', hourLabel: '実績(h)'
    }
  };

  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var PROGRESS_STEPS = [0, 25, 50, 75, 100];
  var SHARED = ['category', 'project', 'title', 'assignmentId', 'projectCode', 'workCode', 'programId', 'taskId'];
  var LEAVE = '休暇';
  /* やらなかった予定に付ける状況（実績は作らない） */
  var NOT_DONE = '中止';
  /* 実績の状況。遅延はチーム予定ボードで目立たせる */
  var ON_TRACK = '予定通り', DELAYED = '遅延';
  var RESULT_STATUSES = [ON_TRACK, DELAYED];

  function kindOf(p) {
    return p && (p.kind === 'result' || p.kind === 'assignment') ? p.kind : 'plan';
  }
  /* 一般ユーザーは自分の担当者に固定。管理者は他の担当者に切り替えられる */
  function me() { return (State.isAdmin() && P.member) || State.me(); }
  function todayIso() { return U.iso(U.today()); }
  function curDate() { return P.date || todayIso(); }

  function plansOf(iso, member, kind) {
    return State.plansOnDate(iso, member).filter(function (p) { return kindOf(p) === kind; });
  }

  /* 休暇で 1 日が埋まっているか（{category, hours} の配列）。
     時間が空欄の休暇（休暇登録の導入前の入力）は終日とみなす。午前休・午後休だけでは埋まらない */
  function leaveCovers(list) {
    var lv = list.filter(function (p) { return p.category === LEAVE; });
    if (!lv.length) return false;
    return lv.some(function (p) { return p.hours === null || p.hours === undefined; })
      || U.sum(lv, function (p) { return p.hours; }) >= dayTarget();
  }
  /* 予定がすべて休暇で 1 日が埋まっている日は終業前入力が不要なので、実績が無くても済とみなす */
  function isLeaveDay(iso, member) {
    var list = plansOf(iso, member, 'plan');
    return list.length > 0 && list.every(function (p) { return p.category === LEAVE; }) && leaveCovers(list);
  }
  /* 終業前の入力済み: 実績がある、予定を「未実施」にした、または終日休暇 */
  function notDonePlans(iso, member) {
    return plansOf(iso, member, 'plan').filter(function (p) { return p.status === NOT_DONE; });
  }
  function resultDone(iso, member) {
    return plansOf(iso, member, 'result').length > 0 || notDonePlans(iso, member).length > 0 || isLeaveDay(iso, member);
  }
  function hasLeave(iso, member) {
    return plansOf(iso, member, 'plan').some(function (p) { return p.category === LEAVE; });
  }
  /* 休暇は「🏖 休暇登録」から登録するので、入力シート・単票の工程の選択肢には出さない */
  function workCategories() {
    return (State.masters.planCategories || []).filter(function (c) { return c.value !== LEAVE; });
  }

  /* 対象日より前で test を満たす直近の日（直近 7 日以内）。
     休暇の日は 7 日に数えないので、長い休暇明けでも休暇前の入力を拾える。無ければ null */
  var LOOKBACK_DAYS = 7, LOOKBACK_MAX = 62;
  function lookBack(date, member, test) {
    var probe = U.parseDate(date), budget = LOOKBACK_DAYS;
    for (var i = 0; i < LOOKBACK_MAX && budget > 0; i++) {
      probe = U.addDays(probe, -1);
      var iso = U.iso(probe);
      if (test(iso)) return iso;
      if (!hasLeave(iso, member)) budget--;
    }
    return null;
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

  function newId() {
    var a = new Uint8Array(6);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* ------------------------------------------------ 行モデル */
  function makeRow(plan, result) {
    var src = result || plan || {};
    var f = {};
    SHARED.forEach(function (k) { f[k] = src[k] === undefined ? null : src[k]; });
    // 未実施にした予定は、実績の代わりに予定に残した進捗率を表示する（進捗率が空なら 0% として未実施を保つ）
    var skipped = !!plan && !result && plan.status === NOT_DONE;
    return {
      plan: plan, result: result, hasPlan: !!plan || !result, f: f,
      hours: plan ? plan.hours : null,
      actualHours: result ? result.actualHours : null,
      progress: result ? result.progress : (skipped ? (plan.progress === null || plan.progress === undefined ? 0 : plan.progress) : null),
      status: result && result.status === DELAYED ? DELAYED : ON_TRACK,
      delayReason: (result && result.delayReason) || null,
      dirty: false, fieldsEdited: false, codesOpen: false
    };
  }

  function newRow(hasPlan, init) {
    var r = makeRow(null, null);
    r.hasPlan = hasPlan;
    Object.keys(init || {}).forEach(function (k) {
      if (k === 'hours') r.hours = init.hours; else r.f[k] = init[k];
    });
    return r;
  }

  /* 予定に、その予定を元にした実績（sourceId）を 1 件ずつ対応づける。残りの実績は「予定外」の行になる。
     leaves を渡すと、休暇の予定は行にせず leaves に入れる（入力シートでは編集できない行として表示する） */
  function buildRows(date, member, leaves) {
    var results = plansOf(date, member, 'result');
    var used = {};
    var rows = [];
    plansOf(date, member, 'plan').forEach(function (p) {
      var res = null;
      results.some(function (r) {
        if (!used[r.id] && r.sourceId && r.sourceId === p.id) { used[r.id] = true; res = r; return true; }
        return false;
      });
      if (leaves && !res && p.category === LEAVE) { leaves.push(p); return; }
      rows.push(makeRow(p, res));
    });
    results.forEach(function (r) { if (!used[r.id]) rows.push(makeRow(null, r)); });
    return rows;
  }

  /* 実績h・進捗率のどちらかが入っていれば実績ありとする（両方消すと実績の取消し） */
  function hasResult(r) { return r.actualHours !== null || r.progress !== null; }
  /* 予定していたがやらなかった作業（実績 0h、または実績h 空欄で進捗 0%）。
     実績は作らず、予定の状況を「中止」にして「未実施」と表示する（進捗率は予定に残す） */
  function notDone(r) {
    if (!r.hasPlan) return false;
    if (r.actualHours !== null) return r.actualHours === 0;
    return r.progress === 0;
  }
  /* 予定(h) が空欄・0 の予定行に実績を入れたもの。突発作業として予定外（実績のみ）で保存する */
  function unplannedWork(r) { return r.hasPlan && !(r.hours > 0) && hasResult(r) && !notDone(r); }
  /* 実績として数える行（未実施は除く） */
  function countsAsResult(r) { return hasResult(r) && !notDone(r); }
  /* 実績h が空なら予定h をそのまま実績とみなす。未実施は 0 */
  function effActual(r) {
    if (notDone(r)) return 0;
    return r.actualHours !== null ? r.actualHours : (r.hasPlan ? r.hours : null);
  }

  /* 1日の工数として妥当か（空欄は可）。サーバー側でも同じ範囲で検証する */
  var DAY_HOURS = 24;
  function hoursOk(v) { return v === null || (v >= 0 && v <= DAY_HOURS); }

  /* 1日の予定工数の基準（設定の「1人日あたり時間」） */
  function dayTarget() { return State.settings().workHoursPerDay || 7.5; }
  /* 予定（{category, hours} の配列）の合計が基準に足りない時間。予定なし・終日休暇の日は 0 */
  function planShortage(list) {
    if (!list.length || leaveCovers(list)) return 0;
    var d = Math.round((dayTarget() - U.sum(list, function (p) { return p.hours; })) * 100) / 100;
    return d > 0 ? d : 0;
  }
  /* シート上の予定行（入力中の内容。休暇を含む） */
  function sheetPlans() {
    return P.rows.filter(function (r) { return r.hasPlan && !isBlank(r); })
      .map(function (r) { return { category: r.f.category, hours: r.hours }; })
      .concat(P.leaves.map(function (p) { return { category: p.category, hours: p.hours }; }));
  }

  function isBlank(r) {
    return !r.f.category && !r.f.title && !r.f.project && !r.f.assignmentId &&
      !r.f.projectCode && !r.f.workCode && r.hours === null && !hasResult(r);
  }

  function syncDrafts() {
    var key = curDate() + '|' + me();
    // 未保存の編集が無ければ毎回最新データから組み直す（自動同期の反映）
    if (P.key === key && P.rows && P.dirty) return;
    P.key = key;
    P.dirty = false;
    P.removed = [];
    P.leaves = [];
    P.rows = buildRows(curDate(), me(), P.leaves);
  }

  function touch(r, shared) {
    r.dirty = true;
    if (shared) r.fieldsEdited = true;
    P.dirty = true;
  }

  /* 未保存のまま担当者・日付を切り替える前の確認 */
  function leaveOk() {
    return !P.dirty || global.confirm('保存していない変更があります。破棄して切り替えますか？');
  }

  var dlReady = false, dlMember = null;

  /* 案件名の候補。その担当者が自分の予定・実績で使った案件を新しい順に先頭に出し、残りは従来どおり */
  function projectDatalist(member) {
    member = member || me();
    if (dlReady && dlMember === member && document.getElementById('dl_plan_project')) return 'dl_plan_project';
    var dl = document.getElementById('dl_plan_project');
    if (dl) dl.remove();
    dl = U.el('datalist', { id: 'dl_plan_project' });
    var mine = U.uniq((State.plans || []).filter(function (p) { return p.member === member && p.project; })
      .sort(function (a, b) {
        var ka = (a.date || '') + (a.updatedAt || ''), kb = (b.date || '') + (b.updatedAt || '');
        return ka < kb ? 1 : ka > kb ? -1 : 0;
      })
      .map(function (p) { return p.project; }));
    var label = member === State.user() ? '自分の予定で使用' : member + ' の予定で使用';
    mine.forEach(function (p) { dl.appendChild(U.el('option', { value: p, label: label })); });
    State.projects().forEach(function (p) {
      if (mine.indexOf(p) < 0) dl.appendChild(U.el('option', { value: p }));
    });
    document.body.appendChild(dl);
    dlReady = true;
    dlMember = member;
    return 'dl_plan_project';
  }

  /* ------------------------------------------------ 予実シート */
  function sheet() {
    var card = U.el('div', { class: 'card pi-card mt12' });
    var tbody = U.el('tbody');
    var tfoot = U.el('tfoot');
    var foot = U.el('div', { class: 'pi-foot' });
    var hour = new Date().getHours();
    var evening = curDate() < todayIso() || (curDate() === todayIso() && hour >= 15);

    function paint() {
      U.clear(tbody);
      if (!P.rows.length && !P.leaves.length) P.rows.push(newRow(true));
      P.leaves.forEach(function (p) { tbody.appendChild(leaveNode(p, paint)); });
      P.rows.forEach(function (r) { tbody.appendChild(rowNode(r, paint, refresh)); });
      tbody.appendChild(U.el('tr', { class: 'pi-add' }, [
        U.el('td', { colspan: '10' }, [
          U.el('button', {
            class: 'btn btn-sm pi-ghost', text: '＋ 作業を追加（予定）',
            onclick: function () { P.rows.push(newRow(true)); P.dirty = true; paint(); focusLast('.pi-cat'); }
          }),
          U.el('button', {
            class: 'btn btn-sm pi-ghost', text: '＋ 予定外の作業を追加（実績のみ）',
            title: '始業前に予定していなかった作業を実績として追加します',
            onclick: function () { P.rows.push(newRow(false)); P.dirty = true; paint(); focusLast('.pi-cat'); }
          })
        ])
      ]));
      refresh();
    }

    function focusLast(sel) {
      var list = tbody.querySelectorAll(sel);
      if (list.length) list[list.length - 1].focus();
    }

    function refresh() {
      var live = P.rows.filter(function (r) { return !isBlank(r); })
        .concat(P.leaves.map(function (p) { return makeRow(p, null); }));
      var planned = U.sum(live.filter(function (r) { return r.hasPlan; }), function (r) { return r.hours; });
      var done = live.filter(countsAsResult);
      var actual = U.sum(done, effActual);
      var target = dayTarget();
      var avg = U.avg(done, function (r) { return r.progress; });
      var short = planShortage(sheetPlans());

      // 内容のある行で工程が未選択なら赤枠で示す
      P.rows.forEach(function (r) {
        if (r.catNode) r.catNode.classList.toggle('pi-need', !r.f.category && !isBlank(r));
      });

      U.clear(tfoot);
      tfoot.appendChild(U.el('tr', {}, [
        U.el('td', { colspan: '4', class: 'right', text: '合計　' + live.length + ' 件' }),
        U.el('td', {
          class: 'num pi-am' + (short ? ' pi-short' : ''), text: fmtH(planned) + 'h',
          title: short ? '基準 ' + target + 'h に ' + fmtH(short) + 'h 足りません' : null
        }),
        U.el('td', { class: 'num pi-pm', text: done.length ? fmtH(actual) + 'h' : '—' }),
        diffCell(done.length ? actual : null, planned),
        U.el('td', { colspan: '3' }, [
          U.el('div', { class: 'row-flex', style: { gap: '8px' } }, [
            hoursBar(live, target),
            U.el('span', { class: 'muted', text: '基準 ' + target + 'h' + (avg === null ? '' : '　平均進捗 ' + U.fmtNum(avg, 0) + '%') })
          ])
        ])
      ]));

      var changed = P.rows.filter(function (r) { return r.dirty && (!isBlank(r) || r.plan || r.result); }).length + P.removed.length;
      var missing = P.rows.filter(function (r) { return hasResult(r) && r.progress === null; }).length;
      U.clear(foot);
      foot.appendChild(U.el('span', {
        class: 'pi-state' + (changed ? ' warn' : ''),
        text: changed ? '● 未保存の変更 ' + changed + ' 件' : '✓ 保存済み'
      }));
      if (missing) foot.appendChild(U.el('span', { class: 'pi-state err', text: '進捗率が未入力 ' + missing + ' 件' }));
      if (short) {
        foot.appendChild(U.el('span', {
          class: 'pi-state err', text: '⚠ 予定の合計 ' + fmtH(planned) + 'h（基準 ' + target + 'h に ' + fmtH(short) + 'h 不足）'
        }));
      }
      foot.appendChild(U.el('div', { class: 'spacer' }));
      foot.appendChild(U.el('span', { class: 'muted', text: 'Ctrl + S でも保存できます' }));
      foot.appendChild(U.el('button', { class: 'btn btn-primary', text: '💾 保存', onclick: save }));
    }

    var table = U.el('table', { class: 'grid-table pi-table' });
    var g1 = U.el('tr', { class: 'pi-group' }, [
      U.el('th', { colspan: '4', text: '作業' }),
      U.el('th', { class: 'pi-am', text: PHASE.plan.icon + ' 予定' }),
      U.el('th', { colspan: '4', class: 'pi-pm' + (evening ? ' pi-now' : ''), text: PHASE.result.icon + ' 実績（終業前に入力）' }),
      U.el('th', {})
    ]);
    var g2 = U.el('tr', {}, [
      ['工程（作業区分）', 104], ['案件名', 260], ['作業内容', null], ['取組み予定', 120],
      ['予定(h)', 80, 'pi-am'], ['実績(h)', 80, 'pi-pm'], ['差', 50], ['進捗率', 192], ['状況', 120], ['', 34]
    ].map(function (c) {
      return U.el('th', { class: c[2] || null, style: c[1] ? { width: c[1] + 'px' } : null, text: c[0] });
    }));
    table.appendChild(U.el('thead', {}, [g1, g2]));
    table.appendChild(tbody);
    table.appendChild(tfoot);

    card.appendChild(U.el('div', { class: 'pi-wrap' }, [table]));
    card.appendChild(foot);
    paint();
    return card;
  }

  /* 工数表示（0.25h 刻みも丸めずに出す） */
  var fmtH = U.fmtH;

  function diffCell(actual, planned) {
    if (actual === null || actual === undefined || planned === null || planned === undefined) {
      return U.el('td', { class: 'num' });
    }
    var d = Math.round((actual - planned) * 100) / 100;
    return U.el('td', {
      class: 'num pi-diff' + (d > 0 ? ' over' : d < 0 ? ' under' : ''),
      text: d === 0 ? '±0' : (d > 0 ? '+' : '−') + fmtH(Math.abs(d))
    });
  }

  /* 工程の色で塗り分けた時間配分バー（実績があれば実績、なければ予定） */
  function hoursBar(rows, target) {
    var parts = rows.map(function (r) {
      return { c: r.f.category, h: hasResult(r) ? effActual(r) : (r.hasPlan ? r.hours : 0) };
    }).filter(function (x) { return x.h > 0; });
    var total = U.sum(parts, function (x) { return x.h; });
    var scale = Math.max(total, target) || 1;
    var bar = U.el('div', { class: 'pi-hbar', title: fmtH(total) + 'h / 基準 ' + target + 'h' });
    parts.forEach(function (x) {
      bar.appendChild(U.el('span', {
        title: (x.c || '工程未選択') + ' ' + fmtH(x.h) + 'h',
        style: { width: (x.h / scale * 100) + '%', background: x.c ? State.planColor(x.c) : 'var(--text-3)' }
      }));
    });
    bar.appendChild(U.el('i', { style: { left: (target / scale * 100) + '%' } }));
    return bar;
  }

  function codeSelect(masterKey, r, field) {
    var sel = U.el('select', { title: State.codeLabel(masterKey, r.f[field]) });
    sel.appendChild(U.el('option', { value: '', text: masterKey === 'projectCodes' ? '— PJCD —' : '— 作業コード —' }));
    State.codeList(masterKey).forEach(function (c) {
      sel.appendChild(U.el('option', {
        value: c.code, selected: r.f[field] === c.code,
        text: c.code + (c.name ? '　' + c.name : '')
      }));
    });
    // マスタから削除されたコードが残っている場合も選択肢に保持する
    if (r.f[field] && !State.codeList(masterKey).some(function (c) { return c.code === r.f[field]; })) {
      sel.appendChild(U.el('option', { value: r.f[field], text: r.f[field] + '（マスタ未登録）', selected: true }));
    }
    sel.value = r.f[field] || '';
    sel.addEventListener('change', function () {
      r.f[field] = this.value || null;
      this.title = State.codeLabel(masterKey, r.f[field]);
      touch(r, true);
    });
    return sel;
  }

  function numInput(value, attrs) {
    return U.el('input', Object.assign({
      type: 'number', min: '0', class: 'num',
      value: value === null || value === undefined ? '' : value
    }, attrs));
  }

  function rowNode(r, paint, refresh) {
    var tr = U.el('tr', { class: r.hasPlan ? null : 'pi-extra' });
    var first = U.el('td', { class: 'pi-first' });
    function accent() {
      first.style.boxShadow = 'inset 3px 0 0 ' + (r.f.category ? State.planColor(r.f.category) : 'transparent');
    }
    accent();

    /* 工程（作業区分） */
    var cat = U.el('select', {
      class: 'pi-cat',
      onchange: function () {
        r.f.category = this.value || null;
        this.style.color = r.f.category ? State.planColor(r.f.category) : '';
        accent(); touch(r, true); refresh();
      }
    });
    r.catNode = cat;
    cat.appendChild(U.el('option', { value: '', text: '— 選択 —' }));
    var cats = workCategories();
    cats.forEach(function (c) {
      cat.appendChild(U.el('option', { value: c.value, text: c.value, selected: r.f.category === c.value }));
    });
    // マスタから削除された工程や、以前に入力した休暇の実績などは現在の値として残す
    if (r.f.category && !cats.some(function (c) { return c.value === r.f.category; })) {
      cat.appendChild(U.el('option', { value: r.f.category, text: r.f.category, selected: true }));
    }
    cat.value = r.f.category || '';
    cat.style.color = r.f.category ? State.planColor(r.f.category) : '';
    first.appendChild(cat);
    if (r.plan && r.plan.seriesId) {
      first.appendChild(U.el('div', { class: 'pi-series', text: '🔁 定例', title: '定例予定（毎週の予定）として登録された予定です' }));
    }
    tr.appendChild(first);

    /* 案件名 */
    var proj = U.el('input', { type: 'text', value: r.f.project || '', list: projectDatalist(), title: r.f.project || '' });
    proj.addEventListener('input', function () { r.f.project = this.value || null; this.title = this.value; touch(r, true); refresh(); });
    tr.appendChild(U.el('td', {}, [proj]));

    /* 作業内容 ＋ PJCD / 作業コード */
    var title = U.el('input', {
      type: 'text', value: r.f.title || '',
      placeholder: r.hasPlan ? '例）SDLP341 修正・単体テスト' : '例）本番障害の問合せ対応'
    });
    title.addEventListener('input', function () { r.f.title = this.value || null; touch(r, true); refresh(); });
    var codes = r.f.projectCode || r.f.workCode
      ? 'PJCD ' + (r.f.projectCode || '—') + ' ／ 作業 ' + (r.f.workCode || '—')
      : '＋ PJCD・作業コード';
    var codeBox = r.codesOpen
      ? U.el('div', { class: 'pi-codes' }, [codeSelect('projectCodes', r, 'projectCode'), codeSelect('workCodes', r, 'workCode')])
      : null;
    tr.appendChild(U.el('td', {}, [
      title,
      U.el('button', {
        type: 'button', class: 'pi-link', text: r.codesOpen ? '▴ 閉じる' : codes,
        title: State.codeLabel('projectCodes', r.f.projectCode) || 'PJCD・作業コードを選択',
        onclick: function () { r.codesOpen = !r.codesOpen; paint(); }
      }),
      codeBox
    ]));

    /* 取組み予定（期間）との紐づけ */
    var assigns = assignmentsForDay();
    var asg = U.el('select', {});
    asg.appendChild(U.el('option', { value: '', text: '（紐づけなし）' }));
    assigns.forEach(function (a) {
      asg.appendChild(U.el('option', { value: a.id, text: assignmentLabel(a), selected: r.f.assignmentId === a.id }));
    });
    // 期間外の取組み予定に既に紐づいている場合も選択肢を残す
    if (r.f.assignmentId && !assigns.some(function (a) { return a.id === r.f.assignmentId; })) {
      var old = State.assignmentById(r.f.assignmentId);
      if (old) asg.appendChild(U.el('option', { value: old.id, text: assignmentLabel(old), selected: true }));
    }
    asg.value = r.f.assignmentId || '';
    asg.title = asg.selectedIndex > 0 ? asg.options[asg.selectedIndex].text : '';
    asg.addEventListener('change', function () {
      r.f.assignmentId = this.value || null;
      var a = State.assignmentById(r.f.assignmentId);
      if (a) {
        r.f.category = a.category;
        r.f.project = a.project;
        r.f.programId = a.programId;
        r.f.taskId = a.taskId;
        if (!r.f.title) r.f.title = a.title;
      }
      touch(r, true);
      paint();
    });
    tr.appendChild(U.el('td', {}, [asg]));

    /* ☀ 予定(h) */
    var diffTd = U.el('td', { class: 'num' });
    var actual;
    function paintDiff() {
      var d = diffCell(hasResult(r) && r.hasPlan ? effActual(r) : null, r.hours);
      diffTd.className = d.className;
      diffTd.textContent = d.textContent;
      // やらなかった予定は「未実施」、予定(h) 空欄で実績を入れた行は予定外として保存することを示す
      if (actual) {
        actual.placeholder = notDone(r) ? '未実施' : (r.hasPlan && r.hours !== null ? String(r.hours) : '');
        actual.classList.toggle('pi-notdone', notDone(r));
      }
      tr.classList.toggle('pi-unplanned', unplannedWork(r));
      tr.title = unplannedWork(r) ? '予定(h) が空欄のため、保存すると予定外（突発作業）の実績になります' : '';
    }
    if (r.hasPlan) {
      var planH = numInput(r.hours, { step: '0.5', max: String(DAY_HOURS) });
      planH.addEventListener('input', function () {
        r.hours = U.num(this.value);
        if (actual) actual.placeholder = r.hours === null ? '' : String(r.hours);
        touch(r); paintDiff(); refresh();
      });
      tr.appendChild(U.el('td', { class: 'pi-am' }, [planH]));
    } else {
      tr.appendChild(U.el('td', { class: 'pi-am center' }, [U.el('span', { class: 'chip', text: '予定外' })]));
    }

    /* 🌙 実績(h)：空欄なら予定h を薄字で表示し、保存時はその値を採用する */
    actual = numInput(r.actualHours, {
      step: '0.5', max: String(DAY_HOURS), class: 'num pi-actual',
      placeholder: r.hasPlan && r.hours !== null ? String(r.hours) : '',
      title: '空欄のまま進捗率を入れると、予定(h) と同じ時間で登録します。0h・0% は未実施（実績にしない）'
    });
    actual.addEventListener('input', function () { r.actualHours = U.num(this.value); touch(r); paintDiff(); paintProgress(); refresh(); dim(); });
    tr.appendChild(U.el('td', { class: 'pi-pm' }, [actual]));
    tr.appendChild(diffTd);
    paintDiff();

    /* 進捗率：ワンクリックのボタン＋細かい値の数値入力 */
    var seg = U.el('div', { class: 'pi-seg' });
    var prog = numInput(r.progress, { step: '5', max: '100', class: 'num pi-prog', title: '進捗率(%)' });
    function paintProgress() {
      Array.prototype.forEach.call(seg.children, function (b) {
        b.classList.toggle('on', r.progress !== null && Number(b.dataset.v) === r.progress);
      });
      seg.classList.toggle('pi-need', hasResult(r) && r.progress === null);
    }
    function setProgress(v, fromInput) {
      r.progress = v === null ? null : Math.max(0, Math.min(100, v));
      // 範囲外の値（150 など）は補正後の値を欄にも表示する
      if (!fromInput || r.progress !== v) prog.value = r.progress === null ? '' : r.progress;
      touch(r); paintProgress(); paintDiff(); refresh(); dim();
    }
    PROGRESS_STEPS.forEach(function (v) {
      seg.appendChild(U.el('button', {
        type: 'button', text: String(v), dataset: { v: String(v) },
        onclick: function () { setProgress(r.progress === v ? null : v); }
      }));
    });
    prog.addEventListener('input', function () { setProgress(U.num(this.value), true); });
    tr.appendChild(U.el('td', {}, [U.el('div', { class: 'pi-progress' }, [seg, prog, U.el('span', { class: 'muted', text: '%' })])]));

    /* 状況（予定通り／遅延）。遅延のときは理由を任意で入力する */
    var reason = U.el('input', {
      type: 'text', class: 'pi-reason', value: r.delayReason || '', placeholder: '遅延の理由（任意）',
      title: r.delayReason || ''
    });
    reason.addEventListener('input', function () { r.delayReason = this.value || null; this.title = this.value; touch(r); });
    var st = U.el('select', {
      onchange: function () {
        r.status = this.value;
        paintStatus(); touch(r); refresh();
      }
    });
    RESULT_STATUSES.forEach(function (s) {
      st.appendChild(U.el('option', { value: s, text: s, selected: r.status === s }));
    });
    st.value = r.status;
    function paintStatus() {
      st.classList.toggle('pi-delayed', r.status === DELAYED);
      reason.style.display = r.status === DELAYED ? '' : 'none';
    }
    paintStatus();
    var stTd = U.el('td', {}, [st, reason]);
    tr.appendChild(stTd);
    // 実績が未入力の行・未実施の行は状況を薄く表示する
    function dim() { stTd.classList.toggle('pi-dim', !countsAsResult(r)); }
    dim();
    paintProgress();

    /* 削除（予定・実績とも） */
    tr.appendChild(U.el('td', {}, [
      U.el('button', {
        class: 'icon-btn', text: '✕', title: 'この作業を削除（予定・実績とも）',
        onclick: function () {
          var i = P.rows.indexOf(r);
          if (i < 0) return;
          if (r.plan && r.plan.id) P.removed.push(r.plan.id);
          if (r.result && r.result.id) P.removed.push(r.result.id);
          P.rows.splice(i, 1);
          P.dirty = true;
          paint();
        }
      })
    ]));
    return tr;
  }

  /* 休暇の行（編集不可。✕ で取り消し、保存で確定） */
  function leaveNode(p, paint) {
    return U.el('tr', { class: 'pi-leave', style: { background: '#f8fafc' } }, [
      U.el('td', { class: 'pi-first', style: { boxShadow: 'inset 3px 0 0 ' + State.planColor(LEAVE) } }, [
        U.el('span', { class: 'chip', style: { color: State.planColor(LEAVE) }, text: '🏖 ' + LEAVE })
      ]),
      // 作業内容の無い休暇（休暇登録の導入前の入力）は終日とみなす
      U.el('td', { colspan: '3', class: 'strong', text: (p.title || LEAVE_TYPES[0].label) + (p.note ? '　' + p.note : '') }),
      U.el('td', { class: 'num pi-am', text: p.hours === null || p.hours === undefined ? '' : fmtH(p.hours) }),
      U.el('td', { colspan: '4', class: 'pi-pm muted', text: '休暇のため実績の入力は不要です（登録は「🏖 休暇登録」から）' }),
      U.el('td', {}, [
        U.el('button', {
          class: 'icon-btn', text: '✕', title: 'この休暇を取り消す（保存で確定）',
          onclick: function () {
            var i = P.leaves.indexOf(p);
            if (i < 0) return;
            P.leaves.splice(i, 1);
            P.removed.push(p.id);
            P.dirty = true;
            paint();
          }
        })
      ])
    ]);
  }

  /* ------------------------------------------------ 保存 */
  var saving = false;
  function save() {
    // Ctrl+S の連打などで同じ内容が二重に登録されないよう、保存中は受け付けない
    if (saving) return;
    var rows = P.rows.filter(function (r) { return r.dirty && !isBlank(r); });
    if (rows.some(function (r) { return !hoursOk(r.hours) || !hoursOk(r.actualHours); })) {
      U.toast('予定(h)・実績(h) は 0〜' + DAY_HOURS + ' の範囲で入力してください', 'warn'); return;
    }
    if (rows.some(function (r) { return !r.f.category; })) {
      U.toast('工程（作業区分）を選択してください', 'warn'); return;
    }
    if (rows.some(function (r) { return !r.hasPlan && !hasResult(r); })) {
      U.toast('予定外の作業には実績(h)と進捗率(%)を入力してください', 'warn'); return;
    }
    if (rows.some(function (r) { return unplannedWork(r) && !(r.actualHours > 0); })) {
      U.toast('予定(h) が空欄の作業は予定外（突発作業）として保存します。実績(h) を入力してください', 'warn'); return;
    }
    if (rows.some(function (r) { return countsAsResult(r) && r.progress === null; })) {
      U.toast('実績を入力した作業には進捗率(%)を入力してください', 'warn'); return;
    }

    // 予定の合計が基準（7.5h）に足りないときは確認する。予定を変えていない保存（終業前の実績入力など）では聞かない
    var plans = sheetPlans();
    var short = planShortage(plans);
    var saved = plansOf(curDate(), me(), 'plan');
    var planChanged = plans.length !== saved.length
      || U.sum(plans, function (p) { return p.hours; }) !== U.sum(saved, function (p) { return p.hours; });
    if (short && planChanged) {
      U.confirmDialog('予定の合計が基準に足りません',
        '予定の合計が ' + fmtH(U.sum(plans, function (p) { return p.hours; })) + 'h で、基準 ' + dayTarget() + 'h に '
        + fmtH(short) + 'h 足りません。予定の入れ漏れがないか確認してください。このまま保存しますか？', 'このまま保存')
        .then(function (ok) { if (ok) commit(rows); });
      return;
    }
    commit(rows);
  }

  function commit(rows) {
    if (saving) return;
    var toDelete = P.removed.slice();
    var payload = [];
    var date = curDate(), member = me();
    P.rows.forEach(function (r) {
      if (!r.dirty) return;
      if (isBlank(r)) {
        if (r.plan) toDelete.push(r.plan.id);
        if (r.result) toDelete.push(r.result.id);
        return;
      }
      // 既存レコードは、作業の項目を編集した場合のみ共通項目を上書きする
      function shared(rec) {
        var out = { member: member, date: date, endDate: date };
        if (!rec || r.fieldsEdited) SHARED.forEach(function (k) { out[k] = r.f[k]; });
        return out;
      }
      // 予定(h) が空欄の予定行に実績を入れたもの（突発作業）は、予定を作らず予定外の実績にする
      var unplanned = unplannedWork(r);
      if (unplanned && r.plan) toDelete.push(r.plan.id);
      var planId = null;
      if (r.hasPlan && !unplanned) {
        planId = (r.plan && r.plan.id) || newId();
        var prevStatus = r.plan && r.plan.status !== NOT_DONE ? r.plan.status : null;
        payload.push(Object.assign({ status: '予定' }, r.plan || {}, shared(r.plan), {
          id: planId, kind: 'plan', hours: r.hours,
          // やらなかった予定は状況を「中止」にし（＝未実施）、実績は作らない。進捗率は予定に残す
          status: notDone(r) ? NOT_DONE : (prevStatus || '予定'),
          progress: notDone(r) ? r.progress : null
        }));
      }
      if (countsAsResult(r)) {
        payload.push(Object.assign({}, r.result || {}, shared(r.result), {
          id: (r.result && r.result.id) || newId(), kind: 'result',
          actualHours: effActual(r), progress: r.progress, status: r.status,
          delayReason: r.status === DELAYED ? r.delayReason : null,
          sourceId: unplanned ? null : (planId || (r.result && r.result.sourceId) || null)
        }, unplanned ? SHARED.reduce(function (o, k) { o[k] = r.f[k]; return o; }, {}) : {}));
      } else if (r.result) {
        // 実績h・進捗率を消した場合・未実施にした場合は実績レコードを削除する
        toDelete.push(r.result.id);
      }
    });
    if (!payload.length && !toDelete.length) { U.toast('変更はありません', 'info'); return; }

    saving = true;
    U.loading(true);
    API.savePlans(payload, toDelete)
      .then(function () { return State.reloadPlans(); })
      .then(function () {
        P.key = null;
        P.dirty = false;
        var parts = [];
        if (rows.length) parts.push(rows.length + ' 件');
        if (toDelete.length) parts.push('削除 ' + toDelete.length + ' 件');
        U.toast('保存しました（' + parts.join('・') + '）', 'ok');
        App.render();
      })
      .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
      .finally(function () { saving = false; U.loading(false); });
  }

  /* ------------------------------------------------ 状況表示 */
  function summary(date, member) {
    var isToday = date === todayIso();
    var box = U.el('div', { class: 'row-flex', style: { gap: '10px', flexWrap: 'wrap' } });
    ['plan', 'result'].forEach(function (kind) {
      var conf = PHASE[kind];
      var list = plansOf(date, member, kind);
      var leave = !list.length && kind === 'result' && isLeaveDay(date, member);
      // 終業前は、予定を「未実施」にしただけでも入力済み
      var skipped = kind === 'result' ? notDonePlans(date, member).length : 0;
      var done = list.length > 0 || skipped > 0 || leave;
      // 予定は件数があっても合計が基準に足りなければ「不足」として目立たせる
      var short = kind === 'plan' ? planShortage(list) : 0;
      var hours = fmtH(U.sum(list, function (p) { return p[conf.hourKey]; })) + 'h';
      box.appendChild(U.el('span', {
        class: 'pi-phase' + (short ? ' warn' : done ? ' ok' : (isToday ? ' ng' : '')),
        title: short ? '予定の合計が基準 ' + dayTarget() + 'h に ' + fmtH(short) + 'h 足りません' : null,
        text: conf.icon + ' ' + conf.short + '　' + (leave ? '✓ 休暇のため不要' : short
          ? '⚠ ' + list.length + '件 ' + hours + '（' + fmtH(short) + 'h 不足）'
          : done ? '✓ ' + list.length + '件 ' + hours + (skipped ? '・未実施 ' + skipped + '件' : '')
          : (isToday ? '未入力' : '入力なし'))
      }));
    });
    return box;
  }

  function teamStatus(date) {
    var members = State.members();
    var pc = 0, rc = 0;
    members.forEach(function (m) {
      var pl = plansOf(date, m, 'plan');
      if (pl.length && !planShortage(pl)) pc++;
      if (resultDone(date, m)) rc++;
    });
    var card = U.el('div', { class: 'card mt16' }, [
      U.el('div', {
        class: 'card-head', style: { cursor: 'pointer' },
        onclick: function () { P.teamOpen = !P.teamOpen; App.render(); }
      }, [
        U.el('h3', { text: '👥 チームの入力状況（' + U.fmtDateFull(date) + '）' }),
        U.el('span', { class: 'chip', style: chipStyle(pc === members.length), text: '始業前 ' + pc + '/' + members.length }),
        U.el('span', { class: 'chip', style: chipStyle(rc === members.length), text: '終業前 ' + rc + '/' + members.length }),
        U.el('div', { class: 'tools' }, [U.el('button', { class: 'btn btn-sm', text: P.teamOpen ? '▲ 閉じる' : '▼ 開く' })])
      ])
    ]);
    if (!P.teamOpen) return card;

    var tbl = U.el('table', { class: 'grid-table' });
    tbl.appendChild(U.el('thead', {}, [
      U.el('tr', {}, ['担当者', '始業前', '終業前', '予定(h)', '実績(h)', '平均進捗'].map(function (h, i) {
        return U.el('th', { class: i >= 3 ? 'right' : '', text: h });
      }))
    ]));
    var tb = U.el('tbody');
    if (!members.length) {
      card.appendChild(U.el('div', { class: 'empty', html: '<span class="big">👥</span>メンバーが登録されていません' }));
      return card;
    }
    members.forEach(function (m) {
      var pl = plansOf(date, m, 'plan');
      var rs = plansOf(date, m, 'result');
      var avg = U.avg(rs, function (p) { return p.progress; });
      var leave = !rs.length && isLeaveDay(date, m);
      var skipped = notDonePlans(date, m).length;
      var short = planShortage(pl);
      function mark(ok, text) {
        return U.el('span', { class: 'chip', style: chipStyle(ok), text: text || (ok ? '✓ 済' : '未') });
      }
      tb.appendChild(U.el('tr', {
        style: { cursor: 'pointer' }, title: m + ' さんの入力を表示',
        onclick: function () {
          if (!leaveOk()) return;
          P.member = m; P.key = null; P.dirty = false; App.render({ top: true });
        }
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
        U.el('td', {}, [short
          ? U.el('span', { class: 'chip', style: chipStyle('warn'), text: '⚠ ' + fmtH(short) + 'h 不足' })
          : mark(pl.length > 0)]),
        U.el('td', {}, [mark(rs.length > 0 || skipped > 0 || leave, leave ? '✓ 済（休暇）' : (!rs.length && skipped ? '✓ 済（未実施のみ）' : null))]),
        U.el('td', {
          class: 'num', style: { color: short ? 'var(--danger)' : null, fontWeight: short ? '700' : null },
          text: U.fmtH(U.sum(pl, function (p) { return p.hours; }))
        }),
        U.el('td', { class: 'num', text: U.fmtH(U.sum(rs, function (p) { return p.actualHours; })) }),
        U.el('td', { class: 'num', text: avg === null ? '' : U.fmtNum(avg, 0) + '%' })
      ]));
    });
    tbl.appendChild(tb);
    card.appendChild(U.el('div', { class: 'table-wrap' }, [tbl]));
    return card;
  }

  /* 対象日より前で、直近 7 日以内に休暇以外の入力がある日（土日・休暇の日を飛ばす）。無ければ null */
  function previousEntryDay(date, member) {
    return lookBack(date, member, function (iso) {
      return State.plansOnDate(iso, member).some(function (p) { return kindOf(p) !== 'assignment' && p.category !== LEAVE; });
    });
  }

  /* 前回入力日の内容（参照のみ） */
  function previousDay(date, member) {
    var prev = previousEntryDay(date, member);
    var label = prev ? U.fmtDateFull(prev) + '（' + WD[U.parseDate(prev).getDay()] + '）' : '直近7日間（休暇の日を除く）に入力なし';
    var card = U.el('div', { class: 'card mt16' }, [
      U.el('div', {
        class: 'card-head', style: { cursor: prev ? 'pointer' : null },
        onclick: prev ? function () { P.prevOpen = !P.prevOpen; App.render(); } : null
      }, [
        U.el('h3', { text: '📋 前回の入力（' + label + '）' }),
        U.el('span', { class: 'muted', text: '参照のみ・休暇の日は飛ばします' }),
        prev ? U.el('div', { class: 'tools' }, [U.el('button', { class: 'btn btn-sm', text: P.prevOpen ? '▲ 閉じる' : '▼ 開く' })]) : null
      ])
    ]);
    if (!prev || !P.prevOpen) return card;

    var rows = buildRows(prev, member);
    var tbl = U.el('table', { class: 'grid-table' });
    tbl.appendChild(U.el('thead', {}, [
      U.el('tr', {}, ['工程', '案件名', '作業内容', '予定(h)', '実績(h)', '進捗', '状況'].map(function (h, i) {
        return U.el('th', { class: i >= 3 && i <= 5 ? 'right' : '', text: h });
      }))
    ]));
    var tb = U.el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(U.el('tr', {}, [
        U.el('td', { class: 'strong', style: { color: r.f.category ? State.planColor(r.f.category) : null }, text: r.f.category || '—' }),
        U.el('td', { text: r.f.project || '' }),
        U.el('td', { text: r.f.title || '' }),
        U.el('td', { class: 'num', text: r.plan ? U.fmtH(r.hours) : '予定外' }),
        U.el('td', { class: 'num', style: { color: notDone(r) ? 'var(--danger)' : null }, text: r.result ? U.fmtH(effActual(r)) : (notDone(r) ? '未実施' : '') }),
        U.el('td', { class: 'num', text: r.progress === null ? '' : U.fmtNum(r.progress, 0) + '%' }),
        U.el('td', {
          class: r.result && r.status === DELAYED ? 'strong' : null,
          style: { color: r.result && r.status === DELAYED ? 'var(--danger)' : null },
          title: r.result && r.delayReason ? '遅延の理由: ' + r.delayReason : null,
          text: r.result ? (r.status === DELAYED ? '⚠ ' + DELAYED : r.status) : ''
        })
      ]));
    });
    tbl.appendChild(tb);
    card.appendChild(U.el('div', { class: 'table-wrap' }, [tbl]));
    return card;
  }

  function chipStyle(ok) {
    if (ok === 'warn') return { background: 'var(--warn-soft)', color: 'var(--warn)' };
    return { background: ok ? 'var(--ok-soft)' : '#fee2e2', color: ok ? 'var(--ok)' : 'var(--danger)' };
  }

  /* ------------------------------------------------ ビュー */
  function switchTo(member, date) {
    if (!leaveOk()) { App.render(); return; }
    if (member !== undefined) P.member = member;
    if (date !== undefined) P.date = date;
    P.key = null;
    P.dirty = false;
    App.render();
  }

  Views.planInput = {
    title: '日次入力',
    desc: '1 つの作業を 1 行で入力します。始業前に左の「予定」、終業前に同じ行の右の「実績」を入力してください',
    icon: '📝',
    app: 'plan',
    /* 未保存の編集中は自動同期による再描画を止める */
    busy: function () { return !!P.dirty; },
    /* 画面移動で未保存の変更を破棄する（次回表示時に保存済みの内容から組み直す） */
    discard: function () { P.dirty = false; P.key = null; },
    onSave: function () { save(); },
    render: function (root) {
      var member = me();
      var date = curDate();
      dlReady = false;
      syncDrafts();

      var bar = U.el('div', { class: 'filterbar' });
      bar.appendChild(U.el('div', { class: 'fld' }, [
        U.el('label', { text: '担当者（自分）' }),
        (function () {
          var admin = State.isAdmin();
          var s = U.el('select', {
            style: { minWidth: '150px' }, disabled: !admin,
            title: admin ? null : '一般ユーザーは自分の入力のみ登録できます',
            onchange: function () { switchTo(this.value); }
          });
          var list = admin ? State.members() : (member ? [member] : []);
          list.forEach(function (m) { s.appendChild(U.el('option', { value: m, text: m, selected: m === member })); });
          if (!list.length) s.appendChild(U.el('option', { value: '', text: '（メンバー未登録）' }));
          s.value = member;
          return s;
        })()
      ]));
      bar.appendChild(U.el('div', { class: 'fld' }, [
        U.el('label', { text: '対象日' }),
        U.el('input', {
          type: 'date', value: date,
          onchange: function () { switchTo(undefined, this.value || todayIso()); }
        })
      ]));
      bar.appendChild(U.el('div', { class: 'row-flex', style: { marginTop: '12px' } }, [
        U.el('button', { class: 'btn btn-sm', text: '‹ 前日', onclick: function () { switchTo(undefined, U.iso(U.addDays(U.parseDate(date), -1))); } }),
        U.el('button', { class: 'btn btn-sm', text: '本日', onclick: function () { switchTo(undefined, todayIso()); } }),
        U.el('button', { class: 'btn btn-sm', text: '翌日 ›', onclick: function () { switchTo(undefined, U.iso(U.addDays(U.parseDate(date), 1))); } }),
        U.el('strong', {
          style: { marginLeft: '8px', color: date === todayIso() ? 'var(--primary)' : null },
          text: U.fmtDateFull(date) + '（' + WD[U.parseDate(date).getDay()] + '）' + (date === todayIso() ? ' ＝ 本日' : '')
        })
      ]));
      bar.appendChild(U.el('div', { class: 'fld', style: { marginTop: '12px' } }, [summary(date, member)]));
      bar.appendChild(U.el('div', { class: 'spacer' }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: '⧉ 前営業日の予定を複製',
        onclick: function () { copyPreviousDay(); }
      }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: '🔁 定例予定を登録', title: '毎週の会議など、決まった曜日の予定をまとめて登録します',
        onclick: function () {
          // 登録後に入力シートを組み直すため、編集中の内容は先に保存してもらう
          if (P.dirty) { U.toast('入力中の内容を保存してから登録してください', 'warn'); return; }
          recurringEditor(function () { App.render(); });
        }
      }));
      bar.appendChild(U.el('button', {
        class: 'btn btn-sm', text: '🏖 休暇登録', title: '休暇（終日・午前休・午後休）を期間でまとめて登録します',
        onclick: function () {
          if (P.dirty) { U.toast('入力中の内容を保存してから登録してください', 'warn'); return; }
          leaveEditor(function () { App.render(); });
        }
      }));
      root.appendChild(bar);

      if (!member) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">📝</span>担当者（自分）を設定してください' }));
        return;
      }

      root.appendChild(sheet());
      root.appendChild(previousDay(date, member));
      // チームの入力状況は管理者のみ
      if (State.isAdmin()) root.appendChild(teamStatus(date));
    }
  };

  function copyPreviousDay() {
    // 休暇の日は飛ばして、休暇前の予定を複製する（休暇の予定自体も複製しない）
    function work(iso) { return plansOf(iso, me(), 'plan').filter(function (p) { return p.category !== LEAVE; }); }
    var day = lookBack(curDate(), me(), function (iso) { return work(iso).length > 0; });
    if (!day) { U.toast('直近7日間（休暇の日を除く）に予定がありません', 'warn'); return; }
    // 定例予定はそれぞれの日に登録済みなので複製しない
    var src = work(day).filter(function (p) { return !p.seriesId; });
    if (!src.length) { U.toast(U.fmtDate(day) + ' の予定は定例予定のみのため、複製するものがありません', 'warn'); return; }
    P.rows = P.rows.filter(function (r) { return !isBlank(r); });
    src.forEach(function (p) {
      var r = newRow(true, {
        category: p.category, project: p.project, title: p.title,
        programId: p.programId, taskId: p.taskId, assignmentId: p.assignmentId,
        projectCode: p.projectCode, workCode: p.workCode, hours: p.hours
      });
      r.dirty = true;
      P.rows.push(r);
    });
    P.dirty = true;
    U.toast(U.fmtDate(day) + ' の予定 ' + src.length + ' 件を複製しました（未保存）', 'ok');
    App.render();
  }

  /* ------------------------------------------------ 単票エディタ（他ビューから利用） */
  function planEditor(base, onSaved) {
    if (base && kindOf(base) === 'assignment') {
      return Views.planAssign._editor(base, onSaved);
    }
    var draft = Object.assign({
      member: me(), kind: 'plan', category: (workCategories()[0] || {}).value,
      status: '予定', hours: State.settings().workHoursPerDay, allDay: true
    }, base || {});
    draft.kind = kindOf(draft);
    if (draft.kind === 'result' && RESULT_STATUSES.indexOf(draft.status) < 0) draft.status = ON_TRACK;
    // 一般ユーザーは他の担当者の記録を閲覧のみ
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

    var kindSel = U.el('select', { onchange: function () { draft.kind = this.value; paintStatus(); } }, [
      U.el('option', { value: 'plan', text: '☀ 予定（始業前入力）', selected: draft.kind === 'plan' }),
      U.el('option', { value: 'result', text: '🌙 実績（終業前入力）', selected: draft.kind === 'result' })
    ]);
    kindSel.value = draft.kind;
    field('種別', kindSel);
    var memberSel = select(State.isAdmin() ? State.members() : [draft.member], 'member');
    memberSel.disabled = !State.isAdmin();
    field('担当者', memberSel);
    field('PJCD', codeField('projectCodes', 'projectCode'));
    field('作業コード', codeField('workCodes', 'workCode'));
    // 休暇は「🏖 休暇登録」から登録する（登録済みの休暇を開いたときは選択肢に残す）
    field('工程（作業区分）', select(draft.category === LEAVE ? State.masters.planCategories || [] : workCategories(), 'category', 'value'));
    field('対象日', input({ type: 'date', value: draft.date || '' }, 'date'));
    field('予定工数(h)', input({ type: 'number', step: '0.5', value: draft.hours === null || draft.hours === undefined ? '' : draft.hours }, 'hours', U.num));
    field('実績工数(h)', input({ type: 'number', step: '0.5', value: draft.actualHours === null || draft.actualHours === undefined ? '' : draft.actualHours }, 'actualHours', U.num));
    // 状況は、予定は業務予定のステータス、実績は予定通り／遅延（遅延のときは理由も入力できる）
    var statusSel = U.el('select', {
      onchange: function () { draft.status = this.value || null; paintStatus(); }
    });
    var reasonInput = input({ type: 'text', value: draft.delayReason || '', placeholder: '遅延の理由（任意）' }, 'delayReason');
    var reasonField = U.el('div', { class: 'field span2' }, [U.el('label', { text: '遅延の理由' }), reasonInput]);
    function paintStatus() {
      var result = draft.kind === 'result';
      var list = result ? RESULT_STATUSES : (State.masters.planStatuses || []).map(function (o) { return o.value; });
      if (list.indexOf(draft.status) < 0) draft.status = result ? ON_TRACK : null;
      statusSel.innerHTML = '';
      if (!result) statusSel.appendChild(U.el('option', { value: '', text: '—' }));
      list.forEach(function (v) { statusSel.appendChild(U.el('option', { value: v, text: v })); });
      statusSel.value = draft.status || '';
      reasonField.style.display = result && draft.status === DELAYED ? '' : 'none';
    }
    field('ステータス', statusSel);
    field('進捗率(%)', input({ type: 'number', step: '10', min: '0', max: '100', value: draft.progress === null || draft.progress === undefined ? '' : draft.progress }, 'progress', U.num));

    var projectInput = U.el('input', { type: 'text', value: draft.project || '', list: projectDatalist(draft.member) });
    projectInput.addEventListener('input', function () { draft.project = this.value || null; });
    // 担当者を変えたら、その担当者が使った案件を先頭にした候補に切り替える
    memberSel.addEventListener('change', function () { projectInput.setAttribute('list', projectDatalist(draft.member)); });
    field('案件名', projectInput, true);

    var linkSel = U.el('select', { style: { width: '100%' } });
    Views.planAssign._fillTaskOptions(linkSel, draft.member, draft.taskId);
    memberSel.addEventListener('change', function () { Views.planAssign._fillTaskOptions(linkSel, draft.member, draft.taskId); });
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
    grid.appendChild(reasonField);
    paintStatus();
    var note = U.el('textarea', { text: draft.note || '' });
    note.addEventListener('input', function () { draft.note = this.value || null; });
    field('備考', note, true);
    if (base && base.seriesId && kindOf(base) === 'plan') {
      grid.appendChild(U.el('div', { class: 'field span2' }, [
        U.el('div', { class: 'hint', text: '🔁 定例予定として登録された予定です。この日だけ変更・削除できます。以降をまとめて削除するときは「この日以降の定例を削除」を使います' })
      ]));
    }

    if (!editable) {
      U.openDrawer('記録を表示', grid, [
        U.el('span', { class: 'muted', text: '他の担当者の記録は変更できません' }),
        U.el('div', { class: 'spacer' }),
        U.el('button', { class: 'btn', text: '閉じる', onclick: U.closeDrawer })
      ]);
      return;
    }

    var foot = [];
    if (base && base.id) {
      foot.push(U.el('button', {
        class: 'btn btn-danger', text: '削除', onclick: function () {
          U.confirmDialog('削除確認', 'この記録を削除します。', '削除する').then(function (ok) {
            if (!ok) return;
            U.loading(true);
            API.deletePlan(base.id).then(function () {
              U.toast('削除しました', 'ok'); U.closeDrawer(); return State.reloadPlans();
            }).then(function () { onSaved && onSaved(); })
              .catch(function (e) { U.toast(e.message, 'err'); })
              .finally(function () { U.loading(false); });
          });
        }
      }));
    }
    if (base && base.id && base.seriesId && kindOf(base) === 'plan') {
      foot.push(U.el('button', {
        class: 'btn btn-danger', text: 'この日以降の定例を削除', onclick: function () {
          deleteSeries(base, function () { U.closeDrawer(); onSaved && onSaved(); });
        }
      }));
    }
    foot.push(U.el('div', { class: 'spacer' }));
    foot.push(U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }));
    foot.push(U.el('button', {
      class: 'btn btn-primary', text: base && base.id ? '保存' : '登録', onclick: function () {
        if (!draft.member) { U.toast('担当者を選択してください', 'warn'); return; }
        if (!draft.date) { U.toast('対象日を入力してください', 'warn'); return; }
        if (!hoursOk(U.num(draft.hours)) || !hoursOk(U.num(draft.actualHours))) {
          U.toast('予定工数・実績工数は 0〜' + DAY_HOURS + ' の範囲で入力してください', 'warn'); return;
        }
        if (draft.progress !== null && draft.progress !== undefined && (draft.progress < 0 || draft.progress > 100)) {
          U.toast('進捗率は 0〜100 の範囲で入力してください', 'warn'); return;
        }
        draft.endDate = draft.date;
        if (!(draft.kind === 'result' && draft.status === DELAYED)) draft.delayReason = null;
        U.loading(true);
        (base && base.id ? API.updatePlan(base.id, draft) : API.addPlan(draft))
          .then(function () {
            U.toast('保存しました', 'ok'); U.closeDrawer(); return State.reloadPlans();
          })
          .then(function () { onSaved && onSaved(); })
          .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
          .finally(function () { U.loading(false); });
      }
    }));

    U.openDrawer(base && base.id ? '記録を編集' : '業務予定を登録', grid, foot);
  }

  /* ------------------------------------------------ 定例予定（毎週の会議など） */
  // 開始日〜終了日のうち指定した曜日の日ごとに通常の予定（kind=plan）を作り、共通の seriesId で束ねる
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var SERIES_MAX_DAYS = 366;

  function seriesDates(from, to, weekdays) {
    var out = [];
    var d = U.parseDate(from), end = U.parseDate(to);
    if (!d || !end) return out;
    for (var i = 0; d <= end && i < SERIES_MAX_DAYS; i++, d = U.addDays(d, 1)) {
      if (weekdays.indexOf(d.getDay()) >= 0) out.push(U.iso(d));
    }
    return out;
  }

  /* 同じ日に同じ工程・作業内容の予定が既にあれば二重に登録しない */
  function hasSamePlan(iso, member, d) {
    return plansOf(iso, member, 'plan').some(function (p) {
      return p.category === d.category && (p.title || null) === (d.title || null);
    });
  }

  function recurringEditor(onSaved) {
    var admin = State.isAdmin();
    var today = U.today();
    var draft = {
      members: [me()].filter(Boolean), weekdays: [],
      from: U.iso(today), to: U.iso(U.addDays(today, 90)),
      category: null, project: null, title: null, hours: null, projectCode: null, workCode: null
    };
    var grid = U.el('div', { class: 'form-grid' });
    var preview = U.el('div', { class: 'hint', style: { fontSize: '12.5px' } });
    function field(label, node, span, hint) {
      grid.appendChild(U.el('div', { class: 'field' + (span ? ' span2' : '') }, [
        U.el('label', { text: label }), node,
        hint ? U.el('div', { class: 'hint', text: hint }) : null
      ]));
    }
    function checks(items, selected, onChange) {
      return U.el('div', { class: 'row-flex', style: { flexWrap: 'wrap', gap: '4px 12px' } }, items.map(function (it) {
        var cb = U.el('input', { type: 'checkbox', checked: selected.indexOf(it.value) >= 0 });
        cb.addEventListener('change', function () {
          var i = selected.indexOf(it.value);
          if (this.checked && i < 0) selected.push(it.value);
          if (!this.checked && i >= 0) selected.splice(i, 1);
          onChange();
        });
        return U.el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 'normal' } },
          [cb, document.createTextNode(it.label)]);
      }));
    }
    function text(key, attrs) {
      var el = U.el('input', Object.assign({ type: 'text', value: draft[key] || '' }, attrs || {}));
      el.addEventListener('input', function () { draft[key] = this.value.trim() || null; paintPreview(); });
      return el;
    }
    function codeField(masterKey, key) {
      var s = U.el('select', { onchange: function () { draft[key] = this.value || null; } });
      s.appendChild(U.el('option', { value: '', text: '— 選択 —' }));
      State.codeList(masterKey).forEach(function (c) {
        s.appendChild(U.el('option', { value: c.code, text: c.code + (c.name ? '　' + c.name : '') }));
      });
      return s;
    }

    /* 担当者ごとの登録対象日（既に同じ予定がある日を除く） */
    function targets() {
      var dates = seriesDates(draft.from, draft.to, draft.weekdays);
      return draft.members.map(function (m) {
        var list = dates.filter(function (iso) { return !hasSamePlan(iso, m, draft); });
        return { member: m, dates: list, skipped: dates.length - list.length };
      });
    }
    function paintPreview() {
      var dates = seriesDates(draft.from, draft.to, draft.weekdays);
      var ts = targets();
      var total = U.sum(ts, function (t) { return t.dates.length; });
      var skipped = U.sum(ts, function (t) { return t.skipped; });
      preview.textContent = !dates.length ? '対象日がありません（曜日と期間を指定してください）'
        : '対象日 ' + dates.length + ' 日（' + dates.slice(0, 4).map(U.fmtDate).join('・') + (dates.length > 4 ? ' …' : '') + '）'
          + (draft.members.length > 1 ? ' × ' + draft.members.length + ' 名' : '')
          + ' → 予定を ' + total + ' 件登録します' + (skipped ? '（同じ予定が登録済みの ' + skipped + ' 件は除く）' : '');
    }

    if (admin) {
      field('担当者', checks(State.members().map(function (m) { return { value: m, label: m }; }), draft.members, paintPreview), true);
    } else {
      field('担当者', U.el('input', { type: 'text', value: draft.members[0] || '', disabled: true }));
    }
    field('曜日（毎週）', checks(WEEK_ORDER.map(function (w) { return { value: w, label: WD[w] }; }), draft.weekdays, paintPreview), true);
    var from = U.el('input', { type: 'date', value: draft.from });
    from.addEventListener('change', function () { draft.from = this.value || null; paintPreview(); });
    var to = U.el('input', { type: 'date', value: draft.to });
    to.addEventListener('change', function () { draft.to = this.value || null; paintPreview(); });
    field('開始日', from);
    field('終了日', to, false, '最長 1 年');
    var cat = U.el('select', { onchange: function () { draft.category = this.value || null; paintPreview(); } });
    cat.appendChild(U.el('option', { value: '', text: '— 選択 —' }));
    workCategories().forEach(function (c) { cat.appendChild(U.el('option', { value: c.value, text: c.value })); });
    field('工程（作業区分）', cat);
    var hours = U.el('input', { type: 'number', step: '0.25', min: '0', max: String(DAY_HOURS), placeholder: '例）0.5' });
    hours.addEventListener('input', function () { draft.hours = U.num(this.value); });
    field('予定工数(h)', hours, false, '1回あたりの時間（30分なら 0.5）');
    field('案件名', text('project', { list: projectDatalist(State.user()) }), true);
    field('作業内容', text('title', { placeholder: '例）課会' }), true);
    field('PJCD', codeField('projectCodes', 'projectCode'));
    field('作業コード', codeField('workCodes', 'workCode'));
    grid.appendChild(U.el('div', { class: 'field span2' }, [preview]));
    paintPreview();

    var busy = false;
    U.openDrawer('🔁 定例予定を登録', grid, [
      U.el('span', { class: 'muted', text: '各日の予定として登録され、日次入力・チーム予定ボードに表示されます' }),
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }),
      U.el('button', {
        class: 'btn btn-primary', text: '登録', onclick: function () {
          if (busy) return;
          if (!draft.members.length) { U.toast('担当者を選択してください', 'warn'); return; }
          if (!draft.weekdays.length) { U.toast('曜日を選択してください', 'warn'); return; }
          if (!draft.from || !draft.to || draft.from > draft.to) { U.toast('開始日・終了日を確認してください', 'warn'); return; }
          if (U.diffDays(U.parseDate(draft.from), U.parseDate(draft.to)) >= SERIES_MAX_DAYS) {
            U.toast('期間は最長 1 年です', 'warn'); return;
          }
          if (!draft.category) { U.toast('工程（作業区分）を選択してください', 'warn'); return; }
          if (draft.hours === null || !(draft.hours > 0) || draft.hours > DAY_HOURS) {
            U.toast('予定工数(h) は 0 より大きく ' + DAY_HOURS + ' 以下で入力してください', 'warn'); return;
          }
          var jobs = targets().filter(function (t) { return t.dates.length; });
          if (!jobs.length) { U.toast('登録する日がありません（すべて登録済みです）', 'warn'); return; }
          var seriesId = newId();
          var added = 0;
          busy = true;
          U.loading(true);
          jobs.reduce(function (chain, t) {
            return chain.then(function () {
              return API.addPlan({
                kind: 'plan', member: t.member, status: '予定', allDay: true, seriesId: seriesId,
                category: draft.category, project: draft.project, title: draft.title, hours: draft.hours,
                projectCode: draft.projectCode, workCode: draft.workCode, dates: t.dates
              }).then(function (r) { added += (r && r.added) || 0; });
            });
          }, Promise.resolve())
            .then(function () {
              U.toast('定例予定を ' + added + ' 件登録しました', 'ok');
              U.closeDrawer();
            })
            .catch(function (e) { U.toast('エラー: ' + e.message + (added ? '（' + added + ' 件は登録済み）' : ''), 'err', 6000); })
            .then(function () { return State.reloadPlans(); })
            .then(function () { onSaved && onSaved(); })
            .finally(function () { busy = false; U.loading(false); });
        }
      })
    ]);
  }

  /* ------------------------------------------------ 休暇登録 */
  // 期間内の日ごとに工程「休暇」の予定（kind=plan）を作る。予定がすべて休暇の日は終業前入力が済になる
  var LEAVE_TYPES = [
    { value: 'full', label: '終日休暇', ratio: 1 },
    { value: 'am', label: '午前休', ratio: 0.5 },
    { value: 'pm', label: '午後休', ratio: 0.5 },
    { value: 'hour', label: '時間休', ratio: null }
  ];
  /* 時間休は 1 時間単位。1 日分に満たない時間まで（基準 7.5h なら 7h） */
  function hourLeaveMax() { return Math.max(1, Math.ceil(dayTarget()) - 1); }

  function leaveEditor(onSaved) {
    var admin = State.isAdmin();
    var draft = { member: me(), from: curDate(), to: curDate(), type: 'full', hourCount: 1, skipWeekend: true, note: null };
    var grid = U.el('div', { class: 'form-grid' });
    var preview = U.el('div', { class: 'hint', style: { fontSize: '12.5px' } });
    function field(label, node, span, hint) {
      grid.appendChild(U.el('div', { class: 'field' + (span ? ' span2' : '') }, [
        U.el('label', { text: label }), node,
        hint ? U.el('div', { class: 'hint', text: hint }) : null
      ]));
    }
    function type() { return LEAVE_TYPES.filter(function (t) { return t.value === draft.type; })[0]; }
    function hours() {
      if (type().ratio === null) return draft.hourCount;
      return Math.round(dayTarget() * type().ratio * 100) / 100;
    }
    function dates() {
      return seriesDates(draft.from, draft.to, draft.skipWeekend ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]);
    }
    /* 既に休暇を登録済みの日は除く */
    function targets() {
      return dates().filter(function (iso) { return !hasLeave(iso, draft.member); });
    }
    function paintPreview() {
      var all = dates(), list = targets();
      var filled = list.filter(function (iso) {
        return plansOf(iso, draft.member, 'plan').length > 0 || plansOf(iso, draft.member, 'result').length > 0;
      });
      preview.textContent = !all.length ? '対象日がありません（期間を確認してください）'
        : '対象日 ' + all.length + ' 日（' + all.slice(0, 4).map(U.fmtDate).join('・') + (all.length > 4 ? ' …' : '') + '）'
          + ' → 「' + type().label + '」' + (hours() === null ? '?' : fmtH(hours())) + 'h を ' + list.length + ' 件登録します'
          + (all.length > list.length ? '（休暇を登録済みの ' + (all.length - list.length) + ' 日は除く）' : '')
          + (filled.length ? '。' + filled.map(U.fmtDate).join('・') + ' は入力済みの予定・実績があります（そのまま残ります）' : '');
    }

    var memberSel = U.el('select', {
      disabled: !admin, onchange: function () { draft.member = this.value || null; paintPreview(); }
    });
    (admin ? State.members() : [draft.member]).forEach(function (m) {
      memberSel.appendChild(U.el('option', { value: m, text: m, selected: m === draft.member }));
    });
    memberSel.value = draft.member || '';
    field('担当者', memberSel, true);
    var from = U.el('input', { type: 'date', value: draft.from });
    var to = U.el('input', { type: 'date', value: draft.to });
    from.addEventListener('change', function () {
      draft.from = this.value || null;
      // 開始日を終了日より後にしたら終了日も合わせる
      if (draft.from && draft.to && draft.from > draft.to) { draft.to = draft.from; to.value = draft.to; }
      paintPreview();
    });
    to.addEventListener('change', function () { draft.to = this.value || null; paintPreview(); });
    field('開始日', from);
    field('終了日', to, false, '1 日だけなら開始日と同じ日');
    // 時間休を選んだときだけ、区分の右に時間の欄を出す
    var hourInput = U.el('input', {
      type: 'number', class: 'num', min: '1', max: String(hourLeaveMax()), step: '1', value: String(draft.hourCount),
      style: { width: '64px' }, title: '時間休の時間（1 時間単位）'
    });
    hourInput.addEventListener('input', function () { draft.hourCount = U.num(this.value); paintPreview(); });
    var hourBox = U.el('span', { class: 'row-flex', style: { gap: '4px', flex: '0 0 auto', flexWrap: 'nowrap', display: 'none' } }, [hourInput, document.createTextNode('h')]);
    var typeSel = U.el('select', {
      style: { flex: '1 1 auto', minWidth: '0' },
      onchange: function () {
        draft.type = this.value;
        hourBox.style.display = type().ratio === null ? '' : 'none';
        paintPreview();
      }
    });
    LEAVE_TYPES.forEach(function (t) { typeSel.appendChild(U.el('option', { value: t.value, text: t.label })); });
    field('区分', U.el('div', { class: 'row-flex', style: { gap: '8px', flexWrap: 'nowrap' } }, [typeSel, hourBox]), false,
      '半日休は基準時間の半分（' + fmtH(dayTarget() / 2) + 'h）、時間休は 1〜' + hourLeaveMax() + 'h（1 時間単位）で登録します。残りの作業は通常どおり入力してください');
    var weekend = U.el('input', { type: 'checkbox', checked: true });
    weekend.addEventListener('change', function () { draft.skipWeekend = this.checked; paintPreview(); });
    field('土日', U.el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 'normal', cursor: 'pointer' } },
      [weekend, document.createTextNode('土日を除く')]));
    var note = U.el('input', { type: 'text', placeholder: '例）夏季休暇' });
    note.addEventListener('input', function () { draft.note = this.value.trim() || null; });
    field('備考', note, true);
    grid.appendChild(U.el('div', { class: 'field span2' }, [preview]));
    paintPreview();

    var busy = false;
    U.openDrawer('🏖 休暇登録', grid, [
      U.el('span', { class: 'muted', text: '終日休暇の日は終業前入力が不要（済）になります。取り消しは日次入力の休暇の行の ✕ から' }),
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }),
      U.el('button', {
        class: 'btn btn-primary', text: '登録', onclick: function () {
          if (busy) return;
          if (!draft.member) { U.toast('担当者を選択してください', 'warn'); return; }
          if (!draft.from || !draft.to || draft.from > draft.to) { U.toast('開始日・終了日を確認してください', 'warn'); return; }
          if (U.diffDays(U.parseDate(draft.from), U.parseDate(draft.to)) >= SERIES_MAX_DAYS) {
            U.toast('期間は最長 1 年です', 'warn'); return;
          }
          var h = hours();
          if (type().ratio === null && !(h >= 1 && h <= hourLeaveMax() && h === Math.floor(h))) {
            U.toast('時間休は 1〜' + hourLeaveMax() + ' の整数（1 時間単位）で入力してください', 'warn'); return;
          }
          var list = targets();
          if (!list.length) { U.toast('登録する日がありません（対象日なし、またはすべて休暇を登録済みです）', 'warn'); return; }
          busy = true;
          U.loading(true);
          API.addPlan({
            kind: 'plan', member: draft.member, status: '予定', allDay: true,
            category: LEAVE, title: type().label, hours: hours(), note: draft.note, dates: list
          })
            .then(function (r) {
              U.toast('休暇を ' + ((r && r.added) || list.length) + ' 日分登録しました', 'ok');
              U.closeDrawer();
              return State.reloadPlans();
            })
            .then(function () { onSaved && onSaved(); })
            .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
            .finally(function () { busy = false; U.loading(false); });
        }
      })
    ]);
  }

  /* 定例予定のうち、指定した記録の日以降の予定をまとめて削除する（実績は残す） */
  function deleteSeries(base, done) {
    var admin = State.isAdmin();
    var targets = (State.plans || []).filter(function (p) {
      return p.seriesId === base.seriesId && kindOf(p) === 'plan' && (p.date || '') >= base.date
        && (admin || p.member === base.member);
    });
    var people = U.uniq(targets.map(function (p) { return p.member; }));
    U.confirmDialog('定例予定の削除',
      '定例予定「' + (base.title || base.category || '') + '」の ' + U.fmtDate(base.date) + ' 以降の予定 '
      + targets.length + ' 件' + (people.length > 1 ? '（' + people.length + ' 名分）' : '')
      + 'を削除します。入力済みの実績は残ります。', '削除する')
      .then(function (ok) {
        if (!ok) return;
        U.loading(true);
        API.planBulk('delete', targets.map(function (p) { return p.id; }))
          .then(function (r) { U.toast('定例予定を ' + ((r && r.removed) || 0) + ' 件削除しました', 'ok'); return State.reloadPlans(); })
          .then(function () { done && done(); })
          .catch(function (e) { U.toast('エラー: ' + e.message, 'err', 5000); })
          .finally(function () { U.loading(false); });
      });
  }

  Views.planInput._recurring = recurringEditor;
  Views.planInput._leave = leaveEditor;
  Views.planInput._editor = planEditor;
  Views.planInput._kindOf = kindOf;
  Views.planInput._PHASE = PHASE;
})(window);
