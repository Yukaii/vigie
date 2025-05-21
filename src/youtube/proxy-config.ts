// YouTube Proxy Configuration

/**
 * Base proxy configuration
 */
export interface ProxyConfig {
  url: string;
  username?: string; 
  password?: string;
}

/**
 * Proxy provider types supported by the system
 */
export enum ProxyProviderType {
  DEFAULT = 'default',
  BRIGHT_DATA = 'brightdata',
  WEBSHARE = 'webshare',
  OXYLABS = 'oxylabs',
  SMARTPROXY = 'smartproxy',
  NETNUT = 'netnut',
  PROXY_RACK = 'proxyrack',
  CUSTOM = 'custom'
}

/**
 * Rotation strategies for proxy selection
 */
export enum ProxyRotationStrategy {
  ROUND_ROBIN = 'round_robin',  // Sequential rotation through all proxies
  RANDOM = 'random',            // Random selection from available proxies
  WEIGHTED = 'weighted',        // Selection based on weight/priority of each proxy
  STICKY_SESSION = 'sticky'     // Maintain the same proxy for a session/domain
}

/**
 * Extended proxy configuration with provider-specific settings
 */
export interface ProxyProvider extends ProxyConfig {
  type: ProxyProviderType;      // Provider type
  weight?: number;              // Weight for weighted rotation (default: 1)
  tags?: string[];              // Tags for filtering/grouping proxies
  maxConsecutiveUses?: number;  // Max number of consecutive uses before rotation
  consecutiveUses?: number;     // Current consecutive use counter
  options?: Record<string, any>; // Provider-specific options
}

// Global configuration state
interface ProxyState {
  providers: ProxyProvider[];
  enabled: boolean;
  currentIndex: number;
  rotationStrategy: ProxyRotationStrategy;
  stickySessionMap: Map<string, number>; // Maps domain -> provider index for sticky sessions
}

// Configuration state
const proxyState: ProxyState = {
  providers: [],
  enabled: false,
  currentIndex: 0,
  rotationStrategy: ProxyRotationStrategy.ROUND_ROBIN,
  stickySessionMap: new Map()
};

/**
 * Configure one or more proxies to use for YouTube requests
 * @param providers An array of proxy configurations or providers
 * @param strategy The rotation strategy to use (defaults to round-robin)
 */
export function configureProxies(
  providers: (ProxyConfig | ProxyProvider)[], 
  strategy: ProxyRotationStrategy = ProxyRotationStrategy.ROUND_ROBIN
): void {
  // Convert any simple ProxyConfig objects to full ProxyProvider objects
  proxyState.providers = providers.map(p => {
    if ('type' in p) {
      return p as ProxyProvider;
    }
    // Convert basic config to provider with default settings
    return {
      ...p,
      type: ProxyProviderType.DEFAULT,
      weight: 1,
      consecutiveUses: 0
    } as ProxyProvider;
  });
  
  proxyState.enabled = providers.length > 0;
  proxyState.currentIndex = 0;
  proxyState.rotationStrategy = strategy;
}

/**
 * Enable or disable proxy usage
 * @param enabled Whether proxies should be used
 */
export function setProxyEnabled(enabled: boolean): void {
  proxyState.enabled = enabled && proxyState.providers.length > 0;
}

/**
 * Set the proxy rotation strategy
 * @param strategy The rotation strategy to use
 */
export function setRotationStrategy(strategy: ProxyRotationStrategy): void {
  proxyState.rotationStrategy = strategy;
}

/**
 * Get the current proxy provider configuration to use based on the rotation strategy
 * @param domain Optional domain for sticky session strategy
 * @returns The selected proxy provider or undefined if proxies are disabled/not configured
 */
export function getCurrentProxy(domain?: string): ProxyProvider | undefined {
  if (!proxyState.enabled || proxyState.providers.length === 0) {
    return undefined;
  }

  let selectedIndex: number;
  
  // Select the proxy based on the rotation strategy
  switch (proxyState.rotationStrategy) {
    case ProxyRotationStrategy.RANDOM:
      selectedIndex = Math.floor(Math.random() * proxyState.providers.length);
      break;
      
    case ProxyRotationStrategy.WEIGHTED:
      // Weighted random selection
      const totalWeight = proxyState.providers.reduce(
        (sum, provider) => sum + (provider.weight || 1), 0
      );
      let random = Math.random() * totalWeight;
      
      selectedIndex = 0;
      for (let i = 0; i < proxyState.providers.length; i++) {
        const weight = proxyState.providers[i].weight || 1;
        random -= weight;
        if (random <= 0) {
          selectedIndex = i;
          break;
        }
      }
      break;
      
    case ProxyRotationStrategy.STICKY_SESSION:
      if (domain) {
        // Get or create a sticky session for this domain
        if (proxyState.stickySessionMap.has(domain)) {
          selectedIndex = proxyState.stickySessionMap.get(domain) || 0;
        } else {
          // Select a random proxy for this domain and make it sticky
          selectedIndex = Math.floor(Math.random() * proxyState.providers.length);
          proxyState.stickySessionMap.set(domain, selectedIndex);
        }
      } else {
        // Default to round-robin if no domain provided
        selectedIndex = proxyState.currentIndex;
        proxyState.currentIndex = (proxyState.currentIndex + 1) % proxyState.providers.length;
      }
      break;
      
    case ProxyRotationStrategy.ROUND_ROBIN:
    default:
      // Simple round-robin rotation
      selectedIndex = proxyState.currentIndex;
      proxyState.currentIndex = (proxyState.currentIndex + 1) % proxyState.providers.length;
      break;
  }
  
  const provider = proxyState.providers[selectedIndex];
  
  // Track consecutive uses for max usage limit
  provider.consecutiveUses = (provider.consecutiveUses || 0) + 1;
  
  // Check if we need to force rotation due to max consecutive uses
  if (provider.maxConsecutiveUses && provider.consecutiveUses >= provider.maxConsecutiveUses) {
    provider.consecutiveUses = 0;
    // Force the next index to advance (for round-robin)
    if (proxyState.rotationStrategy === ProxyRotationStrategy.ROUND_ROBIN) {
      proxyState.currentIndex = (selectedIndex + 1) % proxyState.providers.length;
    }
  }
  
  return provider;
}

/**
 * Get all configured proxy providers matching the given criteria
 * @param type Optional provider type to filter by
 * @param tags Optional tags to filter by
 * @returns Array of matching proxy providers
 */
export function getProxyProviders(
  type?: ProxyProviderType, 
  tags?: string[]
): ProxyProvider[] {
  if (!proxyState.enabled) {
    return [];
  }
  
  return proxyState.providers.filter(provider => {
    // Filter by type if specified
    if (type && provider.type !== type) {
      return false;
    }
    
    // Filter by tags if specified
    if (tags && tags.length > 0) {
      if (!provider.tags || !provider.tags.some(tag => tags.includes(tag))) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Apply proxy configuration to fetch options for Cloudflare Workers
 * This adds the necessary cf.cacheEverything and proxy settings
 * 
 * @param options The existing fetch options
 * @param domain Optional domain for sticky session strategy
 * @returns Updated fetch options with proxy configuration
 */
export function applyProxyToFetchOptions(
  options: RequestInit & { cf?: Record<string, unknown> },
  domain?: string
): RequestInit & { cf?: Record<string, unknown> } {
  const proxy = getCurrentProxy(domain);
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
 * @param url The URL to create a cache key for
 * @param domain Optional domain for sticky sessions
 */
export function getProxyCacheKey(url: string, domain?: string): string {
  const proxy = getCurrentProxy(domain);
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