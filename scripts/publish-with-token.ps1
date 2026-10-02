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

Write-Host "Paste nothing into chat: this prompt keeps every secret in memory only." -ForegroundColor Cyan
$env:GH_TOKEN = Read-Secret "GitHub token (classic, repo scope; blank to skip the GitHub steps)"
$env:NPM_TOKEN = Read-Secret "npm token (Automation / Granular with publish rights; blank to use the npm login you already did)"
$env:NPM_OTP = Read-Secret "npm one-time code from your authenticator (REQUIRED for a 2FA account, blank otherwise)"

# Assigning $null removes the variable without throwing; Remove-Item would fail when the
# prompt returned an empty string, because PowerShell drops empty environment variables.
if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { $env:GH_TOKEN = $null }
if ([string]::IsNullOrWhiteSpace($env:NPM_TOKEN)) { $env:NPM_TOKEN = $null }
if ([string]::IsNullOrWhiteSpace($env:NPM_OTP)) { $env:NPM_OTP = $null }

$argsList = @("scripts/publish.mjs")
if ($Execute) { $argsList += "--execute" }
node @argsList
$code = $LASTEXITCODE

$env:GH_TOKEN = $null
$env:NPM_TOKEN = $null
$env:NPM_OTP = $null
exit $code
