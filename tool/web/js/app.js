/* ============================================================
   app.js - アプリ切替 / ルーティング / 起動
   ============================================================ */
(function (global) {
  'use strict';

  var APPS = [
    {
      key: 'dev', label: '開発プログラム管理', short: '開発管理', icon: '🧩',
      groups: [
        { group: 'メイン', items: ['dashboard', 'tasks', 'members'] },
        { group: '可視化・分析', items: ['gantt', 'analytics', 'pivot'] },
        { group: '管理', items: ['entry', 'io', 'settings'] }
      ]
    },
    {
      key: 'plan', label: '業務予定管理', short: '業務予定', icon: '📝',
      groups: [
        { group: '入力', items: ['planAssign', 'planInput'] },
        { group: '確認・集計', items: ['planBoard', 'planReport'] },
        { group: '管理', items: ['settings'] }
      ]
    }
  ];

  /* adminOnly な画面（設定）は管理者だけが開ける */
  function canView(key) {
    var v = Views[key];
    return !!v && (!v.adminOnly || State.isAdmin());
  }

  /* 未保存の変更がある画面（view.busy）から移動してよいか。破棄する場合は view.discard で編集を捨てる */
  function leaveOk() {
    var view = Views[App.current];
    if (!view || !view.busy || !view.busy()) return true;
    if (!window.confirm('保存していない変更があります。破棄して移動しますか？')) return false;
    if (view.discard) view.discard();
    return true;
  }

  var App = {
    appKey: 'dev',
    current: 'dashboard',
    params: null,
    syncTimer: null,

    apps: function () { return APPS; },
    appDef: function () {
      var self = this;
      return APPS.filter(function (a) { return a.key === self.appKey; })[0] || APPS[0];
    },

    switchApp: function (key) {
      if (this.appKey === key) return;
      if (!leaveOk()) return;
      this.appKey = key;
      try { localStorage.setItem('dpm.app', key); } catch (e) { /* ignore */ }
      this.go(this.appDef().groups[0].items[0]);
    },

    go: function (key, params) {
      if (!Views[key]) return;
      if (!canView(key)) {
        U.toast('この画面は管理者のみ利用できます', 'warn');
        if (location.hash === '#' + key) location.hash = this.current;
        return;
      }
      var view = Views[this.current];
      if (key === this.current && view && view.busy && view.busy()) return;
      if (key !== this.current && !leaveOk()) {
        // 戻る・進むなどで URL だけ変わった場合は元に戻す
        if (location.hash !== '#' + this.current) location.hash = this.current;
        return;
      }
      var owner = APPS.filter(function (a) {
        return a.groups.some(function (g) { return g.items.indexOf(key) >= 0; });
      })[0];
      if (owner && owner.key !== this.appKey && key !== 'settings') {
        this.appKey = owner.key;
        try { localStorage.setItem('dpm.app', owner.key); } catch (e) { /* ignore */ }
      }
      this.current = key;
      this.params = params || null;
      if (Views[key].onEnter) Views[key].onEnter(this.params);
      location.hash = key;
      this.render({ top: true });
      document.getElementById('app').classList.remove('menu-open');
    },

    render: function (opts) {
      if (!canView(this.current)) this.current = this.appDef().groups[0].items[0];
      var view = Views[this.current] || Views.dashboard;
      document.getElementById('viewTitle').textContent = view.title;
      document.getElementById('viewDesc').textContent = view.desc || '';
      syncSearch(view);
      // 再描画で中身が一度空になりスクロール位置が先頭に戻るため、描画前の位置を復元する
      var el = document.getElementById('view');
      var toTop = !!(opts && opts.top);
      var keepTop = toTop ? 0 : el.scrollTop, keepWin = toTop ? 0 : window.scrollY;
      var restore = function () {
        el.scrollTop = keepTop;
        window.scrollTo(window.scrollX, keepWin);
      };
      var root = U.clear(el);
      try {
        view.render(root);
      } catch (e) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">⚠</span>画面の描画でエラーが発生しました<br><small>' + U.esc(e.message) + '</small>' }));
        console.error(e);
      }
      this.renderNav();
      this.renderSync();
      restore();
      // グラフは setTimeout で後から描画され高さが伸びるので、その後にも戻す
      setTimeout(restore, 0);
    },

    renderNav: function () {
      var self = this;
      var switcher = U.clear(document.getElementById('appSwitch'));
      APPS.forEach(function (a) {
        switcher.appendChild(U.el('button', {
          class: 'app-tab' + (self.appKey === a.key ? ' on' : ''),
          title: a.label,
          onclick: function () { self.switchApp(a.key); }
        }, [
          U.el('i', { text: a.icon }),
          U.el('span', { text: a.short })
        ]));
      });

      var nav = U.clear(document.getElementById('nav'));
      var counts = {
        tasks: State.tasks.length,
        members: State.members().length,
        dashboard: State.tasks.filter(function (t) { return t.isLate; }).length || null
      };
      this.appDef().groups.forEach(function (g) {
        var items = g.items.filter(canView);
        if (!items.length) return;
        nav.appendChild(U.el('div', { class: 'nav-group-title', text: g.group }));
        items.forEach(function (key) {
          var v = Views[key];
          nav.appendChild(U.el('button', {
            class: 'nav-item' + (self.current === key ? ' active' : ''),
            onclick: function () { self.go(key); }, title: v.title
          }, [
            U.el('i', { text: v.icon || '•' }),
            U.el('span', { text: v.title }),
            counts[key] ? U.el('span', { class: 'badge', text: String(counts[key]) }) : null
          ]));
        });
      });
    },

    renderSync: function () {
      document.getElementById('syncInfo').textContent =
        'タスク ' + State.tasks.length + '件 / 予定 ' + (State.plans || []).length + '件 / 担当 ' + State.members().length + '名';
      document.getElementById('brandSub').textContent = this.appDef().label;
      var badge = document.getElementById('userBadge');
      var a = State.account;
      badge.textContent = a ? '👤 ' + a.name + (State.isAdmin() ? '（' + State.roleLabel(a.role) + '）' : '') : '👤 未ログイン';
      badge.title = 'アカウント（パスワード変更・ログアウト）';
      badge.className = 'btn btn-sm' + (State.isAdmin() ? ' role-admin' : '');
    }
  };

  /* ------------------------------------------------ アカウント */
  function openAccount() {
    var a = State.account;
    if (!a) { showLogin(''); return; }
    var box = U.el('div');
    var info = U.el('table', { class: 'grid-table' });
    [['ID', a.id], ['氏名', a.name], ['担当者名', a.member || '—'],
      ['権限', State.roleLabel(a.role)]].forEach(function (r) {
      info.appendChild(U.el('tr', {}, [
        U.el('th', { text: r[0], style: { width: '90px', textAlign: 'left' } }),
        U.el('td', { text: r[1] })
      ]));
    });
    box.appendChild(info);
    box.appendChild(U.el('p', { class: 'muted', style: { fontSize: '11.5px' }, text: '担当者名は更新者の記録と、業務予定入力の既定担当者に使われます。変更は管理者に依頼してください。' }));

    var cur = U.el('input', { type: 'password', autocomplete: 'current-password' });
    var pw1 = U.el('input', { type: 'password', autocomplete: 'new-password' });
    var pw2 = U.el('input', { type: 'password', autocomplete: 'new-password' });
    box.appendChild(U.el('hr', { class: 'sep' }));
    box.appendChild(U.el('h3', { text: '🔑 パスワード変更', style: { fontSize: '13px', margin: '0 0 8px' } }));
    box.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: '現在のパスワード' }), cur]));
    box.appendChild(U.el('div', { class: 'field mt8' }, [U.el('label', { text: '新しいパスワード（4文字以上）' }), pw1]));
    box.appendChild(U.el('div', { class: 'field mt8' }, [U.el('label', { text: '新しいパスワード（確認）' }), pw2]));
    box.appendChild(U.el('div', { class: 'row-flex mt8' }, [
      U.el('button', {
        class: 'btn btn-primary btn-sm', text: 'パスワードを変更', onclick: function () {
          if (!cur.value || !pw1.value) { U.toast('パスワードを入力してください', 'warn'); return; }
          if (pw1.value !== pw2.value) { U.toast('確認用のパスワードが一致しません', 'warn'); return; }
          var btn = this;
          btn.disabled = true;
          API.changePassword(cur.value, pw1.value).then(function () {
            cur.value = pw1.value = pw2.value = '';
            U.toast('パスワードを変更しました', 'ok');
          }).catch(function (e) { U.toast(e.message, 'err'); })
            .finally(function () { btn.disabled = false; });
        }
      })
    ]));

    U.openDrawer('アカウント', box, [
      U.el('button', {
        class: 'btn btn-danger', text: 'ログアウト', onclick: function () {
          API.logout().catch(function () { /* 失敗しても再読込でログイン画面に戻る */ })
            .then(function () { location.reload(); });
        }
      }),
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: '閉じる', onclick: U.closeDrawer })
    ]);
  }

  /* ------------------------------------------------ ログイン画面 */
  function loginVisible() { return !document.getElementById('login').hidden; }

  function showLogin(message) {
    U.loading(false);
    var err = document.getElementById('loginError');
    err.textContent = message || '';
    err.hidden = !message;
    document.getElementById('login').hidden = false;
    var id = document.getElementById('loginId');
    if (!id.value) { try { id.value = localStorage.getItem('dpm.loginId') || ''; } catch (e) { /* ignore */ } }
    document.getElementById(id.value ? 'loginPw' : 'loginId').focus();
  }

  function hideLogin() {
    document.getElementById('login').hidden = true;
    document.getElementById('loginPw').value = '';
  }

  function bindLogin() {
    API.onUnauthorized = function () {
      if (loginVisible()) return;
      showLogin(window.__appReady ? 'ログインの有効期限が切れました。もう一度ログインしてください。' : '');
    };
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('loginId').value.trim();
      var pw = document.getElementById('loginPw').value;
      var btn = document.getElementById('loginSubmit');
      var err = document.getElementById('loginError');
      if (!id || !pw) return;
      btn.disabled = true;
      err.hidden = true;
      API.login(id, pw).then(function (r) {
        try { localStorage.setItem('dpm.loginId', r.user.id); } catch (ex) { /* ignore */ }
        if (!window.__appReady) { hideLogin(); boot(); return; }
        if (State.account && State.account.id === r.user.id) {
          // 期限切れからの再ログイン: 編集中の画面をそのまま残す
          hideLogin();
          U.toast('再ログインしました。もう一度保存してください。', 'ok');
          return;
        }
        location.reload();
      }).catch(function (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        document.getElementById('loginPw').select();
      }).finally(function () { btn.disabled = false; });
    });
  }

  /* ------------------------------------------------ 共有時の自動同期 */
  function startSync() {
    if (App.syncTimer) clearInterval(App.syncTimer);
    App.syncTimer = setInterval(function () {
      if (!document.getElementById('drawer').hidden || loginVisible()) return;
      // 入力途中の画面（未保存の変更あり）は再描画で編集内容が消えないよう同期を見送る
      var view = Views[App.current];
      if (view && view.busy && view.busy()) return;
      API.version().then(function (r) {
        if (!r.updatedAt || r.updatedAt === State.updatedAt) return;
        return State.refreshAll().then(function () {
          App.render();
          U.toast('他の利用者による更新を反映しました', 'ok', 2500);
        });
      }).catch(function () { /* 一時的な通信断は無視 */ });
    }, 20000);
  }

  /* 横断検索は検索に対応した画面（searchable）で管理者にだけ出す。一般ユーザーは使わない */
  function syncSearch(view) {
    var show = !!view.searchable && State.isAdmin();
    document.getElementById('searchBox').hidden = !show;
    // 見えない検索条件で絞り込まれたままにならないよう解除する
    if (!show && State.search) {
      State.search = '';
      document.getElementById('globalSearch').value = '';
    }
  }

  var bound = false;
  function bindGlobal() {
    if (bound) return;
    bound = true;
    document.getElementById('userBadge').addEventListener('click', openAccount);
    document.getElementById('btnCollapse').addEventListener('click', function () {
      document.getElementById('app').classList.toggle('collapsed');
    });
    document.getElementById('btnMenu').addEventListener('click', function () {
      document.getElementById('app').classList.toggle('menu-open');
    });
    var search = document.getElementById('globalSearch');
    search.addEventListener('input', U.debounce(function () {
      State.search = this.value.trim();
      App.render();
    }, 280));
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.getElementById('searchBox').hidden) {
        e.preventDefault(); search.focus(); search.select();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        var cur = Views[App.current];
        if (cur && cur.onSave && document.getElementById('drawer').hidden) { e.preventDefault(); cur.onSave(); }
      }
      if (e.key === 'Escape') { U.closeDrawer(); document.getElementById('modalBackdrop').hidden = true; }
    });
    window.addEventListener('hashchange', function () {
      var key = location.hash.replace('#', '');
      if (key && Views[key] && key !== App.current) App.go(key);
    });
    window.addEventListener('resize', U.debounce(function () {
      // 入力途中の画面は作り直すと編集内容やフォーカスが失われるため見送る
      var view = Views[App.current];
      if (view && view.busy && view.busy()) return;
      App.render();
    }, 350));
    /* 未保存の変更がある状態で画面を閉じる・再読込するときの警告 */
    window.addEventListener('beforeunload', function (e) {
      var view = Views[App.current];
      if (view && view.busy && view.busy()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function boot() {
    U.loading(true, 'サーバーに接続しています… (' + location.origin + ')');
    var watchdog = setTimeout(function () {
      U.loading(true, 'サーバーからの応答が遅延しています… もう10秒ほどお待ちください');
    }, 8000);
    API.bootstrap().then(function (data) {
      clearTimeout(watchdog);
      U.loading(true, 'データを描画しています…');
      State.init(data);
      bindGlobal();
      try { App.appKey = localStorage.getItem('dpm.app') || 'dev'; } catch (e) { /* ignore */ }
      if (!APPS.some(function (a) { return a.key === App.appKey; })) App.appKey = 'dev';
      var key = location.hash.replace('#', '');
      App.current = canView(key) ? key : App.appDef().groups[0].items[0];
      if (Views[App.current].onEnter) Views[App.current].onEnter(null);
      App.render();
      window.__appReady = true;
      startSync();
      if (State.readOnly) U.toast('閲覧専用モードで接続しています', 'warn', 5000);
      if (!State.tasks.length && !(State.plans || []).length) {
        U.toast('データがありません。「取込 / 出力」からExcelを取り込んでください。', 'warn', 7000);
        setTimeout(function () { App.go('io'); }, 400);
      }
    }).catch(function (e) {
      clearTimeout(watchdog);
      if (e.code === 'unauthorized') return;  // ログイン画面を表示済み
      var view = U.clear(document.getElementById('view'));
      view.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card-head' }, [U.el('h3', { text: '⚠ 起動に失敗しました' })]),
        U.el('div', { class: 'card-body' }, [
          U.el('p', { text: String(e.message) }),
          U.el('p', { class: 'muted', text: '接続先: ' + location.origin + '  /  サーバー（黒いコマンド画面）が起動したままか確認してください。' }),
          U.el('button', { class: 'btn btn-primary', text: '再読み込み', onclick: function () { location.reload(); } })
        ])
      ]));
    }).finally(function () { U.loading(false); });
  }

  global.App = App;
  document.addEventListener('DOMContentLoaded', function () {
    if (window.__bootBlocked) return;
    bindLogin();
    boot();
  });
})(window);
