import fs from "fs";
import {
  CONFIG_PATH,
  VENV_DIR,
  PIP_PATH,
  REQUIREMENTS_PATH,
  LOGS_DIR,
  PYTHON_PATH as VENV_PYTHON_PATH,
  PROJECT_ROOT,
  PLIST_TEMPLATE_PATH,
  PLIST_GENERATED_PATH,
  PLIST_DEST_DIR,
  PLIST_DEST_PATH,
} from "../utils/paths";
import { exec, commandExists, ShellError } from "../utils/shell";
import { renderPlist } from "../utils/plist";

export async function installCommand(): Promise<void> {
  // 1. config.yml チェック
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("Error: config.yml が見つかりません。");
    console.error(
      "先に `npx ts-node cli/src/index.ts init` を実行してください。",
    );
    process.exit(1);
  }

  // 2. python3 チェック
  if (!commandExists("python3")) {
    console.error(
      "Error: python3 が見つかりません。Python 3 をインストールしてください。",
    );
    process.exit(1);
  }

  try {
    // 3. venv セットアップ
    if (fs.existsSync(VENV_DIR)) {
      console.log("既存の venv を使用します。");
    } else {
      console.log("venv を作成中...");
      exec(`python3 -m venv ${VENV_DIR}`);
    }

    console.log("依存パッケージをインストール中...");
    exec(`${PIP_PATH} install -r ${REQUIREMENTS_PATH}`);

    // 4. logs ディレクトリ作成
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    // 5. plist 生成
    console.log("plist を生成中...");
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const plist = renderPlist(template, {
      pythonPath: VENV_PYTHON_PATH,
      projectRoot: PROJECT_ROOT,
      path: process.env.PATH || "",
    });
    fs.writeFileSync(PLIST_GENERATED_PATH, plist, "utf-8");

    // 6. launchd 登録
    console.log("launchd に登録中...");
    fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
    fs.copyFileSync(PLIST_GENERATED_PATH, PLIST_DEST_PATH);
    exec(`launchctl load ${PLIST_DEST_PATH}`);

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
