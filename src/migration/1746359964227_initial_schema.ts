import { type Kysely, sql, type Migration } from "kysely";
import type { Database } from "../types";

export async function up(db: Kysely<Database>): Promise<void> {
  // Create ENUM types first as they might be used in table definitions
  await db.schema
    .createType("crawl_sort_by")
    .asEnum(["POPULAR", "RECENT"])
    .execute();

  // Removed crawl_job_status ENUM as status is no longer orchestrated in DB

  // Create videos table
  await db.schema
    .createTable("videos")
    .addColumn("video_id", "varchar(11)", (col) => col.primaryKey())
    .addColumn("title", "text")
    .addColumn("channel_id", "varchar(24)")
    .addColumn("channel_title", "text")
    .addColumn("first_fetched_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("last_fetched_at", "timestamptz")
    .execute();

  // Add index on videos.channel_id
  await db.schema
    .createIndex("idx_videos_channel_id")
    .on("videos")
    .column("channel_id")
    .execute();

  // Create comments table
  await db.schema
    .createTable("comments")
    .addColumn("comment_id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("video_id", "varchar(11)", (col) =>
      col.references("videos.video_id").onDelete("cascade").notNull(),
    )
    .addColumn("parent_comment_id", "varchar(255)", (col) =>
      col.references("comments.comment_id").onDelete("set null"),
    )
    .addColumn("text", "text", (col) => col.notNull())
    .addColumn("published_at", "timestamptz")
    .addColumn("author_display_name", "text")
    .addColumn("author_channel_id", "varchar(24)")
    .addColumn("author_photo_url", "text")
    .addColumn("votes", "integer", (col) => col.defaultTo(0))
    .addColumn("reply_count", "integer", (col) => col.defaultTo(0))
    .addColumn("is_hearted", "boolean", (col) => col.defaultTo(false))
    .addColumn("is_paid", "boolean", (col) => col.defaultTo(false))
    .addColumn("raw_time_string", "varchar(100)")
    .addColumn("first_seen_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("last_updated_at", "timestamptz")
    .execute();

  // Add indexes on comments table
  await db.schema
    .createIndex("idx_comments_video_id")
    .on("comments")
    .column("video_id")
    .execute();
  await db.schema
    .createIndex("idx_comments_author_channel_id")
    .on("comments")
    .column("author_channel_id")
    .execute();
  await db.schema
    .createIndex("idx_comments_published_at")
    .on("comments")
    .column("published_at")
    .execute();
  await db.schema
    .createIndex("idx_comments_parent_comment_id")
    .on("comments")
    .column("parent_comment_id")
    .execute();

  // Create comment_updates table
  await db.schema
    .createTable("comment_updates")
    // Using bigserial for potentially large number of updates
    .addColumn("update_id", "bigserial", (col) => col.primaryKey())
    .addColumn("comment_id", "varchar(255)", (col) =>
      col.references("comments.comment_id").onDelete("cascade").notNull(),
    )
    .addColumn("attribute_name", "varchar(50)", (col) => col.notNull())
    .addColumn("old_value", "text")
    .addColumn("new_value", "text")
    .addColumn("updated_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // Add indexes on comment_updates table
  await db.schema
    .createIndex("idx_comment_updates_comment_id")
    .on("comment_updates")
    .column("comment_id")
    .execute();
  await db.schema
    .createIndex("idx_comment_updates_attribute_name")
    .on("comment_updates")
    .column("attribute_name")
    .execute();

  // Create crawl_status table (status column removed)
  await db.schema
    .createTable("crawl_status")
    .addColumn("crawl_id", "bigserial", (col) => col.primaryKey())
    .addColumn("video_id", "varchar(11)", (col) =>
      col.references("videos.video_id").onDelete("cascade").notNull(),
    )
    .addColumn("sort_by", sql`crawl_sort_by`, (col) => col.notNull())
    .addColumn("continuation_token", "text")
    .addColumn("last_attempted_at", "timestamptz")
    .addColumn("last_successful_page_at", "timestamptz")
    .addColumn("error_message", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz")
    .addColumn("ytcfg", "jsonb")
    .addUniqueConstraint("uq_crawl_video_sort", ["video_id", "sort_by"])
    .execute();

  // Add index on crawl_status.video_id only (status index removed)
  await db.schema
    .createIndex("idx_crawl_status_video_id")
    .on("crawl_status")
    .column("video_id")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  // Drop tables in reverse order of creation, considering dependencies
  await db.schema.dropTable("crawl_status").ifExists().execute();
  await db.schema.dropTable("comment_updates").ifExists().execute();
  await db.schema.dropTable("comments").ifExists().execute();
  await db.schema.dropTable("videos").ifExists().execute();

  // Drop ENUM types after tables that use them are dropped
  // Removed: await db.schema.dropType('crawl_job_status').ifExists().execute();
  await db.schema.dropType("crawl_sort_by").ifExists().execute();
}
