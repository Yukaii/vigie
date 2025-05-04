import { Inngest, Context, EventSchemas } from "inngest";
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  CrawlSortBy,
  CrawlStatusEnum,
  CrawlStatusRow,
  CommentsRow,
  CommentUpdatesRow,
} from './types'; // Import types from the new file

// --- Database Setup ---
// Ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase URL and Anon Key must be provided in environment variables.");
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);
// --- End Database Setup ---

// --- Comment Downloader Imports (Requires Refactoring) ---
import {
  SortBy, // Assuming SortBy enum exists in comment-downloader
  getInitialCrawlData, // Gets ytcfg, first continuation -> { continuationToken: string | null, ytcfg: any }
  fetchCommentPageData, // Fetches single page -> { comments: YoutubeComment[], nextContinuationToken: string | null }
  YoutubeComment, // Assuming YoutubeComment type exists in comment-downloader
} from '../youtube/comment-downloader'; // Adjust path as needed
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

    // 1. Check existing crawl status in Supabase
    let crawl: CrawlStatusRow | null = await step.run("check-existing-crawl", async () => {
        const { data, error } = await supabase
          .from('crawl_status')
          .select('*')
          .eq('video_id', videoId)
          .eq('sort_by', sortByString)
          .maybeSingle(); // Use maybeSingle to return null if not found

        if (error) {
          logger.error("Error checking existing crawl", { error });
          throw error; // Throw to let Inngest handle retry
        }
        return data;
      });

    let crawlId: number | undefined;
    let initialContinuationToken: string | null = null;
    let needsInitialFetch = false;
    let ytcfg: any = null; // To store ytcfg if needed across steps

    if (!crawl) {
      logger.info(`No existing crawl found for ${videoId} (${sortByString}). Creating new record.`);
      // 2a. Create new crawl record in Supabase
      const { data: newCrawlData, error: insertError } = await step.run("create-crawl-record", async () => {
        return await supabase
          .from('crawl_status')
          .insert({
            video_id: videoId,
            sort_by: sortByString,
            status: CrawlStatusEnum.PENDING,
            ytcfg: null, // Initialize ytcfg as null
            // created_at, updated_at are handled by DB defaults/triggers
          })
          .select() // Select the newly inserted row
          .single(); // Expect a single row back
      });

      if (insertError || !newCrawlData) {
        logger.error("Error creating crawl record", { error: insertError });
        throw insertError || new Error("Failed to create crawl record and get result.");
      }
      crawl = newCrawlData as CrawlStatusRow; // Assign the newly created crawl data
      crawlId = crawl.crawl_id;
      needsInitialFetch = true;
    } else {
        crawlId = crawl.crawl_id;
        logger.info(`Existing crawl found (ID: ${crawlId}, Status: ${crawl.status}) for ${videoId} (${sortByString}).`);
        // 2b. Handle existing crawl logic
        if (crawl.status === CrawlStatusEnum.COMPLETED || crawl.status === CrawlStatusEnum.FAILED) {
            // Simple restart logic: always restart completed/failed crawls when triggered
            logger.info(`Restarting ${crawl.status} crawl (ID: ${crawlId}).`);
            const { error: updateError } = await step.run("update-crawl-status-to-pending", async () => {
                return await supabase
                  .from('crawl_status')
                  // Clear token and ytcfg on restart
                  .update({ status: CrawlStatusEnum.PENDING, continuation_token: null, ytcfg: null, error_message: null, updated_at: new Date().toISOString() })
                  .eq('crawl_id', crawlId);
            });
            if (updateError) {
                logger.error("Error updating crawl status to PENDING", { error: updateError });
                throw updateError;
            }
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
                 const { error: updateError } = await step.run("mark-crawl-as-completed-no-initial-token", async () => {
                    return await supabase
                      .from('crawl_status')
                      .update({ status: CrawlStatusEnum.COMPLETED, updated_at: new Date().toISOString() })
                      .eq('crawl_id', crawlId);
                });
                 if (updateError) logger.error("Error marking crawl as completed (no initial token)", { error: updateError });
                return { status: "Completed", reason: "No initial continuation token" };
            }

            logger.info(`Initial token and ytcfg obtained for crawl ${crawlId}. Updating record.`);
            // Store initial token and ytcfg
            const { error: updateTokenError } = await step.run("update-crawl-with-initial-token-and-ytcfg", async () => {
                return await supabase
                  .from('crawl_status')
                  .update({
                      continuation_token: initialContinuationToken,
                      ytcfg: ytcfg, // Store the fetched ytcfg
                      updated_at: new Date().toISOString()
                    })
                  .eq('crawl_id', crawlId);
            });
            if (updateTokenError) {
                logger.error("Error updating crawl with initial token", { error: updateTokenError });
                throw updateTokenError;
            }

        } catch (error: any) {
            logger.error(`Failed to get initial data for crawl ${crawlId}: ${error.message}`, { error });
            const { error: failError } = await step.run("mark-crawl-as-failed-initial", async () => {
                return await supabase
                  .from('crawl_status')
                  .update({ status: CrawlStatusEnum.FAILED, error_message: `Initial fetch failed: ${error.message}`, updated_at: new Date().toISOString() })
                  .eq('crawl_id', crawlId);
            });
            if (failError) logger.error("Error marking crawl as failed after initial fetch error", { error: failError });
            // Do not throw here, just mark as failed and return
            return { status: "Failed", reason: "Initial data fetch error" };
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
         const { error: updateError } = await step.run("mark-crawl-as-completed-no-token-final", async () => {
                return await supabase
                  .from('crawl_status')
                  .update({ status: CrawlStatusEnum.COMPLETED, updated_at: new Date().toISOString() })
                  .eq('crawl_id', crawlId);
            });
        if (updateError) logger.error("Error marking crawl as completed (no token final)", { error: updateError });
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

    // 1. Get current crawl status and token from Supabase
    const crawl: CrawlStatusRow | null = await step.run("get-crawl-details", async () => {
        const { data, error } = await supabase
          .from('crawl_status')
          .select('*')
          .eq('crawl_id', crawlId)
          .single(); // Use single as we expect it to exist at this point

        if (error) {
          logger.error(`Error fetching crawl details for ${crawlId}`, { error });
          // If error is PgrstError with code 'PGRST116' (Not Found), handle specifically?
          throw error;
        }
        return data;
    });

    // Validate crawl state
    if (!crawl) {
        // Should have been caught by the single() error, but double-check
        logger.error(`Crawl record ${crawlId} not found. Aborting fetch.`);
        return { status: "Aborted", reason: "Crawl record not found" };
    }
    if (crawl.status !== CrawlStatusEnum.PENDING && crawl.status !== CrawlStatusEnum.IN_PROGRESS) { // Allow retry if IN_PROGRESS
      logger.warn(`Skipping fetch for crawl ${crawlId}. Status is ${crawl.status}.`);
      return { status: "Skipped", reason: `Invalid status: ${crawl.status}` };
    }
     if (!crawl.continuation_token) {
        logger.warn(`Crawl ${crawlId} is ${crawl.status} but has no continuation token. Marking complete.`);
        const { error: updateError } = await step.run("mark-crawl-completed-no-token-fetch", async () => {
            return await supabase
              .from('crawl_status')
              .update({ status: CrawlStatusEnum.COMPLETED, updated_at: new Date().toISOString() })
              .eq('crawl_id', crawlId);
        });
        if (updateError) logger.error("Error marking crawl as completed (no token fetch)", { error: updateError });
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

    // 2. Update status to IN_PROGRESS
    const { error: progressUpdateError } = await step.run("set-crawl-in-progress", async () => {
        return await supabase
          .from('crawl_status')
          .update({ status: CrawlStatusEnum.IN_PROGRESS, last_attempted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('crawl_id', crawlId);
    });
    if (progressUpdateError) {
        logger.error("Error setting crawl status to IN_PROGRESS", { error: progressUpdateError });
        throw progressUpdateError;
    }

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

      // 4. Process comments (Sequentially, not transactional in Supabase JS client)
      if (comments.length > 0) {
          await step.run("process-comments", async () => {
              logger.debug(`Processing ${comments.length} comments for crawl ${crawlId}.`);
              for (const comment of comments) {
                  // Prepare data for insertion/update
                  let publishedAtIso: string | null = null;
                  try {
                      // TODO: Implement robust date parsing for comment.time
                      // publishedAtIso = parseRelativeDate(comment.time)?.toISOString();
                  } catch (e) { logger.warn(`Could not parse time string: ${comment.time}`); }

                  const commentData: Omit<CommentsRow, 'first_seen_at' | 'published_at'> & { published_at: string | null } = {
                      comment_id: comment.cid, // Set primary key for upsert
                      video_id: crawl.video_id,
                      parent_comment_id: comment.reply ? comment.cid.substring(0, comment.cid.lastIndexOf('.')) : null,
                      text: comment.text,
                      published_at: publishedAtIso,
                      author_display_name: comment.author,
                      author_channel_id: comment.channel,
                      author_photo_url: comment.photo,
                      votes: parseInt(comment.votes, 10) || 0,
                      reply_count: comment.replies,
                      is_hearted: comment.heart,
                      is_paid: !!comment.paid,
                      raw_time_string: comment.time,
                      last_updated_at: new Date().toISOString(),
                  };

                  // --- Upsert Logic using Supabase ---
                  // 1. Try to fetch existing
                  const { data: existing, error: fetchError } = await supabase
                      .from('comments')
                      .select('text, votes, reply_count, is_hearted') // Select fields for comparison
                      .eq('comment_id', comment.cid)
                      .maybeSingle();

                  if (fetchError) {
                      logger.error(`Error fetching existing comment ${comment.cid}`, { error: fetchError });
                      throw fetchError; // Fail the step on DB error
                  }

                  if (existing) {
                      // 2a. Update if exists and changed
                      const updates: Partial<CommentsRow> = {};
                      const changes: CommentUpdatesRow[] = [];

                      if (existing.text !== commentData.text) {
                          updates.text = commentData.text;
                          changes.push({ comment_id: comment.cid, attribute_name: 'text', old_value: existing.text, new_value: commentData.text });
                      }
                      if (existing.votes !== commentData.votes) {
                          updates.votes = commentData.votes;
                          changes.push({ comment_id: comment.cid, attribute_name: 'votes', old_value: String(existing.votes), new_value: String(commentData.votes) });
                      }
                      // Add other fields: reply_count, is_hearted etc.

                      if (Object.keys(updates).length > 0) {
                          logger.debug(`Updating comment ${comment.cid}`);
                          updates.last_updated_at = new Date().toISOString(); // Ensure update timestamp is set
                          const { error: updateError } = await supabase
                              .from('comments')
                              .update(updates)
                              .eq('comment_id', comment.cid);

                          if (updateError) {
                              logger.error(`Error updating comment ${comment.cid}`, { error: updateError });
                              throw updateError;
                          }

                          // Insert into comment_updates (fire and forget errors for this for now?)
                          const { error: updateLogError } = await supabase
                              .from('comment_updates')
                              .insert(changes);
                          if (updateLogError) {
                              logger.warn(`Error inserting comment_updates for ${comment.cid}`, { error: updateLogError });
                              // Decide if this should be a fatal error for the step
                          }
                      }
                  } else {
                      // 2b. Insert if not exists
                      logger.debug(`Inserting new comment ${comment.cid}`);
                      const { error: insertError } = await supabase
                          .from('comments')
                          .insert({
                              ...commentData,
                              first_seen_at: new Date().toISOString(), // Set first_seen_at only on insert
                          });
                      if (insertError) {
                          logger.error(`Error inserting comment ${comment.cid}`, { error: insertError });
                          // Handle potential duplicate key errors if fetch failed but insert happens?
                          throw insertError;
                      }
                  }
                  // --- End Upsert Logic ---
              } // End for loop
          }); // End step.run process-comments
      } // End if comments.length > 0

      // 5. Update crawl status based on outcome
      if (nextContinuationToken) {
        // More pages exist
        logger.info(`Updating crawl ${crawlId} status to PENDING for next page.`);
        const { error: updateNextError } = await step.run("update-crawl-next-page", async () => {
            return await supabase
              .from('crawl_status')
              .update({
                status: CrawlStatusEnum.PENDING,
                continuation_token: nextContinuationToken,
                last_successful_page_at: new Date().toISOString(),
                error_message: null, // Clear previous error on success
                updated_at: new Date().toISOString(),
              })
              .eq('crawl_id', crawlId);
        });
         if (updateNextError) {
            logger.error("Error updating crawl status for next page", { error: updateNextError });
            throw updateNextError;
         }

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
        const { error: updateCompleteError } = await step.run("mark-crawl-completed", async () => {
            return await supabase
              .from('crawl_status')
              .update({
                status: CrawlStatusEnum.COMPLETED,
                continuation_token: null, // Clear token
                last_successful_page_at: new Date().toISOString(),
                error_message: null, // Clear previous error on success
                updated_at: new Date().toISOString(),
              })
              .eq('crawl_id', crawlId);
        });
        if (updateCompleteError) {
            logger.error("Error marking crawl as completed", { error: updateCompleteError });
            throw updateCompleteError;
        }
        return { status: "Completed", nextPage: false, commentsProcessed: comments.length };
      }

    } catch (error: any) {
      logger.error(`Failed to fetch/process page for crawl ${crawlId}: ${error.message}`, { error });
      // Mark as FAILED, Inngest will handle retries
      const { error: failError } = await step.run("mark-crawl-failed", async () => {
          return await supabase
            .from('crawl_status')
            .update({
              status: CrawlStatusEnum.FAILED,
              error_message: error.message || 'Unknown error during page fetch/process',
              // Keep the problematic continuation_token
              updated_at: new Date().toISOString(),
            })
            .eq('crawl_id', crawlId);
      });
       if (failError) {
            // Log the error but don't throw again, let the original error propagate
            logger.error("Error marking crawl as failed after processing error", { error: failError });
       }
      // Re-throw the original error to signal failure to Inngest for retry
      throw error;
    }
  }
);

// Export the functions
export const functions = [triggerCommentCrawl, fetchCommentPage];
