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
    { key: 'baseCoef', label: '母体step 係数', hint: '換算step = 新規: 新規×係数 ／ 修正: 母体×係数 + 修正×係数' },
    { key: 'newCoef', label: '新規step 係数' },
    { key: 'modCoef', label: '修正step 係数' },
    { key: 'monthHours', label: '月換算生産性の基準時間', hint: '(新規は新規step／修正は修正step)÷総工数×この値' },
    { key: 'workHoursPerDay', label: '1人日あたり時間' },
    { key: 'fiscalStartMonth', label: '年度開始月' },
    { key: 'targetProdMonth', label: '目標 月換算生産性' },
    { key: 'targetQuality', label: '目標 品質(指摘/KS 上限)' }
  ];

  /* 計算パラメータの入力チェック（サーバー側 model.validate_settings と同じ範囲） */
  var SETTING_RANGES = {
    monthHours: [1, null], workHoursPerDay: [1, 24], fiscalStartMonth: [1, 12]
  };
  function settingOk(key, v) {
    if (v === null || v === undefined || !isFinite(v)) return false;
    var range = SETTING_RANGES[key] || [0, null];
    if (v < range[0] || (range[1] !== null && v > range[1])) return false;
    return key !== 'fiscalStartMonth' || v === Math.floor(v);
  }

  /* 各カードの未保存の変更を追跡する。カードごとに保存するため、保存後の再描画で
     他のカードの編集中の内容を消さないよう、編集中のカードが残っていれば再描画を見送る */
  var trackers = [];
  function track(getter) {
    var t = {
      base: JSON.stringify(getter()),
      dirty: function () { return JSON.stringify(getter()) !== t.base; },
      reset: function () { t.base = JSON.stringify(getter()); }
    };
    trackers.push(t);
    return t;
  }
  function anyDirty() { return trackers.some(function (t) { return t.dirty(); }); }
  /* 保存したカードを保存済みにし、他に編集中のカードが無ければ最新の内容で描き直す */
  function saved(t) {
    if (t) t.reset();
    if (!anyDirty()) App.render();
  }

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
    var t = track(function () { return values; });
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
            State.masters = r.masters; U.toast(label + ' を保存しました', 'ok'); t.reset();
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]));
    if (key === 'members') {
      body.appendChild(U.el('p', { class: 'muted mt8', style: { fontSize: '11.5px' }, text: '✕ で外した担当者は、過去のタスクに名前が残っていても一覧・入力状況に表示されなくなります（タスクの記録はそのまま残ります）。' }));
    }
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
    var t = track(function () { return items; });
    body.appendChild(U.el('div', { class: 'row-flex mt8' }, [
      U.el('button', { class: 'btn btn-sm', text: '＋ 行追加', onclick: function () { items.push({ value: '', color: '#64748b' }); draw(); } }),
      U.el('button', {
        class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
          var patch = {};
          patch[key] = items.filter(function (s) { return s.value; });
          U.loading(true);
          API.masters(patch).then(function (r) {
            State.masters = r.masters; U.toast(label + ' を保存しました', 'ok'); saved(t);
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
    var t = track(function () { return [items, bulk.value]; });

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
            State.masters = r.masters; U.toast(label + ' を保存しました', 'ok'); saved(t);
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
    var t = track(function () { return groups; });
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
            State.masters = r.masters; U.toast('リソース分類を保存しました', 'ok'); saved(t);
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]));
    card.appendChild(body);
    return card;
  }

  /* ---- ユーザー管理（ログインID・権限） ---- */

  function userEditor(user, done) {
    var isNew = !user;
    var u = Object.assign({ id: '', name: '', member: '', role: 'user' }, user || {});
    var listId = 'userMemberList';
    var members = U.el('datalist', { id: listId });
    State.members().forEach(function (m) { members.appendChild(U.el('option', { value: m })); });

    var id = U.el('input', { type: 'text', value: u.id, readonly: !isNew, placeholder: '例: A250001', autocomplete: 'off' });
    var name = U.el('input', { type: 'text', value: u.name, placeholder: '例: 山田 太郎' });
    var member = U.el('input', { type: 'text', value: u.member, list: listId, placeholder: '空欄なら氏名の姓' });
    var role = U.el('select', {});
    ['user', 'admin', 'owner'].forEach(function (r) {
      role.appendChild(U.el('option', { value: r, text: State.roleLabel(r), selected: u.role === r }));
    });

    var box = U.el('div', {}, [
      members,
      U.el('div', { class: 'field' }, [U.el('label', {}, [document.createTextNode('ID'), isNew ? U.el('span', { class: 'req', text: '*' }) : null]), id,
        U.el('div', { class: 'hint', text: isNew ? '半角英数字。初期パスワードはIDと同じになります。' : 'IDは変更できません。' })]),
      U.el('div', { class: 'field mt8' }, [U.el('label', {}, [document.createTextNode('氏名'), U.el('span', { class: 'req', text: '*' })]), name]),
      U.el('div', { class: 'field mt8' }, [U.el('label', { text: '担当者名' }), member,
        U.el('div', { class: 'hint', text: 'タスク・予定の担当者名と一致させてください。更新者としても記録されます。未登録ならメンバーに追加されます。' })]),
      U.el('div', { class: 'field mt8' }, [U.el('label', { text: '権限' }), role,
        U.el('div', { class: 'hint', text: '管理者: ユーザー管理・設定の編集・バックアップ復元ができます。特権管理者: 管理者と同じ権限で、閲覧が中心の人向けです（担当者一覧・日次入力の対象に含めません）。' })])
    ]);

    U.openDrawer(isNew ? 'ユーザー追加' : 'ユーザー編集', box, [
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }),
      U.el('button', {
        class: 'btn btn-primary', text: isNew ? '追加' : '保存', onclick: function () {
          var payload = { name: name.value.trim(), member: member.value.trim(), role: role.value };
          if (!payload.name) { U.toast('氏名を入力してください', 'warn'); return; }
          var call;
          if (isNew) {
            payload.id = id.value.trim();
            if (!payload.id) { U.toast('IDを入力してください', 'warn'); return; }
            call = API.addUser(payload);
          } else {
            call = API.updateUser(u.id, payload);
          }
          U.loading(true);
          call.then(function (r) {
            if (r.masters) State.masters = r.masters;
            if (State.account && r.user.id === State.account.id) {
              // 自分の権限を外した場合は設定画面を開けなくなるので開き直す
              if (r.user.role !== State.account.role) { location.reload(); return; }
              State.account = r.user;
            }
            U.closeDrawer();
            U.toast(isNew ? r.user.name + ' を追加しました（初期パスワード = ID）' : '保存しました', 'ok', 4000);
            done();
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { U.loading(false); });
        }
      })
    ]);
    (isNew ? id : name).focus();
  }

  function userManager() {
    var card = U.el('div', { class: 'card' });
    var sub = U.el('span', { class: 'sub', text: '読み込み中…' });
    card.appendChild(U.el('div', { class: 'card-head' }, [
      U.el('h3', { text: '👥 ユーザー管理' }), sub,
      U.el('div', { class: 'spacer', style: { flex: 1 } }),
      U.el('button', { class: 'btn btn-sm btn-primary', text: '＋ ユーザー追加', onclick: function () { userEditor(null, refresh); } })
    ]));
    var body = U.el('div', { class: 'card-body' });
    card.appendChild(body);

    function rowActions(u) {
      var self = State.account && State.account.id === u.id;
      return U.el('td', { style: { whiteSpace: 'nowrap' } }, [
        U.el('button', { class: 'btn btn-sm', text: '編集', onclick: function () { userEditor(u, refresh); } }),
        ' ',
        U.el('button', {
          class: 'btn btn-sm', text: 'PW初期化', title: 'パスワードをIDと同じ値に戻します', onclick: function () {
            U.confirmDialog('パスワード初期化', u.name + '（' + u.id + '）のパスワードをIDと同じ値に戻します。よろしいですか？', '初期化する').then(function (ok) {
              if (!ok) return;
              API.updateUser(u.id, { resetPassword: true }).then(function () {
                if (self) { location.reload(); return; }
                U.toast('パスワードを初期化しました。本人に変更してもらってください。', 'ok', 4000);
              }).catch(function (e) { U.toast(e.message, 'err'); });
            });
          }
        }),
        ' ',
        U.el('button', {
          class: 'btn btn-sm btn-danger', text: '削除', disabled: self, title: self ? '自分自身は削除できません' : '', onclick: function () {
            U.confirmDialog('ユーザー削除', u.name + '（' + u.id + '）を削除します。登録済みのタスクや予定は残ります。よろしいですか？', '削除する').then(function (ok) {
              if (!ok) return;
              API.deleteUser(u.id).then(function () {
                U.toast('削除しました', 'ok');
                load();
              }).catch(function (e) { U.toast(e.message, 'err'); });
            });
          }
        })
      ]);
    }

    function draw(users) {
      U.clear(body);
      sub.textContent = users.length + '名（管理者 ' + users.filter(function (u) { return u.role === 'admin' || u.role === 'owner'; }).length + '名）';
      var tbl = U.el('table', { class: 'grid-table' });
      tbl.appendChild(U.el('thead', {}, [U.el('tr', {}, ['ID', '氏名', '担当者名', '権限', '操作'].map(function (h) {
        return U.el('th', { text: h });
      }))]));
      var tb = U.el('tbody');
      users.forEach(function (u) {
        tb.appendChild(U.el('tr', {}, [
          U.el('td', { text: u.id, style: { fontFamily: 'var(--mono)' } }),
          U.el('td', { class: 'strong', text: u.name }),
          U.el('td', { text: u.member || '—' }),
          U.el('td', {}, [U.el('span', { class: 'tag' + (u.role === 'admin' || u.role === 'owner' ? ' role-admin' : ''), text: State.roleLabel(u.role) })]),
          rowActions(u)
        ]));
      });
      tbl.appendChild(tb);
      body.appendChild(U.el('div', { class: 'table-wrap' }, [tbl]));
      body.appendChild(U.el('p', { class: 'muted mt8', style: { fontSize: '11.5px' }, text: '新規ユーザーと「PW初期化」後のパスワードはIDと同じです。ログイン後、右上のアカウントメニューから各自で変更してもらってください。' }));
    }

    /* 他のカードが編集中ならユーザー一覧だけ取り直す */
    function refresh() { if (anyDirty()) load(); else App.render(); }

    function load() {
      API.users().then(function (r) { draw(r.users || []); })
        .catch(function (e) {
          U.clear(body);
          body.appendChild(U.el('p', { class: 'muted', text: 'ユーザー一覧を取得できませんでした: ' + e.message }));
        });
    }
    load();
    return card;
  }

  Views.settings = {
    title: '設定',
    desc: 'ユーザー・マスタ・計算式パラメータの管理（管理者のみ）',
    icon: '⚙',
    adminOnly: true,
    /* 編集中のカードがあれば自動同期・画面移動で内容を消さない */
    busy: function () { return anyDirty(); },
    discard: function () { trackers = []; },
    render: function (root) {
      trackers = [];
      root.appendChild(userManager());

      /* --- 計算パラメータ --- */
      var settings = Object.assign({}, State.settings());
      var card = U.el('div', { class: 'card mt16' }, [
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
      var settingsTracker = track(function () { return settings; });
      var body = U.el('div', { class: 'card-body' }, [grid,
        U.el('div', { class: 'row-flex mt12' }, [
          U.el('button', {
            class: 'btn btn-primary', text: '保存して再計算', onclick: function () {
              var bad = SETTING_FIELDS.filter(function (f) { return !settingOk(f.key, settings[f.key]); });
              if (bad.length) {
                U.toast('入力内容を確認してください: ' + bad.map(function (f) { return f.label; }).join('、'), 'warn', 5000);
                return;
              }
              U.loading(true);
              API.masters({ settings: settings }).then(function (r) {
                State.masters = r.masters; U.toast('保存しました', 'ok');
                return State.reload();
              }).then(function () { saved(settingsTracker); })
                .catch(function (e) { U.toast(e.message, 'err'); })
                .finally(function () { U.loading(false); });
            }
          }),
          U.el('span', { class: 'muted', style: { fontSize: '11.5px' }, text: '現在の式: 換算step = 新規: 新規×' + settings.newCoef + ' ／ 修正: 母体×' + settings.baseCoef + ' + 修正×' + settings.modCoef })
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
      var stTracker = track(function () { return statuses; });
      stBody.appendChild(U.el('div', { class: 'row-flex mt8' }, [
        U.el('button', { class: 'btn btn-sm', text: '＋ 行追加', onclick: function () { statuses.push({ value: '', color: '#64748b' }); drawStatuses(); } }),
        U.el('button', {
          class: 'btn btn-sm btn-primary', text: '保存', onclick: function () {
            U.loading(true);
            API.masters({ statuses: statuses.filter(function (s) { return s.value; }) }).then(function (r) {
              State.masters = r.masters; U.toast('保存しました', 'ok'); saved(stTracker);
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
                  }).then(function () { saved(null); })
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
