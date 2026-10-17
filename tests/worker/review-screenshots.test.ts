import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  MAX_REVIEW_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
} from "../../src/worker/review-screenshots.js";

let dir: string;

function write(name: string, bytes = 1): void {
  writeFileSync(join(dir, name), Buffer.alloc(bytes));
}

describe("collectScreenshots", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sabori-flow-screenshots-"));
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the directory does not exist", () => {
    expect(collectScreenshots(join(dir, "missing"))).toEqual([]);
  });

  it("returns png files sorted by name", () => {
    write("02-after.png");
    write("01-before.png");

    expect(collectScreenshots(dir)).toEqual(["01-before.png", "02-after.png"]);
  });

  it("skips files whose names contain characters outside letters, digits and hyphens", () => {
    write("ok-1.png");
    write("has space.png");
    write("under_score.png");
    write("dot.name.png");

    expect(collectScreenshots(dir)).toEqual(["ok-1.png"]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(3);
  });

  it("skips files that are not png", () => {
    write("photo.jpg");
    write("upper.PNG");
    write("shot.png");

    expect(collectScreenshots(dir)).toEqual(["shot.png"]);
  });

  it("skips symbolic links even when they point at a png", () => {
    write("real.png");
    symlinkSync(join(dir, "real.png"), join(dir, "link.png"));

    expect(collectScreenshots(dir)).toEqual(["real.png"]);
  });

  it("skips directories named like a png", () => {
    mkdirSync(join(dir, "folder.png"));

    expect(collectScreenshots(dir)).toEqual([]);
  });

  it("accepts a file of exactly the size limit and skips one byte over it", () => {
    write("at-limit.png", MAX_SCREENSHOT_BYTES);
    write("over-limit.png", MAX_SCREENSHOT_BYTES + 1);

    expect(collectScreenshots(dir)).toEqual(["at-limit.png"]);
  });

  it("keeps only the first screenshots up to the limit", () => {
    const names = Array.from(
      { length: MAX_REVIEW_SCREENSHOTS + 1 },
      (_, i) => `${String(i).padStart(2, "0")}-shot.png`,
    );
    for (const name of names) write(name);

    expect(collectScreenshots(dir)).toEqual(names.slice(0, MAX_REVIEW_SCREENSHOTS));
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });
});
