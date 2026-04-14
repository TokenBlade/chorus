export type Lang = 'en' | 'zh'

const translations = {
  en: {
    // Welcome page
    'app.title': 'Multi-LLM Orchestrator',
    'app.subtitle': 'What would you like to explore today?',

    // Sidebar
    'sidebar.open': 'Open sidebar',
    'sidebar.close': 'Close sidebar',
    'sidebar.newChat': 'New chat',
    'sidebar.noConversations': 'No conversations yet',
    'sidebar.more': 'More options',
    'sidebar.rename': 'Rename',
    'sidebar.remove': 'Remove',
    'sidebar.renamePlaceholder': 'Rename chat',
    'sidebar.renameSave': 'Save',
    'sidebar.renameCancel': 'Cancel',

    // Query input
    'input.placeholder': 'Enter your prompt here...',
    'input.hint': 'Cmd+Enter to send',
    'input.send': 'Send',
    'input.running': 'Running...',

    // In-thread input
    'inThread.chattingWith': 'Chatting with',
    'inThread.placeholder': (provider: string) => `Follow up with ${provider}...`,
    'inThread.sendTo': (provider: string) => `Send to ${provider}`,

    // LLM selector
    'llm.addHint': 'Add an LLM',
    'llm.addTitle': 'Add LLM',
    'llm.removeTitle': (name: string) => `Remove ${name}`,

    // Provider card
    'status.waiting': 'Waiting...',
    'status.generating': 'Generating...',
    'status.thinking': 'Thinking...',
    'action.copyLink': 'Copy link',
    'action.chat': 'Chat with this provider',
    'action.copy': 'Copy response',
    'action.good': 'Good response',
    'action.bad': 'Bad response',

    // Turn
    'turn.you': 'You',
    'turn.to': 'to',

    // Theme
    'theme.change': 'Change theme',

    // Theme names
    'theme.snowlight': 'Snowlight',
    'theme.sandstone': 'Sandstone',
    'theme.obsidian': 'Obsidian',

    // Provider labels (only Chinese models need Chinese names)
    'provider.chatgpt': 'ChatGPT',
    'provider.claude': 'Claude',
    'provider.gemini': 'Gemini',
    'provider.deepseek': 'DeepSeek',
    'provider.moonshot': 'Kimi',
    'provider.zai': 'Z.ai',
  },
  zh: {
    'app.title': '多模型协作平台',
    'app.subtitle': '今天想探索什么？',

    'sidebar.open': '打开侧栏',
    'sidebar.close': '关闭侧栏',
    'sidebar.newChat': '新对话',
    'sidebar.noConversations': '暂无对话',
    'sidebar.more': '更多操作',
    'sidebar.rename': '重命名',
    'sidebar.remove': '移除',
    'sidebar.renamePlaceholder': '重命名对话',
    'sidebar.renameSave': '保存',
    'sidebar.renameCancel': '取消',

    'input.placeholder': '输入你的问题...',
    'input.hint': 'Cmd+Enter 发送',
    'input.send': '发送',
    'input.running': '运行中...',

    'inThread.chattingWith': '正在与',
    'inThread.placeholder': (provider: string) => `继续与 ${provider} 对话...`,
    'inThread.sendTo': (provider: string) => `发送给 ${provider}`,

    'llm.addHint': '添加模型',
    'llm.addTitle': '添加模型',
    'llm.removeTitle': (name: string) => `移除 ${name}`,

    'status.waiting': '等待中...',
    'status.generating': '生成中...',
    'status.thinking': '思考过程',
    'action.copyLink': '复制链接',
    'action.chat': '与此模型对话',
    'action.copy': '复制回复',
    'action.good': '好的回复',
    'action.bad': '差的回复',

    'turn.you': '你',
    'turn.to': '对',

    'theme.change': '切换主题',

    // Theme names
    'theme.snowlight': '雪光',
    'theme.sandstone': '砂岩',
    'theme.obsidian': '黑曜石',

    // Chinese models get Chinese names; others keep English
    'provider.chatgpt': 'ChatGPT',
    'provider.claude': 'Claude',
    'provider.gemini': 'Gemini',
    'provider.deepseek': 'DeepSeek',
    'provider.moonshot': 'Kimi',
    'provider.zai': 'Z.ai',
  },
} as const

type TranslationKey = keyof typeof translations.en
type TranslationValue = string | ((...args: string[]) => string)

export function t(lang: Lang, key: TranslationKey): TranslationValue {
  return (translations[lang] as Record<TranslationKey, TranslationValue>)[key] ?? translations.en[key]
}

export function ts(lang: Lang, key: TranslationKey): string {
  const val = t(lang, key)
  return typeof val === 'string' ? val : ''
}

export function tf(lang: Lang, key: TranslationKey, ...args: string[]): string {
  const val = t(lang, key)
  if (typeof val === 'function') return val(...args)
  return val
}
