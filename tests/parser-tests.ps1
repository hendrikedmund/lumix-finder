$root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $PSScriptRoot 'fixtures'
$result = & (Join-Path $root 'lumix-finder.ps1') -NoOpen -Json -FixtureDirectory $fixture | ConvertFrom-Json

if ($result.offers.Count -ne 2) {
    Write-Error "Erwartet: 2 exakte Angebote. Erhalten: $($result.offers.Count)"
    exit 1
}
if (($result.offers.title -join ' ') -match 'S1R|S5') {
    Write-Error 'Ein falsches Modell hat den Parserfilter passiert.'
    exit 1
}
if ($result.offers[0].price -ne 2399 -or $result.offers[1].price -ne 2499) {
    Write-Error 'Preise wurden nicht korrekt gelesen oder sortiert.'
    exit 1
}
Write-Host 'Parser-Test mit Kleinanzeigen und eBay erfolgreich.' -ForegroundColor Green
