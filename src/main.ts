import OGIAddon, { ConfigurationBuilder, type SearchResult } from "ogi-addon";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  DODI_ORIGIN,
  buildSearchUrl,
  parseGamePage,
  parseSearchResults,
  type GamePage,
} from "./parse";
import { pickBestHit } from "./search";
import { browserCommand } from "./open-url";
import { resolveUmuBin } from "./umu-path";
import {
  AUTOMATE_WINE_SETUP_DEFAULT,
  decideSetupBranch,
  describeInnoExitCode,
} from "./wine-setup";
import { runProcess, runSilentSetup } from "./run-setup";
import {
  candidateAbsolutePath,
  resolveExecutableChoice,
  scanExecutables,
  scoreCandidates,
} from "./executable-detection";

const UMU_BIN = resolveUmuBin(process.env);

const addon = new OGIAddon({
  name: "DODI Repacks",
  id: "dodi-addon",
  author: "ShockStruck",
  description: "Finds DODI Repacks for your library and sets up the extracted repack.",
  repository: "https://github.com/shockstruck/dodi-addon",
  version: "1.0.0",
  storefronts: ["steam"],
});

addon.on("configure", (config) =>
  config.addBooleanOption((option) =>
    option
      .setName("automateWineSetup")
      .setDisplayName("Automate Setup under Wine (experimental)")
      .setDescription(
        "Experimental; expect it to fail. On Linux or macOS this runs the DODI repack's setup.exe unattended through Wine (/VERYSILENT) into a \"DODI Install\" folder next to the repack files. DODI installers have a custom start screen and a component page that unattended mode may not get past, and they unpack through ISDone/unarc, which is reported to fail under Wine/Proton. If it fails, the addon reports the Inno Setup exit code and the log path (dodi-setup.log) instead of installing, and the manual flow, which shows the setup wizard, is the way to install.",
      )
      .setDefaultValue(AUTOMATE_WINE_SETUP_DEFAULT),
  ),
);

// Test seam: DODI_BASE_URL points the addon at a local server instead of the live site.
const BASE_URL = (process.env.DODI_BASE_URL ?? DODI_ORIGIN).replace(/\/+$/, "");

async function fetchText(url: string): Promise<string> {
  const target = url.startsWith(DODI_ORIGIN) ? BASE_URL + url.slice(DODI_ORIGIN.length) : url;
  const response = await fetch(target);
  if (!response.ok) throw new Error(`${target} -> HTTP ${response.status}`);
  return response.text();
}

const pageCache = new Map<string, GamePage | null>();

async function lookupGame(name: string): Promise<GamePage | null> {
  const key = name.toLowerCase();
  if (pageCache.has(key)) return pageCache.get(key)!;
  const hits = parseSearchResults(await fetchText(buildSearchUrl(name)));
  const best = pickBestHit(name, hits);
  const page = best
    ? parseGamePage(await fetchText(best.url), best.url)
    : null;
  pageCache.set(key, page);
  return page;
}

const localFiles = (): SearchResult => ({
  downloadType: "request",
  name: "Local Files",
  manifest: { service: "local" },
});

addon.on("search", (data, event) => {
  event.defer(async () => {
    const results: SearchResult[] = [];
    try {
      if (data.for !== "task") {
        const game = await addon.getAppDetails(data.appID, data.storefront);
        const page = game ? await lookupGame(game.name) : null;
        for (const group of page?.groups ?? []) {
          results.push({
            downloadType: "task",
            taskName: "open-download-page",
            name: `${group.label} (${group.kind === "repack" ? "repack" : "update"}) | ${page!.name}`,
            manifest: {
              pageUrl: page!.url,
              label: group.label,
              urls: group.links.map((link) => link.url),
            },
          });
        }
      }
    } catch (error) {
      console.error("DODI search failed:", error);
      addon.notify({
        id: "dodi-addon-search-failed",
        type: "error",
        message: `DODI Repacks lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    // The manual path always comes last: download a repack yourself, then point OGI at it.
    event.resolve([...results, localFiles()]);
  });
});

// DODI links go through hoster pages (captcha / countdown), so the addon does
// not resolve them to a file URL. This task opens the page in the user's browser.
addon.onTask("open-download-page", async (task, { manifest }) => {
  const urls = Array.isArray(manifest.urls) ? (manifest.urls as string[]) : [];
  const first = urls[0] ? browserCommand(urls[0], process.platform) : null;
  if (!first) {
    task.fail("No valid http(s) download link to open.");
    return;
  }
  task.log(`Opening ${urls[0]}`);
  for (const mirror of urls.slice(1)) task.log(`Mirror: ${mirror}`);
  task.log(
    `Post: ${String(manifest.pageUrl ?? DODI_ORIGIN)}. When the download finishes, extract it and add the game via "Local Files".`,
  );
  const child = spawn(first.command, first.args, { stdio: "ignore", detached: true });
  child.on("error", (error) => task.log(`Could not open a browser: ${error.message}`));
  child.unref();
  task.complete();
});

addon.on("request-dl", (_appID, info, event) => {
  event.defer(async () => {
    if (info.manifest?.service !== "local") {
      event.fail("Unknown download request.");
      return;
    }
    const { setupExe } = (await event.askForInput(
      "DODI Repacks",
      "Select the repack's setup.exe",
      new ConfigurationBuilder().addStringOption((option) =>
        option
          .setName("setupExe")
          .setDisplayName("setup.exe")
          .setDescription("The installer in your extracted repack directory")
          .setInputType("file"),
      ),
    )) as { setupExe: string };
    if (!setupExe || !fs.existsSync(setupExe)) {
      event.fail("The selected setup.exe does not exist.");
      return;
    }
    event.resolve({
      name: `Local Files | ${info.name}`,
      downloadType: "empty",
      manifest: {
        service: "local",
        setupExe,
        pathOfSetupExe: dirname(setupExe),
      },
    });
  });
});

// Until OGI has pushed a config-update, reading an option throws; treat that as the default.
function automateWineSetup(): boolean {
  try {
    return (
      addon.config.getBooleanValue("automateWineSetup") ??
      AUTOMATE_WINE_SETUP_DEFAULT
    );
  } catch {
    return AUTOMATE_WINE_SETUP_DEFAULT;
  }
}

addon.on("setup", (data, event) => {
  event.defer();
  (async () => {
    const { name, appID, storefront, manifest } = data;
    const repackDir =
      manifest?.service === "local"
        ? (manifest.pathOfSetupExe as string)
        : data.path;
    const setupExe =
      (manifest?.setupExe as string | undefined) ?? join(repackDir, "setup.exe");
    if (!fs.existsSync(setupExe)) {
      event.fail(`setup.exe not found at ${setupExe}.`);
      return;
    }

    const winePrefix = join(process.env.HOME ?? "", ".wine-dodi");
    const automate = process.platform !== "win32" && automateWineSetup();
    const branch = decideSetupBranch(process.platform, automate);

    let installDir: string;
    if (branch === "silent") {
      // DODI has no "INSTALL HERE" staging step, so install straight into a
      // dedicated folder. It also keeps the repack's own .exe files out of the
      // executable scan below.
      installDir = join(repackDir, "DODI Install");
      const result = await runSilentSetup({
        umuBin: UMU_BIN,
        setupExe,
        repackDir,
        installDir,
        winePrefix,
        env: process.env,
        onLog: (line) => event.log(line),
        // Test seams (shortened in the integration tests); defaults are 15 min idle, 30 s sampling.
        idleLimitMs: Number(process.env.DODI_SILENT_IDLE_MS) || undefined,
        sampleIntervalMs: Number(process.env.DODI_SILENT_SAMPLE_MS) || undefined,
      });
      if (!result.ok) {
        // Fails (rather than falling back to the manual flow, like fatboy):
        // the message carries the mapped Inno code and the log path.
        event.fail(result.message);
        return;
      }
    } else {
      const picked = (await event.askForInput(
        "DODI Repacks",
        `Where should ${name} be installed? Choose a different folder from the one holding the repack files.`,
        new ConfigurationBuilder().addStringOption((option) =>
          option
            .setName("installDir")
            .setDisplayName("Game Installation Directory")
            .setDescription("The setup wizard will install the game here.")
            .setDefaultValue(repackDir)
            .setInputType("folder"),
        ),
      )) as { installDir: string };
      installDir = picked.installDir;
      if (!installDir || !fs.existsSync(installDir)) {
        event.fail("The installation directory does not exist.");
        return;
      }

      event.log(`Launching ${basename(setupExe)}. Select ${installDir} as the destination in the wizard.`);
      try {
        const { code: exitCode } =
          branch === "win32"
            ? await runProcess(setupExe, [], { cwd: repackDir, env: process.env, onLog: (l) => event.log(l) })
            : await runProcess(UMU_BIN, [setupExe], {
                cwd: repackDir,
                env: { ...process.env, WINEPREFIX: winePrefix },
                onLog: (l) => event.log(l),
              });
        if (exitCode !== 0) {
          event.fail(`${describeInnoExitCode(exitCode)} Check that Wine/umu is installed and try again.`);
          return;
        }
      } catch (error) {
        event.fail(`Could not launch setup.exe: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      const { finished } = (await event.askForInput(
        "DODI Repacks",
        `Have you finished installing ${name}?`,
        new ConfigurationBuilder().addBooleanOption((option) =>
          option
            .setName("finished")
            .setDisplayName("Finished Setup")
            .setDescription("Tick once the installer has completed.")
            .setDefaultValue(false),
        ),
      )) as { finished: boolean };
      if (!finished) {
        event.fail("Setup was not finished. Run it again when the installer has completed.");
        return;
      }
    }

    const ranked = scoreCandidates(
      await scanExecutables(installDir),
      name,
      basename(installDir),
    );
    const choice = resolveExecutableChoice(ranked);
    if (branch === "silent" && ranked.length === 0) {
      event.fail(
        `Unattended setup exited 0 but no game executable was found in ${installDir}. Log: ${join(repackDir, "dodi-setup.log")}`,
      );
      return;
    }
    let gameExecutable: string;
    if (choice.autoPick) {
      gameExecutable = candidateAbsolutePath(installDir, choice.autoPick.relPath);
      event.log(`Auto-detected game executable: ${gameExecutable}`);
    } else {
      const options = choice.ranked.map((candidate) =>
        candidateAbsolutePath(installDir, candidate.relPath),
      );
      const picker = new ConfigurationBuilder().addStringOption((option) => {
        option
          .setName("gameExecutable")
          .setDisplayName("Game Executable")
          .setDescription(`Select the executable that launches ${name}.`)
          .setInputType("file");
        if (options.length > 0) {
          option.setAllowedValues(options).setDefaultValue(options[0]!);
        }
        return option;
      });
      gameExecutable = (
        (await event.askForInput("DODI Repacks", "Help us find the game.", picker)) as {
          gameExecutable: string;
        }
      ).gameExecutable;
    }

    const details = await addon.getAppDetails(appID, storefront);
    event.resolve({
      cwd: dirname(gameExecutable),
      launchExecutable: gameExecutable,
      version: details?.latestVersion ?? "1.0",
      launchArguments: "%command%",
      redistributables:
        process.platform === "linux"
          ? ["dotnet48", "vcrun2022"].map((name) => ({ name, path: "winetricks" }))
          : [],
      umu: { umuId: `steam:${appID}` as `steam:${number}` },
    });
  })().catch((error) => event.fail(`Setup failed: ${String(error)}`));
});

addon.on("disconnect", () => process.exit(0));
addon.on("exit", () => process.exit(0));
