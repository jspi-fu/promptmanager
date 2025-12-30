import { getProviders } from './llm_providers.js'; // Import the correct function
import { getPrompts, onPromptsChanged, savePrompt } from './promptStorage.js'; // COMMENT: Unified prompt storage API

// COMMENT: Providers cache to reduce per-tab overhead.
// - Avoid fetching/parsing llm_providers.json on every tab update
// - Precompile wildcard patterns into RegExp once per service worker lifetime
const ProvidersCache = (() => {
  /** @type {{ compiled: Array<{ originPattern: string, urlRegex: RegExp }> } | null} */
  let cache = null;
  /** @type {Promise<{ compiled: Array<{ originPattern: string, urlRegex: RegExp }> }> | null} */
  let loading = null;

  const wildcardToRegex = (originPattern) => {
    // Convert "*://example.com/*" to a safe RegExp
    const escaped = originPattern
      .replace(/[|\\{}()[\]^$+?.]/g, '\\$&') // escape regex metacharacters except '*'
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}`);
  };

  const loadCompiled = async () => {
    const { patternsArray } = await getProviders();
    const compiled = patternsArray.map(originPattern => ({
      originPattern,
      urlRegex: wildcardToRegex(originPattern)
    }));
    return { compiled };
  };

  const getCompiled = async () => {
    if (cache) return cache;
    if (loading) return loading;
    loading = (async () => {
      const next = await loadCompiled();
      cache = next;
      loading = null;
      return next;
    })();
    return loading;
  };

  const getAuthorizedCompiled = async () => {
    const { compiled } = await getCompiled();
    const { aiProvidersMap } = await chrome.storage.local.get('aiProvidersMap');
    if (!aiProvidersMap || typeof aiProvidersMap !== 'object') return compiled;

    const allowed = new Set();
    for (const info of Object.values(aiProvidersMap)) {
      if (info && info.hasPermission === 'Yes' && info.urlPattern) allowed.add(info.urlPattern);
    }
    if (allowed.size === 0) return compiled;
    return compiled.filter(item => allowed.has(item.originPattern));
  };

  const clear = () => { cache = null; loading = null; };

  return { getAuthorizedCompiled, clear };
})();

// COMMENT: Unified script injection function to prevent duplicate injection
// Checks for injection marker before injecting scripts
async function injectScriptsIfNeeded(tabId, tabUrl) {
  // Skip injection for restricted URLs
  if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:')) {
    return false;
  }

  try {
    // Check if scripts are already injected by checking for the markers
    const [{ result: isInjected }] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Check both markers to ensure all scripts are injected
        return (window.__promptManagerInjected === true ||
          window.__promptManagerContentInjected === true ||
          window.__promptManagerInputHandlerInjected === true);
      }
    });

    if (isInjected) {
      console.log(`Scripts already injected in tab ${tabId} (${tabUrl}), skipping...`);
      return false;
    }

    // Inject scripts if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        "inputBoxHandler.js",
        "content.styles.js",
        "content.shared.js",
        "content.js"
      ]
    });
    console.log(`Successfully injected scripts into tab ${tabId} (${tabUrl})`);
    return true;
  } catch (injectionError) {
    // Handle specific error cases
    if (injectionError.message.includes('Cannot access') ||
      injectionError.message.includes('No matching window') ||
      injectionError.message.includes('tab was closed')) {
      // Ignore errors for restricted pages or closed tabs
      return false;
    }
    // Log other injection errors
    console.error(`Failed to inject script into tab ${tabId} (${tabUrl}):`, injectionError);
    return false;
  }
}

chrome.runtime.onInstalled.addListener(function (details) {
  // COMMENT: Chrome/Edge sidePanel capability check (some environments may not support it)
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  console.log('onInstalled', details);
  // COMMENT: Rebuild providers map on install and update (but only open UI on first install)
  const shouldRebuild = ['install', 'update'].includes(details.reason);
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'permissions/permissions.html' });
  }
  if (shouldRebuild) {
    (async () => {
      try {
        const providersMap = await checkProviderPermissions();
        console.log('Providers Map:', providersMap);
        // Store the provider map in local storage
        await chrome.storage.local.set({ 'aiProvidersMap': providersMap });
        ProvidersCache.clear();
      } catch (error) {
        console.error('Error:', error);
      }
    })();
  }
});


chrome.permissions.onAdded.addListener(async (permissions) => {
  console.log('Permissions added:', permissions.origins);
  if (permissions.origins && permissions.origins.length > 0) {
    // Iterate through the newly granted origins
    for (const origin of permissions.origins) {
      try {
        // Find tabs that match the newly granted origin
        const tabs = await chrome.tabs.query({ url: origin });
        console.log(`Found ${tabs.length} tabs matching ${origin}`);

        for (const tab of tabs) {
          // Use unified injection function to prevent duplicate injection
          await injectScriptsIfNeeded(tab.id, tab.url);
        }
      } catch (err) {
        console.error(`Failed to query tabs or inject script for origin ${origin}:`, err);
      }
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Inject scripts when a tab finishes loading and has a URL
  if (changeInfo.status === 'complete' && tab.url) {
    // Fast path: only attempt on http(s)
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return;
    try {
      const compiled = await ProvidersCache.getAuthorizedCompiled();
      for (const { originPattern, urlRegex } of compiled) {
        if (!urlRegex.test(tab.url)) continue;
        const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
        if (!hasPermission) continue;

        console.log(`Attempting to inject scripts into updated tab ${tabId} (${tab.url}) matching ${originPattern}`);
        await injectScriptsIfNeeded(tabId, tab.url);
        break;
      }
    } catch (err) {
      // Avoid logging errors for URLs like 'chrome://extensions/'
      if (tab.url && !tab.url.startsWith('chrome://')) {
        // Log errors from getProviders or permission checks
        console.error(`Error during tab update processing for ${tab.url}:`, err);
      }
    }
  }
});

async function checkProviderPermissions() {
  try {
    // Fetch the providers list (use absolute extension URL for reliability)
    const response = await fetch(chrome.runtime.getURL('llm_providers.json'));
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const providersData = await response.json();

    // COMMENT: Normalize icon URLs. For local paths (e.g. "../icons/foo.png" or "icons/foo.png"),
    // convert to an absolute chrome-extension:// URL so all UIs resolve consistently.
    const resolveIconUrl = (raw) => {
      if (!raw) return '';
      // Keep absolute/network/data/chrome-extension URLs as-is
      if (/^(https?:|data:|chrome-extension:)/.test(raw)) return raw;
      // Strip leading ./ or ../ segments to anchor at the extension root
      const normalized = raw.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
      return chrome.runtime.getURL(normalized);
    };

    // Object to store provider permission status and URL
    const providersMap = {};

    // Loop through each provider object in the patterns array
    for (const providerInfo of providersData.llm_providers) {
      // Get provider name, URL pattern, and provider URL
      const providerName = providerInfo.name;
      const urlPattern = providerInfo.pattern;
      const providerUrl = providerInfo.url;

      // Check if permission exists for this provider's URL pattern
      const hasPermission = await chrome.permissions.contains({
        origins: [urlPattern]
      });

      // Store the result (permission status and URL) in providersMap
      providersMap[providerName] = {
        hasPermission: hasPermission ? 'Yes' : 'No',
        urlPattern: urlPattern,
        url: providerUrl,
        iconUrl: resolveIconUrl(providerInfo.icon_url)
      };
    }

    return providersMap;
  } catch (error) {
    console.error('Error checking permissions:', error);
    return null; // Return null or an empty object {} to indicate failure
  }
}

// --- CONTEXT MENU FOR PROMPT MANAGER ---

// Helper: Get all prompts via the unified manager (single source of truth)
async function getAllPrompts() {
  return await getPrompts();
}

// Create the context menu
async function createPromptContextMenu() {
  // Remove any existing menu to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Create the parent menu
    chrome.contextMenus.create({
      id: 'open-prompt-manager',
      title: '打开提示词大师',
      contexts: ['all']
    });
    // First child: "Save as prompt" – only shown when there is a text selection
    // COMMENT: This enables the flow "select text → right-click → Prompt Master → Save as prompt"
    chrome.contextMenus.create({
      id: 'save-as-prompt',
      parentId: 'open-prompt-manager',
      title: '保存为新提示词',
      contexts: ['selection']
    });
    // COMMENT: Visual separator between "Save as prompt" and the list of existing prompts.
    // Only show when there is a selection, mirroring the visibility of the save item.
    chrome.contextMenus.create({
      id: 'save-separator',
      parentId: 'open-prompt-manager',
      type: 'separator',
      contexts: ['selection']
    });
    // Add a menu item for each prompt
    getAllPrompts().then(prompts => {
      prompts.forEach((prompt, idx) => {
        chrome.contextMenus.create({
          id: 'prompt-' + idx,
          parentId: 'open-prompt-manager',
          title: prompt.title || `提示词 ${idx + 1}`,
          contexts: ['all']
        });
      });
    });
  });
}

// On install or update, create the context menu
chrome.runtime.onInstalled.addListener(() => {
  createPromptContextMenu();
});

// On startup, also create the context menu (for reloads)
chrome.runtime.onStartup.addListener(() => {
  createPromptContextMenu();
  // COMMENT: Refresh providers map on startup so icon changes and new providers propagate without reinstall
  (async () => {
    try {
      const providersMap = await checkProviderPermissions();
      await chrome.storage.local.set({ 'aiProvidersMap': providersMap });
    } catch (e) {
      console.error('Failed to refresh aiProvidersMap on startup:', e);
    }
  })();
});

// Listen for prompts changes via the unified API and update the context menu
onPromptsChanged(() => {
  // COMMENT: Regenerate the context menu whenever prompts change
  createPromptContextMenu();
});

// When a context menu item is clicked
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Handle "Save as prompt": opens a small popup dialog prefilled with the selected text
  if (info.menuItemId === 'save-as-prompt') {
    // COMMENT: Use Chrome's built-in dialogs in the page context:
    // - prompt() to capture the title
    // - alert() to show validation error if title is empty
    try {
      const selected = info.selectionText || '';
      // Ask for a title using the page's built-in blocking prompt
      const [{ result: titleValue }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return window.prompt('请输入提示词标题', '');
        }
      });
      const title = (titleValue || '').trim();
      if (!title) {
        // Show the requested error message if no title provided
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { window.alert('请为提示词添加标题。'); }
        });
        return;
      }
      // Persist the prompt using the unified storage API
      await savePrompt({ title, content: selected });
      // Optional: fire a lightweight notification if available
      chrome.notifications?.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '提示词已保存',
        message: `已保存：${title}`
      });
    } catch (err) {
      console.error('Failed to save prompt from selection:', err);
    }
    return;
  }
  if (info.menuItemId.startsWith('prompt-')) {
    // Extract the prompt index
    const idx = parseInt(info.menuItemId.replace('prompt-', ''), 10);
    const prompts = await getAllPrompts();
    if (prompts[idx]) {
      // Write the prompt content to the clipboard
      try {
        await navigator.clipboard.writeText(prompts[idx].content);
        // Optionally, show a notification
        chrome.notifications?.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '提示词已复制',
          message: `已复制：${prompts[idx].title}`
        });
      } catch (err) {
        // Fallback: try to copy using the tabs API if clipboard API fails
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (text) => navigator.clipboard.writeText(text),
          args: [prompts[idx].content]
        });
      }
    }
  }
});

// --- END CONTEXT MENU ---
