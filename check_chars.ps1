$content = Get-Content 'C:\Users\PuuGoo\Desktop\hotel_search_v2\public\bulkData.html' -Raw -Encoding UTF8
$lines = $content.Split("`n")
$lineNums = @(38,42,53,85,102,112,176,190,220,230,234,237)
foreach ($ln in $lineNums) {
    $line = $lines[$ln-1]
    Write-Host "Line ${ln}:"
    $chars = $line.TrimEnd("`r").ToCharArray()
    foreach ($ch in $chars) {
        Write-Host -NoNewline ('U+{0:X4} ' -f [int]$ch)
    }
    Write-Host ''
    Write-Host "---"
}
