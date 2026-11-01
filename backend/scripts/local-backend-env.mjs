export function localBackendEnvironment(databaseUrl, inherited = process.env) {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || !url.password) {
    throw new Error('A password-protected loopback PostgreSQL URL is required.');
  }
  const env = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (inherited[name]) env[name] = inherited[name];
  }
  return { ...env, NODE_ENV: 'development', LOCAL_SAFE_MODE: 'true', HOST: '127.0.0.1', PORT: '4000', WORKERS_ENABLED: 'false', DATABASE_URL: databaseUrl, CORS_ORIGINS: 'http://localhost:3000', SESSION_TTL_HOURS: '168' };
}
