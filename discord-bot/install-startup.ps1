$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'discord-bot.lnk'
$target = 'C:\Users\kws33\Desktop\projects\ai-native-ops\discord-bot\startup.bat'

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = $target
$sc.WorkingDirectory = 'C:\Users\kws33\Desktop\projects\ai-native-ops\discord-bot'
$sc.WindowStyle = 7
$sc.Description = 'Discord Bot (프로젝트매니저) 자동 시작'
$sc.Save()

Write-Host "[OK] Startup shortcut created at: $shortcutPath"
