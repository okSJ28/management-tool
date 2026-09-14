/* ============================================================
   api.js - サーバ通信 + アプリ状態
   ============================================================ */
(function (global) {
  'use strict';

  function currentUser() {
    try { return localStorage.getItem('dpm.user') || ''; } catch (e) { return ''; }
  }

  function req(method, url, body, timeoutMs) {
    var limit = timeoutMs || 30000;
    var opt = { method: method, headers: {} };
    var user = currentUser();
    if (user) opt.headers['X-User'] = encodeURIComponent(user);
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    var timer = null;
    if (typeof AbortController === 'function') {
      var ac = new AbortController();
      opt.signal = ac.signal;
      timer = setTimeout(function () { ac.abort(); }, limit);
    }
    return fetch(url, opt).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return { error: res.statusText }; })
          .then(function (j) { throw new Error(j.error || ('HTTP ' + res.status)); });
      }
      return res.json();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('サーバー応答がありません（' + Math.round(limit / 1000) + '秒でタイムアウト）: ' + url);
      }
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /* Excel の読み込みは数十秒かかることがあるため長めに待つ */
  var IMPORT_TIMEOUT = 600000;

  var API = {
    bootstrap: function () { return req('GET', '/api/bootstrap'); },
    version: function () { return req('GET', '/api/version'); },
    tasks: function () { return req('GET', '/api/tasks'); },
    addTask: function (t) { return req('POST', '/api/tasks', t); },
    updateTask: function (id, patch) { return req('PUT', '/api/tasks/' + encodeURIComponent(id), patch); },
    deleteTask: function (id) { return req('DELETE', '/api/tasks/' + encodeURIComponent(id)); },
    bulk: function (action, ids, patch) { return req('POST', '/api/tasks/bulk', { action: action, ids: ids, patch: patch }); },
    plans: function () { return req('GET', '/api/plans'); },
    addPlan: function (p) { return req('POST', '/api/plans', p); },
    addPlanRange: function (p, dates) { return req('POST', '/api/plans', Object.assign({}, p, { dates: dates })); },
    updatePlan: function (id, patch) { return req('PUT', '/api/plans/' + encodeURIComponent(id), patch); },
    deletePlan: function (id) { return req('DELETE', '/api/plans/' + encodeURIComponent(id)); },
    planBulk: function (action, ids, patch) { return req('POST', '/api/plans/bulk', { action: action, ids: ids, patch: patch }); },
    savePlans: function (save, del) { return req('POST', '/api/plans/batch', { save: save, delete: del }); },
    masters: function (patch) { return req('PUT', '/api/masters', patch); },
    entry: function (member, month, value) { return req('PUT', '/api/entries', { member: member, month: month, value: value }); },
    views: function (savedViews) { return req('PUT', '/api/views', { savedViews: savedViews }); },
    files: function () { return req('GET', '/api/files'); },
    importExcel: function (file, mode, withEntries) {
      return req('POST', '/api/import/excel', { file: file, mode: mode, withEntries: withEntries }, IMPORT_TIMEOUT);
    },
    importCsv: function (text, type, mode) { return req('POST', '/api/import/csv', { text: text, type: type, mode: mode }, IMPORT_TIMEOUT); },
    importJson: function (data) { return req('POST', '/api/import/json', { data: data }, IMPORT_TIMEOUT); }
  };

  /* --------------------------------------------------- state */
  var State = {
    schema: null, enums: null, masters: null, tasks: [], plans: [], entries: {}, savedViews: [],
    folder: '', hasExcel: true, search: '', readOnly: false, shared: false,
    dataDir: '', database: '', backupKeep: 30,
    fieldMap: {}, typeMap: {},

    init: function (data) {
      this.schema = data.schema;
      this.enums = data.enums;
      this.masters = data.masters;
      this.tasks = data.tasks || [];
      this.plans = data.plans || [];
      this.entries = data.entries || {};
      this.savedViews = data.savedViews || [];
      this.folder = data.folder;
      this.dataDir = data.dataDir || '';
      this.database = data.database || '';
      this.backupKeep = data.backupKeep === undefined ? 30 : data.backupKeep;
      this.hasExcel = data.hasExcel;
      this.readOnly = !!data.readOnly;
      this.shared = !!data.shared;
      this.updatedAt = data.updatedAt;
      var self = this;
      this.fieldMap = {};
      this.schema.fields.forEach(function (f) { self.fieldMap[f.key] = f; });
      this.typeMap = {};
      this.schema.types.forEach(function (t) { self.typeMap[t.key] = t; });
      return this;
    },

    user: function () {
      try { return localStorage.getItem('dpm.user') || ''; } catch (e) { return ''; }
    },
    setUser: function (name) {
      try { localStorage.setItem('dpm.user', name || ''); } catch (e) { /* ignore */ }
    },

    field: function (key) { return this.fieldMap[key] || { key: key, label: key, type: 'text', types: [] }; },
    fieldsOf: function (typeKey) {
      return this.schema.fields.filter(function (f) { return f.types.indexOf(typeKey) >= 0; });
    },
    label: function (key) { return this.field(key).label; },
    typeLabel: function (key) { return (this.typeMap[key] || {}).label || key; },

    options: function (fieldKey) {
      var f = this.field(fieldKey);
      if (f.options) return f.options.slice();
      if (!f.source) return [];
      if (f.source === 'types') return this.schema.types.map(function (t) { return t.key; });
      var src = this.masters[f.source] || [];
      return src.map(function (o) { return typeof o === 'object' ? o.value : o; });
    },

    statusColor: function (value) {
      var found = (this.masters.statuses || []).filter(function (s) { return s.value === value; })[0];
      return found ? found.color : '#94a3b8';
    },

    settings: function () { return this.masters.settings || {}; },

    of: function (typeKey) {
      return this.tasks.filter(function (t) { return t.type === typeKey; });
    },

    members: function () {
      var set = new Set(this.masters.members || []);
      this.tasks.forEach(function (t) {
        if (t.assignee1) set.add(t.assignee1);
        if (t.assignee2) set.add(t.assignee2);
      });
      (this.plans || []).forEach(function (p) { if (p.member) set.add(p.member); });
      Object.keys(this.entries || {}).forEach(function (m) { set.add(m); });
      return Array.from(set).filter(Boolean).sort();
    },

    projects: function () {
      var list = this.tasks.map(function (t) { return t.project; })
        .concat((this.plans || []).map(function (p) { return p.project; }));
      return U.uniq(list).sort();
    },

    tasksOfMember: function (name) {
      return this.tasks.filter(function (t) { return t.assignee1 === name || t.assignee2 === name; });
    },

    plansOfMember: function (name) {
      return (this.plans || []).filter(function (p) { return p.member === name; });
    },

    plansOnDate: function (iso, member) {
      return (this.plans || []).filter(function (p) {
        if (member && p.member !== member) return false;
        var s = p.date, e = p.endDate || p.date;
        return s && iso >= s && iso <= e;
      });
    },

    /* ---- 取組み予定（期間） ---- */
    planKind: function (p) {
      return p && (p.kind === 'result' || p.kind === 'assignment') ? p.kind : 'plan';
    },
    assignments: function (member) {
      var self = this;
      return (this.plans || []).filter(function (p) {
        return self.planKind(p) === 'assignment' && (!member || p.member === member);
      });
    },
    /* 指定日にかかっている取組み予定 */
    assignmentsOn: function (iso, member) {
      var self = this;
      return this.assignments(member).filter(function (p) {
        return p.date && iso >= p.date && iso <= (p.endDate || p.date);
      });
    },
    assignmentById: function (id) {
      return this.assignments().filter(function (p) { return p.id === id; })[0] || null;
    },
    /* 取組み予定に紐づく日次行 */
    dailyOf: function (assignmentId, kind) {
      var self = this;
      return (this.plans || []).filter(function (p) {
        if (p.assignmentId !== assignmentId) return false;
        return !kind || self.planKind(p) === kind;
      });
    },
    /* 予定工数・実績積上・最新進捗のロールアップ */
    assignmentRollup: function (a) {
      var results = this.dailyOf(a.id, 'result').slice().sort(function (x, y) {
        if ((x.date || '') !== (y.date || '')) return (x.date || '') < (y.date || '') ? -1 : 1;
        return (x.updatedAt || '') < (y.updatedAt || '') ? -1 : 1;
      });
      var latest = null;
      for (var i = results.length - 1; i >= 0; i--) {
        if (results[i].progress !== null && results[i].progress !== undefined) {
          latest = results[i]; break;
        }
      }
      var plannedDaily = U.sum(this.dailyOf(a.id, 'plan'), function (p) { return p.hours; });
      var actual = U.sum(results, function (p) { return p.actualHours; });
      return {
        results: results,
        actualHours: actual,
        plannedDaily: plannedDaily,
        progress: latest ? latest.progress : null,
        progressAt: latest ? latest.date : null,
        rate: a.hours ? actual / a.hours * 100 : null
      };
    },

    planColor: function (category) {
      var found = (this.masters.planCategories || []).filter(function (c) { return c.value === category; })[0];
      return found ? found.color : U.colorOf(category || '');
    },
    planStatusColor: function (value) {
      var found = (this.masters.planStatuses || []).filter(function (c) { return c.value === value; })[0];
      return found ? found.color : '#94a3b8';
    },

    /* PJCD / 作業コードなど「コード＋名称」マスタ */
    codeList: function (key) {
      return (this.masters[key] || []).filter(function (c) { return c && c.code; });
    },
    codeName: function (key, code) {
      if (!code) return '';
      var found = this.codeList(key).filter(function (c) { return c.code === code; })[0];
      return found ? (found.name || '') : '';
    },
    codeLabel: function (key, code) {
      if (!code) return '';
      var name = this.codeName(key, code);
      return name ? code + '　' + name : code;
    },

    reload: function () {
      var self = this;
      return API.tasks().then(function (r) { self.tasks = r.tasks; return self.tasks; });
    },

    reloadPlans: function () {
      var self = this;
      return API.plans().then(function (r) { self.plans = r.plans; return self.plans; });
    },

    refreshAll: function () {
      var self = this;
      return API.bootstrap().then(function (d) { self.init(d); return self; });
    }
  };

  /* ------------------------------------------------ 共通ロジック */
  var Logic = {
    ST: function () { return State.enums.status; },

    isActive: function (t) {
      var s = t.effectiveStatus;
      var E = State.enums.status;
      return s === E.doing || s === E.review;
    },
    isDone: function (t) { return t.effectiveStatus === State.enums.status.done; },
    isTodo: function (t) { return t.effectiveStatus === State.enums.status.todo; },

    currentWork: function (name) {
      var E = State.enums.status;
      return State.tasksOfMember(name).filter(function (t) {
        return t.effectiveStatus === E.doing || t.effectiveStatus === E.review;
      }).sort(function (a, b) { return (a.endDate || '9999') < (b.endDate || '9999') ? -1 : 1; });
    },

    upcoming: function (name, days) {
      var limit = U.iso(U.addDays(U.today(), days || 30));
      var t0 = U.iso(U.today());
      return State.tasksOfMember(name).filter(function (t) {
        return t.effectiveStatus === State.enums.status.todo && t.startDate && t.startDate > t0 && t.startDate <= limit;
      }).sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
    },

    lateTasks: function (list) {
      return (list || State.tasks).filter(function (t) { return t.isLate; });
    },

    inMonth: function (t, key) {
      return U.monthKey(t.endDate) === key || U.monthKey(t.startDate) === key;
    },

    /** 期間が指定範囲に重なるか */
    overlaps: function (t, from, to) {
      var s = t.startDate || t.endDate, e = t.endDate || t.startDate;
      if (!s || !e) return false;
      return !(e < from || s > to);
    }
  };

  global.API = API;
  global.State = State;
  global.Logic = Logic;
})(window);
