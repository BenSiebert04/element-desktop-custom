# Installation, Start und Anmeldung

## 1. Installer herunterladen

1. Auf GitHub im Repository unter **Actions → „Build Windows app“** den
   neuesten erfolgreichen Lauf öffnen (oder unter **Releases**, falls ein
   Tag `v…` erstellt wurde).
2. Unten bei **Artifacts** `Mosaix-Windows-x64-<Version>` laden und
   entpacken. Enthalten sind:
   - `Mosaix-Setup-<Version>-x64.exe` – Installer
   - `Mosaix-<Version>-x64.zip` – portable Version (entpacken, `Mosaix.exe` starten)
   - `SHA256SUMS.txt` – Prüfsummen

GitHub-Actions-Artefakte werden nach 30 Tagen gelöscht; für dauerhafte
Downloads einen Tag setzen (`git tag v1.12.32-custom.1 && git push --tags`),
dann entsteht ein GitHub-Release.

## 2. Installieren

`Mosaix-Setup-…exe` ausführen. Der Installer installiert nur für den
aktuellen Benutzer (keine Admin-Rechte nötig), standardmäßig nach
`%LOCALAPPDATA%\Programs\mosaix`; der Ordner kann geändert werden.
Es werden Startmenü- und Desktop-Verknüpfung „Mosaix“ angelegt.

Die offizielle Element-App bleibt unberührt und kann parallel laufen:
eigenes Profil (`%APPDATA%\Mosaix`), eigene App-ID, eigenes
Login-Protokoll. Beim Deinstallieren bleiben deine Daten erhalten.

### Windows SmartScreen

Der Build ist **nicht mit einem Code-Signing-Zertifikat signiert**. Folgen:

- Beim ersten Start zeigt Windows „Der Computer wurde durch Windows
  geschützt“. Auf **Weitere Informationen → Trotzdem ausführen** klicken.
- Manche Virenscanner/Firmenrichtlinien blockieren unsignierte Programme.
- Integrität prüfen: `Get-FileHash .\Mosaix-Setup-*.exe -Algorithm SHA256`
  mit `SHA256SUMS.txt` vergleichen.

Mit einem eigenen Zertifikat signiert Element Desktops Konfiguration
automatisch, wenn die Variablen `ED_SIGNTOOL_SUBJECT_NAME` und
`ED_SIGNTOOL_THUMBPRINT` (bzw. `CSC_LINK`/`CSC_KEY_PASSWORD`) im Workflow
gesetzt werden.

### Keine automatischen Updates

Mosaix aktualisiert sich nicht selbst (kein `update_base_url` in der
Konfiguration), offizielle Element-Releases können es also nicht
überschreiben. Neue Versionen installierst du, indem du den neuen Installer
über die bestehende Installation laufen lässt.

## 3. Anmelden an deinem Homeserver

1. Mosaix starten → **Anmelden**.
2. Bei „Homeserver“ auf **Bearbeiten** klicken und deinen Server eintragen
   (z. B. `matrix.example.org`). Es werden keine Zugangsdaten mitgeliefert.
3. Benutzername/Passwort bzw. SSO wie gewohnt. SSO/OIDC-Rückleitungen laufen
   über das eigene Protokoll `io.github.bensiebert04.mosaix`, das der
   Installer registriert.
4. Wie bei jedem neuen Gerät die Sitzung verifizieren (Sicherheitsschlüssel
   oder anderes Gerät), damit verschlüsselte Nachrichten lesbar sind.

Hinweis für Matrix Authentication Service (MAS): Die App registriert sich
dynamisch mit `client_uri = https://bensiebert04.github.io/mosaix`
und dem passenden Redirect-Schema. Bei Standard-MAS-Richtlinien funktioniert
das; falls eine Richtlinie nur bekannte Clients zulässt, muss der Client dort
erlaubt werden.

Optional: Eine eigene `config.json` (z. B. mit deinem Server als Standard)
kannst du unter `%APPDATA%\Mosaix\config.json` ablegen; sie
überschreibt die mitgelieferte Konfiguration:

```json
{
    "default_server_config": {
        "m.homeserver": { "base_url": "https://matrix.example.org" }
    }
}
```

## 4. Anrufe

Anrufe starten und betreten funktioniert wie im normalen Element
(Sprachkanäle/Videoräume, Anruf-Button im Raum). In der Anrufansicht:

- Unten links **„Layout anpassen“** (Raster-Symbol) → Panel mit Layouts,
  Stream-Liste, gespeicherten Layouts und Zurücksetzen.
- Über jeder Kachel erscheint beim Darüberfahren eine Leiste: Ziehen-Griff,
  Anheften, Maximieren, Vollbild, Ausblenden.
- Rechtsklick auf eine Kachel öffnet das Kontextmenü: Lautstärke (bis 200 %,
  pro Person gespeichert), Transparenz, im freien Layout Ebene und
  Vorder-/Hintergrund.
- Doppelklick maximiert/verkleinert eine Kachel.
- Unten links zeigt „N ausgeblendet“, wie viele Streams versteckt sind;
  ein Klick öffnet die Liste zum Wiedereinblenden.

Beispiele:

| Gewünscht | So geht's |
| --- | --- |
| Zwei Screenshares nebeneinander, Teilnehmer klein darunter | Layout „Automatisch“ oder „Zwei Streams“ |
| Screenshare 70 % / 30 %, keine Kameras | „Zwei Streams“, Trennlinie ziehen, „Alle Kameras ausblenden“ |
| Vier gleich große Streams | „Vier Streams“ |
| Großer Hauptstream, Rest rechts | „Hauptstream + Seitenleiste“ (Hauptstream per Pin oder Drag & Drop wählen) |
| Alles frei anordnen | „Freies Layout“ |
| Zurück zum Original | „Standardansicht (Element)“ oder „Auf Standardansicht zurücksetzen“ |

Alle Einstellungen werden automatisch für den jeweiligen Raum gespeichert.
