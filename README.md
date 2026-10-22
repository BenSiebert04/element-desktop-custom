# Mosaix

*Mosaik + Matrix:* Dein Anruf als Kachel-Mosaik, das du selbst legst.

Ein Matrix-Client für Windows auf Basis von **Element Desktop** mit einem frei
konfigurierbaren Anruf-Layout: mehrere Bildschirmübertragungen gleichzeitig,
einzeln ausblendbare Teilnehmer, verschiebbare und skalierbare Kacheln,
Layout-Voreinstellungen und gespeicherte Layouts.

> Dies ist kein offizielles Produkt von Element. Es basiert auf dem
> unveränderten Element Web/Desktop v1.12.32 und einem angepassten
> Element Call v0.26.1. Dein Homeserver muss nicht verändert werden.

- Architektur und Designentscheidungen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Installation, Anmeldung, Bedienung: [docs/INSTALL.md](docs/INSTALL.md)
- Upstream-Updates einspielen: [docs/UPDATING.md](docs/UPDATING.md)
- Tests und bekannte Einschränkungen: [docs/TESTING.md](docs/TESTING.md)

## Funktionen des Call-Layouts

In der Anrufansicht gibt es unten links die Schaltfläche **„Layout anpassen“**
(Raster-Symbol). Sie öffnet ein Panel mit:

- **Layouts:** Standardansicht (Element), Automatisch (alle Bildschirm-
  freigaben groß, Kameras klein darunter), Raster, Zwei Streams, Vier Streams
  (2×2), Hauptstream + Seitenleiste, Freies Layout.
- **Stream-Übersicht:** alle Bildschirmfreigaben und Kameras, jeweils einzeln
  ein-/ausblendbar (Auge) und anheftbar (Pin); „Alle Kameras ausblenden“,
  „Alle einblenden“.
- **Gespeicherte Layouts:** eigene Layouts unter einem Namen speichern,
  laden, löschen; „Als Standard für alle Räume verwenden“.
- **Auf Standardansicht zurücksetzen.**

Direkt an jeder Kachel (beim Darüberfahren und im Rechtsklick-/„…“-Menü):
Anheften, Maximieren (auch per Doppelklick), Vollbild, Ausblenden,
Teilnehmer komplett ausblenden.

Mit der Maus:

- Kachel ziehen und auf eine andere fallen lassen → Plätze tauschen.
- Im **freien Layout**: Kacheln beliebig verschieben und an Kanten/Ecken in
  der Größe ändern; ein Klick holt eine Kachel nach vorn.
- Die Trennlinien zwischen den Bereichen (z. B. 50/50 → 70/30 bei „Zwei
  Streams“, Höhe der Kamera-Leiste, Breite der Seitenleiste) lassen sich
  ziehen.

Ausblenden ist **rein lokal**: Ausgeblendete Personen bleiben im Anruf und
sind weiter hörbar; nichts wird an den Server oder andere Teilnehmer gesendet.
Für ausgeblendete Videos stoppt LiveKit automatisch den Videoempfang.

Einstellungen werden pro Raum lokal gespeichert, optional mit einem globalen
Standard.

## Download

Fertige Installer entstehen automatisch per GitHub Actions
([Workflow „Build Windows app“](../../actions/workflows/build-windows.yml)) als
Artefakt `Mosaix-Windows-x64-<Version>`; bei Tags `v*` zusätzlich als
GitHub-Release. Der Build ist **nicht signiert** (siehe
[docs/INSTALL.md](docs/INSTALL.md#windows-smartscreen)).

## Selbst bauen

Siehe [docs/UPDATING.md](docs/UPDATING.md#lokal-bauen). Kurzfassung (Windows
oder Linux, Node 24, pnpm 11):

```sh
cd element-call && pnpm install --frozen-lockfile && pnpm build:embedded && cd ..
node scripts/prepare-webapp.mjs
git clone --depth 1 --branch v1.12.32 https://github.com/element-hq/element-web build/element-web
node scripts/prepare-desktop.mjs build/element-web/apps/desktop --webapp build/webapp
cd build/element-web/apps/desktop
pnpm install --frozen-lockfile --filter element-desktop
pnpm exec tsc && node scripts/copy-res.ts && pnpm run asar-webapp
VARIANT_PATH=variant.json pnpm exec electron-builder --config electron-builder.custom.ts --publish never --win --x64
```

## Lizenz

Element Web, Element Desktop und Element Call sind © New Vector Ltd. /
Element Creations Ltd. und unter der **GNU AGPL v3** (Element Desktop zusätzlich
GPL v3) bzw. einer kommerziellen Lizenz verfügbar. Dieses Projekt nutzt sie
unter der AGPL-3.0; die eigenen Änderungen stehen ebenfalls unter der
[AGPL-3.0](LICENSE). Die Original-Lizenzdateien liegen in `element-call/`
und in den gebauten Paketen.

Pflichten aus der AGPL/GPL: Wer die App weitergibt, muss den vollständigen
Quellcode (dieses Repository inkl. der gepinnten Upstream-Versionen)
zugänglich machen. Da es sich um eine Client-App handelt, die nicht als
Netzwerkdienst für Dritte betrieben wird, genügt für die private Nutzung das
öffentliche (oder auf Anfrage zugängliche) Repository. Die Namen „Element“ und
die Element-Logos sind Marken von Element; diese App heißt daher „Mosaix“
und hat ein eigenes Icon. „Element“ wird nur verwendet, um die Herkunft des
Codes zu beschreiben.
