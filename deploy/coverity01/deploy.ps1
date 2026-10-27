<#
.SYNOPSIS
    coverity01 (172.30.4.89) へ第2開発管理ツールを更新デプロイします。

.DESCRIPTION
    1. ローカルで Python / JavaScript の構文チェック
    2. サーバー上のデータベースをバックアップ
    3. アプリ一式を転送してイメージを再ビルド・再起動
    4. ヘルスチェックで稼働確認

    data/ は転送対象外のため、業務データが上書きされることはありません。

.EXAMPLE
    .\deploy\coverity01\deploy.ps1
    通常の更新デプロイ。

.EXAMPLE
    .\deploy\coverity01\deploy.ps1 -SkipChecks
    構文チェックを省略（急ぎの場合のみ）。

.EXAMPLE
    .\deploy\coverity01\deploy.ps1 -Rollback
    直前のバックアップからデータベースを復元します。
#>
[CmdletBinding()]
param(
    [string]$SshHost = 'coverity01',
    [string]$RemoteDir = '/opt/docker/devops/dpm',
    [string]$Url = 'http://172.30.4.89:51400',
    [switch]$SkipChecks,
    [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Step([string]$text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Ng([string]$text) { Write-Host "  NG  $text" -ForegroundColor Red }

# ---------------------------------------------------------------- rollback
if ($Rollback) {
    Step 'データベースのロールバック'
    $latest = ssh $SshHost "ls -1t $RemoteDir/data/db-backup/*.sqlite3 2>/dev/null | head -1"
    if (-not $latest) { Ng 'バックアップが見つかりません'; exit 1 }
    Write-Host "  復元元: $latest"
    ssh $SshHost "cd $RemoteDir && docker compose stop && cp '$latest' data/store.sqlite3 && rm -f data/store.sqlite3-wal data/store.sqlite3-shm && docker compose start"
    Ok '復元しました'
    exit 0
}

# ------------------------------------------------------------ 1. 構文確認
if (-not $SkipChecks) {
    Step '1/5 ローカル構文チェック'
    Push-Location $repo
    try {
        python -m compileall -q tool\core tool\api tool\server.py
        if ($LASTEXITCODE -ne 0) { Ng 'Python の構文エラー'; exit 1 }
        Ok 'Python'

        if (Get-Command node -ErrorAction SilentlyContinue) {
            foreach ($js in Get-ChildItem tool\web\js -Recurse -Filter *.js) {
                node --check $js.FullName
                if ($LASTEXITCODE -ne 0) { Ng "JavaScript の構文エラー: $($js.Name)"; exit 1 }
            }
            Ok 'JavaScript'
        }
        else { Write-Host '  --  node が無いため JavaScript チェックは省略' -ForegroundColor DarkGray }
    }
    finally {
        Get-ChildItem $repo\tool -Recurse -Directory -Filter __pycache__ |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Pop-Location
    }
}
else { Step '1/5 構文チェック（省略）' }

# ---------------------------------------------------- 2. サーバー側バックアップ
Step '2/5 サーバー側データベースのバックアップ'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
ssh $SshHost "mkdir -p $RemoteDir/data/db-backup && cp $RemoteDir/data/store.sqlite3 $RemoteDir/data/db-backup/store_$stamp.sqlite3 && ls -1t $RemoteDir/data/db-backup/*.sqlite3 | tail -n +11 | xargs -r rm -f"
if ($LASTEXITCODE -ne 0) { Ng 'バックアップに失敗しました'; exit 1 }
Ok "store_$stamp.sqlite3 （最新10世代を保持）"

# ------------------------------------------------------------ 3. 転送
Step '3/5 アプリの転送'
$tar = Join-Path $env:TEMP 'dpm-app.tar.gz'
Remove-Item $tar -Force -ErrorAction SilentlyContinue
Push-Location $repo
try {
    tar -czf $tar --exclude=tool/data --exclude=__pycache__ --exclude=*.pyc `
        Dockerfile requirements.txt .dockerignore tool
    if ($LASTEXITCODE -ne 0) { Ng 'アーカイブ作成に失敗しました'; exit 1 }
}
finally { Pop-Location }
Ok ('{0:N0} bytes' -f (Get-Item $tar).Length)

scp -q $tar "${SshHost}:$RemoteDir/"
scp -q (Join-Path $PSScriptRoot 'docker-compose.yml') "${SshHost}:$RemoteDir/"
if ($LASTEXITCODE -ne 0) { Ng '転送に失敗しました'; exit 1 }
Ok '転送完了'
Remove-Item $tar -Force -ErrorAction SilentlyContinue

# -------------------------------------------------------- 4. ビルド・再起動
Step '4/5 ビルドと再起動'
ssh $SshHost "cd $RemoteDir && tar -xzf dpm-app.tar.gz && rm -f dpm-app.tar.gz && docker compose up -d --build 2>&1 | tail -12"
if ($LASTEXITCODE -ne 0) { Ng 'ビルドまたは起動に失敗しました'; exit 1 }

# ------------------------------------------------------------ 5. 稼働確認
Step '5/5 稼働確認'
# 社内プロキシを経由すると到達できないため直接接続する
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.UseProxy = $false
$opener = [System.Net.Http.HttpClient]::new($handler)
$opener.Timeout = [TimeSpan]::FromSeconds(10)
$healthy = $false
foreach ($i in 1..20) {
    Start-Sleep -Seconds 3
    try {
        $res = $opener.GetStringAsync("$Url/api/health").GetAwaiter().GetResult()
        if ($res -match '"ok"') { $healthy = $true; break }
    }
    catch { }
    Write-Host "  ... 起動待ち ($i/20)" -ForegroundColor DarkGray
}
if (-not $healthy) {
    Ng 'ヘルスチェックに失敗しました。ログを確認してください:'
    Write-Host "      ssh $SshHost `"cd $RemoteDir && docker compose logs --tail=50`""
    exit 1
}
Ok 'ヘルスチェック応答あり'

# データ取得はログイン必須のため、未ログインで拒否されることを確認する
$status = [int]$opener.GetAsync("$Url/api/bootstrap").GetAwaiter().GetResult().StatusCode
if ($status -ne 401) { Ng "未ログインのデータ取得が拒否されません (HTTP $status)"; exit 1 }
Ok 'ログイン必須（未ログインは 401）'
$py = @"
import sqlite3
c = sqlite3.connect('file:$RemoteDir/data/store.sqlite3?mode=ro', uri=True)
print(*[c.execute('select count(*) from ' + t).fetchone()[0] for t in ('tasks', 'plans', 'users')])
"@
$n = "$($py | ssh $SshHost python3 -)".Trim() -split '\s+'
Ok ("タスク {0} 件 / 予定・実績 {1} 件 / ユーザー {2} 名" -f $n[0], $n[1], $n[2])

ssh $SshHost "docker ps --filter name=dpm-tool --format '  {{.Names}} | {{.Status}} | {{.Ports}}'"

Write-Host "`nデプロイ完了: $Url/`n" -ForegroundColor Green
