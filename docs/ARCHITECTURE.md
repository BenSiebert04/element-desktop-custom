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

## Entscheidung: Wo wird geändert?

- **Call-Layout:** vollständig in Element Call (git subtree, siehe unten).
- **Private Voice** (Raumliste, Kopfzeile, Lobby; siehe
  [PRIVATE_VOICE.md](PRIVATE_VOICE.md)): in Element Web. Die Modul-API von
  Element Web reicht dafür nicht (keine Raumlisten-Abschnitte, keine
  Anruf-Buttons pro Raum). Element Web wird deshalb **aus dem Quellcode** des
  Tags in `upstream.json` gebaut, mit unseren Änderungen (siehe
  [Element Web](#element-web)). Der Ordner `widgets/element-call/` wird
  danach durch unseren Element-Call-Build ersetzt und eine eigene
  `config.json` hinzugefügt.
- **Element Desktop** wird aus dem offiziellen Tag gebaut, mit einer einzigen
  kleinen Änderung (`element-web/patches-desktop/`, von
  `scripts/prepare-desktop.mjs` angewendet): Fordert der Anruf beim
  Bildschirm-Teilen Ton an, gibt Mosaix unter Windows den Systemton mit
  (Electron `audio: "loopback"`).
  Branding (Name, App-ID, Protokoll, Icon) erfolgt über den vorgesehenen
  Mechanismus „Variant“ (`VARIANT_PATH`) und zusätzliche Dateien. Die
  Windows-Paketierung überschreibt nur die `win`/`nsis`-Einstellungen in einer
  eigenen electron-builder-Konfiguration, die die Upstream-Konfiguration
  importiert.

## Element Web

Unsere Änderungen an Element Web liegen nicht als Fork, sondern als

- `element-web/overlay/` – neue Dateien (`apps/web/src/mosaix/…`), werden
  unverändert in den Checkout kopiert, und
- `element-web/patches/mosaix.patch` – kleine Eingriffe in bestehende Dateien,
  jeweils mit `[mosaix]` markiert.

`node scripts/element-web.mjs apply <checkout>` wendet beides auf einen
frischen Checkout des Tags an; `… export <checkout>` schreibt Änderungen aus
einem Entwicklungs-Checkout zurück (Paketdateien und Lockfile nie).

| Datei (in `apps/web/src`)                                   | Änderung |
| ----------------------------------------------------------- | -------- |
| `stores/room-list-v3/section.ts`                            | Kategorien des aktiven Spaces als Abschnitte einfügen |
| `stores/room-list-v3/skip-list/filters/SectionFilter.ts`    | Raum → Kategorie-Abschnitt (persönliche Tags haben Vorrang) |
| `stores/room-list-v3/RoomListStoreV3.ts`                    | bei Konfigurations- oder Space-Wechsel Abschnitte neu aufbauen |
| `viewmodels/room-list/RoomListViewModel.ts`                 | Abschnittsnamen aus der Konfiguration |
| `viewmodels/room-list/RoomListSectionHeaderViewModel.ts`    | verwaltete Abschnitte ohne Menü / Drag-Ziel |
| `viewmodels/room-list/RoomListItemViewModel.ts`             | Raumname aus der Konfiguration (live), nicht „Verschieben nach“ verwaltete Abschnitte |
| `components/views/rooms/RoomHeader/RoomHeader.tsx`          | Name, Kennzeichnungen, keine Anruf-Buttons in verwalteten Texträumen |
| `stores/RoomViewStore.tsx`                                  | verwaltete Sprachräume öffnen die Anrufansicht |
| `models/Call.ts`                                            | dort Lobby statt Direktbeitritt, Audio-Absicht |
| `i18n/strings/en_EN.json`, `de_DE.json`                     | Texte unter `mosaix.private_voice` |
| `models/Call.test.ts`, `stores/RoomViewStore.test.ts`, `viewmodels/room-list/RoomListItemViewModel.test.ts` | zusätzliche Tests |

## Repository-Aufbau

```
element-desktop-custom/
├── element-call/               Element Call v0.26.1 als git subtree (+ unsere Commits)
│   └── src/custom-layout/      ← neuer Code des erweiterten Call-Layouts
├── element-web/                unsere Änderungen an Element Web (overlay/ + patches/)
├── branding/                   variant.json, config.json, Icons
├── desktop/electron-builder.custom.ts   Windows-Installer (NSIS + Zip)
├── scripts/                    element-web.mjs, prepare-webapp.mjs, prepare-desktop.mjs, generate-icons.py
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
