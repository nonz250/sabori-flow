import fs from "fs";
import { confirm } from "@inquirer/prompts";
import { PLIST_DEST_PATH, getBaseDir, getConfigPath, getPlistGeneratedPath } from "../utils/paths.js";
import { exec } from "../utils/shell.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { cronEntryExists, uninstallCronEntry } from "../utils/cron.js";

export async function uninstallCommand(
  options: { interactive?: boolean } = {},
): Promise<void> {
  const { interactive = true } = options;

  setLanguage(loadLanguageFromConfig(getConfigPath()));

  let removedAny = false;

  // 1. launchd unregister
  if (fs.existsSync(PLIST_DEST_PATH)) {
    try {
      exec("launchctl", ["unload", PLIST_DEST_PATH]);
    } catch {
      // unload failure is ignored
    }
    fs.unlinkSync(PLIST_DEST_PATH);
    console.log(t("uninstall.deleted", { path: PLIST_DEST_PATH }));
    removedAny = true;
  }

  // 2. Delete generated plist
  const generatedPlist = getPlistGeneratedPath();
  if (fs.existsSync(generatedPlist)) {
    fs.unlinkSync(generatedPlist);
  }

  // 3. cron entry removal
  if (cronEntryExists()) {
    uninstallCronEntry();
    console.log(t("uninstall.cronRemoved"));
    removedAny = true;
  }

  if (!removedAny) {
    console.log(t("uninstall.notRegistered"));
  }

  console.log(t("uninstall.complete"));

  // 4. Confirm full data deletion
  if (interactive) {
    const baseDir = getBaseDir();
    if (fs.existsSync(baseDir)) {
      try {
        const deleteAll = await confirm({
          message: t("uninstall.confirmDeleteAll", { dir: baseDir }),
          default: false,
        });
        if (deleteAll) {
          fs.rmSync(baseDir, { recursive: true, force: true });
          console.log(t("uninstall.deletedAll", { dir: baseDir }));
        }
      } catch {
        // Ctrl+C — skip data deletion silently
      }
    }
  }
}
