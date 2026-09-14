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
      this.appKey = key;
      try { localStorage.setItem('dpm.app', key); } catch (e) { /* ignore */ }
      this.go(this.appDef().groups[0].items[0]);
    },

    go: function (key, params) {
      if (!Views[key]) return;
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
      this.render();
      document.getElementById('view').scrollTop = 0;
      document.getElementById('app').classList.remove('menu-open');
    },

    render: function () {
      var view = Views[this.current] || Views.dashboard;
      document.getElementById('viewTitle').textContent = view.title;
      document.getElementById('viewDesc').textContent = view.desc || '';
      var root = U.clear(document.getElementById('view'));
      try {
        view.render(root);
      } catch (e) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">⚠</span>画面の描画でエラーが発生しました<br><small>' + U.esc(e.message) + '</small>' }));
        console.error(e);
      }
      this.renderNav();
      this.renderSync();
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
        dashboard: State.tasks.filter(function (t) { return t.isLate; }).length || null,
        planBoard: (State.plans || []).length || null
      };
      this.appDef().groups.forEach(function (g) {
        nav.appendChild(U.el('div', { class: 'nav-group-title', text: g.group }));
        g.items.forEach(function (key) {
          var v = Views[key];
          if (!v) return;
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
      var user = State.user();
      badge.textContent = user ? '👤 ' + user : '👤 利用者を設定';
      badge.className = 'btn btn-sm' + (user ? '' : ' btn-primary');
      document.getElementById('sharedBadge').hidden = !State.shared;
    }
  };

  /* ------------------------------------------------ 利用者設定 */
  function chooseUser() {
    var box = U.el('div');
    box.appendChild(U.el('p', { class: 'muted', text: '業務予定入力の既定担当者、および更新履歴の記録に使用します。この設定はこのPCのブラウザにのみ保存されます。' }));
    var current = State.user();
    var sel = U.el('select', { style: { width: '100%' } });
    sel.appendChild(U.el('option', { value: '', text: '（未設定）' }));
    State.members().forEach(function (m) {
      sel.appendChild(U.el('option', { value: m, text: m, selected: m === current }));
    });
    sel.value = current;
    var free = U.el('input', { type: 'text', placeholder: '一覧にない場合はここに入力' });
    box.appendChild(U.el('div', { class: 'field' }, [U.el('label', { text: '利用者（自分の名前）' }), sel]));
    box.appendChild(U.el('div', { class: 'field mt8' }, [U.el('label', { text: '新規に入力' }), free]));

    U.openDrawer('利用者の設定', box, [
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'btn', text: 'キャンセル', onclick: U.closeDrawer }),
      U.el('button', {
        class: 'btn btn-primary', text: '保存', onclick: function () {
          var name = (free.value || '').trim() || sel.value;
          State.setUser(name);
          U.closeDrawer();
          U.toast(name ? name + ' として利用します' : '利用者を解除しました', 'ok');
          App.render();
        }
      })
    ]);
  }

  /* ------------------------------------------------ 共有時の自動同期 */
  function startSync() {
    if (App.syncTimer) clearInterval(App.syncTimer);
    App.syncTimer = setInterval(function () {
      if (!document.getElementById('drawer').hidden) return;
      API.version().then(function (r) {
        if (!r.updatedAt || r.updatedAt === State.updatedAt) return;
        return State.refreshAll().then(function () {
          App.render();
          U.toast('他の利用者による更新を反映しました', 'ok', 2500);
        });
      }).catch(function () { /* 一時的な通信断は無視 */ });
    }, 20000);
  }

  function bindGlobal() {
    document.getElementById('btnQuickAdd').addEventListener('click', function () {
      if (App.appKey === 'plan') {
        var iso = U.iso(U.today());
        Views.planInput._editor({ member: State.user() || null, date: iso, endDate: iso }, function () { App.render(); });
      } else {
        Form.openEditor({ type: 'mfg' }, function () { App.render(); });
      }
    });
    document.getElementById('userBadge').addEventListener('click', chooseUser);
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); search.select(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault(); document.getElementById('btnQuickAdd').click();
      }
      if (e.key === 'Escape') { U.closeDrawer(); document.getElementById('modalBackdrop').hidden = true; }
    });
    window.addEventListener('hashchange', function () {
      var key = location.hash.replace('#', '');
      if (key && Views[key] && key !== App.current) App.go(key);
    });
    window.addEventListener('resize', U.debounce(function () { App.render(); }, 350));
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
      App.current = Views[key] ? key : App.appDef().groups[0].items[0];
      if (Views[App.current].onEnter) Views[App.current].onEnter(null);
      App.render();
      startSync();
      if (State.readOnly) U.toast('閲覧専用モードで接続しています', 'warn', 5000);
      if (!State.tasks.length && !(State.plans || []).length) {
        U.toast('データがありません。「取込 / 出力」からExcelを取り込んでください。', 'warn', 7000);
        setTimeout(function () { App.go('io'); }, 400);
      }
    }).catch(function (e) {
      clearTimeout(watchdog);
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
    if (!window.__bootBlocked) boot();
  });
})(window);
