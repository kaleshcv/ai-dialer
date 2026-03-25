const DEFAULT_BROWSER_PASSWORD = 'browserpass'
const DEFAULT_BROWSER_DISPLAY_NAME = 'Browser Agent'
const DEFAULT_BROWSER_USERNAME = 'browser1001'

function getWindowHostname() {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return 'localhost'
  }

  return window.location.hostname
}

function getWindowProtocol() {
  if (typeof window === 'undefined' || !window.location?.protocol) {
    return 'http:'
  }

  return window.location.protocol
}

function getDefaultWebSocketUrl() {
  const protocol = getWindowProtocol() === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${getWindowHostname()}:8088/ws`
}

function parseSipUri(value) {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return {}
  }

  const stripped = raw.replace(/^sips?:/i, '')
  const [userPart = '', hostPart = ''] = stripped.split('@')
  if (!userPart || !hostPart) {
    return {}
  }

  const username = userPart.split(/[;?]/, 1)[0].trim()
  const domain = hostPart.split(/[;?]/, 1)[0].trim()
  return {
    domain,
    username,
  }
}

export function getBrowserVoiceConfig() {
  const env = import.meta.env ?? {}
  const sipUri = env.VITE_SIP_URI || env.SIP_URI || ''
  const parsedUri = parseSipUri(sipUri)
  const authUsername =
    env.VITE_SIP_AUTH_USERNAME ||
    env.VITE_SIP_USERNAME ||
    env.SIP_USERNAME ||
    parsedUri.username ||
    DEFAULT_BROWSER_USERNAME
  const authPassword =
    env.VITE_SIP_PASSWORD ||
    env.VITE_SIP_AUTH_PASSWORD ||
    env.SIP_PASSWORD ||
    DEFAULT_BROWSER_PASSWORD
  const domain = env.VITE_SIP_DOMAIN || env.SIP_DOMAIN || parsedUri.domain || getWindowHostname()
  const wsUrl = env.VITE_SIP_WS_URL || env.SIP_WS_URL || getDefaultWebSocketUrl()
  const displayName = env.VITE_SIP_DISPLAY_NAME || env.SIP_DISPLAY_NAME || DEFAULT_BROWSER_DISPLAY_NAME

  return {
    aor: sipUri || `sip:${authUsername}@${domain}`,
    authPassword,
    authUsername,
    displayName,
    domain,
    wsUrl,
  }
}

export function isBrowserVoiceConfigured(config = getBrowserVoiceConfig()) {
  return Boolean(config.wsUrl && config.aor && config.authUsername && config.authPassword && config.domain)
}

export function normalizeBrowserDialNumber(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function buildBrowserSipTarget(value, domain = getBrowserVoiceConfig().domain) {
  const number = normalizeBrowserDialNumber(value)
  if (!number) {
    return ''
  }

  return `sip:${number}@${domain}`
}
