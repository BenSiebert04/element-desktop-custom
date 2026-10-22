# Architektur von Mosaix

## Ausgangslage: Wo werden Anrufe gerendert?

Element Desktop (Electron, `apps/desktop` im Monorepo
[element-hq/element-web](https://github.com/element-hq/element-web)) lädt
Element Web als `webapp.asar`. Element Web wiederum rendert **Gruppenanrufe
nicht selbst**: Sie laufen in **Element Call**, das als Widget (iframe) unter
`widgets/element-call/` mitgeliefert wird. Diese Kopie stammt aus dem npm-Paket
`@element-hq/element-call-embedded` (bei Element Web v1.12.32: Version 0.26.0)
und wird beim Build von Element Web in die Webapp kopiert
(`apps/web/webpack.config.ts`, CopyWebpackPlugin).

Die gesamte Anrufoberfläche – Kacheln, Spotlight/Grid, Screenshares,
Teilnehmerliste – ist also Element-Call-Code:

| Bereich                         | Datei (Element Call)                                   |
| ------------------------------- | ------------------------------------------------------ |
| Anrufansicht, Header, Footer    | `src/room/InCallView.tsx`                              |
| Zustand, Medienlisten, Layouts  | `src/state/CallViewModel/CallViewModel.ts`             |
| Layout-Typen (grid, spotlight…) | `src/state/layout-types.ts`, `src/grid/*`              |
| Kacheln                         | `src/tile/GridTile.tsx`, `SpotlightTile.tsx`, `MediaView.tsx` |
| Medien-ViewModels               | `src/state/media/*` (User-Media, Screenshare)          |
| Audio                           | `src/livekit/MatrixAudioRenderer.tsx` (getrennt von den Kacheln!) |

Im Standard-Element-Call landen **alle Screenshares im einen Spotlight-Bereich**
und werden dort als Karussell nacheinander gezeigt – deshalb kann man zwei
Screenshares nicht nebeneinander sehen.

Seit kurzem gibt es zusätzlich ein Labs-Flag `feature_element_call_react`, mit
dem Element Web Element Call als React-Komponente einbindet. Standard ist aber
weiterhin das iframe-Widget, und dieses passen wir an.

## Entscheidung: Änderungen nur in Element Call

**Alle Funktionen sind vollständig innerhalb von Element Call implementiert.**
Element Web und Element Desktop werden **nicht** im Quellcode verändert:

- Element Web wird als **offizielles, vorkompiliertes Release-Archiv**
  (`element-v1.12.32.tar.gz`, SHA-256 in `upstream.json` fixiert) verwendet.
  Nur der Ordner `widgets/element-call/` wird durch unseren Build ersetzt und
  eine eigene `config.json` hinzugefügt.
- Element Desktop wird aus dem offiziellen Tag gebaut. Branding (Name, App-ID,
  Protokoll, Icon) erfolgt über den vorgesehenen Mechanismus „Variant“
  (`VARIANT_PATH`) und zusätzliche Dateien. Die Windows-Paketierung
  überschreibt nur die `win`/`nsis`-Einstellungen in einer eigenen
  electron-builder-Konfiguration, die die Upstream-Konfiguration importiert.

Das ist die Variante mit dem geringsten Wartungsaufwand: Ein Element-Update
erfordert normalerweise nur das Anpassen von `upstream.json`; Merge-Konflikte
können ausschließlich im Element-Call-Teil auftreten.

## Repository-Aufbau

```
element-desktop-custom/
├── element-call/               Element Call v0.26.1 als git subtree (+ unsere Commits)
│   └── src/custom-layout/      ← neuer Code des erweiterten Call-Layouts
├── branding/                   variant.json, config.json, Icons
├── desktop/electron-builder.custom.ts   Windows-Installer (NSIS + Zip)
├── scripts/                    prepare-webapp.mjs, prepare-desktop.mjs, generate-icons.py
├── upstream.json               gepinnte Upstream-Versionen
└── .github/workflows/build-windows.yml
```

Warum **git subtree** für Element Call statt Fork/Submodule?

- Der angepasste Code liegt direkt im Repository und ist lesbar/reviewbar.
- Upstream-Updates werden mit `git subtree pull` als normaler Merge
  eingespielt (3-Wege-Merge, Konflikte werden wie gewohnt gelöst).
- Kein zweites Repository nötig, keine Submodule-Fallstricke im CI.

### Eingriffe in bestehende Element-Call-Dateien

Bewusst minimal gehalten (jeweils mit `[element-custom]` markiert):

| Datei                                       | Änderung |
| ------------------------------------------- | -------- |
| `src/state/CallViewModel/CallViewModel.ts`  | stellt `customLayoutUserMedia$` und `customLayoutScreenShares$` bereit (2 Felder) |
| `src/room/InCallView.tsx`                   | erzeugt das Layout-ViewModel, rendert `CustomLayoutView` statt des Grids, Button im Footer, Panel |
| `src/room/InCallView.module.css`            | eine Klasse |
| `src/tile/GridTile.tsx`                     | optionale Prop `extraMenuItems` (zusätzliche Menüeinträge) |
| `locales/en/app.json`, `locales/de/app.json`| neue Texte unter `custom_layout` |

Alles andere ist neu in `element-call/src/custom-layout/`.

## Aufbau des Call-Layouts

```
CallViewModel ──(alle Kameras, alle Screenshares)──▶ CustomLayoutViewModel
                                                        │  config$ (Preset, ausgeblendet,
                                                        │  angeheftet, Reihenfolge, Ratios,
                                                        │  freie Positionen)
                                                        ▼
                         computeLayout() (reine Geometrie) ──▶ CustomLayoutView
                                                                 ├─ GridTile (Kamera, Upstream)
                                                                 ├─ ScreenShareTile (MediaView)
                                                                 └─ Drag/Resize/Divider
                                    LayoutPanel ("Layout anpassen"), CustomLayoutButton
                                    LayoutStorage (localStorage: Raum / global / benannt)
```

- **`layoutConfig.ts`** – Datenmodell, Validierung gespeicherter Daten,
  Sichtbarkeit und Sortierung.
- **`computePlacements.ts`** – reine Funktion: Konfiguration + Streams +
  Flächengröße → Positionen aller Kacheln und Teiler. Kein DOM, daher
  umfassend testbar.
- **`CustomLayoutViewModel.ts`** – RxJS-ViewModel nach Element-Call-Konvention
  (Factory mit `ObservableScope`), alle Aktionen, automatische Speicherung.
- **`layoutStorage.ts`** – lokale Speicherung im Profil der App.
- **`CustomLayoutView.tsx`** – rendert Kacheln absolut positioniert, Pointer-
  Events für Verschieben, Größenänderung (8 Griffe) und Teiler.
- **`LayoutPanel.tsx`** – Seitenpanel mit Presets, Stream-Übersicht,
  gespeicherten Layouts, globalem Standard und Zurücksetzen.

### Rein lokale Anzeige, keine Eingriffe in den Anruf

- Ausblenden entfernt nur die Kachel aus der eigenen Ansicht. Es werden
  keine Matrix-Events gesendet, keine LiveKit-Abonnements gekündigt und keine
  Teilnehmer stummgeschaltet oder entfernt.
- **Audio** wird in Element Call unabhängig von den Kacheln über
  `LivekitRoomAudioRenderer` für alle Teilnehmer abgespielt. Ausgeblendete
  Teilnehmer bleiben daher hörbar (durch einen Test abgesichert).
- **Ressourcen:** Element Call verbindet LiveKit mit `adaptiveStream: true`
  und `dynacast: true`. Eine ausgeblendete Kachel hat kein `<video>`-Element
  mehr; LiveKit pausiert dadurch automatisch den Videoempfang dieses Tracks
  (die Verbindung und Audio bleiben bestehen). Kleine Kacheln bekommen
  automatisch eine niedrigere Simulcast-Ebene. Ein maximierter Stream
  blendet die übrigen Videos aus, solange er maximiert ist.
- E2EE, MatrixRTC-Mitgliedschaft und Geräteauswahl bleiben unverändert der
  Upstream-Code.

### Standardansicht

Das Preset „Standardansicht (Element)“ schaltet das eigene Layout komplett ab;
dann läuft exakt der unveränderte Element-Call-Code (Grid/Spotlight inkl.
dessen Umschalter). „Auf Standardansicht zurücksetzen“ verwirft zusätzlich
alle Anpassungen des Raums.

## Windows-App

| Eigenschaft            | Mosaix                                  | Offizielles Element |
| ---------------------- | ----------------------------------------------- | ------------------- |
| Produktname            | Mosaix                                  | Element             |
| App-ID                 | `io.github.bensiebert04.mosaix`          | `im.riot.app`       |
| Profil                 | `%APPDATA%\Mosaix`                      | `%APPDATA%\Element` |
| Installationsort       | `%LOCALAPPDATA%\Programs\mosaix` (änderbar) | Squirrel `%LOCALAPPDATA%\element-desktop` |
| Protokoll (SSO/OIDC)   | `io.github.bensiebert04.mosaix://`       | `io.element.desktop://`, `element://` |
| Auto-Update            | **aus** (kein `update_base_url`)                | an                  |
| Analytics / Rageshake  | aus                                             | PostHog / Rageshake |

Beide Apps können parallel installiert sein und laufen.
