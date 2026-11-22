import { describe, expect, it } from "vitest";
import { videoParts } from "./video-parts";

describe("videoParts", () => {
  it("rozdziela tytuł, opis i transkrypcję filmu", () => {
    const parts = videoParts({
      title: "Jak kupić akcje",
      metadata: {
        kind: "youtube_video",
        description: "Opis filmu",
        transcript: {
          segments: [
            { start: 0, text: " Cześć " },
            { start: 2, text: "dziś akcje" },
          ],
        },
      },
    });
    expect(parts).toEqual({
      title: "Jak kupić akcje",
      description: "Opis filmu",
      transcript: "Cześć dziś akcje",
    });
  });

  it("film bez transkrypcji ma transcript = null", () => {
    const parts = videoParts({
      title: null,
      metadata: { kind: "youtube_video", description: null, transcript: null },
    });
    expect(parts).toEqual({ title: "", description: "", transcript: null });
  });

  it("strona WWW nie jest filmem", () => {
    expect(videoParts({ title: "Strona", metadata: { kind: "linked_page" } })).toBeNull();
    expect(videoParts({ title: "Strona", metadata: {} })).toBeNull();
  });
});
