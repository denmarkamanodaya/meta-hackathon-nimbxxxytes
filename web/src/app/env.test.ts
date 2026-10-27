import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('defaults the API base to /api when VITE_API_BASE is missing or blank', () => {
    expect(parseEnv({}).apiBase).toBe('/api');
    expect(parseEnv({ VITE_API_BASE: '  ' }).apiBase).toBe('/api');
  });

  it('strips trailing slashes so paths join without a double slash', () => {
    expect(parseEnv({ VITE_API_BASE: '/api/' }).apiBase).toBe('/api');
    expect(parseEnv({ VITE_API_BASE: 'https://x.sslip.io/api//' }).apiBase).toBe(
      'https://x.sslip.io/api',
    );
  });

  it('rejects a relative or protocol-relative base', () => {
    expect(() => parseEnv({ VITE_API_BASE: 'api' })).toThrow(/VITE_API_BASE/);
    expect(() => parseEnv({ VITE_API_BASE: '//evil.example' })).toThrow(/VITE_API_BASE/);
    expect(() => parseEnv({ VITE_API_BASE: 'ftp://x' })).toThrow(/VITE_API_BASE/);
  });

  it('reports production only when PROD is exactly true', () => {
    expect(parseEnv({ PROD: true }).isProd).toBe(true);
    expect(parseEnv({}).isProd).toBe(false);
  });
});

describe('parseEnv: Mac app settings', () => {
  it('reports the desktop build only for MODE desktop', () => {
    expect(parseEnv({ MODE: 'desktop' }).isDesktop).toBe(true);
    expect(parseEnv({ MODE: 'production' }).isDesktop).toBe(false);
    expect(parseEnv({}).isDesktop).toBe(false);
  });

  it('hides the Mac download link when VITE_MAC_DOWNLOAD_URL is missing or blank', () => {
    expect(parseEnv({}).macDownloadUrl).toBeNull();
    expect(parseEnv({ VITE_MAC_DOWNLOAD_URL: '  ' }).macDownloadUrl).toBeNull();
  });

  it('keeps an https download URL and rejects anything else', () => {
    expect(parseEnv({ VITE_MAC_DOWNLOAD_URL: 'https://example.com/mac' }).macDownloadUrl).toBe(
      'https://example.com/mac',
    );
    expect(() => parseEnv({ VITE_MAC_DOWNLOAD_URL: 'http://example.com/mac' })).toThrow(/VITE_MAC_DOWNLOAD_URL/);
    expect(() => parseEnv({ VITE_MAC_DOWNLOAD_URL: 'javascript:alert(1)' })).toThrow(/VITE_MAC_DOWNLOAD_URL/);
  });
});
