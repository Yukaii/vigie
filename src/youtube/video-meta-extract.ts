// YouTube Video Meta Extractor

export interface YoutubeVideoMeta {
  video_id: string;
  title: string;
  channel_id: string;
  channel_title: string;
}

const YOUTUBE_VIDEO_URL = "https://www.youtube.com/watch?v=";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

async function fetchWithUserAgent(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  // Create fetch options with extended headers
  const fetchOptions: RequestInit & { cf?: { cacheEverything: boolean } } = {
    ...options,
    headers: {
      ...(options.headers || {}),
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
      "Sec-Ch-Ua": "\"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"114\"",
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": "\"Windows\"",
      "Upgrade-Insecure-Requests": "1",
      "Priority": "u=0, i",
    },
  };

  // Add Cloudflare-specific options if running in a CF environment
  if (typeof globalThis.caches !== 'undefined') {
    fetchOptions.cf = {
      cacheEverything: false,
    };
  }

  return fetch(url, fetchOptions);
}

export async function fetchYoutubeVideoMeta(
  videoId: string,
): Promise<YoutubeVideoMeta> {
  const url = YOUTUBE_VIDEO_URL + videoId;
  const res = await fetchWithUserAgent(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch YouTube video page: ${res.status} ${res.statusText}`);
  }

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

  if (!title) {
    throw new Error("Failed to extract video title from YouTube page.");
  }
  if (!channel_id || !channel_title) {
    throw new Error("Failed to extract channel information from YouTube page.");
  }

  return {
    video_id: videoId,
    title,
    channel_id,
    channel_title,
  };
}
