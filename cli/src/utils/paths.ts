import path from "path";

// cli/ の親 = プロジェクトルート
// ts-node 実行時: __dirname = cli/src/utils → ../../.. = project root
// ビルド後: __dirname = cli/dist/utils → ../../.. = project root
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

export const CONFIG_PATH = path.join(PROJECT_ROOT, "config.yml");
export const CONFIG_EXAMPLE_PATH = path.join(
  PROJECT_ROOT,
  "config.yml.example",
);
export const VENV_DIR = path.join(PROJECT_ROOT, ".venv");
export const PYTHON_PATH = path.join(VENV_DIR, "bin", "python");
export const PIP_PATH = path.join(VENV_DIR, "bin", "pip");
export const REQUIREMENTS_PATH = path.join(PROJECT_ROOT, "requirements.txt");
export const LOGS_DIR = path.join(PROJECT_ROOT, "logs");

export const PLIST_LABEL = "com.github.nonz250.claude-issue-worker";
export const PLIST_TEMPLATE_PATH = path.join(
  PROJECT_ROOT,
  "launchd",
  `${PLIST_LABEL}.plist.template`,
);
export const PLIST_GENERATED_PATH = path.join(
  PROJECT_ROOT,
  "launchd",
  `${PLIST_LABEL}.plist`,
);
export const PLIST_DEST_DIR = path.join(
  process.env.HOME || "",
  "Library",
  "LaunchAgents",
);
export const PLIST_DEST_PATH = path.join(
  PLIST_DEST_DIR,
  `${PLIST_LABEL}.plist`,
);
