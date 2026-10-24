param(
  [Parameter(Mandatory = $true)]
  [string]$UserDataDir
)

$ErrorActionPreference = 'Stop'

function Get-ChromeProcessTree {
  param(
    [string]$TargetUserDataDir
  )

  $escaped = [regex]::Escape($TargetUserDataDir)
  $all = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'")
  if ($all.Count -eq 0) {
    return @{ pids = @() }
  }

  $byPid = @{}
  $children = @{}
  foreach ($proc in $all) {
    $byPid[$proc.ProcessId] = $proc
    $parentId = $proc.ParentProcessId
    if (-not $children.ContainsKey($parentId)) {
      $children[$parentId] = @()
    }
    $children[$parentId] += $proc
  }

  $matched = @($all | Where-Object { $_.CommandLine -and ($_.CommandLine -match $escaped) })
  if ($matched.Count -eq 0) {
    return @{ pids = @() }
  }

  $roots = New-Object System.Collections.Generic.List[object]
  foreach ($proc in $matched) {
    $root = $proc
    while ($true) {
      $parent = $null
      if ($byPid.ContainsKey($root.ParentProcessId)) {
        $parent = $byPid[$root.ParentProcessId]
      }
      if (-not $parent -or $parent.Name -ne 'chrome.exe') {
        break
      }
      $root = $parent
    }

    $existingRootIds = @($roots | ForEach-Object { $_.ProcessId })
    if ($existingRootIds -notcontains $root.ProcessId) {
      [void]$roots.Add($root)
    }
  }

  $tree = New-Object System.Collections.Generic.List[object]
  $stack = New-Object System.Collections.Stack
  foreach ($root in $roots) {
    $stack.Push($root)
  }

  while ($stack.Count -gt 0) {
    $proc = $stack.Pop()
    $existingIds = @($tree | ForEach-Object { $_.ProcessId })
    if ($existingIds -contains $proc.ProcessId) {
      continue
    }
    [void]$tree.Add($proc)
    if ($children.ContainsKey($proc.ProcessId)) {
      foreach ($child in $children[$proc.ProcessId]) {
        $stack.Push($child)
      }
    }
  }

  @{
    pids = @($tree | ForEach-Object { $_.ProcessId })
  }
}

$result = Get-ChromeProcessTree -TargetUserDataDir $UserDataDir
$result | ConvertTo-Json -Compress
