/* ============================================================
   views/io.js - 取込 / 出力
   ============================================================ */
(function (global) {
  'use strict';
  var Views = global.Views = global.Views || {};

  var mode = 'upsert';
  var csvType = 'mfg';

  function section(title, sub, nodes) {
    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card-head' }, [U.el('h3', { text: title }), sub ? U.el('span', { class: 'sub', text: sub }) : null]),
      U.el('div', { class: 'card-body' }, nodes)
    ]);
  }

  function modeSelector() {
    var box = U.el('div', { class: 'row-flex', style: { marginBottom: '10px' } }, [U.el('span', { class: 'muted strong', text: '取込方法:' })]);
    var seg = U.el('div', { class: 'seg' });
    [['upsert', '更新＋追加（推奨）'], ['append', 'すべて追加'], ['replace', '全件置換']].forEach(function (o) {
      seg.appendChild(U.el('button', { class: mode === o[0] ? 'on' : '', text: o[1], onclick: function () { mode = o[0]; App.render(); } }));
    });
    box.appendChild(seg);
    box.appendChild(U.el('span', {
      class: 'muted', style: { fontSize: '11px' },
      text: mode === 'upsert' ? '同じ「種別＋プログラムID＋案件名＋開始日」の行は上書き、無ければ追加します。'
        : mode === 'append' ? '重複判定せず、すべて新規行として追加します。'
          : '⚠ 既存データをすべて削除して置き換えます。'
    }));
    return box;
  }

  Views.io = {
    title: '取込 / 出力',
    desc: 'Excel・CSVの読み込みと書き出し',
    icon: '🔁',
    render: function (root) {
      root.appendChild(section('📂 フォルダ内のExcelを取込', State.folder, [
        modeSelector(),
        (function () {
          var list = U.el('div');
          list.appendChild(U.el('div', { class: 'muted', text: '読み込み中…' }));
          API.files().then(function (r) {
            U.clear(list);
            if (!r.files.length) {
              list.appendChild(U.el('div', { class: 'empty', text: 'このフォルダにExcelファイルがありません' }));
              return;
            }
            r.files.forEach(function (f) {
              list.appendChild(U.el('div', { class: 'file-row' }, [
                U.el('span', { style: { fontSize: '18px' }, text: '📊' }),
                U.el('div', { class: 'grow' }, [
                  U.el('div', { class: 'fname', text: f.name }),
                  U.el('div', { class: 'muted', style: { fontSize: '11px' }, text: Math.round(f.size / 1024) + ' KB / 更新 ' + new Date(f.mtime * 1000).toLocaleString('ja-JP') })
                ]),
                U.el('button', {
                  class: 'btn btn-primary btn-sm', text: '取り込む',
                  onclick: function () { doExcelImport(f.name); }
                })
              ]));
            });
          }).catch(function (e) {
            U.clear(list);
            list.appendChild(U.el('div', { class: 'empty', text: 'ファイル一覧の取得に失敗: ' + e.message }));
          });
          return list;
        })(),
        U.el('p', { class: 'muted', style: { fontSize: '11.5px' }, html: 'シート名「製造」「詳細設計」「実績入力確認」を自動判別して取り込みます。列見出しは自動マッピングされます（「例）」の行は除外）。' })
      ]));

      root.appendChild(section('📥 CSVを取込', 'Excelで編集したCSVをそのまま読み込めます', [
        (function () {
          var seg = U.el('div', { class: 'seg', style: { marginBottom: '10px' } });
          State.schema.types.forEach(function (t) {
            seg.appendChild(U.el('button', { class: csvType === t.key ? 'on' : '', text: t.label + 'として取込', onclick: function () { csvType = t.key; App.render(); } }));
          });
          return seg;
        })(),
        (function () {
          var zone = U.el('div', { class: 'dropzone', text: 'ここにCSVファイルをドロップ、またはクリックして選択' });
          var input = U.el('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
          input.addEventListener('change', function () { if (this.files[0]) readCsvFile(this.files[0]); });
          zone.addEventListener('click', function () { input.click(); });
          zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
          zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
          zone.addEventListener('drop', function (e) {
            e.preventDefault(); zone.classList.remove('over');
            if (e.dataTransfer.files[0]) readCsvFile(e.dataTransfer.files[0]);
          });
          return U.el('div', {}, [zone, input]);
        })(),
        U.el('div', { class: 'mt12' }, [
          U.el('label', { class: 'muted strong', text: 'または CSV / Excelからコピーした表を貼り付け' }),
          (function () {
            var ta = U.el('textarea', { placeholder: 'プログラムID,案件名,開始日,終了日,担当者①,...', style: { minHeight: '110px', marginTop: '4px' } });
            var btn = U.el('button', {
              class: 'btn btn-primary btn-sm mt8', text: '貼り付け内容を取込',
              onclick: function () {
                var text = ta.value.trim();
                if (!text) { U.toast('内容が空です', 'warn'); return; }
                if (text.indexOf('\t') >= 0 && text.indexOf(',') < 0) {
                  text = text.split('\n').map(function (l) {
                    return l.split('\t').map(function (c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(',');
                  }).join('\n');
                }
                importCsvText(text);
              }
            });
            return U.el('div', {}, [ta, btn]);
          })()
        ])
      ]));

      root.appendChild(section('📤 出力', '現在のデータを書き出します', [
        U.el('div', { class: 'row-flex' }, [
          U.el('button', { class: 'btn btn-primary', text: '📗 Excel一括出力 (.xlsx)', onclick: function () { location.href = '/api/export/excel'; } }),
          U.el('button', { class: 'btn', text: '📄 製造 CSV', onclick: function () { location.href = '/api/export/csv?type=mfg'; } }),
          U.el('button', { class: 'btn', text: '📄 詳細設計 CSV', onclick: function () { location.href = '/api/export/csv?type=dd'; } }),
          U.el('button', { class: 'btn', text: '💾 バックアップ(JSON)', onclick: function () { location.href = '/api/export/json'; } })
        ]),
        U.el('p', { class: 'muted', style: { fontSize: '11.5px' }, text: 'CSVはUTF-8(BOM付き)で出力されるため、Excelでそのまま開けます。' })
      ]));

      /* 復元は設定も上書きするため管理者のみ */
      if (State.isAdmin()) root.appendChild(section('♻ バックアップから復元', '書き出したJSONを読み込み、現在のデータを置き換えます（管理者のみ）', [
        (function () {
          var input = U.el('input', { type: 'file', accept: '.json,application/json' });
          var btn = U.el('button', {
            class: 'btn btn-danger btn-sm', text: '復元する', onclick: function () {
              var file = input.files[0];
              if (!file) { U.toast('ファイルを選択してください', 'warn'); return; }
              U.confirmDialog('復元確認', '現在のデータをすべて置き換えます。よろしいですか？', '復元する').then(function (ok) {
                if (!ok) return;
                var reader = new FileReader();
                reader.onload = function () {
                  var data;
                  try { data = JSON.parse(reader.result); }
                  catch (e) { U.toast('JSONの解析に失敗しました', 'err'); return; }
                  U.loading(true);
                  API.importJson(data).then(function () {
                    U.toast('復元しました', 'ok');
                    return State.refreshAll();
                  }).then(function () { App.render(); })
                    .catch(function (e) { U.toast(e.message, 'err'); })
                    .finally(function () { U.loading(false); });
                };
                reader.readAsText(file, 'utf-8');
              });
            }
          });
          return U.el('div', { class: 'row-flex' }, [input, btn]);
        })()
      ]));

      root.appendChild(U.el('div', { class: 'card mt12' }, [
        U.el('div', { class: 'card-head' }, [
          U.el('h3', { text: '🌐 チームで共有する' }),
          U.el('span', { class: 'sub', text: State.shared ? '共有モードで起動中' : 'ローカル専用で起動中' })
        ]),
        U.el('div', { class: 'card-body' }, [
          State.shared
            ? U.el('div', {}, [
              U.el('p', { text: '同じネットワークの人は、次のURLをブラウザで開けば利用できます。' }),
              U.el('div', { class: 'row-flex' }, [
                U.el('input', { type: 'text', readonly: true, value: location.origin + '/', style: { width: '340px' }, onclick: function () { this.select(); } }),
                U.el('button', {
                  class: 'btn btn-sm', text: 'URLをコピー', onclick: function () {
                    navigator.clipboard.writeText(location.origin + '/')
                      .then(function () { U.toast('コピーしました', 'ok'); })
                      .catch(function () { U.toast('コピーできませんでした', 'warn'); });
                  }
                })
              ]),
              U.el('p', { class: 'muted', style: { fontSize: '11.5px' }, text: 'このPC（サーバー役）の黒いコマンド画面を開いたままにしてください。閉じると全員がアクセスできなくなります。データは20秒ごとに自動同期され、他の人の更新が反映されます。' })
            ])
            : U.el('div', {}, [
              U.el('p', { text: '他の人にも使ってもらうには、フォルダ内の「管理ツール起動(共有).bat」で起動してください。' }),
              U.el('p', { class: 'muted', style: { fontSize: '11.5px' }, text: '起動すると黒い画面に共有用URL（http://<PC名またはIP>:8765/）が表示されます。そのURLをチームに伝えてください。社内ネットワーク内のみアクセスできます。' })
            ]),
          U.el('hr', { class: 'sep' }),
          U.el('div', { class: 'row-flex' }, [
            U.el('span', { class: 'muted', text: 'ログイン中:' }),
            U.el('strong', { text: State.account ? State.account.name + '（' + State.account.id + '）' : '—' }),
            U.el('span', { class: 'muted', style: { fontSize: '11px' }, text: 'ログイン中のユーザーが更新者として記録されます。' })
          ])
        ])
      ]));

      root.appendChild(U.el('div', { class: 'card mt12' }, [
        U.el('div', { class: 'card-body muted', style: { fontSize: '11.5px' } }, [
          U.el('div', { text: 'データベース: ' + (State.database || '(不明)') }),
          U.el('div', { text: '保存のたびに ' + (State.dataDir ? State.dataDir + '\\backup' : 'data\\backup') + ' へJSONスナップショットを保存します（最新' + State.backupKeep + '世代）。' }),
          U.el('div', { text: '最終更新: ' + (State.updatedAt || '—') })
        ])
      ]));
    }
  };

  /* 全件置換は既存データを消すため必ず確認を挟む */
  function confirmMode() {
    if (mode !== 'replace') return Promise.resolve(true);
    return U.confirmDialog('全件置換の確認',
      '登録済みのタスク ' + State.tasks.length + ' 件をすべて削除し、取込内容で置き換えます。\n' +
      '元に戻すには「バックアップから復元」が必要です。通常は「更新＋追加」を使ってください。', '置換する');
  }

  function doExcelImport(name) {
    confirmMode().then(function (ok) { if (ok) runExcelImport(name); });
  }

  function runExcelImport(name) {
    U.loading(true);
    API.importExcel(name, mode, true).then(function (r) {
      var detail = Object.keys(r.detail || {}).map(function (k) { return k + ' ' + r.detail[k] + '行'; }).join(' / ');
      U.toast('取込完了: 追加 ' + r.added + ' 件 / 更新 ' + r.updated + ' 件 (' + detail + ')', 'ok', 6000);
      return State.refreshAll();
    }).then(function () { App.render(); })
      .catch(function (e) { U.toast('取込失敗: ' + e.message, 'err', 6000); })
      .finally(function () { U.loading(false); });
  }

  /* Excelの「CSV(カンマ区切り)」は Shift_JIS で保存されるため、UTF-8 で読めなければ Shift_JIS として読む */
  function readCsvFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      var text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) {
        try {
          text = new TextDecoder('shift_jis').decode(bytes);
          U.toast('文字コードを Shift_JIS と判定して読み込みました', 'ok', 4000);
        } catch (e2) {
          U.toast('CSVの文字コードを判別できません。UTF-8 で保存し直してください。', 'err');
          return;
        }
      }
      importCsvText(text.replace(/^\uFEFF/, ''));
    };
    reader.readAsArrayBuffer(file);
  }

  function importCsvText(text) {
    confirmMode().then(function (ok) { if (ok) runCsvImport(text); });
  }

  function runCsvImport(text) {
    U.loading(true);
    API.importCsv(text, csvType, mode).then(function (r) {
      U.toast('CSV取込完了: 追加 ' + r.added + ' 件 / 更新 ' + r.updated + ' 件', 'ok', 5000);
      return State.refreshAll();
    }).then(function () { App.render(); })
      .catch(function (e) { U.toast('取込失敗: ' + e.message, 'err', 6000); })
      .finally(function () { U.loading(false); });
  }
})(window);
