const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_PACKET_SAMPLES = 512
const DEFAULT_TRANSPORT_FRAMES_PER_PACKET = 2
const DEFAULT_BROWSER_SAMPLE_RATE = 48000
const DEFAULT_MAX_IN_FLIGHT_PACKETS = 4
const DEFAULT_MAX_PLAYBACK_BACKLOG_SECONDS = 0.12
const DEFAULT_PLAYBACK_LEAD_SECONDS = 0.04
const WORKLET_MODULE_PATH = '/accentai-realtime-worklet.js'

function buildSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `accentai-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function encodePcm16(floatSamples) {
  const pcm = new Int16Array(floatSamples.length)
  for (let index = 0; index < floatSamples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[index] || 0))
    pcm[index] = sample < 0 ? sample * 32768 : sample * 32767
  }
  return pcm.buffer
}

function decodePcm16(buffer) {
  const pcm = new Int16Array(buffer)
  const output = new Float32Array(pcm.length)
  for (let index = 0; index < pcm.length; index += 1) {
    output[index] = pcm[index] / 32768
  }
  return output
}

export async function createAccentAiRealtimeStream({
  audioConstraints,
  websocketUrl,
  sampleRate = DEFAULT_SAMPLE_RATE,
  packetSamples = DEFAULT_PACKET_SAMPLES,
  maxInFlightPackets = DEFAULT_MAX_IN_FLIGHT_PACKETS,
  maxPlaybackBacklogSeconds = DEFAULT_MAX_PLAYBACK_BACKLOG_SECONDS,
  playbackLeadSeconds = DEFAULT_PLAYBACK_LEAD_SECONDS,
  onFatalError,
} = {}) {
  if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
    throw new Error('Realtime AccentAI streaming requires browser media device support.')
  }

  const audioContext = new window.AudioContext({
    latencyHint: 'interactive',
    sampleRate: DEFAULT_BROWSER_SAMPLE_RATE,
  })
  const browserSampleRate = audioContext.sampleRate
  const packetDurationSeconds = packetSamples / sampleRate
  const transportPacketSamples = Math.max(
    256,
    Math.round(browserSampleRate * packetDurationSeconds * DEFAULT_TRANSPORT_FRAMES_PER_PACKET),
  )

  await audioContext.audioWorklet.addModule(WORKLET_MODULE_PATH)

  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  })

  const inputTrack = rawStream.getAudioTracks()[0] || null
  const destination = audioContext.createMediaStreamDestination()
  const sourceNode = audioContext.createMediaStreamSource(rawStream)
  const captureNode = new window.AudioWorkletNode(audioContext, 'accentai-capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      packetSamples: transportPacketSamples,
    },
  })
  const playbackNode = new window.AudioWorkletNode(audioContext, 'accentai-playback-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      packetSamples: transportPacketSamples,
      primeLeadSamples: Math.max(transportPacketSamples, Math.round(browserSampleRate * playbackLeadSeconds)),
      maxBacklogSamples: Math.max(transportPacketSamples * 2, Math.round(browserSampleRate * maxPlaybackBacklogSeconds)),
    },
  })
  const silentGainNode = audioContext.createGain()
  silentGainNode.gain.value = 0

  let websocket = null
  let stopped = false
  let started = false
  let inFlightPackets = 0
  let queuedPacketsDropped = 0
  let playbackUnderruns = 0
  let queuedSamples = 0
  let fatalErrorEmitted = false

  const emitFatalError = (error) => {
    if (stopped || fatalErrorEmitted) {
      return
    }
    fatalErrorEmitted = true
    if (typeof onFatalError === 'function') {
      onFatalError(error)
    }
  }

  try {
    const websocketStarted = await new Promise((resolve, reject) => {
      try {
        websocket = new window.WebSocket(websocketUrl)
      } catch (error) {
        reject(error)
        return
      }

      websocket.binaryType = 'arraybuffer'
      const sessionId = buildSessionId()

      const cleanupListeners = () => {
        if (!websocket) {
          return
        }
        websocket.onopen = null
        websocket.onmessage = null
        websocket.onerror = null
        websocket.onclose = null
      }

      websocket.onopen = () => {
        websocket?.send(
          JSON.stringify({
            type: 'start',
            session_id: sessionId,
            sample_rate: browserSampleRate,
            apply_input_conditioning: false,
            apply_output_polish: false,
          }),
        )
      }

      websocket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return
        }

        let payload = null
        try {
          payload = JSON.parse(event.data)
        } catch {
          payload = null
        }

        if (!payload) {
          return
        }

        if (payload.type === 'started') {
          started = true
          cleanupListeners()
          websocket.onmessage = (nextEvent) => {
            if (typeof nextEvent.data === 'string') {
              let nextPayload = null
              try {
                nextPayload = JSON.parse(nextEvent.data)
              } catch {
                nextPayload = null
              }
              if (nextPayload?.type === 'error') {
                emitFatalError(new Error(nextPayload.detail || 'AccentAI realtime stream failed.'))
              }
              return
            }

            if (!(nextEvent.data instanceof ArrayBuffer)) {
              return
            }

            inFlightPackets = Math.max(0, inFlightPackets - 1)
            playbackNode.port.postMessage({
              type: 'push',
              samples: decodePcm16(nextEvent.data),
            })
          }
          websocket.onerror = () => {
            emitFatalError(new Error('AccentAI realtime WebSocket encountered an error.'))
          }
          websocket.onclose = () => {
            emitFatalError(new Error('AccentAI realtime WebSocket closed during the call.'))
          }
          resolve(true)
          return
        }

        if (payload.type === 'error') {
          cleanupListeners()
          reject(new Error(payload.detail || 'AccentAI realtime WebSocket failed to start.'))
        }
      }

      websocket.onerror = () => {
        cleanupListeners()
        reject(new Error('AccentAI realtime WebSocket could not be opened.'))
      }

      websocket.onclose = () => {
        if (started) {
          emitFatalError(new Error('AccentAI realtime WebSocket closed during the call.'))
          return
        }
        cleanupListeners()
        reject(new Error('AccentAI realtime WebSocket closed before streaming started.'))
      }
    })

    if (!websocketStarted) {
      throw new Error('AccentAI realtime stream failed to start.')
    }
  } catch (error) {
    rawStream.getTracks().forEach((track) => track.stop())
    await audioContext.close().catch(() => {})
    try {
      websocket?.close()
    } catch {
      // no-op
    }
    throw error
  }

  captureNode.port.onmessage = (event) => {
    const samples = event.data
    if (!(samples instanceof Float32Array)) {
      return
    }

    if (stopped || !started || !websocket || websocket.readyState !== window.WebSocket.OPEN) {
      return
    }

    if (inFlightPackets >= maxInFlightPackets) {
      queuedPacketsDropped += 1
      return
    }

    websocket.send(encodePcm16(samples))
    inFlightPackets += 1
  }

  playbackNode.port.onmessage = (event) => {
    const payload = event.data
    if (!payload || payload.type !== 'stats') {
      return
    }
    playbackUnderruns = Number(payload.underruns || 0)
    queuedSamples = Number(payload.queuedSamples || 0)
    queuedPacketsDropped = Math.max(queuedPacketsDropped, Number(payload.droppedPackets || 0))
  }

  sourceNode.connect(captureNode)
  captureNode.connect(silentGainNode)
  playbackNode.connect(destination)
  silentGainNode.connect(audioContext.destination)
  await audioContext.resume()

  return {
    stream: destination.stream,
    rawStream,
    inputTrackLabel: inputTrack?.label || '',
    sampleRate: browserSampleRate,
    packetSamples,
    getStats() {
      return {
        inFlightPackets,
        queuedPacketsDropped,
        playbackUnderruns,
        queuedSamples,
        browserSampleRate,
        transportPacketSamples,
      }
    },
    async stop() {
      stopped = true
      try {
        captureNode.port.onmessage = null
        playbackNode.port.onmessage = null
      } catch {
        // no-op
      }
      try {
        sourceNode.disconnect()
      } catch {
        // no-op
      }
      try {
        captureNode.disconnect()
      } catch {
        // no-op
      }
      try {
        playbackNode.port.postMessage({ type: 'reset' })
      } catch {
        // no-op
      }
      try {
        playbackNode.disconnect()
      } catch {
        // no-op
      }
      try {
        silentGainNode.disconnect()
      } catch {
        // no-op
      }
      rawStream.getTracks().forEach((track) => track.stop())
      if (websocket && websocket.readyState === window.WebSocket.OPEN) {
        try {
          websocket.send(JSON.stringify({ type: 'reset' }))
        } catch {
          // no-op
        }
      }
      try {
        websocket?.close()
      } catch {
        // no-op
      }
      await audioContext.close().catch(() => {})
    },
  }
}
