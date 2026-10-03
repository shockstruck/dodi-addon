# dodi-addon

An [OpenGameInstaller](https://github.com/Nat3z/OpenGameInstaller) (OGI) addon for [DODI Repacks](https://dodi-repacks.site).

## What it does

- **Search.** For a game in your OGI library or the store, it searches the DODI site, picks the closest-named listing and reads its game page.
- **Download links.** Each download group on the page (torrent, SwiftUploads, DataNodes, update packs and so on) appears as an entry. DODI's links go through hoster pages with captchas and countdowns, so the addon does not try to resolve them: picking an entry opens the hoster page in your default browser and logs the mirror links.
- **Local Files.** After you have downloaded and extracted a repack yourself, pick **Local Files** and select its `setup.exe`.
- **Setup.** The addon runs the Inno Setup installer (through `umu-run` on Linux and macOS, directly on Windows), asks where you installed it, finds the game executable (it ranks candidates and only asks when it is unsure) and hands the result back to OGI.

It does not download game payloads itself, and it does not bypass captchas or bot protection.

## Adding it to OGI

Make sure Git and [Bun](https://bun.sh) are installed. In OGI go to `Settings > General`, add this to the addons field and press "Install All":

```
https://github.com/shockstruck/dodi-addon
```

Then press "Restart Addons Server".

## Development

```
bun install --frozen-lockfile
bunx tsc --noEmit
bun test
bun run fixtures   # prints what the parser extracts from the saved HTML fixtures
```

Parsing and matching are pure functions tested against saved copies of a DODI search page, an empty search page and one game page in `tests/fixtures/`. No test touches the network. The fixtures are snapshots of a third-party site, kept only to test the parser.

## Attribution

The setup flow, executable detection (`src/executable-detection.ts`), title matching (`src/string-similarity.ts`) and umu path resolution (`src/umu-path.ts`) are ported from [fatboy-unpack](https://github.com/shockstruck/fatboy-unpack), the FitGirl addon for OGI by Nat3z (MIT, Copyright (c) 2024 Nat3z), including ShockStruck's changes to it. The DODI scraping, parsing and entry points are new. No code was copied from steamrip-addon.

## Licence

MIT. See [`LICENSE`](LICENSE): Copyright (c) 2024 Nat3z, Copyright (c) 2026 shockstruck.

This project is not affiliated with DODI or the OGI project.
