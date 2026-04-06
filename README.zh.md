# Chorus（众声）

**一次提问，聆听所有 AI 的回答。**

Chorus 是一款桌面应用，将你的提问同时发送给多个大语言模型——ChatGPT、Claude、Gemini、DeepSeek、Kimi 和 Z.AI——并排展示所有回答。无需 API Key，无需额外订阅，使用你已有的账号即可。

[English](README.md)

---

## 工作原理

Chorus 在后台运行一个浏览器，代替你操作各大语言模型的官方网页。使用你已登录的账号，Chorus 不会存储任何账号密码。

---

## 支持的模型

| 模型 | 网址 |
|------|------|
| ChatGPT | chat.openai.com |
| Claude | claude.ai |
| Gemini | gemini.google.com |
| DeepSeek | chat.deepseek.com |
| Kimi（月之暗面） | kimi.com |
| Z.AI（智谱） | chat.z.ai |

---

## 环境要求

- macOS（主要支持平台）
- Node.js 18+
- 至少一个已注册的大语言模型账号

---

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone https://github.com/TokenBlade/chorus.git
cd chorus
npm install
```

### 2. 登录各大语言模型

首次启动时，Chorus 会打开一个浏览器窗口。在其中登录你想使用的模型网站。登录状态会保存到本地浏览器 Profile，后续启动无需重复登录。

### 3. 启动

```bash
npm run dev
```

---

## 使用方法

1. 在欢迎页顶部选择你想查询的模型。
2. 输入提示词，按 **Cmd+Enter** 发送。
3. 各模型的回答会实时并排显示。
4. 点击任意回答卡片，可单独与该模型继续对话。

---

## 从源码构建

```bash
npm run build
```

构建结果输出至 `out/` 目录。

---

## 运行测试

```bash
npm test
```

---

## 开源协议

Apache License 2.0，详见 [LICENSE](LICENSE)。
