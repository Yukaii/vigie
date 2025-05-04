// YouTube Comment Downloader (TypeScript)
// Reference: Python implementation provided by user

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

const YOUTUBE_VIDEO_URL = 'https://www.youtube.com/watch?v=';
const YOUTUBE_CONSENT_URL = 'https://consent.youtube.com/save';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36';

const YT_CFG_RE = /ytcfg\.set\s*\(\s*({.+?})\s*\)\s*;/;
const YT_INITIAL_DATA_RE =
  /(?:window\s*\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/;
const YT_HIDDEN_INPUT_RE =
  /<input\s+type="hidden"\s+name="([A-Za-z0-9_]+)"\s+value="([A-Za-z0-9_\-\.]*)"\s*(?:required|)\s*>/g;

function regexSearch(text: string, pattern: RegExp, group = 1, def: any = null): any {
  const match = pattern.exec(text);
  return match ? match[group] : def;
}

function* searchDict(partial: any, searchKey: string): Generator<any> {
  const stack = [partial];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'object' && current !== null) {
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

async function fetchWithUserAgent(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    credentials: 'include',
  });
}

async function ajaxRequest(
  endpoint: any,
  ytcfg: any,
  retries = 5,
  sleep = 2000,
  timeout = 60000
): Promise<any> {
  const url = 'https://www.youtube.com' + endpoint.commandMetadata.webCommandMetadata.apiUrl;
  const data = {
    context: ytcfg.INNERTUBE_CONTEXT,
    continuation: endpoint.continuationCommand.token,
  };
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchWithUserAgent(
        url + '?key=' + encodeURIComponent(ytcfg.INNERTUBE_API_KEY),
        {
          method: 'POST',
          body: JSON.stringify(data),
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      if (res.status === 200) {
        return await res.json();
      }
      if (res.status === 403 || res.status === 413) {
        return {};
      }
    } catch (e) {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, sleep));
  }
  return {};
}

export async function* getCommentsFromUrl(
  youtubeUrl: string,
  sortBy: SortBy = SortBy.RECENT,
  language?: string,
  sleep = 100
): AsyncGenerator<YoutubeComment> {
  let res = await fetchWithUserAgent(youtubeUrl);
  let html = await res.text();

  // Handle consent redirect
  if (res.url.includes('consent')) {
    const params: Record<string, string> = {};
    let match: RegExpExecArray | null;
    while ((match = YT_HIDDEN_INPUT_RE.exec(html))) {
      params[match[1]] = match[2];
    }
    params['continue'] = youtubeUrl;
    params['set_eom'] = 'False';
    params['set_ytc'] = 'True';
    params['set_apyt'] = 'True';

    const consentUrl =
      YOUTUBE_CONSENT_URL +
      '?' +
      Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    res = await fetchWithUserAgent(consentUrl, { method: 'POST' });
    html = await res.text();
  }

  const ytcfgRaw = regexSearch(html, YT_CFG_RE, 1, '');
  if (!ytcfgRaw) return;
  const ytcfg = JSON.parse(ytcfgRaw);
  if (language) {
    ytcfg.INNERTUBE_CONTEXT.client.hl = language;
  }

  const dataRaw = regexSearch(html, YT_INITIAL_DATA_RE, 1, '');
  if (!dataRaw) return;
  let data = JSON.parse(dataRaw);

  let itemSection = [...searchDict(data, 'itemSectionRenderer')][0];
  let renderer =
    itemSection && [...searchDict(itemSection, 'continuationItemRenderer')][0];
  if (!renderer) return;

  let sortMenu =
    ([...searchDict(data, 'sortFilterSubMenuRenderer')][0]?.subMenuItems as any[]) || [];
  if (!sortMenu.length) {
    const sectionList = [...searchDict(data, 'sectionListRenderer')][0] || {};
    const continuations = [...searchDict(sectionList, 'continuationEndpoint')];
    data = continuations.length ? await ajaxRequest(continuations[0], ytcfg) : {};
    sortMenu =
      ([...searchDict(data, 'sortFilterSubMenuRenderer')][0]?.subMenuItems as any[]) || [];
  }
  if (!sortMenu.length || sortBy >= sortMenu.length) {
    throw new Error('Failed to set sorting');
  }
  let continuations = [sortMenu[sortBy].serviceEndpoint];

  while (continuations.length) {
    const continuation = continuations.pop();
    const { comments, newContinuations } = await fetchCommentsByContinuation(continuation, ytcfg, sleep);
    for (const c of comments) {
      yield c;
    }
    continuations.push(...newContinuations);
  }
}

export async function fetchCommentsByContinuation(
  continuation: any,
  ytcfg: any,
  sleep = 100
): Promise<{ comments: YoutubeComment[]; newContinuations: any[] }> {
  const response = await ajaxRequest(continuation, ytcfg);
  if (!response) return { comments: [], newContinuations: [] };

  const error = [...searchDict(response, 'externalErrorMessage')][0];
  if (error) throw new Error('Error returned from server: ' + error);

  const newContinuations: any[] = [];
  const actions = [
    ...searchDict(response, 'reloadContinuationItemsCommand'),
    ...searchDict(response, 'appendContinuationItemsAction'),
  ];
  for (const action of actions) {
    for (const item of action.continuationItems || []) {
      if (
        ['comments-section', 'engagement-panel-comments-section', 'shorts-engagement-panel-comments-section'].includes(
          action.targetId
        )
      ) {
        newContinuations.unshift(...[...searchDict(item, 'continuationEndpoint')]);
      }
      if (
        action.targetId?.startsWith('comment-replies-item') &&
        item.continuationItemRenderer
      ) {
        newContinuations.push(
          [...searchDict(item, 'buttonRenderer')][0]?.command
        );
      }
    }
  }

  const comments: YoutubeComment[] = [];
  for (const comment of [...searchDict(response, 'commentEntityPayload')].reverse()) {
    const properties = comment.properties;
    const cid = properties.commentId;
    const author = comment.author;
    const toolbar = comment.toolbar;
    const toolbarState = (
      [...searchDict(response, 'engagementToolbarStateEntityPayload')].find(
        (p: any) => p.key === properties.toolbarStateKey
      ) || {}
    );
    const result: YoutubeComment = {
      cid,
      text: properties.content.content,
      time: properties.publishedTime,
      author: author.displayName,
      channel: author.channelId,
      votes: toolbar.likeCountNotliked?.trim() || '0',
      replies: toolbar.replyCount,
      photo: author.avatarThumbnailUrl,
      heart: toolbarState.heartState === 'TOOLBAR_HEART_STATE_HEARTED',
      reply: cid.includes('.'),
    };
    comments.push(result);
  }
  await new Promise((resolve) => setTimeout(resolve, sleep));
  return { comments, newContinuations };
}

export async function* getComments(
  youtubeId: string,
  sortBy: SortBy = SortBy.RECENT,
  language?: string,
  sleep = 100
): AsyncGenerator<YoutubeComment> {
  yield* getCommentsFromUrl(YOUTUBE_VIDEO_URL + youtubeId, sortBy, language, sleep);
}
