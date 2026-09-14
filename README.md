# 業務管理ツール

開発プログラムの実績管理と、日々の業務予定・実績報告を1つにまとめた Web ツールです。
Python 標準ライブラリのみで動作するサーバーと、ビルド不要のフロントエンドで構成されています。

- **開発プログラム管理** — 製造／詳細設計タスクの登録、生産性・品質指標の自動計算、ガント／分析／クロス集計
- **業務予定管理** — 期間で取り組む予定を登録し、始業前に「今日やること」、終業前に「やったこと（工程＋進捗率）」を日次で記録

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

構文チェック → DBバックアップ → 転送 → 再ビルド → 稼働確認までを自動で行います。
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
| 設定 | 計算パラメータとマスタの編集 |

### 業務予定管理

| 画面 | 内容 |
| --- | --- |
| 日次入力 | ☀ 始業前（本日の予定）と 🌙 終業前（本日の実績＋工程＋進捗率）を左右2面で入力。チーム全員の入力状況も表示 |
| チーム予定ボード | 全員 × 日付のマトリクス。予定は塗り、実績は破線枠＋進捗率で表示 |
| 予定サマリ | 期間・軸を指定した集計、予定／実績の消化率と平均進捗率 |

---

## 日次入力の使い方

1. **始業前** — 「日次入力」を開き、左の ☀ シートに今日やる作業を行追加で入力（工程・案件・作業内容・予定工数）→ **保存**
2. **終業前** — 右の 🌙 シートで **「⇩ 予定から取り込む」** を押すと朝の予定が実績行にコピーされます。実績工数と **進捗率(%)** を入れて **保存**

- 工程は「作業区分」マスタ（設定画面で追加・色変更が可能）を使用します
- 未入力の場合は当日分に赤いバナーが出ます
- 画面下部でチーム全員の入力状況（始業前／終業前の ✓・未）を確認できます

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
    │       ├── tasks.py        plans.py      masters.py
    │       ├── entries.py      views.py
    │       └── exports.py      imports.py
    ├── core/
    │   ├── config.py           … 環境変数による設定
    │   ├── db.py               … SQLite エンジン
    │   ├── storage.py          … 業務データの読み書き
    │   ├── model.py            … 計算・正規化ロジック
    │   ├── excel_io.py         … Excel / CSV 入出力
    │   └── fields.json / masters.json / enums.json
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

- 業務データは **SQLite**（`store.sqlite3`）に保存されます。テーブルは `tasks` / `plans` / `entries` / `masters` / `saved_views` / `meta`
- 保存のたびに `data/backup/store_YYYYMMDD_HHMMSS.json` へスナップショットを書き出します（既定30世代）
- 書き込み後に WAL をチェックポイントするため、`store.sqlite3` を単体でコピーしてもデータは欠けません
- 旧 `store.json` は初回起動時に自動移行され、`store.json.migrated` にリネームされます

---

## インターネット公開前の注意

現状の実装には認証がありません。公開する場合は最低限、以下を先に実施してください。

1. リバースプロキシ（Caddy / nginx 等）で **TLS 終端** と **認証** を行う
2. `DPM_ALLOWED_HOSTS` を実際のドメインに限定する（既定の `*` は無制限）
3. `Content-Type: text/plain` によるクロスオリジン書き込み（CSRF）が成立するため、**Origin 検証または認証の追加**が必要
4. `X-User` ヘッダは検証されないため、更新者の記録は信頼できない

詳細は [docs/仕様書.md](docs/仕様書.md) の「セキュリティ」章を参照してください。

---

## 動作環境

| 項目 | 内容 |
| --- | --- |
| サーバー | Python 3.10 以降（標準ライブラリのみ。Excel 入出力のみ `openpyxl` が必要） |
| ブラウザ | Chromium 系 / Firefox / Edge の最新版 |
| コンテナ | `python:3.12-slim` ベース、非 root（uid 10001）で実行 |
