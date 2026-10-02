Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "2.jpg"))
$cropRect = New-Object System.Drawing.Rectangle(0, 18, 794, 115)
$target = New-Object System.Drawing.Bitmap(794, 115)
$g = [System.Drawing.Graphics]::FromImage($target)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, 794, 115)), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()

$target.Save("assets\header_logos.png", [System.Drawing.Imaging.ImageFormat]::Png)
$target.Dispose()
Write-Output "Perfect full header!"
