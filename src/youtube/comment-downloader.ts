// YouTube Comment Downloader (TypeScript)
// Reference: Python implementation provided by user

import { applyProxyToFetchOptions } from './proxy-config';

export interface YoutubeComment {
  cid: string;
  text: string;
  time: string;
  author: string;
  channel: string;
  votes: string;
  replies: number;
  photo: string;
  heart: boolean;
  reply: boolean;
  time_parsed?: number;
  paid?: string;
}

export enum SortBy {
  POPULAR = 0,
  RECENT = 1,
}

const YOUTUBE_VIDEO_URL = "https://www.youtube.com/watch?v=";
const YOUTUBE_CONSENT_URL = "https://consent.youtube.com/save";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

const YT_CFG_RE = /ytcfg\.set\s*\(\s*({.+?})\s*\)\s*;/;
const YT_INITIAL_DATA_RE =
  /(?:window\s*\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/;
const YT_HIDDEN_INPUT_RE =
  /<input\s+type="hidden"\s+name="([A-Za-z0-9_]+)"\s+value="([A-Za-z0-9_\-\.]*)"\s*(?:required|)\s*>/g;

function regexSearch(
  text: string,
  pattern: RegExp,
  group = 1,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  def: any = null,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
): any {
  const match = pattern.exec(text);
  return match ? match[group] : def;
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function* searchDict(partial: any, searchKey: string): Generator<any> {
  const stack = [partial];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "object" && current !== null) {
      if (Array.isArray(current)) {
        stack.push(...current);
      } else {
        for (const [key, value] of Object.entries(current)) {
          if (key === searchKey) yield value;
          else stack.push(value);
        }
      }
    }
  }
}

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
    credentials: "include",
  };

  // Add Cloudflare-specific options if running in a CF environment
  if (typeof globalThis.caches !== 'undefined') {
    fetchOptions.cf = {
      cacheEverything: false,
    };
  }

  // Apply proxy configuration if enabled
  const proxiedOptions = applyProxyToFetchOptions(fetchOptions);

  try {
    return await fetch(url, proxiedOptions);
  } catch (error) {
    console.warn(`Fetch failed with proxy: ${error}. Retrying without proxy...`);
    // Fallback to direct connection if proxy fails
    return fetch(url, fetchOptions);
  }
}

async function ajaxRequest(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  endpoint: any,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  ytcfg: any,
  retries = 5,
  sleep = 2000,
  timeout = 60000,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
): Promise<any> {
  const url = `https://www.youtube.com${endpoint.commandMetadata.webCommandMetadata.apiUrl}`;
  const data = {
    context: ytcfg.INNERTUBE_CONTEXT,
    continuation: endpoint.continuationCommand.token,
  };
  for (let i = 0; i < retries; i++) {
    try {
      // Use a more random delay between retries to appear more human-like
      const randomDelay = sleep + Math.floor(Math.random() * 1000);
      
      const res = await fetchWithUserAgent(
        `${url}?key=${encodeURIComponent(ytcfg.INNERTUBE_API_KEY)}`,
        {
          method: "POST",
          body: JSON.stringify(data),
          headers: {
            "Content-Type": "application/json",
            "X-YouTube-Client-Name": "1",
            "X-YouTube-Client-Version": "2.20240518.00.00",
            "Origin": "https://www.youtube.com",
            "Referer": "https://www.youtube.com/",
            "Accept": "*/*",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
          },
        },
      );
      
      if (res.status === 200) {
        return await res.json();
      }
      
      if (res.status === 403 || res.status === 413 || res.status === 429) {
        console.warn(`YouTube API returned status ${res.status}, retrying (attempt ${i+1}/${retries})...`);
        // Exponential backoff for 429 errors
        if (res.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, randomDelay * Math.pow(2, i)));
          continue;
        }
        return {};
      }
    } catch (e) {
      console.warn(`Error during ajaxRequest: ${e}, retrying (attempt ${i+1}/${retries})...`);
    }
    await new Promise((resolve) => setTimeout(resolve, sleep));
  }
  return {};
}

// Helper to extract comments and next token from AJAX response
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function processAjaxResponse(response: any): {
  comments: YoutubeComment[];
  nextContinuationToken: string | null;
} {
  if (!response) return { comments: [], nextContinuationToken: null };

  const error = [...searchDict(response, "externalErrorMessage")][0];
  if (error) throw new Error(`Error returned from server: ${error}`);

  let nextContinuationToken: string | null = null;
  const actions = [
    ...searchDict(response, "reloadContinuationItemsCommand"),
    ...searchDict(response, "appendContinuationItemsAction"),
  ];
  for (const action of actions) {
    for (const item of action.continuationItems || []) {
      // Find the continuation item renderer for the main comments section
      if (item.continuationItemRenderer) {
        const continuationEndpoint = [
          ...searchDict(item.continuationItemRenderer, "continuationEndpoint"),
        ][0];
        if (continuationEndpoint?.continuationCommand?.token) {
          nextContinuationToken =
            continuationEndpoint.continuationCommand.token;
          // Typically, there's only one main continuation, break after finding it
          break;
        }
      }
      // Handle replies continuation (might need adjustment based on structure)
      // if (action.targetId?.startsWith('comment-replies-item') && item.continuationItemRenderer) {
      //     // This logic might need refinement if replies are handled separately
      //     const buttonRenderer = [...searchDict(item, 'buttonRenderer')][0];
      //     if (buttonRenderer?.command?.continuationCommand?.token) {
      //         // Decide how to handle reply continuations if needed
      //     }
      // }
    }
    if (nextContinuationToken) break; // Found the main continuation
  }

  const comments: YoutubeComment[] = [];
  // Look for both commentViewModel and commentEntityPayload
  const commentSources = [
    ...searchDict(response, "commentViewModel"),
    ...searchDict(response, "commentEntityPayload"), // Add this source
  ];

  // Extract toolbar states for heart status lookup
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const toolbarStates: Record<string, any> = {};
  for (const state of searchDict(
    response,
    "engagementToolbarStateEntityPayload",
  )) {
    if (state.key) {
      toolbarStates[state.key] = state;
    }
  }

  for (const commentSource of commentSources) {
    let commentId: string | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    let author: any = {};
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    let content: any = {};
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    let toolbar: any = {};
    let publishedTime: string | undefined;
    let toolbarStateKey: string | undefined;
    let isHearted = false;
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    let paidChip: any = null;

    if (commentSource.commentId) {
      // Likely commentViewModel
      commentId = commentSource.commentId;
      author = commentSource.author || {};
      content = commentSource.content || {};
      toolbar = commentSource.toolbar || {};
      publishedTime = commentSource.publishedTimeText?.runs?.[0]?.text;
      toolbarStateKey = commentSource.toolbarStateKey; // ViewModel might have direct key
      isHearted =
        toolbar?.heartButton?.heartButtonViewModel?.isHearted || false; // ViewModel might have direct status
      paidChip = commentSource.paidCommentChip;
    } else if (commentSource.properties) {
      // Likely commentEntityPayload
      commentId = commentSource.properties.commentId;
      content = commentSource.properties.content || {};
      publishedTime = commentSource.properties.publishedTime;
      toolbarStateKey = commentSource.properties.toolbarStateKey; // Payload uses key for lookup
      author = commentSource.author || {};
      toolbar = commentSource.toolbar || {}; // Payload has toolbar inside
      paidChip = commentSource.properties.paidCommentChip;

      // Look up heart status using toolbarStateKey
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const state = toolbarStates[toolbarStateKey!];
      if (state?.heartState === "TOOLBAR_HEART_STATE_HEARTED") {
        isHearted = true;
      }
    } else {
      continue; // Skip if structure is unrecognized
    }

    if (!commentId) continue; // Skip if no ID found

    const result: YoutubeComment = {
      cid: commentId,
      text:
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        content?.runs?.map((r: any) => r.text).join("") ||
        content?.content ||
        "", // Handle both structures
      time: publishedTime || "",
      author: author?.displayName || "",
      channel: author?.channelId || "",
      // Adjust vote parsing for both potential structures
      votes:
        toolbar?.likeCountAriaLabel?.replace(/\D/g, "") ||
        toolbar?.likeCountNotliked?.toString() ||
        "0",
      replies: Number.parseInt(toolbar?.replyCount?.toString() || "0", 10),
      photo:
        author?.avatarThumbnails?.[0]?.url || author?.avatarThumbnailUrl || "", // Handle both
      heart: isHearted,
      reply: commentId.includes("."),
      paid: paidChip?.paidCommentChipRenderer?.chipText?.simpleText, // Example access for paid chip
    };
    comments.push(result);
  }
  return { comments, nextContinuationToken };
}

/**
 * Fetches the initial page HTML, parses ytcfg, and gets the first continuation token.
 */
export async function getInitialCrawlData(
  videoId: string,
  sortBy: SortBy,
  language?: string,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
): Promise<{ continuationToken: string | null; ytcfg: any }> {
  const youtubeUrl = YOUTUBE_VIDEO_URL + videoId;
  let res = await fetchWithUserAgent(youtubeUrl);
  let html = await res.text();

  // Handle consent redirect
  if (res.url.includes("consent")) {
    const params: Record<string, string> = {};
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
    while ((match = YT_HIDDEN_INPUT_RE.exec(html))) {
      params[match[1]] = match[2];
    }
    params.continue = youtubeUrl;
    params.set_eom = "False";
    params.set_ytc = "True";
    params.set_apyt = "True";

    const consentUrl = `${YOUTUBE_CONSENT_URL}?${Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&")}`;
    res = await fetchWithUserAgent(consentUrl, { method: "POST" });
    html = await res.text();
  }

  const ytcfgRaw = regexSearch(html, YT_CFG_RE, 1, "");
  if (!ytcfgRaw) {
    throw new Error("Could not extract ytcfg configuration.");
  }
  const ytcfg = JSON.parse(ytcfgRaw);
  if (language) {
    ytcfg.INNERTUBE_CONTEXT.client.hl = language;
  }

  const dataRaw = regexSearch(html, YT_INITIAL_DATA_RE, 1, "");
  if (!dataRaw) {
    throw new Error("Could not extract initial data.");
  }
  let data = JSON.parse(dataRaw);

  // Find the sort menu to get the correct initial continuation endpoint
  let sortMenu =
    (// biome-ignore lint/suspicious/noExplicitAny: <explanation>
    [...searchDict(data, "sortFilterSubMenuRenderer")][0]
      ?.subMenuItems as any[]) || [];

  // If sort menu not in initial data, try fetching via ajax (common case)
  if (!sortMenu.length) {
    const sectionList = [...searchDict(data, "sectionListRenderer")][0] || {};
    const continuations = [...searchDict(sectionList, "continuationEndpoint")];
    if (continuations.length) {
      // Use the first continuation found to load the comments section data
      data = await ajaxRequest(continuations[0], ytcfg);
      sortMenu =
        (// biome-ignore lint/suspicious/noExplicitAny: <explanation>
        [...searchDict(data, "sortFilterSubMenuRenderer")][0]
          ?.subMenuItems as any[]) || [];
    }
  }

  if (!sortMenu.length || sortBy >= sortMenu.length) {
    throw new Error("Failed to find or set comment sorting.");
  }

  // Get the continuation token for the desired sort order
  let initialToken: string | null = null;

  const sortMenuItem = sortMenu[sortBy];
  if (sortMenuItem?.serviceEndpoint) {
    const initialContinuationEndpoint = sortMenuItem.serviceEndpoint;
    initialToken =
      initialContinuationEndpoint?.continuationCommand?.token || null;
  }

  // Fallback: Try to find any continuation token in the initial data if sortMenu is missing or malformed
  if (!initialToken) {
    // Try to find any continuation token in sectionListRenderer
    const sectionList = [...searchDict(data, "sectionListRenderer")][0] || {};
    const continuations = [...searchDict(sectionList, "continuationEndpoint")];
    if (continuations.length) {
      initialToken = continuations[0]?.continuationCommand?.token || null;
    }
  }

  // Fallback: Try to find any continuation token in the entire data object
  if (!initialToken) {
    const allContinuations = [...searchDict(data, "continuationCommand")];
    if (allContinuations.length) {
      initialToken = allContinuations[0]?.token || null;
    }
  }

  // Fallback: Try to use nextContinuationToken from processAjaxResponse if comments exist
  if (!initialToken) {
    const { comments, nextContinuationToken } = processAjaxResponse(data);
    if (comments.length > 0 && nextContinuationToken) {
      console.warn("Using continuation token found after fallback search.");
      return { continuationToken: nextContinuationToken, ytcfg };
    }
  }

  if (!initialToken) {
    throw new Error(
      "Could not find the initial continuation token. The YouTube page structure may have changed or comments are disabled.",
    );
  }

  return { continuationToken: initialToken, ytcfg };
}

/**
 * Fetches a single page of comments using a continuation token.
 */
export async function fetchCommentPageData(
  continuationToken: string,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  ytcfg: any,
  sleep = 100,
): Promise<{
  comments: YoutubeComment[];
  nextContinuationToken: string | null;
}> {
  // Construct the endpoint object expected by ajaxRequest
  const endpoint = {
    continuationCommand: {
      token: continuationToken,
    },
    // Provide necessary metadata if available/required by ajaxRequest structure
    commandMetadata: {
      webCommandMetadata: {
        // Adjust apiUrl if needed, might be part of ytcfg or constant
        apiUrl: "/youtubei/v1/next",
      },
    },
  };

  const response = await ajaxRequest(endpoint, ytcfg);
  await new Promise((resolve) => setTimeout(resolve, sleep)); // Keep sleep after request

  return processAjaxResponse(response);
}

// --- Original Generator Functions (Can be kept or adapted) ---

export type FetchCallback = (
  comments: YoutubeComment[],
  continuationToken?: string,
) => Promise<void>;

export async function* getCommentsFromUrl(
  youtubeUrl: string,
  sortBy: SortBy = SortBy.RECENT,
  language?: string,
  sleep = 100,
  callback?: FetchCallback, // Keep callback for potential external use
  maxComments?: number,
): AsyncGenerator<YoutubeComment> {
  try {
    // Extract videoId from URL
    const urlParams = new URLSearchParams(new URL(youtubeUrl).search);
    const videoId = urlParams.get("v");
    if (!videoId) {
      throw new Error(`Could not extract video ID from URL: ${youtubeUrl}`);
    }

    const { continuationToken: initialToken, ytcfg } =
      await getInitialCrawlData(
        videoId, // Pass extracted videoId
        sortBy,
        language,
      );

    let currentToken: string | null = initialToken;
    let yielded = 0;

    while (currentToken) {
      const { comments, nextContinuationToken } = await fetchCommentPageData(
        currentToken,
        ytcfg,
        sleep,
      );

      if (callback) {
        // Pass the token used for *this* fetch
        await callback(comments, currentToken);
      }

      for (const comment of comments) {
        if (maxComments !== undefined && yielded >= maxComments) {
          return;
        }
        yield comment;
        yielded++;
      }

      if (maxComments !== undefined && yielded >= maxComments) {
        return;
      }

      currentToken = nextContinuationToken;
    }
  } catch (error) {
    console.error("Error fetching comments:", error);
    // Decide how to handle errors in the generator context
    // Option 1: Stop iteration
    return;
    // Option 2: Yield an error object (less common for generators)
    // yield { error: error.message };
  }
}

// This function is now largely superseded by fetchCommentPageData but kept for reference/potential direct use
export async function fetchCommentsByContinuation(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  continuation: any, // Original function took the full endpoint object
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  ytcfg: any,
  sleep = 100,
  callback?: FetchCallback, // Keep callback for potential external use
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
): Promise<{ comments: YoutubeComment[]; newContinuations: any[] }> {
  // Original return type included full continuation objects

  const response = await ajaxRequest(continuation, ytcfg);
  await new Promise((resolve) => setTimeout(resolve, sleep));

  // Use the refactored processing logic
  const { comments, nextContinuationToken } = processAjaxResponse(response);

  // Adapt the return type if needed, or just return comments/next token
  // The original 'newContinuations' contained full endpoint objects, which might not be needed now.
  // For simplicity, let's just return what fetchCommentPageData returns.
  // If the full continuation objects are needed elsewhere, adjust processAjaxResponse.

  if (callback) {
    // Pass the token used for *this* fetch
    await callback(comments, continuation?.continuationCommand?.token);
  }

  // Construct a compatible return object if necessary, otherwise this function might be deprecated.
  // Returning just comments and the next token string for consistency:
  // return { comments, nextContinuationToken };

  // Returning original structure (might be slightly inaccurate now):
  const nextContinuationObject = nextContinuationToken
    ? { continuationCommand: { token: nextContinuationToken } }
    : null;
  return {
    comments,
    newContinuations: nextContinuationObject ? [nextContinuationObject] : [],
  };
}

export async function* getComments(
  youtubeId: string,
  sortBy: SortBy = SortBy.RECENT,
  language?: string,
  sleep = 100,
  callback?: FetchCallback,
  maxComments?: number,
): AsyncGenerator<YoutubeComment> {
  yield* getCommentsFromUrl(
    YOUTUBE_VIDEO_URL + youtubeId,
    sortBy,
    language,
    sleep,
    callback,
    maxComments,
  );
}
