// YouTube Video Meta Extractor

export interface YoutubeVideoMeta {
  video_id: string;
  title: string;
  channel_id: string;
  channel_title: string;
}

const YOUTUBE_VIDEO_URL = "https://www.youtube.com/watch?v=";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36";

async function fetchWithUserAgent(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
}

export async function fetchYoutubeVideoMeta(
  videoId: string,
): Promise<YoutubeVideoMeta> {
  const url = YOUTUBE_VIDEO_URL + videoId;
  const res = await fetchWithUserAgent(url);
  const html = await res.text();

  // Extract title
  const titleMatch = html.match(/<title>(.*?)<\/title>/);
  const title = titleMatch
    ? titleMatch[1].replace(" - YouTube", "").trim()
    : "";

  // Extract channel id and title from initial data
  const initialDataMatch = html.match(/var ytInitialData = (.*?);<\/script>/);
  let channel_id = "";
  let channel_title = "";
  if (initialDataMatch) {
    try {
      const data = JSON.parse(initialDataMatch[1]);
      // Try to find channel info in initial data
      const owner =
        data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find(
          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          (c: unknown) => (c as any).videoSecondaryInfoRenderer,
        )?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer;
      if (owner) {
        channel_id = owner?.navigationEndpoint?.browseEndpoint?.browseId || "";
        channel_title = owner?.title?.runs?.[0]?.text || "";
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    video_id: videoId,
    title,
    channel_id,
    channel_title,
  };
}
