# Upstream-Updates einspielen

Mosaix besteht aus drei Upstream-Teilen, die getrennt aktualisiert
werden. Alle Versionen stehen in [`upstream.json`](../upstream.json).

## Element Web / Element Desktop

1. Neues Release auf <https://github.com/element-hq/element-web/releases>
   wählen, z. B. `v1.12.40`, und in `upstream.json` `elementWeb.tag`
   eintragen.
2. Unsere Element-Web-Änderungen auf den neuen Tag bringen:
   ```sh
   git clone --branch v1.12.40 https://github.com/element-hq/element-web build/ew
   node scripts/element-web.mjs apply build/ew
   ```
   Lässt sich der Patch nicht anwenden, die betroffenen `[mosaix]`-Stellen
   von Hand übertragen (Liste in
   [ARCHITECTURE.md](ARCHITECTURE.md#element-web)), dann `pnpm install`,
   Tests (siehe [Lokal bauen](#lokal-bauen)) und
   `node scripts/element-web.mjs export build/ew`.
3. Prüfen, welche Element-Call-Version Element Web mitbringt:
   `apps/web/package.json` → `@element-hq/element-call-embedded`. Unser
   Element Call sollte auf derselben Minor-Version basieren (siehe unten).
4. Push → CI baut und testet alles.

Falls Element Desktop seine `electron-builder.ts` stark umbaut, muss ggf.
`desktop/electron-builder.custom.ts` angepasst werden (sie importiert die
Upstream-Datei und überschreibt nur `win`/`nsis`).

## Element Call

Element Call liegt als **git subtree** in `element-call/`. Update auf einen
neuen Tag:

```sh
git subtree pull --prefix element-call https://github.com/element-hq/element-call v0.27.0 --squash
```

Git führt dabei einen normalen 3-Wege-Merge zwischen dem neuen Upstream-Stand
und unseren Änderungen durch. Konflikte können nur in den wenigen
angepassten Upstream-Dateien auftreten (alle mit `[element-custom]` markiert,
Liste in [ARCHITECTURE.md](ARCHITECTURE.md#eingriffe-in-bestehende-element-call-dateien)).
Danach:

```sh
cd element-call
pnpm install --frozen-lockfile
pnpm lint:types
pnpm exec vitest run --project=unit
```

und in `upstream.json` `elementCall.tag` aktualisieren.

Unsere eigenen Änderungen anzeigen:

```sh
git diff <upstream-squash-commit> HEAD -- element-call
git log --oneline -- element-call/src/custom-layout
```

## Lokal bauen

Voraussetzungen: Node.js 24, pnpm 11 (`npm i -g pnpm@11`), git; für den
Windows-Installer ein Windows-Rechner (unter Linux lässt sich zum Testen
`--linux dir` bauen).

```sh
# 1. Element Call (embedded)
cd element-call
pnpm install --frozen-lockfile
pnpm build:embedded
cd ..

# 2. Element Web aus dem Quellcode, mit unseren Änderungen
git config --global core.longpaths true   # nur Windows
git clone --depth 1 --branch v1.12.32 https://github.com/element-hq/element-web build/element-web
node scripts/element-web.mjs apply build/element-web
cd build/element-web
pnpm install --frozen-lockfile
cd apps/web
pnpm exec nx run-many -t test:unit:prepare -p
pnpm exec vitest run --project unit src/mosaix   # Tests von Private Voice
pnpm run build                                   # Ergebnis: apps/web/webapp
cd ../../../..

# 3. Webapp: dieses Element Web + unser Element Call + config.json
node scripts/prepare-webapp.mjs --from build/element-web/apps/web/webapp

# 4. Element Desktop (derselbe Checkout)
node scripts/prepare-desktop.mjs build/element-web/apps/desktop --webapp build/webapp
cd build/element-web/apps/desktop
pnpm install --frozen-lockfile --filter element-desktop
pnpm exec tsc
node scripts/copy-res.ts
pnpm run asar-webapp
VARIANT_PATH=variant.json pnpm exec electron-builder --config electron-builder.custom.ts --publish never --win --x64
# Ergebnis: dist/Mosaix-Setup-<version>-x64.exe
```

Nur das Call-Layout entwickeln (ohne Desktop-App): `cd element-call && pnpm dev`
startet Element Call standalone; Tests mit `pnpm exec vitest --project=unit
src/custom-layout`.
