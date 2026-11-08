/* 頁間 Reading Journal｜無需建置工具的 GitHub Pages 版本 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const conf = window.READING_NOTES_CONFIG || {};
  const hasConfig = /^https:\/\/[^\s]+\.supabase\.co\/?$/i.test(String(conf.supabaseUrl || '').trim())
    && String(conf.supabasePublishableKey || '').trim().length >= 24
    && !String(conf.supabasePublishableKey).includes('請填入');
  const mode = hasConfig ? 'cloud' : 'demo';
  const DEMO_KEY = 'reading-journal-demo-v1';
  const RICH_PREFIX = 'RJ_RICH_NOTE_V1:';
  const CONTENT_LIMIT = 50000;
  const state = {
    user: null, books: [], notes: [], selectedBookId: null,
    bookEditId: null, noteEditId: null, authMode: 'login',
    saving: false, loadingId: 0, recoveryMode: false, expandedBookId: undefined
  };
  let client = null;
  let toastTimer = null;

  function escapeString(value) { return String(value == null ? '' : value); }
  function now() { return new Date().toISOString(); }
  function makeId() { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function formatDate(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  }
  function setSyncStatus(message) { $('sync-status').textContent = message; }
  function toast(message, isError = false) {
    const node = $('toast');
    node.textContent = message;
    node.classList.toggle('error', isError);
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3900);
  }
  function friendlyError(err) {
    const raw = escapeString(err && err.message ? err.message : err);
    if (/invalid login credentials/i.test(raw)) return '電子郵件或密碼不正確。';
    if (/email not confirmed/i.test(raw)) return '請先點開電子郵件中的驗證連結。';
    if (/rate limit|too many requests/i.test(raw)) return '操作太頻繁，請稍後再試。';
    if (/password.*least|password.*short/i.test(raw)) return '密碼長度不足，請輸入至少 8 個字元。';
    if (/failed to fetch|network|fetch failed/i.test(raw)) return '無法連線到雲端，請檢查網路及 Supabase 設定。';
    return raw || '操作失敗，請再試一次。';
  }
  function showWorkspace() {
    $('auth-screen').classList.add('hidden');
    $('workspace').classList.remove('hidden');
    $('account-tools').classList.remove('hidden');
    $('signout-btn').classList.toggle('hidden', mode === 'demo');
    $('demo-banner').classList.toggle('hidden', mode !== 'demo');
    $('account-label').textContent = mode === 'demo' ? '單機試用中' : (state.user?.email || '已登入');
  }
  function showLogin() {
    $('auth-screen').classList.remove('hidden');
    $('workspace').classList.add('hidden');
    $('account-tools').classList.add('hidden');
    setSyncStatus('請登入以同步閱讀筆記');
  }
  function readDemo() {
    try {
      const data = JSON.parse(localStorage.getItem(DEMO_KEY) || '{}');
      state.books = Array.isArray(data.books) ? data.books : [];
      state.notes = Array.isArray(data.notes) ? data.notes : [];
    } catch (err) {
      state.books = []; state.notes = [];
      toast('無法讀取這台裝置上的試用資料。', true);
    }
  }
  function writeDemo() {
    localStorage.setItem(DEMO_KEY, JSON.stringify({ books: state.books, notes: state.notes }));
    setSyncStatus('單機資料已儲存｜未啟用跨裝置同步');
  }
  function restoreDemoAfterFailure() {
    readDemo(); render();
  }
  async function fetchAll(table, columns) {
    const pageSize = 500;
    let output = [];
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await client.from(table).select(columns)
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(start, start + pageSize - 1);
      if (error) throw error;
      output = output.concat(data || []);
      if (!data || data.length < pageSize) break;
    }
    return output;
  }
  async function loadData({ quiet = false } = {}) {
    if (mode === 'demo') {
      readDemo(); render();
      setSyncStatus('單機資料已讀取｜未啟用跨裝置同步');
      return;
    }
    if (!state.user) return;
    const loadingId = ++state.loadingId;
    const userId = state.user.id;
    if (!quiet) setSyncStatus('正在同步閱讀筆記…');
    try {
      const [books, notes] = await Promise.all([
        fetchAll('books', 'id, user_id, title, author, created_at, updated_at'),
        fetchAll('notes', 'id, user_id, book_id, page_number, chapter, content, created_at, updated_at')
      ]);
      if (loadingId !== state.loadingId || state.user?.id !== userId) return;
      state.books = books; state.notes = notes;
      render();
      setSyncStatus('已同步至雲端 · ' + new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
    } catch (err) {
      if (loadingId !== state.loadingId) return;
      setSyncStatus('同步失敗｜請檢查連線');
      toast(friendlyError(err), true);
    }
  }
  function applySession(session) {
    const next = session?.user || null;
    if (!next) {
      state.loadingId++;
      state.user = null; state.books = []; state.notes = []; state.selectedBookId = null; state.expandedBookId = undefined;
      showLogin();
      return;
    }
    const isDifferent = next.id !== state.user?.id;
    state.user = next;
    showWorkspace();
    if (isDifferent) {
      state.books = []; state.notes = []; state.selectedBookId = null; state.expandedBookId = undefined;
      render();
      void loadData();
    }
  }
  function redirectUrl() { return window.location.origin + window.location.pathname; }

  async function initCloud() {
    try {
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          script.async = true;
          script.onload = resolve;
          script.onerror = () => reject(new Error('無法載入雲端程式，請檢查網路連線。'));
          document.head.append(script);
        });
      }
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        throw new Error('雲端程式載入失敗，請重新整理頁面。');
      }
      client = window.supabase.createClient(conf.supabaseUrl.trim(), conf.supabasePublishableKey.trim());
      client.auth.onAuthStateChange((event, session) => {
        applySession(session);
        if (event === 'PASSWORD_RECOVERY') {
          state.recoveryMode = true;
          setTimeout(() => openDialog('password-dialog'), 0);
        }
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      applySession(data.session);
    } catch (err) {
      showLogin();
      setAuthMessage('連線設定有問題：' + friendlyError(err), true);
    }
  }
  function setAuthMessage(msg, isError = false) {
    $('auth-message').textContent = msg;
    $('auth-message').classList.toggle('error', isError);
  }
  function updateAuthForm() {
    const signup = state.authMode === 'signup';
    const reset = state.authMode === 'reset';
    $('auth-title').textContent = signup ? '建立閱讀帳號' : reset ? '重設登入密碼' : '登入閱讀空間';
    $('auth-subtitle').textContent = signup ? '建立帳號後，你的筆記便能跨裝置同步。'
      : reset ? '我們會寄送重設密碼連結到你的信箱。' : '使用電子郵件與密碼登入。';
    $('auth-submit').textContent = signup ? '建立帳號' : reset ? '寄送重設密碼信' : '登入';
    $('password-field').classList.toggle('hidden', reset);
    $('auth-password').required = !reset;
    $('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
    $('auth-switch').textContent = signup || reset ? '返回登入' : '還沒有帳號？建立帳號';
    $('forgot-password').classList.toggle('hidden', reset || signup);
    setAuthMessage('');
  }
  async function handleAuth(event) {
    event.preventDefault();
    if (!client) { setAuthMessage('雲端服務尚未連線，請檢查網路。', true); return; }
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const btn = $('auth-submit');
    btn.disabled = true; setAuthMessage('處理中…');
    try {
      if (state.authMode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (error) throw error;
        setAuthMessage('若此信箱已註冊，將收到重設密碼信。請檢查收件匣及垃圾郵件。');
      } else if (state.authMode === 'signup') {
        const { data, error } = await client.auth.signUp({
          email, password, options: { emailRedirectTo: redirectUrl() }
        });
        if (error) throw error;
        if (!data.session) setAuthMessage('註冊申請已送出。請查看信箱中的驗證信；驗證完成後再登入。');
        else { setAuthMessage('帳號已建立。'); toast('歡迎開始你的閱讀記錄！'); }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setAuthMessage('登入成功。');
      }
    } catch (err) { setAuthMessage(friendlyError(err), true); }
    finally { btn.disabled = false; }
  }

  function currentBook() { return state.books.find((book) => book.id === state.selectedBookId) || null; }
  function notesFor(bookId) { return state.notes.filter((note) => note.book_id === bookId); }
  function getActivityTime(book) {
    const timestamps = [book.updated_at, ...notesFor(book.id).map((n) => n.updated_at)];
    return Math.max(...timestamps.map((time) => new Date(time).getTime() || 0));
  }
  function render() {
    if (!currentBook() && state.books.length) state.selectedBookId = state.books[0].id;
    if (!state.books.length) state.selectedBookId = null;
    if (state.expandedBookId === undefined || (state.expandedBookId !== null
      && !state.books.some((book) => book.id === state.expandedBookId))) {
      state.expandedBookId = state.selectedBookId;
    }
    $('book-total').textContent = String(state.books.length);
    renderBooks(); renderDetail();
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  // 書架目錄：每本書可展開筆記清單，以「章節－頁數」作為快速導覽文字。
  function noteIndexLabel(note) {
    const chapter = String(note.chapter || '').trim();
    const page = note.page_number == null || note.page_number === '' ? '' : `第 ${note.page_number} 頁`;
    return [chapter, page].filter(Boolean).join('－') || '未標示章節／頁數';
  }
  function notesForIndex(bookId) {
    return [...notesFor(bookId)].sort((a, b) => {
      // 有頁碼時依頁碼排列；無頁碼的草稿筆記排在後面，再按章節名稱排列。
      const pa = a.page_number == null ? null : Number(a.page_number);
      const pb = b.page_number == null ? null : Number(b.page_number);
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
      if (pa !== null && pb === null) return -1;
      if (pa === null && pb !== null) return 1;
      const chapterOrder = String(a.chapter || '').localeCompare(String(b.chapter || ''), 'zh-Hant', {numeric: true});
      if (chapterOrder) return chapterOrder;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }
  function jumpToNote(note) {
    state.selectedBookId = note.book_id;
    state.expandedBookId = note.book_id;
    // 清除先前搜尋，否則目標筆記可能被搜尋條件隱藏。
    $('note-search').value = '';
    render();
    const card = document.getElementById(`note-card-${note.id}`);
    if (!card) return;
    card.classList.add('note-card-jump');
    card.focus({preventScroll: true});
    card.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
    setTimeout(() => card.classList.remove('note-card-jump'), 2600);
  }
  function renderBooks() {
    const container = $('book-list');
    container.replaceChildren();
    const query = $('book-search').value.trim().toLocaleLowerCase();
    const books = [...state.books]
      .filter((book) => (`${book.title} ${book.author || ''}`).toLocaleLowerCase().includes(query))
      .sort((a,b) => getActivityTime(b) - getActivityTime(a));
    if (!books.length) {
      container.append(el('p', 'book-list-empty', state.books.length ? '沒有符合搜尋條件的書籍。' : '書架還是空的。按下「＋」新增第一本書吧。'));
      return;
    }
    for (const book of books) {
      const expanded = state.expandedBookId === book.id;
      const group = el('div', `book-tree-group${expanded ? ' expanded' : ''}`);
      const btn = el('button', `book-item${state.selectedBookId === book.id ? ' selected' : ''}`);
      btn.type = 'button';
      btn.setAttribute('aria-expanded', String(expanded));
      btn.setAttribute('aria-label', `${expanded ? '收合' : '展開'}《${book.title}》的筆記目錄`);
      const spine = el('span', 'book-spine', Array.from(book.title).slice(0, 2).join(''));
      spine.setAttribute('aria-hidden', 'true');
      const textWrap = el('span', 'book-item-text');
      textWrap.append(el('span', 'book-item-name', book.title));
      textWrap.append(el('span', 'book-item-meta', `${book.author || '未填作者'} · ${notesFor(book.id).length} 則筆記`));
      const arrow = el('span', 'book-tree-arrow', expanded ? '⌄' : '›');
      arrow.setAttribute('aria-hidden', 'true');
      btn.append(spine, textWrap, arrow);
      btn.addEventListener('click', () => {
        state.selectedBookId = book.id;
        state.expandedBookId = expanded ? null : book.id;
        $('note-search').value = '';
        render();
        // 在手機上先留在書架，讓展開的筆記連結可以直接點選。
      });
      group.append(btn);
      if (expanded) {
        const sublist = el('nav', 'book-tree-notes');
        sublist.setAttribute('aria-label', `《${book.title}》筆記目錄`);
        const notes = notesForIndex(book.id);
        if (!notes.length) {
          sublist.append(el('p', 'book-tree-empty', '尚無筆記'));
        } else {
          for (const note of notes) {
            const label = noteIndexLabel(note);
            const link = el('button', 'book-tree-note', label);
            link.type = 'button';
            link.title = `前往「${label}」`;
            link.addEventListener('click', () => jumpToNote(note));
            sublist.append(link);
          }
        }
        group.append(sublist);
      }
      container.append(group);
    }
  }
  function renderDetail() {
    const book = currentBook();
    $('no-book').classList.toggle('hidden', !!book);
    $('book-detail').classList.toggle('hidden', !book);
    if (!book) return;
    const count = notesFor(book.id).length;
    $('detail-title').textContent = book.title;
    $('detail-author').textContent = book.author ? `作者｜${book.author}` : '作者未填';
    $('detail-count').textContent = `已收藏 ${count} 則閱讀筆記`;
    renderNotes();
  }
  // 只保留粗體、底線、換行的安全標記。舊版純文字筆記不經 HTML 解析，原樣顯示。
  // 格式與文字一併存在 notes.content，不需要改動 Supabase 資料表。
  function cleanRichNode(node) {
    const out = document.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.append(document.createTextNode(child.nodeValue || ''));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          out.append(document.createElement('br'));
        } else if (tag === 'strong' || tag === 'b' || tag === 'u' || tag === 'div' || tag === 'p') {
          const safe = document.createElement(tag === 'b' ? 'strong' : tag);
          safe.append(cleanRichNode(child));
          out.append(safe);
        } else {
          // 除了純文字與允許的標記，所有標籤、事件及屬性都不予儲存。
          out.append(cleanRichNode(child));
        }
      }
    }
    return out;
  }
  function safeRichFragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return cleanRichNode(template.content);
  }
  function notePlainText(content) {
    const value = escapeString(content);
    if (!value.startsWith(RICH_PREFIX)) return value;
    const wrap = document.createElement('div');
    wrap.append(safeRichFragment(value.slice(RICH_PREFIX.length)));
    return wrap.textContent || '';
  }
  function renderNoteContent(node, stored) {
    const value = escapeString(stored);
    if (value.startsWith(RICH_PREFIX)) {
      node.classList.add('rich');
      node.replaceChildren(safeRichFragment(value.slice(RICH_PREFIX.length)));
    } else {
      node.textContent = value;
    }
  }
  function restoreEditorContent(stored) {
    const editor = $('note-content-input');
    const value = escapeString(stored);
    if (value.startsWith(RICH_PREFIX)) editor.replaceChildren(safeRichFragment(value.slice(RICH_PREFIX.length)));
    else editor.textContent = value;
    ['note-bold-btn', 'note-underline-btn'].forEach((id) => $(id).setAttribute('aria-pressed', 'false'));
  }
  function editorContent() {
    const editor = $('note-content-input');
    const wrap = document.createElement('div');
    wrap.append(cleanRichNode(editor));
    const plain = editor.innerText.trim();
    if (!plain) return {content: '', plain: ''};
    // 沒有任何文字格式時，維持舊版純文字儲存形式。
    if (!wrap.querySelector('strong, u')) return {content: plain, plain};
    return {content: RICH_PREFIX + wrap.innerHTML, plain};
  }
  let savedEditorRange = null;
  function editorHasSelection(range) {
    const editor = $('note-content-input');
    if (!range) return false;
    return editor.contains(range.commonAncestorContainer);
  }
  function rememberEditorRange() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && editorHasSelection(selection.getRangeAt(0))) {
      savedEditorRange = selection.getRangeAt(0).cloneRange();
    }
  }
  function restoreEditorRange() {
    const editor = $('note-content-input');
    editor.focus({preventScroll: true});
    if (!savedEditorRange || !editorHasSelection(savedEditorRange)) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedEditorRange);
  }
  function updateFormatButtons() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editorHasSelection(sel.getRangeAt(0))) return;
    ['bold', 'underline'].forEach((cmd, i) => {
      const btn = $(i === 0 ? 'note-bold-btn' : 'note-underline-btn');
      btn.setAttribute('aria-pressed', String(document.queryCommandState(cmd)));
    });
  }
  function applyNoteFormat(command) {
    restoreEditorRange();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editorHasSelection(selection.getRangeAt(0))) {
      toast('請先在筆記內容中選取文字。', true);
      return;
    }
    // execCommand 在 contenteditable 內保留原生的游標、復原與輸入法行為。
    // 此處只開放 bold / underline，儲存時再次清除非允許的 HTML。
    const ok = document.execCommand(command, false, null);
    if (!ok) toast('目前瀏覽器無法套用此格式，請改用其他瀏覽器。', true);
    rememberEditorRange();
    updateFormatButtons();
  }
  function insertPlainText(text) {
    // 避免從網頁或 Word 貼上時帶入外部樣式與不安全的 HTML。
    if (document.execCommand('insertText', false, text)) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editorHasSelection(range)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
  }

  function renderNotes() {
    const book = currentBook();
    if (!book) return;
    const container = $('note-list');
    container.replaceChildren();
    const query = $('note-search').value.trim().toLocaleLowerCase();
    const list = notesFor(book.id).filter((note) => {
      return (`${note.chapter || ''} ${note.page_number || ''} ${notePlainText(note.content)}`).toLocaleLowerCase().includes(query);
    }).sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
    if (!list.length) {
      const blank = el('div', 'note-empty');
      blank.append(el('strong', '', query ? '沒有找到符合的筆記' : '尚未留下任何筆記'));
      blank.append(el('div', '', query ? '試試其他關鍵字。' : '每次想畫線的瞬間，都可以記在這裡。'));
      if (!query) {
        const add = el('button', 'secondary-btn', '＋ 記下第一則筆記');
        add.type = 'button';
        add.addEventListener('click', () => openNoteDialog());
        blank.append(add);
      }
      container.append(blank);
      return;
    }
    for (const note of list) {
      const card = el('article', 'note-card');
      card.id = `note-card-${note.id}`;
      card.tabIndex = -1;
      const top = el('div', 'note-card-top');
      const tags = el('div', 'note-tags');
      if (note.chapter) tags.append(el('span', 'note-tag', note.chapter));
      if (note.page_number) tags.append(el('span', 'note-tag page', `第 ${note.page_number} 頁`));
      if (!note.chapter && !note.page_number) tags.append(el('span', 'note-tag', '閱讀隨記'));
      top.append(tags, el('span', 'note-date', `更新 ${formatDate(note.updated_at)}`));
      const content = el('div', 'note-content');
      renderNoteContent(content, note.content);
      const foot = el('div', 'note-card-foot');
      const edit = el('button', '', '編輯');
      edit.type = 'button';
      edit.setAttribute('aria-label', `編輯筆記 ${note.chapter || (note.page_number ? '第 ' + note.page_number + ' 頁' : '')}`);
      edit.addEventListener('click', () => openNoteDialog(note));
      const del = el('button', 'delete-note', '刪除');
      del.type = 'button';
      del.setAttribute('aria-label', `刪除筆記 ${note.chapter || (note.page_number ? '第 ' + note.page_number + ' 頁' : '')}`);
      del.addEventListener('click', () => void removeNote(note));
      foot.append(edit, del);
      card.append(top, content, foot);
      container.append(card);
    }
  }
  function openDialog(id) {
    const dialog = $(id);
    if (!dialog.open) dialog.showModal();
  }
  function openBookDialog(book = null) {
    state.bookEditId = book?.id || null;
    $('book-dialog-title').textContent = book ? '編輯書籍' : '新增書籍';
    $('save-book-btn').textContent = book ? '儲存變更' : '儲存書籍';
    $('book-title-input').value = book?.title || '';
    $('book-author-input').value = book?.author || '';
    openDialog('book-dialog');
    $('book-title-input').focus();
  }
  function openNoteDialog(note = null) {
    if (!currentBook()) return;
    state.noteEditId = note?.id || null;
    $('note-dialog-title').textContent = note ? '編輯閱讀筆記' : '新增閱讀筆記';
    $('save-note-btn').textContent = note ? '儲存變更' : '儲存筆記';
    $('note-page-input').value = note?.page_number ?? '';
    $('note-chapter-input').value = note?.chapter || '';
    restoreEditorContent(note?.content || '');
    savedEditorRange = null;
    openDialog('note-dialog');
  }
  function setSaving(saveButton, saving) {
    state.saving = saving;
    saveButton.disabled = saving;
  }
  async function saveBook(event) {
    event.preventDefault();
    if (state.saving) return;
    const title = $('book-title-input').value.trim();
    const author = $('book-author-input').value.trim();
    if (!title) return;
    const id = state.bookEditId;
    setSaving($('save-book-btn'), true);
    try {
      if (mode === 'demo') {
        if (id) {
          const current = state.books.find((book) => book.id === id);
          if (!current) throw new Error('找不到要編輯的書籍。');
          Object.assign(current, {title, author, updated_at: now()});
        } else {
          const newBook = {id: makeId(), user_id: 'demo', title, author, created_at: now(), updated_at: now()};
          state.books.push(newBook);
          state.selectedBookId = newBook.id;
          state.expandedBookId = newBook.id;
        }
        writeDemo();
      } else {
        const payload = { title, author, updated_at: now() };
        let result;
        if (id) {
          result = await client.from('books').update(payload).eq('id', id).eq('user_id', state.user.id)
            .select('id, user_id, title, author, created_at, updated_at').single();
        } else {
          result = await client.from('books').insert({ ...payload, user_id: state.user.id })
            .select('id, user_id, title, author, created_at, updated_at').single();
        }
        if (result.error) throw result.error;
        if (id) state.books = state.books.map((book) => book.id === id ? result.data : book);
        else { state.books.push(result.data); state.selectedBookId = result.data.id; state.expandedBookId = result.data.id; }
        setSyncStatus('變更已儲存至雲端');
      }
      $('book-dialog').close();
      $('book-search').value = '';
      render();
      toast(id ? '書籍資訊已更新。' : '已新增書籍，開始記錄吧。');
    } catch (err) {
      if (mode === 'demo') restoreDemoAfterFailure();
      toast('儲存書籍失敗：' + friendlyError(err), true);
    } finally { setSaving($('save-book-btn'), false); }
  }
  async function removeBook() {
    const book = currentBook();
    if (!book || state.saving) return;
    const count = notesFor(book.id).length;
    const message = `確定刪除《${book.title}》嗎？${count ? `\n這本書的 ${count} 則筆記也會一起永久刪除。` : ''}\n此操作無法復原。`;
    if (!window.confirm(message)) return;
    state.saving = true;
    try {
      if (mode === 'cloud') {
        const { error } = await client.from('books').delete().eq('id', book.id).eq('user_id', state.user.id);
        if (error) throw error;
        setSyncStatus('刪除結果已同步至雲端');
      }
      state.books = state.books.filter((item) => item.id !== book.id);
      state.notes = state.notes.filter((note) => note.book_id !== book.id);
      state.selectedBookId = null;
      if (mode === 'demo') writeDemo();
      render(); toast('書籍與相關筆記已刪除。');
    } catch (err) {
      if (mode === 'demo') restoreDemoAfterFailure();
      toast('刪除失敗：' + friendlyError(err), true);
    } finally { state.saving = false; }
  }
  async function saveNote(event) {
    event.preventDefault();
    if (state.saving || !currentBook()) return;
    const pageRaw = $('note-page-input').value.trim();
    const page = pageRaw ? Number(pageRaw) : null;
    if (page !== null && (!Number.isSafeInteger(page) || page < 1 || page > 9999999)) {
      toast('頁數請輸入 1 到 9,999,999 的整數。', true); return;
    }
    const {content, plain} = editorContent();
    const chapter = $('note-chapter-input').value.trim();
    if (!plain) {
      toast('請先輸入要記錄的內容。', true);
      $('note-content-input').focus();
      return;
    }
    if (plain.length > CONTENT_LIMIT || content.length > CONTENT_LIMIT) {
      toast('筆記超過 50,000 字限制，請縮短內容後再儲存。', true);
      $('note-content-input').focus();
      return;
    }
    const id = state.noteEditId;
    const bookId = state.selectedBookId;
    setSaving($('save-note-btn'), true);
    try {
      if (mode === 'demo') {
        if (id) {
          const note = state.notes.find((n) => n.id === id && n.book_id === bookId);
          if (!note) throw new Error('找不到要編輯的筆記。');
          Object.assign(note, { page_number: page, chapter, content, updated_at: now() });
        } else {
          state.notes.push({id: makeId(), user_id: 'demo', book_id: bookId, page_number: page,
            chapter, content, created_at: now(), updated_at: now()});
        }
        writeDemo();
      } else {
        const payload = { page_number: page, chapter, content, updated_at: now() };
        let result;
        if (id) {
          result = await client.from('notes').update(payload).eq('id', id).eq('book_id', bookId)
            .eq('user_id', state.user.id)
            .select('id, user_id, book_id, page_number, chapter, content, created_at, updated_at').single();
        } else {
          result = await client.from('notes').insert({ ...payload, user_id: state.user.id, book_id: bookId })
            .select('id, user_id, book_id, page_number, chapter, content, created_at, updated_at').single();
        }
        if (result.error) throw result.error;
        if (id) state.notes = state.notes.map((n) => n.id === id ? result.data : n);
        else state.notes.push(result.data);
        setSyncStatus('筆記已儲存至雲端');
      }
      $('note-dialog').close();
      $('note-search').value = '';
      state.expandedBookId = bookId;
      render(); toast(id ? '筆記已更新。' : '閱讀筆記已儲存。');
    } catch (err) {
      if (mode === 'demo') restoreDemoAfterFailure();
      toast('儲存筆記失敗：' + friendlyError(err), true);
    } finally { setSaving($('save-note-btn'), false); }
  }
  async function removeNote(note) {
    if (state.saving || !window.confirm('確定刪除這則筆記嗎？刪除後無法復原。')) return;
    state.saving = true;
    try {
      if (mode === 'cloud') {
        const { error } = await client.from('notes').delete().eq('id', note.id)
          .eq('user_id', state.user.id);
        if (error) throw error;
        setSyncStatus('刪除結果已同步至雲端');
      }
      state.notes = state.notes.filter((item) => item.id !== note.id);
      if (mode === 'demo') writeDemo();
      render(); toast('筆記已刪除。');
    } catch (err) {
      if (mode === 'demo') restoreDemoAfterFailure();
      toast('刪除筆記失敗：' + friendlyError(err), true);
    } finally { state.saving = false; }
  }
  function exportBackup() {
    try {
      const data = {
        app: '頁間閱讀筆記', version: 1, mode,
        exported_at: now(), books: state.books, notes: state.notes
      };
      const file = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json;charset=utf-8'});
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `閱讀筆記備份_${new Date().toLocaleDateString('sv-SE')}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('已開始下載 JSON 備份。請妥善保管，檔案包含你的筆記內容。');
    } catch (err) { toast('備份下載失敗：' + friendlyError(err), true); }
  }
  async function changePassword(event) {
    event.preventDefault();
    if (!client) return;
    const password = $('new-password').value;
    $('save-password-btn').disabled = true;
    try {
      const { error } = await client.auth.updateUser({password});
      if (error) throw error;
      state.recoveryMode = false;
      $('password-dialog').close();
      $('new-password').value = '';
      toast('密碼已更新，請妥善保管。');
    } catch (err) { toast('更新密碼失敗：' + friendlyError(err), true); }
    finally { $('save-password-btn').disabled = false; }
  }
  function registerEvents() {
    $('auth-form').addEventListener('submit', handleAuth);
    $('auth-switch').addEventListener('click', () => {
      state.authMode = state.authMode === 'login' ? 'signup' : 'login';
      updateAuthForm();
    });
    $('forgot-password').addEventListener('click', () => {
      state.authMode = 'reset'; updateAuthForm();
    });
    $('signout-btn').addEventListener('click', async () => {
      if (!client) return;
      $('signout-btn').disabled = true;
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        toast('已登出閱讀空間。');
      } catch (err) { toast('登出失敗：' + friendlyError(err), true); }
      finally { $('signout-btn').disabled = false; }
    });
    $('add-book-btn').addEventListener('click', () => openBookDialog());
    $('empty-add-book').addEventListener('click', () => openBookDialog());
    $('edit-book-btn').addEventListener('click', () => openBookDialog(currentBook()));
    $('delete-book-btn').addEventListener('click', () => void removeBook());
    $('add-note-btn').addEventListener('click', () => openNoteDialog());
    $('book-form').addEventListener('submit', saveBook);
    $('note-form').addEventListener('submit', saveNote);
    const editor = $('note-content-input');
    editor.addEventListener('keyup', () => { rememberEditorRange(); updateFormatButtons(); });
    editor.addEventListener('mouseup', () => { rememberEditorRange(); updateFormatButtons(); });
    editor.addEventListener('touchend', () => setTimeout(() => {rememberEditorRange(); updateFormatButtons();}, 0));
    editor.addEventListener('paste', (event) => {
      event.preventDefault();
      insertPlainText(event.clipboardData?.getData('text/plain') || '');
      rememberEditorRange();
    });
    editor.addEventListener('drop', (event) => {
      // 不允許拖放 HTML 或檔案直接插入編輯區。
      event.preventDefault();
    });
    document.addEventListener('selectionchange', () => {
      if (!$('note-dialog').open) return;
      rememberEditorRange(); updateFormatButtons();
    });
    [['note-bold-btn', 'bold'], ['note-underline-btn', 'underline']].forEach(([id, cmd]) => {
      const button = $(id);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => applyNoteFormat(cmd));
    });
    $('password-form').addEventListener('submit', changePassword);
    $('book-search').addEventListener('input', renderBooks);
    $('note-search').addEventListener('input', renderNotes);
    $('refresh-btn').addEventListener('click', () => { if (!state.saving) void loadData(); });
    $('export-btn').addEventListener('click', exportBackup);
    document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => {
      if (!state.saving) $(btn.dataset.close).close();
    }));
    ['book-dialog', 'note-dialog'].forEach((id) => $(id).addEventListener('cancel', (event) => {
      if (state.saving) event.preventDefault();
    }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && mode === 'cloud' && state.user && !state.saving
        && !$('book-dialog').open && !$('note-dialog').open) void loadData({quiet:true});
    });
  }
  function init() {
    registerEvents();
    if (mode === 'demo') {
      showWorkspace();
      loadData();
    } else {
      showLogin();
      initCloud();
    }
  }
  init();
})();
