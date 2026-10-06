# dodi-addon

An [OpenGameInstaller](https://github.com/Nat3z/OpenGameInstaller) (OGI) addon for [DODI Repacks](https://dodi-repacks.site).

## What it does

- **Search.** For a game in your OGI library or the store, it searches the DODI site, picks the closest-named listing and reads its game page.
- **Download links.** Each download group on the page (torrent, SwiftUploads, DataNodes, update packs and so on) appears as a selectable source, for games you do not own yet as well. DODI's links go through hoster pages with captchas and countdowns, so the addon does not try to resolve them. Picking a source opens the first link in your default browser, logs the mirror links, and asks you to select the `setup.exe` of the repack once you have downloaded and extracted it. (Sources are `request` results rather than tasks because OGI hides task results for games you do not own.)
- **Local Files.** If you already downloaded and extracted a repack, pick **Local Files** and select its `setup.exe`.
- **Setup.** The addon runs the Inno Setup installer (through `umu-run` on Linux and macOS, directly on Windows), asks where you installed it, finds the game executable (it ranks candidates and only asks when it is unsure) and hands the result back to OGI.
- **Automate Setup under Wine (experimental).** An addon setting, off by default; expect it to fail. DODI installers have a custom start screen and a component page that unattended mode may not get past, and they unpack through ISDone/unarc, which is reported to fail under Wine/Proton. When on (Linux/macOS), `setup.exe` runs with `/VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART /LOADINF=… /LOG=…` into a `DODI Install` folder next to the repack files. It fails, and does not fall back, on a non-zero exit (reported as Inno Setup's documented meaning), an inactivity stall (no growth of the Inno log or the install folder for 15 minutes, checked every 30 s; the whole process group is then stopped), an empty install folder, or no game executable found; every message carries the path of `dodi-setup.log`. Nothing is deleted. The manual flow is the way to install.

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
bun test                          # unit + integration, no network
bun run fixtures                 # what the parser extracts from the saved fixtures
bun run smoke                    # opt-in: live read-only GETs to dodi-repacks.site
```

`tests/integration/` starts the real addon (`bun run src/main.ts --addonSecret=… --addonPort=…`) against a mock OGI addon server speaking the SDK's websocket protocol, with a local server standing in for the DODI site (`DODI_BASE_URL`) and a stub in place of `umu-run` (`OGI_UMU_RUN`) and one in place of the browser opener (`DODI_OPEN_CMD`). It covers the handshake, `configure`, `search`, `request-dl` and `setup` through both the manual and the silent branch, including the mapped Inno exit codes. The stub never starts Wine.

`ogi-addon` is pinned to `4.1.0` with `@ogi-sdk/connect` overridden to `1.0.2`, the combination the other OGI addons' lockfiles resolve to. Newer `4.x` releases (4.2.x, with `@ogi-sdk/connect` 1.2.x) crash at startup under Bun (`AsyncFiberException`); the integration tests would catch that.

Parsing and matching are pure functions tested against saved copies of a DODI search page, an empty search page and one game page in `tests/fixtures/`. No test touches the network. The fixtures are snapshots of a third-party site, kept only to test the parser.

## Attribution

The setup flow, the Wine/Inno helpers (`src/wine-setup.ts`, unchanged), executable detection (`src/executable-detection.ts`), title matching (`src/string-similarity.ts`) and umu path resolution (`src/umu-path.ts`) are ported from [fatboy-unpack](https://github.com/shockstruck/fatboy-unpack), the FitGirl addon for OGI by Nat3z (MIT, Copyright (c) 2024 Nat3z), including ShockStruck's changes to it. The DODI scraping, parsing and entry points are new. No code was copied from steamrip-addon.

## Licence

MIT. See [`LICENSE`](LICENSE): Copyright (c) 2024 Nat3z, Copyright (c) 2026 shockstruck.

This project is not affiliated with DODI or the OGI project.
