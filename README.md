<div align="center">

# Video Fullscreen Helper

Force the video in the current tab to fill the window — no reliance on the site's own web-fullscreen button

![Chrome](https://img.shields.io/badge/Chrome-%E2%89%A5110-4285F4?logo=googlechrome&logoColor=white)
![Manifest](https://img.shields.io/badge/Manifest-V3-34A853)
![i18n](https://img.shields.io/badge/UI-English%20%7C%20%E4%B8%AD%E6%96%87-8B5CF6)
![License](https://img.shields.io/badge/License-MIT-blue)

**English** · [简体中文](./README.zh-CN.md)

</div>

---

Many video sites ship a broken "web fullscreen" button, leaving only real fullscreen usable. This extension rewrites the page styles directly and forces the video to fill the browser window:

| Mode | Effect |
| --- | --- |
| 🖥️ **Web fullscreen** | The video fills the entire browser window, while the browser itself stays windowed (taskbar and other windows remain visible) |
| 📺 **Full fullscreen** | The browser enters fullscreen mode and the video fills the whole screen |

## ✨ Features

- **Bypasses broken site web-fullscreen** — injects forced inline styles into the player container / `<video>` / cross-origin `iframe`; works on any site
- **Occlusion handling** — detects and deals with headers, sidebars, floating widgets and dialogs covering the video (stacking-context neutralization → precise occluder hiding → top-layer remount, escalating step by step)
- **Cross-origin iframe players** — the top frame fills the iframe while the sub-frame fills the video, working in tandem
- **Traceless restore** — snapshots every modified style and DOM position on entry, restores them one by one on exit
- **Adapts to site changes** — a `MutationObserver` watches for style rewrites, video element replacement (e.g. quality switching) and overlays popping up mid-playback
- **Bilingual UI** — follows the browser language, falling back to English for unsupported languages

## 📦 Installation

> The extension is not on the Chrome Web Store; load it locally in developer mode.

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the project root directory
4. (Optional) To use it on local `file://` videos, enable **Allow access to file URLs** on the extension details page

## 🚀 Usage

### Basics

- Click the toolbar icon and choose **Web fullscreen** or **Full fullscreen**; the popup closes automatically on success (an in-page toast shows "Web fullscreen · Esc to exit")
- Press <kbd>Esc</kbd> in the page to exit; in full-fullscreen mode the browser window is also restored to its previous state (normal/maximized)
- You can also reopen the popup and click the exit button; while active, clicking the other mode's button switches modes directly

### Keyboard shortcuts

None are bound by default. To set them, go to `chrome://extensions/shortcuts` and assign keys for **Web fullscreen** / **Full fullscreen**.

### Options

| Option | Description | Default |
| --- | --- | --- |
| Show native controls | When targeting the `<video>` element directly (fallback when the container approach fails), show the browser's native controls to compensate for the covered site controls | On |
| Stretch to fill | `object-fit: fill` — the video stretches to fill the window; off means `contain` (keeps aspect ratio, may letterbox) | Off |

## 🔧 How it works

```text
┌─ background.js (service worker) ──────────────────────────┐
│ · Dispatches keyboard commands                            │
│ · Full fullscreen: chrome.windows.update + state restore  │
│ · Cross-frame sync on user-initiated exit (Esc / F11)     │
└──────────────┬────────────────────────────────────────────┘
               │ chrome.tabs.sendMessage (broadcast to all frames)
┌──────────────▼────────────────────────────────────────────┐
│ content.js (one per frame)                                 │
│ · Target picking: player container → <video> → largest     │
│   iframe                                                   │
│ · Forced styles: position:fixed + 100vw/100vh + max z      │
│ · Anti-occlusion ladder (re-checked via elementsFromPoint  │
│   sampling after each step)                                │
│ · Snapshot & restore / MutationObserver reassert / shadow  │
│   DOM traversal                                            │
└───────────────────────────────────────────────────────────┘
```

The anti-occlusion ladder (`z-index` cannot cross stacking contexts — the root cause of "the video isn't on the top layer"):

1. **Neutralize ancestor stacking contexts** — ancestors with `opacity` / `contain` / `transform` / `position:relative + z-index` etc. trap the video in a low layer; unmake them one by one
2. **Precisely hide occluders** — use `elementsFromPoint` at 12 sample points to find the foreign elements actually painting on top, and hide exactly those
3. **Broadly hide overlays** — fixed/sticky elements, high z-index absolutes, top-layer dialogs/popovers
4. **Top-layer remount** — move the target's DOM into a dedicated fullscreen mount host, escaping all ancestor contexts in one step (except iframes — moving them destroys the browsing context and reloads the page)

## 📁 Project layout

```text
.
├── manifest.json          # MV3 manifest (commands, content_scripts, i18n)
├── background.js          # service worker: window fullscreen, shortcuts, sync
├── content.js             # content script: target picking, fill, anti-occlusion
├── popup.html/js/css      # toolbar popup
├── _locales/              # en / zh_CN message catalogs
├── icons/                 # extension icons
└── tools/gen-icons.ps1    # icon generation script (PowerShell)
```

## ⚠️ Known limitations

- DRM players rendering to a canvas (with the `<video>` as a hidden data source) cannot be handled
- When targeting the `<video>` element directly, the site's own control bar gets covered — use the "native controls" option or the site's global shortcuts (space, arrow keys, etc.)
- A few sites rewrite layout with JS every frame and may fight the extension (the reassert mechanism usually wins)
- Fully transparent overlays with `pointer-events: none` cannot be detected

## 🛠️ Development

Regenerate the icons (after editing `tools/gen-icons.ps1`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-icons.ps1
```

## 📄 License

[MIT](./LICENSE)
