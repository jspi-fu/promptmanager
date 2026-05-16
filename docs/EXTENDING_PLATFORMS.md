# 扩展平台支持指南

本指南将详细说明如何为 Prompt Master 添加新的 AI 平台支持。通过遵循这些步骤，您可以让插件支持任何不在当前列表中的 AI 助手。

> 如果您希望借助 AI 快速添加新平台而不是手动调试，可以直接阅读[快速添加](#快速添加)章节。

## 目录

1. [概述](#概述)
2. [准备工作](#准备工作)
3. [步骤详解](#步骤详解)
4. [常见编辑器类型](#常见编辑器类型)
5. [测试与调试](#测试与调试)
6. [故障排除](#故障排除)
7. [快速添加](#快速添加)

## 概述

添加新平台支持需要三个主要步骤：

1. **在 `llm_providers.json` 中添加提供商配置**
2. **（通常不需要）检查 `manifest.json` 权限**
3. **确定并配置正确的输入框选择器**

插件会自动处理权限请求、脚本注入和文本插入，您只需要提供正确的配置信息。

## 准备工作

在开始之前，您需要：

1. **访问目标 AI 平台网站**
2. **打开浏览器开发者工具**（F12 或右键 → 检查）
3. **定位输入框元素**（使用元素选择器工具）

### 如何找到输入框

1. 在目标网站上打开开发者工具
2. 点击元素选择器工具（或按 `Ctrl+Shift+C` / `Cmd+Shift+C`）
3. 点击页面上的输入框
4. 在开发者工具中查看高亮的元素
5. 右键点击该元素 → 复制 → 复制选择器

## 步骤详解

### 步骤 1：在 `llm_providers.json` 中添加配置

打开 `src/llm_providers.json` 文件，在 `llm_providers` 数组中添加新条目：

```json
{
  "name": "平台名称",
  "pattern": "*://example.com/*",
  "url": "https://example.com",
  "icon_url": "https://example.com/favicon.ico",
  "element_selector": "#input-box-id"
}
```

#### 字段说明

- **`name`** (必需): 平台的显示名称，将显示在权限管理器和侧边栏中
- **`pattern`** (必需): URL 匹配模式，使用通配符 `*` 匹配子域名和路径
  - 示例：`*://chat.example.com/*` 匹配所有 `chat.example.com` 下的页面
  - 示例：`*://*.example.com/*` 匹配所有 `example.com` 的子域名
- **`url`** (必需): 平台的主页 URL，用于"开始使用"按钮链接
- **`icon_url`** (可选但推荐): 平台图标的 URL
  - 可以使用网络 URL：`https://example.com/favicon.ico`
  - 可以使用本地图标：`../icons/platform-icon.png`（需要将图标放在 `src/icons/` 目录）
- **`element_selector`** (必需): CSS 选择器，用于定位输入框元素
  - 可以是 ID：`#input-box`
  - 可以是类名：`.input-class`
  - 可以是属性选择器：`textarea[placeholder="输入消息"]`
  - 可以是组合选择器：`div.editor[contenteditable="true"]`

#### 选择器最佳实践

1. **优先使用 ID 选择器**：最稳定，如 `#chat-input`
2. **使用属性选择器**：当有唯一属性时，如 `textarea[placeholder="Message"]`
3. **避免使用动态类名**：某些网站使用随机生成的类名，这些类名会变化
4. **测试选择器的唯一性**：确保选择器只匹配一个元素
5. **简化复杂选择器**：如果浏览器复制的选择器过长，尝试找到更简单的替代方案

#### 处理复杂选择器

有时浏览器开发者工具会生成非常长的选择器（特别是使用 Tailwind CSS 或动态类名的网站），例如：

```
#chat-route-layout > div > main > div > div.-mt-\[var\(--header-height\)\].flex.w-full... > textarea
```

**这种选择器的问题：**
- ❌ 包含大量动态类名，容易失效
- ❌ 过于复杂，难以维护
- ❌ 可能包含特殊字符需要转义

**如何找到更简单的选择器：**

1. **检查元素本身**：
   - 查看是否有 `id` 属性：`#element-id`
   - 查看是否有 `name` 属性：`textarea[name="message"]`
   - 查看是否有 `data-*` 属性：`[data-testid="input"]`

2. **检查父元素**：
   - 向上查找父元素，看是否有稳定的 ID 或类名
   - 使用更短的路径：`#parent-id textarea`

3. **使用属性选择器**：
   - 查找唯一的属性组合：`textarea[placeholder*="输入"]`
   - 使用部分匹配：`textarea[class*="textarea"]`

4. **在控制台测试**：
   ```javascript
   // 测试简化后的选择器
   document.querySelector('textarea')  // 最简单
   document.querySelector('#chat-route-layout textarea')  // 使用父元素
   document.querySelector('textarea[placeholder*="输入"]')  // 使用属性
   ```

5. **逐步简化**：
   - 从最长的选择器开始
   - 逐步删除不必要的部分
   - 每次删除后测试是否还能找到元素
   - 保留最少的必要部分

**示例：简化豆包的选择器**

原始选择器（过长）：
```
#chat-route-layout > div > main > div > div... > textarea
```

简化方案：
```javascript
// 方案 1：使用父元素 ID + 标签
"#chat-route-layout textarea"

// 方案 2：如果 textarea 有唯一类名
"textarea.textarea-BnKyIt"

// 方案 3：使用属性选择器
"textarea.semi-input-textarea-wrapper"

// 方案 4：最简方案（如果页面只有一个 textarea）
"textarea"
```

**推荐做法：**
1. 先尝试最简单的选择器（如 `textarea`）
2. 如果页面有多个 textarea，添加父元素限制
3. 使用稳定的类名或属性，避免动态生成的类名
4. 在控制台测试多个备选方案，选择最稳定的

### 步骤 2：检查 `manifest.json` 权限（通常不需要修改）

由于 `manifest.json` 中已经配置了 `<all_urls>` 作为可选主机权限：

```json
"optional_host_permissions": [
    "<all_urls>"
]
```

这意味着插件可以请求任何网站的权限，**通常不需要修改 `manifest.json`**。

只有在以下情况才需要添加特定权限：
- 您想限制权限范围（不推荐）
- 您需要访问特殊的 Chrome API

补充说明（与当前项目实现一致）：
- 扩展采用“可选主机权限”方式工作：只有在用户通过权限页面授予某站点权限后，内容脚本才会注入该站点页面。
- 默认设置为“追加模式开启”：插入提示词时会追加到输入框末尾而非覆盖。若要验证覆盖行为，请在设置页关闭“将提示词追加到文本”。

### 步骤 3：验证输入框类型

插件支持两种主要的输入框类型：

1. **`<textarea>` 元素**：标准文本区域
2. **`contentEditable` 元素**：富文本编辑器（如 Lexical、ProseMirror 等）

插件会自动检测并处理这两种类型。如果您的平台使用了特殊的编辑器框架，可能需要额外的处理（见下方"常见编辑器类型"部分）。

## 常见编辑器类型

### 1. 标准 textarea

最简单的类型，直接使用 `textarea` 标签：

```json
"element_selector": "textarea"
```

### 2. contentEditable div

使用 `div` 元素并设置 `contenteditable="true"`：

```json
"element_selector": "div[contenteditable='true']"
```

### 3. Lexical 编辑器

Lexical 是 Facebook 开发的富文本编辑器框架，插件已内置支持：

```json
"element_selector": "#ask-input"
```

插件会自动检测 Lexical 编辑器并使用 `execCommand('insertText')` 方法。

### 4. ProseMirror 编辑器

ProseMirror 是另一个流行的富文本编辑器，插件也已支持：

```json
"element_selector": "div.ProseMirror[contenteditable='true']"
```

### 5. Quill 编辑器

Quill 编辑器通常使用 `.ql-editor` 类：

```json
"element_selector": "div.ql-editor[contenteditable='true']"
```

### 6. 自定义编辑器

如果平台使用了自定义编辑器，尝试以下方法：

1. **查找最接近的父元素**：可能输入框被包装在容器中
2. **使用多个选择器**：提供备选选择器，用逗号分隔
3. **检查是否需要特殊处理**：查看 `inputBoxHandler.js` 中的特殊编辑器处理逻辑

## 测试与调试

### 1. 重新加载扩展

每次修改配置后，需要重新加载扩展：

1. 打开 `chrome://extensions/`
2. 找到 "Prompt Master"
3. 点击刷新按钮

### 2. 授予权限

1. 打开扩展的权限管理器（点击扩展图标 → 侧边栏 → 权限管理器）
2. 找到新添加的平台
3. 点击"授予权限"按钮

### 3. 测试输入框检测

1. 访问目标平台网站
2. 打开浏览器控制台（F12 → Console）
3. 查看是否有以下日志：
   - `Input box found: [平台名称]` ✅ 成功
   - `Input box not found on this page.` ❌ 失败

### 4. 测试文本插入

1. 在目标网站上打开提示词大师（快捷键或按钮）
2. 选择一个提示词
3. 检查文本是否正确插入到输入框

### 5. 调试选择器

如果输入框未找到，在浏览器控制台中测试选择器：

```javascript
// 测试选择器
document.querySelector('您的选择器')

// 如果返回 null，尝试其他选择器
// 查看元素的实际结构
document.querySelector('可能的父元素')
```

## 故障排除

### 问题 1：输入框未找到

**可能原因：**
- 选择器不正确
- 输入框是动态加载的（需要等待页面完全加载）
- 输入框在 iframe 中（插件无法访问）

**解决方案：**
1. 使用开发者工具重新检查元素
2. 尝试更通用的选择器
3. 检查是否有多个匹配元素（选择器应该唯一）

### 问题 2：文本插入后没有反应

**可能原因：**
- 编辑器需要特殊的事件触发
- 编辑器使用了自定义的输入处理

**解决方案：**
1. 检查 `inputBoxHandler.js` 中是否有类似编辑器的处理逻辑
2. 查看控制台是否有错误信息
3. 尝试手动触发输入事件（在控制台中测试）

### 问题 3：权限请求失败

**可能原因：**
- URL 模式格式不正确
- 网站使用了特殊的安全策略

**解决方案：**
1. 检查 `pattern` 字段格式是否正确
2. 确保使用通配符 `*` 而不是正则表达式
3. 尝试更宽泛的模式（如 `*://*.example.com/*`）

### 问题 4：脚本未注入

**可能原因：**
- 标签页在权限授予前已打开
- URL 匹配失败

**解决方案：**
1. 刷新页面
2. 检查 Service Worker 日志（`chrome://extensions/` → 查看 Service Worker）

## 快速添加

以添加 "Kimi" 平台为例，URL 为 `https://www.kimi.com/`。

### 步骤 1：找到输入框元素

1. 访问 `https://www.kimi.com/`
2. 右键打开开发者工具（或按 `F12`）
3. 点击元素选择器工具（或按 `Ctrl+Shift+C` / `Cmd+Shift+C`）
4. 点击页面上的输入框
5. 在开发者工具中查看高亮的元素（注意，此元素应该包括 `contenteditable="true"` ）
6. 右键点击该元素 → 复制 → 复制元素

![step1](../assets/step1.png)
![step2](../assets/step2.png)

### 步骤 2：添加配置

打开任意 AI 助手，输入以下提示词：
```markdown
我需要在提示词管理器拓展中增加对Kimi平台 `https://www.kimi.com/` 的支持，其输入框元素为： 
<div aria-multiline="false" aria-required="false" autocomplete="false" autocorrect="false" contenteditable="true" spellcheck="true" class="chat-input-editor" data-v-c4707df6="" data-lexical-editor="true" style="user-select: text; white-space: pre-wrap; word-break: break-word;" role="textbox"><p><br></p></div>
我期望你的输出格式如下：
{
  "name": "平台名称",
  "pattern": "*://example.com/*",
  "url": "https://example.com",
  "icon_url": "https://example.com/favicon.ico",
  "element_selector": "textarea"
}
不要有任何额外输出与解释。
```

> 请根据实际情况修改提示词中的**平台名称、url、输入框元素**字段。

### 步骤 3：测试

1. 重新加载扩展
2. 在权限管理器中授予 `Kimi` 的权限
3. 访问 `https://www.kimi.com/`
4. 打开提示词大师并测试插入功能

### 完整配置示例

```json
{
  "llm_providers": [
    // ... 现有提供商 ...
    {
      "name": "Kimi",
      "pattern": "*://www.kimi.com/*",
      "url": "https://www.kimi.com",
      "icon_url": "https://www.kimi.com/favicon.ico",
      "element_selector": "div.chat-input-editor[contenteditable='true']"
    }
  ]
}
```

## 高级技巧

### 1. 使用多个选择器

如果输入框可能有不同的选择器（例如，在不同页面布局中），可以使用逗号分隔的多个选择器：

```json
"element_selector": "#input-main, textarea.chat-input, div[contenteditable='true'].editor"
```

注意：插件目前只使用第一个匹配的选择器，但您可以在 `inputBoxHandler.js` 中添加回退逻辑。

### 2. 处理动态加载的输入框

如果输入框是动态加载的，插件已经内置了等待机制（`waitForInputBox()`），最多等待 10 秒。如果您的平台需要更长的加载时间，可以修改 `inputBoxHandler.js` 中的超时时间。

### 3. 添加本地图标

如果平台没有公开的图标 URL，可以：

1. 下载图标到 `src/icons/` 目录
2. 在配置中使用相对路径：`"icon_url": "../icons/platform-icon.png"`

### 4. 处理特殊字符

如果选择器包含特殊字符，需要进行转义：

- 点号 `.` → `\\.`
- 方括号 `[]` → `\\[\\]`
- 引号需要匹配（单引号或双引号）

## 贡献

如果您成功添加了新平台支持，欢迎：

1. **提交 Pull Request**：将您的更改提交到项目仓库
2. **分享经验**：在 Issue 中分享您遇到的问题和解决方案
3. **改进文档**：帮助完善本指南

## 相关文件

- `src/llm_providers.json` - 提供商配置文件
- `src/llm_providers.js` - 提供商加载逻辑
- `src/inputBoxHandler.js` - 输入框检测和插入逻辑
- `src/manifest.json` - 扩展清单文件
- `src/service-worker.js` - 权限和脚本注入逻辑

## 需要帮助？

如果您在添加新平台时遇到问题：

1. 查看现有的提供商配置作为参考
2. 检查浏览器控制台的错误信息
3. 在项目仓库中创建 Issue 描述您的问题
4. 查看 `DOCUMENTATION.md` 了解插件架构

---

**祝您扩展顺利！**

