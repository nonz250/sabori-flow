import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "./logger.js";

const logger = createLogger("review-screenshots");

export const MAX_REVIEW_SCREENSHOTS = 10;

/** GitHub の画像アップロード上限に合わせる */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

const SCREENSHOT_NAME_PATTERN = /^[A-Za-z0-9-]+\.png$/;

// Inside the worktree because Codex's workspace-write sandbox cannot write
// outside its working directory. The worktree is removed after the review.
const SCREENSHOT_SUBDIR = [".sabori-flow-review", "screenshots"] as const;

export function prepareScreenshotDir(worktreePath: string): string {
  const dir = join(worktreePath, ...SCREENSHOT_SUBDIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * レビューで撮影されたスクリーンショットのうち、添付してよいファイル名を返す。
 *
 * ディレクトリはエージェントが自由に書き込めるため、symlink を辿ると
 * worktree の外にあるファイルを PR に添付できてしまう。lstat で
 * regular file だけを残す。
 */
export function collectScreenshots(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const accepted = readdirSync(dir)
    .sort()
    .filter((name) => {
      if (!SCREENSHOT_NAME_PATTERN.test(name)) {
        logger.warn("Skipping screenshot with an unexpected name: %s", name);
        return false;
      }
      const stat = lstatSync(join(dir, name));
      if (!stat.isFile()) {
        logger.warn("Skipping screenshot that is not a regular file: %s", name);
        return false;
      }
      if (stat.size > MAX_SCREENSHOT_BYTES) {
        logger.warn("Skipping screenshot larger than %s bytes: %s", MAX_SCREENSHOT_BYTES, name);
        return false;
      }
      return true;
    });

  if (accepted.length > MAX_REVIEW_SCREENSHOTS) {
    logger.warn(
      "Attaching only the first %s of %s screenshots",
      MAX_REVIEW_SCREENSHOTS,
      accepted.length,
    );
  }
  return accepted.slice(0, MAX_REVIEW_SCREENSHOTS);
}
