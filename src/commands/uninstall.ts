import fs from "fs";
import { confirm } from "@inquirer/prompts";
import { getBaseDir, getConfigPath } from "../utils/paths.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { createScheduler } from "../scheduler/index.js";

export async function uninstallCommand(
  options: { interactive?: boolean } = {},
): Promise<void> {
  const { interactive = true } = options;

  setLanguage(loadLanguageFromConfig(getConfigPath()));

  // 1. Unregister from scheduler
  try {
    const scheduler = createScheduler();
    if (scheduler.isInstalled()) {
      scheduler.uninstall();
      console.log(t("uninstall.unregistered", { scheduler: scheduler.name }));
    } else {
      console.log(t("uninstall.notRegistered"));
    }
  } catch {
    // If platform is unsupported, just report not registered
    console.log(t("uninstall.notRegistered"));
  }

  console.log(t("uninstall.complete"));

  // 2. Optional: delete all data
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
