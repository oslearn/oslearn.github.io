'use strict';
(function() {
  function enhance() {
    document.querySelectorAll('.copy-btn').forEach(button => {
      button.setAttribute('role', 'button'); button.tabIndex = 0; button.setAttribute('aria-label', '复制代码');
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
      });
    });
    document.querySelectorAll('.post-body .table-container').forEach(container => {
      container.tabIndex = 0; container.setAttribute('role', 'region'); container.setAttribute('aria-label', '文章表格，可横向滚动');
      const table = container.querySelector('table');
      if (table && table.querySelectorAll('tr:first-child th, tr:first-child td').length >= 3) table.classList.add('wide-table');
    });
    const popup = document.querySelector('.search-popup');
    if (!popup) return;
    popup.id = 'site-search-dialog'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-label', '全文搜索');
    const input = popup.querySelector('.search-input'), close = popup.querySelector('.popup-btn-close');
    input.setAttribute('aria-label', '搜索文章标题和正文');
    const results = popup.querySelector('.search-result-container');
    results.setAttribute('aria-live', 'polite'); results.setAttribute('aria-atomic', 'false');
    function explainSearchState() {
      if (!results.classList.contains('no-result') || results.querySelector('.search-help')) return;
      const message = document.createElement('p'); message.className = 'search-help';
      message.textContent = results.querySelector('.fa-spinner') ? '正在加载搜索索引…' :
        (input.value.trim() ? '未找到匹配文章，请尝试其他关键词。' : '输入关键词搜索公开文章标题和正文。');
      results.append(message);
    }
    new MutationObserver(explainSearchState).observe(results, { childList: true });
    explainSearchState();
    close.tabIndex = 0; close.setAttribute('aria-label', '关闭全文搜索');
    let opener = null;
    const triggers = [...document.querySelectorAll('.popup-trigger')];
    function restore() {
      triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
      if (opener) opener.focus();
    }
    triggers.forEach(trigger => {
      trigger.tabIndex = 0; trigger.setAttribute('aria-controls', popup.id); trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', () => { opener = trigger; triggers.forEach(item => item.setAttribute('aria-expanded', 'true')); });
      trigger.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !trigger.matches('button')) { event.preventDefault(); trigger.click(); }
      });
    });
    close.addEventListener('click', restore);
    close.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close.click(); }
    });
    document.querySelector('.search-pop-overlay').addEventListener('click', event => {
      if (event.target === event.currentTarget) restore();
    });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('search-active')) return;
      if (event.key === 'Escape') { event.preventDefault(); close.click(); return; }
      if (event.key !== 'Tab') return;
      const targets = [...popup.querySelectorAll('a[href], button, input, [tabindex="0"]')];
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', enhance, { once: true });
  else enhance();
})();
