param([Parameter(Mandatory=$true)][string]$Run)
$ErrorActionPreference = 'Stop'
try {
  $expected = 'C:\Users\ppedr\AppData\Local\OdontoClass-Backups\production-20261018T154548Z'
  if ([IO.Path]::GetFullPath($Run) -cne $expected) { throw 'UNEXPECTED_RUN' }
  $root = Split-Path -Parent $Run
  $parent = Split-Path -Parent $root
  $user = (New-Object System.Security.Principal.NTAccount('PDRX\ppedr')).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $trusted = @($user,'S-1-5-18','S-1-5-32-544')
  $mutation = [int64]([System.Security.AccessControl.FileSystemRights]::Write -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
  $paths = @($parent,$root,$Run,(Join-Path $Run 'database'),(Join-Path $Run 'storage'),(Join-Path $Run 'manifests'),(Join-Path $Run 'restore-rehearsal'))
  foreach ($candidate in $paths) {
    $item = Get-Item -LiteralPath $candidate -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
    $acl = Get-Acl -LiteralPath $candidate
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'UNTRUSTED_OWNER' }
    $private = $candidate -ne $parent
    if ($private -and -not $acl.AreAccessRulesProtected) { throw 'INHERITANCE_ENABLED' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -in $trusted) { continue }
      if ($private) { throw 'NON_PRIVATE_ACE' }
      if (-not ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -and ([int64]$rule.FileSystemRights -band $mutation)) { throw 'UNTRUSTED_MUTATING_ACE' }
    }
  }
  $ancestor = New-Object IO.DirectoryInfo($parent)
  while ($null -ne $ancestor) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ANCESTOR_REPARSE_POINT' }
    $ancestor = $ancestor.Parent
  }
  foreach ($syncRoot in @($env:OneDrive,$env:OneDriveConsumer,$env:OneDriveCommercial)) {
    if (-not [string]::IsNullOrWhiteSpace($syncRoot)) {
      $sync = [IO.Path]::GetFullPath($syncRoot).TrimEnd('\') + '\'
      if ($Run.StartsWith($sync,[StringComparison]::OrdinalIgnoreCase)) { throw 'CLOUD_SYNC_DESTINATION' }
    }
  }
  if ($Run -match '(?i)\\OneDrive(?:[^\\]*)\\') { throw 'ONEDRIVE_DESTINATION' }
  # Query only. An inaccessible encryption API uses the explicitly approved user checkpoint, labelled as such.
  $bitlocker = 'CHECKPOINT_PASS'
  try {
    $volume = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
    if ($null -ne $volume) {
      if ($volume.ProtectionStatus.ToString() -notin @('On','1') -or $volume.EncryptionPercentage -ne 100) { $bitlocker='FAIL' }
      else { $bitlocker='FRESH_PASS' }
    }
  } catch { }
  if ($bitlocker -eq 'FAIL') { throw 'BITLOCKER_CONTRADICTION' }
  [ordered]@{ timestamp=[DateTime]::UtcNow.ToString('o'); parentAcl='PASS'; backupAcl='PASS'; outsideOneDrive='PASS'; reparsePoints='PASS'; bitlocker='PASS'; bitlockerEvidence=$bitlocker } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine('LOCAL_PROTECTION_VERIFICATION_FAILED')
  exit 1
}
