# 修改与扩展指南

本文档指导开发者如何修改和扩展提示词管理器的常见功能。每个部分都包含文件位置、修改方法和示例代码。

## 目录

1. [添加新的 AI 平台支持](#1-添加新的-ai-平台支持)
2. [添加新的设置项](#2-添加新的设置项)
3. [修改 UI 样式和主题](#3-修改-ui-样式和主题)
4. [修改键盘快捷键](#4-修改键盘快捷键)
5. [添加新的视图/功能页面](#5-添加新的视图功能页面)
6. [修改存储结构](#6-修改存储结构)
7. [修改输入框处理逻辑](#7-修改输入框处理逻辑)
8. [修改提示词生成器配置](#8-修改提示词生成器配置)
9. [添加新的 UI 组件](#9-添加新的-ui-组件)

---

## 1. 添加新的 AI 平台支持

### 文件位置
- **配置文件**：`src/llm_providers.json`
- **处理逻辑**：`src/inputBoxHandler.js`
- **权限管理**：`src/service-worker.js`（通常无需修改）

### 修改步骤

#### 步骤 1：在 `llm_providers.json` 中添加配置

在 `llm_providers` 数组中添加新条目：

```json
{
  "name": "平台名称",
  "pattern": "*://example.com/*",
  "url": "https://example.com",
  "icon_url": "https://example.com/favicon.ico",
  "element_selector": "#input-box-id"
}
```

**字段说明**：
- `name`：平台显示名称
- `pattern`：URL 匹配模式（支持 `*` 通配符）
- `url`：平台主页 URL
- `icon_url`：图标 URL（可使用网络 URL 或本地路径 `../icons/icon.png`）
- `element_selector`：CSS 选择器，用于定位输入框

**示例**：
```json
{
  "name": "AI Chat Pro",
  "pattern": "*://aichat.pro/*",
  "url": "https://aichat.pro",
  "icon_url": "https://aichat.pro/favicon.ico",
  "element_selector": "#message-input"
}
```

#### 步骤 2：验证输入框选择器

1. 访问目标平台网站
2. 打开浏览器开发者工具（F12）
3. 使用元素选择器定位输入框
4. 在控制台测试选择器：`document.querySelector('您的选择器')`

**选择器最佳实践**：
- 优先使用 ID 选择器：`#chat-input`
- 使用属性选择器：`textarea[placeholder="Message"]`
- 避免动态类名（可能变化）
- 确保选择器唯一匹配一个元素

#### 步骤 3：测试

1. 重新加载扩展（`chrome://extensions/` → 刷新）
2. 在权限管理器中授予新平台权限
3. 访问目标网站并测试插入功能

**详细指南**：参见 `EXTENDING_PLATFORMS.md`

---

## 2. 添加新的设置项

### 文件位置
- **设置 UI**：`src/content.shared.js`（`Views.createSettingsForm()` 方法）
- **设置存储**：`src/content.js`（`PromptStorageManager` 类）
- **设置页面 HTML**：`src/settings.html`（可选，主要用于信息展示）

### 修改步骤

#### 步骤 1：在 `PromptStorageManager` 中添加存储方法

在 `src/content.js` 的 `PromptStorageManager` 类中添加 getter 和 setter 方法：

```javascript
// 在 PromptStorageManager 类中添加（约 1445 行附近）
static async getMyNewSetting() {
  return await PromptStorageManager.getData('myNewSetting', false); // false 是默认值
}

static async saveMyNewSetting(value) {
  return await PromptStorageManager.setData('myNewSetting', !!value);
}
```

**位置**：`src/content.js` 第 1570-1575 行

#### 步骤 2：在设置表单中添加 UI 控件

在 `src/content.shared.js` 的 `createSettingsForm()` 方法中添加设置项：

```javascript
// 在 createSettingsForm() 方法中添加（约 711-740 行）
settings.appendChild(Elements.createToggleRow({
  labelText: '我的新设置',
  tooltipText: '这是设置的说明文字，鼠标悬浮在 ? 上可查看',
  getValue: async () => await window.PromptStorageManager.getMyNewSetting(),
  onToggle: async (active) => {
    await window.PromptStorageManager.saveMyNewSetting(active);
    // 如果需要立即生效，在这里添加逻辑
  }
}));
```

**可用的 UI 组件**：
- `Elements.createToggleRow()`：开关切换（布尔值）
- 如需其他类型（输入框、下拉框等），可参考现有实现或扩展 `Elements` 对象

**位置**：`src/content.shared.js` 第 711-790 行

#### 步骤 3：在需要的地方使用设置值

在代码中读取设置：

```javascript
const mySetting = await window.PromptStorageManager.getMyNewSetting();
if (mySetting) {
  // 执行相关逻辑
}
```

### 完整示例：添加"自动插入"设置

**1. 在 `PromptStorageManager` 中添加方法**（`src/content.js`）：

```javascript
static async getAutoInsert() {
  return await PromptStorageManager.getData('autoInsert', false);
}

static async saveAutoInsert(value) {
  return await PromptStorageManager.setData('autoInsert', !!value);
}
```

**2. 在设置表单中添加开关**（`src/content.shared.js`）：

```javascript
settings.appendChild(Elements.createToggleRow({
  labelText: '自动插入',
  tooltipText: '开启后，选择提示词时自动插入到输入框，无需确认',
  getValue: async () => await window.PromptStorageManager.getAutoInsert(),
  onToggle: async (active) => {
    await window.PromptStorageManager.saveAutoInsert(active);
  }
}));
```

---

## 3. 修改 UI 样式和主题

### 文件位置
- **全局样式**：`src/content.styles.js`
- **主题颜色**：`src/content.styles.js`（`THEME_COLORS` 对象）
- **侧边栏样式**：`src/sidepanel/styles.css`

### 修改步骤

#### 修改主题颜色

在 `src/content.styles.js` 中修改 `THEME_COLORS` 对象（约第 18-26 行）：

```javascript
var THEME_COLORS = window.THEME_COLORS || {
  primary: '#3674B5',              // 主色调
  primaryGradientStart: '#3674B5', // 渐变起始色
  primaryGradientEnd: '#578FCA',    // 渐变结束色
  hoverPrimary: '#205295',          // 悬停主色
  darkBackground: '#0A2647',        // 深色背景
  lightBackground: '#F7FAFC',       // 浅色背景
  darkBorder: '#144272',            // 深色边框
  lightBorder: '#E2E8F0',           // 浅色边框
  // ... 其他颜色
};
```

#### 修改全局 CSS 样式

在 `src/content.styles.js` 的 `injectGlobalStyles()` 函数中修改 CSS（约第 68-1013 行）：

```javascript
var injectGlobalStyles = window.injectGlobalStyles || function injectGlobalStyles() {
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* 在这里添加或修改 CSS 规则 */
    #${SELECTORS.ROOT} {
      --primary: ${THEME_COLORS.primary};
      /* ... */
    }
    
    .opm-button {
      /* 修改按钮样式 */
      border-radius: 8px; /* 例如：修改圆角 */
    }
  `;
  document.head.appendChild(styleEl);
};
```

#### 修改侧边栏样式

直接编辑 `src/sidepanel/styles.css` 文件。

---

## 4. 修改键盘快捷键

### 文件位置
- **快捷键处理**：`src/content.js`（`KeyboardManager` 类）
- **快捷键存储**：`src/content.js`（`PromptStorageManager.getKeyboardShortcut()`）

### 修改步骤

#### 修改默认快捷键

在 `src/content.js` 的 `PromptStorageManager.getKeyboardShortcut()` 方法中（约第 1570-1575 行）：

```javascript
static async getKeyboardShortcut() {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  return await PromptStorageManager.getData('keyboardShortcut', {
    key: isMac ? 'p' : 'm',           // 修改按键：'p', 'm', 'k' 等
    modifier: isMac ? 'metaKey' : 'ctrlKey', // 修改修饰键：'metaKey', 'ctrlKey', 'altKey'
    requiresShift: isMac             // 是否要求 Shift 键
  });
}
```

#### 修改快捷键处理逻辑

在 `src/content.js` 的 `KeyboardManager._onKeyDown()` 方法中（约第 1431-1450 行）：

```javascript
static async _onKeyDown(e) {
  const shortcut = KeyboardManager.shortcutCache;
  if (!shortcut) return;
  
  // 检查是否匹配快捷键
  const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
  const modifierMatch = e[shortcut.modifier] === true;
  const shiftMatch = shortcut.requiresShift ? e.shiftKey === true : true;
  
  if (keyMatch && modifierMatch && shiftMatch) {
    // 执行操作
    e.preventDefault();
    // ... 现有逻辑
  }
}
```

**快捷键格式**：
- `key`：按键字符（如 'p', 'm', 'k'）
- `modifier`：修饰键（'metaKey', 'ctrlKey', 'altKey'）
- `requiresShift`：是否需要 Shift 键

---

## 5. 添加新的视图/功能页面

### 文件位置
- **路由定义**：`src/content.js`（`PanelView` 对象和 `PanelRouter`）
- **视图构建**：`src/content.js`（`PanelRouter` 中的视图构建函数）

### 修改步骤

#### 步骤 1：定义新视图常量

在 `src/content.js` 的 `PanelView` 对象中添加新视图（约第 292 行附近）：

```javascript
const PanelView = {
  LIST: 'LIST',
  CREATE: 'CREATE',
  EDIT: 'EDIT',
  SETTINGS: 'SETTINGS',
  HELP: 'HELP',
  CHAT: 'CHAT',
  VARIABLE_INPUT: 'VARIABLE_INPUT',
  MY_NEW_VIEW: 'MY_NEW_VIEW'  // 添加新视图
};
```

#### 步骤 2：创建视图构建函数

在 `PanelRouter` 中添加视图构建函数（约第 336-665 行）：

```javascript
const PanelRouter = (() => {
  // ... 现有代码 ...
  
  const createMyNewView = () => {
    const container = createEl('div', {
      className: `opm-${getMode()}`,
      styles: { padding: '16px' }
    });
    
    const title = createEl('h2', { innerHTML: '我的新视图' });
    const content = createEl('div', { innerHTML: '这是新视图的内容' });
    
    container.appendChild(title);
    container.appendChild(content);
    
    return container;
  };
  
  // ... 现有代码 ...
})();
```

#### 步骤 3：注册视图到路由

在 `PanelRouter` 的视图映射中添加新视图（约第 336 行附近）：

```javascript
const builders = {
  [PanelView.LIST]: createListView,
  [PanelView.CREATE]: createCreateView,
  [PanelView.EDIT]: createEditView,
  [PanelView.SETTINGS]: createSettingsView,
  [PanelView.HELP]: createHelpView,
  [PanelView.CHAT]: createChatView,
  [PanelView.VARIABLE_INPUT]: createVariableInputView,
  [PanelView.MY_NEW_VIEW]: createMyNewView  // 注册新视图
};
```

#### 步骤 4：添加导航入口

在菜单栏或其他位置添加导航到新视图的按钮：

```javascript
// 例如在 createMenuBar() 中添加
const myNewViewBtn = createEl('button', {
  innerHTML: '我的新视图',
  className: `opm-button opm-${getMode()}`
});
myNewViewBtn.addEventListener('click', () => {
  window.PanelRouter.mount(window.PanelView.MY_NEW_VIEW);
});
```

---

## 6. 修改存储结构

### 文件位置
- **存储核心逻辑**：`src/promptStorage.js`
- **存储版本**：`src/promptStorage.js`（`PROMPT_STORAGE_VERSION` 常量）

### 修改步骤

#### 步骤 1：增加存储版本号

在 `src/promptStorage.js` 中修改版本号（约第 15 行）：

```javascript
export const PROMPT_STORAGE_VERSION = 3; // 从 2 升级到 3
```

#### 步骤 2：更新数据结构

修改 `normaliseArray()` 或添加新的规范化函数：

```javascript
function normaliseArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => ({
    uuid: item.uuid || generateUUID(),
    title: String(item.title || ''),
    content: String(item.content || ''),
    tags: Array.isArray(item.tags) ? item.tags : [],
    folderId: item.folderId || null,
    createdAt: item.createdAt || Date.now(),
    updatedAt: item.updatedAt || Date.now(),
    // 添加新字段
    myNewField: item.myNewField || 'defaultValue'
  }));
}
```

#### 步骤 3：添加迁移逻辑

在 `readRawStorage()` 函数中添加版本迁移逻辑（约第 58-93 行）：

```javascript
async function readRawStorage() {
  const data = await storageGet([STORAGE_KEY, LEGACY_KEY]);
  if (data[STORAGE_KEY] && Array.isArray(data[STORAGE_KEY].prompts)) {
    const store = data[STORAGE_KEY];
    if (store.version !== PROMPT_STORAGE_VERSION) {
      // 执行迁移
      const upgraded = {
        version: PROMPT_STORAGE_VERSION,
        prompts: normaliseArray(store.prompts).map(prompt => ({
          ...prompt,
          myNewField: prompt.myNewField || 'defaultValue' // 添加默认值
        })),
        folders: Array.isArray(store.folders) ? normaliseFolderArray(store.folders) : []
      };
      await writeStore(upgraded);
      return upgraded;
    }
    // ... 现有逻辑
  }
  // ... 其他情况
}
```

**注意事项**：
- 始终保留向后兼容性
- 迁移应该是幂等的（可重复执行）
- 测试迁移逻辑确保数据不丢失

---

## 7. 修改输入框处理逻辑

### 文件位置
- **输入框检测和插入**：`src/inputBoxHandler.js`

### 修改步骤

#### 修改输入框检测逻辑

在 `InputBoxHandler.getInputBox()` 方法中添加特殊处理（约第 22-60 行）：

```javascript
static async getInputBox() {
  // ... 现有动态匹配逻辑 ...
  
  // 添加特殊平台的处理
  if (window.location.href.includes('special-platform.com')) {
    const specialInput = document.querySelector('#special-input');
    if (specialInput) {
      return specialInput;
    }
  }
  
  // ... 其他逻辑 ...
}
```

#### 修改文本插入逻辑

在 `InputBoxHandler.insertPrompt()` 方法中添加特殊编辑器处理（约第 90-364 行）：

```javascript
static async insertPrompt(inputBox, content, promptList) {
  // ... 现有逻辑 ...
  
  // 检测特殊编辑器类型
  if (inputBox.classList.contains('special-editor')) {
    // 特殊处理逻辑
    inputBox.dispatchEvent(new CustomEvent('specialInsert', { detail: { content } }));
    return;
  }
  
  // ... 现有 textarea 和 contentEditable 处理 ...
}
```

#### 添加新的编辑器类型支持

如果需要支持新的富文本编辑器框架：

```javascript
// 在 insertPrompt 方法中添加
if (inputBox.classList.contains('my-editor')) {
  // 使用编辑器特定的 API
  const editor = inputBox.__editorInstance; // 假设编辑器实例
  editor.insertText(content);
  editor.focus();
  return;
}
```

---

## 8. 修改提示词生成器配置

### 文件位置
- **生成器 UI**：`src/content.js`（`createChatView()` 和 `initializeChat()`）
- **配置存储**：使用 `chrome.storage.local` 的 `chatApiKey`、`chatBaseUrl`、`chatModelName`

### 修改步骤

#### 修改默认配置

在 `initializeChat()` 函数的 `loadSettings()` 中（约第 756-767 行）：

```javascript
const loadSettings = () => {
  return new Promise((resolve) => {
    chrome.storage.local.get(['chatApiKey', 'chatBaseUrl', 'chatModelName'], (result) => {
      resolve({
        apiKey: result.chatApiKey || '',
        baseUrl: result.chatBaseUrl || 'https://openrouter.ai/api/v1', // 修改默认 Base URL
        modelName: result.chatModelName || 'nex-agi/deepseek-v3.1-nex-n1:free' // 修改默认模型
      });
    });
  });
};
```

#### 修改 API 请求格式

如果需要修改 API 请求格式，在 `initializeChat()` 的发送消息部分（约第 906-918 行）：

```javascript
const response = await fetch(`${settings.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.apiKey}`
  },
  body: JSON.stringify({
    model: settings.modelName,
    messages: allMessages,
    stream: true
    // 添加其他参数
    // temperature: 0.7,
    // max_tokens: 2000
  })
});
```

#### 修改流式响应解析



```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        // 完成处理
        break;
      }
      try {
        const json = JSON.parse(data);
        // 修改解析逻辑以适应不同的响应格式
        const content = json.choices[0]?.delta?.content || '';
        // ... 更新 UI
      } catch (e) {
        // 错误处理
      }
    }
  }
}
```

---

## 9. 添加新的 UI 组件

### 文件位置
- **UI 组件库**：`src/content.shared.js`（`Elements` 对象）

### 修改步骤

#### 在 `Elements` 对象中添加新组件

在 `src/content.shared.js` 的 `Elements` 对象中添加新组件方法（约第 197-424 行）：

```javascript
const Elements = {
  // ... 现有组件 ...
  
  createInputRow({ labelText, tooltipText, getValue, onChange, placeholder = '' }) {
    const row = createEl('div', {
      styles: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }
    });
    
    const labelWrap = createEl('div', { className: 'opm-toggle-label-wrap' });
    const label = createEl('label', { innerHTML: labelText, styles: { fontSize: '14px' } });
    labelWrap.appendChild(label);
    
    if (tooltipText) {
      const tip = createEl('span', {
        className: 'opm-help-tip',
        attributes: { title: tooltipText },
        innerHTML: '?'
      });
      labelWrap.appendChild(tip);
    }
    
    const input = createEl('input', {
      className: `opm-input opm-${getMode()}`,
      attributes: {
        type: 'text',
        placeholder: placeholder
      },
      styles: { flex: 1, padding: '4px 8px' }
    });
    
    // 加载初始值
    Promise.resolve(getValue?.())
      .then(value => { if (value) input.value = value; })
      .catch(err => console.warn('Failed to load input value:', err));
    
    // 监听变化
    input.addEventListener('change', () => {
      Promise.resolve(onChange?.(input.value))
        .catch(err => console.error('Input onChange failed:', err));
    });
    
    row.append(labelWrap, input);
    return row;
  }
};
```

#### 使用新组件

在设置表单或其他地方使用：

```javascript
settings.appendChild(Elements.createInputRow({
  labelText: 'API Key',
  tooltipText: '输入您的 API Key',
  placeholder: 'sk-...',
  getValue: async () => await window.PromptStorageManager.getData('apiKey', ''),
  onChange: async (value) => {
    await window.PromptStorageManager.setData('apiKey', value);
  }
}));
```

---

## 常见问题

### Q: 修改后扩展不生效？
A: 
1. 在 `chrome://extensions/` 中重新加载扩展
2. 刷新目标网页
3. 检查浏览器控制台是否有错误

### Q: 如何调试存储问题？
A:
1. 打开浏览器开发者工具
2. 在 Console 中执行：`chrome.storage.local.get(null, console.log)`
3. 查看存储的数据结构

### Q: 如何测试新功能？
A:
1. 使用 `npm run lint` 检查代码
2. 在支持的 AI 平台上测试
3. 检查控制台错误和警告

### Q: 修改了存储结构，旧数据怎么办？
A:
- 在 `readRawStorage()` 中添加迁移逻辑
- 确保迁移是幂等的（可重复执行）
- 测试从旧版本升级到新版本

---

## 相关文件索引

| 功能 | 主要文件 | 关键位置 |
|------|---------|---------|
| 平台配置 | `src/llm_providers.json` | 全部 |
| 输入框处理 | `src/inputBoxHandler.js` | 第 22-364 行 |
| 设置 UI | `src/content.shared.js` | 第 711-1015 行 |
| 设置存储 | `src/content.js` | 第 1570-1575 行 |
| 样式主题 | `src/content.styles.js` | 第 18-1013 行 |
| 路由视图 | `src/content.js` | 第 292-659 行 |
| 存储核心 | `src/promptStorage.js` | 全部 |
| 提示词生成器 | `src/content.js` | 第 379-1039 行 |
| UI 组件 | `src/content.shared.js` | 第 340-386 行 |

---

## 贡献建议

在修改代码时，请遵循以下原则：

1. **保持代码简洁**：只修改必要的部分
2. **向后兼容**：确保旧数据可以迁移到新版本
3. **添加注释**：使用中文注释说明修改原因
4. **测试验证**：修改后测试相关功能
5. **遵循现有模式**：参考现有代码的风格和结构

---

**最后更新**：2025-12-31
**版本**：v2.6.2

