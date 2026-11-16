# Installs the demo's own OpenRouter key from the clipboard, so it never has to be pasted anywhere:
#   1. In OpenRouter, press Copy on the new key.
#   2. Run:  powershell -ExecutionPolicy Bypass -File scripts\set-key.ps1
# It sets the Cloudflare Worker secret (live site) and .dev.vars (local dev + evals), then clears
# the clipboard.

Set-Location (Split-Path $PSScriptRoot)
$key = (Get-Clipboard -Raw)
if ($null -eq $key -or $key.Trim() -notmatch '^sk-or-[A-Za-z0-9_-]+$') {
  Write-Host "The clipboard doesn't hold an OpenRouter key (sk-or-...). Press Copy on the key first."
  exit 1
}
$key = $key.Trim()

$key | npx wrangler secret put OPENROUTER_API_KEY
if ($LASTEXITCODE -ne 0) { Write-Host "Cloudflare didn't take the key; nothing else was changed."; exit 1 }

Set-Content -Path .dev.vars -Value "OPENROUTER_API_KEY=$key" -Encoding ascii -NoNewline
Set-Clipboard -Value ' '
Write-Host ""
Write-Host "Done: the live site and local .dev.vars now use the demo's own key. Clipboard cleared."
