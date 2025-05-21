# YouTube Proxy Configuration Examples

This document provides examples on how to configure and use proxies with the YouTube video and comment downloader.

## Basic Configuration

```typescript
import { configureProxies, setProxyEnabled, ProxyProviderType } from './proxy-config';

// Configure a single proxy
configureProxies([
  { 
    url: 'http://proxy.example.com:8080',
    username: 'username', // Optional
    password: 'password', // Optional
    type: ProxyProviderType.DEFAULT
  }
]);

// Enable proxy usage
setProxyEnabled(true);
```

## Multiple Proxies with Rotation

```typescript
import { configureProxies, ProxyProviderType, ProxyRotationStrategy } from './proxy-config';

// Configure multiple proxies for automatic rotation
configureProxies([
  { url: 'http://proxy1.example.com:8080', type: ProxyProviderType.DEFAULT },
  { url: 'http://proxy2.example.com:8080', type: ProxyProviderType.DEFAULT },
  { url: 'http://proxy3.example.com:8080', type: ProxyProviderType.DEFAULT }
], ProxyRotationStrategy.ROUND_ROBIN);
```

## Advanced Rotation Strategies

```typescript
import { configureProxies, ProxyProviderType, ProxyRotationStrategy } from './proxy-config';

// Random rotation
configureProxies([
  { url: 'http://proxy1.example.com:8080', type: ProxyProviderType.DEFAULT },
  { url: 'http://proxy2.example.com:8080', type: ProxyProviderType.DEFAULT },
  { url: 'http://proxy3.example.com:8080', type: ProxyProviderType.DEFAULT }
], ProxyRotationStrategy.RANDOM);

// Weighted rotation (proxy1 used 3x more than others)
configureProxies([
  { url: 'http://proxy1.example.com:8080', type: ProxyProviderType.DEFAULT, weight: 3 },
  { url: 'http://proxy2.example.com:8080', type: ProxyProviderType.DEFAULT, weight: 1 },
  { url: 'http://proxy3.example.com:8080', type: ProxyProviderType.DEFAULT, weight: 1 }
], ProxyRotationStrategy.WEIGHTED);

// Sticky session (same proxy used for same domain)
configureProxies([
  { url: 'http://proxy1.example.com:8080', type: ProxyProviderType.DEFAULT },
  { url: 'http://proxy2.example.com:8080', type: ProxyProviderType.DEFAULT }
], ProxyRotationStrategy.STICKY_SESSION);
```

## Advanced Configuration with Tags and Usage Limits

```typescript
import { configureProxies, ProxyProviderType, ProxyRotationStrategy } from './proxy-config';

configureProxies([
  { 
    url: 'http://proxy1.example.com:8080',
    type: ProxyProviderType.BRIGHT_DATA,
    username: 'user',
    password: 'pass',
    tags: ['youtube', 'residential'],
    maxConsecutiveUses: 50  // Rotate after 50 uses
  },
  { 
    url: 'http://proxy2.example.com:8080',
    type: ProxyProviderType.WEBSHARE,
    username: 'user',
    password: 'pass',
    tags: ['youtube', 'datacenter']
  }
], ProxyRotationStrategy.WEIGHTED);
```

## Example with Proxy Services

Here are examples for popular proxy services:

### Webshare Proxy

```typescript
import { configureProxies, ProxyProviderType } from './proxy-config';

configureProxies([
  {
    url: 'http://proxy.webshare.io:80',
    username: 'your-username',
    password: 'your-password',
    type: ProxyProviderType.WEBSHARE
  }
]);
```

### Bright Data (formerly Luminati)

```typescript
import { configureProxies, ProxyProviderType } from './proxy-config';

configureProxies([
  {
    // Residential proxy example
    url: 'http://zproxy.lum-superproxy.io:22225',
    username: 'your-username-zone',
    password: 'your-password',
    type: ProxyProviderType.BRIGHT_DATA
  }
]);
```

### Oxylabs

```typescript
import { configureProxies, ProxyProviderType } from './proxy-config';

configureProxies([
  {
    url: 'http://proxy.oxylabs.io:8000',
    username: 'customer-username',
    password: 'password',
    type: ProxyProviderType.OXYLABS
  }
]);
```

## Using Multiple Proxy Providers Together

```typescript
import { configureProxies, ProxyProviderType, ProxyRotationStrategy } from './proxy-config';

// Mix different proxy providers with weighted selection
configureProxies([
  {
    url: 'http://residential.brightdata.com',
    username: 'brightuser',
    password: 'brightpass',
    type: ProxyProviderType.BRIGHT_DATA,
    weight: 5,  // Higher priority
    tags: ['residential']
  },
  {
    url: 'http://datacenter.brightdata.com',
    username: 'brightuser',
    password: 'brightpass',
    type: ProxyProviderType.BRIGHT_DATA,
    weight: 2,
    tags: ['datacenter']
  },
  {
    url: 'http://proxy.webshare.io:80',
    username: 'webshareuser',
    password: 'websharepass',
    type: ProxyProviderType.WEBSHARE,
    weight: 3
  },
  {
    url: 'http://proxy.oxylabs.io:8000',
    username: 'oxyuser',
    password: 'oxypass',
    type: ProxyProviderType.OXYLABS,
    weight: 2
  }
], ProxyRotationStrategy.WEIGHTED);
```

## Integration with Cloudflare Workers

When deploying to Cloudflare Workers, configure proxies using environment variables:

### Basic Setup (Legacy)

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

### Advanced JSON Configuration

For advanced setup with multiple proxies, use the PROXY_CONFIG variable with JSON:

```javascript
// In wrangler.toml:
// [vars]
// PROXY_CONFIG = '{"rotationStrategy":"weighted","providers":[{"url":"http://proxy1.example.com","username":"user1","password":"pass1","type":"brightdata","weight":3},{"url":"http://proxy2.example.com","username":"user2","password":"pass2","type":"webshare","weight":1}]}'

// In your Worker code:
import { 
  configureProxies, 
  setProxyEnabled, 
  ProxyProviderType, 
  ProxyRotationStrategy 
} from './youtube/proxy-config';

export default {
  async fetch(request, env, ctx) {
    // Configure proxies from JSON configuration
    if (env.PROXY_CONFIG) {
      try {
        const config = JSON.parse(env.PROXY_CONFIG);
        configureProxies(
          config.providers, 
          config.rotationStrategy || ProxyRotationStrategy.ROUND_ROBIN
        );
        setProxyEnabled(true);
      } catch (e) {
        console.error('Error parsing proxy configuration:', e);
      }
    }
    
    // Your existing Worker code...
  }
};
```

## Testing Proxy Configuration

You can verify if your proxy is working correctly:

```typescript
import { configureProxies, ProxyProviderType, ProxyRotationStrategy } from './youtube/proxy-config';
import { fetchYoutubeVideoMeta } from './youtube/video-meta-extract';

// Configure multiple providers
configureProxies([
  { 
    url: 'http://residential.example.com',
    username: 'user1',
    password: 'pass1',
    type: ProxyProviderType.BRIGHT_DATA,
    weight: 2
  },
  { 
    url: 'http://datacenter.example.com',
    username: 'user2',
    password: 'pass2',
    type: ProxyProviderType.OXYLABS,
    weight: 1
  }
], ProxyRotationStrategy.WEIGHTED);

// Test fetching video metadata
async function testProxies() {
  try {
    for (let i = 0; i < 5; i++) {
      console.log(`Test ${i+1}:`);
      const videoMeta = await fetchYoutubeVideoMeta('dQw4w9WgXcQ'); // Rick Astley
      console.log(`Proxy working! Video title: ${videoMeta.title}`);
    }
  } catch (error) {
    console.error('Proxy test failed:', error);
  }
}

testProxies();
```