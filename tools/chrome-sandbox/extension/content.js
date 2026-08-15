(async () => {
  const configUrl = chrome.runtime.getURL('fingerprint-config.json')
  let config = {}

  try {
    const response = await fetch(configUrl)
    config = await response.json()
  } catch (error) {
    console.warn('[Chrome沙箱] Failed to load fingerprint config', error)
    return
  }

  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('injected/fingerprint.js')
  script.dataset.config = JSON.stringify(config)
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script)
})()
