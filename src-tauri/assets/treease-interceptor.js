(function () {
  if (window.__edtTreease) return;

  var state = { rules: [], enabled: false, hits: 0 };

  function compile(pattern) {
    var escaped = String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  function hasPatches(rule) {
    return Array.isArray(rule.patches) && rule.patches.some(function (p) {
      return p && typeof p.path === 'string' && p.path.trim();
    });
  }

  function isActive(rule) {
    if (!rule || rule.enabled === false) return false;
    if (typeof rule.urlPattern !== 'string' || !rule.urlPattern.trim()) return false;
    if (rule.action === 'block') return true;
    return hasPatches(rule);
  }

  function matchRule(url, action) {
    for (var i = 0; i < state.rules.length; i += 1) {
      var rule = state.rules[i];
      if (!isActive(rule)) continue;
      var kind = rule.action === 'block' ? 'block' : 'modify';
      if (kind !== action) continue;
      try {
        if (compile(rule.urlPattern).test(url)) return rule;
      } catch (e) {
        // 非法正则（用户规则）忽略
      }
    }
    return null;
  }

  function setPath(root, path, value) {
    var keys = String(path).split('.').map(function (k) { return k.trim(); }).filter(Boolean);
    if (!keys.length || !root || typeof root !== 'object') return false;
    var cur = root;
    for (var i = 0; i < keys.length - 1; i += 1) {
      if (!cur || typeof cur !== 'object') return false;
      var next = cur[keys[i]];
      if (!next || typeof next !== 'object') {
        cur[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      }
      cur = cur[keys[i]];
    }
    if (!cur || typeof cur !== 'object') return false;
    cur[keys[keys.length - 1]] = value;
    return true;
  }

  function applyPatches(text, patches) {
    var valid = (patches || []).filter(function (p) { return p && p.path && String(p.path).trim(); });
    if (!valid.length) return null;
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    var applied = 0;
    for (var i = 0; i < valid.length; i += 1) {
      if (setPath(data, valid[i].path, valid[i].value)) applied += 1;
    }
    return applied ? JSON.stringify(data) : null;
  }

  function recordHit() {
    state.hits += 1;
  }

  // ---- fetch ----
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!state.enabled) return nativeFetch.apply(this, arguments);
      if (matchRule(url, 'block')) {
        recordHit();
        return Promise.resolve(new Response(null, { status: 403 }));
      }
      var modify = matchRule(url, 'modify');
      if (!modify) return nativeFetch.apply(this, arguments);
      return nativeFetch.apply(this, arguments).then(function (response) {
        var contentType = response.headers.get('content-type') || '';
        if (contentType.indexOf('json') === -1) return response;
        return response.clone().text().then(function (text) {
          var next = applyPatches(text, modify.patches);
          if (next == null) return response;
          recordHit();
          var headers = new Headers(response.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          return new Response(next, {
            status: response.status,
            statusText: response.statusText,
            headers: headers,
          });
        });
      });
    };
  }

  // ---- XMLHttpRequest ----
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var originalOpen = XHR.prototype.open;
    var originalSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__edtUrl = String(url || '');
      this.__edtBlocked = false;
      this.__edtModify = null;
      this.__edtPatched = false;
      if (state.enabled) {
        if (matchRule(this.__edtUrl, 'block')) {
          this.__edtBlocked = true;
          recordHit();
        } else {
          this.__edtModify = matchRule(this.__edtUrl, 'modify');
        }
      }
      return originalOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var xhr = this;
      if (xhr.__edtBlocked) {
        try { xhr.abort(); } catch (e) {}
        throw new DOMException('Blocked by everydaytool interceptor', 'NetworkError');
      }
      if (xhr.__edtModify) {
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState !== 4 || xhr.__edtPatched) return;
          var contentType = xhr.getResponseHeader('content-type') || '';
          if (contentType.indexOf('json') === -1) return;
          var next = applyPatches(xhr.responseText, xhr.__edtModify.patches);
          if (next == null) return;
          xhr.__edtPatched = true;
          recordHit();
          try {
            Object.defineProperty(xhr, 'responseText', { value: next, configurable: true });
            Object.defineProperty(xhr, 'response', { value: next, configurable: true });
          } catch (e) {}
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  window.__edtTreease = {
    setRules: function (rules, resetHits) {
      state.rules = Array.isArray(rules) ? rules : [];
      state.enabled = state.rules.some(isActive);
      if (resetHits) state.hits = 0;
      return this.status();
    },
    status: function () {
      var activeCount = state.rules.filter(isActive).length;
      return {
        webviewId: 1,
        attached: state.enabled,
        ruleCount: activeCount,
        hits: state.hits,
      };
    },
    stop: function () {
      state.rules = [];
      state.enabled = false;
      return this.status();
    },
  };
})();
