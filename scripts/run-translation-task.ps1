param([Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'SUW-Translation'
$key = Get-Content -LiteralPath (Join-Path $dir 'key.dpapi') | ConvertTo-SecureString
$log = Join-Path $dir ('worker-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
$mailConfig = Join-Path $dir 'review-smtp.json'
$mailSecret = Join-Path $dir 'review-smtp.dpapi'
$mailKey = $null
try {
    if ((Test-Path -LiteralPath $mailConfig) -and (Test-Path -LiteralPath $mailSecret)) {
        try {
            $mailKey = Get-Content -LiteralPath $mailSecret | ConvertTo-SecureString
            $env:SUW_REVIEW_SMTP = Get-Content -LiteralPath $mailConfig -Raw -Encoding UTF8
            $env:SUW_REVIEW_SMTP_PASSWORD = [System.Net.NetworkCredential]::new('', $mailKey).Password
        } catch {
            Add-Content -LiteralPath $log -Value 'Review email configuration could not be loaded.' -Encoding UTF8
        }
    }
    $env:SUPABASE_URL = 'https://ypuazpntnydcgvlkwqno.supabase.co'
    $env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $key).Password
    $env:TRANSLATION_ENDPOINT = 'http://127.0.0.1:11434/api/chat'
    $env:TRANSLATION_MODEL = 'qwen3:4b-instruct'
    $env:TRANSLATION_BATCH_SIZE = '50'
    $env:TRANSLATION_MAX_CHARS = '20000'
    $env:TRANSLATION_FAILURE_FILE = Join-Path $dir 'failures.json'
    $repairRoot = Join-Path $env:LOCALAPPDATA 'Packages\PythonSoftwareFoundation.Python.3.7_qbz5n2kfra8p0\LocalCache\Local\SUW-Model-Training'
    if ((Test-Path (Join-Path $repairRoot 'span-revision-en\decoder-last-layer.pt')) -and
        (Test-Path (Join-Path $repairRoot 'span-revision-zh\decoder-last-layer.pt'))) {
        $env:SUW_REPAIR_MODEL_DIR = $repairRoot
        $env:PYTHONPATH = "$repairRoot/deps;$repairRoot/nlp-deps"
        $env:HF_HUB_OFFLINE = '1'
        $env:TRANSFORMERS_OFFLINE = '1'
        $env:TRANSLATION_REPAIR_SCRIPT = Join-Path $repairRoot 'repair-translation.py'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'repair-translation.py') -Destination $env:TRANSLATION_REPAIR_SCRIPT
    }
    Remove-Item Env:TRANSLATION_SUBMISSION_ID -ErrorAction SilentlyContinue
    Add-Content -LiteralPath $log -Value ('Started ' + (Get-Date -Format o)) -Encoding UTF8
    $ErrorActionPreference = 'Continue'
    & $Node --use-env-proxy (Join-Path $PSScriptRoot 'translate-answers.mjs') 2>&1 |
        ForEach-Object { Add-Content -LiteralPath $log -Value $_.ToString() -Encoding UTF8 }
    exit $LASTEXITCODE
} finally {
    Remove-Item Env:SUW_REVIEW_SMTP, Env:SUW_REVIEW_SMTP_PASSWORD -ErrorAction SilentlyContinue
    if ($mailKey) { $mailKey.Dispose() }
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
    $key.Dispose()
}
