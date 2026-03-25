import { useEffect, useRef, useState } from 'react'
import { Web } from 'sip.js'
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

export default function BrowserVoicePanel({ defaultDestination = '' }) {
  const browserVoiceConfig = getBrowserVoiceConfig()
  const { aor, authPassword, authUsername, displayName, domain, wsUrl } = browserVoiceConfig
  const audioRef = useRef(null)
  const simpleUserRef = useRef(null)
  const mountedRef = useRef(false)
  const isRegisteredRef = useRef(false)
  const [destination, setDestination] = useState(normalizeBrowserDialNumber(defaultDestination))
  const [status, setStatus] = useState('idle')
  const [isRegistered, setIsRegistered] = useState(false)
  const [message, setMessage] = useState('Browser SIP.js softphone is ready to connect.')

  async function ensureRemoteAudioIsPlaying() {
    const audioElement = audioRef.current
    if (!audioElement) {
      return
    }

    audioElement.muted = false
    audioElement.volume = 1

    await audioElement.play()
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
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    isRegisteredRef.current = isRegistered
  }, [isRegistered])

  useEffect(() => {
    setDestination(normalizeBrowserDialNumber(defaultDestination))
  }, [defaultDestination])

  useEffect(() => {
    if (!audioRef.current || simpleUserRef.current) {
      return undefined
    }

    if (!isBrowserVoiceConfigured(browserVoiceConfig)) {
      setStatus('error')
      setMessage('Browser SIP.js configuration is incomplete.')
      return undefined
    }

    const simpleUser = new Web.SimpleUser(wsUrl, {
      aor,
      delegate: {
        onCallAnswered() {
          if (!mountedRef.current) {
            return
          }

          setStatus('in-call')
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
                `Call answered, but browser audio could not start: ${formatError(error)}. Check speaker permissions and autoplay settings.`,
              )
            })
        },
        onCallCreated() {
          if (!mountedRef.current) {
            return
          }

          setStatus('dialing')
          setMessage('Call created. Waiting for Asterisk to answer.')
        },
        onCallHangup() {
          if (!mountedRef.current) {
            return
          }

          setStatus(isRegisteredRef.current ? 'ready' : simpleUserRef.current?.isConnected() ? 'connected' : 'idle')
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
      },
    })

    simpleUserRef.current = simpleUser
    return () => {
      simpleUserRef.current = null
    }
  }, [aor, authPassword, authUsername, displayName, wsUrl])

  async function handleConnect() {
    const simpleUser = simpleUserRef.current
    if (!simpleUser) {
      setStatus('error')
      setMessage('Browser SIP.js softphone is not initialized.')
      return
    }

    try {
      setStatus('connecting')
      setMessage('Connecting to the SIP WebSocket transport...')
      if (!simpleUser.isConnected()) {
        await simpleUser.connect()
      }
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
      if (!simpleUser.isConnected()) {
        setStatus('connecting')
        setMessage('Connecting to the SIP WebSocket transport...')
        await simpleUser.connect()
      }

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

    const target = buildBrowserSipTarget(destination, domain)
    if (!target) {
      setStatus('error')
      setMessage('Enter a destination number for the browser call.')
      return
    }

    try {
      if (!simpleUser.isConnected()) {
        setStatus('connecting')
        setMessage('Connecting to the SIP WebSocket transport...')
        await simpleUser.connect()
      }

      setStatus('dialing')
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
          <button type="button" className="primary-button" onClick={handleCall} disabled={!browserTarget || !configured}>
            Call from browser
          </button>
          <button type="button" className="secondary-button secondary-button--dark" onClick={handleHangup}>
            Hang up
          </button>
          <button type="button" className="secondary-button secondary-button--dark" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>

        <p className={`browser-voice-panel__message${status === 'error' ? ' browser-voice-panel__message--error' : ''}`}>{message}</p>
      </div>

      <div className="browser-voice-panel__aside">
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
        </div>

        <audio ref={audioRef} autoPlay playsInline className="browser-voice-panel__audio" />
      </div>
    </div>
  )
}
