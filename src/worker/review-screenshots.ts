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
  type Stats,
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
 * directories are entered one at a time, and each file is checked through its
 * descriptor. gh reads the copies, so nothing the agent leaves running can
 * swap a file between these checks and the upload.
 */
export function collectScreenshots(worktreePath: string, attachmentDir: string): string[] {
  const originalCwd = process.cwd();
  try {
    process.chdir(worktreePath);
    for (const name of SCREENSHOT_SUBDIR) {
      const entered = enterPlainDirectory(name);
      if (entered !== true) {
        if (entered !== "missing") {
          logger.warn("Skipping screenshots: the screenshot directory is not a plain directory");
        }
        return [];
      }
    }
    return copyScreenshots(attachmentDir);
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Node has no openat, so a path checked with lstat is resolved again by the
 * next call, and a directory on it swapped for a symbolic link in between
 * would be followed. Entering each directory and comparing it with what lstat
 * saw pins it: names opened afterwards resolve against the directory itself,
 * not its path.
 */
function enterPlainDirectory(name: string): true | "missing" | "not-plain" {
  let expected: Stats;
  try {
    expected = lstatSync(name);
  } catch {
    return "missing";
  }
  if (!expected.isDirectory()) {
    return "not-plain";
  }
  process.chdir(name);
  const entered = lstatSync(".");
  return entered.dev === expected.dev && entered.ino === expected.ino ? true : "not-plain";
}

function copyScreenshots(attachmentDir: string): string[] {
  const candidates = readdirSync(".")
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
    const screenshot = readScreenshot(name);
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
 *
 * When the copies cannot be made, callback runs with no screenshots and a
 * null directory instead of the error propagating: the review text is the
 * result of the agent run, and failing here would throw it away.
 */
export async function withStagedScreenshots<T>(
  worktreePath: string,
  callback: (attachmentDir: string | null, screenshots: string[]) => T | Promise<T>,
  baseDir: string = getReviewAttachmentsDir(),
): Promise<T> {
  let attachmentDir: string | null = null;
  let screenshots: string[] = [];
  try {
    mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    attachmentDir = mkdtempSync(join(baseDir, ATTACHMENT_DIR_PREFIX));
    screenshots = collectScreenshots(worktreePath, attachmentDir);
  } catch (error: unknown) {
    logger.warn(
      "Posting the review without screenshots because they could not be copied: %s",
      error instanceof Error ? error.message : String(error),
    );
    screenshots = [];
  }

  try {
    return await callback(screenshots.length > 0 ? attachmentDir : null, screenshots);
  } finally {
    if (attachmentDir !== null) {
      removeAttachmentDir(attachmentDir);
    }
  }
}

function removeAttachmentDir(attachmentDir: string): void {
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
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    // O_NOFOLLOW fails with ELOOP on a symbolic link; anything else, such as
    // a missing file or a denied permission, is reported as it is.
    return code === "ELOOP" ? "it is a symbolic link" : `it cannot be opened (${code ?? String(error)})`;
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
