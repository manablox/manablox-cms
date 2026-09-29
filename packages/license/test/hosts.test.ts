import { describe, expect, it } from 'vitest';
import { hostnameOf, isPrivateHostname } from '../src/index.js';

describe('private hostnames', () => {
  it('counts local names, loopback, RFC 1918, link-local and unique-local as private', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'app.localhost',
      'cms.test',
      'printer.local',
      'api.corp.internal',
      '127.0.0.1',
      '127.8.9.10',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.20',
      '169.254.169.254',
      '::1',
      'fe80::1',
      'fd12:3456::1',
      'fc00::1',
      '::ffff:192.168.0.1',
    ]) {
      expect([host, isPrivateHostname(host)]).toEqual([host, true]);
    }
  });

  it('counts everything else as public', () => {
    for (const host of [
      'example.com',
      'cms.example.com',
      'localhost.example.com',
      'test',
      'mytest',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '100.64.0.1',
      '2001:db8::1',
      '::ffff:8.8.8.8',
      '',
      '   ',
    ]) {
      expect([host, isPrivateHostname(host)]).toEqual([host, false]);
    }
  });

  it('reads hosts with ports, bracketed IPv6 and URLs', () => {
    expect(isPrivateHostname('localhost:3000')).toBe(true);
    expect(isPrivateHostname('[::1]:3000')).toBe(true);
    expect(isPrivateHostname('[2001:db8::1]:443')).toBe(false);
    expect(isPrivateHostname('http://127.0.0.1:8080/admin')).toBe(true);
    expect(isPrivateHostname('https://cms.example.com')).toBe(false);
    expect(isPrivateHostname('cms.test.')).toBe(true);
    expect(hostnameOf('https://[fd00::1]:8443/x')).toBe('fd00::1');
    expect(hostnameOf('Example.COM:80')).toBe('example.com');
    expect(hostnameOf('not a url://')).toBe('');
  });

  it('takes extra hosts, exact or by suffix', () => {
    const extra = ['preview.example.com', '*.staging.example.net'];
    expect(isPrivateHostname('preview.example.com', extra)).toBe(true);
    expect(isPrivateHostname('PREVIEW.example.com:443', extra)).toBe(true);
    expect(isPrivateHostname('other.example.com', extra)).toBe(false);
    expect(isPrivateHostname('pr-12.staging.example.net', extra)).toBe(true);
    expect(isPrivateHostname('staging.example.net', extra)).toBe(false);
  });
});
