# Chrome Web Store Listing — English

填写位置：开发者控制台 → 新建商品 → 上传 zip 后，在各标签页逐项粘贴。

## Store listing

- **Name**: Video Fullscreen Helper
- **Summary** (≤132 chars):

```
Force the current tab's video to fill the window — web fullscreen that works even when the site's own button is broken.
```

- **Category**: Productivity
- **Language**: English (add 简体中文 as a second listing language, paste from listing.zh-CN.md)

### Description

```
Many video sites ship a broken "web fullscreen" button — the video only goes properly fullscreen. Video Fullscreen Helper fixes this by forcing the video in the current tab to fill the window itself.

TWO MODES

• Web fullscreen — the video fills the entire browser window, while the browser stays windowed (taskbar and other windows remain visible)
• Full fullscreen — the browser enters fullscreen mode and the video fills the whole screen

WHY IT WORKS WHEN THE SITE'S OWN BUTTON DOESN'T

• Applies forced inline styles to the player container, the <video> element, or the embedded iframe — no reliance on site CSS
• Anti-occlusion: site headers, sidebars, floating widgets and dialogs that would cover the video are detected and handled automatically
• Adapts when the site rewrites its layout, replaces the video element (e.g. quality switching) or pops up new overlays mid-playback
• Everything is snapshotted on entry and fully restored on exit — no traces left behind

USAGE

• Click the toolbar icon and choose a mode; the popup closes automatically on success
• Press Esc in the page to exit (full fullscreen also restores the browser window to its previous state)
• Optional: show the browser's native video controls, or stretch the video to fill the window
• Keyboard shortcuts are unbound by default — set them at chrome://extensions/shortcuts

PRIVACY

This extension does not collect, transmit or sell any data. All processing happens locally in your browser, on the page you invoke it on. No analytics, no remote code, no external requests.
```

## Privacy practices

### Single purpose

```
Lets the user force the video playing in the current tab to fill the browser window (or the whole screen) via a popup or a keyboard shortcut.
```

### Permission justifications

- **host permissions (http/https, all sites)**:

```
Video sites are arbitrary, so the bundled content script must be able to run on any http(s) page. On the page where the user invokes the extension, the script only locates the <video>/player element and applies fullscreen styles. It reads no page content, collects no data, and communicates with no server.
```

- **activeTab**:

```
Grants one-time access to the active tab when the user clicks the extension button or invokes its shortcut, so the fullscreen command can be sent to that tab.
```

- **scripting**:

```
Used only as a fallback to inject the bundled content script when a page has none yet (e.g. it was loaded before the extension), so the fullscreen command can run on it. Only local, bundled code is ever executed.
```

- **storage**:

```
Stores the user's two interface preferences (show native controls, stretch to fill) locally on the device.
```

### Data usage disclosures

勾选/声明（均为"否"）：

- [ ] I do not collect or use any user data *(勾选此项后隐私政策为选填)*
- Privacy policy URL（选填，已上线）: `https://weibobo.github.io/full-screen-video/`
- Remote code: none — the extension executes only bundled code
- Ads: no; Analytics: no; Data sold or transferred: no

## Screenshots (需自备)

- 至少 1 张，1280×800（或 640×400），建议 3–5 张：
  1. 弹窗界面（两个模式按钮 + 选项）
  2. 网页全屏效果：视频铺满窗口、任务栏可见，站点原布局被视频盖住
  3. 整个全屏效果
  4. （可选）播放中被遮挡元素自动处理的对比图
- 放到 `store/` 目录存档（screenshots 不会被打进 zip）
