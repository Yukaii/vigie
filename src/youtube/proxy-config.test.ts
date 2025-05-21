import { 
  configureProxies, 
  getCurrentProxy, 
  setProxyEnabled, 
  applyProxyToFetchOptions,
  ProxyProviderType,
  ProxyRotationStrategy
} from './proxy-config';

describe('Proxy Configuration', () => {
  afterEach(() => {
    // Reset proxy config after each test
    configureProxies([]);
    setProxyEnabled(false);
  });

  it('should return undefined when no proxies are configured', () => {
    expect(getCurrentProxy()).toBeUndefined();
  });

  it('should return the configured proxy', () => {
    const testProxy = { url: 'http://test-proxy.example.com:8080' };
    configureProxies([testProxy]);
    setProxyEnabled(true);
    
    // Get the provider with the added default fields
    const proxy = getCurrentProxy();
    expect(proxy?.url).toBe(testProxy.url);
  });

  it('should rotate through multiple proxies', () => {
    const proxy1 = { url: 'http://proxy1.example.com:8080' };
    const proxy2 = { url: 'http://proxy2.example.com:8080' };
    const proxy3 = { url: 'http://proxy3.example.com:8080' };
    
    configureProxies([proxy1, proxy2, proxy3]);
    setProxyEnabled(true);
    
    // Check basic rotation
    expect(getCurrentProxy()?.url).toBe(proxy1.url);
    expect(getCurrentProxy()?.url).toBe(proxy2.url);
    expect(getCurrentProxy()?.url).toBe(proxy3.url);
    expect(getCurrentProxy()?.url).toBe(proxy1.url); // Should rotate back to the first proxy
  });

  it('should apply proxy configuration to fetch options', () => {
    const testProxy = { 
      url: 'http://test-proxy.example.com:8080',
      username: 'testuser',
      password: 'testpass'
    };
    
    configureProxies([testProxy]);
    setProxyEnabled(true);
    
    const options: RequestInit & { cf?: Record<string, unknown> } = {
      method: 'GET',
      headers: { 'X-Test': 'Value' }
    };
    
    const result = applyProxyToFetchOptions(options);
    
    expect(result.cf).toBeDefined();
    expect(result.cf?.proxy).toBeDefined();
    expect((result.cf?.proxy as any).url).toBe(testProxy.url);
    expect((result.cf?.proxy as any).auth).toBeDefined();
    expect((result.cf?.proxy as any).auth.username).toBe(testProxy.username);
    expect((result.cf?.proxy as any).auth.password).toBe(testProxy.password);
    
    // Original headers should be preserved
    expect(result.headers).toEqual(options.headers);
  });

  it('should not apply proxy configuration when disabled', () => {
    const testProxy = { url: 'http://test-proxy.example.com:8080' };
    
    configureProxies([testProxy]);
    setProxyEnabled(false); // Explicitly disabled
    
    const options: RequestInit & { cf?: Record<string, unknown> } = {
      method: 'GET',
      cf: { someOption: 'value' }
    };
    
    const result = applyProxyToFetchOptions(options);
    
    expect(result.cf).toEqual({ someOption: 'value' });
    expect(result.cf?.proxy).toBeUndefined();
  });

  it('should use weighted rotation strategy', () => {
    configureProxies([
      { url: 'http://proxy1.example.com', weight: 2, type: ProxyProviderType.BRIGHT_DATA },
      { url: 'http://proxy2.example.com', weight: 1, type: ProxyProviderType.WEBSHARE }
    ], ProxyRotationStrategy.WEIGHTED);
    
    setProxyEnabled(true);
    
    // Due to randomness in weighted selection, we can't test exact order,
    // but we can check that both proxies are used with multiple calls
    const results = new Map<string, number>();
    
    // Make enough calls to ensure both proxies are used
    for (let i = 0; i < 100; i++) {
      const proxy = getCurrentProxy();
      if (proxy) {
        results.set(proxy.url, (results.get(proxy.url) || 0) + 1);
      }
    }
    
    // Both proxies should be used
    expect(results.size).toBe(2);
    expect(results.has('http://proxy1.example.com')).toBe(true);
    expect(results.has('http://proxy2.example.com')).toBe(true);
    
    // The first proxy should be used approximately twice as much as the second one
    // But with randomness, we can't expect exact ratios, just check that it's used more
    expect(results.get('http://proxy1.example.com')).toBeGreaterThan(results.get('http://proxy2.example.com') || 0);
  });

  it('should support sticky sessions', () => {
    configureProxies([
      { url: 'http://proxy1.example.com' },
      { url: 'http://proxy2.example.com' },
      { url: 'http://proxy3.example.com' }
    ], ProxyRotationStrategy.STICKY_SESSION);
    
    setProxyEnabled(true);
    
    // Same domain should always get the same proxy
    const domain1 = 'example.com';
    const domain2 = 'another.example.com';
    
    const proxy1 = getCurrentProxy(domain1);
    const proxy2 = getCurrentProxy(domain2);
    
    // Get several more times and confirm they stay the same
    for (let i = 0; i < 5; i++) {
      expect(getCurrentProxy(domain1)?.url).toBe(proxy1?.url);
      expect(getCurrentProxy(domain2)?.url).toBe(proxy2?.url);
    }
  });
});