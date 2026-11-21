param([switch]$Create)
$ErrorActionPreference = 'Stop'
$parent = 'C:\Users\ppedr\AppData\Local'
$root = Join-Path $parent 'OdontoClass-Backups'
$expectedUser = New-Object System.Security.Principal.NTAccount('PDRX\ppedr')
$userSid = $expectedUser.Translate([System.Security.Principal.SecurityIdentifier]).Value
$trusted = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
$dangerous = [int64]([System.Security.AccessControl.FileSystemRights]::Write -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
function Audit-Directory([string]$Path, [bool]$Private) {
  $acl = Get-Acl -LiteralPath $Path
  $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -notin $trusted) { throw 'UNTRUSTED_OWNER' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Value
    $applies = -not ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly)
    $mutating = ([int64]$rule.FileSystemRights -band $dangerous) -ne 0
    if ($rule.AccessControlType -eq 'Allow' -and $applies -and $mutating -and $sid -notin $trusted) { throw 'UNTRUSTED_MUTATING_ACE' }
    if ($Private -and $rule.AccessControlType -eq 'Allow' -and $sid -notin $trusted) { throw 'NON_PRIVATE_ACE' }
  }
  if ($Private -and -not $acl.AreAccessRulesProtected) { throw 'INHERITANCE_ENABLED' }
  if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
  [pscustomobject]@{
    path=$Path; ownerSid=$ownerSid; inheritanceProtected=$acl.AreAccessRulesProtected
    untrustedMutationAllowed=$false
    rules=@($rules | ForEach-Object { [pscustomobject]@{ sid=$_.IdentityReference.Value; rights=$_.FileSystemRights.ToString(); type=$_.AccessControlType.ToString(); inherited=$_.IsInherited; inheritance=$_.InheritanceFlags.ToString(); propagation=$_.PropagationFlags.ToString() } })
  }
}
function New-PrivateDirectory([string]$Path) {
  if (Test-Path -LiteralPath $Path) { throw 'DESTINATION_ALREADY_EXISTS' }
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($userSid)))
  foreach ($sid in $trusted) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $security.AddAccessRule($rule)
  }
  $directory = New-Object System.IO.DirectoryInfo($Path)
  $directory.Create($security)
}
$ancestor = New-Object System.IO.DirectoryInfo($parent)
while ($null -ne $ancestor) {
  if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ANCESTOR_REPARSE_POINT' }
  $ancestor = $ancestor.Parent
}
$parentEvidence = Audit-Directory $parent $false
$parentEvidence | ConvertTo-Json -Depth 6
'BACKUP ROOT PARENT ACL: PASS'
if (-not $Create) { exit 0 }
$canonical = [IO.Path]::GetFullPath($root)
foreach ($syncRoot in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) {
  if (-not [string]::IsNullOrWhiteSpace($syncRoot)) {
    $sync = [IO.Path]::GetFullPath($syncRoot).TrimEnd('\') + '\'
    if ($canonical.StartsWith($sync, [StringComparison]::OrdinalIgnoreCase)) { throw 'CLOUD_SYNC_DESTINATION' }
  }
}
if ($canonical -match '(?i)\\OneDrive(?:[^\\]*)\\') { throw 'ONEDRIVE_DESTINATION' }
if (-not (Test-Path -LiteralPath $root)) { New-PrivateDirectory $root }
$rootEvidence = Audit-Directory $root $true
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$run = Join-Path $root ('production-' + $stamp)
New-PrivateDirectory $run
foreach ($name in @('database','storage','manifests','restore-rehearsal')) { New-PrivateDirectory (Join-Path $run $name) }
$runEvidence = Audit-Directory $run $true
foreach ($name in @('database','storage','manifests','restore-rehearsal')) { $null = Audit-Directory (Join-Path $run $name) $true }
$evidence = [ordered]@{ timestamp=$stamp; parent=$parentEvidence; root=$rootEvidence; run=$runEvidence; outsideOneDrive=$true; bitlocker='PASS - user supplied verified checkpoint, C: XTS-AES 128, Protection On' }
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'manifests\local-protection.json') -Encoding utf8
'BACKUP ROOT ACL: PASS'
'RUN DIRECTORY ACL: PASS'
'OUTSIDE ONEDRIVE: PASS'
'BITLOCKER: PASS (preserved checkpoint)'
'SECURE_RUN: ' + $run
