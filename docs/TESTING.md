# Tests und bekannte Einschränkungen

## Automatisierte Tests

| Ebene | Wo | Läuft in CI | Inhalt |
| --- | --- | --- | --- |
| Geometrie | `element-call/src/custom-layout/computePlacements.test.ts` | ja | alle Presets, 2 Screenshares nebeneinander, 70/30, 2×2, Seitenleiste, Ausblenden, Pinning, Maximieren, Fenstergrößen (1920×1080, halber Bildschirm 960×1040, klein), keine Überlappungen, freie Positionen skalieren |
| ViewModel/Speicherung | `CustomLayoutViewModel.test.ts` | ja | Ausblenden (Kamera/Screenshare getrennt, ganze Person), „Alle Kameras“, Teilnehmer geht/kommt, Drag-Tausch, Teiler/Resize, Standardansicht wiederherstellen, raumweise Speicherung + Raumwechsel, benannte Layouts, globaler Standard, defekte gespeicherte Daten |
| Komponenten | `CustomLayoutView.test.tsx` | ja | Rendering mit 2 Screenshares, 2×2, ohne Screenshare, Ausblenden per Kachel-Leiste, „Alle einblenden“, Drag & Drop (Tausch), Verschieben + Größenänderung freier Kacheln mit der Maus, Teiler ziehen (70/30), Doppelklick-Maximieren, Fenstergröße ändern, Teilnehmer kommt/geht; Panel: Liste, getrennt ausblenden, Presets, Speichern/Laden, Zurücksetzen |
| Integration | `element-call/src/room/InCallView.test.tsx` | ja | eigenes Layout ersetzt das Grid, **ausgeblendete Person bleibt hörbar** (Audio-Renderer unverändert), Panel aus der Fußleiste, Standardansicht vollständig wiederhergestellt |
| Upstream Element Call | alle übrigen Element-Call-Unit-Tests | ja | Regressionstest der unveränderten Anruf-Logik |
| Upstream Element Desktop | Unit-Tests von `apps/desktop` (v1.12.32) | ja | Regressionstest Desktop-Hauptprozess mit unserem Branding |
| End-to-End | `e2e/call-layout.e2e.mjs` | nein (lokal, Linux) | echter Anruf über LiveKit mit 3 Browsern und 2 Screenshares |
| End-to-End | `e2e/element-web.e2e.mjs` | nein (lokal, Linux) | ausgelieferte Webapp (Element Web + unser Widget), verschlüsselter Raum, Nachricht, Anruf aus der Raum-Kopfzeile |
| Private Voice | `element-web/overlay/apps/web/src/mosaix/private-voice/*.test.ts(x)` | ja | Parser (fehlend, ungültig, neuere Version, falsche user_id, unbekannte Felder, Unicode, Kategorie `null`, Duplikate, Room-IDs ohne Doppelpunkt), Store (initial + live, gleiche Revision, Kontowechsel/Abmeldung, Offline-Cache als „stale“, Entfernen nach erfolgreichem Sync, Homeserver-Beschränkung), Raumliste (Kategorien, Reihenfolge, keine Duplikate, Favoriten/eigene Abschnitte bleiben), Kopfzeile (keine Anruf-Buttons im Textraum, DM unverändert, Brücken-Kennzeichnung) |
| Upstream Element Web | Tests der geänderten Bereiche (Raumliste v3, Raumlisten-ViewModels, RoomHeader, RoomViewStore, Call) | ja | Regressionstest plus zusätzliche `[mosaix]`-Tests |
| End-to-End | `e2e/private-voice.e2e.mjs` | nein (lokal, Linux) | gerenderte Element-Web-App: vier Kategorien live, Textraum ohne Anruf-Buttons mit Verlauf, Sprachraum-Lobby + Kamera + Bildschirmfreigabe, DM mit Anruf-Buttons, Entfernen |

Zusätzlich wurde der fertige Windows-Build aus CI heruntergeladen und geprüft:
`webapp.asar` enthält das angepasste Element Call, `config.json` hat kein
`update_base_url`, `app.asar` trägt Name/App-ID/Protokoll von Mosaix.
Unter Linux wurde ein Testbuild derselben Konfiguration gestartet (Login-
Bildschirm erscheint, Profil in einem eigenen Ordner).

### Ergebnisse (Stand dieses Commits)

- Element Call Unit-Tests: **100 Testdateien, 829 Tests bestanden** (9 von Upstream übersprungen), davon 70+ neue Tests für das Layout.
- Element Desktop Unit-Tests: **20 Dateien, 216 Tests bestanden**.
- Typecheck (tsc), oxlint, knip: ohne Befund.
- E2E `call-layout`: bestanden. Gemessen mit WebRTC-Statistiken: alles
  ausgeblendet → **0 kB/s Video**, Audio weiter ~12 kB/s.
- E2E `element-web`: bestanden (verschlüsselte Nachricht, Anruf über Element
  Web, zwei Screenshares groß im eingebetteten Widget).
- GitHub Actions: Windows-Installer und ZIP gebaut.

### Was nicht getestet werden konnte

- **Kein Test auf einem echten Windows-11-Rechner.** Der Installer wird auf
  `windows-2025` gebaut, aber nicht ausgeführt. Bitte Installation, Start,
  Login und einen Anruf selbst prüfen.
- **Kein Test gegen deinen Homeserver** oder mit der Discord-Bridge. Element
  Web und die Matrix-Logik sind unverändert; die Bridge ist für Anrufe nicht
  beteiligt.
- Echte Bildschirmaufnahme unter Windows (Electron-Auswahldialog) wurde nicht
  getestet; sie ist unverändertes Upstream-Verhalten.
- Firefox/Safari spielen für die Desktop-App keine Rolle und wurden nicht
  getestet.

## Bekannte Einschränkungen

- **Unsigniert:** SmartScreen-Warnung beim ersten Start (siehe INSTALL.md).
- **Nur Gruppenanrufe über Element Call.** Alte 1:1-Anrufe (legacy WebRTC,
  `m.call.*`) und Jitsi-Konferenzen nutzen eine eigene Oberfläche und haben
  das neue Layout nicht.
- **Ein Screenshare pro Gerät:** Element Call/LiveKit erlaubt je Teilnehmer-
  Gerät nur eine Bildschirmfreigabe. Mehrere Screenshares gleichzeitig kommen
  also von verschiedenen Personen bzw. Geräten – dafür ohne Begrenzung.
- **Bild-im-Bild/PiP:** Wird der Anruf in Element Web minimiert (kleines
  Fenster), zeigt Element Call weiterhin seine eigene PiP-Ansicht.
- **Ressourcen:** Ausgeblendete und durch Maximieren verdeckte Videos werden
  nicht empfangen (LiveKit adaptive stream). Viele große, gleichzeitig
  sichtbare Videos brauchen entsprechend Bandbreite und Dekodierleistung –
  das ist gewollt, aber zu beachten.
- **Ausgeblendet = lokal:** Die Einstellung gilt nur für dieses Gerät/Profil;
  sie wird nicht zwischen Geräten synchronisiert.
- **Teilnehmer-Schlüssel:** Ausblenden/Positionen werden pro Gerät des
  Teilnehmers gespeichert (`@nutzer:server:GERÄT`). Tritt jemand mit einem
  neuen Gerät bei, erscheint er zunächst wieder sichtbar.
- **Sprache:** Die neuen Texte gibt es auf Deutsch und Englisch; andere
  Sprachen zeigen Englisch.
- **Element-Branding in der Oberfläche:** Element Web selbst ist unverändert,
  daher erscheinen im Login-Bildschirm weiterhin Element-Logos/-Texte.
- **Lokale Entwicklung in der Cloud-Sandbox:** Hier war `codeload.github.com`
  gesperrt; `matrix-js-sdk` musste lokal gebaut und eingehängt werden. In
  GitHub Actions und auf normalen Rechnern ist das nicht nötig.
