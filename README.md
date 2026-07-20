# Lumix S1 II Finder

Ein kleiner Windows-Suchmonitor für gebrauchte **Panasonic Lumix S1 II** in Deutschland. Er durchsucht Kleinanzeigen und eBay, sortiert nach Gesamtpreis und erzeugt einen übersichtlichen lokalen Report.

Die Modellprüfung akzeptiert übliche Schreibweisen (`S1 II`, `S1II`, `S1 2`, `S1MK2`) und verwirft bewusst ähnliche Modelle wie `S1R II`, `S5 II`, `S1H` und `S1 IIE`. Auch Zubehör-, Gesuch- und Mietanzeigen werden herausgefiltert.

## Online auf Handy und anderen Geräten

Die enthaltene GitHub-Actions-Konfiguration erzeugt alle sechs Stunden eine öffentliche GitHub-Pages-Seite. Du brauchst dafür lediglich ein GitHub-Konto:

1. Auf GitHub ein leeres Repository anlegen, beispielsweise `lumix-search`.
2. In diesem Ordner einmalig ausführen (die Repository-URL entsprechend ersetzen):

   ```powershell
   git add .
   git commit -m "Lumix S1 II Finder"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/lumix-search.git
   git push -u origin main
   ```

3. Auf GitHub unter **Settings → Pages** bei **Source** den Eintrag **GitHub Actions** auswählen, falls er nicht bereits automatisch aktiv ist.
4. Unter **Actions** den Workflow **Angebote aktualisieren und veröffentlichen** öffnen und einmal **Run workflow** wählen.

Nach dem ersten erfolgreichen Lauf ist die Seite normalerweise unter `https://DEIN-NAME.github.io/lumix-search/` erreichbar. Der geplante Lauf startet jeweils bei Minute 17 alle sechs Stunden; über **Run workflow** kannst du jederzeit manuell aktualisieren.

GitHub Actions verwendet den plattformunabhängigen Generator in `web/generate.mjs`. `npm test` prüft vor jeder Veröffentlichung automatisch Modellfilter und Parser. Wenn ein Marktplatz Zugriffe aus einem Rechenzentrum blockiert, erscheint der Fehler transparent auf der Seite und die übrigen Quellen bleiben nutzbar.

## Lokale Benutzung unter Windows

Im Explorer Rechtsklick auf `lumix-finder.ps1` → **Mit PowerShell ausführen**. Alternativ im Terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\lumix-finder.ps1
```

Danach öffnet sich `output/index.html` im Browser. Die maschinenlesbaren Daten liegen zusätzlich in `output/angebote.json`.

Preisgrenze und Quellen lassen sich in `config.json` ändern. `includeNew` sollte für eine reine Gebraucht-Suche auf `false` bleiben.

## Automatisch alle sechs Stunden

Einmalig ausführen:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
```

Ein anderes Intervall, zum Beispiel alle drei Stunden:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -EveryHours 3
```

Der Windows-Aufgabenplaner führt die Suche dann im Hintergrund aus. Zum Entfernen:

```powershell
Unregister-ScheduledTask -TaskName 'Lumix S1 II Finder' -Confirm:$false
```

Der Standardwert sind sechs Stunden; das ist aktuell genug, ohne die Marktplätze unnötig oft abzufragen. Nach jedem Lauf kannst du einfach `output/index.html` öffnen.

## Hinweise

- Es werden ausschließlich öffentlich sichtbare Suchergebnisse gelesen; es ist kein Login nötig.
- Marktplätze können automatisierte Zugriffe zeitweise begrenzen oder ihre HTML-Struktur ändern. Ein Quellenfehler steht dann im Report, Treffer anderer Quellen bleiben erhalten.
- Prüfe bei Privatangeboten Verkäuferprofil, Rechnung/Seriennummer und nutze Abholung oder eine Zahlungsart mit echtem Käuferschutz. Ein auffällig günstiger Preis allein ist kein Qualitätsmerkmal.
