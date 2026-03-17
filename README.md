# ALGEONEX AI Video Dashboard

Bu proje, kullanicinin yukledigi gorsel ve icerik metninden otomatik olarak:

- reklam metni guclendirme
- hook / value proposition / CTA uretimi
- Turkce voiceover olusturma
- FFmpeg ile 10 saniyelik sosyal medya videosu render etme
- dashboard icinde preview ve download

akislarini calistirir.

## Gereksinimler

- Windows
- Node.js 20+
- npm
- Turkce SAPI voice varsa dogrudan onu kullanir; yoksa makinedeki ilk uygun Windows sesiyle fallback yapar.

## Kurulum

```bash
npm install
```

## Calistirma

```bash
npm start
```

Ardindan tarayicida:

```text
http://localhost:3000
```

## Klasorler

- `uploads/`: yuklenen gorseller
- `renders/`: uretilen video ve manifestler
- `voice/output/`: olusan voiceover WAV dosyalari
- `config/platforms.json`: platform export ayarlari
- `templates/default-template.json`: sahne sureleri ve tipografi ayarlari
- `ffmpeg-video-generator.js`: render motoru
- `voice/voiceover-generator.js`: PowerShell tabanli TTS wrapper

## Notlar

- Sistem CapCut yerine FFmpeg tabanli render kullanir.
- FFmpeg ikili dosyasi `ffmpeg-static` paketi ile gelir.
- Her render icin `renders/<jobId>/manifest.json` uzerinden tam kampanya ciktisi incelenebilir.
