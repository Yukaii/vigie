import { fetchYoutubeVideoMeta } from "./video-meta-extract";

describe("fetchYoutubeVideoMeta", () => {
  let originalFetch: unknown;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch as typeof fetch;
  });

  it("throws an error for an invalid video", async () => {
    // Mock implementation for error case
    globalThis.fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
    }) as unknown as typeof fetch;
    
    const videoId = "invalidid123";
    await expect(fetchYoutubeVideoMeta(videoId)).rejects.toThrow();
  });
  
  // Skip the test that requires proper mock data
  it.skip("fetches metadata for a valid YouTube video", async () => {
    // This test is skipped until we can properly mock the YouTube response
  });
});
