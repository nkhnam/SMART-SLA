param([string]$ResultPath)

$ErrorActionPreference = 'Stop'
if (-not $ResultPath) { $ResultPath = Join-Path $env:TEMP ('sla-fuji-db-check-' + [guid]::NewGuid() + '.json') }
Set-Location (Split-Path -Parent $PSScriptRoot)
$previousUrl = $env:DATABASE_URL
$secret = $null
$pointer = [IntPtr]::Zero
$exitStatus = 1

try {
    Write-Host 'Fuji database check only. No API, workers or wallet access.'
    $secret = Read-Host 'Password for Fuji DB - Backend (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $encoded = [Uri]::EscapeDataString($plain)
    $env:DATABASE_URL = "postgresql://sladex_fuji_app:${encoded}@127.0.0.1:5434/sladex_fuji_demo?schema=public"

    $output = @'
import pg from 'pg';
import { validateEnvironment } from './src/config/env.schema.ts';

let stage = 'config';
let client;
let report;
try {
  validateEnvironment({ NODE_ENV: 'development', PORT: '4000', CORS_ORIGINS: 'http://localhost:3000', SESSION_TTL_HOURS: '168', DATABASE_URL: process.env.DATABASE_URL });
  stage = 'connect';
  client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
  await client.connect();
  stage = 'read_only_query';
  await client.query('BEGIN READ ONLY');
  const result = await client.query(`SELECT current_database() AS database, current_user AS username, (SELECT count(*)::int FROM "AnchorIntent") AS agreement_intents, (SELECT count(*)::int FROM "EvidenceAnchorIntent") AS evidence_intents`);
  await client.query('ROLLBACK');
  report = { result: 'PASS', observedAt: new Date().toISOString(), host: '127.0.0.1', port: 5434, ...result.rows[0] };
} catch (error) {
  const allowed = ['28P01', '28000', '3D000', '42501', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EACCES', 'EPERM', 'ENOTFOUND', 'ERR_INVALID_URL'];
  const message = String(error?.message ?? '');
  const category = /password must be a non-empty string/i.test(message) ? 'empty_password'
    : /password must be a string/i.test(message) ? 'password_type'
    : /timeout|timed out/i.test(message) ? 'timeout'
    : /URI malformed|Invalid URL/i.test(message) ? 'url_encoding'
    : /SASL|SCRAM/i.test(message) ? 'sasl'
    : /SSL|certificate/i.test(message) ? 'tls'
    : 'unclassified';
  report = { result: 'FAIL', observedAt: new Date().toISOString(), stage,
    code: allowed.includes(error?.code) ? error.code : 'unclassified', category,
    errorType: ['Error', 'TypeError', 'DatabaseError', 'AggregateError'].includes(error?.constructor?.name) ? error.constructor.name : 'other',
    nestedCodes: Array.isArray(error?.errors) ? error.errors.map(e => allowed.includes(e?.code) ? e.code : 'unclassified') : [],
    passwordPresent: Boolean(new URL(process.env.DATABASE_URL).password) };
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
process.stdout.write(JSON.stringify(report, null, 2));
'@ | node --import tsx --input-type=module

    $exitStatus = $LASTEXITCODE
    $report = ($output -join "`n") | ConvertFrom-Json
    $safeResult = $report | ConvertTo-Json
    [IO.File]::WriteAllText($ResultPath, $safeResult)
    Write-Host $safeResult
} catch {
    $safeResult = '{"result":"FAIL","stage":"powershell_or_node_wrapper","code":"unclassified"}'
    [IO.File]::WriteAllText($ResultPath, $safeResult)
    Write-Host $safeResult
} finally {
    if ($null -eq $previousUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
    else { $env:DATABASE_URL = $previousUrl }
    $previousUrl = $null
    $plain = $null
    $encoded = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secret) { $secret.Dispose() }
}

Write-Host ('Sanitized result: ' + $ResultPath)
Read-Host 'Press Enter to close'
exit $exitStatus
