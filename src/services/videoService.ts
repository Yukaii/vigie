import type { DbClient } from "../db";
import {
  type YoutubeVideoMeta,
  fetchYoutubeVideoMeta,
} from "../youtube/video-meta-extract";

export class VideoService {
  private db: DbClient;

  constructor(dbClient: DbClient) {
    this.db = dbClient;
  }

  async ensureVideoWithMeta(videoId: string): Promise<void> {
    const { data: videoData, error: videoError } = await this.db
      .from("videos")
      .select("video_id")
      .eq("video_id", videoId)
      .maybeSingle();

    if (videoError) {
      console.error("Error checking video existence", { videoError });
      throw videoError;
    }

    if (!videoData) {
      console.info(
        `Video ${videoId} not found in database. Fetching metadata from YouTube.`,
      );
      const meta: YoutubeVideoMeta = await fetchYoutubeVideoMeta(videoId);
      console.info(
        `Fetched metadata for video ${videoId}: title="${meta.title}", channel_id="${meta.channel_id}", channel_title="${meta.channel_title}"`,
      );
      const { error: insertVideoError } = await this.db.from("videos").insert({
        video_id: meta.video_id,
        title: meta.title,
        channel_id: meta.channel_id,
        channel_title: meta.channel_title,
      });
      if (insertVideoError) {
        console.error("Error inserting video record with metadata", {
          insertVideoError,
        });
        throw insertVideoError;
      }
    }
  }
}
