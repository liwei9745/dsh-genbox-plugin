# Release helper: reads the tokens from a secure prompt so they never land in
# shell history, files or the chat transcript.
#
#   powershell -File scripts\publish-with-token.ps1            # dry run first
#   powershell -File scripts\publish-with-token.ps1 -Execute   # publish for real
param([switch]$Execute)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -AsSecureString $Prompt
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

Write-Host "Paste nothing into chat: this prompt keeps the tokens in memory only." -ForegroundColor Cyan
$env:GH_TOKEN = Read-Secret "GitHub token (classic, repo scope; blank to skip GitHub)"
$env:NPM_TOKEN = Read-Secret "npm token (Automation or Granular with publish rights)"

if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { Remove-Item Env:GH_TOKEN }
if ([string]::IsNullOrWhiteSpace($env:NPM_TOKEN)) { Remove-Item Env:NPM_TOKEN }

$argsList = @("scripts/publish.mjs")
if ($Execute) { $argsList += "--execute" }
node @argsList
$code = $LASTEXITCODE

Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:NPM_TOKEN -ErrorAction SilentlyContinue
exit $code
