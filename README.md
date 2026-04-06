# Chorus

**Ask once. Hear every AI answer.**

Chorus is a desktop app that sends your prompt to multiple LLMs at the same time — ChatGPT, Claude, Gemini, DeepSeek, Kimi, and Z.AI — and displays all responses side by side. No API keys. No subscriptions beyond what you already have.

[中文说明](README.zh.md)

---

## How it works

Chorus runs a browser in the background and operates each LLM's official web interface on your behalf. Your existing logins are used — Chorus never stores your credentials.

---

## Supported providers

| Provider | Website |
|----------|---------|
| ChatGPT | chat.openai.com |
| Claude | claude.ai |
| Gemini | gemini.google.com |
| DeepSeek | chat.deepseek.com |
| Kimi (Moonshot) | kimi.com |
| Z.AI | chat.z.ai |

---

## Requirements

- macOS (primary platform)
- Node.js 18+
- An active account on whichever LLM providers you want to use

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/TokenBlade/chorus.git
cd chorus
npm install
```

### 2. Log in to your LLM providers

On first launch, Chorus opens a browser window. Log in to each provider you want to use. Your sessions are saved to a local browser profile and reused on subsequent launches.

### 3. Run

```bash
npm run dev
```

---

## Usage

1. Select the LLMs you want to query using the chips at the top of the welcome screen.
2. Type your prompt and press **Cmd+Enter** to send.
3. Responses appear side by side as they stream in.
4. Click any response card to open a follow-up chat with that provider individually.

---

## Building from source

```bash
npm run build
```

Output is in `out/`.

---

## Running tests

```bash
npm test
```

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
