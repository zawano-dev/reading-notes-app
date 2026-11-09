/* 頁間 v5｜公開單篇閱讀頁，不讀取書架，僅執行 share_read(token) */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const RICH_PREFIX = 'RJ_RICH_NOTE_V1:';
  const conf = window.READING_NOTES_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  // UUID v4（及其他合法 UUID）形式才會向資料庫發送要求。
  const validToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  let toastTimer;

  function showUnavailable(message) {
    $('loading').hidden = true;
    $('reading').hidden = true;
    $('unavailable').hidden = false;
    if (message) $('unavailable-explainer').textContent = message;
  }
  function addMeta(text) {
    const node = document.createElement('span');
    node.textContent = text;
    $('metadata').append(node);
  }
  function safeHref(raw) {
    const val = String(raw || '').trim();
    if (!val || val.length > 2048 || !/^https?:\/\//i.test(val)) return null;
    try {
      const url = new URL(val);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }
  // HTML 永遠不直接寫進畫面；只能重建白名單中的標籤及安全外連。
  function clean(node) {
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        fragment.append(document.createTextNode(child.nodeValue || ''));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') fragment.append(document.createElement('br'));
        else if (tag === 'a') {
          const url = safeHref(child.getAttribute('href'));
          if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.rel = 'noopener noreferrer';
            a.target = '_blank';
            a.referrerPolicy = 'no-referrer';
            a.append(clean(child));
            fragment.append(a);
          } else fragment.append(clean(child));
        } else if (['strong', 'b', 'u', 'p', 'div'].includes(tag)) {
          const safe = document.createElement(tag === 'b' ? 'strong' : tag);
          safe.append(clean(child));
          fragment.append(safe);
        } else fragment.append(clean(child));
      }
    }
    return fragment;
  }
  function renderContent(value) {
    const target = $('note-content');
    const content = String(value || '');
    if (!content.startsWith(RICH_PREFIX)) {target.textContent = content; return;}
    const template = document.createElement('template');
    template.innerHTML = content.slice(RICH_PREFIX.length);
    target.classList.add('rich');
    target.replaceChildren(clean(template.content));
  }
  function display(data) {
    const bookTitle = String(data.book_title || '').trim() || '未命名資料';
    document.title = '閱讀摘記｜' + bookTitle;
    $('book-title').textContent = bookTitle;
    const chapter = String(data.chapter || '').trim();
    $('note-chapter').hidden = !chapter;
    $('note-chapter').textContent = chapter ? '章節｜' + chapter : '';
    $('book-author').hidden = !String(data.book_author || '').trim();
    $('book-author').textContent = data.book_author ? '作者｜' + data.book_author : '';
    $('metadata').replaceChildren();
    if (data.page_number != null) addMeta('第 ' + data.page_number + ' 頁');
    renderContent(data.content);
    $('loading').hidden = true;
    $('reading').hidden = false;
  }
  async function start() {
    if (!validToken) {showUnavailable(); return;}
    if (!/^https:\/\/[^\s]+\.supabase\.co\/?$/i.test(String(conf.supabaseUrl || '')) || !conf.supabasePublishableKey) {
      showUnavailable('分享頁設定不完整。請聯絡分享者。'); return;
    }
    try {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      await new Promise((resolve, reject) => {script.onload = resolve;script.onerror = reject;document.head.append(script);});
      if (!window.supabase) throw Error('supabase library failed');
      const client = window.supabase.createClient(conf.supabaseUrl.trim(), conf.supabasePublishableKey.trim(), {
        auth: {persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}
      });
      const {data, error} = await client.rpc('share_read', {p_token:token});
      if (error) throw error;
      if (!data || typeof data !== 'object' || !('content' in data)) {showUnavailable();return;}
      display(data);
    } catch (err) {
      console.warn('Unable to load shared note:', err);
      showUnavailable('目前無法載入這則筆記，可能是網路暫時無法連線，或分享連結已失效。');
    }
  }
  // 僅公開卡片禁止右鍵、拖曳選字。外部連結保留左鍵點擊能力。
  $('reading').addEventListener('selectstart', (event) => event.preventDefault());
  $('reading').addEventListener('dragstart', (event) => event.preventDefault());
  $('reading').addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const tip = $('context-toast');
    tip.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => tip.classList.remove('visible'), 2200);
  });
  // 公開頁內容較長時才顯示；不影響卡片限制選字、右鍵或外部連結。
  const backToTop = $('back-to-top');
  function updateBackToTop() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const enoughContent = document.documentElement.scrollHeight > window.innerHeight + 160;
    const show = enoughContent && scrollTop > 320;
    backToTop.classList.toggle('visible', show);
    backToTop.setAttribute('aria-hidden', show ? 'false' : 'true');
    backToTop.tabIndex = show ? 0 : -1;
  }
  backToTop.addEventListener('click', () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({top: 0, behavior: reduceMotion ? 'auto' : 'smooth'});
  });
  window.addEventListener('scroll', updateBackToTop, {passive:true});
  window.addEventListener('resize', updateBackToTop, {passive:true});
  // 非同步讀取筆記後版面才變長，載入完成時同步檢查按鈕狀態。
  const viewObserver = new MutationObserver(updateBackToTop);
  viewObserver.observe($('reading'), {attributes:true,attributeFilter:['hidden']});
  updateBackToTop();
  void start();
})();
