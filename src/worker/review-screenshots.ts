import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "./logger.js";

const logger = createLogger("review-screenshots");

export const MAX_REVIEW_SCREENSHOTS = 10;

/** GitHub の画像アップロード上限に合わせる */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

const SCREENSHOT_NAME_PATTERN = /^[A-Za-z0-9-]+\.png$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// O_NONBLOCK keeps a FIFO swapped in after readdir from blocking the open.
const SCREENSHOT_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// Inside the worktree because Codex's workspace-write sandbox cannot write
// outside its working directory. The worktree is removed after the review.
const SCREENSHOT_SUBDIR = [".sabori-flow-review", "screenshots"] as const;

export class ScreenshotDirError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ScreenshotDirError.prototype);
  }
}

/**
 * The PR's own checkout or the agent can place a symbolic link anywhere on
 * this path, and following it would let files outside the worktree be
 * attached to the PR. Every component is checked with lstat for that reason.
 */
function screenshotDirChain(worktreePath: string): string[] {
  return SCREENSHOT_SUBDIR.map((_, i) => join(worktreePath, ...SCREENSHOT_SUBDIR.slice(0, i + 1)));
}

/**
 * @throws {ScreenshotDirError} 途中に symlink やファイルがある場合、または保存先が既にある場合
 */
export function prepareScreenshotDir(worktreePath: string): string {
  const chain = screenshotDirChain(worktreePath);
  const dir = chain[chain.length - 1];
  for (const path of chain) {
    if (!existsSync(path) && !isSymlink(path)) {
      mkdirSync(path, { mode: 0o700 });
    } else if (path === dir) {
      // Right after checkout it can only come from the pull request, and its
      // files would be attached as if the agent had taken them.
      throw new ScreenshotDirError(`The pull request already contains the screenshot directory: ${path}`);
    } else if (!isRealDirectory(path)) {
      throw new ScreenshotDirError(`Screenshot directory path is not a plain directory: ${path}`);
    }
  }
  return dir;
}

/**
 * レビューで撮影されたスクリーンショットのうち、添付してよいファイル名を返す。
 *
 * ディレクトリはエージェントが自由に書き込めるため、symlink を辿ると
 * worktree の外にあるファイルを PR に添付できてしまう。ディレクトリと
 * ファイルの両方を lstat で確かめる。
 */
export function collectScreenshots(worktreePath: string): string[] {
  const chain = screenshotDirChain(worktreePath);
  if (!chain.every(isRealDirectory)) {
    if (chain.some((path) => existsSync(path) || isSymlink(path))) {
      logger.warn("Skipping screenshots: the screenshot directory is not a plain directory");
    }
    return [];
  }
  const dir = chain[chain.length - 1];

  const accepted = readdirSync(dir)
    .sort()
    .filter((name) => {
      if (!SCREENSHOT_NAME_PATTERN.test(name)) {
        logger.warn("Skipping screenshot with an unexpected name: %s", name);
        return false;
      }
      const rejection = inspectScreenshot(join(dir, name));
      if (rejection !== null) {
        logger.warn("Skipping screenshot %s: %s", name, rejection);
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

/**
 * Checks the file through one descriptor so the checks apply to what was
 * opened, not to whatever the path names a moment later. A hard link passes
 * every path-based check while pointing at a file outside the worktree, and
 * the content check stops a renamed text file from being uploaded.
 *
 * @returns the reason for rejecting the file, or null when it can be attached
 */
function inspectScreenshot(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, SCREENSHOT_OPEN_FLAGS);
  } catch {
    return "it cannot be opened without following a symbolic link";
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return "it is not a regular file";
    }
    if (stat.nlink !== 1) {
      return "it has more than one hard link";
    }
    if (stat.size > MAX_SCREENSHOT_BYTES) {
      return `it is larger than ${MAX_SCREENSHOT_BYTES} bytes`;
    }
    const header = Buffer.alloc(PNG_SIGNATURE.length);
    if (readSync(fd, header, 0, header.length, 0) !== header.length || !header.equals(PNG_SIGNATURE)) {
      return "its content is not a PNG image";
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
