import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import {
  collectScreenshots as collectInto,
  prepareScreenshotDir,
  withStagedScreenshots,
  ScreenshotDirError,
  MAX_REVIEW_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
} from "../../src/worker/review-screenshots.js";

let worktree: string;
let dir: string;
let attachments: string;

function collectScreenshots(worktreePath: string): string[] {
  return collectInto(worktreePath, attachments);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngBytes(bytes = PNG_SIGNATURE.length): Buffer {
  const content = Buffer.alloc(bytes);
  PNG_SIGNATURE.copy(content);
  return content;
}

function write(name: string, bytes = PNG_SIGNATURE.length): void {
  writeFileSync(join(dir, name), pngBytes(bytes));
}

describe("collectScreenshots", () => {
  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "sabori-flow-worktree-"));
    dir = join(worktree, ".sabori-flow-review", "screenshots");
    mkdirSync(dir, { recursive: true });
    attachments = mkdtempSync(join(tmpdir(), "sabori-flow-attachments-"));
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(attachments, { recursive: true, force: true });
  });

  it("copies accepted screenshots into the attachment directory", () => {
    write("01-before.png", PNG_SIGNATURE.length + 3);

    collectScreenshots(worktree);

    expect(readFileSync(join(attachments, "01-before.png"))).toEqual(readFileSync(join(dir, "01-before.png")));
    expect(statSync(join(attachments, "01-before.png")).ino).not.toBe(statSync(join(dir, "01-before.png")).ino);
  });

  it("keeps the copy unchanged when the agent rewrites the screenshot afterwards", () => {
    write("01-before.png");
    collectScreenshots(worktree);

    writeFileSync(join(dir, "01-before.png"), "aws_secret_access_key = abc");

    expect(readFileSync(join(attachments, "01-before.png"))).toEqual(pngBytes());
  });

  it("copies nothing that was rejected", () => {
    write("real.png");
    writeFileSync(join(dir, "credentials.png"), "aws_secret_access_key = abc");

    collectScreenshots(worktree);

    expect(readdirSync(attachments)).toEqual(["real.png"]);
  });

  it("returns an empty list when the directory does not exist", () => {
    rmSync(join(worktree, ".sabori-flow-review"), { recursive: true });

    expect(collectScreenshots(worktree)).toEqual([]);
  });

  it("returns nothing when the screenshot directory is a symbolic link", () => {
    const outside = mkdtempSync(join(tmpdir(), "sabori-flow-outside-"));
    writeFileSync(join(outside, "secret.png"), Buffer.alloc(1));
    rmSync(dir, { recursive: true });
    symlinkSync(outside, dir);

    expect(collectScreenshots(worktree)).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  it("returns nothing when the parent directory is a symbolic link", () => {
    const outside = mkdtempSync(join(tmpdir(), "sabori-flow-outside-"));
    mkdirSync(join(outside, "screenshots"));
    writeFileSync(join(outside, "screenshots", "secret.png"), Buffer.alloc(1));
    rmSync(join(worktree, ".sabori-flow-review"), { recursive: true });
    symlinkSync(outside, join(worktree, ".sabori-flow-review"));

    expect(collectScreenshots(worktree)).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  it("returns png files sorted by name", () => {
    write("02-after.png");
    write("01-before.png");

    expect(collectScreenshots(worktree)).toEqual(["01-before.png", "02-after.png"]);
  });

  it("skips files whose names contain characters outside letters, digits and hyphens", () => {
    write("ok-1.png");
    write("has space.png");
    write("under_score.png");
    write("dot.name.png");

    expect(collectScreenshots(worktree)).toEqual(["ok-1.png"]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(3);
  });

  it("skips files that are not png", () => {
    write("photo.jpg");
    write("upper.PNG");
    write("shot.png");

    expect(collectScreenshots(worktree)).toEqual(["shot.png"]);
  });

  it("skips symbolic links even when they point at a png", () => {
    write("real.png");
    symlinkSync(join(dir, "real.png"), join(dir, "link.png"));

    expect(collectScreenshots(worktree)).toEqual(["real.png"]);
  });

  it("skips a hard link even when it carries png content", () => {
    const outside = mkdtempSync(join(tmpdir(), "sabori-flow-outside-"));
    writeFileSync(join(outside, "secret"), pngBytes());
    linkSync(join(outside, "secret"), join(dir, "linked.png"));
    write("real.png");

    expect(collectScreenshots(worktree)).toEqual(["real.png"]);
    rmSync(outside, { recursive: true, force: true });
  });

  it("skips a png-named file whose content is not a png", () => {
    writeFileSync(join(dir, "credentials.png"), "aws_secret_access_key = abc");
    write("real.png");

    expect(collectScreenshots(worktree)).toEqual(["real.png"]);
  });

  it("skips a file shorter than the png signature", () => {
    writeFileSync(join(dir, "short.png"), PNG_SIGNATURE.subarray(0, PNG_SIGNATURE.length - 1));

    expect(collectScreenshots(worktree)).toEqual([]);
  });

  it("skips directories named like a png", () => {
    mkdirSync(join(dir, "folder.png"));

    expect(collectScreenshots(worktree)).toEqual([]);
  });

  it("accepts a file of exactly the size limit and skips one byte over it", () => {
    write("at-limit.png", MAX_SCREENSHOT_BYTES);
    write("over-limit.png", MAX_SCREENSHOT_BYTES + 1);

    expect(collectScreenshots(worktree)).toEqual(["at-limit.png"]);
  });

  it("keeps only the first screenshots up to the limit", () => {
    const names = Array.from(
      { length: MAX_REVIEW_SCREENSHOTS + 1 },
      (_, i) => `${String(i).padStart(2, "0")}-shot.png`,
    );
    for (const name of names) write(name);

    expect(collectScreenshots(worktree)).toEqual(names.slice(0, MAX_REVIEW_SCREENSHOTS));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });
});

describe("withStagedScreenshots", () => {
  let base: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "sabori-flow-worktree-"));
    dir = join(worktree, ".sabori-flow-review", "screenshots");
    mkdirSync(dir, { recursive: true });
    base = join(mkdtempSync(join(tmpdir(), "sabori-flow-base-")), "review-attachments");
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(join(base, ".."), { recursive: true, force: true });
  });

  it("hands the callback a private directory outside the worktree holding the copies", async () => {
    write("01-shot.png");

    await withStagedScreenshots(
      worktree,
      (attachmentDir, names) => {
        expect(attachmentDir.startsWith(base)).toBe(true);
        expect(names).toEqual(["01-shot.png"]);
        expect(statSync(attachmentDir).mode & 0o777).toBe(0o700);
        expect(existsSync(join(attachmentDir, "01-shot.png"))).toBe(true);
      },
      base,
    );
  });

  it("returns the callback result and removes the directory afterwards", async () => {
    write("01-shot.png");
    let staged: string | null = null;

    const result = await withStagedScreenshots(
      worktree,
      (attachmentDir) => {
        staged = attachmentDir;
        return "posted";
      },
      base,
    );

    expect(result).toBe("posted");
    expect(staged).not.toBeNull();
    expect(existsSync(staged!)).toBe(false);
  });

  it("removes the directory when the callback throws", async () => {
    write("01-shot.png");
    let staged: string | null = null;

    await expect(
      withStagedScreenshots(
        worktree,
        (attachmentDir) => {
          staged = attachmentDir;
          throw new Error("gh failed");
        },
        base,
      ),
    ).rejects.toThrow("gh failed");
    expect(staged).not.toBeNull();
    expect(existsSync(staged!)).toBe(false);
  });

  it("hands the callback no directory when there is no screenshot to attach", async () => {
    await withStagedScreenshots(
      worktree,
      (attachmentDir, names) => {
        expect(attachmentDir).toBeNull();
        expect(names).toEqual([]);
      },
      base,
    );

    expect(readdirSync(base)).toEqual([]);
  });

  it("still runs the callback, without screenshots, when the copies cannot be made", async () => {
    write("01-shot.png");
    const blocked = join(base, "..", "not-a-directory");
    writeFileSync(blocked, "");

    const result = await withStagedScreenshots(
      worktree,
      (attachmentDir, names) => {
        expect(attachmentDir).toBeNull();
        expect(names).toEqual([]);
        return "posted";
      },
      join(blocked, "review-attachments"),
    );

    expect(result).toBe("posted");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("without screenshots"),
      expect.any(String),
    );
  });
});

describe("prepareScreenshotDir", () => {
  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "sabori-flow-worktree-"));
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
  });

  it("creates the screenshot directory inside the worktree and returns its path", () => {
    const result = prepareScreenshotDir(worktree);

    expect(result).toBe(join(worktree, ".sabori-flow-review", "screenshots"));
    expect(statSync(result).isDirectory()).toBe(true);
  });

  it("accepts an existing parent directory but creates the screenshot directory itself", () => {
    mkdirSync(join(worktree, ".sabori-flow-review"));

    expect(prepareScreenshotDir(worktree)).toBe(join(worktree, ".sabori-flow-review", "screenshots"));
  });

  it("refuses a screenshot directory the pull request already contains", () => {
    mkdirSync(join(worktree, ".sabori-flow-review", "screenshots"), { recursive: true });
    writeFileSync(join(worktree, ".sabori-flow-review", "screenshots", "01-tests-pass.png"), Buffer.alloc(1));

    expect(() => prepareScreenshotDir(worktree)).toThrow(ScreenshotDirError);
  });

  it("refuses a screenshot directory checked out as a symbolic link", () => {
    const outside = mkdtempSync(join(tmpdir(), "sabori-flow-outside-"));
    mkdirSync(join(worktree, ".sabori-flow-review"));
    symlinkSync(outside, join(worktree, ".sabori-flow-review", "screenshots"));

    expect(() => prepareScreenshotDir(worktree)).toThrow(ScreenshotDirError);
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses a regular file where the directory should be", () => {
    writeFileSync(join(worktree, ".sabori-flow-review"), "x");

    expect(() => prepareScreenshotDir(worktree)).toThrow(ScreenshotDirError);
  });
});
