/* ============================================================
   views/tasks.js - 一覧（検索・絞り込み・インライン編集）
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var F = {
    type: 'mfg', keyword: '', assignee: '', project: '', status: '', kubun: '',
    resource: '', system: '', from: '', to: '', quick: '', sortKey: 'endDate', sortAsc: false
  };
  var selected = new Set();
  var columns = {};

  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem('dpm.tasks') || '{}');
      Object.assign(F, saved.filter || {});
      columns = saved.columns || {};
    } catch (e) { /* ignore */ }
  }
  function savePrefs() {
    try { localStorage.setItem('dpm.tasks', JSON.stringify({ filter: F, columns: columns })); } catch (e) { /* ignore */ }
  }

  function effectiveType() { return F.type === 'all' ? 'mfg' : F.type; }

  function activeColumns() {
    var type = effectiveType();
    if (!columns[type]) columns[type] = State.schema.tableColumns[type].slice();
    return columns[type];
  }

  function filtered() {
    var E = State.enums.status;
    var kw = (F.keyword || '').toLowerCase();
    var globalKw = (State.search || '').toLowerCase();
    return State.tasks.filter(function (t) {
      if (F.type !== 'all' && t.type !== F.type) return false;
      if (F.assignee && t.assignee1 !== F.assignee && t.assignee2 !== F.assignee) return false;
      if (F.project && t.project !== F.project) return false;
      if (F.status && t.effectiveStatus !== F.status) return false;
      if (F.kubun && t.kubun !== F.kubun) return false;
      if (F.resource && t.resource !== F.resource) return false;
      if (F.system && t.system !== F.system) return false;
      if (F.from && (t.endDate || t.startDate || '') < F.from) return false;
      if (F.to && (t.startDate || t.endDate || '9999') > F.to) return false;
      if (F.quick === 'late' && !t.isLate) return false;
      if (F.quick === 'doing' && !(t.effectiveStatus === E.doing || t.effectiveStatus === E.review)) return false;
      if (F.quick === 'todo' && t.effectiveStatus !== E.todo) return false;
      if (F.quick === 'nohour' && t.totalHour) return false;
      if (kw || globalKw) {
        var hay = [t.programId, t.project, t.assignee1, t.assignee2, t.resource, t.system, t.note, t.tags]
          .filter(Boolean).join(' ').toLowerCase();
        if (kw && hay.indexOf(kw) < 0) return false;
        if (globalKw && hay.indexOf(globalKw) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      var f = State.field(F.sortKey);
      var av = a[F.sortKey], bv = b[F.sortKey];
      if (f.type === 'number' || f.type === 'calc') {
        av = U.num(av); bv = U.num(bv);
        av = av === null ? -Infinity : av; bv = bv === null ? -Infinity : bv;
      } else {
        av = av === null || av === undefined ? '' : String(av);
        bv = bv === null || bv === undefined ? '' : String(bv);
      }
      var r = av < bv ? -1 : av > bv ? 1 : 0;
      return F.sortAsc ? r : -r;
    });
  }

  /* --------------------------------------------------- フィルタバー */
  function buildFilterBar(rerender) {
    var bar = U.el('div', { class: 'filterbar' });

    var seg = U.el('div', { class: 'seg' });
    State.schema.types.concat([{ key: 'all', label: 'すべて' }]).forEach(function (t) {
      seg.appendChild(U.el('button', {
        class: F.type === t.key ? 'on' : '', text: t.label,
        onclick: function () { F.type = t.key; selected.clear(); savePrefs(); rerender(); }
      }));
    });
    bar.appendChild(seg);

    function sel(label, key, options, formatter) {
      var s = U.el('select', { onchange: function () { F[key] = this.value; savePrefs(); rerender(); } });
      s.appendChild(U.el('option', { value: '', text: '(すべて)' }));
      options.forEach(function (o) {
        s.appendChild(U.el('option', { value: o, text: formatter ? formatter(o) : o, selected: F[key] === o }));
      });
      s.value = F[key] || '';
      bar.appendChild(U.el('div', { class: 'fld' }, [U.el('label', { text: label }), s]));
    }

    bar.appendChild(U.el('div', { class: 'fld' }, [
      U.el('label', { text: 'キーワード' }),
      U.el('input', {
        type: 'search', value: F.keyword, placeholder: 'ID / 案件 / 備考',
        style: { minWidth: '190px' },
        oninput: U.debounce(function () { F.keyword = this.value; savePrefs(); rerender(true); }, 260)
      })
    ]));
    sel('担当者', 'assignee', State.members());
    sel('案件', 'project', State.projects());
    sel('ステータス', 'status', State.options('status'));
    sel('区分', 'kubun', State.options('kubun'));
    sel('リソース区分', 'resource', U.uniq(State.tasks.map(function (t) { return t.resource; })).sort());

    bar.appendChild(U.el('div', { class: 'fld' }, [
      U.el('label', { text: '期間 開始' }),
      U.el('input', { type: 'date', value: F.from, onchange: function () { F.from = this.value; savePrefs(); rerender(); } })
    ]));
    bar.appendChild(U.el('div', { class: 'fld' }, [
      U.el('label', { text: '期間 終了' }),
      U.el('input', { type: 'date', value: F.to, onchange: function () { F.to = this.value; savePrefs(); rerender(); } })
    ]));

    var quick = U.el('div', { class: 'fld' }, [U.el('label', { text: 'クイック' })]);
    var qseg = U.el('div', { class: 'seg' });
    [['', 'なし'], ['doing', '進行中'], ['todo', '予定'], ['late', '遅延'], ['nohour', '工数未入力']].forEach(function (q) {
      qseg.appendChild(U.el('button', {
        class: F.quick === q[0] ? 'on' : '', text: q[1],
        onclick: function () { F.quick = q[0]; savePrefs(); rerender(); }
      }));
    });
    quick.appendChild(qseg);
    bar.appendChild(quick);

    bar.appendChild(U.el('div', { class: 'spacer' }));
    bar.appendChild(U.el('button', {
      class: 'btn btn-sm', text: '⟲ 条件クリア', onclick: function () {
        Object.assign(F, { keyword: '', assignee: '', project: '', status: '', kubun: '', resource: '', system: '', from: '', to: '', quick: '' });
        savePrefs(); rerender();
      }
    }));
    bar.appendChild(U.el('button', { class: 'btn btn-sm', text: '⚙ 列表示', onclick: function () { openColumnChooser(rerender); } }));
    return bar;
  }

  function openColumnChooser(rerender) {
    var type = F.type === 'all' ? 'mfg' : F.type;
    var current = columns[type] || State.schema.tableColumns[type].slice();
    var box = U.el('div');
    box.appendChild(U.el('p', { class: 'muted', text: '一覧に表示する列を選択してください。' }));
    var grid = U.el('div', { class: 'col-chooser' });
    State.fieldsOf(type).forEach(function (f) {
      if (f.key === 'type') return;
      grid.appendChild(U.el('label', {}, [
        U.el('input', {
          type: 'checkbox', checked: current.indexOf(f.key) >= 0,
          onchange: function () {
            if (this.checked) { if (current.indexOf(f.key) < 0) current.push(f.key); }
            else { current = current.filter(function (k) { return k !== f.key; }); }
          }
        }),
        document.createTextNode(f.label)
      ]));
    });
    box.appendChild(grid);
    U.openDrawer('列表示設定', box, [
      U.el('button', {
        class: 'btn', text: '初期値に戻す', onclick: function () {
          delete columns[type]; savePrefs(); U.closeDrawer(); rerender();
        }
      }),
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }),
      U.el('button', {
        class: 'btn btn-primary', text: '適用', onclick: function () {
          columns[type] = current; savePrefs(); U.closeDrawer(); rerender();
        }
      })
    ]);
  }

  /* --------------------------------------------------- テーブル */
  function buildTable(rows, rerender) {
    var type = F.type === 'all' ? 'mfg' : F.type;
    var cols = activeColumns().filter(function (k) {
      return F.type === 'all' ? true : State.field(k).types.indexOf(type) >= 0;
    });
    var wrap = U.el('div', { class: 'table-wrap' });
    var table = U.el('table', { class: 'grid-table' });

    var thead = U.el('thead');
    var hr = U.el('tr');
    hr.appendChild(U.el('th', { style: { width: '30px' } }, [
      U.el('input', {
        type: 'checkbox',
        checked: rows.length > 0 && rows.every(function (t) { return selected.has(t.id); }),
        onchange: function () {
          var on = this.checked;
          rows.forEach(function (t) { on ? selected.add(t.id) : selected.delete(t.id); });
          rerender(true);
        }
      })
    ]));
    hr.appendChild(U.el('th', { style: { width: '38px' }, text: '#' }));
    if (F.type === 'all') hr.appendChild(U.el('th', { text: '種別' }));
    cols.forEach(function (key) {
      var f = State.field(key);
      hr.appendChild(U.el('th', {
        style: { minWidth: (f.width || 100) + 'px' },
        title: f.help || f.label,
        onclick: function () {
          if (F.sortKey === key) F.sortAsc = !F.sortAsc; else { F.sortKey = key; F.sortAsc = true; }
          savePrefs(); rerender();
        }
      }, [
        document.createTextNode(f.label),
        F.sortKey === key ? U.el('span', { class: 'sort', text: F.sortAsc ? '▲' : '▼' }) : null
      ]));
    });
    hr.appendChild(U.el('th', { style: { width: '40px' }, text: '' }));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = U.el('tbody');
    rows.forEach(function (t, i) {
      var tr = U.el('tr', { class: (selected.has(t.id) ? 'selected ' : '') + (t.isLate ? 'row-late' : '') });
      tr.appendChild(U.el('td', {}, [
        U.el('input', {
          type: 'checkbox', checked: selected.has(t.id),
          onclick: function (e) { e.stopPropagation(); },
          onchange: function () { this.checked ? selected.add(t.id) : selected.delete(t.id); rerender(true); }
        })
      ]));
      tr.appendChild(U.el('td', { class: 'muted', text: String(i + 1) }));
      if (F.type === 'all') tr.appendChild(U.el('td', {}, [U.el('span', { class: 'tag', text: State.typeLabel(t.type) })]));
      cols.forEach(function (key) {
        tr.appendChild(cellFor(t, key, rerender));
      });
      tr.appendChild(U.el('td', {}, [
        U.el('button', {
          class: 'icon-btn', text: '⋯', title: '詳細',
          onclick: function (e) { e.stopPropagation(); Form.openViewer(t, function () { App.render(); }); }
        })
      ]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    if (!rows.length) {
      wrap.appendChild(U.el('div', { class: 'empty', html: '<span class="big">🗂</span>該当するデータがありません' }));
    } else {
      wrap.appendChild(table);
    }
    return wrap;
  }

  function cellFor(task, key, rerender) {
    var f = State.field(key);
    var value = task[key];
    var isNum = f.type === 'number' || f.type === 'calc';
    var td = U.el('td', { class: (isNum ? 'num ' : '') + (f.type === 'calc' || f.readonly ? '' : 'editable') });

    if (key === 'status') {
      td.className = '';
      td.appendChild(Form.statusChip(task.effectiveStatus));
      if (task.isLate) td.appendChild(U.el('span', { class: 'chip', style: { background: 'var(--danger-soft)', color: 'var(--danger)', marginLeft: '4px' }, text: '遅延' }));
      td.className += ' editable';
    } else if (key === 'progress') {
      td.className = 'editable';
      var pct = U.num(value) || 0;
      td.appendChild(U.el('div', { class: 'row-flex' }, [
        U.el('div', { class: 'progress', style: { flex: 1 } }, [U.el('span', { style: { width: Math.min(100, pct) + '%' } })]),
        U.el('span', { class: 'muted mono', style: { width: '30px' }, text: pct + '%' })
      ]));
    } else if (key === 'programId') {
      td.className = 'editable strong mono';
      td.textContent = value === null || value === undefined ? '' : value;
    } else if (f.type === 'date') {
      td.textContent = U.fmtDateFull(value);
      td.style.fontFamily = 'var(--mono)';
    } else if (isNum) {
      td.textContent = value === null || value === undefined ? '' : U.fmtNum(value, f.decimals);
      if (key === 'quality' && U.num(value) > (State.settings().targetQuality || 50)) td.style.color = 'var(--danger)';
      if (key === 'prodMonth' && U.num(value) !== null) {
        td.style.color = U.num(value) >= (State.settings().targetProdMonth || 800) ? 'var(--ok)' : 'var(--text)';
      }
    } else if (key === 'project') {
      td.style.maxWidth = '300px';
      td.style.overflow = 'hidden';
      td.style.textOverflow = 'ellipsis';
      td.title = value || '';
      td.textContent = value || '';
    } else {
      td.textContent = value === null || value === undefined ? '' : String(value);
    }

    if (f.type !== 'calc' && !f.readonly) {
      td.addEventListener('dblclick', function () { startEdit(td, task, f, rerender); });
    }
    td.addEventListener('click', function (e) {
      if (e.detail === 1 && e.target === td && (f.type === 'calc' || f.readonly)) {
        Form.openViewer(task, function () { App.render(); });
      }
    });
    return td;
  }

  function startEdit(td, task, field, rerender) {
    var old = td.innerHTML;
    U.clear(td);
    var input = Form.control(field, task[field.key], null);
    input.className = 'cell-input';
    td.appendChild(input);
    input.focus();
    if (input.select) input.select();
    var done = false;
    function commit(save) {
      if (done) return; done = true;
      var v = save ? Form.readValue(field, input) : null;
      if (!save || v === task[field.key]) { td.innerHTML = old; return; }
      var patch = {}; patch[field.key] = v;
      U.loading(true);
      API.updateTask(task.id, patch).then(function (r) {
        Object.assign(task, r.task);
        U.toast('更新: ' + field.label, 'ok', 1400);
        return State.reload();
      }).then(function () { rerender(); })
        .catch(function (e) { U.toast('更新失敗: ' + e.message, 'err'); td.innerHTML = old; })
        .finally(function () { U.loading(false); });
    }
    input.addEventListener('blur', function () { commit(true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
  }

  /* --------------------------------------------------- 一括操作 */
  function buildBulkBar(rows, rerender) {
    if (!selected.size) return null;
    var ids = Array.from(selected);
    var bar = U.el('div', { class: 'filterbar', style: { background: 'var(--primary-soft)', borderColor: '#bfdbfe' } });
    bar.appendChild(U.el('strong', { text: ids.length + ' 件を選択中' }));

    var stSel = U.el('select', {});
    stSel.appendChild(U.el('option', { value: '', text: 'ステータス一括変更…' }));
    State.options('status').forEach(function (s) { stSel.appendChild(U.el('option', { value: s, text: s })); });
    stSel.addEventListener('change', function () {
      if (!this.value) return;
      applyPatch(ids, { status: this.value }, rerender);
    });
    bar.appendChild(stSel);

    var asSel = U.el('select', {});
    asSel.appendChild(U.el('option', { value: '', text: '担当者一括変更…' }));
    State.members().forEach(function (m) { asSel.appendChild(U.el('option', { value: m, text: m })); });
    asSel.addEventListener('change', function () {
      if (!this.value) return;
      applyPatch(ids, { assignee1: this.value }, rerender);
    });
    bar.appendChild(asSel);

    bar.appendChild(U.el('button', {
      class: 'btn btn-sm', text: 'CSV出力（選択分）', onclick: function () {
        location.href = '/api/export/csv?type=' + (F.type === 'all' ? 'mfg' : F.type) + '&ids=' + encodeURIComponent(ids.join(','));
      }
    }));
    bar.appendChild(U.el('div', { class: 'spacer' }));
    bar.appendChild(U.el('button', { class: 'btn btn-sm', text: '選択解除', onclick: function () { selected.clear(); rerender(true); } }));
    bar.appendChild(U.el('button', {
      class: 'btn btn-sm btn-danger', text: '削除', onclick: function () {
        U.confirmDialog('一括削除', ids.length + ' 件を削除します。元に戻せません。', '削除する').then(function (ok) {
          if (!ok) return;
          U.loading(true);
          API.bulk('delete', ids).then(function () {
            selected.clear(); U.toast('削除しました', 'ok'); return State.reload();
          }).then(function () { rerender(); })
            .catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        });
      }
    }));
    return bar;
  }

  function applyPatch(ids, patch, rerender) {
    U.loading(true);
    API.bulk('patch', ids, patch).then(function () {
      U.toast('一括更新しました', 'ok'); return State.reload();
    }).then(function () { rerender(); })
      .catch(function (e) { U.toast(e.message, 'err'); })
      .finally(function () { U.loading(false); });
  }

  /* --------------------------------------------------- サマリ */
  function buildSummary(rows) {
    var mfg = rows.filter(function (t) { return t.type === 'mfg'; });
    var dd = rows.filter(function (t) { return t.type === 'dd'; });
    var stats = [
      ['件数', rows.length + ' 件'],
      ['換算step 合計', U.fmtNum(U.sum(mfg, function (t) { return t.convStep; }), 0)],
      ['総工数 合計', U.fmtNum(U.sum(rows, function (t) { return t.totalHour; }), 1) + ' h'],
      ['指摘 合計', U.fmtNum(U.sum(rows, function (t) { return t.issueTotal; }), 0) + ' 件'],
      ['障害 合計', U.fmtNum(U.sum(mfg, function (t) { return t.defect; }), 0) + ' 件'],
      ['月換算生産性 平均', U.fmtNum(U.avg(mfg, function (t) { return t.prodMonth; }), 0)],
      ['品質 平均', U.fmtNum(U.avg(mfg, function (t) { return t.quality; }), 1)],
      ['設計頁 合計', U.fmtNum(U.sum(dd, function (t) { return t.pages; }), 0) + ' 頁']
    ];
    var bar = U.el('div', { class: 'card', style: { marginTop: '12px' } });
    var body = U.el('div', { class: 'card-body row-flex', style: { gap: '22px' } });
    stats.forEach(function (s) {
      body.appendChild(U.el('div', {}, [
        U.el('div', { class: 'muted', style: { fontSize: '10.5px' }, text: s[0] }),
        U.el('div', { class: 'strong mono', style: { fontSize: '15px' }, text: s[1] })
      ]));
    });
    bar.appendChild(body);
    return bar;
  }

  /* --------------------------------------------------- view */
  Views.tasks = {
    title: '一覧・入力',
    desc: 'ダブルクリックで直接編集／行の⋯で詳細',
    icon: '📋',
    onEnter: function (params) {
      loadPrefs();
      if (params) {
        if (params.project) { F.project = params.project; F.type = 'all'; }
        if (params.assignee) F.assignee = params.assignee;
        if (params.status) F.status = params.status;
        if (params.type) F.type = params.type;
        if (params.quick) F.quick = params.quick;
        savePrefs();
      }
    },
    render: function (root) {
      var rows = filtered();
      function rerender(soft) { App.render(); }

      root.appendChild(buildFilterBar(rerender));

      var actions = U.el('div', { class: 'row-flex', style: { marginBottom: '10px' } }, [
        U.el('button', {
          class: 'btn btn-primary btn-sm', text: '＋ 行を追加',
          onclick: function () {
            Form.openEditor({
              type: F.type === 'all' ? 'mfg' : F.type,
              project: F.project || null, assignee1: F.assignee || null,
              resource: F.resource || null, kubun: F.kubun || null
            }, function () { App.render(); });
          }
        }),
        U.el('button', {
          class: 'btn btn-sm', text: '⬇ CSV出力（絞込結果）',
          onclick: function () {
            var ids = rows.map(function (t) { return t.id; }).join(',');
            location.href = '/api/export/csv?type=' + (F.type === 'all' ? 'mfg' : F.type) + '&ids=' + encodeURIComponent(ids);
          }
        }),
        U.el('button', { class: 'btn btn-sm', text: '⬆ 取込', onclick: function () { App.go('io'); } }),
        U.el('div', { class: 'spacer', style: { flex: 1 } }),
        U.el('span', { class: 'muted', text: rows.length + ' / ' + State.tasks.length + ' 件表示' })
      ]);
      root.appendChild(actions);

      var bulk = buildBulkBar(rows, rerender);
      if (bulk) root.appendChild(bulk);

      root.appendChild(U.el('div', { class: 'card' }, [buildTable(rows, rerender)]));
      root.appendChild(buildSummary(rows));
    }
  };

  Views.tasks._filter = F;
  loadPrefs();
})(window);
