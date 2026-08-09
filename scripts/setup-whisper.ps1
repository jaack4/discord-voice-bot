param(
    [ValidateSet('auto', 'cuda', 'cpu')]
    [string]$Backend = 'auto'
)

$ErrorActionPreference = 'Stop'
$release = 'v1.9.2'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'whisper_runtime'))
$binRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'bin'))
$modelRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'models'))

if (-not $runtimeRoot.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to install Whisper outside the project directory.'
}

if ($Backend -eq 'auto') {
    $hasNvidia = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
    $Backend = if ($hasNvidia) { 'cuda' } else { 'cpu' }
}

if ($Backend -eq 'cuda') {
    $archiveName = 'whisper-cublas-11.8.0-bin-x64.zip'
    $archiveSha256 = '1776668730f5594a0b15f930225779e863dd8280397f9ee7c6e47ccf82bbb203'
} else {
    $archiveName = 'whisper-bin-x64.zip'
    $archiveSha256 = '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a'
}

$archiveUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/$release/$archiveName"
$modelName = 'ggml-base.en.bin'
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelName"
$modelSha1 = '137c40403d78fd54d454da0f9bd998f78703390c'
$downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'discord-bot-whisper-setup'
$archivePath = Join-Path $downloadRoot $archiveName
$modelPath = Join-Path $modelRoot $modelName

New-Item -ItemType Directory -Force -Path $downloadRoot, $binRoot, $modelRoot | Out-Null

function Get-VerifiedDownload {
    param(
        [Parameter(Mandatory)] [string]$Uri,
        [Parameter(Mandatory)] [string]$Destination,
        [Parameter(Mandatory)] [string]$Sha256,
        [Parameter(Mandatory)] [string]$Description
    )

    if (Test-Path -LiteralPath $Destination) {
        $cachedHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($cachedHash -eq $Sha256) {
            Write-Host "Using cached $Description."
            return
        }
    }

    Write-Host "Downloading $Description..."
    Invoke-WebRequest -Uri $Uri -OutFile $Destination
    $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $Sha256) {
        throw "$Description checksum mismatch: $actualHash"
    }
}

Get-VerifiedDownload -Uri $archiveUrl -Destination $archivePath `
    -Sha256 $archiveSha256 -Description "whisper.cpp $release ($Backend)"
Expand-Archive -LiteralPath $archivePath -DestinationPath $binRoot -Force
$server = Get-ChildItem -LiteralPath $binRoot -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1
if (-not $server) {
    throw 'whisper-server.exe was not present in the downloaded release.'
}
if ($server.Directory.FullName -ne $binRoot) {
    Get-ChildItem -LiteralPath $server.Directory.FullName -File |
        Copy-Item -Destination $binRoot -Force
    $server = Get-Item -LiteralPath (Join-Path $binRoot 'whisper-server.exe')
}

if ($Backend -eq 'cuda') {
    # The whisper.cpp CUDA archive ships its backend but not NVIDIA's separately
    # licensed cuBLAS redistributables. Keep them local to the bot runtime.
    $cublasArchiveName = 'libcublas-windows-x86_64-11.11.3.6-archive.zip'
    $cublasArchivePath = Join-Path $downloadRoot $cublasArchiveName
    $cublasUrl = "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/$cublasArchiveName"
    $cublasSha256 = '67b0934a6359e4ee26fff823c356021589d392c4fd49ca12624f570edc08e2b9'
    $cublasExtractRoot = Join-Path $downloadRoot 'libcublas-11.11.3.6'

    Get-VerifiedDownload -Uri $cublasUrl -Destination $cublasArchivePath `
        -Sha256 $cublasSha256 -Description 'NVIDIA cuBLAS 11.11.3.6 redistributable'
    New-Item -ItemType Directory -Force -Path $cublasExtractRoot | Out-Null
    Expand-Archive -LiteralPath $cublasArchivePath -DestinationPath $cublasExtractRoot -Force

    foreach ($dllName in @('cublas64_11.dll', 'cublasLt64_11.dll')) {
        $dll = Get-ChildItem -LiteralPath $cublasExtractRoot -Recurse -Filter $dllName |
            Select-Object -First 1
        if (-not $dll) {
            throw "$dllName was not present in the NVIDIA cuBLAS redistributable."
        }
        Copy-Item -LiteralPath $dll.FullName -Destination $binRoot -Force
    }
}

if (-not (Test-Path -LiteralPath $modelPath)) {
    Write-Host 'Downloading Whisper base.en model (about 142 MiB)...'
    Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath
}
$actualModelHash = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA1).Hash.ToLowerInvariant()
if ($actualModelHash -ne $modelSha1) {
    throw "Whisper model checksum mismatch: $actualModelHash"
}

Write-Host ''
Write-Host 'Local Whisper setup complete.'
Write-Host "Server: $($server.FullName)"
Write-Host "Model:  $modelPath"
Write-Host "Backend: $Backend"
