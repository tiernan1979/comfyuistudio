# cleanup-comfyui.ps1 — purge old files from ComfyUI's output/ and input/ dirs.
#
# ComfyUI's HTTP API exposes NO way to list or delete output files (the
# /userdata route only covers input/, read-only, and DELETE returns 405), so
# cleanup has to run on the machine that hosts ComfyUI. This script does that.
#
# SETUP
#   1. Set the two paths below to your ComfyUI install (the folders that hold
#      output/ and input/ — usually <ComfyUI root>).
#   2. Test once by hand:  powershell -ExecutionPolicy Bypass -File cleanup-comfyui.ps1
#   3. Schedule it weekly in Task Scheduler:
#        Action : Start a program
#        Program: powershell.exe
#        Args   : -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\path\to\cleanup-comfyui.ps1"
#        Trigger: Weekly, at a quiet hour (e.g. Sunday 04:00)
#
# SAFETY
#   - Dry-run by default: set $DryRun = $false only after you've eyeballed the
#     report once. Nothing is deleted while $DryRun is $true.
#   - Protected subtrees (animation_templates/, upscale_models/, controlnet/,
#     loras/, checkpoints/) are NEVER touched — those are models you installed,
#     not generated output.
#   - A summary is appended to cleanup-log.txt next to this script.

param(
    [switch]$Force   # bypass the dry-run and actually delete
)

# ── CONFIG: set these two to your ComfyUI install ─────────────────────────────
$ComfyRoot   = 'C:\ComfyUI'                        # folder containing output\ and input\
$OutputKeepDays = 14                               # generated media older than this goes
$InputKeepDays  = 7                                # uploaded source files older than this goes
# ──────────────────────────────────────────────────────────────────────────────

$DryRun = -not $Force

$OutputDir = Join-Path $ComfyRoot 'output'
$InputDir  = Join-Path $ComfyRoot 'input'

# Subtrees under input/ that hold installed assets, not user uploads.
$ProtectedInput = @('animation_templates', 'upscale_models', 'controlnet', 'loras', 'checkpoints', 'vae', 'clip', 'unet', 'diffusion_models')

$ExtFilter = @('.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.flac', '.ogg', '.glb', '.gltf', '.fbx', '.obj', '.ply', '.latent', '.json', '.txt')

function Get-AgeCutoff([int]$days) { (Get-Date).AddDays(-$days) }

function Remove-OldFiles {
    param(
        [string]$Root,
        [datetime]$Cutoff,
        [string[]]$ExcludeDirs = @(),
        [string]$Label
    )
    if (-not (Test-Path $Root)) {
        Write-Host "[$Label] not found: $Root (skipping)"
        return @()
    }
    $files = Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.LastWriteTime -lt $Cutoff) -and
            ($ExtFilter -contains $_.Extension.ToLower())
        }
    # Exclude protected subtrees by full path prefix
    $files = $files | Where-Object {
        $full = $_.FullName
        $skip = $false
        foreach ($ex in $ExcludeDirs) {
            if ($ex -and $full.StartsWith($ex, [System.StringComparison]::OrdinalIgnoreCase)) { $skip = $true; break }
        }
        -not $skip
    }
    return @($files)
}

Write-Host ""
Write-Host "ComfyUI cleanup  (dry-run: $DryRun)" -ForegroundColor Cyan
Write-Host "  output : $OutputDir  (keep $OutputKeepDays days)"
Write-Host "  input  : $InputDir   (keep $InputKeepDays days)"
Write-Host ""

$allTargets = @()

# Output: everything generated, no exclusions.
$outCutoff = Get-AgeCutoff $OutputKeepDays
$allTargets += Remove-OldFiles -Root $OutputDir -Cutoff $outCutoff -Label 'output'

# Input: only uploads (exclude protected model/template subtrees).
$inCutoff = Get-AgeCutoff $InputKeepDays
$protectedPaths = $ProtectedInput | ForEach-Object { Join-Path $InputDir $_ }
$allTargets += Remove-OldFiles -Root $InputDir -Cutoff $inCutoff -ExcludeDirs $protectedPaths -Label 'input'

if ($allTargets.Count -eq 0) {
    Write-Host "Nothing to clean up. All files are within the keep window." -ForegroundColor Green
    exit 0
}

$totalBytes = ($allTargets | Measure-Object -Property Length -Sum).Sum
$gb = [math]::Round($totalBytes / 1GB, 2)
$mb = [math]::Round($totalBytes / 1MB, 1)
$sizeStr = if ($gb -ge 1) { "$gb GB" } else { "$mb MB" }

Write-Host "$($allTargets.Count) files eligible for deletion ($sizeStr):" -ForegroundColor Yellow
$allTargets | Select-Object -First 25 | ForEach-Object {
    $rel = $_.FullName.Substring($ComfyRoot.Length).TrimStart('\')
    Write-Host ("  {0,-55} {1,10}  {2}" -f $rel, $_.Length, $_.LastWriteTime.ToString('yyyy-MM-dd'))
}
if ($allTargets.Count -gt 25) { Write-Host "  ... and $($allTargets.Count - 25) more" }

if ($DryRun) {
    Write-Host ""
    Write-Host "DRY RUN — nothing deleted. Re-run with -Force (or set `$DryRun = `$false) to actually delete." -ForegroundColor Cyan
} else {
    $allTargets | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    Write-Host ""
    Write-Host "Deleted $($allTargets.Count) files, freed $sizeStr." -ForegroundColor Green
}

# Append to log
$logLine = "{0}  files={1}  bytes={2}  dryrun={3}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $allTargets.Count, $totalBytes, $DryRun
$logPath = Join-Path $PSScriptRoot 'cleanup-log.txt'
Add-Content -Path $logPath -Value $logLine -ErrorAction SilentlyContinue
Write-Host "Logged to $logPath"
