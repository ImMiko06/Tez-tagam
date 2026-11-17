$ErrorActionPreference = 'Stop'
$data = Join-Path (Split-Path $PSScriptRoot -Parent) '.postgres-data'
$bin = 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $bin)) { throw 'PostgreSQL 17 не найден в C:\Program Files\PostgreSQL\17.' }
if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) { throw 'Сначала инициализируйте базу по инструкции в README.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid'))) {
  & $bin start -D $data -o '-p 5433 -h 127.0.0.1' -l (Join-Path $data 'server.log') -w
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось запустить PostgreSQL Tez Tagam.' }
} else {
  Write-Output 'PostgreSQL Tez Tagam уже запущен на порту 5433.'
}
