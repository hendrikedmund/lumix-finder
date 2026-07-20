[CmdletBinding()]
param(
    [switch]$NoOpen,
    [switch]$Json,
    [string]$FixtureDirectory
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'config.json') | ConvertFrom-Json
$OutputDirectory = Join-Path $ProjectRoot 'output'
$DataPath = Join-Path $OutputDirectory 'angebote.json'
$ReportPath = Join-Path $OutputDirectory 'index.html'

function ConvertFrom-HtmlText([string]$Value) {
    if (-not $Value) { return '' }
    $withoutTags = [regex]::Replace($Value, '<[^>]+>', ' ')
    return [System.Net.WebUtility]::HtmlDecode($withoutTags).Trim() -replace '\s+', ' '
}

function ConvertTo-PlainTitle([string]$Title) {
    $value = [System.Net.WebUtility]::HtmlDecode($Title).ToUpperInvariant()
    $value = $value -replace '[^A-Z0-9ÄÖÜ]+', ' '
    return ($value -replace '\s+', ' ').Trim()
}

function Test-ExactModel([string]$Title, [bool]$IncludeNew = $false) {
    $text = ConvertTo-PlainTitle $Title

    if ($text -notmatch '\b(PANASONIC|LUMIX)\b') { return $false }
    if ($text -match '\b(S1\s*R|S5|S1\s*H|S1\s*II\s*E|S1\s*E)\b') { return $false }
    if ($text -notmatch '\bS1\s*(II|2|MK\s*2)\b') { return $false }
    if ($text -match '\b(SUCHE|GESUCHT|ANKAUF|MIETE|MIETEN|VERMIETUNG)\b') { return $false }

    $accessoryWords = '\b(CAGE|RIG|AKKU|BATTERIE|LADEGERÄT|OBJEKTIV|LENS|ADAPTER|DISPLAYFOLIE|SCHUTZGLAS|GRIFF|HANDBUCH|BUCH|TASCHE)\b'
    $cameraWords = '\b(KAMERA|BODY|GEHÄUSE|VOLLFORMAT|SYSTEMKAMERA)\b'
    if ($text -match $accessoryWords -and $text -notmatch $cameraWords) { return $false }

    if (-not $IncludeNew -and $text -match '\bNEU\b' -and $text -notmatch '\b(WIE NEU|NEUWERTIG)\b') { return $false }
    return $true
}

function ConvertTo-Price([string]$Text) {
    if (-not $Text) { return $null }
    $number = '(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:,\d{2})?'
    $match = [regex]::Match($Text, "(?:\u20AC|EUR)\s*(?<before>$number)|(?<after>$number)\s*(?:\u20AC|EUR)", 'IgnoreCase')
    if (-not $match.Success) { return $null }
    $raw = if ($match.Groups['before'].Success) { $match.Groups['before'].Value } else { $match.Groups['after'].Value }
    $raw = $raw -replace ',\d{2}$', ''
    $digits = $raw -replace '[.\s]', ''
    return [decimal]::Parse($digits, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-Page([string]$Url, [string]$FixtureName) {
    if ($FixtureDirectory) {
        return Get-Content -Raw -LiteralPath (Join-Path $FixtureDirectory $FixtureName)
    }
    $headers = @{
        'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
        'Accept-Language' = 'de-DE,de;q=0.9'
    }
    return (Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $headers -TimeoutSec 25).Content
}

function Get-KleinanzeigenOffers {
    # Both queries are intentional: sellers use both "S1 II" and "S1II". The strict
    # title filter below rejects S1R/S5 suggestions mixed into either result page.
    $searches = @(
        @{ Url = 'https://www.kleinanzeigen.de/s-foto/panasonic-lumix-s1-ii/k0c245'; Fixture = 'kleinanzeigen.html' },
        @{ Url = 'https://www.kleinanzeigen.de/s-foto/panasonic-lumix-s1/k0c245'; Fixture = 'kleinanzeigen-breit.html' },
        @{ Url = 'https://www.kleinanzeigen.de/s-multimedia-elektronik/lumix-s1/k0c161'; Fixture = 'kleinanzeigen-breit.html' }
    )
    if ($FixtureDirectory -and -not (Test-Path -LiteralPath (Join-Path $FixtureDirectory 'kleinanzeigen-breit.html'))) {
        $searches = @($searches[0])
    }
    foreach ($search in $searches) {
      $html = Get-Page $search.Url $search.Fixture
      $blocks = [regex]::Matches($html, '<article\s+class="aditem"(?<body>.*?)</article>', 'Singleline,IgnoreCase')
      Write-Verbose "Kleinanzeigen: $($blocks.Count) Karten in $($search.Url) gefunden."
      foreach ($block in $blocks) {
        $body = $block.Value
        $href = [regex]::Match($body, 'data-href="(?<v>[^"]+)"', 'IgnoreCase').Groups['v'].Value
        $titleMatch = [regex]::Match($body, '<a\s+class="ellipsis"[^>]*>(?<v>.*?)</a>', 'Singleline,IgnoreCase')
        $title = ConvertFrom-HtmlText $titleMatch.Groups['v'].Value
        Write-Verbose "Kleinanzeigen-Titel: $title"
        if (-not $title -or -not (Test-ExactModel $title $Config.includeNew)) { continue }

        $priceText = [regex]::Match($body, 'class="[^"]*price[^"]*"[^>]*>(?<v>.*?)</p>', 'Singleline,IgnoreCase').Groups['v'].Value
        $price = ConvertTo-Price (ConvertFrom-HtmlText $priceText)
        if ($null -eq $price -or $price -gt [decimal]$Config.maxPrice) { continue }

        $place = ConvertFrom-HtmlText ([regex]::Match($body, 'aditem-main--top--left[^>]*>(?<v>.*?)</div>', 'Singleline,IgnoreCase').Groups['v'].Value)
        $date = ConvertFrom-HtmlText ([regex]::Match($body, 'aditem-main--top--right[^>]*>(?<v>.*?)</div>', 'Singleline,IgnoreCase').Groups['v'].Value)
        $description = ConvertFrom-HtmlText ([regex]::Match($body, 'aditem-main--middle--description[^>]*>(?<v>.*?)</p>', 'Singleline,IgnoreCase').Groups['v'].Value)
        $image = [regex]::Match($body, '"contentUrl"\s*:\s*"(?<v>https:[^"]+)"', 'IgnoreCase').Groups['v'].Value
        $id = [regex]::Match($body, 'data-adid="(?<v>\d+)"', 'IgnoreCase').Groups['v'].Value

        [pscustomobject]@{
            id = "kleinanzeigen-$id"; source = 'Kleinanzeigen'; title = $title
            price = $price; shipping = $null; totalPrice = $price
            location = $place; date = $date; description = $description
            url = if ($href -match '^https?') { $href } else { "https://www.kleinanzeigen.de$href" }
            image = $image
        }
      }
    }
}

function Get-EbayOffers {
    $url = 'https://www.ebay.de/sch/i.html?_nkw=panasonic+lumix+s1+ii&_sacat=31388&LH_PrefLoc=1&LH_ItemCondition=3000&_sop=15'
    $html = Get-Page $url 'ebay.html'
    if ($html -match '<title>Error Page \| eBay</title>') { throw 'eBay blockiert den automatischen Abruf momentan (HTTP 403).' }

    $blocks = [regex]::Matches($html, '<li[^>]+class="[^"]*s-item[^"]*"(?<body>.*?)</li>', 'Singleline,IgnoreCase')
    Write-Verbose "eBay: $($blocks.Count) Karten gefunden."
    foreach ($block in $blocks) {
        $body = $block.Value
        $linkMatch = [regex]::Match($body, '<a[^>]+class="[^"]*s-item__link[^"]*"[^>]+href="(?<url>[^"]+)"[^>]*>(?<inside>.*?)</a>', 'Singleline,IgnoreCase')
        if (-not $linkMatch.Success) { continue }
        $title = ConvertFrom-HtmlText ([regex]::Match($linkMatch.Groups['inside'].Value, '<(?:span|div)[^>]+class="[^"]*s-item__title[^"]*"[^>]*>(?<v>.*?)</(?:span|div)>', 'Singleline,IgnoreCase').Groups['v'].Value)
        Write-Verbose "eBay-Titel: $title"
        if (-not $title -or -not (Test-ExactModel $title $Config.includeNew)) { continue }

        $priceText = ConvertFrom-HtmlText ([regex]::Match($body, 's-item__price[^>]*>(?<v>.*?)</span>', 'Singleline,IgnoreCase').Groups['v'].Value)
        $price = ConvertTo-Price $priceText
        Write-Verbose "eBay-Preis: $priceText -> $price"
        if ($null -eq $price -or $price -gt [decimal]$Config.maxPrice) { continue }
        $shippingText = ConvertFrom-HtmlText ([regex]::Match($body, 's-item__shipping[^>]*>(?<v>.*?)</span>', 'Singleline,IgnoreCase').Groups['v'].Value)
        $shipping = ConvertTo-Price $shippingText
        if ($shippingText -match 'kostenlos|gratis') { $shipping = 0 }
        $location = ConvertFrom-HtmlText ([regex]::Match($body, 's-item__location[^>]*>(?<v>.*?)</span>', 'Singleline,IgnoreCase').Groups['v'].Value)
        $image = [regex]::Match($body, '<img[^>]+src="(?<v>https:[^"]+)"', 'IgnoreCase').Groups['v'].Value
        $cleanUrl = [System.Net.WebUtility]::HtmlDecode($linkMatch.Groups['url'].Value) -replace '\?.*$', ''
        $id = [regex]::Match($cleanUrl, '/itm/(?:[^/]+/)?(?<v>\d+)').Groups['v'].Value

        [pscustomobject]@{
            id = "ebay-$id"; source = 'eBay'; title = $title
            price = $price; shipping = $shipping; totalPrice = $price + $(if ($null -eq $shipping) { 0 } else { $shipping })
            location = $location; date = ''; description = $shippingText
            url = $cleanUrl; image = $image
        }
    }
}

function ConvertTo-SafeHtml([object]$Value) {
    return [System.Net.WebUtility]::HtmlEncode([string]$Value)
}

function Write-Report([array]$Offers, [array]$Errors) {
    $cards = foreach ($offer in $Offers) {
        $shipping = if ($null -eq $offer.shipping) { '' } elseif ($offer.shipping -eq 0) { '<span>Kostenloser Versand</span>' } else { "<span>+ $([string]::Format('{0:N2}', $offer.shipping)) &euro; Versand</span>" }
        $image = if ($offer.image) { "<img src=`"$(ConvertTo-SafeHtml $offer.image)`" alt=`"`" loading=`"lazy`">" } else { '<div class="placeholder">S1 II</div>' }
        @"
<article class="card">
  <a class="image" href="$(ConvertTo-SafeHtml $offer.url)" target="_blank" rel="noopener">$image</a>
  <div class="content"><div class="meta"><b>$(ConvertTo-SafeHtml $offer.source)</b><span>$(ConvertTo-SafeHtml $offer.location)</span></div>
  <h2><a href="$(ConvertTo-SafeHtml $offer.url)" target="_blank" rel="noopener">$(ConvertTo-SafeHtml $offer.title)</a></h2>
  <div class="price">$([string]::Format('{0:N0}', $offer.price)) &euro; $shipping</div>
  <p>$(ConvertTo-SafeHtml $offer.description)</p><small>$(ConvertTo-SafeHtml $offer.date)</small></div>
</article>
"@
    }
    $errorHtml = if ($Errors.Count) { '<div class="errors"><b>Hinweis:</b> ' + (($Errors | ForEach-Object { ConvertTo-SafeHtml $_ }) -join ' · ') + '</div>' } else { '' }
    $empty = if (-not $Offers.Count) { '<div class="empty">Aktuell keine passenden Angebote unter deiner Preisgrenze.</div>' } else { '' }
    $now = Get-Date -Format 'dd.MM.yyyy, HH:mm'
    $html = @"
<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumix S1 II Finder</title><style>
:root{font-family:Inter,Segoe UI,sans-serif;color:#17211d;background:#f3f5f1}*{box-sizing:border-box}body{margin:0}header{background:#17211d;color:#fff;padding:38px max(20px,calc((100% - 1000px)/2)) 30px}h1{font-size:clamp(28px,5vw,48px);margin:0 0 8px}header p{margin:0;color:#bed0c6}.wrap{max-width:1000px;margin:0 auto;padding:24px 20px}.summary{display:flex;justify-content:space-between;gap:15px;margin-bottom:18px}.errors{background:#fff1d6;border:1px solid #e6bd65;padding:14px;border-radius:12px;margin-bottom:18px}.grid{display:grid;gap:15px}.card{display:grid;grid-template-columns:190px 1fr;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px #17211d12}.image{background:#e5e9e5;min-height:155px}.image img{width:100%;height:100%;object-fit:cover}.placeholder{height:100%;display:grid;place-items:center;font-weight:800;font-size:28px;color:#718078}.content{padding:18px}.meta{display:flex;justify-content:space-between;color:#718078;font-size:13px}.meta b{color:#2d7452}h2{font-size:19px;margin:8px 0}a{color:inherit;text-decoration:none}h2 a:hover{text-decoration:underline}.price{font-size:24px;font-weight:800}.price span{font-size:13px;font-weight:400;color:#718078}.content p{color:#53615a;margin:8px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.content small{color:#718078}.empty{background:#fff;padding:35px;border-radius:16px;text-align:center}@media(max-width:650px){.card{grid-template-columns:110px 1fr}.image{min-height:180px}.content{padding:14px}.summary{display:block}.meta{display:block}.meta span{display:block;margin-top:3px}}
</style></head><body><header><h1>Lumix S1 II Finder</h1><p>Nur das exakte Modell &middot; gebraucht &middot; Deutschland</p></header><main class="wrap"><div class="summary"><b>$($Offers.Count) passende Angebote</b><span>Aktualisiert: $now Uhr &middot; bis $([string]::Format('{0:N0}', $Config.maxPrice)) &euro;</span></div>$errorHtml<div class="grid">$($cards -join "`n")$empty</div></main></body></html>
"@
    Set-Content -LiteralPath $ReportPath -Value $html -Encoding utf8
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$offers = @()
$errors = @()
if ($Config.sources.kleinanzeigen) {
    try { $offers += @(Get-KleinanzeigenOffers) } catch { $errors += "Kleinanzeigen: $($_.Exception.Message)" }
}
if ($Config.sources.ebay) {
    try { $offers += @(Get-EbayOffers) } catch { $errors += "eBay: $($_.Exception.Message)" }
}
$offers = @($offers | Group-Object id | ForEach-Object { $_.Group[0] } | Sort-Object totalPrice, title)
$payload = [pscustomobject]@{ updatedAt = (Get-Date).ToString('o'); offers = $offers; errors = $errors }
$payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $DataPath -Encoding utf8
Write-Report $offers $errors

if ($Json) { $payload | ConvertTo-Json -Depth 6 }
else {
    Write-Host "`nLumix S1 II Finder: $($offers.Count) passende Angebote" -ForegroundColor Green
    $offers | Format-Table source, @{N='Preis';E={"$([string]::Format('{0:N0}', $_.price)) EUR"}}, title, location -AutoSize
    if ($errors.Count) { Write-Warning ($errors -join ' | ') }
    Write-Host "Report: $ReportPath"
}
if (-not $NoOpen -and -not $FixtureDirectory) { Start-Process $ReportPath }
