import fs from "fs";
import YAML from "yaml";
import {
  CONFIG_PATH,
  LOGS_DIR,
  PROJECT_ROOT,
  PLIST_TEMPLATE_PATH,
  PLIST_GENERATED_PATH,
  PLIST_DEST_DIR,
  PLIST_DEST_PATH,
} from "../utils/paths.js";
import { exec, commandExists, ShellError } from "../utils/shell.js";
import { renderPlist } from "../utils/plist.js";

function getLogDir(): string {
  try {
    const raw = YAML.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    const logDir = raw?.execution?.log_dir;
    if (typeof logDir === "string" && logDir !== "") {
      return logDir;
    }
  } catch {
    // config パース失敗時はデフォルト
  }
  return LOGS_DIR;
}

export async function installCommand(): Promise<void> {
  // 1. config.yml チェック
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("Error: config.yml が見つかりません。");
    console.error(
      "先に `npx claude-issue-worker init` を実行してください。",
    );
    process.exit(1);
  }

  // 2. node チェック
  if (!commandExists("node")) {
    console.error(
      "Error: node が見つかりません。Node.js をインストールしてください。",
    );
    process.exit(1);
  }

  try {
    // 3. npm install + ビルド
    console.log("依存パッケージをインストール中...");
    exec("npm", ["install"], { cwd: PROJECT_ROOT });

    console.log("TypeScript をビルド中...");
    exec("npx", ["tsc"], { cwd: PROJECT_ROOT });

    // 4. logs ディレクトリ作成
    const logDir = getLogDir();
    fs.mkdirSync(logDir, { recursive: true });

    // 5. plist 生成
    console.log("plist を生成中...");
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const nodePath = exec("which", ["node"]);
    const plist = renderPlist(template, {
      nodePath,
      projectRoot: PROJECT_ROOT,
      path: process.env.PATH || "",
      logDir,
    });
    fs.writeFileSync(PLIST_GENERATED_PATH, plist, "utf-8");

    // 6. launchd 登録
    console.log("launchd に登録中...");
    fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
    fs.copyFileSync(PLIST_GENERATED_PATH, PLIST_DEST_PATH);
    exec("launchctl", ["load", PLIST_DEST_PATH]);

    console.log(
      "\nインストールが完了しました。1時間ごとにワーカーが実行されます。",
    );
  } catch (error) {
    if (error instanceof ShellError) {
      console.error(`Error: ${error.message}`);
      if (error.stderr) console.error(error.stderr);
    } else {
      console.error("予期しないエラーが発生しました:", error);
    }
    process.exit(1);
  }
}
