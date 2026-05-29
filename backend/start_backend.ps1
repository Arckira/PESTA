$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$venvPython = Join-Path (Split-Path $projectRoot -Parent) '.venv\Scripts\python.exe'
$hostAddress = '127.0.0.1'
$portNumber = 8000

function Stop-StaleBackendProcess {
    param(
        [int]$Port
    )

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) {
        return
    }

    $seenProcessIds = @{}
    foreach ($listener in $listeners) {
        $processId = [int]$listener.OwningProcess
        if ($seenProcessIds.ContainsKey($processId)) {
            continue
        }
        $seenProcessIds[$processId] = $true

        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $processInfo) {
            continue
        }

        if ($processInfo.CommandLine -match 'uvicorn' -or $processInfo.CommandLine -match 'app\.main:app' -or $processInfo.CommandLine -match 'main:app') {
            Write-Host "A terminar processo antigo na porta ${Port}: PID $processId"
            Stop-Process -Id $processId -Force
        }
    }
}

Stop-StaleBackendProcess -Port $portNumber

if (-not (Test-Path $venvPython)) {
    $venvPython = 'python'
}

Write-Host "A iniciar backend em http://$hostAddress`:$portNumber"
Start-Process -FilePath $venvPython -ArgumentList @(
    '-u',
    '-m',
    'uvicorn',
    'app.main:app',
    '--host',
    $hostAddress,
    '--port',
    $portNumber.ToString(),
    '--log-level',
    'info'
) -WorkingDirectory $projectRoot -WindowStyle Normal