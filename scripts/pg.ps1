param(
  [ValidateSet("start", "stop", "status", "restart")]
  [string]$Action = "status"
)

# Local PostgreSQL cluster for Cue & Rail.
#
# Why a script: the cluster lives in C:\pg\cue\pgsql, started detached from the
# console. Opening it from a normal terminal would work, but the postmaster dies
# when that terminal closes. This always launches it detached.
#
# bin MUST be on PATH before postgres.exe starts. Without it every backend
# process dies on first connection with STATUS_DLL_INIT_FAILED (0xC0000142).

$ErrorActionPreference = "Stop"
$Root = "C:\pg\cue\pgsql"
$Bin = Join-Path $Root "bin"
$Data = Join-Path $Root "data"
$Log = Join-Path $Root "postgres.log"

if (-not (Test-Path (Join-Path $Bin "postgres.exe"))) {
  throw "PostgreSQL not found at $Root. See docs/LOCAL_DB.md."
}

$env:PATH = "$Bin;$(Join-Path $Root 'lib');" + $env:PATH

function Get-Postgres {
  Get-Process postgres -ErrorAction SilentlyContinue
}

function Test-Listening {
  $null -ne (Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue)
}

switch ($Action) {
  { $_ -in "start", "restart" } {
    if (Test-Listening) {
      Write-Host "already listening on 5432"
      break
    }
    # Clear a stale pid file left by a hard kill, or postgres refuses to start.
    Remove-Item (Join-Path $Data "postmaster.pid") -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath (Join-Path $Bin "postgres.exe") `
      -ArgumentList "-D", $Data, "-p", "5432", "-c", "timezone=Asia/Jakarta" `
      -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 4
    if (Test-Listening) {
      Write-Host "postgres listening on 5432  (log: $Log)"
    } else {
      Write-Host "FAILED to listen. Last log lines:"
      Get-Content $Log -Tail 15
      exit 1
    }
  }
  "stop" {
    Get-Postgres | Stop-Process -Force
    Write-Host "stopped"
  }
  "status" {
    $running = $null -ne (Get-Postgres)
    Write-Host "process: $(if ($running) { 'running' } else { 'stopped' })"
    Write-Host "port 5432: $(if (Test-Listening) { 'listening' } else { 'closed' })"
  }
}
