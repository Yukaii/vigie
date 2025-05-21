import { configureProxies, getCurrentProxy, setProxyEnabled, applyProxyToFetchOptions } from './proxy-config';

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
    
    expect(getCurrentProxy()).toEqual(testProxy);
  });

  it('should rotate through multiple proxies', () => {
    const proxy1 = { url: 'http://proxy1.example.com:8080' };
    const proxy2 = { url: 'http://proxy2.example.com:8080' };
    const proxy3 = { url: 'http://proxy3.example.com:8080' };
    
    configureProxies([proxy1, proxy2, proxy3]);
    setProxyEnabled(true);
    
    expect(getCurrentProxy()).toEqual(proxy1);
    expect(getCurrentProxy()).toEqual(proxy2);
    expect(getCurrentProxy()).toEqual(proxy3);
    expect(getCurrentProxy()).toEqual(proxy1); // Should rotate back to the first proxy
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
});