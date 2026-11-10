/* ============================================================
   views/entry.js - 実績入力確認（月次チェック表）
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var year = null;

  /* 経験本数の対象（リソース区分はこの 3 つだけ。SQL・bjex などは数えない） */
  var EXP_RESOURCES = ['JN', 'リアル', 'RD'];
  var EXP_KUBUNS = ['新規', '修正'];

  function cycle(current, list) {
    var idx = list.indexOf(current);
    return idx < 0 ? list[0] : (idx + 1 >= list.length ? '' : list[idx + 1]);
  }

  Views.entry = {
    title: '実績入力確認',
    desc: 'メンバー×月の入力状況をクリックで切替',
    icon: '✅',
    render: function (root) {
      var settings = State.settings();
      var fyNow = U.fiscalYear(U.today(), settings.fiscalStartMonth);
      if (year === null) year = fyNow;
      var months = U.fiscalMonths(year, settings.fiscalStartMonth);
      var members = State.members();
      var statuses = State.masters.entryStatuses || ['完了', '対象外'];
      var options = statuses.filter(function (s) { return s !== '未入力'; });

      var bar = U.el('div', { class: 'filterbar' }, [
        U.el('div', { class: 'fld' }, [U.el('label', { text: '年度' }),
        (function () {
          var s = U.el('select', { onchange: function () { year = parseInt(this.value, 10); App.render(); } });
          for (var y = fyNow + 1; y >= fyNow - 5; y--) s.appendChild(U.el('option', { value: y, text: y + '年度', selected: y === year }));
          return s;
        })()]),
        U.el('span', { class: 'muted', text: 'セルをクリックすると 完了 → 対象外 → 未入力 の順に切り替わります' }),
        U.el('div', { class: 'spacer' }),
        U.el('button', { class: 'btn btn-sm', text: '⬇ CSV出力', onclick: function () { exportCsv(members, months); } })
      ]);
      root.appendChild(bar);

      if (!members.length) {
        root.appendChild(U.el('div', { class: 'empty', html: '<span class="big">✅</span>メンバーが登録されていません。設定画面またはExcel取込で追加してください。' }));
        return;
      }

      var totalCells = members.length * months.length;
      var doneCount = 0, naCount = 0;
      members.forEach(function (m) {
        months.forEach(function (mm) {
          var v = (State.entries[m] || {})[mm];
          if (v === '完了') doneCount++;
          else if (v) naCount++;
        });
      });
      var pastMonths = months.filter(function (mk) { return mk <= U.monthKey(U.iso(U.today())); });
      var pastCells = members.length * pastMonths.length;
      var pastFilled = 0;
      members.forEach(function (m) {
        pastMonths.forEach(function (mm) { if ((State.entries[m] || {})[mm]) pastFilled++; });
      });

      root.appendChild(U.el('div', { class: 'grid k4' }, [
        Views._helpers.kpi('対象メンバー', String(members.length), '名', months.length + 'ヶ月分', 'blue'),
        Views._helpers.kpi('入力済（完了）', String(doneCount), '件', '対象外 ' + naCount + '件', 'green'),
        Views._helpers.kpi('経過月の入力率', pastCells ? U.fmtNum(pastFilled / pastCells * 100, 1) : '0', '%',
          pastFilled + ' / ' + pastCells, pastCells && pastFilled / pastCells > 0.9 ? 'green' : 'amber'),
        Views._helpers.kpi('未入力（経過分）', String(pastCells - pastFilled), '件', '要フォロー', pastCells - pastFilled ? 'red' : 'green')
      ]));

      var card = U.el('div', { class: 'card mt16' }, [
        U.el('div', { class: 'card-head' }, [U.el('h3', { text: year + '年度 実績入力状況' })])
      ]);
      var wrap = U.el('div', { class: 'table-wrap' });
      var tbl = U.el('table', { class: 'grid-table' });
      var hr = U.el('tr');
      hr.appendChild(U.el('th', { class: 'col-pin', text: '氏名' }));
      months.forEach(function (mk) {
        var m = parseInt(mk.split('-')[1], 10);
        hr.appendChild(U.el('th', { class: 'center', style: { minWidth: '62px' }, text: m + '月' }));
      });
      hr.appendChild(U.el('th', { class: 'center', text: '入力率' }));
      tbl.appendChild(U.el('thead', {}, [hr]));

      var tb = U.el('tbody');
      members.forEach(function (m) {
        var tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'col-pin' }, [
          U.el('span', { class: 'avatar', style: { background: U.colorOf(m), width: '20px', height: '20px', flex: '0 0 20px', fontSize: '9px', display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px' }, text: U.initials(m) }),
          U.el('b', { text: m })
        ]));
        var filled = 0;
        months.forEach(function (mk) {
          var value = (State.entries[m] || {})[mk] || '';
          if (value) filled++;
          var bg = value === '完了' ? 'var(--ok-soft)' : value ? '#e2e8f0' : 'transparent';
          var fg = value === '完了' ? 'var(--ok)' : 'var(--text-3)';
          var isPast = mk <= U.monthKey(U.iso(U.today()));
          if (!value && isPast) { bg = 'var(--danger-soft)'; fg = 'var(--danger)'; }
          var cell = U.el('div', {
            class: 'heat-cell', style: { background: bg, color: fg, fontWeight: 700 },
            text: value || (isPast ? '未' : ''),
            onclick: function () {
              var next = cycle(value, options);
              U.loading(true);
              API.entry(m, mk, next || null).then(function (r) {
                State.entries = r.entries; App.render();
              }).catch(function (e) { U.toast(e.message, 'err'); })
                .finally(function () { U.loading(false); });
            }
          });
          tr.appendChild(U.el('td', { class: 'center', style: { padding: '3px' } }, [cell]));
        });
        var pastN = months.filter(function (mk) { return mk <= U.monthKey(U.iso(U.today())); }).length;
        var pastFilledM = months.filter(function (mk) { return mk <= U.monthKey(U.iso(U.today())) && (State.entries[m] || {})[mk]; }).length;
        tr.appendChild(U.el('td', { class: 'num' }, [
          U.el('div', { class: 'row-flex' }, [
            U.el('div', { class: 'progress', style: { flex: 1 } }, [U.el('span', { style: { width: (pastN ? pastFilledM / pastN * 100 : 0) + '%', background: pastFilledM === pastN ? 'var(--ok)' : 'var(--warn)' } })]),
            U.el('span', { class: 'mono muted', text: pastFilledM + '/' + pastN })
          ])
        ]));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      card.appendChild(wrap);
      root.appendChild(card);
      root.appendChild(experienceCard(members));

      root.appendChild(Views._helpers.chartCard('月別 入力完了人数', function (box) {
        Charts.bar(box, {
          labels: months.map(function (mk) { return parseInt(mk.split('-')[1], 10) + '月'; }),
          values: months.map(function (mk) {
            return members.filter(function (m) { return (State.entries[m] || {})[mk] === '完了'; }).length;
          }), color: '#16a34a', unit: '名', height: 230
        });
      }));
    }
  };

  /* 担当者ごとの新規／修正の経験本数（製造タスク・全期間、ステータス「対象外」は除く） */
  function experienceCard(members) {
    var counts = {};
    members.forEach(function (m) { counts[m] = {}; });
    State.of('mfg').forEach(function (t) {
      if (EXP_RESOURCES.indexOf(t.resource) < 0 || EXP_KUBUNS.indexOf(t.kubun) < 0) return;
      if (t.status === '対象外') return;
      U.uniq([t.assignee1, t.assignee2]).forEach(function (m) {
        if (!counts[m]) return;
        var key = t.resource + '|' + t.kubun;
        counts[m][key] = (counts[m][key] || 0) + 1;
      });
    });

    var sep = { borderLeft: '2px solid var(--border)' };
    var groups = EXP_RESOURCES.concat(['合計']);
    var gh = U.el('tr', {}, [U.el('th', { rowspan: 2, class: 'col-pin', text: '氏名' })]);
    var ch = U.el('tr');
    groups.forEach(function (g) {
      gh.appendChild(U.el('th', { colspan: EXP_KUBUNS.length, style: Object.assign({ textAlign: 'center' }, sep), text: g }));
      EXP_KUBUNS.forEach(function (k, ki) {
        ch.appendChild(U.el('th', { style: Object.assign({ minWidth: '54px', textAlign: 'right' }, ki === 0 ? sep : {}), text: k }));
      });
    });

    function cell(value, first, bold) {
      return U.el('td', {
        class: 'num', style: Object.assign({ color: value ? 'var(--text)' : 'var(--text-3)', fontWeight: bold && value ? 800 : 400 }, first ? sep : {}),
        text: value ? String(value) : '·'
      });
    }

    var tb = U.el('tbody');
    members.forEach(function (m) {
      var c = counts[m];
      var tr = U.el('tr', {}, [U.el('td', { class: 'col-pin' }, [U.el('b', { text: m })])]);
      EXP_RESOURCES.forEach(function (r) {
        EXP_KUBUNS.forEach(function (k, ki) { tr.appendChild(cell(c[r + '|' + k] || 0, ki === 0)); });
      });
      EXP_KUBUNS.forEach(function (k, ki) {
        var total = U.sum(EXP_RESOURCES, function (r) { return c[r + '|' + k] || 0; });
        tr.appendChild(cell(total, ki === 0, true));
      });
      tb.appendChild(tr);
    });

    return U.el('div', { class: 'card mt16' }, [
      U.el('div', { class: 'card-head' }, [
        U.el('h3', { text: '経験本数（新規／修正）' }),
        U.el('span', { class: 'sub', text: '製造タスク・全期間／リソース区分 ' + EXP_RESOURCES.join('・') + ' のみ' })
      ]),
      U.el('div', { class: 'table-wrap' }, [U.el('table', { class: 'grid-table' }, [U.el('thead', {}, [gh, ch]), tb])])
    ]);
  }

  function exportCsv(members, months) {
    var head = ['氏名'].concat(months.map(function (mk) { return parseInt(mk.split('-')[1], 10) + '月'; }));
    var lines = [head.join(',')];
    members.forEach(function (m) {
      lines.push([m].concat(months.map(function (mk) { return (State.entries[m] || {})[mk] || ''; })).join(','));
    });
    U.download('実績入力確認.csv', new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
  }
})(window);
