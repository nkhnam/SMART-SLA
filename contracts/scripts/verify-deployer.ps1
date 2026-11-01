param([switch]$IdentityCheckApproved)

$ErrorActionPreference = 'Stop'
if (-not $IdentityCheckApproved) {
    Write-Host 'STOP: key input requires separate approval. No prompt, key read or signature performed.'
    exit 1
}
Set-Location (Split-Path -Parent $PSScriptRoot)
$pointer = [IntPtr]::Zero
$secret = $null
$child = $null
$status = 1
try {
    Write-Host 'Identity check only. Use only after separate private-key export/input approval.'
    $secret = Read-Host 'Dedicated Fuji Deployer private key (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $start.Arguments = 'scripts/verify-deployer.mjs'
    $start.WorkingDirectory = (Get-Location).Path
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables.Clear()
    foreach ($name in @('PATH','SystemRoot','WINDIR','TEMP','TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $start.EnvironmentVariables[$name] = $value }
    }
    $child = [System.Diagnostics.Process]::Start($start)
    $child.StandardInput.Write($plain)
    $child.StandardInput.Close()
    $plain = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $pointer = [IntPtr]::Zero
    $secret.Dispose()
    $secret = $null
    $output = $child.StandardOutput.ReadToEnd()
    $null = $child.StandardError.ReadToEnd()
    $child.WaitForExit()
    $status = $child.ExitCode
    if ($status -eq 0) {
        $data = $output | ConvertFrom-Json
        if ($data.result -ne 'PASS' -or $data.identityOnly -ne $true -or $data.signatureProduced -ne $false -or $data.transactionProduced -ne $false) { throw 'Unexpected identity result.' }
        [ordered]@{result='PASS';address=$data.address;identityOnly=$true;signatureProduced=$false;transactionProduced=$false} | ConvertTo-Json -Compress | Write-Output
    } else {
        Write-Host 'FAIL: deployer identity does not match or private input is invalid.'
    }
} catch {
    $status = 1
    Write-Host 'FAIL: private deployer identity check could not complete.'
} finally {
    $plain = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secret) { $secret.Dispose() }
    if ($null -ne $child) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
exit $status
