# Probe 5 harness. Trimmed from probe-04's run-case.ps1: no probe server, no
# per-second window poll beyond error-box detection. One MoI launch per script.
#   .\run.ps1 -Script Probe5Recon.js -Results probe5-recon.txt -Seconds 20
param(
  [Parameter(Mandatory=$true)][string]$Script,
  [Parameter(Mandatory=$true)][string[]]$Results,
  [int]$Seconds = 25,
  [string]$Tag = ''
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Moi  = "$env:APPDATA\Moi"
if ($Tag -eq '') { $Tag = [IO.Path]::GetFileNameWithoutExtension($Script) }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
if (-not ('P5Win' -as [type])) {
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public class P5Win {
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }
'@
}

function Get-MoiWindows([int]$ProcId) {
  $script:hits = @()
  $cb = [P5Win+EnumProc]{ param($h,$l)
    $wp = 0; [P5Win]::GetWindowThreadProcessId($h,[ref]$wp) | Out-Null
    if ($wp -eq $ProcId -and [P5Win]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [P5Win]::GetWindowText($h,$sb,512) | Out-Null
      $script:hits += ,@{ H = $h; T = $sb.ToString() }
    }
    return $true }
  [P5Win]::EnumWindows($cb,[IntPtr]::Zero) | Out-Null
  return $script:hits
}

Stop-Process -Name MoI -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
foreach ($r in $Results) { Remove-Item "$Moi\$r" -Force -ErrorAction SilentlyContinue }

# The probe scripts read this for a folder to drop .3dm test files into, so no
# path is baked into the JavaScript.
Set-Content -Path "$Moi\probe5-case.txt" -Value $Here -Encoding utf8
Copy-Item "$Here\$Script" "$Moi\startup\" -Force

$p = Start-Process -FilePath "$env:ProgramFiles\MoI 4.0\MoI.exe" -PassThru
$t0 = Get-Date
$firstBox = ''
$timeline = @()
for ($s = 0; $s -lt $Seconds; $s++) {
  Start-Sleep -Seconds 1
  $w = Get-MoiWindows $p.Id
  $b = @($w | Where-Object { $_.T -match 'rror' })
  $ms = [int]((Get-Date) - $t0).TotalMilliseconds
  $timeline += ("+{0}ms boxes={1} windows={2}" -f $ms,$b.Count,(($w | ForEach-Object { $_.T }) -join ' | '))
  if ($b.Count -gt 0 -and $firstBox -eq '') {
    $firstBox = "+${ms}ms"
    $shot = New-Object System.Drawing.Bitmap ([int][System.Windows.Forms.SystemInformation]::VirtualScreen.Width),([int][System.Windows.Forms.SystemInformation]::VirtualScreen.Height)
    $gg = [System.Drawing.Graphics]::FromImage($shot)
    $gg.CopyFromScreen(0,0,0,0,$shot.Size)
    $shot.Save("$Here\fullscreen-$Tag.png")
    $gg.Dispose(); $shot.Dispose()
  }
}
Set-Content -Path "$Here\timeline-$Tag.txt" -Value ($timeline -join "`r`n") -Encoding utf8

foreach ($r in $Results) { Copy-Item "$Moi\$r" "$Here\$r" -Force -ErrorAction SilentlyContinue }

Stop-Process -Name MoI -Force -ErrorAction SilentlyContinue
Remove-Item "$Moi\startup\$Script" -Force -ErrorAction SilentlyContinue
Remove-Item "$Moi\probe5-case.txt" -Force -ErrorAction SilentlyContinue
foreach ($r in $Results) { Remove-Item "$Moi\$r" -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Write-Output ("{0}: firstBox={1}" -f $Tag,$(if($firstBox){$firstBox}else{'none'}))
foreach ($r in $Results) { if (Test-Path "$Here\$r") { Write-Output "  got $r" } else { Write-Output "  MISSING $r" } }
