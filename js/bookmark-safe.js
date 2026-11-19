/* Preserve NexT's reading-position widget, including storage-denied fallback. */
'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const link = document.querySelector('.book-mark-link');
  if (!link) return;
  const key = 'bookmark' + location.pathname;
  link.setAttribute('aria-label', '保存阅读位置');
  function save() {
    try { localStorage.setItem(key, String(window.scrollY)); return true; }
    catch { link.setAttribute('aria-label', '本机存储不可用，无法保存阅读位置'); return false; }
  }
  function restore() {
    if (location.hash) return;
    let top;
    try { top = Number.parseInt(localStorage.getItem(key), 10); } catch { return; }
    if (!Number.isFinite(top) || top < 0) return;
    if (typeof window.anime === 'function') window.anime({ targets: document.scrollingElement, duration: 200, easing: 'linear', scrollTop: top });
    else window.scrollTo(0, top);
  }
  window.addEventListener('scroll', () => link.classList.toggle('book-mark-link-fixed', window.scrollY === 0), { passive: true });
  if (CONFIG.bookmark.save === 'auto') { window.addEventListener('beforeunload', save); document.addEventListener('pjax:send', save); }
  link.addEventListener('click', save); document.addEventListener('pjax:success', restore); restore();
});
