import { DbClient } from '../db';
import {
  CrawlSortBy,
  CrawlStatusRow,
} from '../inngest/types';

export class CrawlStatusService {
  private db: DbClient;

  constructor(dbClient: DbClient) {
    this.db = dbClient;
  }

  async findExistingCrawl(videoId: string, sortBy: CrawlSortBy): Promise<CrawlStatusRow | null> {
    const { data, error } = await this.db
      .from('crawl_status')
      .select('*')
      .eq('video_id', videoId)
      .eq('sort_by', sortBy)
      .maybeSingle();

    if (error) {
      console.error("Error checking existing crawl", { error });
      throw error;
    }
    return data;
  }

  async createCrawlRecord(videoId: string, sortBy: CrawlSortBy): Promise<CrawlStatusRow> {
    // Ensure video exists in videos table
    const { data: videoData, error: videoError } = await this.db
      .from('videos')
      .select('video_id')
      .eq('video_id', videoId)
      .maybeSingle();

    if (videoError) {
      console.error("Error checking video existence", { videoError });
      throw videoError;
    }

    if (!videoData) {
      // Insert minimal video record
      const { error: insertVideoError } = await this.db
        .from('videos')
        .insert({ video_id: videoId });

      if (insertVideoError) {
        console.error("Error inserting video record", { insertVideoError });
        throw insertVideoError;
      }
    }

    const { data, error } = await this.db
      .from('crawl_status')
      .insert({
        video_id: videoId,
        sort_by: sortBy,
        ytcfg: null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("Error creating crawl record", { error });
      throw error || new Error("Failed to create crawl record and get result.");
    }
    return data as CrawlStatusRow;
  }

  // No-op: status orchestration is handled by Inngest, not the DB
  async restartCrawl(crawlId: number): Promise<void> {
    await this.db
      .from('crawl_status')
      .update({
        continuation_token: null,
        ytcfg: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);
  }

  async updateCrawlWithInitialToken(crawlId: number, token: string, ytcfg: any): Promise<void> {
    const { error } = await this.db
      .from('crawl_status')
      .update({
        continuation_token: token,
        ytcfg: ytcfg,
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);

    if (error) {
      console.error("Error updating crawl with initial token and ytcfg", { error });
      throw error;
    }
  }

  async markCrawlCompleteNoToken(crawlId: number): Promise<void> {
     await this.db
      .from('crawl_status')
      .update({ updated_at: new Date().toISOString() })
      .eq('crawl_id', crawlId);
  }

  async markCrawlFailed(crawlId: number, errorMessage: string): Promise<void> {
    await this.db
      .from('crawl_status')
      .update({
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);
  }

  async getCrawlDetails(crawlId: number): Promise<CrawlStatusRow> {
    const { data, error } = await this.db
      .from('crawl_status')
      .select('*')
      .eq('crawl_id', crawlId)
      .single();

    if (error || !data) {
      console.error(`Error fetching crawl details for ${crawlId}`, { error });
      throw error || new Error(`Crawl record ${crawlId} not found.`);
    }
    return data;
  }

  // No-op: status orchestration is handled by Inngest, not the DB
  async setCrawlInProgress(crawlId: number): Promise<void> {
    await this.db
      .from('crawl_status')
      .update({
        last_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);
  }

  async updateCrawlNextPage(crawlId: number, nextToken: string): Promise<void> {
    await this.db
      .from('crawl_status')
      .update({
        continuation_token: nextToken,
        last_successful_page_at: new Date().toISOString(),
        error_message: null, // Clear previous error on success
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);
  }

  async markCrawlCompleted(crawlId: number): Promise<void> {
    await this.db
      .from('crawl_status')
      .update({
        continuation_token: null, // Clear token
        last_successful_page_at: new Date().toISOString(),
        error_message: null, // Clear previous error on success
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);
  }
}
