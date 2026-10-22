$root = (Get-Item $PSScriptRoot).Parent.FullName
$destZip = Join-Path $root 'TNVN_Auto_Exam_Pro.zip'

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  TIEN ICH DONG GOI FILE ZIP BAN GIAO CHO NGUOI DUNG" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[*] Dang bien dich TypeScript moi nhat (pnpm build)..." -ForegroundColor Yellow
Set-Location $root
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[LOI] Bien dich TypeScript that bai!" -ForegroundColor Red
    pause
    exit 1
}

if (Test-Path $destZip) {
    Remove-Item $destZip -Force
}

$tempDir = Join-Path $env:TEMP ("tnvn_pack_" + (Get-Random))
New-Item -ItemType Directory -Path $tempDir | Out-Null

$itemsToCopy = @(
    'bin',
    'dist',
    'node_modules',
    'public',
    '.env',
    'accounts.json',
    'answers.json',
    'eng.traineddata',
    'vie.traineddata',
    'CHAY_TOOL.bat',
    'Chay_Tool_Web_Port_3000.bat',
    'HUONG_DAN_SU_DUNG.txt'
)

Write-Host ""
Write-Host "[*] Dang tong hop cac file can thiet..." -ForegroundColor Yellow
foreach ($item in $itemsToCopy) {
    $srcPath = Join-Path $root $item
    if (Test-Path $srcPath) {
        Write-Host "  -> Copy: $item" -ForegroundColor Gray
        Copy-Item -Path $srcPath -Destination (Join-Path $tempDir $item) -Recurse -Force
    }
}

Write-Host ""
Write-Host "[*] Dang nen thanh file zip: TNVN_Auto_Exam_Pro.zip..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $destZip -CompressionLevel Optimal -Force
Remove-Item $tempDir -Recurse -Force

$sizeMb = [math]::Round((Get-Item $destZip).Length / 1MB, 2)
Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  [THANH CONG] Da tao xong file: TNVN_Auto_Exam_Pro.zip ($sizeMb MB)!" -ForegroundColor Green
Write-Host "  Vi tri luu: $destZip" -ForegroundColor Green
Write-Host "  Ban chi can gui file .zip nay cho nguoi khac." -ForegroundColor White
Write-Host "====================================================================" -ForegroundColor Green
Write-Host ""
