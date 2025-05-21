# Vigie

A YouTube comment and video metadata scraper with proxy support to bypass rate limiting.

## Installation

```bash
npm install
```

## Development

Start the development server:

```bash
npm run dev
```

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```bash
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

## Using Proxy Support for YouTube Requests

To bypass YouTube's rate limiting and blocking mechanisms, you can use proxies with this library. We've integrated support for various proxy providers to make requests appear to come from different IP addresses.

### Basic Proxy Configuration

```typescript
import { configureProxies, setProxyEnabled } from './youtube/proxy-config';

// Configure proxy
configureProxies([
  { 
    url: 'http://proxy.example.com:8080',
    username: 'username', // Optional
    password: 'password'  // Optional
  }
]);

// Enable proxy
setProxyEnabled(true);
```

### Multiple Proxy Configuration with Rotation

```typescript
import { configureProxies } from './youtube/proxy-config';

// Configure multiple proxies (they will rotate automatically)
configureProxies([
  { url: 'http://proxy1.example.com:8080' },
  { url: 'http://proxy2.example.com:8080' },
  { url: 'http://proxy3.example.com:8080' }
]);
```

### Cloudflare Worker Environment Variables

When using with Cloudflare Workers, you can set the following environment variables:

```toml
# wrangler.toml
[vars]
PROXY_URL = "http://proxy.example.com:8080"
PROXY_USERNAME = "username"
PROXY_PASSWORD = "password"
```

For more details and examples, see the [proxy documentation](src/youtube/proxy-example.md).

## License

MIT
