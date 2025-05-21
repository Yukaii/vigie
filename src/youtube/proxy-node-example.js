// Example of using proxy configuration with Node.js

// Import the modules
const { configureProxies, setProxyEnabled } = require('./proxy-config');
const { fetchYoutubeVideoMeta } = require('./video-meta-extract');
const { getComments, SortBy } = require('./comment-downloader');

// Function to demonstrate proxy usage
async function demoProxyWithYouTube() {
  try {
    // Configure proxy - replace with your actual proxy information
    configureProxies([
      {
        url: process.env.PROXY_URL || 'http://your-proxy-url:port',
        username: process.env.PROXY_USERNAME,
        password: process.env.PROXY_PASSWORD
      }
    ]);
    
    // Enable proxy usage
    setProxyEnabled(true);
    console.log('Proxy configured and enabled.');
    
    // Test with a video ID (Rick Astley - Never Gonna Give You Up)
    const videoId = 'dQw4w9WgXcQ';
    
    console.log(`Fetching metadata for video ${videoId} using proxy...`);
    const metadata = await fetchYoutubeVideoMeta(videoId);
    console.log('Successfully retrieved video metadata:');
    console.log(`- Title: ${metadata.title}`);
    console.log(`- Channel: ${metadata.channel_title} (${metadata.channel_id})`);
    
    console.log('\nFetching comments...');
    const comments = [];
    let count = 0;
    
    // Create an async iterator to get comments
    for await (const comment of getComments(videoId, SortBy.RECENT)) {
      comments.push(comment);
      count++;
      
      if (count >= 10) {
        break; // Just get 10 comments for the demo
      }
    }
    
    console.log(`Successfully fetched ${comments.length} comments.`);
    console.log('\nFirst comment:');
    console.log(`- Author: ${comments[0]?.author}`);
    console.log(`- Text: ${comments[0]?.text}`);
    console.log(`- Votes: ${comments[0]?.votes}`);
    
    return { metadata, comments };
    
  } catch (error) {
    console.error('Error in proxy demo:', error);
    throw error;
  }
}

// Run the demo if this script is executed directly
if (require.main === module) {
  demoProxyWithYouTube()
    .then(() => console.log('\nDemo completed successfully!'))
    .catch(error => {
      console.error('\nDemo failed:', error);
      process.exit(1);
    });
}

module.exports = { demoProxyWithYouTube };