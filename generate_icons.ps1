# Generate placeholder icons for Chrome Extension
# NOTE: Real branded icons are in icons/ (copied from aitherium-brandkit/aitheros-constellation).
# This script is only for fallback if branded icons are missing.
param($Path = "d:\AitherOS-Fresh\Awconnect\icons")

if (!(Test-Path $Path)) { New-Item -ItemType Directory -Path $Path -Force }

# Don't overwrite existing branded icons
if ((Test-Path "$Path\icon128.png") -and (Get-Item "$Path\icon128.png").Length -gt 1000) {
    Write-Host "Branded icons already present in $Path — skipping generation."
    return
}

Add-Type -AssemblyName System.Drawing

function New-SolidBmp {
    param($W, $H, $Color, $Out)
    $bmp = New-Object System.Drawing.Bitmap $W, $H
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromName($Color))
    $g.FillRectangle($brush, 0, 0, $W, $H)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

New-SolidBmp 16 16 "DarkMagenta" (Join-Path $Path "icon16.png")
New-SolidBmp 48 48 "DarkMagenta" (Join-Path $Path "icon48.png")
New-SolidBmp 128 128 "DarkMagenta" (Join-Path $Path "icon128.png")

Write-Host "Placeholder icons generated in $Path"
