# Generate extension icons: rounded gradient square + white play triangle
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "icons"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

$mode = [System.Drawing.Drawing2D.LinearGradientMode]::Vertical

foreach ($s in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $r = [math]::Max(2, [math]::Round($s * 0.22))
    $d = $r * 2

    # rounded-rect background path
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($s - $d, 0, $d, $d, 270, 90)
    $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $path.AddArc(0, $s - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    # vertical gradient blue -> dark
    $c1 = [System.Drawing.Color]::FromArgb(255, 37, 99, 235)
    $c2 = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, $mode)
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()

    # play triangle
    $pts = @(
        (New-Object System.Drawing.PointF(([float]($s * 0.36)), ([float]($s * 0.27)))),
        (New-Object System.Drawing.PointF(([float]($s * 0.36)), ([float]($s * 0.73)))),
        (New-Object System.Drawing.PointF(([float]($s * 0.75)), ([float]($s * 0.50))))
    )
    $g.FillPolygon([System.Drawing.Brushes]::White, $pts)

    $g.Dispose()
    $out = Join-Path $dir ("icon{0}.png" -f $s)
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $out"
}
