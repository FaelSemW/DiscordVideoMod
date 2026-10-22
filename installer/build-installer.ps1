param([string]$ClientDir)
# Script de compilacao dos Instaladores do Discord Mod
$ErrorActionPreference = 'Stop'

$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
    Write-Error "Compilador C# (csc.exe) nao encontrado no Windows."
}

$installerDir = $PSScriptRoot
$repoDir = Split-Path $installerDir -Parent
$outputDir = Join-Path $repoDir "dist"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

Write-Host "1. Compilando Inicializador silencioso (DiscordLauncher.exe)..." -ForegroundColor Cyan
& $cscPath /nologo /target:winexe /win32icon:"$installerDir\app.ico" /out:"$outputDir\DiscordLauncher.exe" "$installerDir\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar launcher' }

Write-Host "2. Preparando pacote leve para o Injetor..." -ForegroundColor Cyan
$injectorPayload = Join-Path $outputDir "injector_payload.zip"
Compress-Archive -Path "$repoDir\mod\*" -DestinationPath $injectorPayload -Force

Write-Host "3. Compilando Injetor Leve (DiscordModInjector.exe)..." -ForegroundColor Cyan
& $cscPath /nologo /target:winexe /win32icon:"$installerDir\app.ico" `
    /r:System.Windows.Forms.dll,System.Drawing.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll `
    "/resource:$injectorPayload,DiscordInjector.injector_payload.zip" `
    "/resource:$installerDir\app.ico,app.ico" `
    /out:"$outputDir\DiscordModInjector.exe" "$installerDir\InjectorProgram.cs"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar injetor' }

Remove-Item $injectorPayload -Force -ErrorAction SilentlyContinue

if ($ClientDir) {
    $ClientDir = (Resolve-Path -LiteralPath $ClientDir).Path
    if (!(Test-Path -LiteralPath (Join-Path $ClientDir 'Discord.exe'))) { throw 'ClientDir invalido' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stage = Join-Path $outputDir ('package-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -LiteralPath $ClientDir -Destination (Join-Path $stage 'client') -Recurse
    Copy-Item -LiteralPath (Join-Path $repoDir 'mod') -Destination (Join-Path $stage 'mod') -Recurse
    Copy-Item -LiteralPath (Join-Path $outputDir 'DiscordLauncher.exe') -Destination (Join-Path $stage 'Discord.exe')
    $payload = Join-Path $outputDir ('payload-' + [guid]::NewGuid().ToString('N') + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload)
    & $cscPath /nologo /target:winexe /win32icon:"$installerDir\app.ico" `
        /r:System.Windows.Forms.dll,System.Drawing.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll,Microsoft.CSharp.dll `
        "/resource:$payload,DiscordInstaller.payload.zip" "/resource:$installerDir\app.ico,app.ico" `
        /out:"$outputDir\DiscordModSetup.exe" "$installerDir\Program.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar instalador completo' }
    # Keep staging and payload for reproducible inspection; never include a user profile.
}

Write-Host "`n[SUCESSO] Instaladores gerados em: $outputDir" -ForegroundColor Green
Get-ChildItem $outputDir | Select-Object Name, Length
