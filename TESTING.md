## 测试与本地验证

本项目使用 **Jest + Puppeteer** 做基础的端到端校验（通过加载 `src/` 目录作为“已解压扩展”，并用动态 extensionId 打开页面）。

## 前置条件

- Node.js（建议 LTS）
- 本机可启动 Chromium（Puppeteer 会拉起一个可见浏览器窗口；当前用例默认 `headless: false`）

## 安装依赖

```bash
npm install
```

## 运行测试

```bash
npm test
```

说明：
- 测试会启动浏览器并加载扩展（路径：`src/`），运行结束会自动关闭浏览器。
- 当前 `tests/index.test.js` 会打开侧边栏页面 `sidepanel/index.html` 并做基础存在性校验。

## 只运行某个测试文件

```bash
npx jest tests/index.test.js
```

## 调试模式

```bash
npm run debug
```

然后在 Chrome DevTools / VSCode 中附加 Node 调试器到 Jest 进程。

## Lint（建议作为提交前检查）

```bash
npm run lint
```

自动修复：

```bash
npm run lint:fix
```

## tests/ 目录结构

```
tests/
├── index.test.js
└── element_selector.test.js
```
