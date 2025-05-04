import { supabase, DbClient } from '../db';
import {
  CrawlSortBy,
  CrawlStatusEnum,
  CrawlStatusRow,
} from '../inngest/types';

export class CrawlStatusService {
  private db: DbClient;

  constructor(dbClient: DbClient = supabase) {
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
    const { data, error } = await this.db
      .from('crawl_status')
      .insert({
        video_id: videoId,
        sort_by: sortBy,
        status: CrawlStatusEnum.PENDING,
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

  async restartCrawl(crawlId: number): Promise<void> {
    const { error } = await this.db
      .from('crawl_status')
      .update({
        status: CrawlStatusEnum.PENDING,
        continuation_token: null,
        ytcfg: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);

    if (error) {
      console.error("Error updating crawl status to PENDING for restart", { error });
      throw error;
    }
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
     const { error } = await this.db
      .from('crawl_status')
      .update({ status: CrawlStatusEnum.COMPLETED, updated_at: new Date().toISOString() })
      .eq('crawl_id', crawlId);

     if (error) {
        console.error("Error marking crawl as completed (no token)", { error });
        // Decide if this should throw or just log
        // throw error;
     }
  }

  async markCrawlFailed(crawlId: number, errorMessage: string): Promise<void> {
    const { error } = await this.db
      .from('crawl_status')
      .update({
        status: CrawlStatusEnum.FAILED,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);

    if (error) {
      console.error("Error marking crawl as failed", { error });
      // Log the error but don't throw again, let the original error propagate if called within a catch block
    }
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

  async setCrawlInProgress(crawlId: number): Promise<void> {
    const { error } = await this.db
      .from('crawl_status')
      .update({
        status: CrawlStatusEnum.IN_PROGRESS,
        last_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);

    if (error) {
      console.error("Error setting crawl status to IN_PROGRESS", { error });
      throw error;
    }
  }

  async updateCrawlNextPage(crawlId: number, nextToken: string): Promise<void> {
    const { error } = await this.db
      .from('crawl_status')
      .update({
        status: CrawlStatusEnum.PENDING,
        continuation_token: nextToken,
        last_successful_page_at: new Date().toISOString(),
        error_message: null, // Clear previous error on success
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);

    if (error) {
      console.error("Error updating crawl status for next page", { error });
      throw error;
    }
  }

  async markCrawlCompleted(crawlId: number): Promise<void> {
    const { error } = await this.db
      .from('crawl_status')
      .update({
        status: CrawlStatusEnum.COMPLETED,
        continuation_token: null, // Clear token
        last_successful_page_at: new Date().toISOString(),
        error_message: null, // Clear previous error on success
        updated_at: new Date().toISOString(),
      })
      .eq('crawl_id', crawlId);

    if (error) {
      console.error("Error marking crawl as completed", { error });
      throw error;
    }
  }
}

// Export a singleton instance
export const crawlStatusService = new CrawlStatusService();
