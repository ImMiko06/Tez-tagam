$ErrorActionPreference = 'Stop'
$data = Join-Path (Split-Path $PSScriptRoot -Parent) '.postgres-data'
$bin = 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe'
if (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')) {
  & $bin stop -D $data -m fast -w
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось остановить PostgreSQL Tez Tagam.' }
} else {
  Write-Output 'PostgreSQL Tez Tagam уже остановлен.'
}
