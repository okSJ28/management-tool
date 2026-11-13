/* ============================================================
   form.js - タスク編集フォーム + クライアント側の指標計算
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------------------------------------- 指標計算(サーバと同一式) */
  var Calc = {
    compute: function (t) {
      var s = State.settings();
      var n = function (k) { return U.num(t[k]) || 0; };
      var has = function (k) { return U.num(t[k]) !== null; };
      var r = function (v, d) { return (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d); };
      var div = function (a, b) { return (a === null || !b) ? null : a / b; };

      if (t.type === 'dd') {
        var hours = n('hourDesign'), pages = n('pages'), issues = n('issues');
        t.totalHour = has('hourDesign') ? r(hours, 2) : null;
        t.issueTotal = has('issues') ? issues : null;
        t.pagePerHour = r(div(pages, hours), 2);
        t.issuePerPage = r(div(issues, pages), 2);
        ['convStep', 'testRatio', 'prodNew', 'prodMod', 'prodMonth', 'quality', 'defectRate']
          .forEach(function (k) { t[k] = null; });
      } else {
        var base = n('baseStep'), nw = n('newStep'), md = n('modStep');
        // Excel と同じく区分で式を切り替える（新規以外は修正扱い）
        var isNew = String(t.kubun || '').trim() === '新規';
        var conv = isNew ? nw * s.newCoef : base * s.baseCoef + md * s.modCoef;
        t.convStep = (base || nw || md) ? r(conv, 2) : null;
        var mk = n('hourMake'), ck = n('hourCheck'), vf = n('hourVerify');
        var total = mk + ck + vf;
        var anyHour = has('hourMake') || has('hourCheck') || has('hourVerify');
        t.totalHour = anyHour ? r(total, 2) : null;
        t.testRatio = r(div((ck + vf) * 100, total), 1);
        t.prodNew = nw ? r(div(nw, mk), 2) : null;
        t.prodMod = md ? r(div(md, mk), 2) : null;
        t.prodMonth = r(div((isNew ? nw : md) * s.monthHours, total), 1);
        var it = n('issueCode') + n('issueCheck') + n('issueVerify');
        var anyIssue = has('issueCode') || has('issueCheck') || has('issueVerify');
        t.issueTotal = anyIssue ? it : null;
        t.quality = r(div(it * 1000, conv), 2);
        t.defectRate = r(div(n('defect') * 1000, conv), 2);
        t.pagePerHour = null; t.issuePerPage = null;
      }
      var sd = U.parseDate(t.startDate), ed = U.parseDate(t.endDate);
      t.durationDays = (sd && ed && ed >= sd) ? U.diffDays(sd, ed) + 1 : null;
      t.effectiveStatus = Calc.effectiveStatus(t);
      t.isLate = Calc.isLate(t);
      return t;
    },
    effectiveStatus: function (t) {
      if (t.status) return t.status;
      var E = State.enums.status, td = U.iso(U.today());
      if (t.endDate && t.endDate < td) return E.done;
      if (t.startDate && t.startDate <= td && (!t.endDate || t.endDate >= td)) return E.doing;
      if (t.startDate && t.startDate > td) return E.todo;
      return t.endDate ? E.doing : E.todo;
    },
    isLate: function (t) {
      var E = State.enums.status;
      var st = t.effectiveStatus || Calc.effectiveStatus(t);
      if (st === E.done || st === E.na) return false;
      return !!(t.endDate && t.endDate < U.iso(U.today()));
    }
  };

  /* ---------------------------------------------- 入力コントロール */
  function datalistFor(field) {
    var id = 'dl_' + field.key;
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var dl = U.el('datalist', { id: id });
    State.options(field.key).forEach(function (o) { dl.appendChild(U.el('option', { value: o })); });
    document.body.appendChild(dl);
    return id;
  }

  function control(field, value, onChange) {
    var input;
    if (field.type === 'select') {
      input = U.el('select');
      input.appendChild(U.el('option', { value: '', text: '—' }));
      State.options(field.key).forEach(function (o) {
        var label = field.key === 'type' ? State.typeLabel(o) : o;
        input.appendChild(U.el('option', { value: o, text: label, selected: String(value || '') === String(o) }));
      });
      input.value = value || '';
    } else if (field.type === 'select-free') {
      input = U.el('input', { type: 'text', list: datalistFor(field), value: value === null || value === undefined ? '' : value });
    } else if (field.type === 'textarea') {
      input = U.el('textarea', { text: value || '' });
    } else if (field.type === 'number') {
      input = U.el('input', { type: 'number', step: 'any', value: value === null || value === undefined ? '' : value });
    } else if (field.type === 'date') {
      input = U.el('input', { type: 'date', value: value || '' });
    } else if (field.type === 'calc') {
      input = U.el('input', { type: 'text', readonly: true, tabindex: '-1', placeholder: '自動計算', title: '自動計算項目（入力不要）', value: value === null || value === undefined ? '' : U.fmtNum(value, field.decimals) });
    } else {
      input = U.el('input', { type: 'text', value: value === null || value === undefined ? '' : value });
    }
    if (field.readonly && field.type !== 'calc') input.setAttribute('disabled', '');
    if (onChange && field.type !== 'calc') {
      input.addEventListener('input', function () { onChange(readValue(field, input)); });
      input.addEventListener('change', function () { onChange(readValue(field, input)); });
    }
    return input;
  }

  function readValue(field, input) {
    var v = input.value;
    if (field.type === 'number') return v === '' ? null : U.num(v);
    return v === '' ? null : v;
  }

  /* ---------------------------------------------- 実績の項目 */
  // 実績入力で開くグループ（規模・品質・工数）
  var ACTUAL_GROUPS = ['scale', 'quality', 'effort'];

  function isNewKubun(task) { return String(task.kubun || '').trim() === State.enums.kubun.new; }

  /* 実績として入れる項目。製造の step は区分で変わる（新規: 新規step ／ それ以外: 母体step・修正step） */
  function actualKeys(task) {
    if (task.type === 'dd') return ['pages', 'issues', 'hourDesign'];
    var steps = isNewKubun(task) ? ['newStep'] : ['baseStep', 'modStep'];
    return steps.concat(['issueCode', 'issueCheck', 'issueVerify', 'hourMake', 'hourCheck', 'hourVerify']);
  }

  /* 工数が 1 つも入っていなければ実績未入力 */
  function needsActual(task) { return U.num(task.totalHour) === null; }

  /* 区分で使わない step 欄（区分が未選択なら無し）。新規: 母体step・修正step ／ 新規以外: 新規step */
  function unusedStepKeys(task) {
    if (task.type !== 'mfg' || !task.kubun) return [];
    return isNewKubun(task) ? ['baseStep', 'modStep'] : ['newStep'];
  }

  /* 保存前の入力チェック。問題があればメッセージ、なければ null（プログラムID・案件名は前後の空白を除く） */
  function validate(t) {
    ['programId', 'project'].forEach(function (k) { if (typeof t[k] === 'string') t[k] = t[k].trim() || null; });
    var missing = State.fieldsOf(t.type).filter(function (f) { return f.required && !t[f.key]; })[0];
    if (missing) return missing.label + 'を入力してください（プログラムID・案件名は両方とも必須です）';
    var neg = State.fieldsOf(t.type).filter(function (f) {
      return f.type === 'number' && U.num(t[f.key]) !== null && U.num(t[f.key]) < 0;
    })[0];
    if (neg) return neg.label + 'は 0 以上の数値で入力してください';
    if (U.num(t.progress) !== null && U.num(t.progress) > 100) return '進捗率は 0〜100 で入力してください';
    if (t.startDate && t.endDate && t.endDate < t.startDate) return '終了日が開始日より前になっています';
    return null;
  }

  /* ---------------------------------------------- フォーム本体 */
  function buildForm(task, opts) {
    opts = opts || {};
    var draft = Object.assign({}, task);
    var wrap = U.el('div');
    var calcValues = {};
    var cells = {};
    var inputs = {};
    var sections = [];

    function isBlank(v) { return v === null || v === undefined || v === ''; }

    function rebuildCalc() {
      Calc.compute(draft);
      Object.keys(calcValues).forEach(function (k) {
        var f = State.field(k);
        var v = draft[k];
        calcValues[k].textContent = (v === null || v === undefined) ? '—' : U.fmtNum(v, f.decimals);
      });
      // 区分で使わない step 欄は「入力不要」にして入力できなくする（値が残っていれば保存時に消す）
      var unused = unusedStepKeys(draft);
      ['baseStep', 'newStep', 'modStep'].forEach(function (k) {
        if (!cells[k]) return;
        var off = unused.indexOf(k) >= 0;
        cells[k].classList.toggle('field-na', off);
        cells[k].title = off ? '区分が「' + draft.kubun + '」のときは入力不要です' : '';
        inputs[k].disabled = off;
        inputs[k].placeholder = off ? '入力不要（区分：' + draft.kubun + '）' : '';
        cells[k].querySelector('.na-badge').textContent = off && !isBlank(draft[k]) ? '入力不要（保存時に消去）' : '入力不要';
      });
      // 見出しごとの入力済みの数（薄く表示している step 欄は数えない）
      sections.forEach(function (sec) {
        var keys = sec.keys.filter(function (k) { return unused.indexOf(k) < 0; });
        var done = keys.filter(function (k) { return !isBlank(draft[k]); }).length;
        sec.count.textContent = '入力済み ' + done + '/' + keys.length;
        sec.count.classList.toggle('done', done === keys.length);
      });
      // 空いている必須欄（プログラムID・案件名）と、実績入力では空いている実績の欄に色を付ける
      var need = Object.keys(cells).filter(function (k) {
        return State.field(k).required && isBlank(typeof draft[k] === 'string' ? draft[k].trim() : draft[k]);
      });
      if (opts.highlightActual) need = need.concat(actualKeys(draft).filter(function (k) { return isBlank(draft[k]); }));
      Object.keys(cells).forEach(function (k) { cells[k].classList.toggle('field-need', need.indexOf(k) >= 0); });
    }

    var typeField = U.el('div', { class: 'field span2' }, [
      U.el('label', { text: '種別' }),
      (function () {
        var seg = U.el('div', { class: 'seg' });
        State.schema.types.forEach(function (t) {
          seg.appendChild(U.el('button', {
            type: 'button', class: draft.type === t.key ? 'on' : '', text: t.label,
            onclick: function () {
              if (draft.type === t.key) return;
              draft.type = t.key;
              var body = buildForm(draft, opts);
              wrap.replaceWith(body.node);
              opts.onRebuild && opts.onRebuild(body);
            }
          }));
        });
        return seg;
      })()
    ]);

    function fieldCell(f) {
      var cell = U.el('div', { class: 'field' + (f.type === 'textarea' || f.key === 'project' ? ' span2' : '') });
      var isStep = f.key === 'baseStep' || f.key === 'newStep' || f.key === 'modStep';
      cell.appendChild(U.el('label', {}, [
        document.createTextNode(f.label),
        f.required ? U.el('span', { class: 'req-badge', title: '必ず入力してください', text: '必須' }) : null,
        isStep ? U.el('span', { class: 'na-badge', text: '入力不要' }) : null
      ]));
      var input = control(f, draft[f.key], function (v) {
        draft[f.key] = v;
        rebuildCalc();
        opts.onChange && opts.onChange(draft);
      });
      inputs[f.key] = input;
      // 単位（step / h / 件 など）は入力欄の右端に出す
      cell.appendChild(f.unit ? U.el('div', { class: 'input-unit' }, [input, U.el('span', { class: 'unit', text: f.unit })]) : input);
      if (f.help) cell.appendChild(U.el('div', { class: 'hint', text: f.help }));
      cells[f.key] = cell;
      return cell;
    }

    var grid = U.el('div', { class: 'form-grid' });
    if (!opts.hideType) grid.appendChild(typeField);

    // 自動計算の項目は入力欄にせず下の「計算結果」にまとめ、使われていない項目（fold）は折りたたむ
    var fields = State.fieldsOf(draft.type).filter(function (f) { return f.key !== 'type' && f.type !== 'calc'; });
    var NUM = '①②③④⑤⑥⑦⑧⑨';
    State.schema.groups.forEach(function (group) {
      if (opts.groups && opts.groups.indexOf(group.key) < 0) return;
      var list = fields.filter(function (f) { return f.group === group.key && !f.fold; });
      if (!list.length) return;
      var count = U.el('span', { class: 'fs-count' });
      grid.appendChild(U.el('div', { class: 'fieldset-title' }, [
        document.createTextNode(NUM.charAt(sections.length) + ' ' + group.label), count
      ]));
      sections.push({ keys: list.map(function (f) { return f.key; }), count: count });
      list.forEach(function (f) { grid.appendChild(fieldCell(f)); });
    });
    wrap.appendChild(grid);

    var folded = opts.groups ? [] : fields.filter(function (f) { return f.fold; });
    if (folded.length) {
      var filled = folded.filter(function (f) { return draft[f.key] !== null && draft[f.key] !== undefined && draft[f.key] !== ''; }).length;
      var moreGrid = U.el('div', { class: 'form-grid' });
      folded.forEach(function (f) { moreGrid.appendChild(fieldCell(f)); });
      wrap.appendChild(U.el('details', { class: 'form-more' }, [
        U.el('summary', {}, [
          document.createTextNode('その他の項目（' + folded.map(function (f) { return f.label; }).join('・') + '）'),
          filled ? U.el('span', { class: 'form-more-count', text: '入力あり ' + filled + ' 件' }) : null
        ]),
        moreGrid
      ]));
    }

    var calcFields = State.fieldsOf(draft.type).filter(function (f) { return f.type === 'calc'; });
    if (calcFields.length) {
      var calcGrid = U.el('div', { class: 'calc-grid' });
      calcFields.forEach(function (f) {
        calcValues[f.key] = U.el('b', { class: 'mono' });
        calcGrid.appendChild(U.el('div', { class: 'calc-item', title: f.help || '' }, [U.el('span', { text: f.label }), calcValues[f.key]]));
      });
      wrap.appendChild(U.el('div', { class: 'calc-panel' }, [
        U.el('div', { class: 'calc-title', text: '計算結果（入力に合わせて自動計算・入力不要）' }),
        calcGrid
      ]));
    }

    rebuildCalc();
    return { node: wrap, draft: draft, refresh: rebuildCalc };
  }

  /* ---------------------------------------------- 編集ドロワー */
  /* opts.mode === 'actual' のときは実績（規模・品質・工数）だけを入力するフォームで開く */
  function openEditor(task, onSaved, opts) {
    opts = opts || {};
    var isNew = !task || !task.id;
    var actualMode = !isNew && opts.mode === 'actual';
    var base = task || { type: 'mfg', status: '', progress: null };
    // 新規登録の担当者①は、ログイン中の人が担当者ならその人を初期値にする
    if (isNew && !base.assignee1 && State.members().indexOf(State.user()) >= 0) {
      base = Object.assign({}, base, { assignee1: State.user() });
    }
    var form = buildForm(base, actualMode
      ? { hideType: true, groups: ACTUAL_GROUPS, highlightActual: true }
      : { onRebuild: function (b) { form = b; } });
    var foot = [];
    var saving = false;

    function save() {
      if (saving) return;
      var d = form.draft;
      // 区分で使わない step の値は残さない（分析の新規step・修正step 合計に混ざらないように）
      unusedStepKeys(d).forEach(function (k) { d[k] = null; });
      var msg = validate(d);
      if (msg) {
        U.toast(msg + (actualMode && /プログラムID|案件名/.test(msg) ? '。「すべての項目を編集」から入力してください' : ''), 'warn');
        form.refresh();
        return;
      }
      saving = true;
      U.loading(true);
      var p = isNew ? API.addTask(d) : API.updateTask(d.id, Object.assign({}, d, { _baseUpdatedAt: base.updatedAt || null }));
      p.then(function () {
        U.toast(isNew ? '登録しました' : '更新しました', 'ok');
        U.closeDrawer();
        return State.reload();
      }).then(function () { onSaved && onSaved(); })
        .catch(function (e) { saving = false; U.toast('エラー: ' + e.message, 'err'); })
        .finally(function () { U.loading(false); });
    }

    if (actualMode) foot.push(U.el('button', {
      class: 'btn', text: 'すべての項目を編集', onclick: function () {
        var draft = form.draft;
        U.closeDrawer();
        setTimeout(function () { openEditor(draft, onSaved); }, 60);
      }
    }));
    if (!actualMode) foot.push(U.el('button', {
      class: 'btn', text: '複製して新規', onclick: function () {
        var copy = Object.assign({}, form.draft);
        delete copy.id; delete copy.createdAt; delete copy.updatedAt;
        U.closeDrawer();
        setTimeout(function () { openEditor(copy, onSaved); }, 60);
      }
    }));
    if (!isNew && !actualMode) {
      foot.push(U.el('button', {
        class: 'btn btn-danger', text: '削除', onclick: function () {
          U.confirmDialog('削除確認', (form.draft.programId || '') + ' を削除します。よろしいですか？', '削除する')
            .then(function (ok) {
              if (!ok) return;
              return API.deleteTask(form.draft.id).then(function () {
                U.toast('削除しました', 'ok'); U.closeDrawer();
                return State.reload().then(function () { onSaved && onSaved(); });
              });
            });
        }
      }));
    }
    foot.push(U.el('div', { class: 'spacer' }));
    foot.push(U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }));
    foot.push(U.el('button', { class: 'btn btn-primary', text: isNew ? '登録' : '保存', onclick: save }));

    var body = actualMode ? U.el('div', {}, [actualHeader(base), form.node]) : form.node;
    U.openDrawer(isNew ? '新規登録' : actualMode ? '実績入力' : ((base.programId || '') + ' を編集'), body, foot);

    document.addEventListener('keydown', function onKey(e) {
      // ドロワーを閉じた後に古いフォームが Ctrl+S で再保存されないようにする
      if (document.getElementById('drawer').hidden || !form.node.isConnected) {
        document.removeEventListener('keydown', onKey); return;
      }
      if (e.key === 'Escape') { U.closeDrawer(); document.removeEventListener('keydown', onKey); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    });
  }

  /* 実績入力の上に出す、どのタスクかの見出し（編集不可） */
  function actualHeader(task) {
    var info = [
      ['区分', task.kubun], ['リソース区分', task.resource], ['システム', task.system],
      ['担当者', [task.assignee1, task.assignee2].filter(Boolean).join('・')],
      ['期間', [task.startDate, task.endDate].filter(Boolean).map(U.fmtDateFull).join(' 〜 ')]
    ].filter(function (x) { return x[1]; });
    return U.el('div', { class: 'actual-head' }, [
      U.el('div', { class: 'row-flex' }, [
        U.el('span', { class: 'tag', text: State.typeLabel(task.type) }),
        U.el('b', { class: 'mono', style: { fontSize: '15px' }, text: task.programId || '(ID未設定)' })
      ]),
      task.project ? U.el('div', { class: 'muted', text: task.project }) : null,
      U.el('div', { class: 'actual-meta' }, info.map(function (x) {
        return U.el('span', {}, [U.el('span', { class: 'muted', text: x[0] + ' ' }), document.createTextNode(x[1])]);
      })),
      U.el('div', { class: 'hint', text: 'オレンジ枠の欄が未入力の実績です。入力して保存してください。区分で使わない step 欄は「入力不要」になります。' })
    ]);
  }

  /* ---------------------------------------------- 参照ドロワー */
  function openViewer(task, onSaved) {
    var body = U.el('div');
    var head = U.el('div', { class: 'row-flex', style: { marginBottom: '10px' } }, [
      statusChip(task.effectiveStatus),
      U.el('span', { class: 'tag', text: State.typeLabel(task.type) }),
      task.kubun ? U.el('span', { class: 'tag', text: task.kubun }) : null,
      task.isLate ? U.el('span', { class: 'chip', style: { background: 'var(--danger-soft)', color: 'var(--danger)' }, text: '遅延' }) : null
    ]);
    body.appendChild(head);
    body.appendChild(U.el('h2', { text: task.programId || '(ID未設定)', style: { fontSize: '19px', marginBottom: '2px' } }));
    body.appendChild(U.el('div', { class: 'muted', text: task.project || '' }));

    State.schema.groups.forEach(function (group) {
      var fields = State.fieldsOf(task.type).filter(function (f) {
        return f.group === group.key && f.key !== 'type' && task[f.key] !== null && task[f.key] !== undefined && task[f.key] !== '';
      });
      if (!fields.length) return;
      var tbl = U.el('table', { class: 'grid-table', style: { marginTop: '6px' } });
      var tb = U.el('tbody');
      fields.forEach(function (f) {
        tb.appendChild(U.el('tr', {}, [
          U.el('td', { style: { width: '46%', color: 'var(--text-2)' }, text: f.label }),
          U.el('td', { class: f.type === 'number' || f.type === 'calc' ? 'num' : '', text: displayValue(task, f) })
        ]));
      });
      tbl.appendChild(tb);
      body.appendChild(U.el('div', { class: 'fieldset-title', text: group.label, style: { marginTop: '14px' } }));
      body.appendChild(tbl);
    });

    U.openDrawer('詳細', body, [
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: '閉じる', onclick: U.closeDrawer }),
      U.el('button', {
        class: 'btn btn-primary', text: '編集', onclick: function () {
          U.closeDrawer(); setTimeout(function () { openEditor(task, onSaved); }, 60);
        }
      })
    ]);
  }

  function displayValue(task, field) {
    var v = task[field.key];
    if (v === null || v === undefined || v === '') return '';
    if (field.type === 'date') return U.fmtDateFull(v);
    if (field.type === 'number' || field.type === 'calc') return U.fmtNum(v, field.decimals);
    if (field.key === 'type') return State.typeLabel(v);
    return String(v);
  }

  function statusChip(value) {
    var color = State.statusColor(value);
    return U.el('span', {
      class: 'chip dot',
      style: { background: color + '1f', color: color }, text: value || '—'
    });
  }

  global.Calc = Calc;
  global.Form = {
    buildForm: buildForm, openEditor: openEditor, openViewer: openViewer,
    actualKeys: actualKeys, needsActual: needsActual, unusedStepKeys: unusedStepKeys, validate: validate,
    statusChip: statusChip, displayValue: displayValue, control: control, readValue: readValue
  };
})(window);
