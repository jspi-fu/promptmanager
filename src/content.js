/* ============================================================================
   Prompt Manager Content Script (content.js)

   Table of Contents
   [01] Global styles injection
   [02] Utilities (createEl, debounce)
   [03] Theme helpers (getMode, getIconFilter, showEl, hideEl, Theme)
   [04] Selector helpers ($root, qs)
   [05] Panel routing (PanelView, PanelRouter)
   [06] Outside click closer
   [07] Keyboard manager
   [08] Dark mode state
   [09] Event bus
   [10] Storage manager
   [11] Icon SVGs
   [12] PromptUI internal modules
   [13] PromptUIManager (public UI API)
   [14] PromptProcessor (variables)
   [15] PromptMediator (event wiring)
   [16] Bootstrapping
   ============================================================================ */

// COMMENT: Wrap entire script in IIFE to prevent duplicate execution
(function() {
  'use strict';
  
  // COMMENT: Check injection marker at the very beginning - if already injected, exit immediately
  if (window.__promptManagerContentInjected) {
    return;
  }
  window.__promptManagerContentInjected = true;

/* ============================================================================
   [01] Global Styles Injection
   COMMENT: Ensure base CSS is present before any UI is mounted.
   ============================================================================ */
const ensureStylesInjected = (() => {
  let injected = false;
  return () => {
    if (injected) return;
    try {
      injectGlobalStyles();
      injected = true;
    } catch (err) {
      console.error('[PromptManager] Failed to inject global styles safely:', err);
    }
  };
})();
ensureStylesInjected();

/* ---------------------------------------------------------------------------
 * [01] Chrome bridge helpers
 * COMMENT: Centralizes chrome.* guards so storage calls stay reliable.
 * -------------------------------------------------------------------------*/
const ChromeBridge = (() => {
  /**
   * COMMENT: Wrapper that swallows exceptions and returns a fallback.
   * @template T
   * @param {() => Promise<T>} executor
   * @param {T} fallback
   * @returns {Promise<T>}
   */
  const safeAsync = async (executor, fallback) => {
    try {
      return await executor();
    } catch (error) {
      console.error('[PromptManager] safeAsync captured error:', error);
      return fallback;
    }
  };

  const storage = {
    /**
     * COMMENT: Read from chrome.storage.local with consistent error handling.
     * @param {string} key
     * @param {any} fallback
     * @returns {Promise<any>}
     */
    async get(key, fallback) {
      if (!chrome?.storage?.local) return fallback;
      return safeAsync(() => new Promise(resolve => {
        chrome.storage.local.get(key, data => {
          if (chrome.runtime?.lastError) {
            console.warn(`[PromptManager] chrome.storage.get failed for ${key}:`, chrome.runtime.lastError.message);
            resolve(fallback);
            return;
          }
          if (key && typeof key === 'string') {
            resolve(data?.[key] !== undefined ? data[key] : fallback);
          } else {
            resolve(data ?? fallback);
          }
        });
      }), fallback);
    },
    /**
     * COMMENT: Write to chrome.storage.local and surface boolean success.
     * @param {string} key
     * @param {any} value
     * @returns {Promise<boolean>}
     */
    async set(key, value) {
      if (!chrome?.storage?.local) return false;
      return safeAsync(() => new Promise(resolve => {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime?.lastError) {
            console.warn(`[PromptManager] chrome.storage.set failed for ${key}:`, chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(true);
        });
      }), false);
    }
  };

  return { safeAsync, storage };
})();

/* ---------------------------------------------------------------------------
 * [02] Config & Constants
 * COMMENT: Centralized timings and reusable constants.
 * -------------------------------------------------------------------------*/
const HIDE_ANIMATION_MS = 200;
const MUTATION_DEBOUNCE_MS = 300;
const SEARCH_FOCUS_DELAY_MS = 50;
const ONBOARDING_AUTO_HIDE_MS = 10000;
const ONBOARDING_FADE_OUT_MS = 300;
const IMPORT_SUCCESS_RESET_MS = 2000;
const SCROLLBAR_PERSIST_MS = 900;
// Hot corner indicator sizes (px)
const HOT_CORNER_INDICATOR_SMALL_PX = 20;
const HOT_CORNER_INDICATOR_LARGE_PX = 30;

// COMMENT: 禁用“闲置自动收回”机制（由 PromptUI.Behaviors.startCloseTimer 控制）
// 用户更偏好手动控制面板显示；同时也避免对话中途被收起影响体验
window.PROMPT_DISABLE_AUTO_CLOSE = true;

/* ---------------------------------------------------------------------------
 * [02] Types (JSDoc typedefs)
 * COMMENT: Shapes used across UI/Storage operations.
 * -------------------------------------------------------------------------*/
/**
 * @typedef {Object} Prompt
 * @property {string} uuid
 * @property {string} title
 * @property {string} content
 */
/**
 * @typedef {Object} ButtonPosition
 * @property {number} x
 * @property {number} y
 */
/**
 * @typedef {Object} KeyboardShortcut
 * @property {string} key
 * @property {'metaKey'|'ctrlKey'} modifier
 * @property {boolean} requiresShift
 */
/**
 * @callback OnReorder
 * @param {Prompt[]} newPrompts
 * @returns {void}
 */
/**
 * @callback OnToggle
 * @param {boolean} active
 * @returns {void|Promise<void>}
 */

// [01] Utilities — generic helpers
// Helper function for creating DOM elements
/**
 * Create a DOM element with common options applied.
 * COMMENT: Centralizes element creation to keep callers concise and consistent.
 * @param {string} tag
 * @param {Object} [options]
 * @param {string} [options.id]
 * @param {string} [options.className]
 * @param {Object<string,string>} [options.styles]
 * @param {Object<string,string>} [options.attributes]
 * @param {string} [options.innerHTML]
 * @param {Object<string,Function>} [options.eventListeners]
 * @returns {HTMLElement}
 */
const createEl = (tag, { id, className, styles, attributes, innerHTML, eventListeners } = {}) => {
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (className) el.className = className;
  if (styles) Object.assign(el.style, styles);
  if (attributes) Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
  if (innerHTML) el.innerHTML = innerHTML;
  if (eventListeners) Object.entries(eventListeners).forEach(([evt, handler]) => el.addEventListener(evt, handler));
  return el;
};
window.createEl = createEl;

/* ---------------------------------------------------------------------------
 * [01] Utility: debounce
 * Provides a simple debounce wrapper to coalesce rapid successive calls.
 * Example: const debouncedFn = debounce(() => console.log('run'), 300);
 * -------------------------------------------------------------------------*/
/**
 * Debounce a function so it runs after a quiet period.
 * COMMENT: Prevents excessive executions during rapid events.
 * @template T
 * @param {(...args: any[]) => T} fn
 * @param {number} [wait=100]
 * @returns {(...args: any[]) => void}
 */
const debounce = (fn, wait = 100) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(null, args), wait);
  };
};

// [02] Theme helpers — centralize theme and basic UI show/hide behavior
// Helper functions for theme and UI manipulation
const getMode = () => (isDarkMode() ? 'dark' : 'light');
// Centralize the computed CSS filter used for icons based on theme
const getIconFilter = () => (
  isDarkMode()
    ? 'invert(93%) sepia(0%) saturate(0%) hue-rotate(213deg) brightness(107%) contrast(87%)'
    : 'invert(37%) sepia(74%) saturate(380%) hue-rotate(175deg) brightness(93%) contrast(88%)'
);
window.getMode = getMode;
window.getIconFilter = getIconFilter;
/**
 * Show an element with Prompt Manager visibility semantics.
 * COMMENT: Uses CSS class toggles and respectful display values.
 * @param {HTMLElement} el
 */
const showEl = el => {
  // Respect intended display for our panel
  const isPromptList = el.classList && el.classList.contains('opm-prompt-list');
  el.style.display = isPromptList ? 'flex' : 'block';
  void el.offsetHeight;
  el.classList.add('opm-visible');
};
/**
 * Hide an element with a short delay for transitions.
 * COMMENT: Resets list item displays to avoid sticky filters on next open.
 * @param {HTMLElement} el
 */
const hideEl = el => {
  el.classList.remove('opm-visible');
  setTimeout(() => {
    el.style.display = 'none';
    const items = el.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
    if (items) Array.from(items.children).forEach(i => i.style.display = 'flex');
  }, HIDE_ANIMATION_MS);
};
window.showEl = showEl;
window.hideEl = hideEl;

/* ---------------------------------------------------------------------------
 * [02] Theme helper, centralize applying light/dark class across our subtree
 * -------------------------------------------------------------------------*/
const Theme = {
  // Apply current mode class to a single node
  applyNode(node) {
    if (!node) return;
    node.classList?.remove('opm-light', 'opm-dark');
    node.classList?.add(`opm-${getMode()}`);
  },
  // Apply to all nodes that opt into theming within our root
  applyAll() {
    const root = document.getElementById(SELECTORS.ROOT);
    if (!root) return;
    // Root carries mode for global styles
    root.classList.toggle('opm-dark', isDarkMode());
    root.classList.toggle('opm-light', !isDarkMode());
    // Update all nodes that have any opm-* class
    const themedNodes = root.querySelectorAll('[class*="opm-"]');
    themedNodes.forEach(el => this.applyNode(el));
  }
};

/* ---------------------------------------------------------------------------
 * [03] Selector helpers (scoped under our root)
 * COMMENT: Small helpers to reduce query noise and keep scope consistent.
 * -------------------------------------------------------------------------*/
const $root = () => document.getElementById(SELECTORS.ROOT);
const qs = (sel, root = $root()) => (root ? root.querySelector(sel) : null);

/* ---------------------------------------------------------------------------
 * [04] Panel view states and tiny router
 * COMMENT: Centralizes view switching and search visibility.
 * -------------------------------------------------------------------------*/
const PanelView = Object.freeze({
  LIST: 'LIST',
  CREATE: 'CREATE',
  EDIT: 'EDIT',
  SETTINGS: 'SETTINGS',
  HELP: 'HELP',
  CHAT: 'CHAT',
  VARIABLE_INPUT: 'VARIABLE_INPUT'
});
window.PanelView = PanelView;

/* ---------------------------------------------------------------------------
 * Scroll visibility manager — shows scrollbars only while the user is scrolling.
 * COMMENT: Keeps the panel minimal until actual scroll activity occurs.
 * -------------------------------------------------------------------------*/
const ScrollVisibilityManager = (() => {
  const observers = new WeakMap();
  const ACTIVITY_EVENTS = ['scroll', 'wheel', 'touchmove'];

  const markActive = (node, state) => {
    node.classList.add('opm-scroll-active');
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      node.classList.remove('opm-scroll-active');
    }, SCROLLBAR_PERSIST_MS);
  };

  const ensureListeners = (node) => {
    const state = { timer: null };
    const handler = () => markActive(node, state);
    ACTIVITY_EVENTS.forEach(evt => node.addEventListener(evt, handler, { passive: true }));
    observers.set(node, state);
  };

  return {
    observe(node) {
      if (!node || observers.has(node)) return;
      node.classList.add('opm-scrollable');
      ensureListeners(node);
    }
  };
})();
window.ScrollVisibilityManager = ScrollVisibilityManager;

const PanelRouter = (() => {
  const state = {
    currentView: null
  };

  /**
   * COMMENT: Shared factory for static info views so HELP stays consistent.
   * @param {{ titleText: string, contentId: string, sourcePath: string }} options
   * @returns {HTMLElement}
   */
  const createInfoView = ({ titleText, contentId, sourcePath }) => {
      const dark = isDarkMode();
    const container = createEl('div', {
      className: `opm-form-container opm-${getMode()}`,
      styles: { padding: '0', display: 'flex', flexDirection: 'column', gap: '6px' }
    });
    const title = createEl('div', {
      styles: { fontWeight: 'bold', fontSize: '16px', marginBottom: '6px' },
      innerHTML: titleText
    });
    const info = createEl('div', {
      id: contentId,
      styles: {
        maxHeight: '410px',
        overflowY: 'auto',
        padding: '4px',
        borderRadius: '6px',
        color: dark ? THEME_COLORS.inputDarkText : THEME_COLORS.inputLightText
      }
    });
      container.append(title, info);
    fetch(chrome.runtime.getURL(sourcePath))
      .then(r => r.text())
      .then(html => { info.innerHTML = html; })
      .catch(err => console.error(`[PromptManager] Failed to load ${sourcePath}:`, err));
      ScrollVisibilityManager.observe(info);
      return container;
  };

  /**
   * COMMENT: Create chat interface for prompt generation
   * @returns {HTMLElement}
   */
  const createChatView = () => {
    const dark = isDarkMode();
    const container = createEl('div', {
      className: `opm-chat-container opm-${getMode()}`,
      styles: {
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: '0',
        padding: '0',
        position: 'relative'
      }
    });

    // Header with title and settings icon
    const header = createEl('div', {
      className: `opm-chat-header opm-${getMode()}`,
      styles: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: `1px solid ${dark ? THEME_COLORS.darkBorder : THEME_COLORS.lightBorder}`,
        position: 'relative'
      }
    });

    const titleWrapper = createEl('div', {
      styles: { display: 'flex', alignItems: 'center', gap: '8px' }
    });

    const icon = createEl('img', {
      attributes: {
        src: chrome.runtime.getURL('icons/chatllm.png'),
        alt: 'Lyra',
        width: '24',
        height: '24'
      },
      styles: { borderRadius: '4px' }
    });

    const title = createEl('div', {
      styles: { display: 'flex', flexDirection: 'column' }
    });
    const titleText = createEl('div', {
      innerHTML: '提示词生成器',
      styles: { fontSize: '16px', fontWeight: '600', color: dark ? THEME_COLORS.inputDarkText : THEME_COLORS.inputLightText }
    });
    title.append(titleText);

    titleWrapper.append(icon, title);

    const resetBtn = createEl('button', {
      className: 'opm-chat-reset',
      innerHTML: '重置',
      styles: {
        background: 'transparent',
        border: 'none',
        color: dark ? THEME_COLORS.inputDarkText : THEME_COLORS.inputLightText,
        cursor: 'pointer',
        fontSize: '14px',
        padding: '4px 8px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
      }
    });

    const settingsBtn = createEl('button', {
      className: 'opm-chat-settings',
      innerHTML: `<img src="${chrome.runtime.getURL('icons/settings.svg')}" width="16" height="16" alt="设置" style="filter: ${getIconFilter()}">`,
      styles: {
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    });

    const headerRight = createEl('div', {
      styles: { display: 'flex', alignItems: 'center', gap: '8px' }
    });
    headerRight.append(resetBtn, settingsBtn);
    header.append(titleWrapper, headerRight);

    // Chat messages container
    const messagesContainer = createEl('div', {
      id: SELECTORS.CHAT_CONTENT,
      className: `opm-chat-messages opm-${getMode()}`,
      styles: {
        flex: '1 1 auto',
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        minHeight: '0'
      }
    });

    // Input area
    const inputArea = createEl('div', {
      className: `opm-chat-input-area opm-${getMode()}`,
      styles: {
        padding: '12px 16px',
        borderTop: `1px solid ${dark ? THEME_COLORS.darkBorder : THEME_COLORS.lightBorder}`,
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-end'
      }
    });

    const input = createEl('textarea', {
      id: 'opm-chat-input',
      className: `opm-chat-input opm-${getMode()}`,
      attributes: {
        placeholder: '输入你的需求…',
        rows: '1'
      },
      styles: {
        flex: '1',
        padding: '10px 12px',
        borderRadius: '12px',
        border: `1px solid ${dark ? THEME_COLORS.darkBorder : THEME_COLORS.lightBorder}`,
        backgroundColor: dark ? THEME_COLORS.inputDarkBg : THEME_COLORS.inputLightBg,
        color: dark ? THEME_COLORS.inputDarkText : THEME_COLORS.inputLightText,
        fontSize: '14px',
        fontFamily: 'inherit',
        resize: 'none',
        outline: 'none',
        maxHeight: '120px',
        overflowY: 'auto'
      }
    });
    // COMMENT: 输入框滚动条默认隐藏（仅在滚动时短暂显示），与面板其他区域保持一致
    ScrollVisibilityManager.observe(input);

    const sendBtn = createEl('button', {
      className: 'opm-chat-send',
      innerHTML: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
      styles: {
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        border: 'none',
        backgroundColor: THEME_COLORS.primary,
        color: '#fff',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: '0',
        padding: '0'
      }
    });

    inputArea.append(input, sendBtn);
    container.append(header, messagesContainer, inputArea);

    // Initialize chat
    initializeChat(messagesContainer, input, sendBtn, resetBtn, settingsBtn);

    ScrollVisibilityManager.observe(messagesContainer);
    return container;
  };

  // COMMENT: Central map defining builder + UI rules for each panel view.
  const VIEW_DEFINITIONS = {
    [PanelView.LIST]: {
      kind: 'list',
      panelHeight: 'variable',
      searchVisible: true,
      bottomMenuVisible: true,
      alwaysRebuild: true,
      description: 'Prompt list view needs live data + persisted tags every time.',
      async controller(listEl) {
        try {
          PromptUIManager.setListMode('list');
          const prompts = await PromptStorageManager.getPrompts();
          let savedTag = 'all';
          try {
            savedTag = (await PromptStorageManager.getActiveTagFilter()) || 'all';
          } catch (_) {
            savedTag = 'all';
          }
          PromptUIManager.activeTagFilter = savedTag;
          PromptUIManager.refreshPromptList(prompts);
          PromptUIManager.filterByTag(savedTag);
          PromptUIManager.showPromptList(listEl);
        } catch (err) {
          console.error('[PromptManager] Failed to render LIST view:', err);
        }
      }
    },
    [PanelView.CREATE]: {
      builder: (context) => PromptUIManager.createPromptCreationForm(context?.initialContent || ''),
      panelHeight: 'fixed',
      searchVisible: false,
      bottomMenuVisible: true,
      description: 'Create view uses fixed-height form; search stays hidden.'
    },
    [PanelView.EDIT]: {
      kind: 'list',
      panelHeight: 'variable',
      searchVisible: true,
      bottomMenuVisible: true,
      alwaysRebuild: true,
      description: 'Edit view reuses the prompt list with edit + reorder controls.',
      async controller(listEl) {
        try {
          PromptUIManager.setListMode('edit');
          const prompts = await PromptStorageManager.getPrompts();
          let savedTag = 'all';
          try {
            savedTag = (await PromptStorageManager.getActiveTagFilter()) || 'all';
          } catch (_) {
            savedTag = 'all';
          }
          PromptUIManager.activeTagFilter = savedTag;
          PromptUIManager.refreshPromptList(prompts);
          PromptUIManager.filterByTag(savedTag);
          PromptUIManager.showPromptList(listEl);
        } catch (err) {
          console.error('[PromptManager] Failed to render EDIT view:', err);
        }
      }
    },
    [PanelView.SETTINGS]: {
      builder: () => PromptUIManager.createSettingsForm(),
      panelHeight: 'fixed',
      searchVisible: false,
      bottomMenuVisible: true,
      description: 'Settings is a standalone form with no search.'
    },
    [PanelView.HELP]: {
      builder: () => createInfoView({
        titleText: '导航与功能',
        contentId: SELECTORS.INFO_CONTENT,
        sourcePath: 'info.html'
      }),
      panelHeight: 'fixed',
      searchVisible: false,
      bottomMenuVisible: true,
      description: 'Help content is static HTML pulled from info.html.'
    },
    [PanelView.CHAT]: {
      builder: () => createChatView(),
      panelHeight: 'variable',
      searchVisible: false,
      bottomMenuVisible: true,
      description: 'Chat interface for prompt generation with AI assistant.'
    },
    [PanelView.VARIABLE_INPUT]: {
      builder: (context) => PromptUIManager.createVariableInputForm(context),
      panelHeight: 'fixed',
      searchVisible: false,
      bottomMenuVisible: true,
      description: 'Variable input form that collects placeholder values before insertion.',
      requiresContext: true,
      alwaysRebuild: true
    }
  };

  const applyViewChrome = (definition) => {
    const heightMode = definition.panelHeight === 'variable' ? 'variable' : 'fixed';
    PromptUIManager.setPanelHeightMode(heightMode);
    PromptUIManager.setSearchVisibility(definition.searchVisible !== false);
    PromptUIManager.setBottomMenuVisibility(definition.bottomMenuVisible !== false);
    Theme.applyAll();
  };

  const mount = async (view, context = undefined) => {
    const definition = VIEW_DEFINITIONS[view];
    if (!definition) return;
    if (definition.requiresContext && !context) {
      console.warn(`[PromptManager] Missing context for view ${view}`);
      return;
    }

    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!listEl) return;

    if (state.currentView === view && !definition.alwaysRebuild) {
      // COMMENT: If view already active and does not require rebuild, just ensure visibility.
      PromptUIManager.showPromptList(listEl);
      return;
    }

    state.currentView = view;
    PromptUIManager.inVariableInputMode = (view === PanelView.VARIABLE_INPUT);

    if (definition.kind === 'list') {
      applyViewChrome(definition);
      await definition.controller(listEl);
      return;
    }

    const builder = definition.builder;
    if (!builder) return;

    // COMMENT: Reset the shared panel scaffolding first so builders can rely on
    // the latest tags/search host before injecting their custom content.
    PromptUIManager.resetPromptListContainer();

    let node = null;
    try {
      node = await builder(context);
    } catch (err) {
      console.error(`[PromptManager] Failed to build view "${view}":`, err);
      return;
    }
    if (!node) return;

    PromptUIManager.replacePanelMainContent(node);
    applyViewChrome(definition);
    PromptUIManager.showPromptList(listEl);
  };

  return { mount };
})();
window.PanelRouter = PanelRouter;

/**
 * COMMENT: Initialize chat interface with message handling and API calls
 */
const initializeChat = (messagesContainer, input, sendBtn, resetBtn, settingsBtn) => {
  let messages = [];
  let systemPrompt = '';
  const HISTORY_KEY = 'pm_chat_history_v1';

  // Load system prompt from system.md
  fetch(chrome.runtime.getURL('system.md'))
    .then(r => r.text())
    .then(text => {
      systemPrompt = text;
    })
    .catch(err => {
      console.error('[PromptManager] Failed to load system.md:', err);
      // Fallback: use default system prompt
      systemPrompt = 'You are Lyra, a master-level AI prompt optimization specialist.';
    });

  // Load chat settings
  const loadSettings = () => {
    return new Promise((resolve) => {
      chrome.storage.local.get(['chatApiKey', 'chatBaseUrl', 'chatModelName'], (result) => {
        resolve({
          apiKey: result.chatApiKey || '',
          baseUrl: result.chatBaseUrl || 'https://api.openai.com/v1',
          modelName: result.chatModelName || 'gpt-3.5-turbo'
        });
      });
    });
  };

  // COMMENT: 持久化对话上下文（在用户点击“重置”之前保留）
  const loadHistory = () => new Promise(resolve => {
    chrome.storage.local.get([HISTORY_KEY], (result) => {
      const raw = result?.[HISTORY_KEY];
      if (!Array.isArray(raw)) return resolve([]);
      const clean = raw
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content }));
      resolve(clean);
    });
  });
  // COMMENT: 对话历史上限：最多保留 50 轮（user+assistant 配对），或总字符数不超过 100KB
  const trimHistoryIfNeeded = (msgs) => {
    const MAX_ROUNDS = 50;
    const MAX_CHARS = 100000;
    if (msgs.length <= MAX_ROUNDS * 2) {
      const totalChars = msgs.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      if (totalChars <= MAX_CHARS) return msgs;
    }
    // COMMENT: 保留最近的 N 轮（从后往前取）
    const trimmed = msgs.slice(-MAX_ROUNDS * 2);
    const totalChars = trimmed.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (totalChars > MAX_CHARS) {
      // COMMENT: 如果仍超限，按字符数从后往前截断
      let chars = 0;
      const result = [];
      for (let i = trimmed.length - 1; i >= 0 && chars < MAX_CHARS; i--) {
        const msg = trimmed[i];
        const msgChars = msg.content?.length || 0;
        if (chars + msgChars <= MAX_CHARS) {
          result.unshift(msg);
          chars += msgChars;
        } else break;
      }
      return result;
    }
    return trimmed;
  };

  const persistHistory = debounce(() => {
    // COMMENT: 只存 user/assistant 历史；system prompt 不落盘；应用上限控制
    const trimmed = trimHistoryIfNeeded(messages.slice());
    chrome.storage.local.set({ [HISTORY_KEY]: trimmed }, () => {
      // COMMENT: 如果被截断，同步更新内存中的 messages（保持一致性）
      if (trimmed.length < messages.length) {
        messages.splice(0, messages.length - trimmed.length);
      }
    });
  }, 300);

  // Add message to chat
  const addMessage = (container, role, content, isStreaming = false) => {
    const dark = isDarkMode();
    const messageDiv = createEl('div', {
      className: `opm-chat-message opm-chat-${role} opm-${getMode()}`
    });

    if (role === 'assistant' && !isStreaming) {
      const saveBtn = createEl('div', {
        className: 'opm-chat-save-prompt',
        innerHTML: `<img src="${chrome.runtime.getURL('icons/new.svg')}" width="14" height="14" alt="保存" style="filter: ${getIconFilter()}">`,
        attributes: { title: '保存为提示词' }
      });
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        PanelRouter.mount(PanelView.CREATE, { initialContent: content });
      });
      messageDiv.appendChild(saveBtn);
    }

    const contentDiv = createEl('div', {
      className: 'opm-chat-content',
      innerHTML: content.replace(/\n/g, '<br>')
    });

    let cursor = null;
    if (isStreaming) {
      cursor = createEl('span', {
        className: 'opm-chat-stream-cursor',
        innerHTML: '▊',
        styles: {
          animation: 'blink 1s infinite',
          color: role === 'user' ? '#fff' : THEME_COLORS.primary
        }
      });
      contentDiv.appendChild(cursor);
    }

    messageDiv.appendChild(contentDiv);
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    return { messageDiv, contentDiv, cursor };
  };

  // Get welcome message
  const getWelcomeMessage = () => {
    return `输入格式：
- 目标平台:ChatGPT、Claude、Gemini或其他
- 提示风格:详细(交互优化)或基本(快速优化)

例子:"使用 ChatGPT 详细模式-给我写一封营销邮件"
`;
  };

  // COMMENT: 初始化时恢复历史（若无历史则显示欢迎语）
  (async () => {
    try {
      const history = await loadHistory();
      if (history.length > 0) {
        messages = history;
        messagesContainer.innerHTML = '';
        history.forEach(m => addMessage(messagesContainer, m.role, m.content, false));
      } else {
        addMessage(messagesContainer, 'assistant', getWelcomeMessage(), false);
      }
    } catch (_) {
      addMessage(messagesContainer, 'assistant', getWelcomeMessage(), false);
    }
  })();

  // Send message to API
  const sendMessage = async (userMessage) => {
    const settings = await loadSettings();
    if (!settings.apiKey) {
      addMessage(messagesContainer, 'assistant', '请先在设置中配置API Key。', false);
      return;
    }

    messages.push({ role: 'user', content: userMessage });
    persistHistory();
    const { messageDiv, contentDiv } = addMessage(messagesContainer, 'assistant', '', true);

    const requestMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    try {
      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.modelName,
          messages: requestMessages,
          stream: true
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: '请求失败' } }));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      // COMMENT: OpenAI 兼容 SSE 流式输出解析
      const reader = response.body?.getReader?.();
      if (!reader) {
        // Fallback: 部分环境/服务不支持流，退回普通 JSON
        const data = await response.json();
        const assistantMessage = data.choices?.[0]?.message?.content || '无响应';
        messages.push({ role: 'assistant', content: assistantMessage });
        contentDiv.innerHTML = assistantMessage.replace(/\n/g, '<br>');
        persistHistory();
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return;
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let acc = '';
      let pendingUpdate = false;
      let rafScheduled = false;

      // COMMENT: 使用 rAF 批量刷新，避免每次 delta 都写 DOM
      const flushUI = () => {
        if (!pendingUpdate) return;
        pendingUpdate = false;
        rafScheduled = false;
        
        const cursorEl = contentDiv.querySelector('.opm-chat-stream-cursor');
        if (cursorEl) cursorEl.remove();
        // COMMENT: 使用 textContent + 手动处理换行，避免频繁 innerHTML 解析
        const textNode = document.createTextNode(acc);
        contentDiv.textContent = '';
        const lines = acc.split(/\n/);
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) contentDiv.appendChild(createEl('br'));
          if (lines[i]) contentDiv.appendChild(document.createTextNode(lines[i]));
        }
        const nextCursor = createEl('span', {
          className: 'opm-chat-stream-cursor',
          innerHTML: '▊',
          styles: { animation: 'blink 1s infinite', color: THEME_COLORS.primary }
        });
        contentDiv.appendChild(nextCursor);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      };

      const scheduleUpdate = () => {
        pendingUpdate = true;
        if (!rafScheduled) {
          rafScheduled = true;
          requestAnimationFrame(flushUI);
        }
      };

      let done = false;
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        if (doneReading) break;
        buffer += decoder.decode(value, { stream: true });

        // COMMENT: SSE 事件以换行分隔
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;
          if (dataStr === '[DONE]') { done = true; break; }
          let payload;
          try { payload = JSON.parse(dataStr); } catch (_) { continue; }
          const delta = payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content ?? '';
          if (typeof delta === 'string' && delta) {
            acc += delta;
            scheduleUpdate(); // COMMENT: 标记需要更新，由 rAF 批量刷新
          }
        }
      }

      // COMMENT: 结束时确保最后一次刷新完成，移除光标
      if (rafScheduled) {
        await new Promise(resolve => requestAnimationFrame(() => { flushUI(); resolve(); }));
      } else {
        flushUI();
      }
      const cursorEl = contentDiv.querySelector('.opm-chat-stream-cursor');
      if (cursorEl) cursorEl.remove();
      // COMMENT: 最终渲染（无光标）
      const lines = acc.split(/\n/);
      contentDiv.textContent = '';
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) contentDiv.appendChild(createEl('br'));
        if (lines[i]) contentDiv.appendChild(document.createTextNode(lines[i]));
      }

      const assistantMessage = acc || '无响应';
      messages.push({ role: 'assistant', content: assistantMessage });
      persistHistory();

      // COMMENT: 给每条模型回复增加“保存为提示词”按钮（避免重复插入）
      if (messageDiv && !messageDiv.querySelector('.opm-chat-save-prompt')) {
        const saveBtn = createEl('div', {
          className: 'opm-chat-save-prompt',
          innerHTML: `<img src="${chrome.runtime.getURL('icons/new.svg')}" width="14" height="14" alt="保存" style="filter: ${getIconFilter()}">`,
          attributes: { title: '保存为提示词' }
        });
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          PanelRouter.mount(PanelView.CREATE, { initialContent: assistantMessage });
        });
        messageDiv.appendChild(saveBtn);
      }
    } catch (error) {
      console.error('[PromptManager] Chat API error:', error);
      contentDiv.innerHTML = `错误: ${error.message}`;
    }
  };

  // Event listeners
  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMessage(messagesContainer, 'user', text, false);
    sendMessage(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  resetBtn.addEventListener('click', () => {
    messages = [];
    messagesContainer.innerHTML = '';
    addMessage(messagesContainer, 'assistant', getWelcomeMessage(), false);
    chrome.storage.local.remove([HISTORY_KEY]);
  });

  // Settings modal
  let settingsModal = null;
  settingsBtn.addEventListener('click', () => {
    if (settingsModal && document.body.contains(settingsModal)) {
      settingsModal.remove();
      settingsModal = null;
      return;
    }

    const dark = isDarkMode();
    
    // Overlay with blur
    settingsModal = createEl('div', {
      className: 'opm-chat-settings-modal',
      styles: {
        position: 'fixed',
        top: '0', left: '0', right: '0', bottom: '0',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: '10001',
        opacity: '0',
        transition: 'opacity 0.2s ease'
      }
    });

    // Main Card
    const modalContent = createEl('div', {
      className: `opm-chat-settings-content opm-${getMode()}`,
      styles: {
        width: '90%', maxWidth: '440px',
        maxHeight: '85vh', overflowY: 'auto',
        backgroundColor: dark ? '#1e293b' : '#ffffff',
        borderRadius: '16px',
        border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}`,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        transform: 'scale(0.95)', 
        transition: 'transform 0.2s ease',
        display: 'flex', flexDirection: 'column'
      }
    });

    // Header
    const header = createEl('div', {
      styles: {
        padding: '20px 24px',
        borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : '#f1f5f9'}`
      }
    });
    const title = createEl('h3', { 
      innerHTML: '模型配置',
      styles: { margin: '0 0 6px 0', fontSize: '18px', fontWeight: '600', color: dark ? '#f8fafc' : '#0f172a' }
    });
    const desc = createEl('p', { 
      innerHTML: '配置兼容 OpenAI 接口的模型服务（如 DeepSeek, Moonshot 等）。',
      styles: { margin: '0', fontSize: '13px', color: dark ? '#94a3b8' : '#64748b', lineHeight: '1.4' }
    });
    header.append(title, desc);

    // Body
    const body = createEl('div', { styles: { padding: '24px' } });

    const createField = (label, id, type, placeholder, helpText, defaultValue) => {
      const wrapper = createEl('div', { styles: { marginBottom: '16px' } });
      const labelEl = createEl('label', { 
        innerHTML: label,
        styles: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: dark ? '#cbd5e1' : '#334155' }
      });
      const input = createEl('input', {
        id, type, placeholder,
        styles: {
          width: '100%', padding: '10px 12px',
          borderRadius: '8px',
          border: `1px solid ${dark ? '#334155' : '#cbd5e1'}`,
          backgroundColor: dark ? '#0f172a' : '#ffffff',
          color: dark ? '#e2e8f0' : '#1e293b',
          fontSize: '14px',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
        }
      });
      if (defaultValue) input.value = defaultValue;

      input.addEventListener('focus', () => {
        input.style.borderColor = THEME_COLORS.primary;
        input.style.boxShadow = `0 0 0 2px ${THEME_COLORS.primary}30`;
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = dark ? '#334155' : '#cbd5e1';
        input.style.boxShadow = 'none';
      });

      wrapper.append(labelEl, input);
      if (helpText) {
          const help = createEl('div', {
              innerHTML: helpText,
              styles: { marginTop: '4px', fontSize: '12px', color: dark ? '#64748b' : '#94a3b8' }
          });
          wrapper.append(help);
      }
      return { wrapper, input };
    };

    const apiKey = createField('API Key', 'chat-api-key', 'password', 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '服务商提供的 API 密钥');
    const baseUrl = createField('Base URL', 'chat-base-url', 'text', 'https://api.openai.com/v1', 'API 请求地址 (需包含 /v1)');
    const modelName = createField('Model Name', 'chat-model-name', 'text', 'gpt-3.5-turbo', '要调用的模型名称 (如 gpt-4, deepseek-chat)');

    const status = createEl('div', {
      styles: {
        display: 'none', fontSize: '13px', marginTop: '4px',
        padding: '10px 14px', borderRadius: '8px',
        backgroundColor: dark ? 'rgba(54, 116, 181, 0.1)' : '#f0f9ff',
        color: dark ? '#93c5fd' : '#0369a1',
        border: dark ? '1px solid rgba(54, 116, 181, 0.2)' : '1px solid #bae6fd',
        alignItems: 'center', gap: '8px', lineHeight: '1.4'
      }
    });

    const setStatus = (text, type = 'info') => {
      status.style.display = text ? 'flex' : 'none';
      status.innerHTML = text || '';
      if (type === 'error') {
          status.style.backgroundColor = dark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2';
          status.style.color = dark ? '#fca5a5' : '#991b1b';
          status.style.borderColor = dark ? 'rgba(239, 68, 68, 0.2)' : '#fecaca';
      } else if (type === 'success') {
          status.style.backgroundColor = dark ? 'rgba(34, 197, 94, 0.1)' : '#f0fdf4';
          status.style.color = dark ? '#86efac' : '#166534';
          status.style.borderColor = dark ? 'rgba(34, 197, 94, 0.2)' : '#bbf7d0';
      } else {
          status.style.backgroundColor = dark ? 'rgba(54, 116, 181, 0.1)' : '#f0f9ff';
          status.style.color = dark ? '#93c5fd' : '#0369a1';
          status.style.borderColor = dark ? 'rgba(54, 116, 181, 0.2)' : '1px solid #bae6fd';
      }
    };

    body.append(apiKey.wrapper, baseUrl.wrapper, modelName.wrapper, status);

    // Footer
    const footer = createEl('div', { 
      styles: { 
          padding: '16px 24px', 
          backgroundColor: dark ? 'rgba(0,0,0,0.2)' : '#f8fafc',
          borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : '#f1f5f9'}`,
          borderRadius: '0 0 16px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      } 
    });

    const leftActions = createEl('div');
    const testBtn = createEl('button', { 
      innerHTML: '测试连接',
      styles: {
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '13px', fontWeight: '500',
          color: dark ? '#94a3b8' : '#64748b',
          padding: '8px 12px', borderRadius: '6px',
          transition: 'color 0.2s, background 0.2s'
      }
    });
    testBtn.addEventListener('mouseenter', () => { testBtn.style.color = THEME_COLORS.primary; testBtn.style.backgroundColor = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; });
    testBtn.addEventListener('mouseleave', () => { testBtn.style.color = dark ? '#94a3b8' : '#64748b'; testBtn.style.backgroundColor = 'transparent'; });
    leftActions.append(testBtn);

    const rightActions = createEl('div', { styles: { display: 'flex', gap: '12px' } });
    const cancelBtn = createEl('button', { 
      innerHTML: '取消',
      styles: {
          background: 'transparent', border: `1px solid ${dark ? '#475569' : '#cbd5e1'}`, cursor: 'pointer',
          fontSize: '13px', fontWeight: '500',
          color: dark ? '#cbd5e1' : '#475569',
          padding: '8px 16px', borderRadius: '6px',
          transition: 'all 0.2s'
      }
    });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.borderColor = dark ? '#94a3b8' : '#94a3b8'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.borderColor = dark ? '#475569' : '#cbd5e1'; });

    const saveBtn = createEl('button', { 
      innerHTML: '保存配置',
      styles: {
          background: THEME_COLORS.primary, border: 'none', cursor: 'pointer',
          fontSize: '13px', fontWeight: '500',
          color: '#ffffff',
          padding: '8px 20px', borderRadius: '6px',
          boxShadow: '0 2px 4px rgba(54, 116, 181, 0.3)',
          transition: 'all 0.2s'
      }
    });
    saveBtn.addEventListener('mouseenter', () => { saveBtn.style.filter = 'brightness(1.1)'; });
    saveBtn.addEventListener('mouseleave', () => { saveBtn.style.filter = 'brightness(1)'; });

    rightActions.append(cancelBtn, saveBtn);
    footer.append(leftActions, rightActions);

    // Initial Data Load
    loadSettings().then(settings => {
      apiKey.input.value = settings.apiKey;
      baseUrl.input.value = settings.baseUrl;
      modelName.input.value = settings.modelName;
    });

    // Event Handlers
    testBtn.addEventListener('click', async () => {
      const key = apiKey.input.value.trim();
      const rawUrl = baseUrl.input.value.trim() || 'https://api.openai.com/v1';
      const url = rawUrl.replace(/\/+$/, '');
      
      if (!key) return setStatus('请先填写 API Key', 'error');
      
      setStatus('正在连接服务器...', 'info');
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const r = await fetch(`${url}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: modelName.input.value || 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (r.ok) {
          setStatus('连接成功！配置可用', 'success');
        } else {
           const errData = await r.json().catch(() => ({}));
           if (r.status === 404) {
             setStatus(`连接失败 (404): 路径未找到，请确认 Base URL 正确 (通常以 /v1 结尾)`, 'error');
           } else {
             setStatus(`连接失败 (${r.status}): ${errData.error?.message || '请检查配置'}`, 'error');
           }
        }
      } catch (e) { 
          if (e.name === 'AbortError') {
            setStatus('连接超时: 请检查网络或 Base URL', 'error');
          } else {
            setStatus(`请求错误: ${e.message}`, 'error'); 
          }
      }
    });

    const closeModal = () => {
      settingsModal.style.opacity = '0';
      modalContent.style.transform = 'scale(0.95)';
      setTimeout(() => {
          if (settingsModal && settingsModal.parentNode) settingsModal.remove();
          settingsModal = null;
      }, 200);
    };

    saveBtn.addEventListener('click', () => {
      chrome.storage.local.set({
        chatApiKey: apiKey.input.value.trim(),
        chatBaseUrl: baseUrl.input.value.trim() || 'https://api.openai.com/v1',
        chatModelName: modelName.input.value.trim() || 'gpt-3.5-turbo'
      }, () => {
        setStatus('保存成功', 'success');
        setTimeout(closeModal, 600);
      });
    });

    cancelBtn.addEventListener('click', closeModal);

    modalContent.append(header, body, footer);
    settingsModal.appendChild(modalContent);
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeModal(); });
    document.body.appendChild(settingsModal);
    
    // Animate In
    requestAnimationFrame(() => {
        settingsModal.style.opacity = '1';
        modalContent.style.transform = 'scale(1)';
    });
  });
};

/* ---------------------------------------------------------------------------
 * [05] Centralized outside-click closer
 * COMMENT: Single document-level handler that works for both modes.
 * -------------------------------------------------------------------------*/
const OutsideClickCloser = (() => {
  let attached = false;
  const handler = e => {
    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!listEl || !listEl.classList.contains('opm-visible')) return;
    const isMenu = e.target.closest(`#${SELECTORS.PROMPT_LIST}`)
      || e.target.closest(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`)
      || e.target.closest('.opm-icon-button')
      || e.target.closest('.opm-form-container')
      || e.target.closest('.opm-button');
    if (!isMenu) PromptUIManager.hidePromptList(listEl);
  };
  return {
    ensure() {
      if (attached) return;
      document.addEventListener('click', handler);
      attached = true;
    }
  };
})();

/* [07] Keyboard Manager */
/* [07] Keyboard Manager (restored simplified version) */
class KeyboardManager {
  static initialized = false;
  static shortcutCache = null;

  static initialize() {
    if (KeyboardManager.initialized) return;
    KeyboardManager.initialized = true;
    document.addEventListener('keydown', KeyboardManager._onKeyDown);
    KeyboardManager._loadShortcut();
    KeyboardManager._attachShortcutWatcher();
  }

  static async _onKeyDown(e) {
    const shortcut = KeyboardManager.shortcutCache || await PromptStorageManager.getKeyboardShortcut();
    if (!KeyboardManager.shortcutCache && shortcut) KeyboardManager.shortcutCache = shortcut;
    if (e[shortcut.modifier] && (shortcut.requiresShift ? e.shiftKey : true) && e.key.toLowerCase() === shortcut.key.toLowerCase()) {
      e.preventDefault();
      KeyboardManager._togglePromptList();
      return;
    }

    if (e.key === 'Escape') {
      PromptUIManager.handleGlobalEscape(e);
      return;
    }

    const searchEl = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
    const isSearchActive = document.activeElement === searchEl;
    if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
      PromptUIManager.handleKeyboardNavigation(e, isSearchActive ? 'search' : 'list');
    }
  }

  static async _togglePromptList() {
    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!listEl) return;
    if (listEl.classList.contains('opm-visible')) {
      PromptUIManager.hidePromptList(listEl);
    } else {
      PromptUIManager.manuallyOpened = true;
      await PromptUIManager.mountListOrCreateBasedOnPrompts();
    }
  }

  static async _loadShortcut() {
    try {
      KeyboardManager.shortcutCache = await PromptStorageManager.getKeyboardShortcut();
    } catch (_) { /* ignore */ }
  }

  static _attachShortcutWatcher() {
    if (!chrome || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes && changes.keyboardShortcut && changes.keyboardShortcut.newValue) {
        KeyboardManager.shortcutCache = changes.keyboardShortcut.newValue;
      }
    });
  }
}

/* =========================================================================
   Reinforce global styles injection guard
   ============================================================================ */
ensureStylesInjected();

// Dark Mode Handling
/* ---------------------------------------------------------------------------
 * Theme handling (dark / light) with subscription hook
 * -------------------------------------------------------------------------*/
let isDarkModeActive = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
// Initialize global forced state (shared with content.shared.js)
if (typeof window.isDarkModeForced === 'undefined') window.isDarkModeForced = false;

/* Read current mode */
const isDarkMode = () => (window.isDarkModeForced ? true : isDarkModeActive);

/* Listen to OS-level preference changes */
if (window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', e => {
    isDarkModeActive = e.matches;
    PromptUIManager.updateThemeForUI();
  });
}

/* [08] Simple Event Bus */
class EventBus {
  constructor() { this.events = {}; }
  on(evt, listener) { (this.events[evt] = this.events[evt] || []).push(listener); }
  emit(evt, ...args) { (this.events[evt] || []).forEach(fn => fn(...args)); }
}

/* [09] Storage Manager */
class PromptStorageManager {
  // Generic local-storage helpers (still used by non-prompt features)
  static async getData(key, def) {
    return await ChromeBridge.storage.get(key, def);
  }

  static async setData(key, value) {
    return await ChromeBridge.storage.set(key, value);
  }
  // ---- Unified prompt operations ----
  static async _ps() {
    // COMMENT: Use the unified module in `src/promptStorage.js` via a dynamic import
    if (this.__ps) return this.__ps;

    // COMMENT: Dynamically import the web-accessible module so content-scripts can use it
    const mod = await import(chrome.runtime.getURL('promptStorage.js'));

    // COMMENT: Build a thin adapter to keep current call-sites unchanged
    this.__ps = {
      getPrompts: mod.getPrompts,
      setPrompts: mod.setPrompts,
      savePrompt: mod.savePrompt,
      updatePrompt: mod.updatePrompt,
      deletePrompt: mod.deletePrompt,
      importPrompts: mod.importPrompts
    };
    return this.__ps;
  }

  static async getPrompts() {
    const ps = await this._ps();
    return await ps.getPrompts();
  }

  static async savePrompt(prompt) {
    const ps = await this._ps();
    return await ps.savePrompt(prompt);
  }

  static async setPrompts(prompts) {
    // COMMENT: Expose bulk set for reorder use-cases via the unified module
    const ps = await this._ps();
    return await ps.setPrompts(prompts);
  }

  static async mergeImportedPrompts(imported) {
    const ps = await this._ps();
    // imported may be array or JSON string
    return await ps.importPrompts(imported);
  }
  
  static async getButtonPosition() { return await PromptStorageManager.getData('buttonPosition', { x: 75, y: 100 }); }
  static async saveButtonPosition(pos) {
    const current = await PromptStorageManager.getButtonPosition();
    if (current.x === pos.x && current.y === pos.y) return true;
    return await PromptStorageManager.setData('buttonPosition', pos);
  }
  static async getKeyboardShortcut() {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    return await PromptStorageManager.getData('keyboardShortcut', {
      key: isMac ? 'p' : 'm',
      modifier: isMac ? 'metaKey' : 'ctrlKey',
      requiresShift: isMac
    });
  }
  static async saveKeyboardShortcut(shortcut) { return await PromptStorageManager.setData('keyboardShortcut', shortcut); }
  static async getOnboardingCompleted() { return await PromptStorageManager.getData('onboardingCompleted', false); }
  static async setOnboardingCompleted() { return await PromptStorageManager.setData('onboardingCompleted', true); }
  static async getDisplayMode() { return await PromptStorageManager.getData('displayMode', 'standard'); }
  static async saveDisplayMode(mode) { return await PromptStorageManager.setData('displayMode', mode); }
  static async getForceDarkMode() { return await PromptStorageManager.getData('forceDarkMode', false); }
  static async saveForceDarkMode(enabled) { return await PromptStorageManager.setData('forceDarkMode', !!enabled); }

  // COMMENT: Preference to append prompts instead of overwriting the input area
  static async getDisableOverwrite() {
    // COMMENT: 默认开启“追加模式”（不覆盖输入框原有内容）
    return await PromptStorageManager.getData('disableOverwrite', true);
  }
  static async saveDisableOverwrite(value) {
    // COMMENT: Persist the user's preference for append vs overwrite
    return await PromptStorageManager.setData('disableOverwrite', !!value);
  }

  // COMMENT: Feature flag for tags in prompt creation UI (off by default)
  static async getEnableTags() {
    // COMMENT: 默认开启“标签模式”
    return await PromptStorageManager.getData('enableTags', true);
  }
  static async saveEnableTags(value) {
    return await PromptStorageManager.setData('enableTags', !!value);
  }

  // COMMENT: Persist the active tag filter across sessions (LIST view)
  static async getActiveTagFilter() {
    return await PromptStorageManager.getData('activeTagFilter', 'all');
  }
  static async saveActiveTagFilter(tag) {
    const clean = (tag || 'all');
    return await PromptStorageManager.setData('activeTagFilter', clean);
  }

  // COMMENT: Persistent custom display order for tags in settings (array of tag names)
  static async getTagsOrder() {
    return await PromptStorageManager.getData('tagsOrder', []);
  }
  static async saveTagsOrder(order) {
    if (!Array.isArray(order)) return false;
    return await PromptStorageManager.setData('tagsOrder', order);
  }
}
window.PromptStorageManager = PromptStorageManager;



/* UI Manager */
class PromptUIManager {
  // COMMENT: Configuration for the info banner. Toggle 'active' to show/hide.
  static BANNER_CONFIG = {
    active: true, 
    id: 'info-banner-v2', // Change ID to re-show to users who dismissed it
    html: `<span>
      <strong>更新:</strong> 选中文本可右键保存为提示词 & 提示词生成功能! </br></br>
    </span>`
  };

  static state = {
    root: null,
    currentMode: null,
    buttonContainer: null,
    hotCornerContainer: null,
    hotCornerVisibilityHandler: null,
    lastPromptsSignature: null,
    listMode: 'list',
    tagsBar: null,
    suppressNextListRefresh: false
  };

  static _ensureRoot() {
    let root = PromptUIManager.state.root;
    if (root && document.body.contains(root)) return root;
    root = document.getElementById(SELECTORS.ROOT);
    if (!root) {
      root = createEl('div', { id: SELECTORS.ROOT });
      document.body.appendChild(root);
      root.classList.add(`opm-${getMode()}`);
    }
    PromptUIManager.state.root = root;
    return root;
  }
  // COMMENT: Toggle panel height mode: 'variable' (LIST) or 'fixed' (other views)
  static setPanelHeightMode(mode) {
    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!listEl) return;
    listEl.classList.remove('opm-fixed-400', 'opm-variable');
    if (mode === 'variable') listEl.classList.add('opm-variable'); else listEl.classList.add('opm-fixed-400');
  }
  // COMMENT: Track whether the active list should expose editing controls or standard view.
  static setListMode(mode = 'list') {
    const normalized = mode === 'edit' ? 'edit' : 'list';
    PromptUIManager.state.listMode = normalized;
    PromptUIManager.applyListModeClass();
  }
  static applyListModeClass() {
    const root = PromptUIManager._ensureRoot();
    root.classList.toggle('opm-edit-mode-active', PromptUIManager.state.listMode === 'edit');
  }
  static requestListRefreshSuppression() {
    PromptUIManager.state.suppressNextListRefresh = true;
  }
  // COMMENT: Map manager flags to PromptUI.State via accessors
  static get manuallyOpened() { return PromptUI.State.manuallyOpened; }
  static set manuallyOpened(v) { PromptUI.State.manuallyOpened = v; }
  static get inVariableInputMode() { return PromptUI.State.inVariableInputMode; }
  static set inVariableInputMode(v) { PromptUI.State.inVariableInputMode = v; }
  static onPromptSelect(cb) { PromptUIManager._eb.on('promptSelect', cb); }
  static emitPromptSelect(prompt) { PromptUIManager._eb.emit('promptSelect', prompt); }
  static _eb = new EventBus();
  // COMMENT: Removed panel height lock; CSS now enforces min/max height across views

  static injectPromptManagerButton(prompts) {
    if (PromptUIManager.state.buttonContainer &&
        document.body.contains(PromptUIManager.state.buttonContainer)) {
      PromptUIManager.refreshPromptList(prompts);
      return;
    }
    PromptStorageManager.getButtonPosition().then(pos => {
      const container = createEl('div', { id: SELECTORS.PROMPT_BUTTON_CONTAINER, styles: UI_STYLES.getPromptButtonContainerStyle(pos) });
      const button = createEl('button', { id: SELECTORS.PROMPT_BUTTON, className: 'opm-prompt-button' });
      container.appendChild(button);
      const listEl = createEl('div', { id: SELECTORS.PROMPT_LIST, className: `opm-prompt-list opm-${getMode()} opm-fixed-400` });
      container.appendChild(listEl);
      PromptUIManager._ensureRoot().appendChild(container);
      PromptUIManager.refreshPromptList(prompts);
      PromptUIManager.attachButtonEvents(button, listEl, container, prompts);
      PromptUIManager.makeDraggable(container);
      PromptUIManager.checkAndShowOnboarding(container);
      OutsideClickCloser.ensure();
      PromptUIManager.state.buttonContainer = container;
      PromptUIManager.state.hotCornerContainer = null;
      PromptUIManager.state.currentMode = 'standard';
    });
  }

  static async checkAndShowOnboarding(container) {
    const onboardingCompleted = await PromptStorageManager.getOnboardingCompleted();
    // Remove "!" to the onboardingCompleted to force it to show.
    if (!onboardingCompleted) {
      PromptUIManager.showOnboardingPopup(container);
    }
  }

  static showOnboardingPopup(container) {
    const existingPopup = document.getElementById(SELECTORS.ONBOARDING_POPUP);
    if (existingPopup) existingPopup.remove();
    const popup = createEl('div', {
      id: SELECTORS.ONBOARDING_POPUP,
      className: `opm-onboarding-popup opm-${getMode()}`,
      styles: {
        position: 'absolute', top: '-42px', left: '50%',
        transform: 'translateX(-50%)', backgroundColor: `${THEME_COLORS.primary}dd`,
        color: 'white', padding: '6px 10px', borderRadius: '6px',
        fontSize: '13px', fontWeight: 'bold', zIndex: '10000',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
        textAlign: 'center', whiteSpace: 'nowrap', transition: 'opacity 0.3s ease'
      },
      innerHTML: '悬停开始'
    });
    const triangle = createEl('div', {
      styles: {
        position: 'absolute', bottom: '-4px', left: '50%',
        transform: 'translateX(-50%)', width: '0', height: '0',
        borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        borderTop: `5px solid ${THEME_COLORS.primary}dd`
      }
    });
    popup.appendChild(triangle);
    container.appendChild(popup);
    setTimeout(() => {
      if (popup && popup.parentNode) {
        popup.style.opacity = '0';
        setTimeout(() => {
          if (popup && popup.parentNode) popup.remove();
        }, ONBOARDING_FADE_OUT_MS);
      }
    }, ONBOARDING_AUTO_HIDE_MS);
  }

  static attachButtonEvents(button, listEl /*, container, prompts */) {
    // COMMENT: Delegate event wiring to internal PromptUI.Events
    PromptUI.Events.attachButtonEvents(button, listEl);
  }

  static startCloseTimer(e, listEl, callback) {
    // COMMENT: Use shared behavior to coordinate delayed hide
    PromptUI.Behaviors.startCloseTimer(listEl, callback);
  }
  static cancelCloseTimer() {
    // COMMENT: Cancel any pending delayed hide
    PromptUI.Behaviors.cancelCloseTimer();
  }

  static makeDraggable(container) {
    let pos = { x: 0, y: 0 };
    PromptStorageManager.getButtonPosition().then(savedPos => {
      pos = savedPos;
      Object.assign(container.style, {
        right: `${pos.x}px`,
        bottom: `${pos.y}px`
      });
    });
    container.addEventListener('mousedown', startEvent => {
      if (startEvent.target.id !== SELECTORS.PROMPT_BUTTON) return;
      const startX = startEvent.clientX;
      const startY = startEvent.clientY;
      const startRight = parseInt(container.style.right, 10) || 0;
      const startBottom = parseInt(container.style.bottom, 10) || 0;
      container.style.transition = 'none';
      const handleMove = moveEvent => {
        const newX = Math.min(
          Math.max(startRight + (startX - moveEvent.clientX), 0),
          window.innerWidth - container.offsetWidth
        );
        const newY = Math.min(
          Math.max(startBottom + (startY - moveEvent.clientY), 0),
          window.innerHeight - container.offsetHeight
        );
        container.style.right = `${newX}px`;
        container.style.bottom = `${newY}px`;
      };
      const handleEnd = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleEnd);
        container.style.transition = 'all 0.3s ease';
        const newPos = {
          x: parseInt(container.style.right, 10),
          y: parseInt(container.style.bottom, 10)
        };
        if (Math.abs(newPos.x - pos.x) > 5 || Math.abs(newPos.y - pos.y) > 5) {
          PromptStorageManager.saveButtonPosition(newPos)
            .then(success => {
              if (success) pos = newPos;
            });
        }
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleEnd);
    });
  }

  static refreshPromptList(prompts) {    // COMMENT: Rebuild list and ensure search is visible via centralized helper
    const signature = PromptUIManager.computePromptsSignature(prompts);
    if (signature && PromptUIManager.state.lastPromptsSignature === signature) {
      PromptUIManager.setSearchVisibility(true);
      return;
    }
    PromptUIManager.buildPromptListContainer(prompts);
    PromptUIManager.state.lastPromptsSignature = signature;
    PromptUIManager.setSearchVisibility(true);
  }

  static refreshItemsIfListActive(prompts = []) {   // COMMENT: Only refresh the items list when the prompt list view is active
    const panel = document.getElementById(SELECTORS.PANEL_CONTENT);
    if (!panel) return;
    const items = panel.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}.opm-view-list`);
    if (!items) return; // not on the list view – skip to avoid toggling search visibility
    if (PromptUIManager.state.suppressNextListRefresh) {
      PromptUIManager.state.suppressNextListRefresh = false;
      PromptUIManager.setSearchVisibility(true);
      return;
    }
    const signature = PromptUIManager.computePromptsSignature(prompts);
    if (!signature || PromptUIManager.state.lastPromptsSignature !== signature) {
      PromptUIManager.buildPromptListContainer(prompts);
      PromptUIManager.state.lastPromptsSignature = signature;
    }
    PromptUIManager.setSearchVisibility(true);
    // COMMENT: After a storage-driven refresh, reapply the active tag filter (if any) and current search term
    // COMMENT: Check if the currently selected tag still exists; if not, reset to 'all' to avoid empty list
    const currentTag = (PromptUIManager.activeTagFilter || 'all').toLowerCase();
    let selected = currentTag;
    if (currentTag !== 'all') {
      // COMMENT: Compute tag counts synchronously from the prompts array
      const counts = new Map();
      prompts.forEach(p => (Array.isArray(p.tags) ? p.tags : []).forEach(t => {
        const key = String(t).trim().toLowerCase();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }));
      // COMMENT: If the selected tag no longer exists (e.g., all prompts with that tag were deleted), reset to 'all'
      if (!counts.has(currentTag)) {
        selected = 'all';
        PromptUIManager.activeTagFilter = 'all';
        // COMMENT: Update the tag bar UI to reflect the reset
        const tagsHost = document.querySelector(`#${SELECTORS.PANEL_CONTENT} .opm-tags-filter-bar`);
        if (tagsHost) {
          tagsHost.querySelectorAll('button').forEach(btn => {
            const isAll = btn.dataset.tag === 'all';
            btn.setAttribute('aria-pressed', String(isAll));
          });
        }
        PromptStorageManager.saveActiveTagFilter('all');
      }
    }
    const input = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
    const term = input ? input.value : '';
    PromptUIManager.filterByTag(selected);
    if (term) PromptUIManager.filterPromptItems(term);
  }

  static setSearchVisibility(visible) {   // COMMENT: Explicitly control visibility of the search input in the bottom menu
    const input = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
    if (input) input.style.display = visible ? 'block' : 'none';
  }

  // COMMENT: Control bottom menu visibility. Chat view hides it to prevent overlap with its own input area.
  static setBottomMenuVisibility(visible) {
    const panel = document.getElementById(SELECTORS.PANEL_CONTENT);
    if (!panel) return;
    const bottomMenu = panel.querySelector('.opm-bottom-menu');
    if (bottomMenu) bottomMenu.style.display = visible ? 'flex' : 'none';
    // COMMENT: Panel reserves space for the absolute bottom menu; remove it when hidden.
    panel.style.paddingBottom = visible ? '64px' : '0px';
  }

  // COMMENT: Centralized prompt items filter used by search input
  static filterPromptItems(term) {
    const value = (term || '').toLowerCase();
    const container = document.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
    if (!container) return;
    // Combine with active tag filter if present
    const activeTag = (PromptUIManager.activeTagFilter || 'all').toLowerCase();
    Array.from(container.children).forEach(item => {
      const matchesSearch = value === ''
        || item.dataset.title?.includes(value)
        || item.dataset.content?.includes(value)
        || item.dataset.tags?.includes(value);
      // COMMENT: Use the exact tags list (JSON) for pill filtering to handle multi-word tags
      let matchesTag = true;
      if (activeTag !== 'all') {
        try {
          const tagList = JSON.parse(item.dataset.tagsList || '[]');
          matchesTag = Array.isArray(tagList) && tagList.includes(activeTag);
        } catch (_) { matchesTag = false; }
      }
      item.style.display = (matchesSearch && matchesTag) ? 'flex' : 'none';
    });
    PromptUIManager.selectedSearchIndex = -1;
  }

  // COMMENT: Ensure every scrollable region only shows scrollbars while in motion.
  static refreshScrollObservers(context = document) {
    if (!window.ScrollVisibilityManager) return;
    const selectors = [
      `.${SELECTORS.PROMPT_ITEMS_CONTAINER}`,
      '.opm-form-container',
      `#${SELECTORS.INFO_CONTENT}`,
      `#${SELECTORS.CHAT_CONTENT}`,
      '.opm-tags-filter-bar'
    ];
    const ensure = (node) => ScrollVisibilityManager.observe(node);
    selectors.forEach(sel => {
      if (context.matches?.(sel)) ensure(context);
      context.querySelectorAll?.(sel)?.forEach(ensure);
    });
  }

  // COMMENT: Tag filter setter that reruns combined filtering without changing panel height
  static filterByTag(tag) {
    const prev = (PromptUIManager.activeTagFilter || 'all');
    PromptUIManager.activeTagFilter = (tag || 'all');
    // Re-apply current search term to combine filters
    const input = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
    const term = input ? input.value : '';
    PromptUIManager.filterPromptItems(term);
    // COMMENT: Persist selected tag for future sessions
    PromptStorageManager.saveActiveTagFilter(PromptUIManager.activeTagFilter);
  }

  // COMMENT: Centralized clearing of search input and results state
  static clearSearchInput() {
    const input = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
    if (input) input.value = '';
    PromptUIManager.selectedSearchIndex = -1;
  }

  static buildPromptListContainer(prompts = []) {   // COMMENT: Rebuild the list content using internal view composition
    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!listEl) return;
    Theme.applyNode(listEl);
    const existingPanel = listEl.querySelector(`#${SELECTORS.PANEL_CONTENT}`);
    const existingItems = existingPanel?.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
    const previousScrollTop = existingItems ? existingItems.scrollTop : 0;
    listEl.innerHTML = '';
    const mode = PromptUIManager.state.listMode || 'list';
    const content = PromptUI.Views.renderPromptList(prompts, { mode });
    
    // COMMENT: Inject Info Banner if active and not dismissed
    if (PromptUIManager.BANNER_CONFIG.active) {
      (async () => {
        try {
          const dismissed = await PromptStorageManager.getData('dismissedBanners', []);
          if (dismissed.includes(PromptUIManager.BANNER_CONFIG.id)) return;

          const banner = createEl('div', {
            className: `opm-info-banner opm-${getMode()}`,
            styles: {
              padding: '10px 12px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'start',
              justifyContent: 'space-between',
              gap: '8px',
              borderBottom: isDarkMode() ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.06)',
              backgroundColor: isDarkMode() ? 'rgba(54, 116, 181, 0.15)' : '#ebf8ff', // Tinted primary/blue
              color: isDarkMode() ? '#E2E8F0' : '#2C5282',
              flex: '0 0 auto',
              lineHeight: '1.4'
            },
            innerHTML: `
              <div style="flex: 1;">${PromptUIManager.BANNER_CONFIG.html}</div>
            `
          });

          const closeBtn = createEl('button', {
            innerHTML: '×',
            styles: {
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '0 4px', fontSize: '18px', lineHeight: '1', opacity: '0.6',
              color: 'inherit', display: 'flex', alignItems: 'center'
            }
          });
          closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
          closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.6');
          closeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            banner.remove();
            const current = await PromptStorageManager.getData('dismissedBanners', []);
            if (!current.includes(PromptUIManager.BANNER_CONFIG.id)) {
              current.push(PromptUIManager.BANNER_CONFIG.id);
              await PromptStorageManager.setData('dismissedBanners', current);
            }
          });

          banner.appendChild(closeBtn);
          
          // Insert before the tags bar (if present) or at the top
          // The content container has: tagsHost, itemsContainer, bottomMenu.
          content.insertBefore(banner, content.firstChild);
        } catch (err) {
          console.error('[PromptManager] Failed to render banner:', err);
        }
      })();
    }

    listEl.appendChild(content);
    const newItems = content.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
    if (newItems) {
      newItems.scrollTop = previousScrollTop;
    }
    PromptUIManager.refreshScrollObservers(listEl);
    PromptUIManager.applyListModeClass();
  }

  static resetPromptListContainer() {
    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    const wasVisible = listEl && listEl.classList.contains('opm-visible');
    PromptUIManager.buildPromptListContainer();
    PromptUIManager.state.lastPromptsSignature = null;
    if (wasVisible) {
      const updated = qs(`#${SELECTORS.PROMPT_LIST}`);
      if (updated) { updated.style.display = 'block'; void updated.offsetHeight; updated.classList.add('opm-visible'); }
    }
  }

  static replacePanelMainContent(node) {  // COMMENT: Replace the scrollable main area (prompt items) while preserving the bottom menu
    const panel = document.getElementById(SELECTORS.PANEL_CONTENT);
    if (!panel) return;
    const items = panel.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
    if (items) {
      items.replaceWith(node);
    } else {  // If items container is missing, inject the node before the last child (bottom menu) if present
      const lastChild = panel.lastElementChild;
      if (lastChild) panel.insertBefore(node, lastChild); else panel.appendChild(node);
    }
    // COMMENT: Toggle search visibility based on whether the new node is the list view
    const isListView = node.classList && node.classList.contains('opm-view-list');
    PromptUIManager.setSearchVisibility(!!isListView);
    PromptUIManager.refreshScrollObservers(panel);
  }

  // COMMENT: Show the prompt list and handle keyboard navigation
  static showPromptList(listEl) {
    if (!listEl) return;
    // COMMENT: Detect whether we are opening the panel (vs already open)
    const wasVisible = listEl.classList.contains('opm-visible');
    // COMMENT: When showing, if current view is LIST, allow variable height; else keep fixed
    const panelNode = document.getElementById(SELECTORS.PANEL_CONTENT);
    const isListView = panelNode && panelNode.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}.opm-view-list`);
    PromptUIManager.setPanelHeightMode(isListView ? 'variable' : 'fixed');
    PromptUI.Behaviors.showList(listEl);
    const panel = document.getElementById(SELECTORS.PANEL_CONTENT);
    const hasListItems = panel && panel.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}.opm-view-list`);
    // COMMENT: Reapply existing filters/search when reopening the list instead of refetching storage data
    if (!wasVisible && hasListItems) {
      const searchInput = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
      const currentTerm = searchInput ? searchInput.value : '';
      PromptUIManager.filterPromptItems(currentTerm);
    }
    // COMMENT: Focus only if list view is active
    PromptUIManager.setSearchVisibility(!!hasListItems);
    if (hasListItems) {
      const first = listEl.querySelector('.opm-prompt-list-item');
      if (first) setTimeout(() => first.focus(), SEARCH_FOCUS_DELAY_MS);
      PromptUIManager.focusSearchInput();
    }
    PromptUIManager.completeOnboarding();
  }

  static hidePromptList(listEl) {
    if (!listEl) return;
    // COMMENT: Use unified hide behavior, then perform manager-side cleanup
    PromptUI.Behaviors.hideList(listEl);
    PromptUIManager.clearSearchInput();
    // Reset both flags when hiding the view
    PromptUIManager.manuallyOpened = false;
    PromptUIManager.inVariableInputMode = false;
  }

  static handleKeyboardNavigation(e, context = 'list') {
    const list = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!list || !list.classList.contains('opm-visible')) return;
    PromptUIManager.cancelCloseTimer();
    let items = [];
    if (context === 'search') {
      const container = document.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
      if (!container) return;
      items = Array.from(container.querySelectorAll('.opm-prompt-list-item'))
        .filter(item => item.style.display !== 'none');
    } else {
      items = Array.from(list.querySelectorAll('.opm-prompt-list-item'));
    }
    if (items.length === 0) return;
    let idx = context === 'search' ? PromptUIManager.selectedSearchIndex : items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (context === 'search') {
        PromptUIManager.selectedSearchIndex = Math.min(PromptUIManager.selectedSearchIndex + 1, items.length - 1) || 0;
        PromptUIManager.updateSelection(items, PromptUIManager.selectedSearchIndex);
      } else {
        items[(idx === -1 || idx === items.length - 1) ? 0 : idx + 1].focus();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (context === 'search') {
        PromptUIManager.selectedSearchIndex = Math.max(PromptUIManager.selectedSearchIndex - 1, -1);
        PromptUIManager.updateSelection(items, PromptUIManager.selectedSearchIndex);
      } else {
        items[(idx <= 0) ? items.length - 1 : idx - 1].focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (context === 'search') {
        if (PromptUIManager.selectedSearchIndex >= 0 && PromptUIManager.selectedSearchIndex < items.length) {
          items[PromptUIManager.selectedSearchIndex].click();
        } else if (items.length === 1) {
          items[0].click();
        }
      } else if (idx !== -1) {
        items[idx].click();
      }
    }
  }

  static handleGlobalEscape(e) {
    if (e.key === 'Escape') {
      const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
      if (listEl && listEl.classList.contains('opm-visible')) {
        e.preventDefault();
        PromptUIManager.selectedSearchIndex = -1;
        const container = document.querySelector(`.${SELECTORS.PROMPT_ITEMS_CONTAINER}`);
        if (container) {
          const items = Array.from(container.querySelectorAll('.opm-prompt-list-item'))
            .filter(item => item.style.display !== 'none');
          PromptUIManager.updateSelection(items, -1);
        }
        PromptUIManager.hidePromptList(listEl);
      }
    }
  }

  static updateThemeForUI() {
    Theme.applyAll();
    const container = document.getElementById(SELECTORS.PROMPT_BUTTON_CONTAINER);
    if (container) {
      const btn = container.querySelector(`#${SELECTORS.PROMPT_BUTTON}`) || container.querySelector('.opm-prompt-button');
      if (btn) {
        btn.style.boxShadow = isDarkMode() ? THEME_COLORS.darkShadow : THEME_COLORS.lightShadow;
      }
    }
    const icons = document.querySelectorAll(`#${SELECTORS.ROOT} .opm-icon-button img`);
    icons.forEach(icon => { icon.style.filter = getIconFilter(); });
  }

  static focusSearchInput() {
    const input = document.getElementById(SELECTORS.PROMPT_SEARCH_INPUT);
    if (input) { Theme.applyNode(input); requestAnimationFrame(() => { input.focus(); input.select(); }); }
  }  

  static createVariableInputForm({ inputBox, content, variables, onSubmit }) {
    PromptUIManager.inVariableInputMode = true;

    const form = createEl('div', {
      className: `opm-form-container opm-${getMode()}`,
      styles: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden', minHeight: '0' }
    });
    // COMMENT: Layout behavior depends on the number of variables
    const count = Array.isArray(variables) ? variables.length : 0;
    const singleMode = count <= 1;
    const splitMode = count === 2 || count === 3;   // COMMENT: equal split within available height
    const listMode = count >= 4;                    // COMMENT: compact list of single-line inputs
    const itemGap = listMode ? '8px' : '12px';
    // COMMENT: In single-variable mode, do not expand to fill all available height
    const varContainerFlex = singleMode ? '0 1 auto' : '1 1 auto';
    const varContainer = createEl('div', {
      // COMMENT: Grow to fill remaining height and become the only scrollable area when content exceeds space.
      // COMMENT: Use both gap and rowGap for broader compatibility across flex-gap implementations.
      styles: {
        display: 'flex',
        flexDirection: 'column',
        gap: itemGap,
        rowGap: itemGap,
        flex: varContainerFlex,
        minHeight: '0',
        overflowY: 'auto',
        // COMMENT: Add subtle top/bottom padding for list presentation when many variables
        paddingTop: listMode ? '8px' : '0',
        paddingBottom: listMode ? '8px' : '0'
      }
    });
    ScrollVisibilityManager.observe(varContainer);
    const varValues = {};
    variables.forEach(v => {
      // COMMENT: Normalize label text — replace underscores with spaces and capitalize first letter
      const displayLabel = String(v).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
      // COMMENT: Each variable row flexes so space is shared logically between variables.
      // - For 1 variable: grow to consume available height (textarea fills the space)
      // - For 2 or 3 variables: share space evenly (50-50 or thirds) within available height
      // - For 4+ variables: compact rows that do not grow, list scrolls when needed
      const row = createEl('div', {
        styles: {
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          // COMMENT: Equal splits for 2 or 3 variables; single mode stays compact; list is compact.
          flex: singleMode ? '0 0 auto' : (splitMode ? '1 1 0%' : '0 0 auto'),
          // COMMENT: Let flex children shrink properly in split mode
          minHeight: splitMode ? '0' : 'auto',
          // COMMENT: Add explicit margin fallback so rows never visually collide if gap is not honored.
          marginBottom: itemGap,
          // COMMENT: Apply list-like vertical padding when many variables
          padding: listMode ? '6px 0' : '0'
        }
      });
      // COMMENT: Use standard font inheritance by avoiding custom font styles and rely on theme class
      // COMMENT: Subtle, consistent label styling to match the rest of the UI
      const label = createEl('label', {
        innerHTML: displayLabel,
        className: `opm-${getMode()}`,
        styles: {
          fontSize: '12px',
          fontWeight: '600',
          letterSpacing: '0.2px',
          opacity: '0.85',
          padding: '0 2px'
        }
      });
      // COMMENT: Use a textarea with approx three lines height for easier multi-line input
      // COMMENT: Rows: single = compact editor; 2-3 = shared vertical space; 4+ = compact single-line list
      const rowsAttr = listMode ? '1' : (splitMode ? '3' : '6');
      const inputField = createEl('textarea', {
        // COMMENT: Rows tuned per mode and clear placeholder
        attributes: { rows: rowsAttr, placeholder: `${displayLabel} value` },
        className: `opm-textarea-field opm-${getMode()}`,
        // COMMENT: Let the textarea expand within its row. In split mode, disable manual resize to preserve equal distribution.
        // COMMENT: Minimum height ~ one line; when there are many variables and space runs out, the container scrolls.
        styles: {
          // COMMENT: Increase vertical padding for a more comfortable input.
          padding: '12px 10px',
          // COMMENT: Taller minima so fields feel more usable without manual resizing.
          minHeight: listMode ? '18px' : (splitMode ? '60px' : '1px'),
          // COMMENT: For list mode enforce single-line visual height
          height: listMode ? '18px' : 'auto',
          // COMMENT: Ensure sizing accounts for padding and borders to prevent layout overflow/overlap.
          boxSizing: 'border-box',
          width: '100%',
          // COMMENT: Flex behavior depends on mode: split fills evenly; single & list are compact
          flex: listMode ? '0 0 auto' : (splitMode ? '1 1 auto' : '0 0 auto'),
          resize: (splitMode || listMode) ? 'none' : 'vertical'
        }
      });
      inputField.addEventListener('input', () => { varValues[v] = inputField.value; });
      // COMMENT: Preserve Enter-to-submit behavior for consistency with previous single-line inputs
      inputField.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); } });
      row.append(label, inputField);
      varContainer.appendChild(row);
      varValues[v] = '';
    });
    form.appendChild(varContainer);
    // COMMENT: Ensure non-list view uses fixed height
    PromptUIManager.setPanelHeightMode('fixed');
    // COMMENT: Button container sticks to bottom of the panel
    const btnContainer = createEl('div', { styles: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', marginTop: 'auto', position: 'sticky', bottom: '0', background: 'transparent' } });
    const submitBtn = createEl('button', { innerHTML: '提交', className: `opm-button opm-${getMode()}` });
    submitBtn.addEventListener('click', () => {
      PromptUIManager.inVariableInputMode = false;
      onSubmit(varValues);
    });
    const backBtn = createEl('button', { innerHTML: 'Back', className: `opm-button opm-${getMode()}` });
    backBtn.addEventListener('click', () => {
      PromptUIManager.inVariableInputMode = false;
      PanelRouter.mount(PanelView.LIST);
    });
    btnContainer.append(submitBtn, backBtn);
    form.appendChild(btnContainer);
    requestAnimationFrame(() => {
    const firstInput = varContainer.querySelector('textarea, input');
    if (firstInput) firstInput.focus();
    });
    return form;
  }

  static createPromptCreationForm(prefill = '') {
    // COMMENT: Delegate to PromptUI.Views to build the creation form
    return PromptUI.Views.createPromptCreationForm(prefill);
  }

  static async showEditForm(prompt /*, index */) {
    const list = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (!list) return;
    PromptUIManager.resetPromptListContainer();
    // COMMENT: Show search in edit form as well for consistent filtering
    PromptUIManager.setSearchVisibility(true);
    const form = PromptUI.Views.createPromptForm({
      initialTitle: prompt.title,
      initialContent: prompt.content,
      submitLabel: 'Save Changes',
      onSubmit: async ({ title, content, tags }) => {
        const ps = await PromptStorageManager._ps();
        const update = { title, content };
        if (Array.isArray(tags)) update.tags = tags;
        await ps.updatePrompt(prompt.uuid, update);
        PanelRouter.mount(PanelView.EDIT);
      }
    });
    // COMMENT: Immediately render base form to avoid an empty panel while tags load
    PromptUIManager.replacePanelMainContent(form);
    const listElInitial = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (listElInitial) { PromptUIManager.showPromptList(listElInitial); PromptUIManager.setSearchVisibility(false); }
    // COMMENT: If tags are enabled, mount a reusable TagUI input
    (async () => {
      const enableTags = await PromptStorageManager.getEnableTags();
      if (!enableTags) {
        PromptUIManager.replacePanelMainContent(form);
        const listElAfter = qs(`#${SELECTORS.PROMPT_LIST}`);
        if (listElAfter) { PromptUIManager.showPromptList(listElAfter); PromptUIManager.setSearchVisibility(false); }
        return;
      }
      const label = createEl('label', { styles: { fontSize: '12px', fontWeight: 'bold' } });
      const tagInput = TagUI.createTagInput({ initialTags: Array.isArray(prompt.tags) ? prompt.tags : [] });
      const tagsBlock = createEl('div');
      tagsBlock.append(label, tagInput.element);
      const saveBtn = form.querySelector('.opm-button');
      if (saveBtn && saveBtn.parentNode) saveBtn.parentNode.insertBefore(tagsBlock, saveBtn);
      if (saveBtn) {
        const newBtn = saveBtn.cloneNode(true);
        saveBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', async e => {
          e.stopPropagation();
          const titleIn = form.querySelector('.opm-input-field');
          const contentArea = form.querySelector('.opm-textarea-field');
          const t = titleIn.value.trim(), c = contentArea.value.trim();
          if (!t || !c) { alert('Please fill in both title and content.'); return; }
          const ps = await PromptStorageManager._ps();
          await ps.updatePrompt(prompt.uuid, { title: t, content: c, tags: tagInput.getTags() });
          PanelRouter.mount(PanelView.EDIT);
        }, { once: true });
      }
      const listElAfter = qs(`#${SELECTORS.PROMPT_LIST}`);
      if (listElAfter) { PromptUIManager.showPromptList(listElAfter); PromptUIManager.setSearchVisibility(false); }
    })();
  }

  static async deletePrompt(uuid) {
    const ps = await PromptStorageManager._ps();
    await ps.deletePrompt(uuid);
    await PanelRouter.mount(PanelView.EDIT);
  }
  
  static createSettingsForm() {
    // COMMENT: Delegate to PromptUI.Views to build the settings form
    return PromptUI.Views.createSettingsForm();
  }

  static computePromptsSignature(prompts = []) {
    if (!Array.isArray(prompts)) return null;
    try {
      return prompts.map(p => `${p?.uuid || ''}:${p?.updatedAt || p?.createdAt || ''}`).join('|');
    } catch (err) {
      console.error('[PromptManager] Failed to compute prompts signature:', err);
      return null;
    }
  }

  // COMMENT: Update the selection of the items in the when using keyboard navigation
  static updateSelection(items, selIndex) {
    items.forEach((item, idx) => {
      item.style.backgroundColor = '';
      item.style.border = '';
      item.style.transform = '';
      item.classList.toggle('opm-keyboard-selected', idx === selIndex);
      if (idx === selIndex) {
        const container = item.parentElement, top = item.offsetTop, bottom = top + item.offsetHeight,
          cTop = container.scrollTop, cBottom = cTop + container.offsetHeight;
        if (top < cTop) container.scrollTop = top;
        else if (bottom > cBottom) container.scrollTop = bottom - container.offsetHeight;
      }
    });
  }

  // COMMENT: Store the selected index of the search results
  static selectedSearchIndex = -1;

  // HOT CORNER MODE
  static injectHotCorner() {
    if (PromptUIManager.state.hotCornerContainer &&
        document.body.contains(PromptUIManager.state.hotCornerContainer)) {
      return;
    }

    // container with active zone
    const container = createEl('div', {
      id: SELECTORS.HOT_CORNER_CONTAINER,
      styles: UI_STYLES.hotCornerActiveZone
    });

    //  visual indicator
    const indicator = createEl('div', {
      id: SELECTORS.HOT_CORNER_INDICATOR,
      styles: {
        position: 'fixed', bottom: '0', right: '0',
        width: '0', height: '0', zIndex: '9999',
        borderStyle: 'solid', borderWidth: `0 0 ${HOT_CORNER_INDICATOR_SMALL_PX}px ${HOT_CORNER_INDICATOR_SMALL_PX}px`,
        borderColor: `transparent transparent ${THEME_COLORS.primary}90 transparent`,
        transition: 'border-width 0.3s ease, border-color 0.3s ease',
        pointerEvents: 'none'
      }
    });
    container.appendChild(indicator);

    // Create the prompt list container with some positioning rules
    const listEl = createEl('div', {
      id: SELECTORS.PROMPT_LIST,
      className: `opm-prompt-list opm-${getMode()} opm-fixed-400`,
      styles: {
        position: 'absolute',
        right: '30px',
        bottom: '30px',
      }
    });
    container.appendChild(listEl);
    PromptUIManager._ensureRoot().appendChild(container);

    // Setup event handlers
    this.setupHotCornerEvents(container, indicator, listEl);
    OutsideClickCloser.ensure();
    PromptUIManager.state.hotCornerContainer = container;
    PromptUIManager.state.buttonContainer = null;
    PromptUIManager.state.currentMode = 'hotCorner';
  }

  // Extracted event handling for hot corner
  static setupHotCornerEvents(container, indicator, listEl) {
    container.addEventListener('mouseenter', async e => {
      e.stopPropagation();
      PromptUIManager.cancelCloseTimer();

      // COMMENT: Mirror button-mode behavior — only mount if the list is not already visible
      const listIsVisible = listEl.classList.contains('opm-visible');
      if (!listIsVisible && !PromptUIManager.inVariableInputMode) {
        PromptUIManager.manuallyOpened = false;
        indicator.style.borderWidth = `0 0 ${HOT_CORNER_INDICATOR_LARGE_PX}px ${HOT_CORNER_INDICATOR_LARGE_PX}px`;
        indicator.style.borderColor = `transparent transparent ${THEME_COLORS.primary} transparent`;
        await PromptUIManager.mountListOrCreateBasedOnPrompts();
      }
    });

    // Existing mouseleave handler
    // Cancel the close-timer when mouse re-enters the prompt list itself
    listEl.addEventListener('mouseenter', () => {
      PromptUIManager.cancelCloseTimer();
    });
    // Restart the timer when leaving the prompt list
    listEl.addEventListener('mouseleave', e => {
      // COMMENT: Ensure flags are reset when auto-closing so future hovers work
      PromptUIManager.startCloseTimer(e, listEl, () => {
        PromptUIManager.manuallyOpened = false;
        PromptUIManager.inVariableInputMode = false;
      });
    });

    container.addEventListener('mouseleave', e => {
      e.stopPropagation();
      indicator.style.borderWidth = `0 0 ${HOT_CORNER_INDICATOR_SMALL_PX}px ${HOT_CORNER_INDICATOR_SMALL_PX}px`;
      indicator.style.borderColor = `transparent transparent ${THEME_COLORS.primary}90 transparent`;
      // COMMENT: Reset flags on timed close to avoid getting stuck in a "manually opened" state
      PromptUIManager.startCloseTimer(e, listEl, () => {
        PromptUIManager.manuallyOpened = false;
        PromptUIManager.inVariableInputMode = false;
      });
    });

    // COMMENT: When the tab is hidden and later shown again, make sure the UI resets properly
    const visibilityHandler = () => {
      if (document.hidden) {
        // COMMENT: Reset flags and hide the list silently when tab loses visibility
        PromptUIManager.manuallyOpened = false;
        PromptUIManager.inVariableInputMode = false;
        PromptUI.Behaviors.hideList(listEl);
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    PromptUIManager.state.hotCornerVisibilityHandler = visibilityHandler;

    // Set onboarding as completed when hovering over hot corner
    container.addEventListener('mouseenter', () => { PromptUIManager.completeOnboarding(); });
  }

  static cleanupAllUIComponents() {
    // Clean up button container
    if (PromptUIManager.state.buttonContainer &&
        document.body.contains(PromptUIManager.state.buttonContainer)) {
      PromptUIManager.state.buttonContainer.remove();
    }

    // Clean up hot corner container
    if (PromptUIManager.state.hotCornerVisibilityHandler) {
      document.removeEventListener('visibilitychange', PromptUIManager.state.hotCornerVisibilityHandler);
      PromptUIManager.state.hotCornerVisibilityHandler = null;
    }
    if (PromptUIManager.state.hotCornerContainer &&
        document.body.contains(PromptUIManager.state.hotCornerContainer)) {
      PromptUIManager.state.hotCornerContainer.remove();
    }

    // Clean up any other global handlers or state
    PromptUIManager.manuallyOpened = false;
    PromptUIManager.state.buttonContainer = null;
    PromptUIManager.state.hotCornerContainer = null;
    PromptUIManager.state.currentMode = null;
    PromptUIManager.state.lastPromptsSignature = null;
  }

  static async refreshDisplayMode() {
    // clean up all existing UI components
    PromptUIManager.cleanupAllUIComponents();
    // Get the current mode and prompts
    const prompts = await PromptStorageManager.getPrompts();
    await PromptUIManager.injectUIForCurrentMode(prompts);

    // Make sure the prompt list is refreshed only if list view is active
    PromptUIManager.refreshItemsIfListActive(prompts);
    // If switching modes from settings, we should close any open menu
    const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
    if (listEl && listEl.classList.contains('opm-visible')) {
      PromptUIManager.hidePromptList(listEl);
    }
  }  

  // COMMENT: Helper to mark onboarding as complete and remove the popup if present
  static completeOnboarding() {
    PromptStorageManager.setOnboardingCompleted();
    const popup = document.getElementById(SELECTORS.ONBOARDING_POPUP);
    if (popup) popup.remove();
  }

  // COMMENT: Helper to mount LIST or CREATE based on prompt availability
  static async mountListOrCreateBasedOnPrompts() {
    const currentPrompts = await PromptStorageManager.getPrompts();
    if (currentPrompts.length === 0) PanelRouter.mount(PanelView.CREATE); else PanelRouter.mount(PanelView.LIST);
  }

  // COMMENT: Inject the correct UI based on current display mode
  static async injectUIForCurrentMode(prompts) {
    const displayMode = await PromptStorageManager.getDisplayMode();
    // COMMENT: Skip reinjection when the requested mode is already mounted and healthy
    const hasButtonUI = PromptUIManager.state.buttonContainer &&
      document.body.contains(PromptUIManager.state.buttonContainer);
    const hasHotCornerUI = PromptUIManager.state.hotCornerContainer &&
      document.body.contains(PromptUIManager.state.hotCornerContainer);
    if (PromptUIManager.state.currentMode === displayMode) {
      if (displayMode === 'standard' && hasButtonUI) {
        if (prompts) PromptUIManager.refreshPromptList(prompts);
        return;
      }
      if (displayMode === 'hotCorner' && hasHotCornerUI) return;
    }
    if (displayMode === 'standard') {
      const data = prompts || await PromptStorageManager.getPrompts();
      PromptUIManager.injectPromptManagerButton(data);
    } else {
      PromptUIManager.injectHotCorner();
    }
  }
}

window.PromptUIManager = PromptUIManager;

if (typeof window.__initPromptShared === 'function') {
  window.__initPromptShared();
}
const { TagService, TagUI, PromptUI } = window;

/* Prompt Processor */
class PromptProcessor {
  static extractVariables(content) {
    const regex = /#([a-zA-Z0-9_]+)#/g;
    return [...new Set([...content.matchAll(regex)].map(m => m[1]))];
  }
  static replaceVariables(content, values) {
    return Object.entries(values).reduce((res, [k, v]) => res.replace(new RegExp(`#${k}#`, 'g'), v), content);
  }
}

/* Prompt Mediator */
const PromptMediator = (() => {
  const state = {
    initialized: false,
    processor: null,
    promptSelectHandler: null,
    mutationObserver: null,
    storageWatcherAttached: false,
    ensureUiScheduled: false,
    ensureUiRunning: false,
    lastEnsureUiAt: 0
  };

  /**
   * COMMENT: Main prompt selection handler reused across listeners.
   * @param {Prompt} prompt
   */
  const handlePromptSelect = async (prompt) => {
      // COMMENT: Be resilient — if input box isn't ready yet, wait briefly before giving up
      let inputBox = await InputBoxHandler.getInputBox();
      if (!inputBox) {
        try {
          inputBox = await InputBoxHandler.waitForInputBox();
        } catch (_) {
          console.error('Input box not found.');
          return;
        }
      }
    const vars = state.processor.extractVariables(prompt.content);
      const listEl = qs(`#${SELECTORS.PROMPT_LIST}`);
      if (vars.length === 0) {
        await InputBoxHandler.insertPrompt(inputBox, prompt.content, listEl);
        PromptUIManager.hidePromptList(listEl);
      return;
    }
    PanelRouter.mount(PanelView.VARIABLE_INPUT, {
      inputBox,
      content: prompt.content,
      variables: vars,
      onSubmit: async values => {
        const processed = state.processor.replaceVariables(prompt.content, values);
        await InputBoxHandler.insertPrompt(inputBox, processed, qs(`#${SELECTORS.PROMPT_LIST}`));
        const activeList = qs(`#${SELECTORS.PROMPT_LIST}`);
        if (activeList) PromptUIManager.hidePromptList(activeList);
        setTimeout(() => {
          PromptStorageManager.getPrompts()
            .then(nextPrompts => { PromptUIManager.refreshPromptList(nextPrompts); })
            .catch(err => console.error('Failed to refresh prompt list after variable submission:', err));
        }, 300);
      }
    });
  };

  const ensurePromptSelectionListener = () => {
    if (state.promptSelectHandler) return;
    state.promptSelectHandler = handlePromptSelect;
    PromptUIManager.onPromptSelect(state.promptSelectHandler);
  };

  const setupMutationObserver = () => {
    if (state.mutationObserver) return;
    const target = document.querySelector('main') || document.body;
    if (!target) return;

    const ensureUIVisible = async () => {
      if (state.ensureUiRunning) return;
      const now = Date.now();
      // COMMENT: Avoid repeated heavy rebuilds on DOM-heavy pages
      if (now - state.lastEnsureUiAt < 1500) return;
      state.lastEnsureUiAt = now;
      state.ensureUiRunning = true;
      // COMMENT: Ensure UI is present even if an input box hasn't been detected yet
      if (!document.getElementById(SELECTORS.PROMPT_BUTTON_CONTAINER) &&
          !document.getElementById(SELECTORS.HOT_CORNER_CONTAINER)) {
        PromptUIManager.cleanupAllUIComponents();
        const prompts = await PromptStorageManager.getPrompts();
        await PromptUIManager.injectUIForCurrentMode(prompts);
      }
      state.ensureUiRunning = false;
    };

    const scheduleEnsureUIVisible = () => {
      if (state.ensureUiScheduled) return;
      state.ensureUiScheduled = true;
      requestAnimationFrame(() => {
        state.ensureUiScheduled = false;
        ensureUIVisible().catch(err => console.error('ensureUIVisible failed:', err));
      });
    };

    state.mutationObserver = new MutationObserver(scheduleEnsureUIVisible);
    state.mutationObserver.observe(target, { childList: true, subtree: true });
  };

  const setupStorageChangeMonitor = () => {
    if (state.storageWatcherAttached) return;
    state.storageWatcherAttached = true;
    (async () => {
      try {
        const { onPromptsChanged } = await import(chrome.runtime.getURL('promptStorage.js'));
        onPromptsChanged((prompts) => {
          // COMMENT: Only refresh items when the list view is active to avoid polluting non-list views
          PromptUIManager.refreshItemsIfListActive(prompts);
        });
      } catch (err) {
        state.storageWatcherAttached = false; // COMMENT: Allow retry if import fails transiently
        console.error('Failed to attach unified prompts change listener:', err);
      }
    })();
  };

  const setupKeyboardShortcuts = () => {
    KeyboardManager.initialize();
  };

  const bootstrap = async (ui, processor) => {
    if (state.initialized) return;
    state.initialized = true;
    
    // COMMENT: Load theme preference before UI injection
    try {
      window.isDarkModeForced = await PromptStorageManager.getForceDarkMode();
    } catch (_) { /* ignore */ }

    state.processor = processor;
    ensurePromptSelectionListener();
    // COMMENT: Inject UI immediately on page load without waiting for input box detection
    PromptStorageManager.getPrompts()
      .then(prompts => PromptUIManager.injectUIForCurrentMode(prompts))
      .catch(err => console.error('Error initializing extension UI:', err));
    setupMutationObserver();
    setupStorageChangeMonitor();
    setupKeyboardShortcuts();
  };

  return { bootstrap };
})();

/* Initialize the extension */
setTimeout(() => { PromptMediator.bootstrap(PromptUIManager, PromptProcessor); }, 50);

})(); // End of IIFE wrapper
