# Espace disque utilisé par CompagnonAI et ses outils.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ollama = if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $env:USERPROFILE '.ollama\models' }
$items = @(
  @('Cache du navigateur integre', (Join-Path $root 'data\electron')),
  @('Modeles 3D (models)', (Join-Path $root 'models')),
  @('Animations (motions)', (Join-Path $root 'motions')),
  @('Dependances (node_modules)', (Join-Path $root 'node_modules')),
  @('Modeles Ollama', $ollama),
  @('Cache npm (C:)', (Join-Path $env:LOCALAPPDATA 'npm-cache')),
  @('Cache Electron (C:)', (Join-Path $env:LOCALAPPDATA 'electron\Cache')),
  @('Fichiers temporaires (C:)', $env:TEMP)
)
foreach ($i in $items) {
  $path = $i[1]
  $go = 0
  if (Test-Path -LiteralPath $path) {
    $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($sum) { $go = [math]::Round($sum / 1GB, 2) }
  }
  '{0,-30} {1,8} Go   {2}' -f $i[0], $go, $path
}
