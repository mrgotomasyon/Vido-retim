param(
  [Parameter(Mandatory = $true)]
  [string]$Text,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$Culture = "tr-TR",
  [int]$Rate = 1
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$directory = Split-Path -Parent $OutputPath
if (-not (Test-Path $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = $Rate
$synth.Volume = 100

$selectedVoice = $null
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }

foreach ($voice in $voices) {
  if ($voice.Culture.Name -eq $Culture) {
    $selectedVoice = $voice.Name
    break
  }
}

if (-not $selectedVoice) {
  foreach ($voice in $voices) {
    if ($voice.Name -match "Turkish|Tolga|Tugba|Ayse|Zira") {
      $selectedVoice = $voice.Name
      break
    }
  }
}

if (-not $selectedVoice -and $voices.Count -gt 0) {
  $selectedVoice = $voices[0].Name
}

if (-not $selectedVoice) {
  throw "Bu makinede SAPI sesi bulunamadi."
}

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  48000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

$synth.SelectVoice($selectedVoice)
$synth.SetOutputToWaveFile($OutputPath, $format)
$synth.Speak($Text)
$synth.SetOutputToNull()
$synth.Dispose()

[PSCustomObject]@{
  selectedVoice = $selectedVoice
  culture = $Culture
  output = $OutputPath
} | ConvertTo-Json -Compress
