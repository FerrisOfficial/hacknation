import { describe, expect, it } from "vitest";
import { framesDone, readFramesState, shouldRequestVideo } from "./media-state";

const manifest = {
  material_id: "22222222-2222-4222-8222-222222222222",
  status: "done",
  source_url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  duration_s: 19,
  width: 320,
  height: 240,
  video: {
    file: "video.mp4",
    content_type: "video/mp4",
    size_bytes: 744412,
    sha256: "a".repeat(64),
  },
  policy: { fps: 1, max_frames: 200, max_height: 720 },
  items: [{ ts: 0, until: 1, file: "0.png" }],
  created_at: "2026-11-22T01:00:00Z",
};

describe("readFramesState", () => {
  it("rozpoznaje manifest, kolejkę i błąd", () => {
    expect(readFramesState(manifest)?.status).toBe("done");
    expect(readFramesState({ status: "queued", at: "x" })?.status).toBe("queued");
    expect(readFramesState({ status: "failed", at: "x", error: "429" })?.status).toBe("failed");
  });

  it("zły kształt albo brak = film nie był zamawiany", () => {
    expect(readFramesState(undefined)).toBeNull();
    expect(readFramesState({ status: "done" })).toBeNull();
    expect(framesDone({ ...manifest, items: [{ ts: 0, until: 1, file: "../x" }] })).toBe(false);
  });
});

describe("shouldRequestVideo", () => {
  it("tylko YouTube i tylko niepobrany", () => {
    expect(shouldRequestVideo("youtube", undefined)).toBe(true);
    expect(shouldRequestVideo("youtube", { status: "queued", at: "x" })).toBe(true);
    expect(shouldRequestVideo("youtube", manifest)).toBe(false);
    expect(shouldRequestVideo("web", undefined)).toBe(false);
  });

  it("po błędzie tylko na wyraźne żądanie", () => {
    const failed = { status: "failed", at: "x", error: "HTTP 429" };
    expect(shouldRequestVideo("youtube", failed)).toBe(false);
    expect(shouldRequestVideo("youtube", failed, { retry: true })).toBe(true);
  });
});
