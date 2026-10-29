# 第2開発管理ツール

開発プログラムの実績管理と、日々の業務予定・実績報告を1つにまとめた Web ツールです。
Python 標準ライブラリのみで動作するサーバーと、ビルド不要のフロントエンドで構成されています。

- **開発プログラム管理** — 製造／詳細設計タスクの登録、生産性・品質指標の自動計算、ガント／分析／クロス集計
- **業務予定管理** — 期間で取り組む予定を登録し、始業前に「今日やること」、終業前に「やったこと（工程＋進捗率）」を日次で記録
- **ログイン・権限** — ID／パスワードでログイン。ユーザー管理・設定編集・バックアップ復元・取込の全件置換・タスク一括削除は管理者のみ。業務予定は一般ユーザーは自分の分のみ入力可

📖 **利用者向けの説明書 → [docs/使い方ガイド.md](docs/使い方ガイド.md)**
（設定画面の項目がどの画面に反映されるかの対応表を含みます）
📐 詳細仕様 → [docs/仕様書.md](docs/仕様書.md)
🗺 画面遷移図 → [docs/画面遷移図.md](docs/画面遷移図.md)

---

## クイックスタート

### Windows（ローカル）

```
管理ツール起動.bat          … 自分だけで使う（http://localhost:8765/）
管理ツール起動(共有).bat     … 同じ社内ネットワークのメンバーにも公開
```

Python 3.10 以降が必要です。初回起動時に `openpyxl`（Excel 入出力用）を自動インストールします。

### Docker

```bash
docker compose up -d --build
# → http://localhost:8080/
```

データは `dpm-data` ボリューム（コンテナ内 `/data`）に保存されます。

| 用途 | 置き場所 |
| --- | --- |
| データベース | `/data/store.sqlite3` |
| バックアップ | `/data/backup/store_*.json` |
| ログ | `/data/server.log` |
| 取込用 Excel | `/data/files/*.xlsx` |

既存データを引き継ぐ場合は、旧 `store.json` を `/data/` に置いて起動すると自動で SQLite に移行されます。

### 社内サーバー（coverity01）

**稼働 URL: http://172.30.4.89:51400/**

| 項目 | 値 |
| --- | --- |
| ホスト | coverity01 (172.30.4.89) / Rocky Linux 9.4 |
| 配置先 | `/opt/docker/devops/dpm/` |
| 永続データ | `/opt/docker/devops/dpm/data/`（`store.sqlite3` / `backup/` / `server.log` / `files/`） |
| コンテナ名 | `dpm-tool`（`restart: unless-stopped`） |
| 実行ユーザー | `1000:1000`（ホストの `kanri` に合わせる） |
| 定義ファイル | [deploy/coverity01/docker-compose.yml](deploy/coverity01/docker-compose.yml) |

更新をデプロイする場合:

```powershell
.\deploy\coverity01\deploy.ps1
```

構文チェック → DBバックアップ → 転送 → 再ビルド → 稼働確認（ヘルスチェック・未ログイン拒否・データ件数）までを自動で行います。
`data/` は転送対象外のため、業務データが上書きされることはありません。

| オプション | 用途 |
| --- | --- |
| （なし） | 通常の更新デプロイ |
| `-SkipChecks` | 構文チェックを省略 |
| `-Rollback` | 直前のバックアップからデータベースを復元 |

運用コマンド:

```powershell
ssh coverity01 "cd /opt/docker/devops/dpm && docker compose logs -f --tail=50"   # ログ監視
ssh coverity01 "cd /opt/docker/devops/dpm && docker compose restart"             # 再起動
ssh coverity01 "cd /opt/docker/devops/dpm && docker compose down"                # 停止
```

`~/.ssh/config` に `Host coverity01`（`User kanri`、`IdentityFile ~/.ssh/id_coverity01`）を登録済みです。

---

## 画面

### 開発プログラム管理

| 画面 | 内容 |
| --- | --- |
| ダッシュボード | 進行中・遅延・今月完了・生産性・品質のサマリ |
| 一覧・入力 | 全タスクの表形式編集（ダブルクリックでセル編集、詳細ドロワー） |
| 担当者ビュー | 担当者ごとの稼働状況・当日の予定／実績 |
| ガントチャート | 担当者／案件／リソース区分でグルーピングした期間俯瞰 |
| 分析 | 観点（担当者・案件・月など）× 指標のグラフ集計 |
| クロス集計 | 任意2軸のピボットテーブル |
| 実績入力確認 | 担当者 × 月の入力状況マトリクス |
| 取込 / 出力 | Excel・CSV の取込、Excel／CSV／JSON の出力、バックアップ復元 |
| 設定 | ユーザー管理、計算パラメータとマスタの編集（管理者のみ） |

### 業務予定管理

| 画面 | 内容 |
| --- | --- |
| 取組み予定 | 一定期間取り組む作業を登録し、日次の実績を紐づけて進捗を追跡（取組み予定の登録はこの画面のみ）。開発タスクとの紐付けは担当者のタスクから選択 |
| 日次入力 | 1作業＝1行の **予実一体シート**。左に ☀ 予定（始業前）、右に 🌙 実績（終業前：実績工数＋進捗率＋状況）を同じ行で入力。予定の合計が 7.5h 未満なら警告。前回の入力を参照表示。チーム全員の入力状況（管理者のみ） |
| チーム予定ボード | 全員 × 日付のマトリクス（7 / 14 日）。日付ごとに ☀ 予定・🌙 実績の 2 列で、予定は塗り、実績は破線枠＋進捗率で表示 |
| 定例予定 | 毎週の会議など決まった曜日の予定を期間指定でまとめて登録（日次入力・チーム予定ボードから） |
| 予定サマリ | 期間・軸を指定した集計、予定／実績の消化率と平均進捗率 |

---

## ログインと権限

- 初期ユーザーは `tool/core/users.json` に定義し、DB の `users` テーブルが空のとき（初回起動時）に自動登録されます
- **初期パスワードは ID と同じ** です。ログイン後、右上のアカウントメニューから各自変更してください
- 管理者（`admin`）はユーザーの追加・編集・削除・パスワード初期化、設定の編集、バックアップ復元ができます
- 特権管理者（`owner`）は管理者と同じ権限を持ち、閲覧主体のユーザー向けです。担当者には含まれず、日次入力・実績入力確認・担当者一覧の対象になりません
- 一般（`user`）はタスク・予定の登録と編集、Excel / CSV 取込（全件置換を除く）、出力ができます。タスクの一括削除はできません。ただし業務予定（日次入力・取組み予定）は自分の担当者の分のみ登録・変更できます（他の人の分は閲覧のみ）。右上の横断検索は表示されません（管理者のみ、検索に対応した画面で表示）
- セッションは署名付き Cookie（`HttpOnly; SameSite=Strict`）で、既定 12 時間有効（`DPM_SESSION_HOURS`）
- ユーザー情報は JSON バックアップに含まれません。`store.sqlite3` のバックアップで保全してください

---

## 日次入力の使い方

1. **始業前** — 「日次入力」を開き、「＋ 作業を追加（予定）」で今日やる作業を1行ずつ入力（工程・案件・作業内容・予定h）→ **💾 保存**（Ctrl+S）
2. **終業前** — 同じ行の右側（🌙 実績）に **進捗率** をボタン（0/25/50/75/100）で入れて **💾 保存**。実績h が空なら予定h がそのまま実績になります
3. 予定していなかった作業は「＋ 予定外の作業を追加（実績のみ）」で追加します

- 工程は「作業区分」マスタ（設定画面で追加・色変更が可能）を使用します
- 進捗率 100 で状況が自動的に「完了」になります。実績h と進捗率を空に戻して保存すると実績だけを取り消せます
- 未保存の変更があるうちは自動更新を止め、日付・担当者の切替やページ離脱時に確認します
- その日の予定がすべて工程「休暇」なら、終業前入力は不要として ✓ 扱いになります
- 表の下に前回（直近の入力日）の入力内容を参照用に表示します（編集不可）
- 管理者は画面下部でチーム全員の入力状況（始業前／終業前の ✓・未）を確認でき、行クリックでその人の入力に切り替えられます

---

## 設定（環境変数）

すべて省略可能です。コマンドライン引数が環境変数より優先されます。

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `DPM_HOST` | `127.0.0.1` | 待ち受けアドレス。コンテナでは `0.0.0.0` |
| `DPM_PORT` | `8765` | 待ち受けポート。コンテナでは `8080` |
| `DPM_PORT_SCAN` | `20` | 使用中の場合に試す後続ポート数 |
| `DPM_DATA_DIR` | `tool/data` | DB・バックアップ・ログの保存先 |
| `DPM_FILES_DIR` | リポジトリ直下 | 取込対象の Excel を置くフォルダ |
| `DPM_WEB_DIR` | `tool/web` | 静的ファイルの配置場所 |
| `DPM_ALLOWED_HOSTS` | （空＝制限なし） | 許可する Host ヘッダ。`*` で無制限 |
| `DPM_READ_ONLY` | `0` | `1` で閲覧専用（更新系 API を 403） |
| `DPM_OPEN_BROWSER` | `1` | 起動時にブラウザを開く |
| `DPM_BACKUP_KEEP` | `30` | JSON スナップショットの保持世代数（`0` で無効） |
| `DPM_MAX_BODY` | `67108864` | リクエストボディ上限（バイト） |
| `DPM_SESSION_HOURS` | `12` | ログインセッションの有効時間 |

### コマンドライン

```bash
python server.py --port 8765          # ポート指定
python server.py --share              # LAN に公開
python server.py --read-only          # 閲覧専用
python server.py --data D:\shared     # データ保存先を変更
python server.py --no-browser         # ブラウザを開かない
python server.py --routes             # 登録済み API 一覧を表示して終了
```

---

## ディレクトリ構成

```
├── Dockerfile / docker-compose.yml / requirements.txt
├── 管理ツール起動.bat / 管理ツール起動(共有).bat
├── docs/仕様書.md              … 詳細仕様
├── docs/画面遷移図.md            … 画面構成と遷移経路
└── tool/
    ├── server.py               … HTTP 通信のみを担当
    ├── api/
    │   ├── router.py           … パスルーター
    │   ├── http.py             … Request / Response
    │   ├── static_files.py     … 静的配信
    │   └── features/           … 機能ごとに独立したモジュール
    │       ├── meta.py         … bootstrap / version / health / files
    │       ├── account.py      … ログイン / ログアウト / パスワード変更
    │       ├── users.py        … ユーザー管理（管理者のみ）
    │       ├── tasks.py        plans.py      masters.py
    │       ├── entries.py      views.py
    │       └── exports.py      imports.py
    ├── core/
    │   ├── config.py           … 環境変数による設定
    │   ├── auth.py             … パスワード・セッション・ユーザー管理
    │   ├── db.py               … SQLite エンジン
    │   ├── storage.py          … 業務データの読み書き
    │   ├── model.py            … 計算・正規化ロジック
    │   ├── excel_io.py         … Excel / CSV 入出力
    │   └── fields.json / masters.json / enums.json / users.json（初期ユーザー）
    └── web/                    … フロントエンド（ビルド不要）
```

### 機能を追加するには

`tool/api/features/` に `router` を公開したモジュールを1つ置くだけで自動登録されます。

```python
from ..http import Request, Response, json_response
from ..router import Router

router = Router()

@router.get("/api/example")
def example(_req: Request) -> Response:
    return json_response({"ok": True})
```

登録結果は `python server.py --routes` で確認できます。

---

## データとバックアップ

- 業務データは **SQLite**（`store.sqlite3`）に保存されます。テーブルは `tasks` / `plans` / `entries` / `masters` / `saved_views` / `users` / `meta`
- 保存のたびに `data/backup/store_YYYYMMDD_HHMMSS.json` へスナップショットを書き出します（既定30世代）
- 書き込み後に WAL をチェックポイントするため、`store.sqlite3` を単体でコピーしてもデータは欠けません
- 旧 `store.json` は初回起動時に自動移行され、`store.json.migrated` にリネームされます

---

## インターネット公開前の注意

ログイン機能はありますが、社内 LAN での利用を前提とした簡易なものです。公開する場合は最低限、以下を先に実施してください。

1. リバースプロキシ（Caddy / nginx 等）で **TLS 終端** を行う（平文 HTTP ではパスワードが盗聴され得る）
2. `DPM_ALLOWED_HOSTS` を実際のドメインに限定する（既定の `*` は無制限）
3. 初期パスワード（ID と同じ）を全員が変更済みであることを確認する
4. ログイン試行回数の制限・アカウントロックは無いため、必要なら前段で制限する

詳細は [docs/仕様書.md](docs/仕様書.md) の「セキュリティ」章を参照してください。

---

## 動作環境

| 項目 | 内容 |
| --- | --- |
| サーバー | Python 3.10 以降（標準ライブラリのみ。Excel 入出力のみ `openpyxl` が必要） |
| ブラウザ | Chromium 系 / Firefox / Edge の最新版 |
| コンテナ | `python:3.12-slim` ベース、非 root（uid 10001）で実行 |
