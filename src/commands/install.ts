import fs from "fs";
import path from "path";
import {
  PACKAGE_ROOT,
  PLIST_TEMPLATE_PATH,
  PLIST_DEST_DIR,
  PLIST_DEST_PATH,
  getConfigPath,
  getLogsDir,
  getBaseDir,
  getPlistGeneratedPath,
} from "../utils/paths.js";
import { exec, commandExists, ShellError } from "../utils/shell.js";
import { renderPlist } from "../utils/plist.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { loadConfig, ConfigValidationError } from "../worker/config.js";

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
      t("install.pathResolveFailed", { label }),
    );
    return null;
  }
  return resolved;
}

export async function installCommand(
  options: { local?: boolean } = {},
): Promise<void> {
  setLanguage(loadLanguageFromConfig(getConfigPath()));

  // 1. config.yml チェック
  if (!fs.existsSync(getConfigPath())) {
    console.error(t("install.configNotFound"));
    console.error(
      t("install.runInitFirst"),
    );
    return;
  }

  // 2. コマンド存在チェックと programArguments の構築
  let programArguments: readonly string[];

  if (options.local) {
    if (!commandExists("node")) {
      console.error(
        t("install.nodeNotFound"),
      );
      return;
    }
    const nodePath = resolveCommandPath("node", "node");
    if (!nodePath) return;
    programArguments = [nodePath, path.join(PACKAGE_ROOT, "dist", "worker.js")];
  } else {
    if (!commandExists("npx")) {
      console.error(
        t("install.npxNotFound"),
      );
      return;
    }
    const npxPath = resolveCommandPath("npx", "npx");
    if (!npxPath) return;
    programArguments = [npxPath, "sabori-flow", "worker"];
  }

  try {
    // 3. config.yml を読み込んで interval_minutes を取得
    const config = loadConfig(getConfigPath());
    const intervalMinutes = config.execution.intervalMinutes;
    const startInterval = intervalMinutes * 60;

    // 4. logs ディレクトリ作成
    const logDir = getLogsDir();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

    // 4. plist 生成
    console.log(t("install.generatingPlist"));
    fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const plist = renderPlist(template, {
      programArguments,
      path: buildMinimalPath(),
      logDir,
      startInterval,
    });
    fs.writeFileSync(getPlistGeneratedPath(), plist, { encoding: "utf-8", mode: 0o600 });

    // 5. launchd 登録
    console.log(t("install.registeringLaunchd"));
    fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
    fs.copyFileSync(getPlistGeneratedPath(), PLIST_DEST_PATH);
    fs.chmodSync(PLIST_DEST_PATH, 0o600);
    exec("launchctl", ["load", PLIST_DEST_PATH]);

    if (options.local) {
      console.log(
        t("install.localComplete", { minutes: String(intervalMinutes) }),
      );
    } else {
      console.log(
        t("install.complete", { minutes: String(intervalMinutes) }),
      );
    }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(`Error: config.yml のバリデーションに失敗しました: ${error.message}`);
    } else if (error instanceof ShellError) {
      console.error(`Error: ${error.message}`);
      if (error.stderr) console.error(error.stderr);
    } else {
      console.error(t("install.unexpectedError"), error);
    }
    return;
  }
}
