import { Inngest, InngestMiddleware, EventSchemas } from "inngest";
import type { Context as HonoContext } from "hono";
import { CrawlSortBy, type CrawlStatusRow, type YoutubeYtcfg } from "../types";
import { CrawlStatusService } from "../services/crawlStatusService";
import { CommentService } from "../services/commentService";
import { SortBy, getInitialCrawlData, fetchCommentPageData } from "../youtube/comment-downloader";
// --- End Comment Downloader Imports ---

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

const bindings = new InngestMiddleware({
  name: "Hono bindings",
  init({ client, fn }) {
    return {
      onFunctionRun({ ctx, fn, steps, reqArgs }) {
        return {
          transformInput({ ctx, fn, steps }) {
            const [honoCtx] = reqArgs as [HonoContext<{ Bindings: Bindings }>];
            return {
              ctx: {
                env: honoCtx.env,
              },
            };
          },
        };
      },
    };
  },
});

// Define Event Schemas
export type Events = {
  "youtube/comment.crawl.trigger": {
    data: {
      videoId: string;
      sortBy: SortBy; // Use the enum from comment-downloader
    };
  };
  "youtube/comment.page.fetch": {
    data: {
      crawlId: number;
      // continuationToken is fetched from DB within the function
    };
  };
};

import type { GetEvents } from "inngest";
export type InngestEvents = GetEvents<typeof inngest>;

// Create a client to send and receive events
export const inngest = new Inngest({
  id: "vigie",
  schemas: new EventSchemas().fromRecord<Events>(),
  middleware: [bindings],
});

// --- Inngest Functions ---

interface EnvBindings {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

import type { GetFunctionInput } from "inngest";

const triggerCommentCrawl = inngest.createFunction(
  { id: "trigger-youtube-comment-crawl", concurrency: 5 },
  { event: "youtube/comment.crawl.trigger" },
  async (input: GetFunctionInput<typeof inngest, "youtube/comment.crawl.trigger">) => {
    const { event, step, logger, env } = input;
    const { createSupabaseClient } = await import("../db");
    const supabase = createSupabaseClient(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
    );
    const crawlStatusService = new CrawlStatusService(supabase);

    const { videoId, sortBy } = event.data;
    const sortByString =
      sortBy === SortBy.RECENT ? CrawlSortBy.RECENT : CrawlSortBy.POPULAR;
    logger.info(
      `Triggering crawl for video ${videoId}, sort by ${sortByString}`,
    );

    // 1. Check existing crawl status using service
    let crawl: CrawlStatusRow | null = await step.run(
      "check-existing-crawl",
      async () => {
        try {
          return await crawlStatusService.findExistingCrawl(
            videoId,
            sortByString,
          );
        } catch (error: unknown) {
          logger.error("Error checking existing crawl via service", { error });
          throw error;
        }
      },
    );

    // --- New logic: Ensure video exists in videos table with metadata ---
    const { VideoService } = await import("../services/videoService");
    const videoService = new VideoService(supabase);
    await step.run("ensure-video-with-meta", async () => {
      await videoService.ensureVideoWithMeta(videoId);
    });
    // --- End new logic ---

    let crawlId: number;
    let initialContinuationToken: string | null = null;
    let needsInitialFetch = false;
    let ytcfg: YoutubeYtcfg | null = null;

    if (!crawl) {
      logger.info(
        `No existing crawl found for ${videoId} (${sortByString}). Creating new record.`,
      );
      crawl = await step.run("create-crawl-record", async () => {
        try {
          return await crawlStatusService.createCrawlRecord(
            videoId,
            sortByString,
          );
        } catch (error: unknown) {
          logger.error("Error creating crawl record via service", { error });
          throw error;
        }
      });
      if (!crawl) {
        throw new Error("Failed to create crawl record.");
      }
      crawlId = crawl.crawl_id;
      needsInitialFetch = true;
    } else {
      if (!crawl) {
        throw new Error("Crawl record unexpectedly null after check.");
      }
      crawlId = crawl.crawl_id;
      logger.info(
        `Existing crawl found (ID: ${crawlId}) for ${videoId} (${sortByString}).`,
      );
      // No status orchestration: always proceed to fetch and update crawl_status as metadata only
      needsInitialFetch = true;
    }

    if (needsInitialFetch) {
      logger.info(`Performing initial data fetch for crawl ${crawlId}.`);
      try {
        const initialData = await step.run(
          "get-initial-crawl-data",
          async () => {
            return await getInitialCrawlData(videoId, sortBy);
          },
        );

        initialContinuationToken = initialData.continuationToken;
        ytcfg = initialData.ytcfg;

        if (!initialContinuationToken) {
          logger.warn(
            `Initial fetch for crawl ${crawlId} returned no continuation token. Marking as complete.`,
          );
          await step.run(
            "mark-crawl-as-completed-no-initial-token",
            async () => {
              await crawlStatusService.markCrawlCompleteNoToken(crawlId);
            },
          );
          return {
            status: "Completed",
            reason: "No initial continuation token",
          };
        }

        logger.info(
          `Initial token and ytcfg obtained for crawl ${crawlId}. Updating record.`,
        );
        await step.run(
          "update-crawl-with-initial-token-and-ytcfg",
          async () => {
            try {
              if (initialContinuationToken == null) {
                throw new Error("initialContinuationToken is null or undefined");
              }
              await crawlStatusService.updateCrawlWithInitialToken(
                crawlId,
                initialContinuationToken,
                ytcfg,
              );
            } catch (error: unknown) {
              logger.error(
                "Error updating crawl with initial token via service",
                { error },
              );
              throw error;
            }
          },
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(
          `Failed to get initial data for crawl ${crawlId}: ${errorMessage}`,
          { error },
        );
        await step.run("mark-crawl-as-failed-initial", async () => {
          await crawlStatusService.markCrawlFailed(crawlId, errorMessage);
        });
        return { status: "Failed", reason: errorMessage };
      }
    } else {
      initialContinuationToken = crawl.continuation_token;
      ytcfg = crawl.ytcfg;
      logger.info(`Resuming crawl ${crawlId} with existing token and ytcfg.`);
      if (!ytcfg) {
        logger.warn(
          `Resuming crawl ${crawlId} but ytcfg is missing from the database record.`,
        );
      }
    }

    if (initialContinuationToken) {
      logger.info(
        `Sending event to fetch first/next page for crawl ${crawlId}.`,
      );
      await step.sendEvent("send-fetch-page-event", {
        name: "youtube/comment.page.fetch",
        data: { crawlId },
      });
      return { status: "Triggered", crawlId };
    }
    logger.warn(
      `Crawl ${crawlId} has no continuation token to proceed. Marking as complete.`,
    );
    await step.run("mark-crawl-as-completed-no-token-final", async () => {
      await crawlStatusService.markCrawlCompleteNoToken(crawlId);
    });
    return {
      status: "Completed",
      reason: "No continuation token found to initiate fetch",
    };
  },
);

const fetchCommentPage = inngest.createFunction(
  { id: "fetch-youtube-comment-page", concurrency: 10, retries: 5 },
  { event: "youtube/comment.page.fetch" },
  async (input: GetFunctionInput<typeof inngest, "youtube/comment.page.fetch">) => {
    const { event, step, logger, env } = input;
    const { createSupabaseClient } = await import("../db");
    const supabase = createSupabaseClient(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
    );
    const crawlStatusService = new CrawlStatusService(supabase);
    const commentService = new CommentService(supabase);

    const { crawlId } = event.data;
    logger.info(`Fetching comment page for crawl ${crawlId}.`);

    // 1. Get current crawl status and token using service
    let crawl: CrawlStatusRow;
    try {
      crawl = await step.run("get-crawl-details", async () => {
        return await crawlStatusService.getCrawlDetails(crawlId);
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to get crawl details for ${crawlId}: ${errorMessage}`,
        { error },
      );
      throw error;
    }

    // Validate crawl state (status removed, only check for continuation_token)
    if (!crawl.continuation_token) {
      logger.warn(
        `Crawl ${crawlId} has no continuation token. Marking complete.`,
      );
      await step.run("mark-crawl-completed-no-token-fetch", async () => {
        await crawlStatusService.markCrawlCompleteNoToken(crawlId);
      });
      return { status: "Completed", reason: "No continuation token" };
    }

    const currentToken = crawl.continuation_token;
    const ytcfgForFetch: YoutubeYtcfg | null = crawl.ytcfg;

    if (!ytcfgForFetch) {
      logger.error(
        `Cannot proceed with fetch for crawl ${crawlId}: ytcfg is missing from database record.`,
      );
      throw new Error(`ytcfg is missing for crawl ${crawlId}`);
    }

    // 2. Update status to IN_PROGRESS using service
    await step.run("set-crawl-in-progress", async () => {
      try {
        await crawlStatusService.setCrawlInProgress(crawlId);
      } catch (error: unknown) {
        logger.error("Error setting crawl status to IN_PROGRESS via service", {
          error,
        });
        throw error;
      }
    });

    try {
      // 3. Fetch comment page data
      logger.info(
        `Calling fetchCommentPageData for crawl ${crawlId} with token.`,
      );
      const pageData = await step.run("fetch-comment-page-data", async () => {
        return await fetchCommentPageData(currentToken, ytcfgForFetch);
      });

      const { comments, nextContinuationToken } = pageData;
      logger.info(
        `Fetched ${comments.length} comments for crawl ${crawlId}. Next token: ${nextContinuationToken ? "Yes" : "No"}.`,
      );

      // 4. Process comments using service
      if (comments.length > 0) {
        await step.run("process-comments-batch", async () => {
          logger.debug(
            `Processing ${comments.length} comments for crawl ${crawlId}.`,
          );
          await commentService.processCommentBatch(comments, crawl.video_id);
        });
      }

      // 5. Update crawl status based on outcome using service
      if (nextContinuationToken) {
        logger.info(
          `Updating crawl ${crawlId} status to PENDING for next page.`,
        );
        await step.run("update-crawl-next-page", async () => {
          try {
            await crawlStatusService.updateCrawlNextPage(
              crawlId,
              nextContinuationToken,
            );
          } catch (error: unknown) {
            logger.error(
              "Error updating crawl status for next page via service",
              { error },
            );
            throw error;
          }
        });

        logger.info(`Sending event to fetch next page for crawl ${crawlId}.`);
        await step.sendEvent("send-next-page-event", {
          name: "youtube/comment.page.fetch",
          data: { crawlId },
        });
        return {
          status: "Page Processed",
          nextPage: true,
          commentsProcessed: comments.length,
        };
      }
      logger.info(`Crawl ${crawlId} completed. No next continuation token.`);
      await step.run("mark-crawl-completed", async () => {
        try {
          await crawlStatusService.markCrawlCompleted(crawlId);
        } catch (error: unknown) {
          logger.error("Error marking crawl as completed via service", {
            error,
          });
          throw error;
        }
      });
      return {
        status: "Completed",
        nextPage: false,
        commentsProcessed: comments.length,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during page fetch/process";
      logger.error(
        `Failed to fetch/process page for crawl ${crawlId}: ${errorMessage}`,
        { error },
      );
      await step.run("mark-crawl-failed", async () => {
        await crawlStatusService.markCrawlFailed(crawlId, errorMessage);
      });
      throw error;
    }
  },
);

// Export the functions
export const functions = [triggerCommentCrawl, fetchCommentPage];
