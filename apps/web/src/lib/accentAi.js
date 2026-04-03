export const ACCENT_AI_LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
]

export const ACCENT_AI_INPUT_OPTIONS = [
  { value: 'system', label: 'System Mic' },
  { value: 'accentai', label: 'AccentAI Mic' },
]

const httpProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
const configuredApiBaseUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL?.replace(/\/$/, '') : ''
const apiBaseUrl =
  configuredApiBaseUrl || (typeof window !== 'undefined' ? `${httpProtocol}//${window.location.hostname}:8000` : '')

export function getAccentAiWebSocketUrl() {
  if (!apiBaseUrl) {
    return ''
  }

  return `${apiBaseUrl.replace(/^http/i, 'ws')}/api/v1/accent-ai/ws`
}

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

export async function setAccentAiAudioDefaults({ inputLabel, outputLabel }) {
  return fetchJson(`${apiBaseUrl}/api/v1/accent-ai/audio-defaults`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_label: inputLabel,
      output_label: outputLabel,
    }),
  })
}

async function listAudioDevices() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return []
  }

  const enumerateDevices = async () => navigator.mediaDevices.enumerateDevices()

  let devices = await enumerateDevices()
  const audioDevices = devices.filter((device) => device.kind === 'audioinput' || device.kind === 'audiooutput')
  const hasLabels = audioDevices.some((device) => device.label)
  if (hasLabels || !navigator.mediaDevices.getUserMedia) {
    return audioDevices
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach((track) => track.stop())
    devices = await enumerateDevices()
  } catch {
    return audioDevices
  }

  return devices.filter((device) => device.kind === 'audioinput' || device.kind === 'audiooutput')
}

export async function listAudioInputDevices() {
  const devices = await listAudioDevices()
  return devices.filter((device) => device.kind === 'audioinput')
}

export async function listAudioOutputDevices() {
  const devices = await listAudioDevices()
  return devices.filter((device) => device.kind === 'audiooutput')
}

function getDeviceText(device) {
  return `${device.label || ''} ${device.deviceId || ''} ${device.groupId || ''}`
}

function isVirtualAudioDevice(device) {
  return /accentai|accent[_\s-]?ai|monitor of null output|remapped monitor|null output|cable output|voice.?dsp/i.test(
    getDeviceText(device),
  )
}

function sanitizeDeviceLabel(label) {
  return String(label || '')
    .replace(/^(default|communications)\s*-\s*/i, '')
    .replace(/\bmono fallback\b/gi, '')
    .replace(/\banalog stereo\b/gi, 'Audio')
    .replace(/\bstereo\b/gi, '')
    .replace(/\bmono\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDeviceGroupKey(device) {
  if (device.groupId) {
    return `group:${device.groupId}`
  }

  return `label:${sanitizeDeviceLabel(device.label).toLowerCase()}`
}

function classifyAudioProfileKind(label) {
  const normalizedLabel = sanitizeDeviceLabel(label).toLowerCase()
  if (/headset|hands-?free|speakerphone|jabra|plantronics|poly|yealink|sennheiser|logitech zone/i.test(normalizedLabel)) {
    return 'headset'
  }

  if (/earphone|earbud|earpod|airpods|buds|headphone|headset|bluetooth|bluez|neckband|nirvana|boat|oneplus|realme|sony|bose/i.test(normalizedLabel)) {
    return 'earphone'
  }

  if (/built-?in|internal|analog|pci|system/i.test(normalizedLabel)) {
    return 'system'
  }

  return 'external'
}

function getProfilePriority(kind) {
  switch (kind) {
    case 'headset':
      return 1
    case 'earphone':
      return 2
    case 'system':
      return 3
    default:
      return 4
  }
}

function pickSystemInputCandidate(devices) {
  const physicalDevices = devices.filter((device) => !isVirtualAudioDevice(device))
  return (
    physicalDevices.find((device) => /built-?in|internal|analog|microphone|mic/i.test(device.label || '')) ||
    physicalDevices.find((device) => device.deviceId === 'default') ||
    physicalDevices.find((device) => device.deviceId === 'communications') ||
    physicalDevices[0] ||
    null
  )
}

function pickSystemOutputCandidate(devices) {
  const physicalDevices = devices.filter((device) => !isVirtualAudioDevice(device))
  return (
    physicalDevices.find((device) => /built-?in|internal|analog|speaker|output|audio/i.test(device.label || '')) ||
    physicalDevices.find((device) => device.deviceId === 'default') ||
    physicalDevices.find((device) => device.deviceId === 'communications') ||
    physicalDevices[0] ||
    null
  )
}

export async function listPreferredAudioProfiles(options = {}) {
  const { accentAiDevice = null } = options
  const devices = await listAudioDevices()
  const audioInputs = devices.filter((device) => device.kind === 'audioinput')
  const audioOutputs = devices.filter((device) => device.kind === 'audiooutput')
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

  const inputCandidates = audioInputs.filter((device) => !isVirtualAudioDevice(device) && !isExcludedAccentAiDevice(device))
  const outputCandidates = audioOutputs.filter((device) => !isVirtualAudioDevice(device))
  const systemInput = pickSystemInputCandidate(inputCandidates)
  const systemOutput = pickSystemOutputCandidate(outputCandidates)
  const systemGroupKeys = new Set([systemInput, systemOutput].filter(Boolean).map((device) => getDeviceGroupKey(device)))
  const defaultInputFallback = inputCandidates.find((device) => device.deviceId === 'default') || systemInput || null
  const defaultOutputFallback = outputCandidates.find((device) => device.deviceId === 'default') || systemOutput || null

  const groupedProfiles = new Map()

  inputCandidates.forEach((device) => {
    const groupKey = getDeviceGroupKey(device)
    if (systemGroupKeys.has(groupKey)) {
      return
    }
    const profile = groupedProfiles.get(groupKey) || { inputDevice: null, outputDevice: null, groupKey }
    profile.inputDevice = device
    groupedProfiles.set(groupKey, profile)
  })

  outputCandidates.forEach((device) => {
    const groupKey = getDeviceGroupKey(device)
    if (systemGroupKeys.has(groupKey)) {
      return
    }
    const profile = groupedProfiles.get(groupKey) || { inputDevice: null, outputDevice: null, groupKey }
    profile.outputDevice = device
    groupedProfiles.set(groupKey, profile)
  })

  const accessoryProfiles = Array.from(groupedProfiles.values())
    .filter((profile) => profile.inputDevice || profile.outputDevice)
    .map((profile) => {
      const resolvedInputDevice = profile.inputDevice || defaultInputFallback
      const resolvedOutputDevice = profile.outputDevice || defaultOutputFallback
      const displayName = sanitizeDeviceLabel(
        profile.inputDevice?.label || profile.outputDevice?.label || resolvedInputDevice?.label || resolvedOutputDevice?.label || 'Audio device',
      )
      const rawKind = classifyAudioProfileKind(displayName)
      const kind = rawKind === 'external' ? 'earphone' : rawKind
      return {
        id: `${kind}:${profile.groupKey}`,
        kind,
        priority: getProfilePriority(kind),
        label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} - ${displayName}`,
        inputDeviceId: resolvedInputDevice?.deviceId || '',
        inputLabel: resolvedInputDevice?.label || displayName,
        outputDeviceId: resolvedOutputDevice?.deviceId || 'default',
        outputLabel: resolvedOutputDevice?.label || displayName,
        hasNativeInput: Boolean(profile.inputDevice),
        hasNativeOutput: Boolean(profile.outputDevice),
      }
    })
    .filter((profile) => profile.label.toLowerCase() !== 'earphone - default')
    .reduce((profiles, profile) => {
      const dedupeKey = `${profile.kind}:${profile.label.toLowerCase()}`
      const existingIndex = profiles.findIndex((candidate) => `${candidate.kind}:${candidate.label.toLowerCase()}` === dedupeKey)
      if (existingIndex === -1) {
        profiles.push(profile)
        return profiles
      }

      const existing = profiles[existingIndex]
      const existingScore = Number(existing.hasNativeInput) + Number(existing.hasNativeOutput)
      const nextScore = Number(profile.hasNativeInput) + Number(profile.hasNativeOutput)
      if (nextScore > existingScore) {
        profiles[existingIndex] = profile
      }
      return profiles
    }, [])
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label))
    .map(({ hasNativeInput, hasNativeOutput, ...profile }) => profile)

  const profiles = []
  if (systemInput || systemOutput) {
    const displayName = sanitizeDeviceLabel(systemInput?.label || systemOutput?.label || 'Built-in Audio')
    profiles.push({
      id: 'system',
      kind: 'system',
      priority: getProfilePriority('system'),
      label: `System - ${displayName}`,
      inputDeviceId: systemInput?.deviceId || '',
      inputLabel: systemInput?.label || displayName,
      outputDeviceId: systemOutput?.deviceId || 'default',
      outputLabel: systemOutput?.label || displayName,
    })
  }

  return [...accessoryProfiles, ...profiles]
}

export function choosePreferredAudioProfile(profiles, preferredProfileId = '', options = {}) {
  const { preserveSelection = true, autoPromoteHigherPriority = true } = options
  const orderedProfiles = Array.isArray(profiles) ? profiles : []
  const fallbackProfile = orderedProfiles[0] || null

  if (!preserveSelection || !preferredProfileId) {
    return fallbackProfile
  }

  const preferredProfile = orderedProfiles.find((profile) => profile.id === preferredProfileId) || null
  if (!preferredProfile) {
    return fallbackProfile
  }

  if (
    autoPromoteHigherPriority &&
    fallbackProfile &&
    Number.isFinite(fallbackProfile.priority) &&
    Number.isFinite(preferredProfile.priority) &&
    fallbackProfile.priority < preferredProfile.priority
  ) {
    return fallbackProfile
  }

  return preferredProfile
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

  const candidates = audioInputs.filter((device) => !isVirtualAudioDevice(device) && !isExcludedAccentAiDevice(device))
  const labeledPhysicalCandidates = candidates.filter(
    (device) => device.deviceId !== 'default' && device.deviceId !== 'communications' && Boolean(device.label),
  )
  const preferredCandidate =
    candidates.find((device) => device.deviceId === 'default') ||
    candidates.find((device) => device.deviceId === 'communications') ||
    labeledPhysicalCandidates.find((device) => /headset|headphone|earphone|earbud|hands-?free|bluetooth/i.test(device.label || '')) ||
    labeledPhysicalCandidates.find((device) => /external|usb|wired/i.test(device.label || '')) ||
    labeledPhysicalCandidates.find((device) => /built-?in|internal|analog|microphone|mic/i.test(device.label || '')) ||
    candidates[0] ||
    null

  return preferredCandidate
}
