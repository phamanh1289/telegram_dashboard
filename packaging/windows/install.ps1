# Install or update Telegram Dashboard on Windows (PowerShell):
#   irm https://github.com/phamanh1289/telegram_dashboard/releases/latest/download/install-windows.ps1 | iex
# Invoke-WebRequest does not add the "downloaded from the internet" mark, so SmartScreen does not
# block the unsigned installer (a Setup.exe downloaded in a browser does). Data is kept on update.
# ASCII only: irm may not decode this file as UTF-8.
& {  # script block so `return` stops only this script when piped into iex
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest is very slow with the progress bar
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $dir = Join-Path $env:LOCALAPPDATA 'Programs\Telegram Dashboard'
  # its port may not be 8765 (next free one when taken): look for its python.exe instead
  if (Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir\*" }) {
    Write-Host 'Telegram Dashboard dang chay: dong cua so den cua no roi chay lai lenh nay.' -ForegroundColor Yellow
    return
  }

  $repo = 'phamanh1289/telegram_dashboard'
  $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
  $asset = $rel.assets | Where-Object { $_.name -like '*-windows-x64-setup.exe' } | Select-Object -First 1
  if (-not $asset) { throw "Ban $($rel.tag_name) chua co bo cai Windows." }
  $exe = Join-Path $env:TEMP $asset.name

  Write-Host "Tai Telegram Dashboard $($rel.tag_name)..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $exe -UseBasicParsing
  # GitHub's sha256 of the asset: a corrupted or swapped download is never run
  $got = 'sha256:' + (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $asset.digest) {
    Remove-Item $exe -ErrorAction SilentlyContinue
    throw 'Bo cai tai ve sai checksum: khong cai.'
  }
  Write-Host 'Dang cai...'
  Start-Process $exe -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=desktopicon' -Wait
  Remove-Item $exe -ErrorAction SilentlyContinue

  Write-Host "Da cai vao $dir (shortcut 'Telegram Dashboard' o Start Menu va Desktop)." -ForegroundColor Green
  Write-Host "Hoac mo cmd/PowerShell moi va go: mydashboard start"
  Start-Process (Join-Path $dir 'Start Dashboard Telegram.bat') -WorkingDirectory $dir
}
