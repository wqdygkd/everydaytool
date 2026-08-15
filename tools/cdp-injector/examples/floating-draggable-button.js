/**
 * CDP 注入示例：在页面右下角生成可拖动的悬浮按钮。
 * 用法：在「脚本库」中新建脚本 →「从文件导入」选本文件 → 应用配置关联该脚本后启动。
 */
(function () {
  const ROOT_ID = 'cdp-injector-floating-btn'

  function mount() {
    const existing = document.getElementById(ROOT_ID)
    if (existing) existing.remove()

    const btn = document.createElement('button')
    btn.id = ROOT_ID
    btn.type = 'button'
    btn.textContent = '工具'
    btn.title = '点击在控制台输出当前页面地址；按住可拖动'

    Object.assign(btn.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '2147483646',
      margin: '0',
      padding: '10px 16px',
      border: 'none',
      borderRadius: '999px',
      background: 'linear-gradient(135deg, #409eff 0%, #337ecc 100%)',
      color: '#fff',
      font: '600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
      cursor: 'grab',
      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
      userSelect: 'none',
      touchAction: 'none',
      WebkitUserSelect: 'none',
    })

    let dragging = false
    let pointerId = null
    let offsetX = 0
    let offsetY = 0
    let dragMoved = false

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max)
    }

    function placeAt(clientX, clientY) {
      const rect = btn.getBoundingClientRect()
      const w = window.innerWidth
      const h = window.innerHeight
      const left = clamp(clientX - offsetX, 0, w - rect.width)
      const top = clamp(clientY - offsetY, 0, h - rect.height)
      btn.style.left = `${left}px`
      btn.style.top = `${top}px`
      btn.style.right = 'auto'
      btn.style.bottom = 'auto'
    }

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      dragging = true
      dragMoved = false
      pointerId = e.pointerId
      const rect = btn.getBoundingClientRect()
      offsetX = e.clientX - rect.left
      offsetY = e.clientY - rect.top
      btn.style.cursor = 'grabbing'
      btn.setPointerCapture(pointerId)
      e.preventDefault()
    })

    btn.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return
      dragMoved = true
      placeAt(e.clientX, e.clientY)
    })

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return
      dragging = false
      pointerId = null
      btn.style.cursor = 'grab'
      try {
        if (e) btn.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    btn.addEventListener('pointerup', endDrag)
    btn.addEventListener('pointercancel', endDrag)

    function openCurrentUrlInConsole() {
      const href = location.href
      return href
    }

    btn.addEventListener('click', (e) => {
      if (!dragMoved) {
        openCurrentUrlInConsole()
        return
      }
      dragMoved = false
      e.preventDefault()
      e.stopPropagation()
    });

    (document.documentElement || document.body).appendChild(btn)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})()
