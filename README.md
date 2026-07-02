<p align="center">
  <img src="./public/icons/icon-128.png" alt="灵译图标" width="96" height="96">
</p>

<h1 align="center">灵译</h1>

<p align="center">
  本地优先的 Chrome 翻译扩展，支持划词翻译、整页翻译、双语对照和页面总结。
</p>

<p align="center">
  <a href="#功能亮点">功能亮点</a> ·
  <a href="#开发">开发</a> ·
  <a href="#构建并加载到-chrome">加载到 Chrome</a>
</p>

灵译是一个面向日常阅读和开发文档场景的 Chrome 扩展。默认使用浏览器内置的 Gemini Nano 本地模型，页面内容无需离开本机；也可以切换到 OpenAI、OpenRouter、Gemini 或任意 OpenAI-compatible API。

## 功能亮点

- **本地 Gemini Nano 优先**：默认本地离线运行，首次使用按需下载模型，不需要 API Key。
- **划词翻译气泡**：选中文本后显示轻量翻译按钮，结果可复制，也可替换原文。
- **保留多段结构**：选中多段文字时，会尽量保留标题、列表和换行结构，避免替换成一整段。
- **整页翻译**：Popup 一键触发当前页面翻译，支持整页替换和双语对照。
- **并发与预热**：整页翻译会并发处理多个文本块，并优先翻译当前视口附近内容。
- **页面总结**：可从 Popup、右键菜单或设置项触发页面总结，结果在页面右下角展示。
- **自动总结**：可开启进入页面后自动生成一次总结，每个 URL 只触发一次。
- **可配置 Prompt**：翻译和总结 Prompt 都可编辑，默认 Prompt 会随界面语言切换。
- **右键菜单入口**：支持选中文本翻译、页面翻译和页面总结。
- **多主题外观**：内置 Lucid、Claude、Sage 三套主题，Popup、设置页和页面浮层同步切换。
- **中英文界面**：扩展界面支持中文和 English，翻译目标语言可单独设置。

## 页面入口

灵译包含三个主要入口：

- **Popup**：选择目标语言，执行整页翻译、双语对照或页面总结。
- **Options**：配置模型、API、主题、语言、入口开关、Prompt 模板和快捷键。
- **Content UI**：页面内划词气泡、滚动翻译提示、右下角总结面板。

后台 Service Worker 负责右键菜单、快捷键命令、模型调用和跨页面消息转发。

## 模型与提供商

| 提供商 | 默认模型 | 说明 |
| --- | --- | --- |
| 本地 Gemini Nano | `chrome-built-in` | Chrome Prompt API，本地运行，首次使用需要下载模型 |
| OpenAI | `gpt-4o-mini` | 官方 OpenAI API |
| OpenRouter | `openai/gpt-4o-mini` | 多模型聚合接口 |
| Gemini | `gemini-2.5-flash` | Gemini 的 OpenAI-compatible 接口 |
| 自定义兼容端点 | `gpt-4o-mini` | One API、LiteLLM、私有网关等兼容服务 |

## 快捷键

灵译声明了页面翻译和页面总结两个 Chrome command，但默认不绑定快捷键，避免和浏览器或其他扩展冲突。

用户可以在这里手动绑定：

```text
chrome://extensions/shortcuts
```

设置页会读取 Chrome 当前真实配置；如果没有绑定，会显示“未设置”。

## 开发

```bash
npm install
npm run dev
```

Vite 开发服务器适合调试 Popup 和 Options 页面。涉及 Chrome 扩展 API、右键菜单、content script、Gemini Nano 的功能，需要构建后以扩展形式加载。

## 构建并加载到 Chrome

```bash
npm run build
```

然后：

1. 打开 `chrome://extensions`。
2. 开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择项目的 `dist` 目录。

## 项目结构

```text
src/
  ai.ts                 云端 OpenAI-compatible 调用封装
  background.ts         MV3 后台 Service Worker
  chrome-built-in.ts    Chrome Prompt API / Gemini Nano 调用封装
  content.tsx           页面内划词气泡、整页翻译、总结面板
  i18n.ts               中英文界面文案
  messages.ts           Runtime / tab message 类型与 helpers
  options.tsx           设置页
  popup.tsx             Popup 操作面板
  storage.ts            chrome.storage.local 设置读写
  theme.ts              主题 token
  types.ts              共享类型、默认设置、Prompt 模板
public/
  manifest.json         Chrome 扩展 Manifest
  _locales/             Chrome 扩展本地化文案
  icons/                扩展图标
```

## 设计 notes

- Popup 以直接执行为主：整页翻译、双语对照、页面总结都是按钮，不是模式选择。
- 右键“翻译当前页面”会复用 Popup 最近一次选择的整页替换 / 双语对照模式。
- 选区替换会优先逐块替换标题、段落和列表；无法可靠匹配时退回为带换行的文本片段。
- 页面总结浮层复用右键总结展示方式，支持重新生成和复制总结。
