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

Write-Host "2. Preparando pacote leve para o Injetor..." -ForegroundColor Cyan
$injectorPayload = Join-Path $outputDir "injector_payload.zip"
Compress-Archive -Path "$repoDir\mod\*" -DestinationPath $injectorPayload -Force

Write-Host "3. Compilando Injetor Leve (DiscordModInjector.exe)..." -ForegroundColor Cyan
& $cscPath /nologo /target:winexe /win32icon:"$installerDir\app.ico" `
    /r:System.Windows.Forms.dll,System.Drawing.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll `
    /resource:"$injectorPayload",DiscordInjector.injector_payload.zip `
    /resource:"$installerDir\app.ico",app.ico `
    /out:"$outputDir\DiscordModInjector.exe" "$installerDir\InjectorProgram.cs"

Remove-Item $injectorPayload -Force -ErrorAction SilentlyContinue

Write-Host "`n[SUCESSO] Instaladores gerados em: $outputDir" -ForegroundColor Green
Get-ChildItem $outputDir | Select-Object Name, Length
