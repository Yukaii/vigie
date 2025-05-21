// Example Cloudflare Worker implementation using YouTube with proxies
import { Env } from './types';
import { configureProxies, setProxyEnabled } from './youtube/proxy-config';
import { fetchYoutubeVideoMeta } from './youtube/video-meta-extract';
import { getComments, SortBy, YoutubeComment } from './youtube/comment-downloader';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Parse the URL and query parameters
      const url = new URL(request.url);
      const videoId = url.searchParams.get('videoId');
      const commentLimit = parseInt(url.searchParams.get('commentLimit') || '20', 10);
      
      // Configure proxy if environment variables are set
      if (env.PROXY_URL) {
        configureProxies([{
          url: env.PROXY_URL,
          username: env.PROXY_USERNAME,
          password: env.PROXY_PASSWORD
        }]);
        setProxyEnabled(true);
        console.log('Proxy enabled for YouTube requests');
      }

      // Return error if no video ID provided
      if (!videoId) {
        return new Response(JSON.stringify({
          error: 'Missing videoId parameter'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Fetch video metadata
      const metadata = await fetchYoutubeVideoMeta(videoId);
      
      // Fetch comments
      const comments: YoutubeComment[] = [];
      for await (const comment of getComments(videoId, SortBy.RECENT, undefined, 100)) {
        comments.push(comment);
        if (comments.length >= commentLimit) break;
      }

      // Return metadata and comments
      return new Response(JSON.stringify({
        video: metadata,
        comments: comments
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (error) {
      console.error('Error processing request:', error);
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};