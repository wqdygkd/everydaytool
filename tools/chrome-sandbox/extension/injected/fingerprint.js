(function () {
  const script = document.currentScript
  const config = JSON.parse(script.dataset.config || '{}')

  function defineProperty(obj, prop, value) {
    try {
      Object.defineProperty(obj, prop, {
        get: () => value,
        configurable: true,
      })
    } catch {
      // ignore
    }
  }

  function applyNavigator(configNav) {
    if (!configNav) return
    defineProperty(navigator, 'userAgent', configNav.userAgent)
    defineProperty(navigator, 'platform', configNav.platform)
    defineProperty(navigator, 'language', configNav.language)
    defineProperty(navigator, 'languages', configNav.language.split(',').map(s => s.split(';')[0].trim()))
    defineProperty(navigator, 'hardwareConcurrency', configNav.hardwareConcurrency)
    defineProperty(navigator, 'deviceMemory', configNav.deviceMemory)
  }

  function applyScreen(configScreen) {
    if (!configScreen) return
    defineProperty(screen, 'width', configScreen.width)
    defineProperty(screen, 'height', configScreen.height)
    defineProperty(screen, 'availWidth', configScreen.width)
    defineProperty(screen, 'availHeight', configScreen.height - 40)
    defineProperty(screen, 'colorDepth', configScreen.colorDepth)
    defineProperty(window, 'devicePixelRatio', configScreen.devicePixelRatio)
  }

  function applyCanvas(configCanvas) {
    if (!configCanvas) return
    const seed = configCanvas.noiseSeed || 1
    const levelMap = { low: 0.0001, medium: 0.001, high: 0.01 }
    const noise = levelMap[configCanvas.noiseLevel] || 0.001

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const ctx = this.getContext('2d')
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height)
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] ^= (seed + i) % 3
        }
        ctx.putImageData(imageData, 0, 0)
      }
      return originalToDataURL.apply(this, args)
    }

    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const imageData = originalGetImageData.apply(this, args)
      for (let i = 0; i < imageData.data.length; i += 97) {
        imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(noise * 255))
      }
      return imageData
    }
  }

  function applyWebGL(configWebgl) {
    if (!configWebgl) return
    const vendors = [37445, 7936]
    const renderers = [37446, 7937]

    const patch = (proto) => {
      const original = proto.getParameter
      proto.getParameter = function (param) {
        if (vendors.includes(param)) return configWebgl.vendor
        if (renderers.includes(param)) return configWebgl.renderer
        return original.call(this, param)
      }
    }

    patch(WebGLRenderingContext.prototype)
    if (window.WebGL2RenderingContext) {
      patch(WebGL2RenderingContext.prototype)
    }
  }

  function applyAudio(configAudio) {
    if (!configAudio?.noiseEnabled) return
    const Analyser = window.AnalyserNode
    if (!Analyser) return

    const original = Analyser.prototype.getFloatFrequencyData
    Analyser.prototype.getFloatFrequencyData = function (array) {
      original.call(this, array)
      for (let i = 0; i < array.length; i += 1) {
        array[i] += (configAudio.noiseLevel || 0.001) * ((i % 5) - 2)
      }
    }
  }

  function applyTimezone(configTimezone) {
    if (!configTimezone) return
    const offset = configTimezone.offset
    // eslint-disable-next-line no-extend-native
    Date.prototype.getTimezoneOffset = function () {
      return offset
    }
  }

  applyNavigator(config.navigator)
  applyScreen(config.screen)
  applyCanvas(config.canvas)
  applyWebGL(config.webgl)
  applyAudio(config.audio)
  applyTimezone(config.timezone)
})()
