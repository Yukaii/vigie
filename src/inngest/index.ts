import { Inngest, Context, EventSchemas } from "inngest";
import {
  CrawlSortBy,
  CrawlStatusEnum,
  CrawlStatusRow,
} from './types'; // Only need crawl types here now
import { crawlStatusService } from '../services/crawlStatusService'; // Import crawl status service
import { commentService } from '../services/commentService'; // Import comment service
import {
  SortBy,
  getInitialCrawlData,
  fetchCommentPageData,
  YoutubeComment,
} from '../youtube/comment-downloader';
// --- End Comment Downloader Imports ---

// Define Event Schemas
type Events = {
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

// Create a client to send and receive events
export const inngest = new Inngest({
  id: "vigie",
  schemas: new EventSchemas().fromRecord<Events>(),
});

// --- Inngest Functions ---

const triggerCommentCrawl = inngest.createFunction(
  { id: "trigger-youtube-comment-crawl", concurrency: 5 }, // Adjust concurrency
  { event: "youtube/comment.crawl.trigger" },
  // Let TypeScript infer the context type, which includes logger
  async ({ event, step, logger }) => {
    const { videoId, sortBy } = event.data;
    const sortByString = sortBy === SortBy.RECENT ? CrawlSortBy.RECENT : CrawlSortBy.POPULAR;
    logger.info(`Triggering crawl for video ${videoId}, sort by ${sortByString}`);

    // 1. Check existing crawl status using service
    let crawl: CrawlStatusRow | null = await step.run("check-existing-crawl", async () => {
        try {
            return await crawlStatusService.findExistingCrawl(videoId, sortByString);
        } catch (error) {
            logger.error("Error checking existing crawl via service", { error });
            throw error; // Throw to let Inngest handle retry
        }
    });

    let crawlId: number; // Should always be defined after check/create
    let initialContinuationToken: string | null = null;
    let needsInitialFetch = false;
    let ytcfg: any = null; // To store ytcfg if needed across steps

    if (!crawl) {
      logger.info(`No existing crawl found for ${videoId} (${sortByString}). Creating new record.`);
      // 2a. Create new crawl record using service
      crawl = await step.run("create-crawl-record", async () => {
          try {
              return await crawlStatusService.createCrawlRecord(videoId, sortByString);
          } catch (error) {
              logger.error("Error creating crawl record via service", { error });
              throw error;
          }
      });
      crawlId = crawl.crawl_id;
      needsInitialFetch = true;
    } else {
        crawlId = crawl.crawl_id;
        logger.info(`Existing crawl found (ID: ${crawlId}, Status: ${crawl.status}) for ${videoId} (${sortByString}).`);
        // 2b. Handle existing crawl logic
        if (crawl.status === CrawlStatusEnum.COMPLETED || crawl.status === CrawlStatusEnum.FAILED) {
            // Simple restart logic: always restart completed/failed crawls when triggered
            logger.info(`Restarting ${crawl.status} crawl (ID: ${crawlId}).`);
            await step.run("restart-crawl", async () => {
                try {
                    await crawlStatusService.restartCrawl(crawlId);
                } catch (error) {
                    logger.error("Error restarting crawl via service", { error });
                    throw error;
                }
            });
            needsInitialFetch = true; // Need to get the *first* page token again
        } else if (crawl.status === CrawlStatusEnum.IN_PROGRESS || crawl.status === CrawlStatusEnum.PENDING) {
            // Already running or queued, log and exit
            logger.warn(`Crawl ${crawlId} for ${videoId} (${sortByString}) is already ${crawl.status}. Skipping trigger.`);
            return { status: "Skipped", reason: `Already ${crawl.status}` };
        }
    }

    if (needsInitialFetch) {
        // 3. Get initial ytcfg and continuation token
        logger.info(`Performing initial data fetch for crawl ${crawlId}.`);
        try {
            // *** Assumes getInitialCrawlData is refactored in comment-downloader.ts ***
            // *** This function needs to exist and be imported correctly ***
            const initialData = await step.run("get-initial-crawl-data", async () => {
                 return await getInitialCrawlData(videoId, sortBy); // Use actual call
            });

            initialContinuationToken = initialData.continuationToken;
            ytcfg = initialData.ytcfg; // Store ytcfg if needed later

            if (!initialContinuationToken) {
                logger.warn(`Initial fetch for crawl ${crawlId} returned no continuation token. Marking as complete.`);
                await step.run("mark-crawl-as-completed-no-initial-token", async () => {
                    // No need to log error here, service handles it
                    await crawlStatusService.markCrawlCompleteNoToken(crawlId);
                });
                return { status: "Completed", reason: "No initial continuation token" };
            }

            logger.info(`Initial token and ytcfg obtained for crawl ${crawlId}. Updating record.`);
            // Store initial token and ytcfg using service
            await step.run("update-crawl-with-initial-token-and-ytcfg", async () => {
                try {
                    await crawlStatusService.updateCrawlWithInitialToken(crawlId, initialContinuationToken!, ytcfg);
                } catch (error) {
                    logger.error("Error updating crawl with initial token via service", { error });
                    throw error;
                }
            });

        } catch (error: any) {
            const errorMessage = `Initial fetch failed: ${error.message}`;
            logger.error(`Failed to get initial data for crawl ${crawlId}: ${errorMessage}`, { error });
            await step.run("mark-crawl-as-failed-initial", async () => {
                // Service handles logging internal errors
                await crawlStatusService.markCrawlFailed(crawlId, errorMessage);
            });
            // Do not throw here, just mark as failed and return
            return { status: "Failed", reason: errorMessage };
        }
    } else {
        // Use existing token and ytcfg if resuming a PENDING crawl that wasn't COMPLETED/FAILED
        initialContinuationToken = crawl.continuation_token;
        ytcfg = crawl.ytcfg; // Load ytcfg from the existing crawl record
        logger.info(`Resuming crawl ${crawlId} with existing token and ytcfg.`);
        if (!ytcfg) {
            // This might happen if the crawl was created before ytcfg was stored,
            // or if it was cleared during a restart. We might need to fetch it again.
            // For now, log a warning. Fetching logic might need adjustment if ytcfg is strictly required later.
            logger.warn(`Resuming crawl ${crawlId} but ytcfg is missing from the database record.`);
            // Optionally, attempt to fetch it again here if critical for the *first* page fetch after resume
        }
    }

    // 4. Trigger the first (or next) page fetch
    if (initialContinuationToken) {
        logger.info(`Sending event to fetch first/next page for crawl ${crawlId}.`);
        await step.sendEvent("send-fetch-page-event", {
            name: "youtube/comment.page.fetch",
            data: { crawlId }, // Pass crawlId, fetchCommentPage will get token from DB
        });
        return { status: "Triggered", crawlId };
    } else {
        // This case should ideally be handled above (e.g., no initial token found)
        // Or if resuming a crawl that somehow lost its token
        logger.warn(`Crawl ${crawlId} has no continuation token to proceed. Marking as complete.`);
        await step.run("mark-crawl-as-completed-no-token-final", async () => {
            // Service handles logging internal errors
            await crawlStatusService.markCrawlCompleteNoToken(crawlId);
        });
        return { status: "Completed", reason: "No continuation token found to initiate fetch" };
    }
  }
);

const fetchCommentPage = inngest.createFunction(
  { id: "fetch-youtube-comment-page", concurrency: 10, retries: 5 }, // Adjust concurrency & retries
  { event: "youtube/comment.page.fetch" },
   // Let TypeScript infer the context type, which includes logger
  async ({ event, step, logger }) => {
    const { crawlId } = event.data;
    logger.info(`Fetching comment page for crawl ${crawlId}.`);

    // 1. Get current crawl status and token using service
    let crawl: CrawlStatusRow;
    try {
        crawl = await step.run("get-crawl-details", async () => {
            return await crawlStatusService.getCrawlDetails(crawlId);
        });
    } catch (error: any) {
        // Handle case where crawl is not found specifically? Service throws currently.
        logger.error(`Failed to get crawl details for ${crawlId}: ${error.message}`, { error });
        // If it's a "not found" error, maybe return Aborted? Otherwise, rethrow for retry.
        // For now, rethrow all errors from service.
        throw error;
    }

    // Validate crawl state
    if (crawl.status !== CrawlStatusEnum.PENDING && crawl.status !== CrawlStatusEnum.IN_PROGRESS) { // Allow retry if IN_PROGRESS
      logger.warn(`Skipping fetch for crawl ${crawlId}. Status is ${crawl.status}.`);
      return { status: "Skipped", reason: `Invalid status: ${crawl.status}` };
    }
     if (!crawl.continuation_token) {
        logger.warn(`Crawl ${crawlId} is ${crawl.status} but has no continuation token. Marking complete.`);
        await step.run("mark-crawl-completed-no-token-fetch", async () => {
            // Service handles logging internal errors
            await crawlStatusService.markCrawlCompleteNoToken(crawlId);
        });
        return { status: "Completed", reason: "No continuation token" };
    }

    const currentToken = crawl.continuation_token;
    const ytcfgForFetch = crawl.ytcfg; // Retrieve ytcfg from the fetched crawl record

    if (!ytcfgForFetch) {
        // If ytcfg is missing at this stage, it's likely an issue.
        // Decide how to handle: fail, log, or attempt recovery.
        // For now, log an error and potentially fail the step.
        logger.error(`Cannot proceed with fetch for crawl ${crawlId}: ytcfg is missing from database record.`);
        // Option 1: Throw an error to fail the step (recommended if ytcfg is essential)
        throw new Error(`ytcfg is missing for crawl ${crawlId}`);
        // Option 2: Log and attempt to continue without it (if fetchCommentPageData can handle null ytcfg)
        // logger.warn(`Proceeding with fetch for crawl ${crawlId} without ytcfg.`);
    }

    // 2. Update status to IN_PROGRESS using service
    await step.run("set-crawl-in-progress", async () => {
        try {
            await crawlStatusService.setCrawlInProgress(crawlId);
        } catch (error) {
            logger.error("Error setting crawl status to IN_PROGRESS via service", { error });
            throw error;
        }
    });

    try {
      // 3. Fetch comment page data
      logger.info(`Calling fetchCommentPageData for crawl ${crawlId} with token.`);
      // *** Assumes fetchCommentPageData is refactored in comment-downloader.ts ***
      // *** This function needs to exist and be imported correctly ***
      const pageData = await step.run("fetch-comment-page-data", async () => {
         // Pass the retrieved ytcfg to the function
         return await fetchCommentPageData(currentToken, ytcfgForFetch);
      });

      const { comments, nextContinuationToken } = pageData;
      logger.info(`Fetched ${comments.length} comments for crawl ${crawlId}. Next token: ${nextContinuationToken ? 'Yes' : 'No'}.`);

      // 4. Process comments using service
      if (comments.length > 0) {
          await step.run("process-comments-batch", async () => {
              logger.debug(`Processing ${comments.length} comments for crawl ${crawlId}.`);
              // The service handles individual comment errors internally for now
              await commentService.processCommentBatch(comments, crawl.video_id);
              // If processCommentBatch threw an error, it would fail the step here.
          });
      }

      // 5. Update crawl status based on outcome using service
      if (nextContinuationToken) {
        // More pages exist
        logger.info(`Updating crawl ${crawlId} status to PENDING for next page.`);
        await step.run("update-crawl-next-page", async () => {
            try {
                await crawlStatusService.updateCrawlNextPage(crawlId, nextContinuationToken);
            } catch (error) {
                logger.error("Error updating crawl status for next page via service", { error });
                throw error;
            }
        });

        // Trigger next page fetch
        logger.info(`Sending event to fetch next page for crawl ${crawlId}.`);
        await step.sendEvent("send-next-page-event", {
          name: "youtube/comment.page.fetch",
          data: { crawlId },
        });
         return { status: "Page Processed", nextPage: true, commentsProcessed: comments.length };
      } else {
        // No more pages, crawl complete
        logger.info(`Crawl ${crawlId} completed. No next continuation token.`);
        await step.run("mark-crawl-completed", async () => {
            try {
                await crawlStatusService.markCrawlCompleted(crawlId);
            } catch (error) {
                logger.error("Error marking crawl as completed via service", { error });
                throw error;
            }
        });
        return { status: "Completed", nextPage: false, commentsProcessed: comments.length };
      }

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error during page fetch/process';
      logger.error(`Failed to fetch/process page for crawl ${crawlId}: ${errorMessage}`, { error });
      // Mark as FAILED using service, Inngest will handle retries
      await step.run("mark-crawl-failed", async () => {
          // Service handles logging internal errors
          await crawlStatusService.markCrawlFailed(crawlId, errorMessage);
      });
      // Re-throw the original error to signal failure to Inngest for retry
      throw error; // Ensure the original error is thrown for Inngest retry logic
    }
  }
);

// Export the functions
export const functions = [triggerCommentCrawl, fetchCommentPage];
