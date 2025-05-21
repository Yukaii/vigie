// Example Cloudflare Worker implementation using YouTube with proxies
import { Env } from './types';
import { 
  configureProxies, 
  setProxyEnabled, 
  ProxyProviderType, 
  ProxyRotationStrategy, 
  ProxyProvider 
} from './youtube/proxy-config';
import { fetchYoutubeVideoMeta } from './youtube/video-meta-extract';
import { getComments, SortBy, YoutubeComment } from './youtube/comment-downloader';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Parse the URL and query parameters
      const url = new URL(request.url);
      const videoId = url.searchParams.get('videoId');
      const commentLimit = parseInt(url.searchParams.get('commentLimit') || '20', 10);
      
      // Configure proxies from environment variables
      // Check for multiple proxy configuration first
      if (env.PROXY_CONFIG && typeof env.PROXY_CONFIG === 'string') {
        try {
          // Parse the JSON configuration for multiple proxies
          const proxyConfig = JSON.parse(env.PROXY_CONFIG);
          
          // Create the provider list
          const providers: ProxyProvider[] = [];
          
          // Add each provider from the configuration
          if (Array.isArray(proxyConfig.providers)) {
            proxyConfig.providers.forEach((provider: any) => {
              providers.push({
                url: provider.url,
                username: provider.username,
                password: provider.password,
                type: provider.type || ProxyProviderType.DEFAULT,
                weight: provider.weight || 1,
                tags: provider.tags || [],
                maxConsecutiveUses: provider.maxConsecutiveUses || 0
              });
            });
            
            // Configure with specified rotation strategy
            const rotationStrategy = proxyConfig.rotationStrategy || ProxyRotationStrategy.ROUND_ROBIN;
            configureProxies(providers, rotationStrategy);
            setProxyEnabled(true);
            console.log(`Multiple proxies configured (${providers.length}) with ${rotationStrategy} rotation`);
          }
        } catch (e) {
          console.error('Error parsing PROXY_CONFIG:', e);
        }
      } 
      // Fall back to legacy single proxy configuration
      else if (env.PROXY_URL) {
        configureProxies([{
          url: env.PROXY_URL,
          username: env.PROXY_USERNAME,
          password: env.PROXY_PASSWORD,
          type: ProxyProviderType.DEFAULT
        }]);
        setProxyEnabled(true);
        console.log('Single proxy configured with legacy env variables');
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