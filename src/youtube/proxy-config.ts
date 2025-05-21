// YouTube Proxy Configuration

export interface ProxyConfig {
  url: string;
  username?: string; 
  password?: string;
}

// Configuration state
let proxyConfigs: ProxyConfig[] = [];
let proxyEnabled = false;
let currentProxyIndex = 0;

/**
 * Configure one or more proxies to use for YouTube requests
 * @param configs An array of proxy configurations
 */
export function configureProxies(configs: ProxyConfig[]): void {
  proxyConfigs = configs;
  proxyEnabled = configs.length > 0;
  currentProxyIndex = 0;
}

/**
 * Enable or disable proxy usage
 * @param enabled Whether proxies should be used
 */
export function setProxyEnabled(enabled: boolean): void {
  proxyEnabled = enabled && proxyConfigs.length > 0;
}

/**
 * Get the current proxy configuration to use, with rotation if multiple proxies are configured
 * @returns The current proxy configuration or undefined if proxies are disabled/not configured
 */
export function getCurrentProxy(): ProxyConfig | undefined {
  if (!proxyEnabled || proxyConfigs.length === 0) {
    return undefined;
  }
  
  const proxy = proxyConfigs[currentProxyIndex];
  // Rotate to next proxy for the next call
  currentProxyIndex = (currentProxyIndex + 1) % proxyConfigs.length;
  return proxy;
}

/**
 * Apply proxy configuration to fetch options for Cloudflare Workers
 * This adds the necessary cf.cacheEverything and proxy settings
 * 
 * @param options The existing fetch options
 * @returns Updated fetch options with proxy configuration
 */
export function applyProxyToFetchOptions(
  options: RequestInit & { cf?: Record<string, unknown> }
): RequestInit & { cf?: Record<string, unknown> } {
  const proxy = getCurrentProxy();
  if (!proxy) {
    return options;
  }

  // Create deep copy of options to avoid modifying the original
  const newOptions = JSON.parse(JSON.stringify(options));
  
  // Ensure cf object exists
  if (!newOptions.cf) {
    newOptions.cf = {};
  }

  // Add proxy configuration to cf object
  newOptions.cf.proxy = {
    url: proxy.url,
  };

  // Add authentication if provided
  if (proxy.username && proxy.password) {
    newOptions.cf.proxy.auth = {
      username: proxy.username,
      password: proxy.password
    };
  }

  return newOptions;
}

/**
 * Get a simple cache key for a given URL that includes the proxy information
 * This helps with caching responses when different proxies are used
 */
export function getProxyCacheKey(url: string): string {
  const proxy = getCurrentProxy();
  if (!proxy) {
    return url;
  }
  // Simple hash of the proxy URL to append to the cache key
  const proxyHash = proxy.url.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return `${url}_p${proxyHash}`;
}