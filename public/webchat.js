/*
 * QuiroFlow website chat.
 *
 *   <script src="https://app.quiroflow.com/webchat.js" data-clinic="<slug>" async></script>
 *
 * To move it (a site with its own button in that corner):
 *
 *   [data-quiroflow-webchat] { --qf-chat-bottom: 92px; --qf-chat-right: 24px; --qf-chat-z: 45; }
 *
 * Pasted into a clinic's own website, so it assumes nothing about the page:
 * no framework, no globals beyond one guard, and everything drawn inside a
 * shadow root so the site's CSS cannot reach it and it cannot reach the
 * site's. Messages go to /api/public-webchat/<slug>, where each visitor
 * becomes a lead in the clinic's Inbox.
 *
 * The visitor is a random id kept in this browser's localStorage. It is the
 * only key to their conversation, so it is never put in a URL the page shows
 * or sent anywhere but the clinic's own chat endpoints.
 */
;(function () {
  if (window.__quiroflowWebchat) return
  window.__quiroflowWebchat = true

  var script = document.currentScript
  if (!script) return
  var slug = script.getAttribute('data-clinic')
  if (!slug) return
  var origin = new URL(script.src, window.location.href).origin
  var api = origin + '/api/public-webchat/' + encodeURIComponent(slug)

  // The website's own language first: a Spanish clinic's site keeps Spanish
  // words around its chat whatever the visitor's browser is set to.
  var en = (document.documentElement.lang || navigator.language || '').toLowerCase().indexOf('en') === 0
  var T = en
    ? { open: 'Chat with us', close: 'Close chat', placeholder: 'Write a message…', send: 'Send', greeting: 'Hi! How can we help you?', note: 'Replies may come from an AI assistant working for the clinic.', failed: 'Could not send. Try again.', typing: 'Writing…' }
    : { open: 'Escríbenos', close: 'Cerrar el chat', placeholder: 'Escribe un mensaje…', send: 'Enviar', greeting: '¡Hola! ¿En qué te podemos ayudar?', note: 'Te puede responder un asistente con IA que trabaja para la clínica.', failed: 'No se ha podido enviar. Inténtalo de nuevo.', typing: 'Escribiendo…' }

  var storeKey = 'quiroflow-webchat:' + slug
  var memory = {}
  function load(key) {
    try { return window.localStorage.getItem(key) } catch (e) { return memory[key] || null }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value) } catch (e) { memory[key] = value }
  }
  function visitorId() {
    var id = load(storeKey)
    if (id && /^[A-Za-z0-9_-]{32,64}$/.test(id)) return id
    var bytes = new Uint8Array(20)
    window.crypto.getRandomValues(bytes)
    id = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2) }).join('')
    save(storeKey, id)
    return id
  }
  function hasConversation() {
    return Boolean(load(storeKey))
  }

  function request(method, path, body) {
    return fetch(api + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    })
  }

  request('GET', '').then(start, function () { /* Off, or no such clinic: show nothing. */ })

  function start(config) {
    var host = document.createElement('div')
    host.setAttribute('data-quiroflow-webchat', '')
    document.body.appendChild(host)
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host

    var style = document.createElement('style')
    style.textContent = [
      ':host{all:initial}',
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
      // Where the bubble sits, from three custom properties the host page may
      // set on [data-quiroflow-webchat]: they are the one thing that crosses
      // into a shadow root. A site with its own floating button in the corner
      // moves the chat above it instead of under it.
      '.bubble{position:fixed;right:var(--qf-chat-right,20px);bottom:var(--qf-chat-bottom,20px);z-index:var(--qf-chat-z,2147483000);width:58px;height:58px;border-radius:50%;border:0;background:#4F46E5;color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(21,23,30,.25);display:flex;align-items:center;justify-content:center}',
      '.bubble:hover{background:#4339CE}',
      '.bubble:focus-visible,.send:focus-visible,.x:focus-visible{outline:3px solid #A5B4FC;outline-offset:2px}',
      '.dot{position:absolute;top:4px;right:4px;width:13px;height:13px;border-radius:50%;background:#E5484D;border:2px solid #fff}',
      '.panel{position:fixed;right:var(--qf-chat-right,20px);bottom:calc(var(--qf-chat-bottom,20px) + 70px);z-index:var(--qf-chat-z,2147483000);width:370px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - var(--qf-chat-bottom,20px) - 90px);background:#fff;color:#15171E;border-radius:16px;box-shadow:0 16px 48px rgba(21,23,30,.28);display:flex;flex-direction:column;overflow:hidden}',
      '@media (max-width:480px){.panel{right:12px;left:12px;width:auto;height:calc(100vh - var(--qf-chat-bottom,20px) - 80px)}}',
      '.head{display:flex;align-items:center;gap:10px;padding:14px 14px 14px 18px;background:#4F46E5;color:#fff}',
      '.head strong{flex:1;font-size:15.5px;font-weight:650;line-height:1.25}',
      '.x{border:0;background:transparent;color:#fff;cursor:pointer;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}',
      '.x:hover{background:rgba(255,255,255,.15)}',
      '.list{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:8px;background:#F7F8FA}',
      '.msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14.5px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.clinic{align-self:flex-start;background:#fff;border:1px solid #E8E9ED;border-bottom-left-radius:5px}',
      '.visitor{align-self:flex-end;background:#4F46E5;color:#fff;border-bottom-right-radius:5px}',
      '.typing{align-self:flex-start;font-size:13px;color:#8A8FA0;padding:2px 4px}',
      '.err{font-size:13px;color:#B4230F;padding:0 16px 6px}',
      '.foot{border-top:1px solid #E8E9ED;padding:10px 10px 8px;background:#fff}',
      '.row{display:flex;gap:8px;align-items:flex-end}',
      'textarea{flex:1;resize:none;border:1px solid #E1E3EA;border-radius:10px;padding:9px 11px;font-size:14.5px;line-height:1.35;max-height:120px;color:#15171E;background:#fff}',
      'textarea:focus{outline:none;border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.18)}',
      '.send{border:0;background:#4F46E5;color:#fff;border-radius:10px;height:40px;padding:0 14px;font-size:14px;font-weight:600;cursor:pointer}',
      '.send:disabled{opacity:.5;cursor:default}',
      '.note{font-size:11.5px;color:#8A8FA0;margin:7px 2px 0;line-height:1.35}',
      '.note a{color:#8A8FA0}',
      '[hidden]{display:none!important}',
    ].join('')
    root.appendChild(style)

    var bubble = el('button', 'bubble')
    bubble.type = 'button'
    bubble.setAttribute('aria-label', T.open)
    bubble.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'
    var dot = el('span', 'dot')
    dot.hidden = true
    bubble.appendChild(dot)

    var panel = el('div', 'panel')
    panel.hidden = true
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', config.clinicName)

    var head = el('div', 'head')
    var title = el('strong')
    title.textContent = config.clinicName
    var close = el('button', 'x')
    close.type = 'button'
    close.setAttribute('aria-label', T.close)
    close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    head.appendChild(title)
    head.appendChild(close)

    var list = el('div', 'list')
    list.setAttribute('aria-live', 'polite')
    var error = el('div', 'err')
    error.hidden = true

    var foot = el('div', 'foot')
    var row = el('div', 'row')
    var input = el('textarea')
    input.rows = 1
    input.maxLength = 2000
    input.placeholder = T.placeholder
    input.setAttribute('aria-label', T.placeholder)
    var send = el('button', 'send')
    send.type = 'button'
    send.textContent = T.send
    row.appendChild(input)
    row.appendChild(send)
    var note = el('p', 'note')
    note.textContent = T.note
    foot.appendChild(row)
    foot.appendChild(note)

    panel.appendChild(head)
    panel.appendChild(list)
    panel.appendChild(error)
    panel.appendChild(foot)
    root.appendChild(panel)
    root.appendChild(bubble)

    var messages = []
    var waitingSince = 0
    var timer = null
    var seenKey = storeKey + ':seen'

    function el(tag, cls) {
      var node = document.createElement(tag)
      if (cls) node.className = cls
      return node
    }

    function render() {
      list.textContent = ''
      var greeting = el('div', 'msg clinic')
      greeting.textContent = config.greeting || T.greeting
      list.appendChild(greeting)
      messages.forEach(function (m) {
        var node = el('div', 'msg ' + (m.from === 'visitor' ? 'visitor' : 'clinic'))
        node.textContent = m.text
        list.appendChild(node)
      })
      var last = messages[messages.length - 1]
      // Shown until somebody answers, for as long as an answer is plausible.
      if (waitingSince && last && last.from === 'visitor' && Date.now() - waitingSince < 3 * 60 * 1000) {
        var typing = el('div', 'typing')
        typing.textContent = T.typing
        list.appendChild(typing)
      }
      list.scrollTop = list.scrollHeight
    }

    function newestClinicAt() {
      for (var i = messages.length - 1; i >= 0; i--) if (messages[i].from === 'clinic') return messages[i].at
      return ''
    }

    function refresh() {
      return request('GET', '/messages?visitorId=' + encodeURIComponent(visitorId())).then(function (body) {
        var before = messages.length
        messages = body.messages || []
        var last = messages[messages.length - 1]
        if (last && last.from === 'clinic') waitingSince = 0
        if (!panel.hidden) {
          if (messages.length !== before) render()
          save(seenKey, newestClinicAt())
        } else {
          dot.hidden = !newestClinicAt() || newestClinicAt() === load(seenKey)
        }
      }, function () {})
    }

    function poll() {
      clearTimeout(timer)
      // Often while the chat is open and somebody may be answering; rarely
      // otherwise, just enough to light the dot on a reply.
      timer = setTimeout(function () { refresh().then(poll) }, panel.hidden ? 30000 : 4000)
    }

    function openPanel() {
      panel.hidden = false
      dot.hidden = true
      bubble.setAttribute('aria-expanded', 'true')
      render()
      if (hasConversation()) refresh().then(render)
      poll()
      input.focus()
    }
    function closePanel() {
      panel.hidden = true
      bubble.setAttribute('aria-expanded', 'false')
      bubble.focus()
      poll()
    }

    function submit() {
      var text = input.value.trim()
      if (!text || send.disabled) return
      send.disabled = true
      error.hidden = true
      request('POST', '/messages', { visitorId: visitorId(), text: text }).then(function (body) {
        input.value = ''
        messages = body.messages || messages
        waitingSince = Date.now()
        render()
        save(seenKey, newestClinicAt())
      }, function () {
        error.textContent = T.failed
        error.hidden = false
      }).then(function () {
        send.disabled = false
        input.focus()
      })
    }

    bubble.addEventListener('click', function () { panel.hidden ? openPanel() : closePanel() })
    close.addEventListener('click', closePanel)
    send.addEventListener('click', submit)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
      if (e.key === 'Escape') closePanel()
    })
    input.addEventListener('input', function () {
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 120) + 'px'
    })

    // A visitor coming back to a conversation sees whether it was answered.
    if (hasConversation()) refresh().then(poll)
  }
})()
