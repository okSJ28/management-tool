/* ============================================================
   views/settings.js - マスタ・計算パラメータ設定
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var LISTS = [
    { key: 'members', label: 'メンバー（担当者）' },
    { key: 'projects', label: '案件名' },
    { key: 'resources', label: 'リソース区分' },
    { key: 'systems', label: 'システム' },
    { key: 'kubuns', label: '区分' },
    { key: 'editors', label: '使用エディタ' },
    { key: 'designTypes', label: '設計種別' },
    { key: 'entryStatuses', label: '実績入力の状態' }
  ];

  var SETTING_FIELDS = [
    { key: 'baseCoef', label: '母体step 係数', hint: '換算step = 母体×係数 + 新規×係数 + 修正×係数' },
    { key: 'newCoef', label: '新規step 係数' },
    { key: 'modCoef', label: '修正step 係数' },
    { key: 'monthHours', label: '月換算生産性の基準時間', hint: '(新規+修正)÷総工数×この値' },
    { key: 'workHoursPerDay', label: '1人日あたり時間' },
    { key: 'fiscalStartMonth', label: '年度開始月' },
    { key: 'targetProdMonth', label: '目標 月換算生産性' },
    { key: 'targetQuality', label: '目標 品質(指摘/KS 上限)' }
  ];

  function listEditor(key, label) {
    var values = (State.masters[key] || []).map(function (v) { return typeof v === 'object' ? v.value : v; });
    var box = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [U.el('h3', { text: label }), U.el('span', { class: 'sub', text: values.length + '件' })])
    ]);
    var body = U.el('div', { class: 'card-body' });
    var listBox = U.el('div', { class: 'pill-group', style: { marginBottom: '10px' } });

    function draw() {
      U.clear(listBox);
      values.forEach(function (v, i) {
        listBox.appendChild(U.el('span', { class: 'tag', style: { padding: '3px 6px 3px 9px' } }, [
          document.createTextNode(v),
          U.el('button', {
            class: 'icon-btn', style: { width: '18px', height: '18px', fontSize: '11px' }, text: '✕',
            title: '削除', onclick: function () { values.splice(i, 1); draw(); }
          })
        ]));
      });
      if (!values.length) listBox.appendChild(U.el('span', { class: 'muted', text: '（未登録）' }));
    }
    draw();
    body.appendChild(listBox);

    var input = U.el('input', { type: 'text', placeholder: '追加する値を入力してEnter', style: { flex: 1 } });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var v = input.value.trim();
      if (v && values.indexOf(v) < 0) { values.push(v); draw(); }
      input.value = '';
    });
    body.appendChild(U.el('div', { class: 'row-flex' }, [
      input,
      U.el('button', {
        class: 'btn btn-sm', text: '追加', onclick: function () {
          var v = input.value.trim();
          if (v && values.indexOf(v) < 0) { values.push(v); draw(); }
          input.value = '';
        }
      }),
      U.el('button', {
        class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
          var patch = {};
          patch[key] = values.slice();
          U.loading(true);
          API.masters(patch).then(function (r) {
            State.masters = r.masters; U.toast(label + ' を保存しました', 'ok');
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]));
    box.appendChild(body);
    return box;
  }

  function colorListEditor(key, label, hint) {
    var items = (State.masters[key] || []).map(function (s) { return Object.assign({}, s); });
    var card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [U.el('h3', { text: label }), hint ? U.el('span', { class: 'sub', text: hint }) : null])
    ]);
    var body = U.el('div', { class: 'card-body' });
    var list = U.el('div');
    function draw() {
      U.clear(list);
      items.forEach(function (s, i) {
        list.appendChild(U.el('div', { class: 'row-flex', style: { marginBottom: '6px' } }, [
          U.el('input', { type: 'color', value: s.color || '#64748b', style: { width: '46px', padding: '0', height: '30px' }, oninput: function () { s.color = this.value; } }),
          U.el('input', { type: 'text', value: s.value, style: { width: '180px' }, oninput: function () { s.value = this.value; } }),
          U.el('button', { class: 'btn btn-sm', text: '削除', onclick: function () { items.splice(i, 1); draw(); } })
        ]));
      });
      if (!items.length) list.appendChild(U.el('div', { class: 'muted', text: '（未登録）' }));
    }
    draw();
    body.appendChild(list);
    body.appendChild(U.el('div', { class: 'row-flex mt8' }, [
      U.el('button', { class: 'btn btn-sm', text: '＋ 行追加', onclick: function () { items.push({ value: '', color: '#64748b' }); draw(); } }),
      U.el('button', {
        class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
          var patch = {};
          patch[key] = items.filter(function (s) { return s.value; });
          U.loading(true);
          API.masters(patch).then(function (r) {
            State.masters = r.masters; U.toast(label + ' を保存しました', 'ok'); App.render();
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]));
    card.appendChild(body);
    return card;
  }

  function codeListEditor(key, label, hint, placeholder) {
    var items = State.codeList(key).map(function (c) { return { code: c.code, name: c.name || '' }; });
    var card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [
        U.el('h3', { text: label }),
        U.el('span', { class: 'sub', text: hint || '' })
      ])
    ]);
    var body = U.el('div', { class: 'card-body' });
    var list = U.el('div');

    function draw() {
      U.clear(list);
      var head = U.el('div', { class: 'row-flex', style: { marginBottom: '4px' } }, [
        U.el('span', { class: 'muted', style: { width: '190px', fontSize: '10.5px', fontWeight: '700' }, text: 'コード' }),
        U.el('span', { class: 'muted', style: { fontSize: '10.5px', fontWeight: '700' }, text: '名称' })
      ]);
      list.appendChild(head);
      items.forEach(function (c, i) {
        list.appendChild(U.el('div', { class: 'row-flex', style: { marginBottom: '6px' } }, [
          U.el('input', {
            type: 'text', value: c.code, class: 'mono', style: { width: '180px' },
            placeholder: placeholder || 'コード',
            oninput: function () { c.code = this.value.trim(); }
          }),
          U.el('input', {
            type: 'text', value: c.name, style: { flex: 1, minWidth: '160px' }, placeholder: '名称',
            oninput: function () { c.name = this.value; }
          }),
          U.el('button', { class: 'btn btn-sm', text: '削除', onclick: function () { items.splice(i, 1); draw(); } })
        ]));
      });
      if (!items.length) list.appendChild(U.el('div', { class: 'muted', text: '（未登録）' }));
    }
    draw();
    body.appendChild(list);

    var bulk = U.el('textarea', {
      placeholder: 'まとめて追加: 1行に「コード␣名称」を貼り付け\n例）C02PA0615P  若手育成',
      style: { minHeight: '68px', marginTop: '8px' }
    });
    body.appendChild(bulk);

    body.appendChild(U.el('div', { class: 'row-flex mt8' }, [
      U.el('button', { class: 'btn btn-sm', text: '＋ 行追加', onclick: function () { items.push({ code: '', name: '' }); draw(); } }),
      U.el('button', {
        class: 'btn btn-sm', text: '⬇ 貼り付けから取込', onclick: function () {
          var added = 0;
          bulk.value.split('\n').forEach(function (line) {
            var text = line.replace(/\u3000/g, ' ').trim();
            if (!text) return;
            var m = text.match(/^(\S+)[\s,\t]+(.*)$/);
            var code = m ? m[1] : text;
            var name = m ? m[2].trim() : '';
            var found = items.filter(function (c) { return c.code === code; })[0];
            if (found) { found.name = name || found.name; }
            else { items.push({ code: code, name: name }); added++; }
          });
          bulk.value = '';
          draw();
          U.toast(added + ' 件を追加しました（未保存）', added ? 'ok' : 'warn');
        }
      }),
      U.el('div', { class: 'spacer', style: { flex: 1 } }),
      U.el('button', {
        class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
          var cleaned = items.filter(function (c) { return c.code; });
          var codes = cleaned.map(function (c) { return c.code; });
          var dup = codes.filter(function (c, i) { return codes.indexOf(c) !== i; });
          if (dup.length) { U.toast('コードが重複しています: ' + U.uniq(dup).join(', '), 'warn', 5000); return; }
          var patch = {};
          patch[key] = cleaned;
          U.loading(true);
          API.masters(patch).then(function (r) {
            State.masters = r.masters; U.toast(label + ' を保存しました', 'ok'); App.render();
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]));
    card.appendChild(body);
    return card;
  }

  function resourceGroupEditor() {
    var groups = JSON.parse(JSON.stringify(State.masters.resourceGroups || {}));
    var known = U.uniq(State.tasks.map(function (t) { return t.resource; })).sort();
    var card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [
        U.el('h3', { text: 'リソース分類（集計のグループ分け）' }),
        U.el('span', { class: 'sub', text: '分析画面の「リソース分類」軸で使用します' })
      ])
    ]);
    var body = U.el('div', { class: 'card-body' });
    var list = U.el('div');
    function draw() {
      U.clear(list);
      Object.keys(groups).forEach(function (name) {
        var row = U.el('div', { style: { border: '1px solid var(--border)', borderRadius: '9px', padding: '8px 10px', marginBottom: '8px' } });
        row.appendChild(U.el('div', { class: 'row-flex' }, [
          U.el('input', {
            type: 'text', value: name, style: { width: '180px', fontWeight: '700' },
            onchange: function () {
              var nv = this.value.trim();
              if (!nv || nv === name) return;
              groups[nv] = groups[name]; delete groups[name]; draw();
            }
          }),
          U.el('span', { class: 'muted', text: (groups[name] || []).length + ' 区分' }),
          U.el('button', { class: 'btn btn-sm', style: { marginLeft: 'auto' }, text: '分類を削除', onclick: function () { delete groups[name]; draw(); } })
        ]));
        var chips = U.el('div', { class: 'pill-group', style: { marginTop: '6px' } });
        (groups[name] || []).forEach(function (v, i) {
          chips.appendChild(U.el('span', { class: 'tag', style: { padding: '3px 6px 3px 9px' } }, [
            document.createTextNode(v),
            U.el('button', {
              class: 'icon-btn', style: { width: '18px', height: '18px', fontSize: '11px' }, text: '✕',
              onclick: function () { groups[name].splice(i, 1); draw(); }
            })
          ]));
        });
        row.appendChild(chips);
        var sel = U.el('select', { style: { marginTop: '6px' } });
        sel.appendChild(U.el('option', { value: '', text: '＋ リソース区分を追加…' }));
        known.concat(State.options('resource')).filter(function (v, i, arr) { return arr.indexOf(v) === i; })
          .forEach(function (v) { sel.appendChild(U.el('option', { value: v, text: v })); });
        sel.addEventListener('change', function () {
          if (!this.value) return;
          if ((groups[name] || []).indexOf(this.value) < 0) groups[name].push(this.value);
          draw();
        });
        row.appendChild(sel);
        list.appendChild(row);
      });
    }
    draw();
    body.appendChild(list);
    var newName = U.el('input', { type: 'text', placeholder: '新しい分類名', style: { width: '180px' } });
    body.appendChild(U.el('div', { class: 'row-flex mt8' }, [
      newName,
      U.el('button', {
        class: 'btn btn-sm', text: '＋ 分類を追加', onclick: function () {
          var v = newName.value.trim();
          if (v && !groups[v]) { groups[v] = []; newName.value = ''; draw(); }
        }
      }),
      U.el('button', {
        class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
          U.loading(true);
          API.masters({ resourceGroups: groups }).then(function (r) {
            State.masters = r.masters; U.toast('リソース分類を保存しました', 'ok'); App.render();
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]));
    card.appendChild(body);
    return card;
  }

  Views.settings = {
    title: '設定',
    desc: 'マスタ・計算式パラメータの管理',
    icon: '⚙',
    render: function (root) {
      /* --- 計算パラメータ --- */
      var settings = Object.assign({}, State.settings());
      var card = U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [U.el('h3', { text: '計算パラメータ' }), U.el('span', { class: 'sub', text: '変更すると全データの指標が再計算されます' })])
      ]);
      var grid = U.el('div', { class: 'form-grid' });
      SETTING_FIELDS.forEach(function (f) {
        var input = U.el('input', {
          type: 'number', step: 'any', value: settings[f.key],
          oninput: function () { settings[f.key] = U.num(this.value); }
        });
        grid.appendChild(U.el('div', { class: 'field' }, [
          U.el('label', { text: f.label }), input,
          f.hint ? U.el('div', { class: 'hint', text: f.hint }) : null
        ]));
      });
      var body = U.el('div', { class: 'card-body' }, [grid,
        U.el('div', { class: 'row-flex mt12' }, [
          U.el('button', {
            class: 'btn btn-primary', text: '保存して再計算', onclick: function () {
              U.loading(true);
              API.masters({ settings: settings }).then(function (r) {
                State.masters = r.masters; U.toast('保存しました', 'ok');
                return State.reload();
              }).then(function () { App.render(); })
                .catch(function (e) { U.toast(e.message, 'err'); })
                .finally(function () { U.loading(false); });
            }
          }),
          U.el('span', { class: 'muted', style: { fontSize: '11.5px' }, text: '現在の式: 換算step = 母体×' + settings.baseCoef + ' + 新規×' + settings.newCoef + ' + 修正×' + settings.modCoef })
        ])
      ]);
      card.appendChild(body);
      root.appendChild(card);

      /* --- ステータス色 --- */
      var stCard = U.el('div', { class: 'card mt16' }, [
        U.el('div', { class: 'card-head' }, [U.el('h3', { text: 'ステータス定義' })])
      ]);
      var stBody = U.el('div', { class: 'card-body' });
      var statuses = (State.masters.statuses || []).map(function (s) { return Object.assign({}, s); });
      var stList = U.el('div');
      function drawStatuses() {
        U.clear(stList);
        statuses.forEach(function (s, i) {
          stList.appendChild(U.el('div', { class: 'row-flex', style: { marginBottom: '6px' } }, [
            U.el('input', { type: 'color', value: s.color, style: { width: '46px', padding: '0', height: '30px' }, oninput: function () { s.color = this.value; } }),
            U.el('input', { type: 'text', value: s.value, style: { width: '180px' }, oninput: function () { s.value = this.value; } }),
            U.el('button', { class: 'btn btn-sm', text: '削除', onclick: function () { statuses.splice(i, 1); drawStatuses(); } })
          ]));
        });
      }
      drawStatuses();
      stBody.appendChild(stList);
      stBody.appendChild(U.el('div', { class: 'row-flex mt8' }, [
        U.el('button', { class: 'btn btn-sm', text: '＋ 行追加', onclick: function () { statuses.push({ value: '', color: '#64748b' }); drawStatuses(); } }),
        U.el('button', {
          class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
            U.loading(true);
            API.masters({ statuses: statuses.filter(function (s) { return s.value; }) }).then(function (r) {
              State.masters = r.masters; U.toast('保存しました', 'ok'); App.render();
            }).catch(function (e) { U.toast(e.message, 'err'); })
              .finally(function () { U.loading(false); });
          }
        })
      ]));
      stCard.appendChild(stBody);
      root.appendChild(stCard);

      /* --- 各種マスタ --- */
      root.appendChild(U.el('div', { class: 'grid k2 mt16' }, [
        codeListEditor('projectCodes', '業務予定：PJCD',
          '日次入力（始業前）の PJCD 欄の選択肢になります', 'C02PA0615P'),
        codeListEditor('workCodes', '業務予定：作業コード',
          '日次入力（始業前）の作業コード欄の選択肢になります', 'A000000005')
      ]));
      root.appendChild(U.el('div', { class: 'grid k2 mt16' }, [
        colorListEditor('planCategories', '業務予定：作業区分', '業務予定入力で使用します'),
        colorListEditor('planStatuses', '業務予定：ステータス')
      ]));
      root.appendChild(U.el('div', { class: 'mt16' }, [resourceGroupEditor()]));

      var grid2 = U.el('div', { class: 'grid k2 mt16' });
      LISTS.forEach(function (l) { grid2.appendChild(listEditor(l.key, l.label)); });
      root.appendChild(grid2);

      /* --- 危険操作 --- */
      root.appendChild(U.el('div', { class: 'card mt16' }, [
        U.el('div', { class: 'card-head' }, [U.el('h3', { text: '⚠ データ操作' })]),
        U.el('div', { class: 'card-body row-flex' }, [
          U.el('button', {
            class: 'btn btn-danger', text: 'タスクを全削除', onclick: function () {
              U.confirmDialog('全削除', '登録済みのタスク ' + State.tasks.length + ' 件をすべて削除します。事前にバックアップを取得してください。', '全削除する')
                .then(function (ok) {
                  if (!ok) return;
                  U.loading(true);
                  API.bulk('delete', State.tasks.map(function (t) { return t.id; })).then(function () {
                    U.toast('削除しました', 'ok'); return State.reload();
                  }).then(function () { App.render(); })
                    .catch(function (e) { U.toast(e.message, 'err'); })
                    .finally(function () { U.loading(false); });
                });
            }
          }),
          U.el('button', { class: 'btn', text: '💾 先にバックアップ', onclick: function () { location.href = '/api/export/json'; } })
        ])
      ]));
    }
  };
})(window);
