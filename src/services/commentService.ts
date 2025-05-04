import { supabase, DbClient } from '../db';
import { CommentsRow, CommentUpdatesRow } from '../inngest/types';
import { YoutubeComment } from '../youtube/comment-downloader'; // Assuming YoutubeComment is exported

export class CommentService {
  private db: DbClient;

  constructor(dbClient: DbClient = supabase) {
    this.db = dbClient;
  }

  // TODO: Implement robust date parsing if needed
  // private parseRelativeDate(timeString: string): Date | null {
  //   // Placeholder for date parsing logic
  //   return null;
  // }

  async upsertComment(comment: YoutubeComment, videoId: string): Promise<void> {
    let publishedAtIso: string | null = null;
    try {
      // publishedAtIso = this.parseRelativeDate(comment.time)?.toISOString();
    } catch (e) {
      console.warn(`Could not parse time string: ${comment.time}`);
    }

    const commentData: Omit<CommentsRow, 'first_seen_at' | 'published_at'> & { published_at: string | null } = {
      comment_id: comment.cid,
      video_id: videoId,
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

    // --- Upsert Logic ---
    const { data: existing, error: fetchError } = await this.db
      .from('comments')
      .select('text, votes, reply_count, is_hearted') // Select fields for comparison
      .eq('comment_id', comment.cid)
      .maybeSingle();

    if (fetchError) {
      console.error(`Error fetching existing comment ${comment.cid}`, { error: fetchError });
      throw fetchError;
    }

    if (existing) {
      // Update if exists and changed
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
       if (existing.reply_count !== commentData.reply_count) {
        updates.reply_count = commentData.reply_count;
        changes.push({ comment_id: comment.cid, attribute_name: 'reply_count', old_value: String(existing.reply_count), new_value: String(commentData.reply_count) });
      }
       if (existing.is_hearted !== commentData.is_hearted) {
        updates.is_hearted = commentData.is_hearted;
        changes.push({ comment_id: comment.cid, attribute_name: 'is_hearted', old_value: String(existing.is_hearted), new_value: String(commentData.is_hearted) });
      }
      // Add other fields as needed

      if (Object.keys(updates).length > 0) {
        console.debug(`Updating comment ${comment.cid}`);
        updates.last_updated_at = new Date().toISOString();
        const { error: updateError } = await this.db
          .from('comments')
          .update(updates)
          .eq('comment_id', comment.cid);

        if (updateError) {
          console.error(`Error updating comment ${comment.cid}`, { error: updateError });
          throw updateError;
        }

        // Insert into comment_updates
        const { error: updateLogError } = await this.db
          .from('comment_updates')
          .insert(changes);
        if (updateLogError) {
          console.warn(`Error inserting comment_updates for ${comment.cid}`, { error: updateLogError });
          // Decide if this should be a fatal error
        }
      }
    } else {
      // Insert if not exists
      console.debug(`Inserting new comment ${comment.cid}`);
      const { error: insertError } = await this.db
        .from('comments')
        .insert({
          ...commentData,
          first_seen_at: new Date().toISOString(),
        });
      if (insertError) {
        console.error(`Error inserting comment ${comment.cid}`, { error: insertError });
        throw insertError;
      }
    }
  }

  async processCommentBatch(comments: YoutubeComment[], videoId: string): Promise<void> {
    // Simple sequential processing for now. Could be optimized with Promise.all
    // but be mindful of potential DB connection limits or rate limits.
    for (const comment of comments) {
      try {
        await this.upsertComment(comment, videoId);
      } catch (error) {
        // Log error for the specific comment but continue processing others
        console.error(`Failed to process comment ${comment.cid} for video ${videoId}:`, error);
        // Optionally, collect failed comment IDs to report/retry later
      }
    }
  }
}

// Export a singleton instance
export const commentService = new CommentService();
