import fs from "fs";
import path from "path";
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

function resolveCommandPath(command: string, label: string): string | null {
  const resolved = exec("which", [command]);
  if (!resolved || !resolved.startsWith("/")) {
    console.error(
      `Error: ${label} のパスを正しく解決できませんでした。`,
    );
    return null;
  }
  return resolved;
}

export async function installCommand(
  options: { local?: boolean } = {},
): Promise<void> {
  // 1. config.yml チェック
  if (!fs.existsSync(getConfigPath())) {
    console.error("Error: config.yml が見つかりません。");
    console.error(
      "先に `sabori-flow init` を実行してください。",
    );
    return;
  }

  // 2. コマンド存在チェックと programArguments の構築
  let programArguments: readonly string[];

  if (options.local) {
    if (!commandExists("node")) {
      console.error(
        "Error: node が見つかりません。Node.js をインストールしてください。",
      );
      return;
    }
    const nodePath = resolveCommandPath("node", "node");
    if (!nodePath) return;
    programArguments = [nodePath, path.join(PACKAGE_ROOT, "dist", "worker.js")];
  } else {
    if (!commandExists("npx")) {
      console.error(
        "Error: npx が見つかりません。Node.js をインストールしてください。",
      );
      return;
    }
    const npxPath = resolveCommandPath("npx", "npx");
    if (!npxPath) return;
    programArguments = [npxPath, "sabori-flow", "worker"];
  }

  try {
    // 3. logs ディレクトリ作成
    const logDir = getLogsDir();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

    // 4. plist 生成
    console.log("plist を生成中...");
    fs.mkdirSync(getDataDir(), { recursive: true, mode: 0o700 });
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const plist = renderPlist(template, {
      programArguments,
      path: buildMinimalPath(),
      logDir,
    });
    fs.writeFileSync(getPlistGeneratedPath(), plist, { encoding: "utf-8", mode: 0o600 });

    // 5. launchd 登録
    console.log("launchd に登録中...");
    fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
    fs.copyFileSync(getPlistGeneratedPath(), PLIST_DEST_PATH);
    fs.chmodSync(PLIST_DEST_PATH, 0o600);
    exec("launchctl", ["load", PLIST_DEST_PATH]);

    if (options.local) {
      console.log(
        "\nローカルビルドのワーカーを登録しました。1時間ごとにワーカーが実行されます。",
      );
    } else {
      console.log(
        "\nインストールが完了しました。1時間ごとにワーカーが実行されます。",
      );
    }
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
