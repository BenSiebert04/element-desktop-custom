# Private Voice: automatische Client-Konfiguration

Mosaix liest eine vom Server gepflegte Konfiguration aus den **globalen
Account-Daten** des angemeldeten Nutzers und stellt damit einen
Discord-ähnlichen Server (Space) übersichtlich dar: Kategorien als
einklappbare Abschnitte, Text- und Sprachräume, Kennzeichnung der
Discord-Brücke. Ohne Konfiguration verhält sich Mosaix exakt wie Element.

## Datenquelle

| | |
| --- | --- |
| Event-Typ (Standard) | `io.github.bensiebert04.mosaix.private_voice` |
| Ort | globale Account-Daten (`/user/{userId}/account_data/{type}`) |
| Abruf | über die normale Matrix-Synchronisation des SDK (initialer `/sync`, danach live) |
| Schema | `schema_version: 1` |

Mosaix sendet dafür **keine eigenen Anfragen**: Die Daten kommen mit dem
`/sync`, den Element ohnehin ausführt – also nur zum angemeldeten Homeserver,
mit dem Token im `Authorization`-Header. Es gibt keine weitere
Konfigurations-URL, kein Admin-Token, und der Token taucht weder in URLs noch
in Logs auf. Mosaix schreibt die Account-Daten nie selbst.

## Einstellungen in `config.json`

Alle optional:

```json
"mosaix_private_voice": {
    "enabled": true,
    "account_data_type": "io.github.bensiebert04.mosaix.private_voice",
    "homeservers": ["https://matrix.example.org"]
}
```

- `enabled: false` schaltet die Funktion ab.
- `account_data_type` ändert den Event-Typ.
- `homeservers` beschränkt die Funktion auf bestimmte Homeserver-URLs
  (ohne Angabe: jeder Homeserver).

## Verhalten

- **Kategorien**: Für den in der Konfiguration genannten Space erscheinen die
  Kategorien als einklappbare Abschnitte (sortiert nach `order`, dann
  `category_id`), jeder Raum genau einmal. Leere Kategorien werden
  ausgeblendet, Räume ohne Kategorie bleiben normal unter „Räume“. Existiert
  schon eine eigene Element-Section mit demselben `section_tag`, wird sie
  verwendet statt verdoppelt; ihr eigener Name bleibt erhalten, wenn
  `preserve_user_overrides` gilt. Favoriten, „Niedrige Priorität“ und eigene
  Abschnitte haben Vorrang. Es werden **keine Tags oder Account-Daten
  geschrieben** – die Abschnitte sind reine Darstellung.
- **Raumnamen** aus der Konfiguration werden als reiner Text angezeigt (Liste
  und Kopfzeile); HTML/Markdown wird nie interpretiert.
- **Verwaltete Texträume**: Die Anruf-Buttons in der Kopfzeile fehlen ganz
  (nicht ausgegraut), außer `managed_text_rooms.show_call_controls` ist `true`.
- **Verwaltete Sprachräume** öffnen die Element-Call-**Lobby** mit Mikrofon an
  und Kamera aus. Beigetreten wird nur per Klick; danach sind Kamera und
  Bildschirmfreigabe normal nutzbar. Der Chat bleibt über die Kopfzeile
  erreichbar.
- **Kennzeichnungen**: „Sprachraum“, „Nur Matrix“, „Discord: Audio/Video/Text“
  genau nach `bridged_media` (Audio ≠ Video), „Nicht verschlüsselt“, wenn
  E2EE erwartet wird, der Raum aber nicht verschlüsselt ist. Maßgeblich sind
  immer die echten Raumdaten (Mitgliedschaft, Rechte, Verschlüsselung); die
  Konfiguration verleiht keine Rechte und ändert keine E2EE-Einstellungen.
- **Unverwaltete Räume und Direktchats** bleiben unverändert, inklusive
  Anruf-Buttons.
- Nur Räume, in denen der Nutzer Mitglied ist, werden angezeigt. Es gibt
  keine automatischen Einladungen, Beitritte oder Raumerstellungen.
- **Entfernen** eines Raums oder der ganzen Konfiguration (`{}` oder
  `spaces: []`) entfernt nur die Darstellung; Chatverlauf und Mitgliedschaft
  bleiben.

## Jam-Kanal (Spotify Jam)

Ein Raum mit `"kind": "jam"` im Manifest ist ein Jam-Kanal. Oben im Kanal
zeigt Mosaix, wer gerade einen **Spotify Jam** laufen hat (Name, Titel, seit
wann), mit **Beitreten**-Button. Der Button öffnet den Jam-Link in Spotify; den
Rest (gleicher Song, gleiche Stelle, Überspringen für alle) macht Spotify
selbst. In der Raumliste steht beim Kanal die Zahl laufender Jams
(„♪ 2 live“). Jam-Kanäle haben keine Anruf-Buttons.

- **Teilen:** „Meinen Jam teilen“ → Link aus Spotify einfügen (Jam →
  Einladen → Link teilen), optional ein Titel. Angenommen werden nur
  `https://open.spotify.com/socialsession/…` und `https://spotify.link/…`.
- **Beenden:** „Jam beenden“ beim eigenen Eintrag.
- **Daten:** State-Event `io.github.bensiebert04.mosaix.jam` mit der eigenen
  Matrix-ID als State-Key:
  `{"url", "title", "started_ts", "status": "active" | "ended", "checked_ts", "ended_reason"}`.
  Mosaix zeigt nur Einträge mit `status: "active"`, gültigem Link, Absender =
  State-Key und Mitgliedschaft im Raum. Titel sind reiner Text (max. 80
  Zeichen).
- **Server:** legt den Kanal an (State-Event für Mitglieder erlaubt), prüft die
  Links und setzt beendete Jams auf `"ended"`. Keine Spotify-Developer-App,
  keine Spotify-Konten auf dem Server.
- **Spotify:** Den Jam startet der Gastgeber (Premium); wer beitreten kann,
  regelt Spotify.

## Robustheit

- Unbekannte oder neuere `schema_version`, falsche `user_id` oder kaputte
  Daten werden ignoriert (Element-Standardansicht); einzelne fehlerhafte oder
  doppelte Einträge werden verworfen, unbekannte Felder ignoriert.
- Änderungen werden über `revision` erkannt; dieselbe Revision wird nicht
  erneut angewendet.
- Die letzte gültige Konfiguration wird lokal pro Homeserver und Matrix-ID
  zwischengespeichert. Startet Mosaix offline, wird sie verwendet und als
  „Offline“ markiert; nach der ersten erfolgreichen Synchronisation gilt
  wieder nur der Serverstand (auch Entfernungen). Bei Abmeldung oder
  Kontowechsel wird nichts übernommen.
- Room-IDs werden als undurchsichtige Zeichenketten behandelt (kein Doppelpunkt
  vorausgesetzt).

## Alter Workaround

Vor dieser Funktion konnten Anruf-Buttons nur **global** abgeschaltet werden,
z. B. mit `"setting_defaults": { "UIFeature.voip": false }` in `config.json`.
Das blendet Anrufe auch in Direktchats aus und ist mit Private Voice nicht mehr
nötig. Mosaix setzt diese Einstellung nicht und entfernt eine vorhandene auch
nicht stillschweigend – wer sie gesetzt hat, sollte sie selbst entfernen.

## Grenzen

- Kein eigener HTTP-Abruf als Fallback: Die Konfiguration kommt ausschließlich
  über die Synchronisation des SDK.
- Die Kategorien gelten für den in der Konfiguration genannten Space, wenn er
  in der Space-Leiste ausgewählt ist (nicht in „Start“).
- Raumnamen aus der Konfiguration ersetzen den Matrix-Namen in Raumliste und
  Kopfzeile, nicht aber z. B. in Benachrichtigungen oder der Suche.
- Ein „Sprachraum“ ist ein normaler Matrix-Raum, der standardmäßig die
  Anrufansicht zeigt; Element-Videoräume bleiben wie gehabt.

## Code

Neuer Code: `element-web/overlay/apps/web/src/mosaix/private-voice/`
(Parser, Store, Raumlisten-Logik, Badges, Tests). Eingriffe in Element Web:
`element-web/patches/mosaix.patch`, alle Stellen mit `[mosaix]` markiert –
siehe [ARCHITECTURE.md](ARCHITECTURE.md#element-web).
