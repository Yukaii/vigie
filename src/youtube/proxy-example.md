# YouTube Proxy Configuration Examples

This document provides examples on how to configure and use proxies with the YouTube video and comment downloader.

## Basic Configuration

```typescript
import { configureProxies, setProxyEnabled } from './proxy-config';

// Configure a single proxy
configureProxies([
  { 
    url: 'http://proxy.example.com:8080',
    username: 'username', // Optional
    password: 'password'  // Optional
  }
]);

// Enable proxy usage
setProxyEnabled(true);
```

## Multiple Proxies with Rotation

```typescript
import { configureProxies } from './proxy-config';

// Configure multiple proxies for automatic rotation
configureProxies([
  { url: 'http://proxy1.example.com:8080' },
  { url: 'http://proxy2.example.com:8080' },
  { url: 'http://proxy3.example.com:8080' }
]);
```

## Example with Proxy Services

Here are examples for popular proxy services:

### Webshare Proxy

```typescript
import { configureProxies } from './proxy-config';

configureProxies([
  {
    url: 'http://proxy.webshare.io:80',
    username: 'your-username',
    password: 'your-password'
  }
]);
```

### Bright Data (formerly Luminati)

```typescript
import { configureProxies } from './proxy-config';

configureProxies([
  {
    // Residential proxy example
    url: 'http://zproxy.lum-superproxy.io:22225',
    username: 'your-username-zone',
    password: 'your-password'
  }
]);
```

### Oxylabs

```typescript
import { configureProxies } from './proxy-config';

configureProxies([
  {
    url: 'http://proxy.oxylabs.io:8000',
    username: 'customer-username',
    password: 'password'
  }
]);
```

## Integration with Cloudflare Workers

When deploying to Cloudflare Workers, the proxy will be used through Cloudflare's proxy system:

```typescript
// wrangler.toml configuration example
// [vars]
// PROXY_URL = "http://proxy.example.com:8080"
// PROXY_USERNAME = "username"
// PROXY_PASSWORD = "password"

// In your Worker code:
import { configureProxies } from './youtube/proxy-config';

export default {
  async fetch(request, env, ctx) {
    // Configure proxy from environment variables
    if (env.PROXY_URL) {
      configureProxies([{
        url: env.PROXY_URL,
        username: env.PROXY_USERNAME,
        password: env.PROXY_PASSWORD
      }]);
    }
    
    // Your existing Worker code...
  }
};
```

## Testing Proxy Configuration

You can verify if your proxy is working correctly:

```typescript
import { configureProxies } from './youtube/proxy-config';
import { fetchYoutubeVideoMeta } from './youtube/video-meta-extract';

// Configure your proxy
configureProxies([
  { url: 'http://your-proxy.example.com:8080' }
]);

// Test fetching video metadata
async function testProxy() {
  try {
    const videoMeta = await fetchYoutubeVideoMeta('dQw4w9WgXcQ'); // Rick Astley
    console.log('Proxy working! Video title:', videoMeta.title);
  } catch (error) {
    console.error('Proxy test failed:', error);
  }
}

testProxy();
```