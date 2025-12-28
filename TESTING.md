## 测试

### 使用 Puppeteer 进行自动化测试

本项目包含使用 **Puppeteer** 和 **Jest** 的自动化测试，以确保扩展按预期工作。

#### 如何找到测试

- 所有测试文件位于 `tests` 目录中，或遵循命名约定 `*.test.js`。
- 扩展的主要测试文件是 `index.test.js`。

#### 运行测试

1. **安装依赖**  
   通过运行以下命令确保所有必需的依赖项都已安装：

   ```bash
   npm install
   ```

2. **运行测试**
   使用以下命令执行所有测试：

   ```bash
   npm test
   ```

3. **查看测试结果**
   运行测试后，您将在终端中看到结果。每个测试将显示是否通过或失败，以及任何错误消息。

#### 示例测试

以下是 `index.test.js` 中测试的示例：

```javascript
test("popup renders correctly", async () => {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);

  // 定位标签为 <div> 且类名为 "link-container" 的元素
  const linkContainer = await page.$("div.link-container");
  expect(linkContainer).not.toBeNull();

  // 获取该 div 的所有子 <a> 元素
  const childrenA = linkContainer.$$("a");
  expect(childrenA.length).toBe(5);
});
```

### 其他说明

测试配置为使用 Jest 运行，因此任何以 `.test.js` 结尾的文件都会自动包含在内。
有关更高级的测试，请参阅 Puppeteer API 文档。

要运行特定测试，请使用以下命令：
```
npx jest tests/{example}.test.js 
```

### 扁平化 `tests/` 文件夹结构

```
tests/
├── index.test.js                # 演示测试
└── element_selector.test.js     # 测试所有支持的大语言模型的提示词文本区域
```
