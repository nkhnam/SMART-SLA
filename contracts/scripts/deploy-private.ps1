param(
    [switch]$DeploymentApproved,
    [ValidateSet('AgreementRegistry','EvidenceRegistry')][string]$Contract = 'AgreementRegistry'
)

$ErrorActionPreference = 'Stop'
if (-not $DeploymentApproved) {
    Write-Host 'STOP: separate key-input and deployment approval required. No prompt or transaction performed.'
    exit 1
}
$pointer = [IntPtr]::Zero
$secret = $null
$child = $null
$status = 1
try {
    if ($env:FUJI_DEPLOYMENT_APPROVED -ne '43113' -or $env:FUJI_APPROVED_CONTRACT -ne $Contract) {
        throw 'Missing per-contract approval.'
    }
    $publicNames = @('FUJI_DEPLOYMENT_APPROVED','FUJI_APPROVED_CONTRACT','FUJI_APPROVED_INITCODE_HASH',
        'FUJI_DEPLOYER_ADDRESS','AGREEMENT_RELAYER_ADDRESS','EVIDENCE_PUBLISHER_ADDRESS','BUYER_SIGNER_ADDRESS','SUPPLIER_SIGNER_ADDRESS',
        'FUJI_DEPLOYER_START_NONCE','FUJI_GAS_PRICE_WEI','FUJI_AGREEMENT_GAS_LIMIT','FUJI_EVIDENCE_GAS_LIMIT','FUJI_MAX_DEPLOYMENT_FEE_WEI')
    if ($Contract -eq 'EvidenceRegistry') { $publicNames += 'FUJI_AGREEMENT_DEPLOYMENT_TX_HASH' }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $script = if ($Contract -eq 'AgreementRegistry') { 'scripts/deploy.ts' } else { 'scripts/deploy-evidence.ts' }
    $start.Arguments = "node_modules/hardhat/dist/src/cli.js run $script --network avalancheFuji --no-compile"
    $start.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.EnvironmentVariables.Clear()
    foreach ($name in @('PATH','SystemRoot','WINDIR','TEMP','TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $start.EnvironmentVariables[$name] = $value }
    }
    foreach ($name in $publicNames) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ([string]::IsNullOrWhiteSpace($value)) { throw 'Missing public execution limits.' }
        $start.EnvironmentVariables[$name] = $value
    }
    $start.EnvironmentVariables['AVALANCHE_FUJI_RPC_URL'] = 'https://api.avax-test.network/ext/bc/C/rpc'
    Write-Host "Approved execution: $Contract on Fuji 43113. One transaction only; reconcile sender/nonce after any failure."
    $secret = Read-Host 'Dedicated Fuji Deployer private key (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $child = [System.Diagnostics.Process]::Start($start)
    $child.StandardInput.Write($plain)
    $child.StandardInput.Close()
    $plain = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $pointer = [IntPtr]::Zero
    $secret.Dispose()
    $secret = $null
    if (-not $child.WaitForExit(300000)) { throw 'Execution timed out.' }
    $status = $child.ExitCode
} catch {
    Write-Host 'FAIL: private deployment stopped. Reconcile sender/nonce/hash before retrying; submission may already exist.'
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
