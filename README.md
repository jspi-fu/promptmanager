![Cover](assets/cover.png)
<div align="center">
  <a href="https://gitee.com/ye_sheng0839/prompt-master/stargazers"><img src="https://gitee.com/ye_sheng0839/prompt-master/badge/star.svg?theme=dark" alt="Stars"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/promptmaster/decdbjbmghcogkbpjpfknillkabahdni"><img src="https://img.shields.io/badge/Microsoft_Edge-0078D7?style=flat&logo=microsoft-edge&logoColor=white" alt="Edge Add-ons"></a>
</div>

一款"小而美"的浏览器扩展，用于在多个 AI 平台上**快速管理与插入提示词**，并提供一个内置的"提示词生成器"辅助生成可复用提示词，具有多项**用户友好**的特色功能！

<div align="center">
  <img src="https://ik.imagekit.io/a3keouazok/ad.png" alt="Advert">
  <br>
  <a href="https://microsoftedge.microsoft.com/addons/detail/promptmaster/decdbjbmghcogkbpjpfknillkabahdni"><strong>点击获取Edge插件</strong></a>
</div>

## 功能概览

- **提示词管理**：创建 / 编辑 / 删除 / 搜索；支持导入导出。
- **标签模式（默认开启）**：为提示词添加标签并按标签筛选；设置页支持“标签管理”排序。
- **追加模式（默认开启）**：插入提示词时默认追加到输入框末尾，不覆盖已输入内容。
- **变量占位符**：支持 `#variable#` 语法；插入前弹窗收集变量值并替换。
- **两种打开方式**：标准按钮模式（可拖动）/ 热角模式（右下角悬停）。
- **提示词生成器**：
  - OpenAI 兼容接口配置（API Key / Base URL / Model Name）。
  - **流式（stream）输出**，体验更友好。
  - 模型回复可一键**保存为提示词**。
  - 对话上下文会本地保存，直到您手动点击“重置”。

## 支持平台（示例）

平台列表来自 `src/llm_providers.json`，可按需扩展。常见示例：

| ChatGPT | Claude | Gemini |
|---|---|---|
| DeepSeek | 豆包 | Kimi |
| 智谱清言 | Perplexity AI | Poe |
| Grok | NotebookLM | OpenAI Playground |
| Qwen | 千问 | 元宝 |
| 问小白 | ChatLLM | Mistral Le Chat |
| Google AI Studio | LMArena | Minimax |
| 扣子 | Xiaomi MiMo | 阶跃AI |

## 安装与使用

### 安装（开发者模式）

1. 下载项目代码到本地
2. 打开 `chrome://extensions/`，启用“开发者模式”
3. 点击“加载已解压的扩展程序”，选择本项目 `src/` 目录
4. 打开任意支持平台页面，在权限管理器中授予对应站点权限（可选主机权限）

> 普通用户直接从[Edge插件市场](https://microsoftedge.microsoft.com/addons/detail/promptmaster/decdbjbmghcogkbpjpfknillkabahdni)安装即可。

### 键盘快捷键

- **macOS**：`⌘ + ⇧ + P`
- **Windows / Linux**：`Ctrl + M`
- 方向键：在列表中上下移动
- Enter：选择提示词
- Esc：关闭面板

### 设置项说明

在“设置”页中，部分功能文案后带有 `?`，鼠标悬浮可查看解释：

- **将提示词追加到文本**：开启后插入为“追加”，关闭则会覆盖输入框内容。
- **启用标签**：开启后支持标签输入、标签筛选与标签管理。

## 隐私与数据说明

- **提示词/设置/快捷键/对话历史**均存储在浏览器本地 `chrome.storage.local`。
- **模型配置（API Key/Base URL/Model Name）仅保存在本机**。
- “提示词生成器”会把你在对话中输入的内容发送到你配置的 **OpenAI 兼容接口**（例如自建服务/第三方服务）；除此之外扩展不会主动上传你的提示词数据。

## 开发与测试

- **Lint**：`npm run lint`（自动修复：`npm run lint:fix`）
- **测试**：见 [TESTING.md](docs/TESTING.md)
- **构建发布包**：
  - `npm run build` 或 `npm run build:both` - 同时生成 Chrome 和 Edge 发布包
  - `npm run build:chrome` - 仅生成 Chrome Web Store 发布包
  - `npm run build:edge` - 仅生成 Microsoft Edge Add-ons 发布包
  - 输出位置：`dist/prompt-manager-chrome.zip` 和 `dist/prompt-manager-edge.zip`
- **添加新平台**：见 [EXTENDING_PLATFORMS.md](docs/EXTENDING_PLATFORMS.md)
- **架构文档**：见 [DOCUMENTATION.md](docs/DOCUMENTATION.md)

## 许可证

本插件使用[MIT](LICENSE)协议，欢迎任何形式的贡献！

## 致谢

- 本项目基于[Open Prompt Manager](https://github.com/jonathanbertholet/promptmanager)进行重构、汉化、功能升级与性能优化，感谢原始开发团队提供的优秀模板，项目中的打赏通道将永远留给他们！
- 感谢由[Lyra 4D](https://lyraprompt.com/)提供的优质提示词策略与评分机制！
- 部分功能与bug修复已向原始项目提交PR
