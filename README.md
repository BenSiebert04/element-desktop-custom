# Mosaix

*Mosaik + Matrix:* Dein Anruf als Kachel-Mosaik, das du selbst legst.

Ein Matrix-Client für Windows auf Basis von **Element Desktop** mit einem frei
konfigurierbaren Anruf-Layout: mehrere Bildschirmübertragungen gleichzeitig,
einzeln ausblendbare Teilnehmer, verschiebbare und skalierbare Kacheln,
Layout-Voreinstellungen und gespeicherte Layouts. Dazu **Private Voice**:
eine vom Server in den Account-Daten gepflegte Konfiguration ordnet Räume
eines Spaces in Kategorien, trennt Text- und Sprachräume und kennzeichnet
Discord-Brücken ([docs/PRIVATE_VOICE.md](docs/PRIVATE_VOICE.md)).

> Dies ist kein offizielles Produkt von Element. Es basiert auf Element
> Web/Desktop v1.12.32 (Element Web mit kleinen Änderungen für Private Voice)
> und einem angepassten Element Call v0.26.1. Dein Homeserver muss nicht
> verändert werden; ohne Private-Voice-Konfiguration verhält sich Mosaix wie
> Element.

## Projektstatus: privates Projekt, kein Support

Mosaix ist ein persönliches Projekt für meinen eigenen Gebrauch. Ich habe
**nicht vor, es regelmäßig zu aktualisieren** oder an neue Element-Versionen
anzupassen, und ich biete keinen Support an.

- **Issues und Pull Requests werden nicht bearbeitet.**
- Wer Mosaix weiterverwenden oder verbessern möchte: bitte **selbst forken** und
  den Fork eigenständig pflegen. Die Lizenz (AGPL-3.0) erlaubt das ausdrücklich.
- Wie man Element-Updates einspielt, steht in [docs/UPDATING.md](docs/UPDATING.md).

Nutzung auf eigene Verantwortung, ohne Gewährleistung (siehe [LICENSE](LICENSE)).

## Dokumentation

- Architektur und Designentscheidungen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Private Voice (Kategorien, Text-/Sprachräume, Spotify-Jam-Kanal): [docs/PRIVATE_VOICE.md](docs/PRIVATE_VOICE.md)
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
Teilnehmer komplett ausblenden, **Transparenz** (0–90 %). Im freien Layout
außerdem **In den Vordergrund / In den Hintergrund** und **Ebene** (0–9): Eine
Kachel auf einer höheren Ebene liegt immer vor Kacheln niedrigerer Ebenen.
Auch in der Standardansicht öffnet das Rechtsklick-Menü „Layout anpassen“.

**Lautstärke pro Person: 0–200 %** (Rechtsklick auf die Kachel), für Stimme
und Bildschirmton getrennt. Der Wert wird pro Matrix-ID gespeichert und gilt
in jedem späteren Anruf mit dieser Person wieder.

Mit der Maus:

- Kachel ziehen und auf eine andere fallen lassen → Plätze tauschen.
- Im **freien Layout**: Kacheln beliebig verschieben und an Kanten/Ecken in
  der Größe ändern; ein Klick holt eine Kachel nach vorn.
- Die Trennlinien zwischen den Bereichen (z. B. 50/50 → 70/30 bei „Zwei
  Streams“, Höhe der Kamera-Leiste, Breite der Seitenleiste) lassen sich
  ziehen.

Ausblenden ist **rein lokal**: Ausgeblendete Personen bleiben im Anruf und
sind weiter hörbar; nichts wird an den Server oder andere Teilnehmer gesendet.
Für ausgeblendete Videos stoppt LiveKit automatisch den Videoempfang. Der
Hinweis „n ausgeblendet“ erscheint nur, solange die Maus über dem Anruf
bewegt wird, und verschwindet 5 Sekunden danach.

**Bildschirmfreigabe-Modus** (Pfeil neben dem Freigabe-Button), auch während
einer laufenden Freigabe umschaltbar:

- **Standard:** wie Element (1080p, bis 15 fps).
- **Lesbarkeit:** volle Bildschirmauflösung hat Vorrang, die Bildrate (bis
  30 fps) sinkt bei Bedarf. Für Text, Code, Dokumente.
- **Highspeed:** bis zu 60 fps haben Vorrang, Auflösung und Qualität sinken
  bei Bedarf. Für Spiele und Videos.

Im selben Menü: **Ton mitübertragen** (standardmäßig an, gilt ab der
nächsten Freigabe). In der Desktop-App unter Windows (ab Windows 10 2004):

- **Fenster teilen:** nur der Ton dieser Anwendung (z. B. Spiel, Browser,
  Spotify), wie bei Discord.
- **Bildschirm teilen:** der Ton des ganzen Computers **ohne Mosaix selbst**,
  damit niemand den Anruf doppelt hört.
- **Mosaix-Fenster teilen:** Bild ja, Ton nicht (das wäre der Anruf).

Die anderen können den Ton einer Bildschirmfreigabe wie eine Person leiser,
lauter (bis 200 %) oder für sich stumm stellen. Am Server ist dafür nichts
nötig.

Layout-Einstellungen werden pro Raum lokal gespeichert, optional mit einem
globalen Standard; Lautstärken pro Person.

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
git clone --depth 1 --branch v1.12.32 https://github.com/element-hq/element-web build/element-web
node scripts/element-web.mjs apply build/element-web
(cd build/element-web && pnpm install --frozen-lockfile && cd apps/web && pnpm run build)
node scripts/prepare-webapp.mjs --from build/element-web/apps/web/webapp
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
