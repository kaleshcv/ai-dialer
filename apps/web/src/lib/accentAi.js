export const ACCENT_AI_LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
]

export const ACCENT_AI_MODE_OPTIONS = [
  { value: 'latency', label: 'Latency' },
  { value: 'clarity', label: 'Clarity' },
]

export const ACCENT_AI_INPUT_OPTIONS = [
  { value: 'system', label: 'System Mic' },
  { value: 'accentai', label: 'AccentAI Mic' },
]

const httpProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
const configuredApiBaseUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL?.replace(/\/$/, '') : ''
const apiBaseUrl =
  configuredApiBaseUrl || (typeof window !== 'undefined' ? `${httpProtocol}//${window.location.hostname}:8000` : '')

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `AccentAI request failed with ${response.status}`)
  }
  return response.json()
}

export async function getAccentAiInfo() {
  return fetchJson(`${apiBaseUrl}/api/v1/accent-ai/info`, { method: 'GET' })
}

export async function startAccentAiHost() {
  return fetchJson(`${apiBaseUrl}/api/v1/accent-ai/start`, { method: 'POST' })
}

export async function stopAccentAiHost() {
  return fetchJson(`${apiBaseUrl}/api/v1/accent-ai/stop`, { method: 'POST' })
}

export async function listAudioInputDevices() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return []
  }

  const enumerateAudioInputs = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'audioinput')
  }

  let audioInputs = await enumerateAudioInputs()
  const hasLabels = audioInputs.some((device) => device.label)
  if (hasLabels || !navigator.mediaDevices.getUserMedia) {
    return audioInputs
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((track) => track.stop())
    audioInputs = await enumerateAudioInputs()
  } catch {
    return audioInputs
  }

  return audioInputs
}

export async function findAccentAiVirtualInputDevice() {
  const audioInputs = await listAudioInputDevices()
  const matches = (device, pattern) => pattern.test(`${device.label || ''} ${device.deviceId || ''} ${device.groupId || ''}`)

  return (
    audioInputs.find((device) => matches(device, /accentai[_\s-]?mic/i)) ||
    audioInputs.find((device) => matches(device, /accentai[_\s-]?output/i)) ||
    audioInputs.find((device) => matches(device, /accent[_\s-]?ai/i)) ||
    audioInputs.find((device) => matches(device, /voice.?dsp/i)) ||
    audioInputs.find((device) => matches(device, /remapped monitor of null output/i)) ||
    audioInputs.find((device) => matches(device, /monitor of null output/i)) ||
    audioInputs.find((device) => matches(device, /cable output/i)) ||
    null
  )
}

export async function findSystemInputDevice(options = {}) {
  const { accentAiDevice = null } = options
  const audioInputs = await listAudioInputDevices()
  const isVirtual = (device) =>
    /accentai|accent[_\s-]?ai|monitor of null output|remapped monitor|null output|cable output|voice.?dsp/i.test(
      `${device.label || ''} ${device.deviceId || ''} ${device.groupId || ''}`,
    )
  const isExcludedAccentAiDevice = (device) => {
    if (!accentAiDevice) {
      return false
    }
    if (accentAiDevice.deviceId && device.deviceId && accentAiDevice.deviceId === device.deviceId) {
      return true
    }
    if (accentAiDevice.groupId && device.groupId && accentAiDevice.groupId === device.groupId) {
      return true
    }
    return false
  }

  const candidates = audioInputs.filter((device) => !isVirtual(device) && !isExcludedAccentAiDevice(device))
  const preferredCandidate =
    candidates.find((device) => device.deviceId === 'default') ||
    candidates.find((device) => device.deviceId === 'communications') ||
    candidates.find((device) => /headset|headphone|earphone|earbud|hands-?free|bluetooth/i.test(device.label || '')) ||
    candidates.find((device) => /external|usb|wired/i.test(device.label || '')) ||
    candidates.find((device) => /built-?in|internal|analog|microphone|mic/i.test(device.label || '')) ||
    candidates[0] ||
    null

  return preferredCandidate
}
