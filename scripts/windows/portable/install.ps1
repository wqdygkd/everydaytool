# everydaytool 一键安装脚本（per-user，无需管理员）
# 与 NSIS / MSI 无关：只做普通文件复制 + 开始菜单/桌面快捷方式 + HKCU 卸载项。
# 适用场景：安装器进程被安全软件拦截（报 Can't write: ...everydaytool.exe）时用这条路径。
$ErrorActionPreference = 'Stop'

$name = 'everydaytool'
$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA $name
$exe = Join-Path $dst 'everydaytool.exe'
$skip = @('install.ps1', 'install.cmd', 'README.txt', 'uninstall.ps1')

function Fail($message) {
  Write-Host $message -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
  Fail 'everydaytool 正在运行，请先退出后再安装。'
}
if (-not (Test-Path (Join-Path $src 'everydaytool.exe'))) {
  Fail '没找到 everydaytool.exe：请把本脚本与 everydaytool.exe 放在同一个目录。'
}

Write-Host "安装到：$dst"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Get-ChildItem $src -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName -Destination $dst -Recurse -Force
}

# 开始菜单 + 桌面快捷方式
$shell = New-Object -ComObject WScript.Shell
$shortcutDirs = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [Environment]::GetFolderPath('Desktop')
)
foreach ($dir in $shortcutDirs) {
  $lnk = $shell.CreateShortcut((Join-Path $dir "$name.lnk"))
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $dst
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'everydaytool 多功能工具平台'
  $lnk.Save()
}

# 卸载脚本（应用列表里的卸载入口指向它）
$uninstallScript = @'
$dst = Join-Path $env:LOCALAPPDATA 'everydaytool'
if (Get-Process -Name 'everydaytool' -ErrorAction SilentlyContinue) {
  Write-Host '请先退出 everydaytool 再卸载。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}
foreach ($lnk in @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\everydaytool.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'everydaytool.lnk'))) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }
}
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\everydaytool' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '已卸载 everydaytool（用户数据保留在 %APPDATA%\everydaytool）' -ForegroundColor Green
Read-Host '按回车退出'
'@
Set-Content -Path (Join-Path $dst 'uninstall.ps1') -Value $uninstallScript -Encoding UTF8

# HKCU 应用列表卸载项
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\everydaytool'
New-Item $key -Force | Out-Null
Set-ItemProperty $key -Name DisplayName -Value 'everydaytool'
Set-ItemProperty $key -Name DisplayVersion -Value '1.1.0'
Set-ItemProperty $key -Name Publisher -Value 'everydaytool'
Set-ItemProperty $key -Name InstallLocation -Value $dst
Set-ItemProperty $key -Name DisplayIcon -Value $exe
Set-ItemProperty $key -Name NoModify -Value 1 -Type DWord
Set-ItemProperty $key -Name NoRepair -Value 1 -Type DWord
Set-ItemProperty $key -Name UninstallString -Value ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $dst 'uninstall.ps1') + '"')

Write-Host '安装完成：开始菜单与桌面已创建快捷方式，应用列表里可以卸载。' -ForegroundColor Green
Start-Process $exe
