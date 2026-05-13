## 提示词大师（Prompt Master）— 架构与开发者指南 (v2.7.1)

本文档解释了 `src` 目录中 Chrome 扩展的结构、端到端工作原理以及主要逻辑所在位置。涵盖后台/Service Worker 编排、内容脚本和 UI 层、存储/版本管理、权限引导、侧边栏应用以及提供商集成，并补充“提示词生成器”的实现与数据流。

- 目标：Chrome MV3
- 核心功能：浮动提示词大师 UI（按钮或热角）、带标签/文件夹的提示词存储、变量替换、键盘快捷键、侧边栏提示词编辑器、右键上下文菜单、按站点权限、提示词生成器（OpenAI 兼容接口，支持 stream）。

### 目录概览
- `src/manifest.json`: 扩展清单文件 (MV3)。
- `src/service-worker.js`: 后台逻辑；脚本注入；权限和上下文菜单。
- `src/content.styles.js`: 全局主题变量和注入的 CSS；暴露 `injectGlobalStyles` 和常量。
- `src/content.js`: 内容脚本应用：UI 系统、路由、键盘、中介器、动态存储导入、变量工作流。
- `src/inputBoxHandler.js`: 检测并写入站点特定的输入框；处理 contentEditable 和 `textarea` 编辑器。
- `src/promptStorage.js`: 统一的版本化存储 API (v2: 提示词 + 文件夹 + 标签)。由内容脚本动态导入。
- `src/llm_providers.json` + `src/llm_providers.js`: 提供商注册表和加载器；用于源权限和注入。
- `src/sidepanel/*`: 侧边栏 UI（表单/列表、导入/导出、权限门控、响应式样式）。
- `src/permissions/*`: 权限管理器 UI；请求可选源；写入 `aiProvidersMap`。
- `src/info.html` 和 `src/changelog.html`: 由内容脚本获取的面板内内容。
- `src/importExport.js` + `src/utils.js`: 导入/导出桥接；UUID 辅助函数。
- `src/icons/*`: 在 UI 中引用的视觉资源。

## Manifest 和生命周期

### Manifest 要点（当前仓库以 `src/manifest.json` 为准）
扩展使用 MV3、侧边栏和 ES 模块 Service Worker。可选主机权限控制对支持站点的注入。

```json
{
    "manifest_version": 3,
    "name": "提示词大师",
    "version": "2.7.1",
    "permissions": ["sidePanel","storage","tabs","scripting","activeTab","contextMenus"],
    "side_panel": { "default_path": "sidepanel/index.html" },
    "background": { "service_worker": "service-worker.js", "type": "module" },
    // Icons and action omitted
}
```

- **optional_host_permissions**: 当前配置为 `<all_urls>`（仍需用户在权限页面显式授予具体站点权限后才会注入）。
- **web_accessible_resources**: 使特定文件可被内容脚本导入/获取（例如，`promptStorage.js`、`info.html`）。

### 后台 Service Worker
Service Worker 协调权限、内容脚本注入和上下文菜单。

```121:160:/src/service-worker.js
async function checkProviderPermissions() {
  // 加载 llm_providers.json 并检查每个模式的 chrome.permissions.contains
  // 存储：{ aiProvidersMap: { [providerName]: { hasPermission: 'Yes'|'No', urlPattern, url, iconUrl } } }
}
```

```55:94:/src/service-worker.js
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const { patternsArray } = await getProviders();
    for (const originPattern of patternsArray) {
      const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
      // 将 * 通配符转换为简单的正则表达式以匹配 URL
      const urlRegex = new RegExp('^' + originPattern.replace(/\\/g,'\\\\').replace(/[.]/g,'\\.').replace(/[*]/g,'.*'));
      if (hasPermission && urlRegex.test(tab.url)) {
        await chrome.scripting.executeScript({ target: { tabId }, files: [
          'inputBoxHandler.js','content.styles.js','content.js'
        ]});
        break; // 第一次匹配后停止
      }
    }
  }
});
```

- 安装时，打开权限页面并从 `llm_providers.json` 预计算 `aiProvidersMap`。
- 添加权限时，将所有必需的脚本注入到匹配新授予源的任何标签页中。
- 标签页完成时，如果标签页的 URL 匹配任何已授予的提供商模式，则注入脚本。
- 它还创建并维护一个动态上下文菜单，用于复制任何已保存的提示词：

```168:235:/src/service-worker.js
async function createPromptContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-prompt-manager', title: 'Prompt Master', contexts: ['all'] });
    getAllPrompts().then(prompts => prompts.forEach((prompt, idx) => {
      chrome.contextMenus.create({ id: 'prompt-' + idx, parentId: 'open-prompt-manager', title: prompt.title || `Prompt ${idx+1}`, contexts: ['all'] });
    }));
  });
}
```

## 提供商注册表和权限

- `llm_providers.json` 列出支持的提供商，包含 `name`、`pattern`（源通配符）、`url` 和 `icon_url`。
- `llm_providers.js:getProviders()` 在运行时获取 JSON，并返回名称→模式映射和用于匹配的扁平模式列表。

```1:20:/src/llm_providers.js
export async function getProviders() {
  const data = await (await fetch(chrome.runtime.getURL('llm_providers.json'))).json();
  const patternsObject = data.llm_providers.reduce((acc, item) => (acc[item.name] = item.pattern, acc), {});
  const patternsArray = data.llm_providers.map(item => item.pattern);
  return { patternsObject, patternsArray };
}
```

提示：要添加新提供商，请在 `llm_providers.json` 中添加条目，将其源添加到 `optional_host_permissions`，并在需要时更新 `inputBoxHandler.js` 选择器。

## 内容脚本应用

内容应用分为小型样式/引导模块和大型 UI/运行时模块。

### 全局样式和常量 (`content.styles.js`)
- 定义主题变量、选择器、UI 尺寸，并提供 `injectGlobalStyles()`。
- 在 `window` 上暴露常量，供其他注入文件重用而无需重新导入。

```56:64:/src/content.styles.js
var injectGlobalStyles = window.injectGlobalStyles || function injectGlobalStyles() {
  const styleEl = document.createElement('style');
  styleEl.textContent = `/* CSS omitted */`;
  document.head.appendChild(styleEl);
};
```

### 主 UI、路由、存储、键盘 (`content.js`)
关键子系统：
- 工具函数：`createEl`、`debounce`；主题辅助函数 `getMode`、`Theme.applyAll`。
- 路由：`PanelView` + `PanelRouter.mount(view)` 用于 LIST/CREATE/EDIT/SETTINGS/HELP/CHAT/VARIABLE_INPUT。
- 外部点击处理程序和 `KeyboardManager` 用于打开/关闭和导航。
- 存储外观：`PromptStorageManager`（通过 `chrome.runtime.getURL` 动态导入 `promptStorage.js`）。
- 标签：`TagService`（计数/顺序/建议）和 `TagUI`（标签 + 建议输入）。
- UI 系统：`PromptUI`（状态、元素、视图、行为、事件）和 `PromptUIManager`（公共 UI API）。
- 变量流：`PromptProcessor` + `PromptMediator` 将 UI 与站点输入框粘合。

引导过程会延迟一小段时间以确保 DOM 就绪：

```2115:2116:/src/content.js
setTimeout(() => { new PromptMediator(PromptUIManager, PromptProcessor); }, 50);
```

在内容脚本中动态导入统一存储保持单一数据源并避免代码重复：

```430:438:/src/content.js
const mod = await import(chrome.runtime.getURL('promptStorage.js'));
this.__ps = { getPrompts: mod.getPrompts, setPrompts: mod.setPrompts, /* others omitted */ };
```

变量提取和替换使用 `#variable_name#` 标记：

```2022:2030:/src/content.js
class PromptProcessor {
  static extractVariables(content) { return [...new Set([...content.matchAll(/#([a-zA-Z0-9_]+)#/g)].map(m => m[1]))]; }
  static replaceVariables(content, values) { return Object.entries(values)
    .reduce((res, [k, v]) => res.replace(new RegExp(`#${k}#`, 'g'), v), content); }
}
```

UI 注入支持两种模式：
- 标准：可拖动的圆形按钮打开面板。
- 热角：悬停在右下角打开。两者使用相同的面板和视图。

键盘快捷键（默认）：macOS `⌘ + ⇧ + P`，Windows/Linux `Ctrl + M`。按 `Esc` 关闭；方向键导航项目。

### 提示词生成器（CHAT View）

提示词生成器位于内容脚本内的 `PanelView.CHAT`，核心特点：

- **OpenAI 兼容接口**：通过本机配置的 `chatApiKey` / `chatBaseUrl` / `chatModelName` 调用 `POST {baseUrl}/chat/completions`。
- **stream 流式输出**：请求使用 `stream: true`，并解析 SSE 数据行（`data: {...}` / `data: [DONE]`），边接收边更新气泡内容。
- **模型回复一键保存为提示词**：每条非流式完成的 assistant 回复会带“保存为提示词”按钮，点击后跳转到 CREATE 表单并预填内容。
- **对话上下文本地持久化**：对话历史存储在 `chrome.storage.local` 的键 `pm_chat_history_v1` 下，直到用户点击“重置”才清空。用于在面板重建/页面刷新后恢复上下文。
- **取消闲置自动收回**：通过全局开关 `window.PROMPT_DISABLE_AUTO_CLOSE = true` 禁用面板的自动关闭计时器，避免对话中途被收起。

## 站点输入检测和插入 (`inputBoxHandler.js`)

`InputBoxHandler` 统一了跨多个站点的检测和写入。它支持 contentEditable 编辑器（包括 Lexical/Perplexity）和普通 `textarea`。它遵循“将提示词追加到文本”设置（`disableOverwrite`，默认开启追加模式）。

说明：当前实现会在用户未配置该项时默认返回 `true`，即默认追加而非覆盖。

对于 Lexical 编辑器，它使用 `execCommand('insertText')` 并带有回退，并将光标保持在末尾。对于 `textarea`，它写入 `value` 并重新派发 `input`/`change` 事件以确保应用检测到更改。

```445:456:/src/inputBoxHandler.js
} else if (inputBox.tagName.toLowerCase() === 'textarea') {
  if (disableOverwrite) { inputBox.value = (inputBox.value || '') + (/(\s)$/.test(inputBox.value)?'':' ') + content + '  '; }
  else { inputBox.value = content + '  '; }
  inputBox.dispatchEvent(new Event('input', { bubbles: true }));
  inputBox.dispatchEvent(new Event('change', { bubbles: true }));
}
```

## 统一存储（版本化）— `promptStorage.js`

存储是集中化的、版本化的（v2），并为向后兼容而镜像。架构：
- 存储对象：`{ version, prompts: Prompt[], folders: Folder[] }`
- 提示词：`{ uuid, title, content, tags: string[], folderId: string|null, createdAt, updatedAt? }`
- 文件夹：`{ id, name, parentId: string|null, createdAt, updatedAt? }`

```15:23:/src/promptStorage.js
export const PROMPT_STORAGE_VERSION = 2;
const STORAGE_KEY = 'prompts_storage';
const LEGACY_KEY  = 'prompts'; // 为旧代码路径镜像
```

关键 API（基于 Promise）：
- `getPrompts()`、`setPrompts(prompts)`
- `savePrompt({ title, content, tags, folderId })`、`updatePrompt(uuid, partial)`、`deletePrompt(uuid)`
- `mergePrompts(importedArray)`（通过 `uuid` + 时间戳新鲜度）
- 文件夹：`getFolders()`、`saveFolder()`、`updateFolder()`、`deleteFolder()`、`movePromptToFolder()`
- 标签：`addTagToPrompt()`、`removeTagFromPrompt()`、`setTagsForPrompt()`
- 导入/导出辅助函数和 `onPromptsChanged(callback)`

```168:186:/src/promptStorage.js
export async function mergePrompts(imported) {
  // 通过 uuid 合并，保留较新的 updatedAt/createdAt
}
```

注意事项：
- 内容脚本使用 `chrome.runtime.getURL` 动态导入此模块，因此必须列在 `web_accessible_resources` 中。
- 旧版仅数组存储会自动向前迁移。

## 侧边栏应用 (`sidepanel/*`)

侧边栏是一个用于管理提示词的小型应用。它列出提示词，支持添加/更新/删除，并提供导入/导出。当没有授予提供商时，它还会显示“权限管理器”快捷方式。

```26:46:/src/sidepanel/sidepanel.js
async function renderPermissionsGate() {
  const allowed = await hasAnyGrantedProviderPermission();
  // 如果尚未授予任何提供商，显示权限管理器的快捷方式
}
```

- 实时更新：监听提示词存储更改和 `aiProvidersMap` 更改以自动刷新 UI。
- 信息横幅可以通过存储标志切换并且可以关闭。
- 页脚链接到 Gitee、Chrome 网上应用店和专用权限页面。

## 权限管理器 (`permissions/*`)

允许使用 MV3 可选主机权限进行按提供商的源权限管理。

```116:135:/src/permissions/permissions.js
const element = document.getElementById(`perm-${key}`);
const handleProviderClick = function (event) {
  event.preventDefault();
  const originPattern = this.dataset.urlPattern;
  chrome.permissions.request({ origins: [originPattern] }, (granted) => {
    if (granted) {
      providersMap[providerKey].hasPermission = "Yes";
      chrome.storage.local.set({ aiProvidersMap: providersMap }); // 触发 UI 刷新
    }
  });
};
```

- 页面读取 `aiProvidersMap`（由 Service Worker 在安装时写入）并构建两个列表：已允许 vs 可用。
- 在首次授予提供商时，它渲染一个“开始使用”按钮，链接到提供商 URL。

## 主题和 UI 系统

- `content.styles.js` 在单个根（`#opm-root`）下将所有 CSS 注入到页面，具有浅色/深色变体。
- 当前默认策略为：**滚动条永久隐藏**（仅保留滚动能力），以保持 UI 视觉更简洁。
- 内容 UI 和侧边栏共享一致的颜色系统。
- **CSS 变量系统**：所有主题颜色通过 CSS 自定义属性（变量）集中管理，定义在 `:root` 作用域以确保全局可访问（包括弹窗等不在 `#opm-root` 内的元素）。
- **暗色主题配色**：主色为黑色 (`#0F0F0F`)，辅色为灰色系 (`#1A1A1A`, `#2A2A2A`, `#252525`)，强调色为蓝色 (`#3674B5`)。
- **图标颜色保护**：第三方图标（如 Gitee）保留原始颜色，不应用主题滤镜；仅内部 SVG 图标根据主题自动调整。
- **动态主题切换**：通过为元素添加/移除 `opm-light` / `opm-dark` 类实现无刷新主题切换，所有颜色通过 CSS 变量自动更新。
- 图标通过主题感知的 CSS 过滤器着色。

## 键盘、热角和引导

- 全局快捷键切换列表：macOS `⌘ + ⇧ + P`，Windows/Linux `Ctrl + M`。按 Escape 关闭；方向键导航。
- 两种显示模式：
  - `standard`：可拖动按钮 + 锚定面板。
  - `hotCorner`：悬停右下角以显示面板；指示器动画。
- 引导弹窗（“悬停开始”）在首次使用前显示，然后自动关闭/持久化。

## 上下文菜单和剪贴板

- Service Worker 创建一个上下文菜单，每个提示词一个条目；点击将提示词复制到剪贴板，并可选择显示通知。
- 如果直接剪贴板 API 失败，剪贴板回退使用 `scripting.executeScript` 注入。

## 数据和版本管理

- 数据位于 `chrome.storage.local` 下的规范存储对象和旧版镜像中。
- 当架构版本更改时，就地执行升级。
- 导入/导出保留 `uuid` 并通过新鲜度合并以防止重复。

## 扩展扩展功能

- 添加提供商：更新 `llm_providers.json`、清单 `optional_host_permissions`，并在需要时更新 `inputBoxHandler.js` 选择器。
- 添加新站点编辑器：在 `InputBoxHandler.getInputBox()` 中实现检测，如果是特殊编辑器，则调整插入逻辑。
- 扩展存储：增加 `PROMPT_STORAGE_VERSION`，更新规范化器，执行安全迁移。
- 添加 UI 功能：使用 `PromptUIManager` 注入/刷新，而不假设特定的站点结构。

## 值得注意的细节和小注意事项

- 后台注入路径检查 URL 模式和权限，但在所有边缘情况下并不严格防止双重注入。代码首先尝试通过 `executeScript(func: ...)` 进行小的“探测”；如果需要，考虑更强的幂等性保护。
- **外部点击处理 (Outside Click Handling)**: 为解决主要 UI 面板在各类 Portal 元素（如标签建议列表）交互时意外关闭的问题，`OutsideClickCloser` 现在监听 `mousedown` 事件而非 `click`。这提供了更稳健的“意图检测”，防止了事件冒泡带来的误判。
- **UI 样式微调**: 针对标签建议列表在浅色模式下的文本可见性问题进行了修复，强制指定了高对比度文本颜色。
- **CSS 变量全局化**: 主题颜色变量从 `#opm-root` 作用域迁移至 `:root`，确保模型配置弹窗等不在主容器内的元素能正确继承主题颜色，避免透明背景问题。
- **社区链接颜色修复**: "支持我们的工作"区域的颜色现在通过 `opm-light` / `opm-dark` 类自动切换，确保在主题热切换时颜色同步更新。
- **侧边栏图标保护**: 侧边栏页脚图标（Gitee 等）添加 `footer-icon-original` 类，避免在暗色模式下被 `invert(100%)` 滤镜覆盖原始颜色。
- `settings.js` 仍存在历史遗留逻辑（与当前主 UI/侧边栏的导入导出路径不一致）。建议以 `content.shared.js` 的 Settings 视图与侧边栏为准，逐步清理未使用入口。
- `llm_providers.json` 包含两个名为“Google AI Studio”的条目；无害，但如果您计划在其他地方渲染唯一名称列表，可以通过名称去重。

## 按文件快速映射

- `manifest.json`: MV3 配置、侧边栏、可选源、WARs。
- `service-worker.js`: 安装/引导、权限扫描和更新、脚本注入、上下文菜单。
- `content.styles.js`: 主题令牌、选择器、面板和列表 CSS、导出的 `injectGlobalStyles`。
- `content.js`: UI 框架、路由、键盘、标签系统、管理器、中介器、变量表单。
- `inputBoxHandler.js`: 强大的站点检测、contentEditable 和 `textarea` 的插入、追加 vs 覆盖。
- `promptStorage.js`: 版本化存储、规范化/迁移、CRUD、标签、文件夹、导入/导出、更改事件。
- `llm_providers.json` / `llm_providers.js`: 提供商注册表和运行时加载器。
- `sidepanel/index.html|sidepanel.js|styles.css`: 独立的提示词大师面板。
- `permissions/permissions.html|permissions.js|permissions_custom.css`: 权限管理 UI。
- `importExport.js`: 到 `promptStorage` 导入/导出的薄桥接。
- `utils.js`: `generateUUID` 辅助函数。
- `info.html`、`changelog.html`: 获取到内容面板视图（HELP/CHANGELOG）中。

---

### 关键流程（概览）
- 安装：打开权限页面 → 计算并存储 `aiProvidersMap` → 通过操作启用侧边栏。
- 添加权限：更新存储 → 将脚本注入到匹配的标签页中。
- 标签页完成：如果 URL 匹配已授予的提供商 → 注入 `inputBoxHandler.js`、`content.styles.js`、`content.js`。
- 内容引导：注入全局 CSS → 构建 UI → 附加键盘 + 观察器 → 动态导入存储 → 渲染列表或创建表单。
- 选择提示词：检测站点输入 → 如果存在变量，显示变量表单 → 替换占位符 → 插入到站点输入。
- 存储更改：仅在列表视图处于活动状态时刷新列表（避免干扰编辑/设置视图）。

如果您需要深入了解任何模块，请参阅上面的代码引用以了解相应文件的起始点。
