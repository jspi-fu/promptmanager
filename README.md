# Open Prompt Manager

一个轻量级的 Chrome 扩展，用于管理多个 AI 聊天机器人的提示词，包括 ChatGPT、Claude、Gemini、NotebookLM、Deepseek、Copilot、Grok 和 Poe。

## 功能特性

- 🚀 保存、编辑和组织您喜爱的提示词
- 使用标签进行高级组织
- 🔍 快速搜索功能和键盘导航
- 💾 导入/导出提示词以便分享
- 🌓 支持浅色和深色模式
- 🔄 支持 `#variable#` 语法的变量
- 🎯 支持多个 AI 平台：
  <!--
    之前的支持平台列表未格式化为有效的 Markdown 表格。
    下面是一个正确格式化的 Markdown 表格，以便更好地渲染。
  -->
  | ChatGPT    | Claude     | Google Gemini |
  |------------|------------|---------------|
  | NotebookLM | Deepseek   | Copilot       |
  | Grok       | Poe        | Qwen          |
  | Perplexity | Kimi       | Mistral       |
  | Abacus     | OpenRouter |               |


## 安装

1. 从 [Chrome 网上应用店](https://chromewebstore.google.com/detail/open-prompt-manager/gmhaghdbihgenofhnmdbglbkbplolain) 安装
2. 使用权限授予您想要使用的大语言模型的访问权限。

### 键盘快捷键

- **⌘ + Shift + P** (Mac) 或 **Ctrl + M** (Windows/Linux)：打开/关闭提示词列表
- **↑/↓**：在提示词之间导航
- **Enter**：选择提示词
- **Esc**：关闭提示词管理器

## 测试

本项目包含使用 **Puppeteer** 和 **Jest** 的自动化测试。有关更高级的测试，请参阅 [Puppeteer API 文档](https://pptr.dev/)。

有关如何运行和调试测试的详细说明，请参阅 [测试指南](TESTING.md)。

## 隐私

- 所有提示词都存储在您的浏览器本地
- 不会向外部服务器发送任何数据
- 您的提示词保存在本地存储中以获得最大容量

## 许可证

本项目是开源的，可在 MIT 许可证下使用。

## 致谢

### 贡献成员：

- 感谢 Hexodus 发现了一个错误并帮助我解决它
- 感谢 Abdallahheidar 的想法、贡献以及在这个项目上的团队合作！
- 感谢 HideMaru 提供的精美图标！

<a href="https://www.flaticon.com/free-icons/chatbot" title="chatbot icons">Chatbot icons created by HideMaru - Flaticon</a>
