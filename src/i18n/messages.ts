import type { Language, MessageKeys } from "./types.js";

const jaMessages: MessageKeys = {
  // init command
  "init.configExistsOverwrite":
    "config.yml は既に存在します。上書きしますか?",
  "init.aborted": "中断しました。",
  "init.addAnotherRepo": "別のリポジトリを追加しますか?",
  "init.configCreated": "\nconfig.yml を作成しました: {path}",
  "init.runInstallNext":
    "次は `sabori-flow install` を実行してください。",
  "init.templateExists": "{file} は既に存在します。上書きしますか?",
  "init.templateSkipped": "スキップしました: {file}",
  "init.templatesCopied":
    "\nプロンプトテンプレートをコピーしました: {dir}",

  // add command
  "add.configNotFound": "Error: config.yml が見つかりません。",
  "add.runInitFirst":
    "先に `sabori-flow init` を実行してください。",
  "add.configReadFailed":
    "Error: config.yml の読み込みに失敗しました。内容を確認してください。",
  "add.configFormatInvalid": "Error: config.yml の形式が不正です。",
  "add.repositoriesInvalid":
    "Error: config.yml に repositories が定義されていないか、形式が不正です。",
  "add.duplicateOverwrite":
    "{owner}/{repo} は既に登録されています。上書きしますか?",
  "add.aborted": "中断しました。",
  "add.configWriteFailed":
    "Error: config.yml の書き込みに失敗しました。",
  "add.repoAdded": "\n{owner}/{repo} を追加しました。",

  // install command
  "install.configNotFound": "Error: config.yml が見つかりません。",
  "install.runInitFirst":
    "先に `sabori-flow init` を実行してください。",
  "install.npxNotFound":
    "Error: npx が見つかりません。Node.js をインストールしてください。",
  "install.nodeNotFound":
    "Error: node が見つかりません。Node.js をインストールしてください。",
  "install.pathResolveFailed":
    "Error: {label} のパスを正しく解決できませんでした。",
  "install.generatingPlist": "plist を生成中...",
  "install.registeringLaunchd": "launchd に登録中...",
  "install.localComplete":
    "\nローカルビルドのワーカーを登録しました。{minutes}分ごとにワーカーが実行されます。",
  "install.complete":
    "\nインストールが完了しました。{minutes}分ごとにワーカーが実行されます。",
  "install.configValidationError": "Error: config.yml のバリデーションに失敗しました: {message}",
  "install.unexpectedError": "予期しないエラーが発生しました:",
  "install.crontabNotFound":
    "Error: crontab が見つかりません。cron がインストールされていることを確認してください。",
  "install.cronIncompatibleInterval":
    "Error: interval_minutes の値 {minutes} は cron で正確に表現できません。有効な値: {validValues}",
  "install.registeringCron": "crontab に登録中...",
  "install.cronComplete":
    "\nインストールが完了しました。cron により {minutes}分ごとにワーカーが実行されます。",
  "install.cronLocalComplete":
    "\nローカルビルドのワーカーを cron に登録しました。{minutes}分ごとにワーカーが実行されます。",
  "install.cronMacosWarning":
    "Warning: macOS では cron はスリープ中にジョブを実行しません。また、macOS Sequoia 以降では Full Disk Access 権限が必要な場合があります。推奨: --scheduler launchd を使用してください。",
  "install.launchdNotAvailable":
    "Error: launchd はこのプラットフォームでは利用できません。--scheduler cron を使用してください。",

  // uninstall command
  "uninstall.deleted": "削除しました: {path}",
  "uninstall.notRegistered": "スケジューラの登録が見つかりません。",
  "uninstall.complete": "\nアンインストールが完了しました。",
  "uninstall.confirmDeleteAll":
    "{dir} を完全に削除しますか? (config.yml, プロンプト, ログを含む)",
  "uninstall.deletedAll": "削除しました: {dir}",
  "uninstall.cronRemoved": "crontab からエントリを削除しました。",

  // repository-prompt (shared helper)
  "prompt.enterOwner": "リポジトリの owner を入力してください:",
  "prompt.enterRepo": "リポジトリ名を入力してください:",
  "prompt.enterLocalPath":
    "ローカルクローンのパスを入力してください (~/ 可):",
  "prompt.validationAlphanumeric":
    "英数字, '.', '_', '-' のみ使用できます",
  "prompt.validationAbsolutePath":
    "絶対パスを入力してください (~/... も可)",
  "prompt.autoImplConfirm":
    "Plan 完了後に自動で impl ラベルを付与しますか?",
  "prompt.intervalMinutes": "スケジュール実行間隔（分）を入力してください（10-1440）:",
  "prompt.intervalMinutesValidation": "10 以上 1440 以下の整数を入力してください",

  // cli descriptions
  "cli.descriptionAdd": "既存の config.yml にリポジトリを追加します",
  "cli.descriptionInit": "対話的に config.yml を作成します",
  "cli.descriptionInstall": "スケジューラにワーカーを登録します（launchd または cron）",
  "cli.optionLocal": "ローカルビルドのワーカーを登録します",
  "cli.optionScheduler": "使用するスケジューラ（launchd, cron）",
  "cli.descriptionUninstall": "スケジューラの登録を解除します",
  "cli.descriptionReinstall":
    "スケジューラの登録を再インストールします（解除 + 再登録）",
  "cli.optionReinstallLocal": "ローカルビルドのワーカーを登録します",
  "cli.optionReinstallScheduler": "使用するスケジューラ（launchd, cron）",
  "cli.descriptionWorker":
    "ワーカーを実行します（通常はスケジューラから自動的に呼び出されます）",
};

const enMessages: MessageKeys = {
  // init command
  "init.configExistsOverwrite": "config.yml already exists. Overwrite?",
  "init.aborted": "Aborted.",
  "init.addAnotherRepo": "Add another repository?",
  "init.configCreated": "\nconfig.yml created: {path}",
  "init.runInstallNext": "Next, run `sabori-flow install`.",
  "init.templateExists": "{file} already exists. Overwrite?",
  "init.templateSkipped": "Skipped: {file}",
  "init.templatesCopied": "\nPrompt templates copied to: {dir}",

  // add command
  "add.configNotFound": "Error: config.yml not found.",
  "add.runInitFirst": "Run `sabori-flow init` first.",
  "add.configReadFailed":
    "Error: Failed to read config.yml. Please check the file contents.",
  "add.configFormatInvalid": "Error: config.yml format is invalid.",
  "add.repositoriesInvalid":
    "Error: repositories is not defined or has an invalid format in config.yml.",
  "add.duplicateOverwrite": "{owner}/{repo} already exists. Overwrite?",
  "add.aborted": "Aborted.",
  "add.configWriteFailed": "Error: Failed to write config.yml.",
  "add.repoAdded": "\n{owner}/{repo} has been added.",

  // install command
  "install.configNotFound": "Error: config.yml not found.",
  "install.runInitFirst": "Run `sabori-flow init` first.",
  "install.npxNotFound":
    "Error: npx not found. Please install Node.js.",
  "install.nodeNotFound":
    "Error: node not found. Please install Node.js.",
  "install.pathResolveFailed":
    "Error: Failed to resolve path for {label}.",
  "install.generatingPlist": "Generating plist...",
  "install.registeringLaunchd": "Registering with launchd...",
  "install.localComplete":
    "\nLocal build worker registered. The worker will run every {minutes} minutes.",
  "install.complete":
    "\nInstallation complete. The worker will run every {minutes} minutes.",
  "install.configValidationError": "Error: config.yml validation failed: {message}",
  "install.unexpectedError": "Unexpected error:",
  "install.crontabNotFound":
    "Error: crontab not found. Please ensure cron is installed.",
  "install.cronIncompatibleInterval":
    "Error: interval_minutes value {minutes} cannot be exactly represented as a cron expression. Valid values: {validValues}",
  "install.registeringCron": "Registering with crontab...",
  "install.cronComplete":
    "\nInstallation complete. The worker will run every {minutes} minutes via cron.",
  "install.cronLocalComplete":
    "\nLocal build worker registered with cron. The worker will run every {minutes} minutes.",
  "install.cronMacosWarning":
    "Warning: On macOS, cron does not run jobs during sleep. Also, Full Disk Access may be required on macOS Sequoia+. Recommended: use --scheduler launchd instead.",
  "install.launchdNotAvailable":
    "Error: launchd is not available on this platform. Use --scheduler cron instead.",

  // uninstall command
  "uninstall.deleted": "Deleted: {path}",
  "uninstall.notRegistered": "No scheduler registration found.",
  "uninstall.complete": "\nUninstall complete.",
  "uninstall.confirmDeleteAll":
    "Delete {dir} completely? (includes config.yml, prompts, and logs)",
  "uninstall.deletedAll": "Deleted: {dir}",
  "uninstall.cronRemoved": "Removed sabori-flow entry from crontab.",

  // repository-prompt (shared helper)
  "prompt.enterOwner": "Enter repository owner:",
  "prompt.enterRepo": "Enter repository name:",
  "prompt.enterLocalPath": "Enter local clone path (~/... allowed):",
  "prompt.validationAlphanumeric":
    "Only alphanumeric characters, '.', '_', '-' are allowed",
  "prompt.validationAbsolutePath":
    "Enter an absolute path (~/... also accepted)",
  "prompt.autoImplConfirm":
    "Automatically add impl label after Plan completion?",
  "prompt.intervalMinutes": "Enter the scheduled execution interval in minutes (10-1440):",
  "prompt.intervalMinutesValidation": "Must be an integer between 10 and 1440",

  // cli descriptions
  "cli.descriptionAdd": "Add a repository to existing config.yml",
  "cli.descriptionInit": "Create config.yml interactively",
  "cli.descriptionInstall": "Register the worker with a scheduler (launchd or cron)",
  "cli.optionLocal": "Register local build worker",
  "cli.optionScheduler": "Scheduler to use (launchd, cron)",
  "cli.descriptionUninstall": "Unregister from scheduler",
  "cli.descriptionReinstall":
    "Reinstall scheduler registration (unregister + re-register)",
  "cli.optionReinstallLocal": "Register local build worker",
  "cli.optionReinstallScheduler": "Scheduler to use (launchd, cron)",
  "cli.descriptionWorker":
    "Run the worker (normally called automatically by the scheduler)",
};

export const messages: Record<Language, MessageKeys> = {
  ja: jaMessages,
  en: enMessages,
};
