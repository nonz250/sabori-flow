import fs from "fs";
import { confirm } from "@inquirer/prompts";
import { PLIST_DEST_PATH, getBaseDir, getConfigPath, getPlistGeneratedPath } from "../utils/paths.js";
import { exec } from "../utils/shell.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";

export async function uninstallCommand(): Promise<void> {
  setLanguage(loadLanguageFromConfig(getConfigPath()));

  // 1. launchd 解除
  if (fs.existsSync(PLIST_DEST_PATH)) {
    try {
      exec("launchctl", ["unload", PLIST_DEST_PATH]);
    } catch {
      // unload 失敗は無視
    }
    fs.unlinkSync(PLIST_DEST_PATH);
    console.log(t("uninstall.deleted", { path: PLIST_DEST_PATH }));
  } else {
    console.log(t("uninstall.notRegistered"));
  }

  // 2. 生成済み plist 削除
  const generatedPlist = getPlistGeneratedPath();
  if (fs.existsSync(generatedPlist)) {
    fs.unlinkSync(generatedPlist);
  }

  console.log(t("uninstall.complete"));

  // 3. 全データ削除の確認
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
      // Ctrl+C — データ削除をスキップして静かに終了
    }
  }
}
