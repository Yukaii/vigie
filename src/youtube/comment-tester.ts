// Command-line tester for YouTube comment downloader

import { getCommentsFromUrl } from "./comment-downloader";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: bun run src/youtube/comment-tester.ts <youtube_url>");
    process.exit(1);
  }

  let count = 0;
  try {
    for await (const comment of getCommentsFromUrl(url)) {
      count++;
      console.log(`[${count}] (${comment.cid}) ${comment.author}: ${comment.text}`);
      if (count >= 10) break; // Limit output for demo
    }
    if (count === 0) {
      console.log("No comments found or comments are disabled.");
    }
  } catch (err) {
    console.error("Error fetching comments:", err);
    process.exit(2);
  }
}

main();
