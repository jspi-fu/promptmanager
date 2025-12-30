import { importPrompts } from '../promptStorage.js';

// This script is injected into the page to manage permissions for AI providers
// It retrieves the providers map from storage and creates elements for each provider
document.addEventListener('DOMContentLoaded', function () {

  // Get the target containers
  const permissionGrantedContainer = document.getElementById('permission-granted');
  const requestPermissionContainer = document.getElementById('request-permission');
  // Get the Get Started button container
  const getStartedBtnContainer = document.getElementById('get-started-btn-container');
  // COMMENT: Controls to grant/remove all permissions at once
  const grantAllBtn = document.getElementById('grant-all-permissions');
  const removeAllBtn = document.getElementById('remove-all-permissions');

  if (!permissionGrantedContainer || !requestPermissionContainer) {
    console.error('Required container elements (#permission-granted or #request-permission) not found.');
    return; // Stop execution if containers are missing
  }

  function updateGetStartedButton(allowedProviders) {
    if (allowedProviders.length > 0 && getStartedBtnContainer) {
      /*
        Try to use the URL that we already have in memory (it was populated via
        service-worker.js -> checkProviderPermissions). This removes the need for
        an extra fetch request and avoids potential path issues when the
        permissions page lives in a sub-folder ("src/permissions") while the JSON
        file is located in "src/llm_providers.json".
      */
      let firstAllowedUrl = null;

      for (const allowed of allowedProviders) {
        if (allowed.providerInfo && allowed.providerInfo.url) {
          firstAllowedUrl = allowed.providerInfo.url;
          break;
        }
      }

      // Fallback – if, for some reason, the providerInfo does not contain a
      // URL, we fetch the JSON file (using the correct path) and try to look it
      // up. This keeps backwards-compatibility with existing logic.
      const ensureUrlPromise = firstAllowedUrl
        ? Promise.resolve(firstAllowedUrl)
        : fetch(chrome.runtime.getURL('/llm_providers.json'))
          .then(response => response.json())
          .then(data => {
            const llmList = data.llm_providers || [];
            for (const allowed of allowedProviders) {
              const match = llmList.find(llm => llm.name === allowed.key);
              if (match && match.url) {
                return match.url;
              }
            }
            return null;
          });

      ensureUrlPromise.then(resolvedUrl => {
        if (resolvedUrl) {
          // Create (or replace) the Get Started buttons
          getStartedBtnContainer.innerHTML = `
            <div style="display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 16px; margin-top: 1.5rem;">
              <button id="get-started-best-practices-btn" class="custom-button" style="height: 46px; padding: 0 1.5rem; border-radius: 8px; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: none; cursor: pointer; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: transform 0.1s;">
                <img src="../icons/icon-button.png" alt="Icon" width="20" height="20" style="object-fit: cover; filter: brightness(0) invert(1);"> 
                <span style="font-weight: 500;">从最佳实践开始 (推荐)</span>
              </button>
              <button id="get-started-scratch-btn" style="height: 46px; padding: 0 1.5rem; border-radius: 8px; font-size: 1rem; border: 1px solid #e2e8f0; background: #fff; color: #64748b; font-weight: 500; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center;">
                从0开始
              </button>
            </div>`;

          // Button 1: Start with Best Practices (Import -> Open)
          document.getElementById('get-started-best-practices-btn').addEventListener('click', async () => {
            try {
              const importUrl = 'https://gitee.com/ye_sheng0839/prompt-master/raw/main/%E9%A2%84%E8%AE%BE%E6%8F%90%E7%A4%BA%E8%AF%8D.json';
              const response = await fetch(importUrl);
              if (response.ok) {
                const text = await response.text();
                await importPrompts(text);
                console.log('Successfully imported default prompts.');
              } else {
                console.warn('Failed to fetch default prompts:', response.status);
              }
            } catch (e) {
              console.error('Error importing default prompts:', e);
            }
            window.open(resolvedUrl, '_blank');
          });

          // Button 2: Start from Scratch (Just Open)
          document.getElementById('get-started-scratch-btn').addEventListener('click', () => {
            window.open(resolvedUrl, '_blank');
          });
        }
      });

    } else if (getStartedBtnContainer) {
      // When no providers are allowed yet, show guidance title instead of the button
      // This matches the requested behavior: display a title until at least one LLM is selected
      getStartedBtnContainer.innerHTML = '<h3 class="custom-onboarding-title">首先，选择你想要使用的AI助手。</h3>';
    }
  }

  // Function to populate providers UI
  async function populateProviders(providersMap) {
    console.log('Populating UI with providers map:', providersMap);

    // Clear existing content
    permissionGrantedContainer.innerHTML = '';
    requestPermissionContainer.innerHTML = '';

    const allowedProviders = [];

    // Fetch llm_providers.json to maintain the original order
    let providersOrder = [];
    try {
      const response = await fetch(chrome.runtime.getURL('llm_providers.json'));
      if (response.ok) {
        const data = await response.json();
        providersOrder = (data.llm_providers || []).map(p => p.name);
      }
    } catch (error) {
      console.error('Failed to load llm_providers.json for ordering:', error);
    }

    // Use ordered list if available, otherwise fall back to Object.entries
    const providersToDisplay = providersOrder.length > 0
      ? providersOrder.map(name => [name, providersMap[name]]).filter(([_, info]) => info)
      : Object.entries(providersMap);

    for (const [key, providerInfo] of providersToDisplay) {
      const iconUrl = providerInfo.iconUrl;
      const isAllowed = providerInfo.hasPermission === "Yes";

      // For allowed providers, clicking should open their website in a new tab.
      // For not-yet-allowed providers, the link remains "#" and we attach the
      // permission-request listener below.
      const elementHTML = isAllowed
        ? `<a id="perm-${key}" class="custom-button"
               aria-current="true" href="${providerInfo.url}" target="_blank" rel="noopener">
              <img src="${iconUrl}" alt="${key} icon" width="32" height="32" class="custom-rounded-circle">
              <span class="custom-mb-0">${key}</span>
            </a>`
        : `<a id="perm-${key}" class="custom-button"
               aria-current="true" href="#" data-provider="${key}" data-url-pattern="${providerInfo.urlPattern}">
              <img src="${iconUrl}" alt="${key} icon" width="32" height="32" class="custom-rounded-circle">
              <span class="custom-mb-0">${key}</span>
            </a>`;

      let targetContainer;
      let needsClickListener = false;

      if (providerInfo.hasPermission == "Yes") {
        targetContainer = permissionGrantedContainer;
        allowedProviders.push({ key, providerInfo }); // Collect allowed providers
      } else {
        targetContainer = requestPermissionContainer;
        needsClickListener = true;
      }

      targetContainer.insertAdjacentHTML('beforeend', elementHTML);

      if (needsClickListener) {
        const element = document.getElementById(`perm-${key}`);
        if (element) {
          const handleProviderClick = function (event) {
            event.preventDefault();

            const providerKey = this.dataset.provider;
            const originPattern = this.dataset.urlPattern;

            chrome.permissions.request({ origins: [originPattern] }, (granted) => {
              if (granted) {
                // Update local providersMap and persist
                providersMap[providerKey].hasPermission = "Yes";
                // Persist change; UI will refresh via storage.onChanged listener
                chrome.storage.local.set({ aiProvidersMap: providersMap });
              } else {
                alert(`Permission denied for ${providerKey}`);
              }
            });
          };
          element.addEventListener('click', handleProviderClick);
        }
      }
    }

    // COMMENT: Hide the "Allowed" section container when there are no allowed providers yet.
    // This keeps the UI clean until the user approves at least one LLM origin.
    const allowedSectionContainer = permissionGrantedContainer.closest('.custom-container-mt5');
    if (allowedSectionContainer) {
      allowedSectionContainer.style.display = allowedProviders.length > 0 ? '' : 'none';
    }

    updateGetStartedButton(allowedProviders);
  }

  // Listen for changes to aiProvidersMap in storage and update UI
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.aiProvidersMap && changes.aiProvidersMap.newValue) {
      populateProviders(changes.aiProvidersMap.newValue);
    }
  });

  // Get the providers map from storage when the page loads
  chrome.storage.local.get(['aiProvidersMap'], function (result) {
    if (result.aiProvidersMap) {
      const providersMap = result.aiProvidersMap;
      console.log('Retrieved providersMap from storage:', providersMap);

      // Use the helper to populate UI and attach listeners
      populateProviders(providersMap);

    } else {
      console.log('No providersMap found in storage.');
      // Handle the case where the map doesn't exist yet
      requestPermissionContainer.innerHTML = '<p>No provider data found in storage.</p>'; // Example message
    }
  });

  // COMMENT: Grant all permissions handler — requests all optional origins and updates providers map
  if (grantAllBtn) {
    grantAllBtn.addEventListener('click', async () => {
      try {
        // Fetch providers data to get all patterns
        const response = await fetch(chrome.runtime.getURL('/llm_providers.json'));
        const data = await response.json();
        const llmList = data.llm_providers || [];

        // Collect all origin patterns
        const allPatterns = llmList
          .map(provider => provider.pattern)
          .filter(Boolean);

        if (allPatterns.length === 0) {
          alert('未找到可用的提供者权限模式');
          return;
        }

        // Request all permissions at once
        chrome.permissions.request({ origins: allPatterns }, async (granted) => {
          if (granted) {
            // Get current providers map
            chrome.storage.local.get(['aiProvidersMap'], (res) => {
              const currentMap = res && res.aiProvidersMap ? res.aiProvidersMap : {};
              const updated = {};

              // Update all providers to "Yes" in the map
              for (const provider of llmList) {
                const key = provider.name;
                if (currentMap[key]) {
                  updated[key] = {
                    ...currentMap[key],
                    hasPermission: 'Yes'
                  };
                } else {
                  // If provider not in map yet, create entry
                  updated[key] = {
                    hasPermission: 'Yes',
                    urlPattern: provider.pattern,
                    url: provider.url,
                    iconUrl: provider.icon_url || ''
                  };
                }
              }

              // Also preserve any existing providers not in llmList
              for (const [key, val] of Object.entries(currentMap)) {
                if (!updated[key]) {
                  updated[key] = val;
                }
              }

              chrome.storage.local.set({ aiProvidersMap: updated });
            });
          } else {
            alert('部分或全部权限请求被拒绝');
          }
        });
      } catch (error) {
        console.error('Failed to grant all permissions:', error);
        alert('请求权限时发生错误：' + error.message);
      }
    });
  }

  // COMMENT: Remove all permissions handler — revokes all optional origins and resets providers map
  if (removeAllBtn) {
    removeAllBtn.addEventListener('click', () => {
      chrome.storage.local.get(['aiProvidersMap'], (res) => {
        const currentMap = res && res.aiProvidersMap ? res.aiProvidersMap : {};
        // Collect all origin patterns (unique)
        const allPatterns = Array.from(new Set(
          Object.values(currentMap)
            .map(v => v && v.urlPattern)
            .filter(Boolean)
        ));
        // Attempt to remove all optional host permissions in one call
        try {
          chrome.permissions.remove({ origins: allPatterns }, (removed) => {
            // Regardless of removed flag, update local storage map to reflect "No"
            const updated = {};
            for (const [key, val] of Object.entries(currentMap)) {
              updated[key] = {
                ...val,
                hasPermission: 'No'
              };
            }
            chrome.storage.local.set({ aiProvidersMap: updated });
          });
        } catch (e) {
          // On error, still set map to "No" to reset UI; users can re-grant
          const updated = {};
          for (const [key, val] of Object.entries(currentMap)) {
            updated[key] = {
              ...val,
              hasPermission: 'No'
            };
          }
          chrome.storage.local.set({ aiProvidersMap: updated });
        }
      });
    });
  }

  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDarkMode) {
    const headerIcon = document.getElementById('header-icon');
    if (headerIcon) {
      headerIcon.classList.add('dark-mode-icon');
    }
  }
});