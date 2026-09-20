const $ = (s) => document.querySelector(s);

// 记录最近一次刷新到的页面状态，用于判断本次点击是"进入"还是"退出"
let current = { active: false, mode: null };

/* ---------------- i18n ---------------- */

// 浏览器语言命中 _locales/zh_CN 则中文，否则回落 default_locale（en）
function msg(key, subs) {
  try {
    return chrome.i18n.getMessage(key, subs) || '';
  } catch (e) {
    return '';
  }
}

function applyI18n() {
  try { document.documentElement.lang = chrome.i18n.getUILanguage() || 'en'; } catch (e) { /* ignore */ }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = msg(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = msg(el.dataset.i18nTitle);
  });
}

function kindLabel(kind) {
  if (kind === 'container') return msg('targetContainer');
  if (kind === 'video') return msg('targetVideo');
  if (kind === 'iframe') return msg('targetIframe');
  return '';
}

/* ---------------- 状态与交互 ---------------- */

function isSupportedUrl(url) {
  return /^(https?|file):/i.test(url || '');
}

async function refresh() {
  const statusEl = $('#status');
  const main = $('#main');
  const unsupported = $('#unsupported');

  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
  } catch (e) { /* ignore */ }

  if (!tab || !isSupportedUrl(tab.url)) {
    main.hidden = true;
    unsupported.hidden = false;
    return;
  }

  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: 'status' });
  } catch (e) { /* ignore */ }

  if (!res || !res.ok) {
    main.hidden = true;
    unsupported.hidden = false;
    return;
  }

  main.hidden = false;
  unsupported.hidden = true;

  current = { active: !!res.active, mode: res.mode || null };

  if (res.active) {
    const prefix = msg(res.mode === 'full' ? 'statusActiveFull' : 'statusActiveWeb');
    const k = kindLabel(res.kind);
    const zh = (() => {
      try { return chrome.i18n.getUILanguage().indexOf('zh') === 0; } catch (e) { return false; }
    })();
    statusEl.textContent = prefix + (k ? (zh ? '（' : '(') + k + (zh ? '）' : ')') : '') + ' · ' + msg('statusExit');
    statusEl.style.color = '#16a34a';
  } else {
    const n = res.videos || 0;
    statusEl.textContent = n > 0
      ? msg('statusVideos', [String(n)])
      : msg('statusNoVideo');
    statusEl.style.color = '';
  }

  $('#btn-web').classList.toggle('on', !!(res.active && res.mode === 'web'));
  $('#btn-full').classList.toggle('on', !!(res.active && res.mode === 'full'));
  $('#btn-web-label').textContent = res.active && res.mode === 'web' ? msg('btnWebActive') : msg('btnWeb');
  $('#btn-full-label').textContent = res.active && res.mode === 'full' ? msg('btnFullActive') : msg('btnFull');
}

// 点击后：动作成功（进入或退出）就关闭 popup，把画面还给页面
//（页面内已有"已网页全屏 · Esc 退出"的提示气泡做反馈）；
// 失败（没找到视频、页面不支持等）则留在弹窗里显示原因。
async function onToggle(mode) {
  $('#btn-web').disabled = true;
  $('#btn-full').disabled = true;
  const wasActive = current.active && current.mode === mode;
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: 'toggle', mode });
  } catch (e) { /* ignore */ }
  const entered = !!(res && res.ok && res.active);
  const exited = !!(res && res.ok && !res.active && wasActive);
  if (entered || exited) {
    window.close();
    return;
  }
  await refresh();
  $('#btn-web').disabled = false;
  $('#btn-full').disabled = false;
}

async function loadOpts() {
  try {
    const o = await chrome.storage.local.get({ nativeControls: true, stretchFill: false });
    $('#opt-native').checked = !!o.nativeControls;
    $('#opt-fill').checked = !!o.stretchFill;
  } catch (e) { /* ignore */ }
}

$('#btn-web').addEventListener('click', () => onToggle('web'));
$('#btn-full').addEventListener('click', () => onToggle('full'));

$('#opt-native').addEventListener('change', (e) => {
  chrome.storage.local.set({ nativeControls: e.target.checked });
});
$('#opt-fill').addEventListener('change', (e) => {
  chrome.storage.local.set({ stretchFill: e.target.checked });
});

applyI18n();
refresh();
loadOpts();
