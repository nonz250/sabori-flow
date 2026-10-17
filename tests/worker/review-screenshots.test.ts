import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  collectScreenshots,
  prepareScreenshotDir,
  ScreenshotDirError,
  MAX_REVIEW_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
} from "../../src/worker/review-screenshots.js";

let worktree: string;
let dir: string;

function write(name: string, bytes = 1): void {
  writeFileSync(join(dir, name), Buffer.alloc(bytes));
}

describe("collectScreenshots", () => {
  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "sabori-flow-worktree-"));
    dir = join(worktree, ".sabori-flow-review", "screenshots");
    mkdirSync(dir, { recursive: true });
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
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

  it("succeeds when the directory already exists", () => {
    prepareScreenshotDir(worktree);

    expect(() => prepareScreenshotDir(worktree)).not.toThrow();
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
