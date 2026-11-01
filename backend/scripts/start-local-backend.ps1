param([switch]$Check)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$secret = $null
$pointer = [IntPtr]::Zero
$child = $null
try {
    if (-not (Test-Path dist/main.js)) { throw 'Build the backend first: npm run build' }
    $secret = Read-Host 'Fuji DB - Backend password (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $encoded = [Uri]::EscapeDataString($plain)
    $payload = @{ databaseUrl = "postgresql://sladex_fuji_app:${encoded}@127.0.0.1:5434/sladex_fuji_demo?schema=public" } | ConvertTo-Json -Compress
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $start.Arguments = 'scripts/start-local-backend.mjs'
    if ($Check) { $start.Arguments += ' --check' }
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.WorkingDirectory = (Get-Location).Path
    $start.EnvironmentVariables.Clear()
    foreach ($name in @('PATH','SystemRoot','WINDIR','TEMP','TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $start.EnvironmentVariables[$name] = $value }
    }
    $child = [System.Diagnostics.Process]::Start($start)
    $child.StandardInput.Write($payload)
    $child.StandardInput.Close()
    $payload = $null
    $plain = $null
    $encoded = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $pointer = [IntPtr]::Zero
    $secret.Dispose()
    $secret = $null
    $child.WaitForExit()
    $status = $child.ExitCode
} catch {
    Write-Host ('FAIL: local launcher wrapper at line ' + $_.InvocationInfo.ScriptLineNumber + ' (' + $_.Exception.GetType().Name + ')')
    $status = 1
} finally {
    $payload = $null
    $plain = $null
    $encoded = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secret) { $secret.Dispose() }
    if ($null -ne $child) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
exit $status
