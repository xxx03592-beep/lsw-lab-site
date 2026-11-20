# Minimal static file server for local preview: powershell -File serve.ps1 [port]
param([int]$Port = 5173)
# Trailing separator so a sibling folder like "mhi-clone-x" can't pass the prefix check
$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
# Only these file types are served; anything else (this script, backups, dotfiles) is a 404
$types = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.mp4' = 'video/mp4'; '.txt' = 'text/plain; charset=utf-8'; '.xml' = 'application/xml; charset=utf-8'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.otf' = 'font/otf' }
# Same policy as the <meta> tags in the pages, plus the parts a <meta> tag can't set
$csp = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  $res.Headers['X-Content-Type-Options'] = 'nosniff'
  $res.Headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  $res.Headers['X-Frame-Options'] = 'DENY'
  $res.Headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
  if ($ctx.Request.HttpMethod -notin @('GET', 'HEAD')) {
    $res.StatusCode = 405
    $res.Close()
    continue
  }
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '') { $path = 'index.html' }
  $file = $null
  try { $file = [IO.Path]::GetFullPath((Join-Path $root $path)) } catch { }
  $ext = if ($file) { [IO.Path]::GetExtension($file).ToLower() } else { '' }
  if ($file -and $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and $types.ContainsKey($ext) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $res.ContentType = $types[$ext]
    if ($ext -eq '.html') { $res.Headers['Content-Security-Policy'] = $csp }
    if ($ctx.Request.HttpMethod -eq 'GET') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  } else {
    $res.StatusCode = 404
  }
  $res.Close()
}
