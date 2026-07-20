$scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'lumix-finder.ps1'
$source = Get-Content -Raw -LiteralPath $scriptPath
$start = $source.IndexOf('function ConvertFrom-HtmlText')
$functionSource = $source.Substring($start, $source.IndexOf('function ConvertTo-Price') - $start)
Invoke-Expression $functionSource

$cases = @(
    @('Panasonic Lumix S1 II Body, wie neu', $true),
    @('Panasonic LUMIX S1II (S12) S1 II WIE NEU', $true),
    @('Panasonic Lumix S1MK2 Kamera', $true),
    @('Panasonic Lumix S1 2 Gehäuse', $true),
    @('Panasonic Lumix S1R II Body', $false),
    @('Panasonic Lumix S5 II Kamera', $false),
    @('Panasonic Lumix S1 IIE', $false),
    @('SmallRig Cage für Lumix S1 II', $false),
    @('Suche Panasonic Lumix S1 II', $false),
    @('Panasonic Lumix S1 II NEU', $false)
)

$failed = 0
foreach ($case in $cases) {
    $actual = Test-ExactModel $case[0] $false
    if ($actual -ne $case[1]) {
        Write-Error "Fehlgeschlagen: '$($case[0])' erwartet $($case[1]), erhalten $actual" -ErrorAction Continue
        $failed++
    }
}
if ($failed) { exit 1 }
Write-Host "Alle $($cases.Count) Modellfilter-Tests erfolgreich." -ForegroundColor Green
