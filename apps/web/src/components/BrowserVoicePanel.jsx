import { useEffect, useRef, useState } from 'react'
import { Web } from 'sip.js'
import {
  ACCENT_AI_INPUT_OPTIONS,
  ACCENT_AI_LANGUAGE_OPTIONS,
  ACCENT_AI_MODE_OPTIONS,
  findAccentAiVirtualInputDevice,
  findSystemInputDevice,
  getAccentAiInfo,
  getAccentAiWebSocketUrl,
  startAccentAiHost,
  stopAccentAiHost,
} from '../lib/accentAi.js'
import { createAccentAiRealtimeStream } from '../lib/accentAiRealtime.js'
import {
  buildBrowserSipTarget,
  getBrowserVoiceConfig,
  isBrowserVoiceConfigured,
  normalizeBrowserDialNumber,
} from '../lib/browserVoiceConfig.js'

function getBrowserTone(status) {
  switch (status) {
    case 'connected':
    case 'ready':
    case 'in-call':
      return 'teal'
    case 'connecting':
    case 'registering':
    case 'dialing':
    case 'disconnecting':
      return 'amber'
    case 'error':
      return 'rose'
    default:
      return 'slate'
  }
}

function getBrowserStatusLabel(status, isRegistered) {
  switch (status) {
    case 'connecting':
      return 'Connecting'
    case 'registering':
      return 'Registering'
    case 'dialing':
      return 'Dialing'
    case 'in-call':
      return 'In call'
    case 'disconnecting':
      return 'Disconnecting'
    case 'error':
      return 'Error'
    case 'connected':
      return isRegistered ? 'Ready' : 'Connected'
    case 'ready':
      return 'Ready'
    default:
      return 'Idle'
  }
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error || 'Unknown browser voice error')
}

function getAccentAiLabel(language) {
  return ACCENT_AI_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label || 'English (US)'
}

function getAccentAiRuntimeLabel(runtime) {
  switch (runtime) {
    case 'ready':
      return 'Ready'
    case 'running':
      return 'Running'
    case 'error':
      return 'Error'
    default:
      return 'Stopped'
  }
}

function getMicSourceLabel(source) {
  return source === 'accentai' ? 'AccentAI Mic' : 'System Mic'
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds | 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function applyOutboundStreamToSession(sessionDescriptionHandler, stream) {
  if (!sessionDescriptionHandler || !stream) {
    return
  }

  if (typeof sessionDescriptionHandler.setLocalMediaStream === 'function') {
    await sessionDescriptionHandler.setLocalMediaStream(stream)
  }

  const peerConnection = sessionDescriptionHandler.peerConnection
  if (!peerConnection) {
    return
  }

  const audioTrack = stream.getAudioTracks()[0] || null
  const videoTrack = stream.getVideoTracks()[0] || null
  const senders = peerConnection.getSenders?.() || []

  await Promise.all(
    senders.map(async (sender) => {
      const kind = sender.track?.kind
      if (kind === 'audio') {
        await sender.replaceTrack(audioTrack)
        return
      }
      if (kind === 'video') {
        await sender.replaceTrack(videoTrack)
      }
    }),
  )
}

export default function BrowserVoicePanel({ defaultDestination = '' }) {
  const browserVoiceConfig = getBrowserVoiceConfig()
  const { aor, authPassword, authUsername, displayName, domain, wsUrl } = browserVoiceConfig
  const audioRef = useRef(null)
  const monitorAudioRef = useRef(null)
  const monitorAudioContextRef = useRef(null)
  const monitorAudioSourceRef = useRef(null)
  const monitorAudioGainRef = useRef(null)
  const simpleUserRef = useRef(null)
  const mountedRef = useRef(false)
  const isRegisteredRef = useRef(false)
  const accentAiSelectedInputRef = useRef('system')
  const accentAiLanguageRef = useRef('en-US')
  const accentAiModeRef = useRef('latency')
  const accentAiMicCleanupRef = useRef(true)
  const accentAiVirtualDeviceIdRef = useRef('')
  const systemInputDeviceIdRef = useRef('')
  const rawLocalStreamRef = useRef(null)
  const outboundLocalStreamRef = useRef(null)
  const accentAiDirectStreamRef = useRef(null)
  const monitorStreamRef = useRef(null)
  const callDialStartedAtRef = useRef(null)
  const [destination, setDestination] = useState(normalizeBrowserDialNumber(defaultDestination))
  const [status, setStatus] = useState('idle')
  const [isRegistered, setIsRegistered] = useState(false)
  const [audioState, setAudioState] = useState('idle')
  const [accentAiSelectedInput, setAccentAiSelectedInput] = useState('system')
  const [accentAiLanguage, setAccentAiLanguage] = useState('en-US')
  const [accentAiMode, setAccentAiMode] = useState('latency')
  const [accentAiMicCleanup, setAccentAiMicCleanup] = useState(true)
  const [accentAiRuntime, setAccentAiRuntime] = useState('stopped')
  const [accentAiBackend, setAccentAiBackend] = useState('AccentAI DSP')
  const [accentAiPipeline, setAccentAiPipeline] = useState('control_only_converted_mic_source')
  const [accentAiControlMode, setAccentAiControlMode] = useState('device-control')
  const [accentAiServiceEnabled, setAccentAiServiceEnabled] = useState(false)
  const [accentAiVirtualDeviceLabel, setAccentAiVirtualDeviceLabel] = useState('')
  const [systemInputDeviceLabel, setSystemInputDeviceLabel] = useState('')
  const [activeInputTrackLabel, setActiveInputTrackLabel] = useState('')
  const [activeCallPath, setActiveCallPath] = useState('Browser default')
  const [accentAiDirectStats, setAccentAiDirectStats] = useState(null)
  const [accentAiDirectFallbackReason, setAccentAiDirectFallbackReason] = useState('')
  const [accentAiHostAudioReady, setAccentAiHostAudioReady] = useState(false)
  const [accentAiDspSampleRate, setAccentAiDspSampleRate] = useState(0)
  const [accentAiPacketSamples, setAccentAiPacketSamples] = useState(0)
  const [callSetupDurationMs, setCallSetupDurationMs] = useState(0)
  const [monitorState, setMonitorState] = useState('idle')
  const [callStartedAt, setCallStartedAt] = useState(null)
  const [callDurationSeconds, setCallDurationSeconds] = useState(0)
  const [message, setMessage] = useState('Browser SIP.js softphone is ready to connect.')

  function prepareAudioElement() {
    const audioElement = audioRef.current
    if (!audioElement) {
      return null
    }

    audioElement.muted = false
    audioElement.volume = 1
    audioElement.autoplay = true
    audioElement.playsInline = true

    return audioElement
  }

  async function syncBrowserOutputDevice() {
    const audioElement = prepareAudioElement()
    if (!audioElement || typeof audioElement.setSinkId !== 'function') {
      return
    }

    try {
      await audioElement.setSinkId('default')
    } catch {
      // Ignore unsupported or blocked sink switching and let the browser use its current default route.
    }
  }

  async function primeAudioOutput({ reportBlocked = false } = {}) {
    const audioElement = prepareAudioElement()
    if (!audioElement) {
      return false
    }

    try {
      await syncBrowserOutputDevice()
      await audioElement.play()
      if (audioElement.srcObject) {
        setAudioState('playing')
      }
      return true
    } catch (error) {
      if (reportBlocked) {
        setAudioState('blocked')
      }
      throw error
    }
  }

  async function ensureRemoteAudioIsPlaying() {
    return primeAudioOutput({ reportBlocked: true })
  }

  function prepareMonitorAudioElement() {
    const audioElement = monitorAudioRef.current
    if (!audioElement) {
      return null
    }

    audioElement.muted = false
    audioElement.volume = 1
    audioElement.autoplay = true
    audioElement.playsInline = true

    return audioElement
  }

  function stopMicMonitor({ resetState = true } = {}) {
    const audioElement = monitorAudioRef.current
    const monitorStream = monitorStreamRef.current
    const monitorSourceNode = monitorAudioSourceRef.current
    const monitorGainNode = monitorAudioGainRef.current
    const monitorAudioContext = monitorAudioContextRef.current

    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
    }

    if (monitorSourceNode) {
      monitorSourceNode.disconnect()
      monitorAudioSourceRef.current = null
    }

    if (monitorGainNode) {
      monitorGainNode.disconnect()
      monitorAudioGainRef.current = null
    }

    if (monitorAudioContext) {
      monitorAudioContext.close().catch(() => {})
      monitorAudioContextRef.current = null
    }

    if (monitorStream) {
      monitorStream.getTracks().forEach((track) => track.stop())
      monitorStreamRef.current = null
    }

    if (mountedRef.current) {
      setActiveInputTrackLabel('')
    }

    if (resetState && mountedRef.current) {
      setMonitorState('idle')
    }
  }

  async function stopAccentAiDirectStream({ clearFallbackReason = false } = {}) {
    const directStream = accentAiDirectStreamRef.current
    accentAiDirectStreamRef.current = null
    setAccentAiDirectStats(null)
    if (clearFallbackReason) {
      setAccentAiDirectFallbackReason('')
    }
    if (!directStream) {
      return
    }
    await directStream.stop().catch(() => {})
  }

  async function cleanupPreviousInputPipeline(previousDirectStream, previousRawStream, previousOutboundStream) {
    if (previousDirectStream) {
      await previousDirectStream.stop().catch(() => {})
      return
    }

    if (previousRawStream) {
      previousRawStream.getTracks?.().forEach((track) => track.stop())
    }

    if (previousOutboundStream && previousOutboundStream !== previousRawStream) {
      previousOutboundStream.getTracks?.().forEach((track) => track.stop())
    }
  }

  function buildAccentAiDirectInputConstraints({ systemDeviceId = systemInputDeviceIdRef.current } = {}) {
    const constraints = {
      channelCount: 1,
      sampleRate: accentAiDspSampleRate || 16000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }

    if (systemDeviceId) {
      constraints.deviceId = { exact: systemDeviceId }
    }

    return constraints
  }

  async function createAccentAiDirectCallStream(options = {}) {
    const systemDeviceId = options.systemDeviceId ?? systemInputDeviceIdRef.current
    const info = options.info || (await ensureAccentAiReady())
    const packetSamples = Number(info?.dsp_packet_samples || accentAiPacketSamples || 512)
    const sampleRate = Number(info?.dsp_sample_rate || accentAiDspSampleRate || 16000)
    const websocketUrl = getAccentAiWebSocketUrl()

    if (!websocketUrl) {
      throw new Error('AccentAI realtime WebSocket URL is not available.')
    }

    const directStream = await createAccentAiRealtimeStream({
      websocketUrl,
      sampleRate,
      packetSamples,
      audioConstraints: buildAccentAiDirectInputConstraints({ systemDeviceId }),
      onFatalError: (error) => {
        if (!mountedRef.current || accentAiSelectedInputRef.current !== 'accentai') {
          return
        }

        setAccentAiRuntime('error')
        setAccentAiDirectStats(null)
        const fallbackReason = formatError(error)
        setAccentAiDirectFallbackReason(fallbackReason)
        setMessage(`AccentAI direct stream failed, falling back to the virtual mic: ${fallbackReason}`)
        void applyAccentAiToLiveCall('accentai', {
          preferDirect: false,
          fallbackReason,
        })
      },
    })

    setAccentAiDirectStats(directStream.getStats())
    return directStream
  }

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      const simpleUser = simpleUserRef.current
      simpleUserRef.current = null

      if (!simpleUser) {
        return
      }

      Promise.resolve()
        .then(() => simpleUser.hangup().catch(() => {}))
        .then(() => simpleUser.unregister().catch(() => {}))
        .then(() => simpleUser.disconnect().catch(() => {}))
        .then(() => stopAccentAiDirectStream().catch(() => {}))
        .catch(() => {})

      stopMicMonitor({ resetState: false })
    }
  }, [])

  useEffect(() => {
    isRegisteredRef.current = isRegistered
  }, [isRegistered])

  useEffect(() => {
    accentAiSelectedInputRef.current = accentAiSelectedInput
    if (accentAiSelectedInput !== 'accentai') {
      setAccentAiRuntime('stopped')
    } else if (accentAiRuntime === 'stopped') {
      setAccentAiRuntime('ready')
    }
  }, [accentAiSelectedInput, accentAiRuntime])

  useEffect(() => {
    accentAiLanguageRef.current = accentAiLanguage
  }, [accentAiLanguage])

  useEffect(() => {
    accentAiModeRef.current = accentAiMode
  }, [accentAiMode])

  useEffect(() => {
    accentAiMicCleanupRef.current = accentAiMicCleanup
  }, [accentAiMicCleanup])

  useEffect(() => {
    if (!callStartedAt) {
      setCallDurationSeconds(0)
      return undefined
    }

    setCallDurationSeconds(Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)))
    const intervalId = window.setInterval(() => {
      setCallDurationSeconds(Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)))
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [callStartedAt])

  function buildAccentAiAudioConstraints({
    inputSource = accentAiSelectedInputRef.current,
    virtualDeviceId = accentAiVirtualDeviceIdRef.current,
    systemDeviceId = systemInputDeviceIdRef.current,
  } = {}) {
    if (inputSource === 'accentai' && virtualDeviceId) {
      return {
        deviceId: { exact: virtualDeviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      }
    }

    if (inputSource === 'system' && systemDeviceId) {
      return {
        deviceId: { exact: systemDeviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
    }

    if (!accentAiMicCleanupRef.current) {
      return { channelCount: 1 }
    }

    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    }
  }

  async function resolveAccentAiVirtualDevice() {
    const device = await findAccentAiVirtualInputDevice()
    accentAiVirtualDeviceIdRef.current = device?.deviceId || ''
    setAccentAiVirtualDeviceLabel(device?.label || '')
    return device
  }

  async function waitForAccentAiVirtualDevice() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const device = await resolveAccentAiVirtualDevice().catch(() => null)
      if (device) {
        return device
      }
      await delay(300)
    }
    return null
  }

  async function resolveSystemInputDevice() {
    const accentAiDevice =
      accentAiVirtualDeviceIdRef.current || accentAiVirtualDeviceLabel ? await findAccentAiVirtualInputDevice().catch(() => null) : null
    const device = await findSystemInputDevice({ accentAiDevice })
    systemInputDeviceIdRef.current = device?.deviceId || ''
    setSystemInputDeviceLabel(device?.label || '')
    return device
  }

  useEffect(() => {
    setDestination(normalizeBrowserDialNumber(defaultDestination))
  }, [defaultDestination])

  useEffect(() => {
    getAccentAiInfo()
      .then((info) => {
        if (!mountedRef.current) {
          return
        }
        setAccentAiControlMode(String(info?.control_mode || 'device-control'))
        setAccentAiServiceEnabled(false)
        setAccentAiBackend(String(info?.backend || 'accentai-dsp').replace(/-/g, ' '))
        setAccentAiPipeline(String(info?.pipeline || 'control_only_converted_mic_source'))
        setAccentAiHostAudioReady(Boolean(info?.host_audio_ready))
        setAccentAiDspSampleRate(Number(info?.dsp_sample_rate || 0))
        setAccentAiPacketSamples(Number(info?.dsp_packet_samples || 0))
        setAccentAiRuntime('stopped')
        resolveAccentAiVirtualDevice().catch(() => {})
        resolveSystemInputDevice().catch(() => {})
        stopAccentAiHost().catch(() => {})
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
      return undefined
    }

    const handleDeviceChange = () => {
      void resolveSystemInputDevice().catch(() => {})
      void resolveAccentAiVirtualDevice().catch(() => {})
      void syncBrowserOutputDevice().catch(() => {})
    }

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [])

  useEffect(() => {
    if (!audioRef.current || simpleUserRef.current) {
      return undefined
    }

    if (!isBrowserVoiceConfigured(browserVoiceConfig)) {
      setStatus('error')
      setMessage('Browser SIP.js configuration is incomplete.')
      return undefined
    }

    const baseMediaStreamFactory = Web.defaultMediaStreamFactory()
    const accentAiMediaStreamFactory = async (constraints, sessionDescriptionHandler, options) => {
      const nextConstraints = {
        ...(constraints || {}),
        audio: constraints?.audio ? buildAccentAiAudioConstraints() : constraints?.audio,
      }
      const previousDirectStream = accentAiDirectStreamRef.current
      const previousRawStream = rawLocalStreamRef.current
      const previousOutboundStream = outboundLocalStreamRef.current
      const preferDirectForAccentAi = accentAiModeRef.current !== 'clarity'

      if (accentAiSelectedInputRef.current === 'accentai' && constraints?.audio && preferDirectForAccentAi) {
        const info = await ensureAccentAiReady()
        await resolveSystemInputDevice().catch(() => null)

        try {
          const directStream = await createAccentAiDirectCallStream({
            info,
            systemDeviceId: systemInputDeviceIdRef.current,
          })

          accentAiDirectStreamRef.current = directStream
          rawLocalStreamRef.current = directStream.rawStream
          outboundLocalStreamRef.current = directStream.stream
          setActiveInputTrackLabel(directStream.inputTrackLabel || systemInputDeviceLabel || '')
          setAccentAiRuntime('running')
          setActiveCallPath('AccentAI direct stream')
          setAccentAiDirectFallbackReason('')
          await cleanupPreviousInputPipeline(previousDirectStream, previousRawStream, previousOutboundStream)
          return directStream.stream
        } catch (error) {
          const fallbackReason = formatError(error)
          setAccentAiDirectFallbackReason(fallbackReason)
          setMessage(`AccentAI direct stream unavailable, falling back to the virtual mic: ${fallbackReason}`)
          await waitForAccentAiVirtualDevice().catch(() => null)
        }
      }

      const stream = await baseMediaStreamFactory(nextConstraints, sessionDescriptionHandler, options)
      const inputTrack = stream.getAudioTracks?.()[0] || null
      await stopAccentAiDirectStream()
      rawLocalStreamRef.current = stream
      outboundLocalStreamRef.current = stream
      setActiveInputTrackLabel(inputTrack?.label || '')

      if (accentAiSelectedInputRef.current !== 'accentai' || !constraints?.audio) {
        setActiveCallPath('Browser default')
        if (mountedRef.current) {
          setAccentAiRuntime(accentAiSelectedInputRef.current === 'accentai' ? 'ready' : 'stopped')
        }
        await cleanupPreviousInputPipeline(previousDirectStream, previousRawStream, previousOutboundStream)
        return stream
      }

      if (mountedRef.current) {
        setAccentAiRuntime('running')
        setActiveCallPath(preferDirectForAccentAi ? 'AccentAI virtual mic (fallback)' : 'AccentAI virtual mic (clarity mode)')
      }

      await cleanupPreviousInputPipeline(previousDirectStream, previousRawStream, previousOutboundStream)
      return stream
    }

    const simpleUser = new Web.SimpleUser(wsUrl, {
      aor,
      delegate: {
        onCallAnswered() {
          if (!mountedRef.current) {
            return
          }

          stopMicMonitor()
          setStatus('in-call')
          setCallSetupDurationMs(callDialStartedAtRef.current ? Math.max(0, Date.now() - callDialStartedAtRef.current) : 0)
          setMessage('Call answered. Starting browser audio...')
          ensureRemoteAudioIsPlaying()
            .then(() => {
              if (mountedRef.current) {
                const localAudioTracks = simpleUser.localMediaStream?.getAudioTracks?.() || []
                if (!localAudioTracks.length) {
                  setMessage(
                    'Call answered, but no local microphone track was detected. Check microphone permissions and browser capture settings.',
                  )
                  return
                }

                const liveTrack = localAudioTracks.find((track) => track.enabled && track.readyState === 'live' && !track.muted)
                if (!liveTrack) {
                  setMessage(
                    'Call answered, but the local microphone track is not live. Check whether the browser microphone is muted or blocked.',
                  )
                  return
                }

                setMessage('Call answered. Browser audio is active and the local microphone track is live.')
              }
            })
            .catch((error) => {
              if (!mountedRef.current) {
                return
              }

              setStatus('error')
              setMessage(
                `Call answered, but browser audio could not start: ${formatError(error)}. Click Enable audio or check speaker permissions.`,
              )
            })
        },
        onCallCreated() {
          if (!mountedRef.current) {
            return
          }

          setCallStartedAt(Date.now())
          setStatus('dialing')
          setMessage('Call created. Waiting for Asterisk to answer.')
        },
        onCallHangup() {
          if (!mountedRef.current) {
            return
          }

          rawLocalStreamRef.current = null
          outboundLocalStreamRef.current = null
          void stopAccentAiDirectStream({ clearFallbackReason: true }).catch(() => {})
          callDialStartedAtRef.current = null
          setCallStartedAt(null)
          setCallSetupDurationMs(0)
          setCallDurationSeconds(0)
          setActiveCallPath(accentAiSelectedInputRef.current === 'accentai' ? 'AccentAI virtual mic' : 'Browser default')
          setStatus(isRegisteredRef.current ? 'ready' : simpleUserRef.current?.isConnected() ? 'connected' : 'idle')
          setAccentAiRuntime(accentAiSelectedInputRef.current === 'accentai' ? 'ready' : 'stopped')
          setMessage('Browser call ended.')
        },
        onRegistered() {
          if (!mountedRef.current) {
            return
          }

          isRegisteredRef.current = true
          setIsRegistered(true)
          setStatus('ready')
          setMessage('Browser endpoint registered with Asterisk.')
        },
        onUnregistered() {
          if (!mountedRef.current) {
            return
          }

          isRegisteredRef.current = false
          setIsRegistered(false)
          setStatus(simpleUserRef.current?.isConnected() ? 'connected' : 'idle')
          setMessage('Browser endpoint unregistered.')
        },
        onServerConnect() {
          if (!mountedRef.current) {
            return
          }

          setStatus(isRegisteredRef.current ? 'ready' : 'connected')
          setMessage('Connected to the SIP WebSocket transport.')
        },
        onServerDisconnect(error) {
          if (!mountedRef.current) {
            return
          }

          isRegisteredRef.current = false
          setIsRegistered(false)
          setStatus(error ? 'error' : 'idle')
          setMessage(error ? `Browser SIP transport disconnected: ${formatError(error)}` : 'Browser SIP transport disconnected.')
        },
      },
      media: {
        constraints: { audio: true, video: false },
        remote: {
          audio: audioRef.current,
        },
      },
      userAgentOptions: {
        authorizationPassword: authPassword,
        authorizationUsername: authUsername,
        displayName,
        sessionDescriptionHandlerFactory: Web.defaultSessionDescriptionHandlerFactory(accentAiMediaStreamFactory),
      },
    })

    simpleUserRef.current = simpleUser
    return () => {
      simpleUserRef.current = null
    }
  }, [aor, authPassword, authUsername, displayName, wsUrl])

  async function applyAccentAiToLiveCall(nextInputSource, options = {}) {
    const simpleUser = simpleUserRef.current
    const session = simpleUser?.session
    const sessionDescriptionHandler = session?.sessionDescriptionHandler
    const rawLocalStream = rawLocalStreamRef.current
    const nextVirtualDeviceId = options.virtualDeviceId ?? accentAiVirtualDeviceIdRef.current
    const nextSystemDeviceId = options.systemDeviceId ?? systemInputDeviceIdRef.current
    const preferDirect = options.preferDirect ?? (accentAiModeRef.current !== 'clarity')

    if (!sessionDescriptionHandler || !rawLocalStream) {
      setAccentAiRuntime(nextInputSource === 'accentai' ? 'ready' : 'stopped')
      return
    }

    try {
      const previousDirectStream = accentAiDirectStreamRef.current
      const previousRawStream = rawLocalStreamRef.current
      const previousOutboundStream = outboundLocalStreamRef.current

      if (nextInputSource === 'accentai' && preferDirect) {
        try {
          const info = await ensureAccentAiReady()
          const directStream = await createAccentAiDirectCallStream({
            info,
            systemDeviceId: nextSystemDeviceId,
          })
          const nextTrack = directStream.stream.getAudioTracks()[0] || null
          accentAiDirectStreamRef.current = directStream
          rawLocalStreamRef.current = directStream.rawStream
          outboundLocalStreamRef.current = directStream.stream
          setActiveInputTrackLabel(directStream.inputTrackLabel || nextTrack?.label || systemInputDeviceLabel || '')
          setAccentAiRuntime('running')
          setActiveCallPath('AccentAI direct stream')
          setAccentAiDirectFallbackReason('')
          await applyOutboundStreamToSession(sessionDescriptionHandler, directStream.stream)
          await cleanupPreviousInputPipeline(previousDirectStream, previousRawStream, previousOutboundStream)
          setMessage('The browser call is using the direct AccentAI processed audio stream.')
          return
        } catch (directError) {
          const fallbackReason = formatError(directError)
          setAccentAiDirectFallbackReason(fallbackReason)
          setMessage(`AccentAI direct stream unavailable, falling back to the virtual mic: ${fallbackReason}`)
        }
      }

      const nextInputStream = await navigator.mediaDevices.getUserMedia({
        audio: buildAccentAiAudioConstraints({
          inputSource: nextInputSource,
          virtualDeviceId: nextVirtualDeviceId,
          systemDeviceId: nextSystemDeviceId,
        }),
        video: false,
      })
      const nextTrack = nextInputStream.getAudioTracks()[0] || null
      await stopAccentAiDirectStream()
      setActiveInputTrackLabel(nextTrack?.label || '')
      setAccentAiRuntime(nextInputSource === 'accentai' ? 'running' : 'stopped')
      setActiveCallPath(
        nextInputSource === 'accentai'
          ? preferDirect
            ? 'AccentAI virtual mic (fallback)'
            : 'AccentAI virtual mic (clarity mode)'
          : 'Browser default',
      )
      rawLocalStreamRef.current?.getTracks?.().forEach((track) => track.stop())
      rawLocalStreamRef.current = nextInputStream
      outboundLocalStreamRef.current = nextInputStream
      await applyOutboundStreamToSession(sessionDescriptionHandler, nextInputStream)
      setAccentAiRuntime(nextInputSource === 'accentai' ? 'running' : 'stopped')
      setMessage(
        nextInputSource === 'accentai'
          ? `The browser call is using the AccentAI virtual microphone source${options.fallbackReason ? ` after a direct-stream fallback (${options.fallbackReason}).` : '.'}`
          : 'The browser call is using the system microphone.',
      )
    } catch (error) {
      setAccentAiRuntime('error')
      setMessage(`Microphone source could not be updated for the live browser call: ${formatError(error)}`)
    }
  }

  async function handleAccentAiInputChange(nextInputSource) {
    try {
      const shouldRestartMonitor = monitorState === 'active'
      stopMicMonitor()

      let accentAiDevice = null
      let systemDevice = null
      if (nextInputSource === 'accentai') {
        const info = await ensureAccentAiReady()
        if (!info?.host_pipeline_running) {
          throw new Error('AccentAI host service is not running.')
        }
        accentAiDevice = await waitForAccentAiVirtualDevice()
        if (!accentAiDevice) {
          throw new Error('AccentAI microphone source is not visible to the browser yet.')
        }
      } else {
        await stopAccentAiHost().catch(() => {})
        setAccentAiServiceEnabled(false)
        setAccentAiRuntime('stopped')
        systemDevice = await resolveSystemInputDevice()
      }

      accentAiSelectedInputRef.current = nextInputSource
      setAccentAiSelectedInput(nextInputSource)
      if (nextInputSource !== 'accentai') {
        accentAiVirtualDeviceIdRef.current = ''
        setAccentAiVirtualDeviceLabel('')
      }

      await applyAccentAiToLiveCall(nextInputSource, {
        virtualDeviceId: accentAiDevice?.deviceId || accentAiVirtualDeviceIdRef.current,
        systemDeviceId: systemDevice?.deviceId || systemInputDeviceIdRef.current,
      })

      if (!rawLocalStreamRef.current) {
        setMessage(
          nextInputSource === 'accentai'
            ? `New calls will use ${accentAiDevice?.label || accentAiVirtualDeviceLabel || 'the AccentAI microphone source'}.`
            : 'New calls will use the system microphone.',
        )
      }

      if (shouldRestartMonitor) {
        await startMicMonitor()
      }
    } catch (error) {
      setAccentAiRuntime('error')
      setAccentAiSelectedInput('system')
      setMessage(`Microphone source could not be changed: ${formatError(error)}`)
    }
  }

  async function handleAccentAiLanguageChange(nextLanguage) {
    setAccentAiLanguage(nextLanguage)

    if (accentAiSelectedInputRef.current !== 'accentai') {
      return
    }

    await applyAccentAiToLiveCall('accentai')
  }

  async function handleAccentAiModeChange(nextMode) {
    setAccentAiMode(nextMode)

    if (accentAiSelectedInputRef.current === 'accentai') {
      setAccentAiRuntime('ready')
      await applyAccentAiToLiveCall('accentai')
      setMessage(
        nextMode === 'clarity'
          ? 'Accent mode set to Clarity. AccentAI calls will prefer the virtual mic path for better quality.'
          : 'Accent mode set to Latency. AccentAI calls will prefer the direct low-latency path.',
      )
    }
  }

  async function handleAccentAiMicCleanupToggle() {
    const nextValue = !accentAiMicCleanupRef.current
    setAccentAiMicCleanup(nextValue)

    if (accentAiSelectedInputRef.current === 'accentai') {
      setAccentAiRuntime('ready')
      await applyAccentAiToLiveCall('accentai')
    }
  }

  async function startMicMonitor() {
    setMonitorState('starting')

    if (accentAiSelectedInputRef.current === 'accentai') {
      const info = await ensureAccentAiReady()
      if (!info?.host_pipeline_running) {
        throw new Error('AccentAI host service is not running.')
      }
      const device = await waitForAccentAiVirtualDevice()
      if (!device) {
        throw new Error('AccentAI microphone source is not visible to the browser yet.')
      }
    } else {
      await resolveSystemInputDevice()
    }

    stopMicMonitor({ resetState: false })

    const monitorStream = await navigator.mediaDevices.getUserMedia({
      audio: buildAccentAiAudioConstraints(),
      video: false,
    })
    const monitorTrack = monitorStream.getAudioTracks()[0] || null
    const audioContext = new window.AudioContext()
    const sourceNode = audioContext.createMediaStreamSource(monitorStream)
    const gainNode = audioContext.createGain()
    gainNode.gain.value = accentAiSelectedInputRef.current === 'accentai' ? 0.9 : 0.2
    sourceNode.connect(gainNode)
    gainNode.connect(audioContext.destination)
    await audioContext.resume()

    const audioElement = prepareMonitorAudioElement()
    if (audioElement) {
      audioElement.srcObject = monitorStream
    }

    monitorStreamRef.current = monitorStream
    monitorAudioContextRef.current = audioContext
    monitorAudioSourceRef.current = sourceNode
    monitorAudioGainRef.current = gainNode
    setActiveInputTrackLabel(monitorTrack?.label || '')
    setMonitorState('active')
    setMessage(
      `${getMicSourceLabel(accentAiSelectedInputRef.current)} test is live. You should hear your voice through the speakers. Use headphones if you hear feedback.`,
    )
  }

  async function handleMicMonitorToggle() {
    if (monitorState === 'active') {
      stopMicMonitor()
      setMessage(`Stopped mic test for ${getMicSourceLabel(accentAiSelectedInputRef.current)}.`)
      return
    }

    try {
      await startMicMonitor()
    } catch (error) {
      stopMicMonitor({ resetState: false })
      setMonitorState('error')
      setMessage(`Mic test could not start: ${formatError(error)}`)
    }
  }

  async function ensureAccentAiReady() {
    const info = await getAccentAiInfo()
    if (!info?.ready) {
      throw new Error('AccentAI DSP backend is not ready. Install the AccentAI engine assets first.')
    }
    if (!info?.host_pipeline_running) {
      await startAccentAiHost()
    }
    const refreshedInfo = await getAccentAiInfo()
    setAccentAiControlMode(String(refreshedInfo?.control_mode || 'device-control'))
    setAccentAiServiceEnabled(Boolean(refreshedInfo?.host_pipeline_running))
    setAccentAiBackend(String(refreshedInfo?.backend || 'accentai-dsp').replace(/-/g, ' '))
    setAccentAiPipeline(String(refreshedInfo?.pipeline || 'control_only_converted_mic_source'))
    setAccentAiHostAudioReady(Boolean(refreshedInfo?.host_audio_ready))
    setAccentAiDspSampleRate(Number(refreshedInfo?.dsp_sample_rate || 0))
    setAccentAiPacketSamples(Number(refreshedInfo?.dsp_packet_samples || 0))
    await resolveAccentAiVirtualDevice().catch(() => null)
    return refreshedInfo
  }

  async function handleConnect() {
    const simpleUser = simpleUserRef.current
    if (!simpleUser) {
      setStatus('error')
      setMessage('Browser SIP.js softphone is not initialized.')
      return
    }

    try {
      if (accentAiSelectedInputRef.current === 'system') {
        await resolveSystemInputDevice().catch(() => null)
      }

      setStatus('connecting')
      setMessage('Connecting to the SIP WebSocket transport...')
      if (!simpleUser.isConnected()) {
        await simpleUser.connect()
      }
      void primeAudioOutput({ reportBlocked: false }).catch(() => {})
      setStatus(isRegisteredRef.current ? 'ready' : 'connected')
      setMessage('Transport connected. You can register or place a call.')
    } catch (error) {
      setStatus('error')
      setMessage(`Could not connect the browser SIP transport: ${formatError(error)}`)
    }
  }

  async function handleRegister() {
    const simpleUser = simpleUserRef.current
    if (!simpleUser) {
      setStatus('error')
      setMessage('Browser SIP.js softphone is not initialized.')
      return
    }

    try {
      if (accentAiSelectedInputRef.current === 'system') {
        await resolveSystemInputDevice().catch(() => null)
      }

      if (!simpleUser.isConnected()) {
        setStatus('connecting')
        setMessage('Connecting to the SIP WebSocket transport...')
        await simpleUser.connect()
      }
      void primeAudioOutput({ reportBlocked: false }).catch(() => {})

      setStatus('registering')
      setMessage('Sending REGISTER for the browser endpoint...')
      await simpleUser.register()
      setMessage('REGISTER request sent. Waiting for Asterisk to confirm the endpoint.')
    } catch (error) {
      setStatus('error')
      setMessage(`Could not register the browser endpoint: ${formatError(error)}`)
    }
  }

  async function handleCall() {
    const simpleUser = simpleUserRef.current
    if (!simpleUser) {
      setStatus('error')
      setMessage('Browser SIP.js softphone is not initialized.')
      return
    }

    if (status === 'dialing' || status === 'in-call') {
      await handleHangup()
      return
    }

    const target = buildBrowserSipTarget(destination, domain)
    if (!target) {
      setStatus('error')
      setMessage('Enter a destination number for the browser call.')
      return
    }

    try {
      stopMicMonitor()

      if (accentAiSelectedInputRef.current === 'system') {
        await resolveSystemInputDevice().catch(() => null)
      }

      if (!simpleUser.isConnected()) {
        setStatus('connecting')
        setMessage('Connecting to the SIP WebSocket transport...')
        await simpleUser.connect()
      }
      void primeAudioOutput({ reportBlocked: false }).catch(() => {})

      setStatus('dialing')
      callDialStartedAtRef.current = Date.now()
      setCallSetupDurationMs(0)
      setActiveCallPath(accentAiSelectedInputRef.current === 'accentai' ? 'AccentAI virtual mic' : 'Browser default')
      setMessage(`Dialing ${target} through Asterisk...`)
      await simpleUser.call(target)
    } catch (error) {
      setStatus('error')
      setMessage(`Browser call failed: ${formatError(error)}`)
    }
  }

  async function handleHangup() {
    const simpleUser = simpleUserRef.current
    if (!simpleUser) {
      return
    }

    try {
      setMessage('Ending the active browser call...')
      await simpleUser.hangup()
      callDialStartedAtRef.current = null
      setCallStartedAt(null)
      setCallSetupDurationMs(0)
      setCallDurationSeconds(0)
      setAudioState('idle')
    } catch (error) {
      setStatus('error')
      setMessage(`Could not hang up the browser call: ${formatError(error)}`)
    }
  }

  async function handleDisconnect() {
    const simpleUser = simpleUserRef.current
    if (!simpleUser) {
      return
    }

    try {
      setStatus('disconnecting')
      setMessage('Disconnecting the browser endpoint...')
      await simpleUser.hangup().catch(() => {})
      await simpleUser.unregister().catch(() => {})
      await simpleUser.disconnect()

      if (mountedRef.current) {
        isRegisteredRef.current = false
        setIsRegistered(false)
        setAudioState('idle')
        void stopAccentAiDirectStream({ clearFallbackReason: true }).catch(() => {})
        callDialStartedAtRef.current = null
        setCallStartedAt(null)
        setCallSetupDurationMs(0)
        setCallDurationSeconds(0)
        setStatus('idle')
        setMessage('Browser endpoint disconnected.')
      }
    } catch (error) {
      setStatus('error')
      setMessage(`Could not disconnect the browser endpoint: ${formatError(error)}`)
    }
  }

  const browserTarget = buildBrowserSipTarget(destination, domain)
  const statusTone = getBrowserTone(status)
  const statusLabel = getBrowserStatusLabel(status, isRegistered)
  const configured = isBrowserVoiceConfigured(browserVoiceConfig)
  const callButtonLabel = status === 'dialing' || status === 'in-call' ? 'Stop call' : 'Call from browser'
  const micMonitorButtonLabel =
    monitorState === 'starting' ? 'Starting test...' : monitorState === 'active' ? 'Stop test' : 'Test mic'
  const accentAiControls = (
    <div className="browser-voice-panel__accent-ai-inline browser-voice-panel__accent-ai-inline--sidebar">
      <div className="browser-voice-panel__accent-ai-inline-controls">
        <select
          className="browser-voice-panel__input browser-voice-panel__accent-ai-select"
          value={accentAiSelectedInput}
          onFocus={() => {
            void resolveAccentAiVirtualDevice().catch(() => {})
          }}
          onChange={(event) => handleAccentAiInputChange(event.target.value)}
        >
          {ACCENT_AI_INPUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="browser-voice-panel__input browser-voice-panel__accent-ai-select"
          value={accentAiLanguage}
          onChange={(event) => handleAccentAiLanguageChange(event.target.value)}
        >
          {ACCENT_AI_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="browser-voice-panel__input browser-voice-panel__accent-ai-select"
          value={accentAiMode}
          onChange={(event) => handleAccentAiModeChange(event.target.value)}
        >
          {ACCENT_AI_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="secondary-button browser-voice-panel__accent-ai-button"
        onClick={handleMicMonitorToggle}
        disabled={monitorState === 'starting'}
      >
        {micMonitorButtonLabel}
      </button>
      <label className="browser-voice-panel__accent-ai-toggle">
        <input type="checkbox" checked={accentAiMicCleanup} onChange={handleAccentAiMicCleanupToggle} />
        <span>Mic cleanup</span>
      </label>
      <div className="browser-voice-panel__meta-row">
        <span>Mic test</span>
        <strong>{monitorState === 'active' ? 'Listening' : monitorState === 'starting' ? 'Starting' : 'Stopped'}</strong>
      </div>
      <div className="browser-voice-panel__meta-row">
        <span>Pipeline</span>
        <strong>{accentAiPipeline}</strong>
      </div>
      <div className="browser-voice-panel__meta-row">
        <span>Control</span>
        <strong>{accentAiControlMode}</strong>
      </div>
    </div>
  )

  return (
    <div className="browser-voice-panel">
      <div className="browser-voice-panel__main">
        <div className="browser-voice-panel__header">
          <div>
            <p className="browser-voice-panel__eyebrow">Browser SIP/WebRTC</p>
            <h4 className="browser-voice-panel__title">Live browser softphone</h4>
          </div>
          <span className={`status-pill status-pill--${statusTone}`}>{statusLabel}</span>
        </div>

        <p className="browser-voice-panel__description">
          Register the browser as a SIP endpoint, then place an audio call from this tab through Asterisk and the outbound trunk.
        </p>

        <div className="browser-voice-panel__controls">
          <label className="browser-voice-panel__field">
            <span className="browser-voice-panel__label">Destination</span>
            <input
              className="browser-voice-panel__input"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="919900000001"
            />
          </label>

          <div className="browser-voice-panel__preview">
            <span className="browser-voice-panel__label">Dial target</span>
            <p className="browser-voice-panel__preview-value">{browserTarget || 'sip:number@domain'}</p>
          </div>
        </div>

        <div className="browser-voice-panel__actions">
          <button type="button" className="secondary-button" onClick={handleConnect}>
            Connect
          </button>
          <button type="button" className="secondary-button" onClick={handleRegister}>
            Register
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              primeAudioOutput({ reportBlocked: true }).catch((error) => {
                setStatus('error')
                setMessage(`Audio output is blocked: ${formatError(error)}. Try clicking Enable audio during a call.`)
              })
            }
          >
            Enable audio
          </button>
          <button type="button" className="primary-button" onClick={handleCall} disabled={!browserTarget || !configured}>
            {callButtonLabel}
          </button>
          <button type="button" className="secondary-button secondary-button--dark" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>

        {(status === 'dialing' || status === 'in-call') && (
          <p className="browser-voice-panel__message">Call time: {formatDuration(callDurationSeconds)}</p>
        )}
        <p className={`browser-voice-panel__message${status === 'error' ? ' browser-voice-panel__message--error' : ''}`}>{message}</p>
      </div>

      <div className="browser-voice-panel__aside">
        <div className="browser-voice-panel__accent-ai-card">{accentAiControls}</div>

        <div className="browser-voice-panel__summary">
          <p className="browser-voice-panel__summary-label">Session details</p>
          <div className="browser-voice-panel__summary-row">
            <span>WebSocket</span>
            <strong>{wsUrl}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>AOR</span>
            <strong>{aor}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Auth user</span>
            <strong>{authUsername}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Domain</span>
            <strong>{domain}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Configured</span>
            <strong>{configured ? 'Yes' : 'No'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Speaker</span>
            <strong>{audioState === 'playing' ? 'Playing' : audioState === 'blocked' ? 'Needs unlock' : 'Idle'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Call time</span>
            <strong>{callStartedAt ? formatDuration(callDurationSeconds) : '00:00'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Call path</span>
            <strong>{activeCallPath}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Answer delay</span>
            <strong>{callSetupDurationMs > 0 ? `${(callSetupDurationMs / 1000).toFixed(1)}s` : 'Waiting for answer'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>AccentAI</span>
            <strong>{getAccentAiRuntimeLabel(accentAiRuntime)}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Service</span>
            <strong>{accentAiServiceEnabled ? 'Running' : 'Stopped'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Mic source</span>
            <strong>{accentAiSelectedInput === 'accentai' ? (accentAiVirtualDeviceLabel || 'AccentAI Mic') : 'System microphone'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>System device</span>
            <strong>{systemInputDeviceLabel || 'Waiting for browser device'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Active track</span>
            <strong>{activeInputTrackLabel || 'No active capture yet'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Backend</span>
            <strong>{accentAiBackend}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Host audio</span>
            <strong>{accentAiHostAudioReady ? 'Ready' : 'Not ready'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>DSP rate</span>
            <strong>{accentAiDspSampleRate ? `${accentAiDspSampleRate} Hz` : 'Unknown'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>DSP packet</span>
            <strong>{accentAiPacketSamples ? `${accentAiPacketSamples} samples` : 'Unknown'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Direct stats</span>
            <strong>
              {accentAiDirectStats
                ? `in-flight ${accentAiDirectStats.inFlightPackets}, dropped ${accentAiDirectStats.queuedPacketsDropped}, underruns ${accentAiDirectStats.playbackUnderruns ?? 0}`
                : 'Inactive'}
            </strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Fallback reason</span>
            <strong>{accentAiDirectFallbackReason || 'None'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Accent language</span>
            <strong>{getAccentAiLabel(accentAiLanguage)}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Accent mode</span>
            <strong>{accentAiMode === 'clarity' ? 'Clarity' : 'Latency'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Mic cleanup</span>
            <strong>{accentAiMicCleanup ? 'On' : 'Off'}</strong>
          </div>
          <div className="browser-voice-panel__summary-row">
            <span>Converted source</span>
            <strong>{accentAiVirtualDeviceLabel || 'Waiting for device'}</strong>
          </div>
        </div>

        <audio
          ref={audioRef}
          autoPlay
          playsInline
          controls
          className="browser-voice-panel__audio"
          onPlaying={() => setAudioState('playing')}
          onPause={() => setAudioState('idle')}
          onError={() => setAudioState('blocked')}
        />
        <audio ref={monitorAudioRef} autoPlay playsInline className="browser-voice-panel__monitor-audio" />
      </div>
    </div>
  )
}
