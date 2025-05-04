// Jest test suite for YouTube Comment Downloader

import {
  getCommentsFromUrl,
  getComments,
  fetchCommentsByContinuation,
  SortBy,
  type YoutubeComment,
  type FetchCallback,
} from "./comment-downloader";

const sampleHtml = `
<script>
ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"hl":"en"}},"INNERTUBE_API_KEY":"test-api-key"});
window["ytInitialData"] = {"itemSectionRenderer":{"continuationItemRenderer":{}},"sortFilterSubMenuRenderer":{"subMenuItems":[{"serviceEndpoint":{"commandMetadata":{"webCommandMetadata":{"apiUrl":"/youtubei/v1/next"}},"continuationCommand":{"token":"token1"}}}]}};
var meta
</script>
`;

const sampleAjaxResponse = {
  reloadContinuationItemsCommand: {
    targetId: "comments-section",
    continuationItems: [
      {
        commentEntityPayload: {
          properties: {
            commentId: "cid123",
            content: { content: "Test comment" },
            publishedTime: "1 day ago",
            toolbarStateKey: "toolbarKey1",
          },
          author: {
            displayName: "Test Author",
            channelId: "channel123",
            avatarThumbnailUrl: "http://photo.url",
          },
          toolbar: {
            likeCountNotliked: "5",
            replyCount: 2,
          },
        },
      },
    ],
  },
  engagementToolbarStateEntityPayload: [
    {
      key: "toolbarKey1",
      heartState: "TOOLBAR_HEART_STATE_HEARTED",
    },
  ],
};

let originalFetch: any;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  let call = 0;
  globalThis.fetch = (async (...args: any[]) => {
    call++;
    if (call === 1) {
      return {
        url: "https://www.youtube.com/watch?v=dummy",
        text: async () => sampleHtml,
      } as any;
    }
    if (call === 2) {
      return {
        status: 200,
        json: async () => sampleAjaxResponse,
      } as any;
    }
    throw new Error("Unexpected fetch call");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("should yield comments from getCommentsFromUrl", async () => {
  const comments: YoutubeComment[] = [];
  for await (const comment of getCommentsFromUrl(
    "https://www.youtube.com/watch?v=dummy",
    SortBy.POPULAR,
  )) {
    comments.push(comment);
  }
  expect(comments.length).toBe(1);
  expect(comments[0]).toMatchObject({
    cid: "cid123",
    text: "Test comment",
    author: "Test Author",
    channel: "channel123",
    votes: "5",
    replies: 2,
    photo: "http://photo.url",
    heart: false,
    reply: false,
  });
});

test("fetchCommentsByContinuation calls callback with comments and continuation", async () => {
  // Simulate a continuation and ytcfg as would be passed in real usage
  const continuation = {
    commandMetadata: { webCommandMetadata: { apiUrl: "/youtubei/v1/next" } },
    continuationCommand: { token: "token1" },
  };
  const ytcfg = {
    INNERTUBE_CONTEXT: { client: { hl: "en" } },
    INNERTUBE_API_KEY: "test-api-key",
  };

  const mockCallback: FetchCallback = jest.fn();
  const { comments, newContinuations } = await fetchCommentsByContinuation(
    continuation,
    ytcfg,
    0,
    mockCallback,
  );
  expect(comments.length).toBe(1);
  expect(comments[0]).toMatchObject({
    cid: "cid123",
    text: "Test comment",
    author: "Test Author",
    channel: "channel123",
    votes: "5",
    replies: 2,
    photo: "http://photo.url",
    heart: false, // Adjusted based on mock data processing
    reply: false,
  });
  expect(Array.isArray(newContinuations)).toBe(true);
  // Expect the callback to receive the token *string* used for the fetch
  expect(mockCallback).toHaveBeenCalledWith(
    comments,
    continuation.continuationCommand.token,
  );
});

test("should yield comments from getComments and call callback", async () => {
  const comments: YoutubeComment[] = [];
  const mockCallback: FetchCallback = jest.fn();
  for await (const comment of getComments(
    "dummy",
    SortBy.POPULAR,
    undefined,
    0,
    mockCallback,
  )) {
    comments.push(comment);
  }
  expect(comments.length).toBe(1);
  expect(comments[0].cid).toBe("cid123");
  // Expect the callback to receive the token *string*
  expect(mockCallback).toHaveBeenCalledWith(
    expect.any(Array),
    expect.any(String),
  );
});

// Rickroll test case (real network call)
test("should yield up to maxComments for Rick Astley video (real fetch)", async () => {
  // Restore the real fetch for this test only
  globalThis.fetch = originalFetch;

  const comments: YoutubeComment[] = [];
  let count = 0;
  for await (const comment of getComments(
    "dQw4w9WgXcQ",
    SortBy.POPULAR,
    undefined,
    0,
    undefined,
    3,
  )) {
    comments.push(comment);
    count++;
    if (count >= 3) break;
  }
  expect(comments.length).toBeGreaterThan(0);
  expect(comments[0].author).toBeTruthy();
  expect(typeof comments[0].text).toBe("string");
});
