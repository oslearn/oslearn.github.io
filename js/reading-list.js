/* Versioned browser-local reading state. Never sends personal state to a server. */
'use strict';
(function(global) {
  const KEY = 'oslearning.reading-list.v1', MAX_ENTRIES = 500, MAX_BYTES = 128 * 1024;
  function safePath(value) {
    if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('/') || value.startsWith('//') || /[\\?#\x00-\x1f]/.test(value)) return false;
    try { const decoded = decodeURIComponent(value); return !/[\\\x00-\x1f]/.test(decoded) && !decoded.split('/').some(part => part === '.' || part === '..'); } catch { return false; }
  }
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'entries,schema_version' || value.schema_version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) throw new Error('备份格式或版本无效。');
    const seen = new Set();
    const entries = value.entries.map(entry => {
      if (!entry || Object.keys(entry).sort().join(',') !== 'changed_at,read,saved,url' || !safePath(entry.url) || seen.has(entry.url) ||
          typeof entry.saved !== 'boolean' || typeof entry.read !== 'boolean' || !(entry.saved || entry.read) ||
          !Number.isSafeInteger(entry.changed_at) || entry.changed_at < 0 || entry.changed_at > 8640000000000000) throw new Error('备份包含无效或重复的阅读记录。');
      seen.add(entry.url); return { url: entry.url, saved: entry.saved, read: entry.read, changed_at: entry.changed_at };
    });
    const result = { schema_version: 1, entries };
    if (new TextEncoder().encode(JSON.stringify(result, null, 2) + '\n').length > MAX_BYTES) throw new Error('阅读记录总大小超出备份上限。');
    return result;
  }
  function parseBackup(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('备份文件过大。');
    return validate(JSON.parse(text));
  }
  function empty() { return { schema_version: 1, entries: [] }; }
  class Store {
    constructor(storageFactory = () => global.localStorage, now = () => Date.now()) {
      this.storageFactory = storageFactory; this.now = now; this.storage = null; this.data = empty(); this.warning = '';
      try { this.storage = storageFactory(); const text = this.storage.getItem(KEY); if (text !== null) this.data = parseBackup(text); }
      catch { this.storage = null; this.warning = '本机存储不可用或记录格式异常；本页仅临时保存状态，切换或关闭页面会丢失。'; }
    }
    find(url) { return this.data.entries.find(entry => entry.url === url) || { url, saved: false, read: false, changed_at: 0 }; }
    write() {
      try { if (!this.storage) throw new Error('Storage unavailable'); this.storage.setItem(KEY, JSON.stringify(this.data)); this.warning = ''; return true; }
      catch { this.warning = '无法写入本机存储；本次状态仅在当前页有效，请导出备份。'; return false; }
    }
    set(url, flag, value) {
      if (!safePath(url) || !['saved', 'read'].includes(flag) || typeof value !== 'boolean') throw new Error('无效阅读操作。');
      const previous = this.find(url), next = { ...previous, [flag]: value, changed_at: this.now() };
      const entries = this.data.entries.filter(entry => entry.url !== url);
      if (next.saved || next.read) entries.push(next);
      this.data = validate({ schema_version: 1, entries }); this.write();
    }
    remove(url) { this.data.entries = this.data.entries.filter(entry => entry.url !== url); this.write(); }
    export() { return JSON.stringify(validate(this.data), null, 2) + '\n'; }
    merge(text, knownURLs) {
      const incoming = parseBackup(text), current = new Set(this.data.entries.map(entry => entry.url));
      const entries = [...this.data.entries]; let added = 0, preserved = 0, skipped = 0;
      for (const entry of incoming.entries) {
        if (!knownURLs.has(entry.url)) { skipped++; continue; }
        if (current.has(entry.url)) { preserved++; continue; }
        entries.push(entry); current.add(entry.url); added++;
      }
      const merged = validate({ schema_version: 1, entries });
      this.data = merged;
      if (!this.storage) { try { this.storage = this.storageFactory(); } catch {} }
      this.write(); return { added, preserved, skipped };
    }
    clear() {
      this.data = empty();
      try { if (!this.storage) this.storage = this.storageFactory(); this.storage.removeItem(KEY); this.warning = ''; }
      catch { this.storage = null; this.warning = '本机存储不可用；已清空当前页的临时记录。'; }
    }
  }
  function parseCatalog(xml) {
    if (new TextEncoder().encode(xml).length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('公开目录格式异常。');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.querySelector('parsererror') || document.documentElement.tagName !== 'reading-catalog' || document.documentElement.attributes.length) throw new Error('公开目录格式异常。');
    const map = new Map();
    for (const entry of document.documentElement.children) {
      if (entry.tagName !== 'entry' || entry.attributes.length || [...entry.children].some(e => e.attributes.length || e.children.length) || [...entry.children].map(e => e.tagName).join(',') !== 'url,title,published,updated') throw new Error('公开目录字段异常。');
      const [url, title, published, updated] = [...entry.children].map(e => e.textContent);
      if (!safePath(url) || !title || map.has(url) || !Number.isFinite(Date.parse(published)) || !Number.isFinite(Date.parse(updated))) throw new Error('公开目录条目异常。');
      map.set(url, { url, title, published, updated });
      if (map.size > 5000) throw new Error('公开目录过大。');
    }
    return map;
  }
  function mount() {
    const tools = [...global.document.querySelectorAll('.reading-tools')], page = global.document.querySelector('#reading-list-page');
    if (!tools.length && !page) return;
    const store = new Store(); let known = new Map(), ready = false, filter = 'saved';
    const document = global.document;
    function element(tag, text, attributes = {}) {
      const node = document.createElement(tag); if (text !== null) node.textContent = text;
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      return node;
    }
    function announce(text) {
      const message = store.warning ? text + ' ' + store.warning : text;
      tools.forEach(tool => { tool.querySelector('.reading-tool-status').textContent = message; });
      if (page) page.querySelector('#reading-status').textContent = message;
    }
    function render() {
      for (const tool of tools) {
        const state = store.find(tool.dataset.readingUrl);
        const save = tool.querySelector('[data-reading-save]'), read = tool.querySelector('[data-reading-read]');
        save.setAttribute('aria-pressed', String(state.saved)); save.textContent = state.saved ? '已加入稍后阅读' : '加入稍后阅读';
        read.setAttribute('aria-pressed', String(state.read)); read.textContent = state.read ? '已读（标为未读）' : '标记已读';
      }
      if (!page) return;
      const host = page.querySelector('#reading-items'); host.replaceChildren();
      const selected = store.data.entries.filter(e => filter === 'all' || (filter === 'saved' ? e.saved : filter === 'read' ? e.read : !e.read))
        .sort((a, b) => b.changed_at - a.changed_at || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
      page.querySelector('#reading-count').textContent = `共 ${store.data.entries.length} 条记录，当前显示 ${selected.length} 条。`;
      page.querySelectorAll('[data-reading-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.readingFilter === filter)));
      if (!selected.length) host.append(element('p', '此筛选下暂无记录。可以在文章页加入稍后阅读或标记已读。'));
      for (const entry of selected) {
        const article = known.get(entry.url), row = element('article', null, { class: 'reading-item', 'data-reading-record': entry.url });
        const heading = element('h2', null);
        heading.append(article ? element('a', article.title, { href: article.url }) : element('span', ready ? '已不在当前公开目录中的文章' : '目录未加载，本地记录仍保留'));
        row.append(heading, element('p', `${entry.saved ? '稍后阅读' : '未收藏'} · ${entry.read ? '已读' : '未读'}`));
        if (!article) row.append(element('p', entry.url));
        for (const [action, text] of [['saved', entry.saved ? '移出稍后阅读' : '加入稍后阅读'], ['read', entry.read ? '标为未读' : '标记已读'], ['remove', '移除记录']]) {
          row.append(element('button', text, { type: 'button', 'data-reading-action': action, 'data-reading-url': entry.url }));
        }
        host.append(row);
      }
    }
    for (const tool of tools) {
      for (const flag of ['saved', 'read']) {
        tool.querySelector(flag === 'saved' ? '[data-reading-save]' : '[data-reading-read]').addEventListener('click', () => {
          try { const url = tool.dataset.readingUrl; store.set(url, flag, !store.find(url)[flag]); render(); announce('已更新本机阅读状态。'); }
          catch (error) { announce(error.message); }
        });
      }
    }
    if (page) {
      page.querySelector('#reading-import').disabled = true;
      page.querySelectorAll('[data-reading-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.readingFilter; render(); }));
      page.querySelector('#reading-items').addEventListener('click', event => {
        const button = event.target.closest('button[data-reading-action]'); if (!button) return;
        const action = button.dataset.readingAction, url = button.dataset.readingUrl;
        try {
          if (action === 'remove') store.remove(url); else store.set(url, action, !store.find(url)[action]);
          render(); announce('已更新本机阅读状态。');
          const next = [...page.querySelectorAll('[data-reading-action]')].find(b => b.dataset.readingUrl === url && b.dataset.readingAction === action);
          (next || page.querySelector('[data-reading-filter][aria-pressed="true"]')).focus();
        } catch (error) { announce(error.message); }
      });
      page.querySelector('#reading-export').addEventListener('click', () => {
        try {
          const blob = new Blob([store.export()], { type: 'application/json' }), url = URL.createObjectURL(blob);
          const link = element('a', null, { href: url, download: 'oslearning-reading-list.v1.json' }); document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000); announce('已导出当前浏览器的阅读记录，不包含其他本机存储。');
        } catch (error) { announce(error.message); }
      });
      page.querySelector('#reading-import').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
          if (!ready || file.size > MAX_BYTES) throw new Error('目录未就绪或备份文件过大。');
          const result = store.merge(await file.text(), new Set(known.keys())); render();
          announce(`已导入 ${result.added} 条，保留 ${result.preserved} 条已有状态，跳过 ${result.skipped} 条非当前公开文章记录。`);
        } catch { announce('导入失败：备份格式、版本、大小或记录不合法。本机已有状态未被导入覆盖。'); }
        event.target.value = '';
      });
      const clear = page.querySelector('#reading-clear'), confirmation = page.querySelector('#reading-clear-confirm');
      clear.addEventListener('click', () => { confirmation.hidden = false; page.querySelector('#reading-confirm-clear').focus(); });
      page.querySelector('#reading-cancel-clear').addEventListener('click', () => { confirmation.hidden = true; clear.focus(); });
      page.querySelector('#reading-confirm-clear').addEventListener('click', () => { store.clear(); confirmation.hidden = true; render(); announce('已清空本浏览器阅读记录。'); clear.focus(); });
      async function loadCatalog() {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch('/reading-catalog.xml', { signal: controller.signal, redirect: 'error', credentials: 'omit' });
          if (!response.ok || Number(response.headers.get('content-length')) > 1024 * 1024) throw new Error('目录不可用');
          known = parseCatalog(await response.text()); ready = true; page.dataset.readingReady = 'true';
          page.querySelector('#reading-import').disabled = false; render(); announce('公开目录已加载；阅读状态仅保存在本机。');
        } catch {
          render(); announce('暂时无法加载公开目录；本机记录仍保留，可导出备份或重试。');
          if (!page.querySelector('#reading-retry')) {
            const retry = element('button', '重新加载目录', { type: 'button', id: 'reading-retry' }); retry.addEventListener('click', () => { retry.remove(); loadCatalog(); }); page.querySelector('#reading-status').after(retry);
          }
        } finally { clearTimeout(timer); }
      }
      loadCatalog();
    }
    global.addEventListener('storage', event => {
      if (event.key !== KEY) return;
      try { store.data = event.newValue === null ? empty() : parseBackup(event.newValue); render(); announce('已同步本浏览器其他标签页的阅读状态。'); } catch { announce('其他标签页的记录格式异常，当前状态未覆盖。'); }
    });
    render(); if (store.warning) announce('阅读清单提示：');
  }
  const api = { KEY, MAX_ENTRIES, MAX_BYTES, safePath, validate, parseBackup, Store, parseCatalog, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    global.SiteReadingList = api;
    if (global.document.readyState !== 'complete') global.document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
