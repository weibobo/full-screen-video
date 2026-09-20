/**
 * 视频全屏助手 - service worker
 *
 * 职责：
 *  - 注册快捷键（chrome.commands），转发给当前标签页的 content script
 *  - "整个全屏"模式负责把浏览器窗口切为全屏（chrome.windows.update，
 *    绕开页面 requestFullscreen 的用户手势限制），并在退出时还原为
 *    之前的窗口状态（普通/最大化）
 *  - 用户按 Esc / F11 自发退出时，同步所有 frame 退出填充
 *  - 响应 popup 的状态查询与切换请求
 */

const SAVED_KEY = 'fsvSavedWindowStates'; // windowId -> 'normal' | 'maximized'

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (e) {
    return null;
  }
}

async function getSaved() {
  try {
    const o = await chrome.storage.session.get(SAVED_KEY);
    return o[SAVED_KEY] || {};
  } catch (e) {
    return {};
  }
}

async function setSaved(obj) {
  try { await chrome.storage.session.set({ [SAVED_KEY]: obj }); } catch (e) { /* ignore */ }
}

async function ensureInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
    return true;
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js'],
      });
      return true;
    } catch (e2) {
      return false; // 浏览器内部页面等不可注入
    }
  }
}

async function queryStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'status' }, { frameId: 0 });
  } catch (e) {
    return null;
  }
}

// 广播到所有 frame（http 页面都注入了 content script，无监听时忽略错误）
async function broadcast(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, message); } catch (e) { /* ignore */ }
}

async function restoreWindow(windowId) {
  const saved = await getSaved();
  const prev = saved[windowId];
  if (!prev) return;
  delete saved[windowId];
  await setSaved(saved);
  let win = null;
  try { win = await chrome.windows.get(windowId); } catch (e) { /* ignore */ }
  if (win && win.state === 'fullscreen') {
    try {
      await chrome.windows.update(windowId, { state: prev === 'maximized' ? 'maximized' : 'normal' });
    } catch (e) { /* ignore */ }
  }
}

async function toggleFullscreen(tabId, windowId, mode) {
  if (!(await ensureInjected(tabId))) return { ok: false, error: 'no-content' };
  const status = await queryStatus(tabId);
  const isActive = !!(status && status.active && status.mode === mode);

  if (mode === 'web') {
    await broadcast(tabId, isActive ? { type: 'exit' } : { type: 'enter', mode: 'web' });
    const after = await queryStatus(tabId);
    return { ok: true, active: !!(after && after.active), mode: 'web', status: after };
  }

  // mode === 'full'
  if (isActive) {
    await broadcast(tabId, { type: 'exit' });
    await restoreWindow(windowId);
    return { ok: true, active: false, mode: 'full' };
  }

  let win = null;
  try { win = await chrome.windows.get(windowId); } catch (e) { /* ignore */ }
  if (win && win.state !== 'fullscreen') {
    const saved = await getSaved();
    saved[windowId] = win.state === 'maximized' ? 'maximized' : 'normal';
    await setSaved(saved);
    try { await chrome.windows.update(windowId, { state: 'fullscreen' }); } catch (e) { /* ignore */ }
  }
  await broadcast(tabId, { type: 'enter', mode: 'full' });
  const after = await queryStatus(tabId);
  return { ok: true, active: !!(after && after.active), mode: 'full', status: after };
}

/* ---------------- 快捷键 ---------------- */

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || tab.id == null) return;
  if (command === 'web-fullscreen') await toggleFullscreen(tab.id, tab.windowId, 'web');
  else if (command === 'full-fullscreen') await toggleFullscreen(tab.id, tab.windowId, 'full');
});

/* ---------------- popup / content 的消息 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // 页面内按 Esc 等自发退出：同步同标签页所有 frame，必要时还原窗口
      if (msg && msg.type === 'fsv-esc-exited' && sender.tab && sender.tab.id != null) {
        await broadcast(sender.tab.id, { type: 'exit' });
        if (msg.mode === 'full' && sender.tab.windowId != null) {
          await restoreWindow(sender.tab.windowId);
        }
        sendResponse({ ok: true });
        return;
      }

      const tab = await getActiveTab();
      if (!tab || tab.id == null) { sendResponse({ ok: false, error: 'no-tab' }); return; }

      if (msg && msg.type === 'status') {
        if (!(await ensureInjected(tab.id))) {
          sendResponse({ ok: false, error: 'no-content', url: tab.url });
          return;
        }
        const s = await queryStatus(tab.id);
        if (s) sendResponse(Object.assign({ ok: true, url: tab.url }, s));
        else sendResponse({ ok: false, error: 'no-content', url: tab.url });
        return;
      }

      if (msg && msg.type === 'toggle') {
        const mode = msg.mode === 'full' ? 'full' : 'web';
        const res = await toggleFullscreen(tab.id, tab.windowId, mode);
        sendResponse(Object.assign({ url: tab.url }, res));
        return;
      }

      sendResponse({ ok: false, error: 'unknown-message' });
    } catch (e) {
      try { sendResponse({ ok: false, error: String((e && e.message) || e) }); } catch (e2) { /* ignore */ }
    }
  })();
  return true; // 异步 sendResponse
});

/* ---------------- 窗口状态变化 ---------------- */

// 用户自己按 F11 等退出浏览器全屏时，让页面填充一并退出
chrome.windows.onBoundsChanged.addListener(async (win) => {
  try {
    if (!win || win.state === 'fullscreen' || win.state === 'minimized') return;
    const saved = await getSaved();
    if (!(win.id in saved)) return;
    delete saved[win.id];
    await setSaved(saved);
    const tabs = await chrome.tabs.query({ windowId: win.id, active: true });
    for (const t of tabs) {
      if (t.id != null) await broadcast(t.id, { type: 'exit' });
    }
  } catch (e) { /* ignore */ }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const saved = await getSaved();
  if (windowId in saved) {
    delete saved[windowId];
    await setSaved(saved);
  }
});
