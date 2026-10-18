import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { getReviewAttachmentsDir } from "../utils/paths.js";

import { createLogger } from "./logger.js";

const logger = createLogger("review-screenshots");

export const MAX_REVIEW_SCREENSHOTS = 10;

/** Matches GitHub's upload limit for images */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

const SCREENSHOT_NAME_PATTERN = /^[A-Za-z0-9-]+\.png$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// O_NONBLOCK keeps a FIFO swapped in after readdir from blocking the open.
const SCREENSHOT_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

const ATTACHMENT_DIR_PREFIX = "review-";

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
 * @throws {ScreenshotDirError} when a path component is a symbolic link or a file, or the directory already exists
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
 * Copies the screenshots that may be attached into attachmentDir and returns
 * their file names.
 *
 * The agent can write to the screenshot directory freely, so following a
 * symbolic link there would attach files outside the worktree. The
 * directories are checked with lstat, and each file through its descriptor.
 * gh reads the copies, so nothing the agent leaves running can swap a file
 * between these checks and the upload.
 */
export function collectScreenshots(worktreePath: string, attachmentDir: string): string[] {
  const chain = screenshotDirChain(worktreePath);
  if (!chain.every(isRealDirectory)) {
    if (chain.some((path) => existsSync(path) || isSymlink(path))) {
      logger.warn("Skipping screenshots: the screenshot directory is not a plain directory");
    }
    return [];
  }
  const dir = chain[chain.length - 1];

  const candidates = readdirSync(dir)
    .sort()
    .filter((name) => {
      if (!SCREENSHOT_NAME_PATTERN.test(name)) {
        logger.warn("Skipping screenshot with an unexpected name: %s", name);
        return false;
      }
      return true;
    });

  const accepted: string[] = [];
  for (const name of candidates) {
    if (accepted.length === MAX_REVIEW_SCREENSHOTS) {
      logger.warn("Attaching only the first %s screenshots", MAX_REVIEW_SCREENSHOTS);
      break;
    }
    const screenshot = readScreenshot(join(dir, name));
    if (typeof screenshot === "string") {
      logger.warn("Skipping screenshot %s: %s", name, screenshot);
      continue;
    }
    writeFileSync(join(attachmentDir, name), screenshot, { flag: "wx", mode: 0o600 });
    accepted.push(name);
  }
  return accepted;
}

/**
 * Runs callback with copies of the review's screenshots in a private
 * directory, and removes the directory afterwards.
 */
export async function withStagedScreenshots<T>(
  worktreePath: string,
  callback: (attachmentDir: string, screenshots: string[]) => T | Promise<T>,
  baseDir: string = getReviewAttachmentsDir(),
): Promise<T> {
  mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  const attachmentDir = mkdtempSync(join(baseDir, ATTACHMENT_DIR_PREFIX));
  try {
    return await callback(attachmentDir, collectScreenshots(worktreePath, attachmentDir));
  } finally {
    try {
      rmSync(attachmentDir, { recursive: true, force: true });
    } catch (error: unknown) {
      logger.warn(
        "Failed to remove the attachment directory %s: %s",
        attachmentDir,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/**
 * Reads the file through one descriptor so the checks apply to what was
 * read, not to whatever the path names a moment later. A hard link passes
 * every path-based check while pointing at a file outside the worktree, and
 * the content check stops a renamed text file from being uploaded.
 *
 * @returns the file content, or the reason for rejecting the file
 */
function readScreenshot(path: string): Buffer | string {
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
    // One byte of headroom tells a file that grew after fstat, which would
    // otherwise be copied cut short.
    const content = Buffer.allocUnsafe(stat.size + 1);
    let length = 0;
    let read: number;
    while (length < content.length && (read = readSync(fd, content, length, content.length - length, length)) > 0) {
      length += read;
    }
    if (length > stat.size) {
      return "it was still being written";
    }
    if (length < PNG_SIGNATURE.length || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return "its content is not a PNG image";
    }
    return content.subarray(0, length);
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
