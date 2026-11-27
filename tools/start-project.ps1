param([string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $ProjectRoot
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'server.js'))) {
    Write-Host "server.js was not found in: $ProjectRoot"
    exit 1
}

$candidates = @()
$localRoot = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
if (Test-Path -LiteralPath $localRoot) {
    $candidates += Get-ChildItem -LiteralPath $localRoot -Directory -Filter 'node-v*-win-*' |
        Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'node.exe' }
}
$command = Get-Command node.exe -ErrorAction SilentlyContinue
if ($command) { $candidates += $command.Source }
$nodeExe = $null
foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
        $major = & $candidate -p 'parseInt(process.versions.node, 10)'
        if ($LASTEXITCODE -eq 0 -and [int]$major -ge 22) { $nodeExe = $candidate; break }
    }
}
if (-not $nodeExe) {
    Write-Host 'Node.js 22 or newer is required. Install Node.js and ensure node.exe is on PATH, or place it under %LOCALAPPDATA%\Programs\nodejs.'
    exit 1
}
Write-Host "Using Node.js: $nodeExe"
& $nodeExe (Join-Path $PSScriptRoot 'launch-project.cjs') $ProjectRoot
exit $LASTEXITCODE
