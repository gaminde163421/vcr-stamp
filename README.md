# VCR Stamp

A web app that runs on your phone and converts camcorder clips (.MPG / .MTS) to MP4 with a classic VCR-style date/time stamp burned in:

```
 1:41:40 PM
NOV.21 2026
```

All processing happens on the device using ffmpeg.wasm. Nothing gets uploaded anywhere.

## Recording date
- **Sony .MPG (standard definition):** read from the camcorder's hidden recording data, accurate to the second.
- **AVCHD .MTS (HD):** read from the camcorder's MDPM data when present.
- **Anything else:** falls back to the file's date. Every clip has an editable "Recording started" field, so check it before converting.

## Put it online (one time)
The page has to be served over HTTPS. Opening `index.html` straight from Files won't work.

**Option A – GitHub Pages**
1. Create a new repo on GitHub, e.g. `vcr-stamp`.
2. Upload everything in this folder (keep the `vendor/`, `fonts/` and `icons/` folders). From a computer:
   ```
   cd vcr-stamp
   git init && git add . && git commit -m "VCR Stamp"
   git branch -M main
   git remote add origin https://github.com/<you>/vcr-stamp.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages → Source: Deploy from a branch → main / (root)** and click Save.
4. About a minute later the app is live at `https://<you>.github.io/vcr-stamp/`.

Note: GitHub Pages sites are public on a free account. The app itself holds no personal data, since your videos never leave your phone.

**Option B – Netlify Drop (no git)**
Go to https://app.netlify.com/drop on a computer and drag this whole folder onto the page. You'll get a URL right away (sign in to keep it).

## Install on iPhone
1. Open the URL in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Open it from the home-screen icon. Each launch loads the ~32 MB video engine. Safari usually caches it, so it's quick after the first time, but you need an internet connection to open the app.

## Use
1. Copy the clips from the camcorder into the Files app (USB-C cable or camera adapter, camcorder set to USB Connect).
2. Tap **Choose videos** and select one or more clips.
3. Check each start time, pick your options, and tap **Convert**. Keep the screen on while it works.
4. Tap **Save to Photos / Share** (then "Save Video"), or **Download MP4** to save it to Files.

## Notes
- Speed: a 13-second SD clip takes well under a minute on a recent iPhone. HD clips are slower and get downscaled to 720p.
- Very long clips (roughly 10–15+ minutes) may exceed Safari's memory limit. If one fails, trim it or convert it on a computer.
- Output: H.264 MP4 with AAC stereo audio, deinterlaced, with corrected widescreen aspect.

## Files
- `index.html`, `app.js` – the app
- `stamp.js` – reads the recording date and builds the stamp
- `vendor/ffmpeg`, `vendor/core` – ffmpeg.wasm 0.12 (MIT wrapper; the ffmpeg core is GPL)
- `fonts/VCR_OSD_MONO.woff` – VCR OSD Mono by Riciery Leal (free font)
