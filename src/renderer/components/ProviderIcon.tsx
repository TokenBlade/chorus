type Props = {
  provider: string
  size?: number
}

// ChatGPT — OpenAI sparkle/knot
function ChatGPTIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M22.28 9.37a6.5 6.5 0 0 0-.56-5.33A6.58 6.58 0 0 0 14.63.7a6.5 6.5 0 0 0-4.88-2.19 6.58 6.58 0 0 0-6.24 4.51 6.5 6.5 0 0 0-4.33 3.15 6.58 6.58 0 0 0 .8 7.72 6.5 6.5 0 0 0 .56 5.33 6.58 6.58 0 0 0 7.09 3.34 6.5 6.5 0 0 0 4.88 2.19 6.58 6.58 0 0 0 6.24-4.51 6.5 6.5 0 0 0 4.33-3.15 6.58 6.58 0 0 0-.8-7.72z"
        fill="currentColor"
        transform="translate(0, 1.5) scale(0.92)"
        opacity="0.85"
      />
      <circle cx="12" cy="12" r="4" fill="var(--bg-surface, #111)" />
    </svg>
  )
}

// Claude — Anthropic asterisk/sparkle
function ClaudeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L14 9L21 9L15.5 13.5L17.5 21L12 16.5L6.5 21L8.5 13.5L3 9L10 9Z" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

// Gemini — four-pointed star
function GeminiIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2C12 2 14 10 12 12C10 10 12 2 12 2ZM12 22C12 22 10 14 12 12C14 14 12 22 12 22ZM2 12C2 12 10 10 12 12C10 14 2 12 2 12ZM22 12C22 12 14 14 12 12C14 10 22 12 22 12Z" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

// DeepSeek — circle with checkmark
function DeepSeekIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9zm0 2c3.87 0 7 3.13 7 7s-3.13 7-7 7-7-3.13-7-7 3.13-7 7-7z" fill="currentColor" opacity="0.3" />
      <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Moonshot AI (Kimi) — crescent moon
function MoonshotIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

// Z.AI — bold Z letterform
function ZaiIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 5h12v2.5L8.5 17H18v2H6v-2.5L15.5 7H6V5z" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

const PROVIDER_COLORS: Record<string, string> = {
  chatgpt: '#10a37f',
  claude: '#c96442',
  gemini: '#4285f4',
  deepseek: '#5b6ef7',
  moonshot: '#6c5ce7',
  zai: '#e17055',
}

const ICON_MAP: Record<string, (props: { size: number }) => JSX.Element> = {
  chatgpt: ChatGPTIcon,
  claude: ClaudeIcon,
  gemini: GeminiIcon,
  deepseek: DeepSeekIcon,
  moonshot: MoonshotIcon,
  zai: ZaiIcon,
}

export { PROVIDER_COLORS }

export default function ProviderIcon({ provider, size = 16 }: Props) {
  const color = PROVIDER_COLORS[provider] || 'currentColor'
  const IconComponent = ICON_MAP[provider]

  return (
    <span className="provider-icon" style={{ color, display: 'inline-flex', alignItems: 'center' }}>
      {IconComponent && <IconComponent size={size} />}
    </span>
  )
}
