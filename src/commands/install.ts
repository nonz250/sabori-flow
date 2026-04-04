import fs from "fs";
import path from "path";
import YAML from "yaml";
import {
  PACKAGE_ROOT,
  PLIST_TEMPLATE_PATH,
  PLIST_DEST_DIR,
  PLIST_DEST_PATH,
  getConfigPath,
  getLogsDir,
  getDataDir,
  getPlistGeneratedPath,
} from "../utils/paths.js";
import { exec, commandExists, ShellError } from "../utils/shell.js";
import { renderPlist } from "../utils/plist.js";

function getLogDir(): string {
  try {
    const raw = YAML.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    const logDir = raw?.execution?.log_dir;
    if (typeof logDir === "string" && logDir !== "") {
      return logDir;
    }
  } catch {
    // config パース失敗時はデフォルト
  }
  return getLogsDir();
}

const STANDARD_PATHS = ["/usr/local/bin", "/usr/bin", "/bin"];
const REQUIRED_COMMANDS = ["node", "git", "gh", "claude"];

function buildMinimalPath(): string {
  const dirs = new Set<string>(STANDARD_PATHS);
  for (const cmd of REQUIRED_COMMANDS) {
    try {
      const cmdPath = exec("which", [cmd]);
      if (cmdPath && cmdPath.startsWith("/")) {
        dirs.add(path.dirname(cmdPath));
      }
    } catch {
      // コマンドが見つからない場合はスキップ
    }
  }
  return [...dirs].join(":");
}

export async function installCommand(): Promise<void> {
  // 1. config.yml チェック
  if (!fs.existsSync(getConfigPath())) {
    console.error("Error: config.yml が見つかりません。");
    console.error(
      "先に `npx sabori-flow init` を実行してください。",
    );
    return;
  }

  // 2. node チェック
  if (!commandExists("node")) {
    console.error(
      "Error: node が見つかりません。Node.js をインストールしてください。",
    );
    return;
  }

  try {
    // 3. npm install + ビルド
    console.log("依存パッケージをインストール中...");
    exec("npm", ["install"], { cwd: PACKAGE_ROOT });

    console.log("TypeScript をビルド中...");
    exec("npx", ["tsc"], { cwd: PACKAGE_ROOT });

    // 4. logs ディレクトリ作成
    const logDir = getLogDir();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

    // 5. plist 生成
    console.log("plist を生成中...");
    fs.mkdirSync(getDataDir(), { recursive: true, mode: 0o700 });
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const nodePath = exec("which", ["node"]);
    if (!nodePath || !nodePath.startsWith("/")) {
      console.error("Error: node のパスを正しく解決できませんでした。");
      return;
    }
    const plist = renderPlist(template, {
      nodePath,
      projectRoot: PACKAGE_ROOT,
      path: buildMinimalPath(),
      logDir,
    });
    fs.writeFileSync(getPlistGeneratedPath(), plist, { encoding: "utf-8", mode: 0o600 });

    // 6. launchd 登録
    console.log("launchd に登録中...");
    fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
    fs.copyFileSync(getPlistGeneratedPath(), PLIST_DEST_PATH);
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
    return;
  }
}
