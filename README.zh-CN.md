<div align="center">

# 视频全屏助手

**Video Fullscreen Helper** —— 把当前标签页里的视频强制铺满窗口，不依赖站点自带的网页全屏按钮

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/agkkfbdanhjlnknonofjnkbelgeaebhm?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/video-fullscreen-helper/agkkfbdanhjlnknonofjnkbelgeaebhm)
![Chrome](https://img.shields.io/badge/Chrome-%E2%89%A5110-4285F4?logo=googlechrome&logoColor=white)
![Manifest](https://img.shields.io/badge/Manifest-V3-34A853)
![i18n](https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87%20%7C%20English-8B5CF6)
![License](https://img.shields.io/badge/License-MIT-blue)

**[➕ 从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/video-fullscreen-helper/agkkfbdanhjlnknonofjnkbelgeaebhm)**

[English](./README.md) · **简体中文**

</div>

---

很多视频站点自带的"网页全屏"根本没用，只剩真全屏可用。这个扩展通过直接改写页面样式，把视频强制铺满浏览器窗口：

| 模式 | 效果 |
| --- | --- |
| 🖥️ **网页全屏** | 视频占满整个浏览器窗口，浏览器保持窗口状态（能看到任务栏和其他窗口） |
| 📺 **整个全屏** | 浏览器进入全屏模式，视频占满整个屏幕 |

## ✨ 特性

- **绕过站点失效的网页全屏** —— 直接给播放器容器 / `<video>` / 跨域 `iframe` 强制内联样式，任何站点都能生效
- **防遮挡** —— 自动检测并处理顶栏、侧栏、悬浮挂件、弹窗等覆盖物（层叠上下文中和 → 精确隐藏遮挡元素 → 顶层挂载，逐级升级）
- **跨域 iframe 播放器支持** —— 顶层铺 iframe、子层铺视频，双层配合
- **无痕还原** —— 进入前对所有被修改的样式和 DOM 位置做快照，退出时逐条还原
- **自适应站点变化** —— `MutationObserver` 监听站点改写样式、更换视频元素（如切换清晰度）、中途弹出的浮层
- **中英双语界面** —— 按浏览器语言自动切换，非支持语言回落英文

## 📦 安装

### 从 Chrome 应用商店安装（推荐）

[**点击安装视频全屏助手**](https://chromewebstore.google.com/detail/video-fullscreen-helper/agkkfbdanhjlnknonofjnkbelgeaebhm)

### 从源码加载（开发者模式）

1. 打开 `chrome://extensions/`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本项目根目录
4. （可选）如需在本地 `file://` 视频文件上使用，在扩展详情页开启 **允许访问文件网址**

## 🚀 使用

### 基本操作

- 点击工具栏图标，选择 **网页全屏** 或 **整个全屏**；动作成功后弹窗自动关闭（页面内会出现"已网页全屏 · Esc 退出"提示气泡）
- 页面内按 <kbd>Esc</kbd> 退出；整个全屏模式下退出时会把浏览器窗口一并还原为之前的状态（普通/最大化）
- 也可以重新打开弹窗点击退出按钮；已激活时点击另一个模式按钮可直接切换

### 快捷键

默认不绑定。需要的话到 `chrome://extensions/shortcuts` 为 **网页全屏** / **整个全屏** 自行设置。

### 选项

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| 显示原生控制条 | 直接改 `<video>` 元素时（容器方案失败的回退），显示浏览器原生控制条，弥补站点控制条被盖住的问题 | 开 |
| 拉伸铺满窗口 | `object-fit: fill`，视频变形铺满窗口；关闭则 `contain`（保留比例，可能留黑边） | 关 |

## 🔧 工作原理

```text
┌─ background.js (service worker) ──────────────────────────┐
│ · 快捷键命令分发                                          │
│ · 整个全屏：chrome.windows.update 全屏切换 + 原状态还原    │
│ · Esc / F11 自发退出的跨 frame 同步                       │
└──────────────┬────────────────────────────────────────────┘
               │ chrome.tabs.sendMessage（广播到所有 frame）
┌──────────────▼────────────────────────────────────────────┐
│ content.js（每个 frame 一份）                               │
│ · 目标选择：播放器容器 → <video> → 最大 iframe              │
│ · 强制样式：position:fixed + 100vw/100vh + 最大 z-index    │
│ · 防遮挡升级阶梯（每步后用 elementsFromPoint 采样复测）     │
│ · 快照与还原 / MutationObserver 重申 / shadow DOM 穿透     │
└───────────────────────────────────────────────────────────┘
```

防遮挡的升级阶梯（`z-index` 无法穿越层叠上下文，这是"视频不在顶层"问题的根源）：

1. **中和祖先层叠上下文** —— 祖先带 `opacity` / `contain` / `transform` / `position:relative + z-index` 等都会把视频困在低层级，逐层拆掉
2. **精确隐藏遮挡元素** —— 用 `elementsFromPoint` 在 12 个采样点找出真正压在最上层的外来元素，命中什么藏什么
3. **广谱隐藏浮层** —— fixed/sticky、高 z-index 的 absolute、top-layer 的 dialog/popover
4. **顶层挂载** —— 把目标 DOM 移到独立的全屏挂载点，一步跳出所有祖先上下文（iframe 除外——移动会销毁 browsing context 导致整页重载）

## 📁 目录结构

```text
.
├── manifest.json          # MV3 清单（commands、content_scripts、i18n）
├── background.js          # service worker：窗口全屏、快捷键、状态同步
├── content.js             # 内容脚本：目标选择、样式填充、防遮挡、还原
├── popup.html/js/css      # 工具栏弹窗
├── _locales/              # en / zh_CN 语言包
├── icons/                 # 扩展图标
└── tools/gen-icons.ps1    # 图标生成脚本（PowerShell）
```

## ⚠️ 已知限制

- DRM 播放器渲染到 canvas 的站点（`<video>` 只是隐藏数据源）无法处理
- 直接改 `<video>` 元素时，站点控制条会被盖住——用"原生控制条"选项或站点全局快捷键（空格、方向键等）
- 极少数站点用 JS 每帧重写布局，可能与扩展互相拉扯（有重申机制，一般能赢）
- `pointer-events: none` 且完全透明的覆盖层无法被检测到

## 🛠️ 开发

重新生成图标（修改 `tools/gen-icons.ps1` 后执行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/gen-icons.ps1
```

打包 Chrome 应用商店分发 zip（只含运行时文件、去掉 `file://` 权限），输出到 `dist/`：

```bash
node tools/pack.js
```

商店文案（描述、权限用途说明等）在 [`store/`](./store) 目录。

## 📄 许可证

[MIT](./LICENSE)

**隐私** —— 本扩展不收集任何数据，见[隐私政策](https://weibobo.github.io/full-screen-video/)。
