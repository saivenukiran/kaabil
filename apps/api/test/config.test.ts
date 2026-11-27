import { describe, expect, it } from 'vitest';
import { allowedOrigins, loadConfig, readSecret } from '../src/config';

describe('secrets and config', () => {
  it('reads a secret directly or from a file, and prefers the direct value', () => {
    const read = (p: string) => (p === '/s/auth' ? ' from-file \n' : '');
    expect(readSecret({ AUTH_SECRET: 'direct', AUTH_SECRET_FILE: '/s/auth' }, 'AUTH_SECRET', read)).toBe('direct');
    expect(readSecret({ AUTH_SECRET_FILE: '/s/auth' }, 'AUTH_SECRET', read)).toBe('from-file');
    expect(readSecret({}, 'AUTH_SECRET', read)).toBeUndefined();
  });
  it('builds the database address from parts and never from a default password', () => {
    const read = () => 'p@ss/word';
    const c = loadConfig({ AUTH_SECRET: 'x', DB_PASSWORD_FILE: '/s/db' }, read);
    expect(c.databaseUrl).toBe('postgres://kaabil:p%40ss%2Fword@db:5432/kaabil');
    expect(() => loadConfig({ AUTH_SECRET: 'x' })).toThrow(/DB_PASSWORD/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/AUTH_SECRET/);
  });
  it('keeps the console off unless asked and lists the allowed origins', () => {
    const c = loadConfig({ AUTH_SECRET: 'x', DATABASE_URL: 'postgres://x', BASE_URL: 'https://kaabil.example/', TRUSTED_ORIGINS: 'http://192.168.1.5:8080, ' });
    expect(c.devConsole).toBe(false);
    expect(allowedOrigins(c)).toEqual(['https://kaabil.example', 'http://192.168.1.5:8080']);
  });
});
