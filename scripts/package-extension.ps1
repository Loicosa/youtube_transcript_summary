$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$workspace = $root.Path
$manifest = Get-Content -LiteralPath (Join-Path $workspace "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

$dist = Join-Path $workspace "dist"
$packageName = "youtube-transcript-retriever-$version"
$packageRoot = Join-Path $dist $packageName
$zipPath = Join-Path $dist "$packageName.zip"

function Assert-InWorkspace($Path) {
  $resolvedParent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $resolvedParent)) {
    New-Item -ItemType Directory -Path $resolvedParent | Out-Null
  }

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside workspace: $fullPath"
  }

  return $fullPath
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null

$checkedPackageRoot = Assert-InWorkspace $packageRoot
$checkedZipPath = Assert-InWorkspace $zipPath

if (Test-Path -LiteralPath $checkedPackageRoot) {
  Remove-Item -LiteralPath $checkedPackageRoot -Recurse -Force
}

if (Test-Path -LiteralPath $checkedZipPath) {
  Remove-Item -LiteralPath $checkedZipPath -Force
}

New-Item -ItemType Directory -Path $checkedPackageRoot | Out-Null

$runtimeFiles = @(
  "manifest.json",
  "background.js",
  "content-script.js",
  "transcript.js",
  "settings.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "LICENSE"
)

$requiredIcons = @(
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
)

$missingIcons = @($requiredIcons | Where-Object { -not (Test-Path -LiteralPath (Join-Path $workspace $_)) })
if ($missingIcons.Count -gt 0) {
  Write-Output "Runtime icons are missing; generating assets..."
  $assetScript = Join-Path $workspace "scripts/generate-assets.py"
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    & $python.Source $assetScript
  } else {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if (-not $py) {
      throw "Python is required to generate missing extension icons. Install Python or run scripts/generate-assets.py manually."
    }
    & $py.Source -3 $assetScript
  }
}

foreach ($file in $runtimeFiles) {
  Copy-Item -LiteralPath (Join-Path $workspace $file) -Destination (Join-Path $checkedPackageRoot $file)
}

Copy-Item -LiteralPath (Join-Path $workspace "icons") -Destination (Join-Path $checkedPackageRoot "icons") -Recurse

Compress-Archive -Path (Join-Path $checkedPackageRoot "*") -DestinationPath $checkedZipPath -CompressionLevel Optimal

$zip = Get-Item -LiteralPath $checkedZipPath
Write-Output "Created $($zip.FullName)"
Write-Output "Size: $([math]::Round($zip.Length / 1KB, 1)) KB"
