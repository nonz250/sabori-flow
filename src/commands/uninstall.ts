import fs from "fs";
import { confirm } from "@inquirer/prompts";
import { getBaseDir, getConfigPath } from "../utils/paths.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { createScheduler, UnsupportedPlatformError } from "../scheduler/index.js";

export async function uninstallCommand(
  options: { interactive?: boolean } = {},
): Promise<void> {
  const { interactive = true } = options;

  setLanguage(loadLanguageFromConfig(getConfigPath()));

  // 1. Remove scheduled task via platform-specific scheduler
  try {
    const scheduler = createScheduler();
    if (scheduler.isInstalled()) {
      scheduler.uninstall();
      console.log(t("uninstall.removed"));
    } else {
      console.log(t("uninstall.notRegistered"));
    }
  } catch (error) {
    if (error instanceof UnsupportedPlatformError) {
      console.error(t("install.unsupportedPlatform", { message: error.message }));
      return;
    }
    throw error;
  }

  console.log(t("uninstall.complete"));

  // 2. Prompt to delete all user data
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
