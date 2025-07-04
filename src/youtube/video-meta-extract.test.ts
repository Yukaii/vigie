import { fetchYoutubeVideoMeta } from "./video-meta-extract";

describe("fetchYoutubeVideoMeta", () => {
  it("fetches metadata for a valid YouTube video", async () => {
    // Use a well-known YouTube video ID (Rick Astley - Never Gonna Give You Up)
    const videoId = "dQw4w9WgXcQ";
    const meta = await fetchYoutubeVideoMeta(videoId);

    expect(meta.video_id).toBe(videoId);
    expect(typeof meta.title).toBe("string");
    expect(meta.title.length).toBeGreaterThan(0);
    expect(typeof meta.channel_id).toBe("string");
    expect(meta.channel_id.length).toBeGreaterThan(0);
    expect(typeof meta.channel_title).toBe("string");
    expect(meta.channel_title.length).toBeGreaterThan(0);
  });

  it("throws an error for an invalid video", async () => {
    const videoId = "invalidid123";
    await expect(fetchYoutubeVideoMeta(videoId)).rejects.toThrow();
  });
});
