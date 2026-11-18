# stdkit 安装 shim（PowerShell）：真正逻辑在 cli/lib/install.mjs（单实现，五端一致）
#   .\install.ps1 -Claude
#   .\install.ps1 -All -DryRun
#   .\install.ps1 -Uninstall
param(
  [switch]$Pi, [switch]$Claude, [switch]$Codex, [switch]$Cursor, [switch]$Copilot,
  [switch]$All, [switch]$DryRun, [switch]$Uninstall,
  [string]$Project
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$args = @("$here/cli/ds.mjs", 'install')

if ($Pi)      { $args += '--pi' }
if ($Claude)  { $args += '--claude' }
if ($Codex)   { $args += '--codex' }
if ($Cursor)  { $args += '--cursor' }
if ($Copilot) { $args += '--copilot' }
if ($All)     { $args += '--all' }
if ($DryRun)  { $args += '--dry-run' }
if ($Uninstall) { $args += '--uninstall' }
if ($Project) { $args += @('--project', $Project) }

& node @args
exit $LASTEXITCODE
