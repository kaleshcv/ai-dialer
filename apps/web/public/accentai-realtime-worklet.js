class AccentAiCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.packetSamples = Math.max(128, options?.processorOptions?.packetSamples || 512)
    this.buffer = new Float32Array(this.packetSamples)
    this.offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input?.[0]

    if (!channel || !channel.length) {
      return true
    }

    let readOffset = 0
    while (readOffset < channel.length) {
      const writable = Math.min(this.packetSamples - this.offset, channel.length - readOffset)
      this.buffer.set(channel.subarray(readOffset, readOffset + writable), this.offset)
      this.offset += writable
      readOffset += writable

      if (this.offset >= this.packetSamples) {
        this.port.postMessage(this.buffer.slice(0))
        this.offset = 0
      }
    }

    return true
  }
}

class AccentAiPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.packetSamples = Math.max(128, options?.processorOptions?.packetSamples || 512)
    this.primeLeadSamples = Math.max(this.packetSamples, options?.processorOptions?.primeLeadSamples || this.packetSamples)
    this.maxBacklogSamples = Math.max(this.packetSamples * 2, options?.processorOptions?.maxBacklogSamples || this.packetSamples * 4)
    this.crossfadeSamples = Math.max(0, Math.min(128, Math.floor(this.packetSamples / 8)))
    this.queue = []
    this.queueOffset = 0
    this.queuedSamples = 0
    this.playbackPrimed = false
    this.underruns = 0
    this.droppedPackets = 0
    this.framesUntilReport = 0
    this.lastSample = 0

    this.port.onmessage = (event) => {
      const payload = event.data
      if (!payload) {
        return
      }

      if (payload.type === 'push' && payload.samples) {
        const samples = payload.samples instanceof Float32Array ? payload.samples.slice(0) : new Float32Array(payload.samples)
        this.applyCrossfade(samples)
        this.queue.push(samples)
        this.queuedSamples += samples.length
        this.trimQueue()
        return
      }

      if (payload.type === 'reset') {
        this.queue = []
        this.queueOffset = 0
        this.queuedSamples = 0
        this.playbackPrimed = false
        this.lastSample = 0
      }
    }
  }

  applyCrossfade(samples) {
    if (!samples.length || this.crossfadeSamples <= 0) {
      if (samples.length) {
        this.lastSample = samples[samples.length - 1]
      }
      return
    }

    const fadeLength = Math.min(this.crossfadeSamples, samples.length)
    const startSample = this.lastSample
    for (let index = 0; index < fadeLength; index += 1) {
      const fadeIn = (index + 1) / fadeLength
      const fadeOut = 1 - fadeIn
      samples[index] = (startSample * fadeOut) + (samples[index] * fadeIn)
    }

    this.lastSample = samples[samples.length - 1]
  }

  trimQueue() {
    while (this.queuedSamples > this.maxBacklogSamples && this.queue.length) {
      const head = this.queue[0]
      const available = head.length - this.queueOffset
      const excess = this.queuedSamples - this.maxBacklogSamples
      const dropCount = Math.min(available, excess)
      this.queueOffset += dropCount
      this.queuedSamples -= dropCount
      this.droppedPackets += 1

      if (this.queueOffset >= head.length) {
        this.queue.shift()
        this.queueOffset = 0
      }
    }
  }

  reportStats() {
    this.port.postMessage({
      type: 'stats',
      underruns: this.underruns,
      queuedSamples: this.queuedSamples,
      droppedPackets: this.droppedPackets,
    })
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    const channel = output?.[0]
    if (!channel) {
      return true
    }

    channel.fill(0)

    if (!this.playbackPrimed) {
      if (this.queuedSamples >= this.primeLeadSamples) {
        this.playbackPrimed = true
      } else {
        this.underruns += 1
        this.framesUntilReport -= 1
        if (this.framesUntilReport <= 0) {
          this.framesUntilReport = 32
          this.reportStats()
        }
        return true
      }
    }

    let writeOffset = 0
    while (writeOffset < channel.length) {
      if (!this.queue.length) {
        this.underruns += 1
        this.playbackPrimed = false
        break
      }

      const head = this.queue[0]
      const available = head.length - this.queueOffset
      const writable = Math.min(channel.length - writeOffset, available)
      channel.set(head.subarray(this.queueOffset, this.queueOffset + writable), writeOffset)
      writeOffset += writable
      this.queueOffset += writable
      this.queuedSamples -= writable

      if (this.queueOffset >= head.length) {
        this.queue.shift()
        this.queueOffset = 0
      }
    }

    this.framesUntilReport -= 1
    if (this.framesUntilReport <= 0) {
      this.framesUntilReport = 32
      this.reportStats()
    }

    return true
  }
}

registerProcessor('accentai-capture-processor', AccentAiCaptureProcessor)
registerProcessor('accentai-playback-processor', AccentAiPlaybackProcessor)
