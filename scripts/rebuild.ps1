# Rebuild the plugin, working around an environment quirk seen on this machine:
# the build output directory (lib) occasionally ends up owned by BUILTIN\Administrators
# - some elevated process writes into it - and then tsdown's --clean step cannot delete
# its files ("access denied, os error 5"). The signed-in user still has delete-child
# rights from the repository root, so moving the directory aside is enough.
#
#   powershell -File scripts\rebuild.ps1
param(
  # Move the output directory aside even when it looks writable.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$lib = Join-Path (Get-Location) 'lib'

if (Test-Path $lib) {
  $blocked = $false
  $files = Get-ChildItem $lib -Recurse -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $owner = (Get-Acl $file.FullName).Owner
    if ($owner -ne $me) { $blocked = $true; break }
  }
  $dirOwner = (Get-Acl $lib).Owner
  if ($blocked -or $Force -or ($files.Count -eq 0 -and $dirOwner -ne $me)) {
    $target = 'lib-locked-' + (Get-Date -Format 'yyyyMMddHHmmss')
    Rename-Item $lib $target
    Write-Host ("moved the output directory aside: " + $target)
    Write-Host "  (it needs an administrator shell to delete: takeown /f .\$target /r /d y && icacls .\$target /grant "$env:USERNAME:(F)" /t && rmdir /s /q .\$target)"
  } else {
    Write-Host "output directory is writable, building in place"
  }
}

& corepack pnpm run build
exit $LASTEXITCODE
