import { describe, expect, it } from 'vitest';
import { detectFromUrl, detectFromWsUrl, extractPodKey } from '../src/shared/okd-detect.js';

describe('detectFromUrl', () => {
  it('detects OKD 3 pod page by path', () => {
    expect(
      detectFromUrl(
        'https://any-okd-host.example/console/project/svc/browse/pods/svc-abc?tab=logs',
      ),
    ).toBe('okd3');
  });
  it('detects OKD 4 pod page by path', () => {
    expect(detectFromUrl('https://any-okd-host.example/k8s/ns/team/pods/x/logs')).toBe('okd4');
    expect(detectFromUrl('https://any-okd-host.example/k8s/ns/team/pods/x')).toBe('okd4');
  });
  it('returns null for non-pod paths', () => {
    expect(detectFromUrl('https://any-okd-host.example/console/catalog')).toBeNull();
    expect(detectFromUrl('https://any-okd-host.example/dashboards')).toBeNull();
    expect(detectFromUrl('https://example.com/')).toBeNull();
  });
});

describe('detectFromWsUrl', () => {
  it('tags WS by API path prefix, not hostname', () => {
    expect(detectFromWsUrl('wss://any.example/api/v1/namespaces/x/pods/y/log')).toBe('okd3');
    expect(detectFromWsUrl('wss://any.example/api/kubernetes/api/v1/namespaces/x/pods/y/log')).toBe(
      'okd4',
    );
  });
  it('returns null for unrelated WS', () => {
    expect(detectFromWsUrl('wss://any.example/socket.io/')).toBeNull();
  });
});

describe('extractPodKey', () => {
  it('builds a stable key for OKD 4 pod paths', () => {
    expect(extractPodKey('/k8s/ns/team/pods/svc-abc/logs')).toBe('okd4:team:svc-abc');
    expect(extractPodKey('/k8s/ns/team/pods/svc-abc')).toBe('okd4:team:svc-abc');
  });
  it('builds a stable key for OKD 3 pod paths', () => {
    expect(extractPodKey('/console/project/svc/browse/pods/svc-abc')).toBe('okd3:svc:svc-abc');
  });
  it('returns empty string for non-pod paths', () => {
    expect(extractPodKey('/console/catalog')).toBe('');
    expect(extractPodKey('/k8s/cluster/nodes')).toBe('');
    expect(extractPodKey('/')).toBe('');
  });
});
