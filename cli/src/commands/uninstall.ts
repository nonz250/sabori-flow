import fs from "fs";
import { PLIST_DEST_PATH, PLIST_GENERATED_PATH } from "../utils/paths";
import { exec } from "../utils/shell";

export async function uninstallCommand(): Promise<void> {
  // 1. launchd 解除
  if (fs.existsSync(PLIST_DEST_PATH)) {
    try {
      exec(`launchctl unload ${PLIST_DEST_PATH}`);
    } catch {
      // unload 失敗は無視
    }
    fs.unlinkSync(PLIST_DEST_PATH);
    console.log(`削除しました: ${PLIST_DEST_PATH}`);
  } else {
    console.log("LaunchAgent は登録されていません。");
  }

  // 2. 生成済み plist 削除
  if (fs.existsSync(PLIST_GENERATED_PATH)) {
    fs.unlinkSync(PLIST_GENERATED_PATH);
  }

  console.log("\nアンインストールが完了しました。");
}
