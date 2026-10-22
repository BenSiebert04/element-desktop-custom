# End-to-End-Test des Call-Layouts

Echter Anruf mit drei Teilnehmern (headless Chromium mit Fake-Kamera,
-Mikrofon und -Bildschirm) gegen ein lokales MatrixRTC-Backend:

- **Synapse** (pip, `localhost:8448`, Registrierung offen, nur lokal)
- **LiveKit SFU** und **lk-jwt-service** (feste Release-Versionen, Checksummen geprüft)
- **Element Call** dieses Repositorys als Standalone-Build

Kein Teil davon berührt einen echten Homeserver; alle Daten liegen in
`e2e/.work` (Wegwerf-Umgebung, nur Linux x64).

```sh
cd element-call && pnpm install --frozen-lockfile && cd ..
e2e/setup.sh      # einmalig: Downloads, Synapse-Konfiguration, Element-Call-Build
e2e/start.sh      # Backend starten
node e2e/call-layout.e2e.mjs   # Test (Screenshots in e2e/results/)
e2e/stop.sh
```

Geprüft wird aus Sicht der dritten Teilnehmerin, während zwei Personen
gleichzeitig ihren Bildschirm teilen:

1. Beide Screenshares sind gleichzeitig groß nebeneinander sichtbar und
   spielen Video, die Kameras klein darunter.
2. Kamera und Screenshare derselben Person lassen sich getrennt ausblenden.
3. Ist alles ausgeblendet, kommt **kein Video** mehr an (WebRTC-Statistik
   `inbound-rtp`), **Audio** wird weiter empfangen und abgespielt.
4. Preset „Zwei Streams“, Kameras aus, Trennlinie per Maus auf 70/30.
5. Ein Teilnehmer verlässt den Anruf; der verbleibende Stream übernimmt die Fläche.
6. „Auf Standardansicht zurücksetzen“ stellt Element Calls Ansicht wieder her.

Hinweis: Synapse läuft hier mit Raumversion 10 als Standard, weil die
Raumerstellung im Standalone-Modus von Element Call 0.26 mit Raumversion 12
nicht kompatibel ist. In der Desktop-App erstellt Element Web den Raum, dort
betrifft das nicht.
