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

  /* ---------------------------------------------- フォーム本体 */
  function buildForm(task, opts) {
    opts = opts || {};
    var draft = Object.assign({}, task);
    var wrap = U.el('div');
    var calcInputs = {};

    function rebuildCalc() {
      Calc.compute(draft);
      Object.keys(calcInputs).forEach(function (k) {
        var f = State.field(k);
        var v = draft[k];
        calcInputs[k].value = (v === null || v === undefined) ? '' : U.fmtNum(v, f.decimals);
      });
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

    var grid = U.el('div', { class: 'form-grid' });
    if (!opts.hideType) grid.appendChild(typeField);

    State.schema.groups.forEach(function (group) {
      var fields = State.fieldsOf(draft.type).filter(function (f) {
        return f.group === group.key && f.key !== 'type';
      });
      if (!fields.length) return;
      grid.appendChild(U.el('div', { class: 'fieldset-title', text: group.label }));
      fields.forEach(function (f) {
        var cell = U.el('div', { class: 'field' + (f.type === 'textarea' || f.key === 'project' ? ' span2' : '') });
        cell.appendChild(U.el('label', {}, [
          document.createTextNode(f.label),
          f.required ? U.el('span', { class: 'req', text: '*' }) : null,
          (f.key === 'programId' || f.key === 'project') ? U.el('span', { class: 'req', text: '※プログラムID・案件名のどちらか必須' }) : null,
          f.type === 'calc' ? U.el('span', { class: 'hint', text: ' (自動)' }) : null
        ]));
        var input = control(f, draft[f.key], function (v) {
          draft[f.key] = v;
          rebuildCalc();
          opts.onChange && opts.onChange(draft);
        });
        if (f.type === 'calc') calcInputs[f.key] = input;
        cell.appendChild(input);
        if (f.help) cell.appendChild(U.el('div', { class: 'hint', text: f.help }));
        grid.appendChild(cell);
      });
    });

    wrap.appendChild(grid);
    rebuildCalc();
    return { node: wrap, draft: draft, refresh: rebuildCalc };
  }

  /* ---------------------------------------------- 編集ドロワー */
  function openEditor(task, onSaved) {
    var isNew = !task || !task.id;
    var base = task || { type: 'mfg', status: '', progress: null };
    var form = buildForm(base, { onRebuild: function (b) { form = b; } });
    var foot = [];
    var saving = false;

    function save() {
      if (saving) return;
      var d = form.draft;
      if (!d.programId && !d.project) { U.toast('プログラムIDまたは案件名のどちらかを入力してください', 'warn'); return; }
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

    foot.push(U.el('button', {
      class: 'btn', text: '複製して新規', onclick: function () {
        var copy = Object.assign({}, form.draft);
        delete copy.id; delete copy.createdAt; delete copy.updatedAt;
        U.closeDrawer();
        setTimeout(function () { openEditor(copy, onSaved); }, 60);
      }
    }));
    if (!isNew) {
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

    U.openDrawer(isNew ? '新規登録' : ((base.programId || '') + ' を編集'), form.node, foot);

    document.addEventListener('keydown', function onKey(e) {
      // ドロワーを閉じた後に古いフォームが Ctrl+S で再保存されないようにする
      if (document.getElementById('drawer').hidden || !form.node.isConnected) {
        document.removeEventListener('keydown', onKey); return;
      }
      if (e.key === 'Escape') { U.closeDrawer(); document.removeEventListener('keydown', onKey); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    });
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
    statusChip: statusChip, displayValue: displayValue, control: control, readValue: readValue
  };
})(window);
