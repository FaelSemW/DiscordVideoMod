$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Get-Content (Join-Path $root 'client\resources\build_info.json') -Raw | ConvertFrom-Json).version
$modules = Join-Path $root "profile\discord\$version\modules"
New-Item -ItemType Directory -Path $modules -Force | Out-Null
$manifest = @{}
Get-ChildItem (Join-Path $root 'client\modules') -Directory | ForEach-Object {
    Get-ChildItem $_.FullName -Directory | ForEach-Object {
        $target = Join-Path $modules $_.Name
        if (!(Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath $_.FullName -Destination $modules -Recurse }
        $manifest[$_.Name] = @{installedVersion=1}
    }
}
$manifestPath = Join-Path $modules 'installed.json'
if (!(Test-Path -LiteralPath $manifestPath)) { $manifest | ConvertTo-Json | Set-Content $manifestPath }
$index = Join-Path $modules 'discord_desktop_core\index.js'
$wrapper = @'
// Rafa video experiment loader v1
try {
  const path = require('path');
  const fs = require('fs');
  let modPath = process.env.RAFA_DISCORD_MOD_ROOT
    ? path.join(process.env.RAFA_DISCORD_MOD_ROOT, 'mod', 'main.cjs')
    : null;

  if (!modPath || !fs.existsSync(modPath)) {
    let cur = __dirname;
    for (let i = 0; i < 7; i++) {
      const candidate = path.join(cur, 'mod', 'main.cjs');
      if (fs.existsSync(candidate)) { modPath = candidate; break; }
      cur = path.dirname(cur);
    }
  }

  if (modPath && fs.existsSync(modPath)) {
    require(modPath);
  } else {
    for (const fb of [
      'C:\\Users\\Faelzinhown\\AppData\\Local\\RafaDiscord-Mod\\mod\\main.cjs',
      'D:\\discord\\mod\\main.cjs'
    ]) {
      if (fs.existsSync(fb)) { require(fb); break; }
    }
  }
} catch (error) { console.error('[Rafa video test] Loader failed:', error.message); }
module.exports = require('./core.asar');
'@
[IO.File]::WriteAllText($index, $wrapper, [Text.UTF8Encoding]::new($false))
