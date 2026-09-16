# Probe 4 harness. One MoI launch per case, so any modal error box can be
# attributed to exactly one server behaviour and one client shape.
#   .\run-case.ps1 -Name refused-naive -Case "naive ws://127.0.0.1:59999/none" -Server none -Seconds 16
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Case,
  [string]$Server = 'none',
  [int]$Seconds = 16
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Moi  = "$env:APPDATA\Moi"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
if (-not ('P4Win' -as [type])) {
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public class P4Win {
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; } }
'@
}

function Get-MoiWindows([int]$ProcId) {
  $script:hits = @()
  $cb = [P4Win+EnumProc]{ param($h,$l)
    $wp = 0; [P4Win]::GetWindowThreadProcessId($h,[ref]$wp) | Out-Null
    if ($wp -eq $ProcId -and [P4Win]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [P4Win]::GetWindowText($h,$sb,512) | Out-Null
      $script:hits += ,@{ H = $h; T = $sb.ToString() }
    }
    return $true }
  [P4Win]::EnumWindows($cb,[IntPtr]::Zero) | Out-Null
  return $script:hits
}

function Save-Window($H, $Path) {
  # PrintWindow on a freshly shown WebKit dialog sometimes returns a blank
  # bitmap, so retry until the capture has more than one colour in it.
  for ($try = 0; $try -lt 6; $try++) {
    $r = New-Object P4Win+RECT
    [P4Win]::GetWindowRect($H,[ref]$r) | Out-Null
    $w = $r.R - $r.L; $h = $r.B - $r.T
    if ($w -le 0 -or $h -le 0) { return }
    $bmp = New-Object System.Drawing.Bitmap $w,$h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    if ($try -lt 2) {
      $dc = $g.GetHdc(); [P4Win]::PrintWindow($H,$dc,2) | Out-Null; $g.ReleaseHdc($dc)
    } elseif ($try -lt 4) {
      $dc = $g.GetHdc(); [P4Win]::PrintWindow($H,$dc,0) | Out-Null; $g.ReleaseHdc($dc)
    } else {
      [P4Win]::SetForegroundWindow($H) | Out-Null; Start-Sleep -Milliseconds 400
      $g.CopyFromScreen($r.L,$r.T,0,0,(New-Object System.Drawing.Size $w,$h))
    }
    $first = $bmp.GetPixel(2,2); $varied = $false
    for ($y = 0; $y -lt $h -and -not $varied; $y += 5) {
      for ($x = 0; $x -lt $w; $x += 5) { if ($bmp.GetPixel($x,$y) -ne $first) { $varied = $true; break } }
    }
    if ($varied -or $try -eq 5) { $bmp.Save($Path); return }
    Start-Sleep -Milliseconds 700
  }
}

# --- clean slate ---------------------------------------------------------
Stop-Process -Name MoI -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*probe4-server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Remove-Item "$Moi\probe4-result.txt" -Force -ErrorAction SilentlyContinue

# --- server --------------------------------------------------------------
$srv = $null
if ($Server -ne 'none') {
  $srv = Start-Process -FilePath 'node' -ArgumentList "`"$Here\probe4-server.js`"",$Server -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# --- case + startup script ----------------------------------------------
Set-Content -Path "$Moi\probe4-case.txt" -Value $Case -Encoding utf8
Copy-Item "$Here\Probe4Connect.js" "$Moi\startup\" -Force

# --- run -----------------------------------------------------------------
$p = Start-Process -FilePath "C:\Program Files\MoI 4.0\MoI.exe" -PassThru
# Poll once a second so we learn WHEN the box appears, not just whether.
$t0 = Get-Date
$firstBox = ''
$peak = 0
$timeline = @()
for ($s = 0; $s -lt $Seconds; $s++) {
  Start-Sleep -Seconds 1
  $w = Get-MoiWindows $p.Id
  $b = @($w | Where-Object { $_.T -match 'error' -or $_.T -match 'Error' })
  $ms = [int]((Get-Date) - $t0).TotalMilliseconds
  $timeline += ("+{0}ms boxes={1} windows={2}" -f $ms,$b.Count,(($w | ForEach-Object { $_.T }) -join ' | '))
  if ($b.Count -gt $peak) {
    $peak = $b.Count
    if ($firstBox -eq '') {
      $firstBox = "+${ms}ms"
      $shot = New-Object System.Drawing.Bitmap ([int][System.Windows.Forms.SystemInformation]::VirtualScreen.Width),([int][System.Windows.Forms.SystemInformation]::VirtualScreen.Height)
      $gg = [System.Drawing.Graphics]::FromImage($shot)
      $gg.CopyFromScreen(0,0,0,0,$shot.Size)
      $shot.Save("$Here\fullscreen-$Name.png")
      $gg.Dispose(); $shot.Dispose()
    }
  }
}
Set-Content -Path "$Here\timeline-$Name.txt" -Value ($timeline -join "`r`n") -Encoding utf8

$wins = Get-MoiWindows $p.Id
$titles = ($wins | ForEach-Object { $_.T }) -join ' | '
$boxes = @($wins | Where-Object { $_.T -match 'error' -or $_.T -match 'Error' })
$i = 0
foreach ($b in $boxes) { Save-Window $b.H "$Here\box-$Name-$i.png"; $i++ }

Copy-Item "$Moi\probe4-result.txt" "$Here\result-$Name.txt" -Force -ErrorAction SilentlyContinue

$verdict = if ($boxes.Count -eq 0) { 'SILENT' } else { "BOX x$($boxes.Count)" }
Add-Content -Path "$Here\verdicts.txt" -Value ("{0,-28} server={1,-9} -> {2}   firstBox={4} peak={5}   windows: {3}" -f $Name,$Server,$verdict,$titles,$(if($firstBox){$firstBox}else{"-"}),$peak)
Write-Output ("{0} : server={1} : {2}" -f $Name,$Server,$verdict)
Write-Output ("  windows: " + $titles)

# --- tear down -----------------------------------------------------------
Stop-Process -Name MoI -Force -ErrorAction SilentlyContinue
if ($srv) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*probe4-server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item "$Moi\startup\Probe4Connect.js" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
