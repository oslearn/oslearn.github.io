/* NexT-compatible local search. Index data and query text are never HTML. */
'use strict';
(function(global) {
  function escape(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function safePath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\?#\x00-\x1f]/.test(value)) return false;
    try { const decoded = decodeURIComponent(value); return !/[\\\x00-\x1f]/.test(decoded) && !decoded.split('/').some(part => part === '.' || part === '..'); } catch { return false; }
  }
  function validateRows(rows) {
    if (!Array.isArray(rows) || rows.length > 5000) throw new Error('Invalid search index.');
    const seen = new Set();
    return rows.map(row => {
      if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 1000 ||
          typeof row.content !== 'string' || row.content.length > 500000 || !safePath(row.url) || seen.has(row.url)) {
        throw new Error('Invalid search entry.');
      }
      seen.add(row.url);
      return { title: row.title, content: row.content, url: row.url };
    });
  }
  function highlight(text, keywords) {
    const escaped = keywords.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!escaped.length) return escape(text);
    const pattern = new RegExp(escaped.join('|'), 'giu');
    let output = '', start = 0;
    for (const match of text.matchAll(pattern)) {
      output += escape(text.slice(start, match.index)) + '<mark class="search-keyword">' + escape(match[0]) + '</mark>';
      start = match.index + match[0].length;
    }
    return output + escape(text.slice(start));
  }
  class LocalSearch {
    constructor({ path }) { this.path = path; this.datas = []; this.isfetched = false; this.promise = null; }
    getResultItems(input) {
      const keywords = [...new Set(input.map(key => String(key).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
      if (!keywords.length) return [];
      return this.datas.flatMap((row, id) => {
        const title = row.title.toLowerCase(), content = row.content.toLowerCase();
        if (!keywords.every(key => title.includes(key) || content.includes(key))) return [];
        const positions = keywords.map(key => content.indexOf(key)).filter(position => position >= 0);
        const first = positions.length ? Math.min(...positions) : 0;
        const start = Math.max(0, first - 30), end = Math.min(row.content.length, first + 140);
        const preview = (start ? '…' : '') + row.content.slice(start, end) + (end < row.content.length ? '…' : '');
        return [{ id, includedCount: keywords.length, hitCount: keywords.filter(key => title.includes(key)).length * 10 + positions.length,
          item: `<li><a href="${escape(row.url)}" class="search-result-title">${highlight(row.title, keywords)}</a><p class="search-result">${highlight(preview, keywords)}</p></li>` }];
      });
    }
    // Body highlighting is not required for the first-stage search; avoid
    // modifying code, diagrams, or article markup based on URL parameters.
    highlightSearchWords() {}
    fetchData() {
      if (this.isfetched) return Promise.resolve(true);
      if (this.promise) return this.promise;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      this.promise = (async () => {
        try {
          if (this.path !== '/search.xml') throw new Error('Unexpected search index path.');
          const response = await fetch(this.path, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
          if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('Search index unavailable.');
          const xml = await response.text();
          if (new TextEncoder().encode(xml).length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid search XML.');
          const document = new DOMParser().parseFromString(xml, 'application/xml');
          if (document.querySelector('parsererror') || document.documentElement.tagName !== 'search') throw new Error('Invalid search XML.');
          const rows = [...document.documentElement.children].map(entry => {
            if (entry.tagName !== 'entry' || [...entry.children].map(item => item.tagName).join(',') !== 'title,url,content') throw new Error('Invalid search schema.');
            return { title: entry.children[0].textContent, url: entry.children[1].textContent, content: entry.children[2].textContent };
          });
          this.datas = validateRows(rows); this.isfetched = true;
          global.dispatchEvent(new Event('search:loaded'));
          return true;
        } catch {
          const container = global.document.querySelector('.search-result-container');
          if (container) {
            container.classList.remove('no-result'); container.replaceChildren();
            const message = global.document.createElement('p');
            message.textContent = '暂时无法加载搜索索引。文章仍可正常阅读，可重试或前往全站归档。';
            const retry = global.document.createElement('button'); retry.type = 'button'; retry.textContent = '重新加载';
            retry.addEventListener('click', () => { this.promise = null; this.fetchData(); });
            const link = global.document.createElement('a'); link.href = '/archives/'; link.textContent = '查看归档';
            container.append(message, retry, global.document.createTextNode(' · '), link);
          }
          return false;
        } finally { clearTimeout(timer); }
      })();
      return this.promise;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { LocalSearch, escape, safePath, validateRows, highlight };
  else global.LocalSearch = LocalSearch;
})(typeof window !== 'undefined' ? window : globalThis);
