// tools/pikpak-get/backend/engine/service-entry.ts
import { readFileSync as readFileSync2 } from "node:fs";
import path6 from "node:path";
import process from "node:process";

// tools/pikpak-get/backend/engine/engine.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { existsSync as existsSync2 } from "node:fs";
import { appendFile, mkdir as mkdir5, readdir as readdir2, readFile as readFile3, writeFile as writeFile4 } from "node:fs/promises";
import path5 from "node:path";

// tools/pikpak-get/backend/engine/accounts.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// tools/pikpak-get/backend/engine/api.ts
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

// tools/pikpak-get/backend/engine/errors.ts
var PikpakError = class extends Error {
  status;
  code;
  action;
  throttled;
  network;
  retryAfter;
  retryExhausted = false;
  replaySafe = true;
  constructor(message, options = {}) {
    super(message);
    this.name = "PikpakError";
    this.status = options.status;
    this.code = options.code;
    this.action = options.action;
    this.throttled = options.throttled ?? false;
    this.network = options.network ?? false;
    this.retryAfter = options.retryAfter ?? null;
  }
  get transient() {
    return this.network || this.throttled || this.retryAfter !== null || this.status === 429 || this.status !== void 0 && this.status >= 500;
  }
};
var TrafficCapped = class extends PikpakError {
  replaySafe = true;
  constructor(message, options = {}) {
    super(message, options);
    this.name = "TrafficCapped";
  }
  get transient() {
    return false;
  }
};
var MutationOutcomeUnknown = class extends PikpakError {
  replaySafe = false;
  constructor(message, options = {}) {
    super(message, options);
    this.name = "MutationOutcomeUnknown";
  }
};
var RestoreOutcomeUnknown = class extends MutationOutcomeUnknown {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RestoreOutcomeUnknown";
  }
};

// tools/pikpak-get/backend/engine/api.ts
var USER_API = "https://user.mypikpak.com";
var DRIVE_API = "https://api-drive.mypikpak.com/drive";
var CLIENT_ID = "YNxT9w7GMdWvEOKa";
var CLIENT_SECRET = "dbw2OtmVEeuUvIptb1Coyg";
var CLIENT_VERSION = "1.47.1";
var PACKAGE_NAME = "com.pikcloud.pikpak";
var SDK_VERSION = "2.0.4.204000";
var CLOUD_FOLDER_NAME = "Pack From Shared";
var CAPTCHA_SALTS = [
  "Gez0T9ijiI9WCeTsKSg3SMlx",
  "zQdbalsolyb1R/",
  "ftOjr52zt51JD68C3s",
  "yeOBMH0JkbQdEFNNwQ0RI9T3wU/v",
  "BRJrQZiTQ65WtMvwO",
  "je8fqxKPdQVJiy1DM6Bc9Nb1",
  "niV",
  "9hFCW2R1",
  "sHKHpe2i96",
  "p7c5E6AcXQ/IJUuAEC9W6",
  "",
  "aRv9hjc9P+Pbn+u3krN6",
  "BzStcgE8qVdqjEH16l4",
  "SqgeZvL5j9zoHP95xWHt",
  "zVof5yaJkPe3VFpadPof"
];
var TOKEN_REFRESH_MARGIN = 900;
var CAPTCHA_TTL = 240;
var REQUEST_DEADLINE_MS = 12e4;
var REQUEST_ATTEMPTS = 5;
var NETWORK_RETRY_WAITS = [5, 15, 45, 120, 240];
var THROTTLE_BACKOFF = [30, 120, 480, 900];
var SHARE_ID_RE = /(?:mypikpak\.com|pickpackapp\.com|mypikpak\.net|pikpak\.me)\/s\/([\w-]{8,})/;
var TRAFFIC_CAP_RE = /downstream traffic|has exceeded the limit/i;
function str(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}
function num(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
function captchaSign(clientId, deviceId, timestamp) {
  const stamp = String(timestamp ?? Date.now());
  let state = `${clientId}${CLIENT_VERSION}${PACKAGE_NAME}${deviceId}${stamp}`;
  for (const salt of CAPTCHA_SALTS) {
    state = createHash("md5").update(state + salt).digest("hex");
  }
  return [`1.${state}`, stamp];
}
function parseShareUrl(text) {
  const match = SHARE_ID_RE.exec(text || "");
  if (!match) throw new Error(`not a PikPak share link: ${(text || "").slice(0, 60)}`);
  const query = ((text || "").split("?")[1] ?? "").split("#")[0] ?? "";
  const params = new URLSearchParams(query);
  const passCode = params.get("password") ?? params.get("pass_code") ?? "";
  return { shareId: match[1], passCode };
}
function decodeShareFileId(fileId, shareId) {
  if (!fileId || !shareId || fileId.length === shareId.length) return fileId;
  try {
    const body = Buffer.from(fileId.slice(0, -6), "base64url");
    const key = Buffer.from(shareId.slice(0, -2), "base64url");
    if (body.length !== key.length) return fileId;
    const mixed = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) mixed[i] = body[i] ^ key[i];
    return mixed.toString("base64url") + fileId.slice(-6, -4);
  } catch {
    return fileId;
  }
}
function shareRootId(text) {
  const match = SHARE_ID_RE.exec(text || "");
  if (!match) return "";
  const tail = (text || "").slice(match.index + match[0].length).split("?")[0] ?? "";
  const parts = tail.split("/").filter(Boolean);
  return parts.length ? decodeShareFileId(parts[parts.length - 1], match[1]) : "";
}
function isFolder(item) {
  return item.kind === "drive#folder";
}
async function parseJsonBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
async function sleepInterruptible(ms, stop) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (stop?.()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF09");
    const step = Math.min(500, deadline - Date.now());
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}
var PikpakClient = class {
  fetchImpl;
  log;
  stop;
  onSession;
  _captchas = /* @__PURE__ */ new Map();
  sessionData;
  deviceId;
  sessionDead = false;
  constructor(options) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.log = options.logger ?? (() => {
    });
    this.stop = options.stop ?? (() => false);
    this.onSession = options.onSession;
    this.deviceId = options.deviceId;
    this.sessionData = options.session ?? {
      access_token: "",
      refresh_token: "",
      token_type: "Bearer",
      sub: "",
      expires_at: 0
    };
  }
  get session() {
    return this.sessionData;
  }
  setSession(next) {
    this.sessionData = next;
    this.onSession?.(next);
  }
  // ------------------------------------------------------------------ session
  async signIn(username, password) {
    const signinUrl = `${USER_API}/v1/auth/signin`;
    const metas = username.includes("@") ? { email: username } : /^\d+$/.test(username) ? { phone_number: username } : { username };
    const { status, body } = await this._raw("POST", `${USER_API}/v1/shield/captcha/init`, {
      jsonBody: { client_id: CLIENT_ID, action: `POST:${signinUrl}`, device_id: this.deviceId, meta: metas },
      headers: this._clientHeaders()
    }, false);
    const token = status === 200 ? str(body.captcha_token) : "";
    if (!token) {
      if (body.url) throw new PikpakError("\u767B\u5F55\u9700\u8981\u5148\u901A\u8FC7\u4EBA\u5DE5\u9A8C\u8BC1\u7801\uFF08\u6D4F\u89C8\u5668\u5B8C\u6210\u4E00\u6B21\u540E\u518D\u8BD5\uFF09", { status, action: "signin" });
      throw new PikpakError(`\u65E0\u6CD5\u53D6\u5F97\u767B\u5F55\u9A8C\u8BC1\u7801: ${this._safeBody(body)}`, { status, action: "signin" });
    }
    const result = await this._raw("POST", signinUrl, {
      form: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username,
        password,
        captcha_token: token
      },
      headers: { ...this._clientHeaders(), "Content-Type": "application/x-www-form-urlencoded" }
    }, false);
    if (result.status !== 200 || !result.body.access_token) {
      const detail = str(result.body.error_description || result.body);
      let hint = "";
      if (detail.toLowerCase().includes("verification")) {
        hint = "\uFF08\u82E5\u53CD\u590D\u51FA\u73B0 verification failed\uFF1A\u8FDE\u9519\u4F1A\u8981\u6C42\u4EBA\u5DE5\u6821\u9A8C\uFF0C\u8BF7\u7B49\u51E0\u5206\u949F\u518D\u8BD5\u6216\u5148\u767B\u5F55\u4E00\u6B21\u5B98\u65B9\u5BA2\u6237\u7AEF\uFF09";
      } else if (detail.toLowerCase().includes("prohibit")) {
        hint = '\uFF08\u670D\u52A1\u7AEF\u62D2\u7EDD\u7684\u662F"\u767B\u5F55"\u8FD9\u4E2A\u52A8\u4F5C\u672C\u8EAB\uFF0C\u4E0D\u4EE3\u8868\u5BC6\u7801\u9519\u3002\u5148\u8BD5\u6362\u4E00\u4E2A\u51FA\u53E3\u5730\u5740\uFF1B\u522B\u8FDE\u7EED\u91CD\u8BD5\uFF0C\u90A3\u53EF\u80FD\u5347\u7EA7\u6210\u771F\u98CE\u63A7\u3002\uFF09';
      }
      throw new PikpakError(`\u767B\u5F55\u5931\u8D25: ${detail}${hint}
\u670D\u52A1\u7AEF\u539F\u6587: ${this._safeBody(result.body)}`, { status: result.status, action: "signin" });
    }
    const record = this._tokenRecord(result.body);
    record.sub = record.sub || this.sessionData.sub;
    this.setSession(record);
    return record;
  }
  async refresh() {
    if (!this.sessionData.refresh_token) {
      this.sessionDead = true;
      throw new PikpakError("\u4F1A\u8BDD\u6CA1\u6709 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55", { action: "refresh" });
    }
    const { status, body } = await this._raw("POST", `${USER_API}/v1/auth/token`, {
      jsonBody: {
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: this.sessionData.refresh_token
      },
      headers: this._clientHeaders()
    }, false);
    if (status !== 200 || !body.access_token) {
      this.sessionDead = status === 400 || status === 401 || status === 403;
      const hint = this.sessionDead ? "\uFF08\u8BF7\u91CD\u65B0\u767B\u5F55\uFF09" : "\uFF08\u767B\u5F55\u72B6\u6001\u5DF2\u4FDD\u7559\uFF09";
      throw new PikpakError(`\u4F1A\u8BDD\u7EED\u671F\u5931\u8D25: ${str(body.error_description || body)}${hint}`, { status, action: "refresh" });
    }
    const record = this._tokenRecord(body);
    record.sub = record.sub || this.sessionData.sub;
    this.setSession(record);
    this.sessionDead = false;
    this.log("\u4F1A\u8BDD\u5DF2\u81EA\u52A8\u7EED\u671F");
  }
  async ensureSession(force = false) {
    if (!this.sessionData.access_token) {
      throw new PikpakError("\u8FD8\u6CA1\u6709\u767B\u5F55\u4F1A\u8BDD\uFF1B\u8BF7\u5148\u767B\u5F55", { action: "session" });
    }
    if (force || this.sessionData.expires_at - Date.now() / 1e3 <= TOKEN_REFRESH_MARGIN) {
      await this.refresh();
    }
    return this.sessionData.access_token;
  }
  _tokenRecord(body) {
    return {
      access_token: str(body.access_token),
      refresh_token: str(body.refresh_token),
      token_type: str(body.token_type) || "Bearer",
      sub: str(body.sub),
      expires_at: Date.now() / 1e3 + (num(body.expires_in) || 7200)
    };
  }
  // ------------------------------------------------------------------ plumbing
  _clientHeaders() {
    return {
      "x-client-id": CLIENT_ID,
      "x-device-id": this.deviceId,
      "x-client-version": CLIENT_VERSION,
      "x-sdk-version": SDK_VERSION,
      "x-protocol-version": "301",
      "User-Agent": `${PACKAGE_NAME}/${CLIENT_VERSION}`
    };
  }
  _safeBody(body) {
    const kept = {};
    for (const [key, value] of Object.entries(body || {})) {
      if (key.toLowerCase().includes("token") || ["captcha_vid", "nonce", "captcha_sign"].includes(key)) {
        kept[key] = "\u2026\u7701\u7565\u2026";
      } else if (typeof value === "string" && value.length > 200) {
        kept[key] = `${value.slice(0, 200)}\u2026`;
      } else {
        kept[key] = value;
      }
    }
    return JSON.stringify(kept);
  }
  async _raw(method, url, options = {}, auth = true) {
    let target = url;
    if (options.params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== void 0 && value !== null) search.set(key, String(value));
      }
      const qs = search.toString();
      if (qs) target += (target.includes("?") ? "&" : "?") + qs;
    }
    let data;
    if (options.form) {
      data = new URLSearchParams(options.form).toString();
    } else if (options.jsonBody !== void 0) {
      data = JSON.stringify(options.jsonBody);
    }
    const base = {
      ...this._clientHeaders(),
      "Content-Type": "application/json",
      ...auth && this.sessionData.access_token ? { Authorization: `Bearer ${this.sessionData.access_token}` } : {}
    };
    const headers = {};
    for (const [key, value] of Object.entries({ ...base, ...options.headers ?? {} })) {
      if (value !== void 0) headers[key] = value;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS);
    try {
      const res = await this.fetchImpl(target, { method, headers, body: data, signal: controller.signal });
      const body = await parseJsonBody(res);
      return { status: res.status, body };
    } catch (error) {
      if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF09");
      return { status: void 0, body: { error_description: `network error: ${error.message}` } };
    } finally {
      clearTimeout(timer);
    }
  }
  _throttled(status, body) {
    const text = str(body.error_description || body.error || "").toLowerCase();
    return status === 429 || body.error_code === 4002 || body.error_code === 4003 || text.includes("slow down") || text.includes("too many") || text.includes("rate limit") || text.includes("rate_limit") || text.includes("ratelimit");
  }
  _responseError(status, body, action) {
    const problem = str(body.error_description || body.error || "\u8BF7\u6C42\u5931\u8D25");
    const raw = JSON.stringify(body);
    if (status !== void 0 && (TRAFFIC_CAP_RE.test(problem) || TRAFFIC_CAP_RE.test(raw))) {
      return new TrafficCapped(`\u4ECA\u65E5\u4E0B\u884C\u6D41\u91CF\u5DF2\u5230\u4E0A\u9650: ${problem.slice(0, 160)}`, { status, code: num(body.error_code), action });
    }
    return new PikpakError(problem, {
      status,
      code: num(body.error_code),
      action,
      throttled: this._throttled(status, body),
      network: status === void 0
    });
  }
  async captchaToken(action) {
    const cached = this._captchas.get(action);
    if (cached && cached[1] > Date.now() / 1e3) return cached[0];
    const accessToken = await this.ensureSession();
    const [sign, stamp] = captchaSign(CLIENT_ID, this.deviceId);
    const { status, body } = await this._raw("POST", `${USER_API}/v1/shield/captcha/init`, {
      jsonBody: {
        client_id: CLIENT_ID,
        action,
        device_id: this.deviceId,
        meta: {
          captcha_sign: sign,
          timestamp: stamp,
          client_version: CLIENT_VERSION,
          package_name: PACKAGE_NAME,
          user_id: this.sessionData.sub
        }
      },
      headers: { Authorization: `Bearer ${accessToken}` }
    }, true);
    const token = status === 200 ? str(body.captcha_token) : "";
    if (!token) {
      throw new PikpakError(`\u81EA\u52A8\u6821\u9A8C\u51ED\u8BC1\u7533\u8BF7\u5931\u8D25: ${str(body.error_description || body)}`, { status, code: num(body.error_code), action });
    }
    this._captchas.set(action, [token, Date.now() / 1e3 + CAPTCHA_TTL]);
    return token;
  }
  async call(method, path7, options = {}) {
    const action = options.action ?? `${method}:/drive${path7}`;
    const replaySafe = method === "GET" || method === "HEAD" || method === "OPTIONS" || path7 === "/v1/files:batchTrash" || path7 === "/v1/files:batchDelete";
    const attempts = options.retries ?? REQUEST_ATTEMPTS;
    const base = options.base ?? DRIVE_API;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF09");
      try {
        const token = await this.captchaToken(action);
        if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF09");
        const { status, body } = await this._raw(method, `${base}${path7}`, {
          params: options.params,
          jsonBody: options.jsonBody,
          headers: { "x-action": action, "x-captcha-token": token }
        }, true);
        if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF09");
        if (status !== void 0 && status >= 200 && status < 300) {
          return body;
        }
        const error = this._responseError(status, body, action);
        if (!replaySafe && (status === void 0 || status >= 500)) {
          const message = `\u5199\u5165\u8BF7\u6C42\u7ED3\u679C\u672A\u77E5\uFF0C\u53EF\u80FD\u5DF2\u751F\u6548: ${error.message}`;
          if (path7 === "/v1/share/restore") {
            throw new RestoreOutcomeUnknown(message, { status, action, network: status === void 0 });
          }
          throw new MutationOutcomeUnknown(message, { status, action, network: status === void 0 });
        }
        if (error instanceof TrafficCapped) throw error;
        const problem = str(body.error_description || body.error || "");
        if ((status === 401 || status === 403) && problem.toLowerCase().includes("token")) {
          this._captchas.clear();
          await this.ensureSession(true);
          error.retryAfter = 0;
        }
        if (error.throttled) this._captchas.clear();
        throw error;
      } catch (error) {
        if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u8FDB\u5EA6\u5DF2\u4FDD\u5B58\uFF09");
        if (error instanceof PikpakError) {
          if (!error.transient || !error.replaySafe || error.retryExhausted) throw error;
          if (attempt + 1 === attempts) {
            error.retryExhausted = true;
            throw error;
          }
          const delay = error.retryAfter ?? (error.throttled ? THROTTLE_BACKOFF[attempt] : NETWORK_RETRY_WAITS[attempt]);
          this.log(`\u8BF7\u6C42\u6682\u65F6\u5931\u8D25\uFF1A${error.message}\uFF1B${delay}s \u540E\u91CD\u8BD5\uFF08${attempt + 2}/${attempts}\uFF09`, "warn");
          await sleepInterruptible(delay * 1e3, this.stop);
          continue;
        }
        throw error;
      }
    }
    throw new Error("attempts must be positive");
  }
  // --------------------------------------------------------------------- read
  about() {
    return this.call("GET", "/v1/about", { params: { with_quotas: "true", with_third_party_information: "false" } });
  }
  async space() {
    const quota = (await this.about()).quota ?? {};
    const limit = num(quota.limit);
    const usage = num(quota.usage);
    return {
      limit,
      usage,
      in_trash: num(quota.usage_in_trash),
      free: limit ? Math.max(limit - usage, 0) : 0
    };
  }
  async offlineTaskSlots() {
    const quota = (await this.about()).quotas?.cloud_download ?? {};
    return { limit: num(quota.limit), usage: num(quota.usage) };
  }
  async listFolder(parentId = "*", trashed = false) {
    const params = {
      limit: 200,
      order: 3,
      filters: JSON.stringify({ trashed: { eq: Boolean(trashed) } }),
      with_audit: "true"
    };
    if (parentId !== "*" && parentId !== "") params.parent_id = parentId;
    return this._paginate("/v1/files", params);
  }
  createFolder(name, parentId = "*") {
    return this.call("POST", "/v1/files", {
      jsonBody: { kind: "drive#folder", name, parent_id: parentId === "*" ? "" : parentId }
    });
  }
  async prepareWorkspace(name = CLOUD_FOLDER_NAME) {
    const folders = (await this.listFolder("*")).filter((item) => item.name === name && item.kind === "drive#folder");
    if (folders.length > 1) throw new PikpakError(`\u7F51\u76D8\u6839\u76EE\u5F55\u6709\u591A\u4E2A ${name} \u6587\u4EF6\u5939\uFF0C\u8BF7\u5148\u6574\u7406\u5230\u53EA\u5269\u4E00\u4E2A`);
    if (folders.length) return str(folders[0].id);
    const created = await this.createFolder(name);
    const file = created.file ?? created ?? {};
    const folderId = str(file.id);
    if (!folderId) throw new PikpakError(`\u521B\u5EFA\u7F51\u76D8\u6587\u4EF6\u5939 ${name} \u540E\u6CA1\u6709\u6536\u5230 ID`);
    return folderId;
  }
  file(fileId) {
    return this.call("GET", `/v1/files/${fileId}`);
  }
  async downloadUrl(fileId) {
    const data = await this.call("GET", `/v1/files/${fileId}`, { params: { usage: "FETCH" } });
    const links = data.links ?? {};
    const octet = links["application/octet-stream"] ?? {};
    const url = str(octet.url) || str(data.link?.url) || str(data.web_content_link);
    if (!url) throw new PikpakError(`\u53D6\u4E0D\u5230\u4E0B\u8F7D\u5730\u5740\uFF08\u8FD4\u56DE\u5B57\u6BB5 ${Object.keys(data).sort()}\uFF09`, { action: "GET:/drive/v1/files/<id>" });
    return {
      url,
      meta: {
        name: data.name,
        size: num(data.size),
        hash: data.hash,
        mime: data.mime_type,
        phase: data.phase
      }
    };
  }
  // -------------------------------------------------------------------- share
  shareInfo(shareId, passCode = "") {
    const params = { share_id: shareId, limit: 200, order: 3 };
    if (passCode) params.pass_code = passCode;
    return this.call("GET", "/v1/share", { params });
  }
  async shareChildren(shareId, passCodeToken, parentId) {
    const params = { share_id: shareId, pass_code_token: passCodeToken, limit: 200, order: 6 };
    if (parentId) params.parent_id = parentId;
    return this._paginate("/v1/share/detail", params);
  }
  node(item, prefix = "", parentId = "") {
    const params = item.params ?? {};
    const folder = isFolder(item);
    const name = str(item.name);
    return {
      id: item.id,
      name,
      prefix,
      parent_id: parentId,
      path: prefix ? `${prefix}/${name}` : name,
      is_folder: folder,
      size: num(item.size) || num(params.total_size),
      child_count: folder ? num(params.total_count) : void 0,
      hash: item.hash || null,
      mime: str(item.mime_type)
    };
  }
  async walkShare(shareId, passCode = "", maxNodes = 2e4, rootId = "") {
    const info = await this.shareInfo(shareId, passCode);
    const status = str(info.share_status);
    if (status && status !== "OK") {
      const reason = str(info.share_status_text) || "\u670D\u52A1\u7AEF\u672A\u63D0\u4F9B\u8BF4\u660E";
      throw new PikpakError(`\u5206\u4EAB\u4E0D\u53EF\u7528\uFF08${status}\uFF09\uFF1A${reason}`);
    }
    const token = str(info.pass_code_token);
    const nodes = [];
    for (const item of await this.shareChildren(shareId, token, rootId)) {
      nodes.push(this.node(item));
      if (nodes.length >= maxNodes) break;
    }
    if (!nodes.length) {
      const where = rootId ? "\u94FE\u63A5\u6307\u5B9A\u7684\u6587\u4EF6\u5939" : "\u5206\u4EAB\u6839\u76EE\u5F55";
      throw new PikpakError(`${where}\u8FD4\u56DE\u7A7A\u6E05\u5355\uFF0C\u65E0\u6CD5\u786E\u8BA4\u5206\u4EAB\u771F\u7684\u4E3A\u7A7A\uFF1B\u5DF2\u505C\u6B62\u5904\u7406\u6B64\u94FE\u63A5`);
    }
    const queue = nodes.filter((n) => n.is_folder).map((n) => [str(n.id), str(n.path)]);
    while (queue.length && nodes.length < maxNodes) {
      const [folderId, prefix] = queue.shift();
      for (const item of await this.shareChildren(shareId, token, folderId)) {
        const node = this.node(item, prefix, folderId);
        nodes.push(node);
        if (node.is_folder) queue.push([str(node.id), str(node.path)]);
        if (nodes.length >= maxNodes) break;
      }
    }
    return {
      share_id: shareId,
      title: info.title,
      pass_code_token: token,
      file_num: info.file_num,
      nodes,
      truncated: Boolean(queue.length) || nodes.length >= maxNodes
    };
  }
  // ------------------------------------------------------------------- change
  restore(shareId, passCodeToken, fileIds, parentId = "*") {
    return this.call("POST", "/v1/share/restore", {
      jsonBody: { share_id: shareId, pass_code_token: passCodeToken, file_ids: fileIds, parent_id: parentId },
      retries: 1
    });
  }
  task(taskId) {
    return this.call("GET", `/v1/tasks/${taskId}`);
  }
  batchTrash(ids) {
    return this.call("POST", "/v1/files:batchTrash", { jsonBody: { ids } });
  }
  batchDelete(ids) {
    return this.call("POST", "/v1/files:batchDelete", { jsonBody: { ids } });
  }
  async cleanup(ids) {
    const kept = ids.filter(Boolean);
    if (!kept.length) return {};
    await this.batchTrash(kept);
    return this.batchDelete(kept);
  }
  // ----------------------------------------------------------------  internal
  async _paginate(path7, params) {
    const out = [];
    let pageToken;
    while (true) {
      const request = { ...params };
      if (pageToken) request.page_token = pageToken;
      const body = await this.call("GET", path7, { params: request });
      for (const item of body.files ?? []) out.push(item);
      pageToken = str(body.next_page_token) || void 0;
      if (!pageToken) return out;
    }
  }
};

// tools/pikpak-get/backend/engine/crypto.ts
import { Buffer as Buffer2 } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from "node:crypto";
var PREFIX = "edt-kdf";
var VERSION = "v1";
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var KEY_LEN = 32;
var SALT_LEN = 16;
var NONCE_LEN = 12;
var TAG_LEN = 16;
function b64e(raw) {
  return raw.toString("base64url");
}
function b64d(text) {
  return Buffer2.from(text, "base64url");
}
function deriveKey(masterKey2, salt) {
  return scryptSync(masterKey2, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}
function aad(accountId, field) {
  return Buffer2.from(`pikpakget:${accountId}:${field}`, "utf8");
}
function seal(plain, masterKey2, accountId, field) {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const key = deriveKey(masterKey2, salt);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(accountId, field));
  const ct = Buffer2.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer2.concat([ct, tag]);
  return `${PREFIX}:${VERSION}:${b64e(salt)}:${b64e(nonce)}:${b64e(payload)}`;
}
function openSealed(envelope, masterKey2, accountId, field) {
  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== PREFIX || parts[1] !== VERSION) {
    throw new Error("unsupported secret envelope");
  }
  const salt = b64d(parts[2]);
  const nonce = b64d(parts[3]);
  const payload = b64d(parts[4]);
  const key = deriveKey(masterKey2, salt);
  const ct = payload.subarray(0, payload.length - TAG_LEN);
  const tag = payload.subarray(payload.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad(accountId, field));
  decipher.setAuthTag(tag);
  try {
    return Buffer2.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new Error("cannot decrypt secret (wrong master key or corrupted data)", { cause: error });
  }
}

// tools/pikpak-get/backend/engine/accounts.ts
var TRAFFIC_RETRY_SECONDS = 60 * 60;
var AccountStore = class {
  configDir;
  masterKey;
  fetchImpl;
  logger;
  stop;
  constructor(context) {
    this.configDir = context.configDir;
    this.masterKey = context.masterKey;
    this.fetchImpl = context.fetchImpl;
    this.logger = context.logger;
    this.stop = context.stop;
  }
  registryPath() {
    return path.join(this.configDir, "accounts.json");
  }
  accountDir(accountId) {
    return path.join(this.configDir, "accounts", accountId);
  }
  sessionFile(accountId) {
    return path.join(this.accountDir(accountId), "session.edt");
  }
  deviceFile(accountId) {
    return path.join(this.accountDir(accountId), "device_id.edt");
  }
  async loadRegistry() {
    try {
      const raw = await readFile(this.registryPath(), "utf8");
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  async saveRegistry(items) {
    const file = this.registryPath();
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(items, null, 1)}
`, "utf8");
    await rename(tmp, file);
  }
  async writeText(filePath, text) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, filePath);
  }
  async readText(filePath) {
    try {
      return (await readFile(filePath, "utf8")).trim();
    } catch {
      return null;
    }
  }
  sealSession(accountId, session) {
    return seal(JSON.stringify(session), this.masterKey, accountId, "session");
  }
  sealDevice(accountId, deviceId) {
    return seal(deviceId, this.masterKey, accountId, "device_id");
  }
  sealPassword(accountId, password) {
    return seal(password, this.masterKey, accountId, "password");
  }
  openSession(accountId, envelope) {
    return JSON.parse(openSealed(envelope, this.masterKey, accountId, "session"));
  }
  openDevice(accountId, envelope) {
    return openSealed(envelope, this.masterKey, accountId, "device_id");
  }
  openPassword(accountId, envelope) {
    return openSealed(envelope, this.masterKey, accountId, "password");
  }
  accountIdOf(userId) {
    return createHash2("sha256").update(String(userId)).digest("hex").slice(0, 24);
  }
  view(item) {
    const now = Date.now() / 1e3;
    const retryAt = item.traffic_capped_at ? item.traffic_capped_at + TRAFFIC_RETRY_SECONDS : null;
    return {
      id: item.id,
      label: item.label,
      traffic_capped_at: item.traffic_capped_at,
      created_at: item.created_at,
      updated_at: item.updated_at,
      traffic: {
        capped_at: item.traffic_capped_at,
        retry_at: retryAt,
        remaining: retryAt ? Math.max(retryAt - now, 0) : 0
      }
    };
  }
  async list() {
    return (await this.loadRegistry()).map((item) => this.view(item));
  }
  async login(label, password) {
    const items = await this.loadRegistry();
    const known = items.find((item2) => item2.label === label);
    if (items.filter((item2) => item2.label === label).length > 1) {
      throw new PikpakError(`\u8D26\u53F7\u540D\u79F0 ${label} \u91CD\u590D\uFF0C\u8BF7\u5148\u68C0\u67E5\u8D26\u53F7\u5217\u8868`);
    }
    let deviceId = randomUUID().replace(/-/g, "");
    if (known) {
      const envelope = await this.readText(this.deviceFile(known.id));
      if (!envelope) throw new PikpakError(`\u8D26\u53F7 ${label} \u7F3A\u5C11\u8BBE\u5907\u6307\u7EB9\uFF0C\u8BF7\u5148\u5220\u9664\u540E\u91CD\u65B0\u767B\u5F55`);
      deviceId = this.openDevice(known.id, envelope);
    }
    const client = new PikpakClient({
      fetchImpl: this.fetchImpl,
      deviceId,
      logger: this.logger,
      stop: this.stop
    });
    const session = await client.signIn(label, password);
    const userId = session.sub;
    if (!userId) throw new PikpakError("\u767B\u5F55\u54CD\u5E94\u6CA1\u6709\u7528\u6237 ID\uFF0C\u65E0\u6CD5\u5B89\u5168\u4FDD\u5B58\u591A\u8D26\u53F7\u4F1A\u8BDD");
    const accountId = this.accountIdOf(userId);
    if (known && known.id !== accountId) {
      throw new PikpakError("\u8BE5\u767B\u5F55\u540D\u79F0\u5BF9\u5E94\u7684\u670D\u52A1\u7AEF\u8D26\u53F7\u5DF2\u53D8\u5316\uFF1B\u8BF7\u5148\u9000\u51FA\u539F\u8D26\u53F7\u518D\u767B\u5F55");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const item = {
      id: accountId,
      label,
      password_sealed: this.sealPassword(accountId, password),
      traffic_capped_at: known?.traffic_capped_at ?? null,
      created_at: known?.created_at ?? now,
      updated_at: now
    };
    await this.writeText(this.sessionFile(accountId), this.sealSession(accountId, session));
    await this.writeText(this.deviceFile(accountId), this.sealDevice(accountId, deviceId));
    const rest = items.filter((entry) => entry.id !== accountId);
    rest.unshift(item);
    await this.saveRegistry(rest);
    return this.view(item);
  }
  async clientFor(accountId) {
    const items = await this.loadRegistry();
    const item = items.find((entry) => entry.id === accountId);
    if (!item) throw new PikpakError(`\u8D26\u53F7\u4E0D\u5B58\u5728\uFF1A${accountId}`);
    const sessionEnvelope = await this.readText(this.sessionFile(accountId));
    const deviceEnvelope = await this.readText(this.deviceFile(accountId));
    if (!sessionEnvelope || !deviceEnvelope) {
      throw new PikpakError(`\u8D26\u53F7 ${item.label} \u7F3A\u5C11\u4F1A\u8BDD\u6216\u8BBE\u5907\u6307\u7EB9\uFF1B\u8BF7\u91CD\u65B0\u767B\u5F55`);
    }
    const session = this.openSession(accountId, sessionEnvelope);
    const deviceId = this.openDevice(accountId, deviceEnvelope);
    return new PikpakClient({
      fetchImpl: this.fetchImpl,
      deviceId,
      session,
      logger: this.logger,
      stop: this.stop,
      onSession: (next) => {
        void this.writeText(this.sessionFile(accountId), this.sealSession(accountId, next));
      }
    });
  }
  async refresh(accountId) {
    const client = await this.clientFor(accountId);
    await client.ensureSession(true);
    const items = await this.loadRegistry();
    return this.view(items.find((entry) => entry.id === accountId));
  }
  async revealPassword(accountId) {
    const item = (await this.loadRegistry()).find((entry) => entry.id === accountId);
    if (!item) throw new PikpakError(`\u8D26\u53F7\u4E0D\u5B58\u5728\uFF1A${accountId}`);
    return this.openPassword(accountId, item.password_sealed);
  }
  async whoami(accountId) {
    const client = await this.clientFor(accountId);
    await client.ensureSession();
    const about = await client.about();
    const space = await client.space();
    const expires = String(about.expires_at ?? "").trim();
    return {
      usage: space.usage,
      limit: space.limit,
      in_trash: space.in_trash,
      free: space.free,
      expires_at: expires ? expires.split("T")[0] : ""
    };
  }
  async logout(accountId) {
    const items = await this.loadRegistry();
    const item = items.find((entry) => entry.id === accountId);
    if (!item) return false;
    await this.saveRegistry(items.filter((entry) => entry.id !== accountId));
    await rm(this.accountDir(accountId), { recursive: true, force: true });
    return true;
  }
  async trafficRetryAt(accountId) {
    const item = (await this.loadRegistry()).find((entry) => entry.id === accountId);
    if (!item?.traffic_capped_at) return 0;
    return item.traffic_capped_at + TRAFFIC_RETRY_SECONDS;
  }
  async markTrafficCapped(accountId) {
    const items = await this.loadRegistry();
    const item = items.find((entry) => entry.id === accountId);
    if (!item) return;
    item.traffic_capped_at = Date.now() / 1e3;
    item.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveRegistry(items);
  }
  async choose(excluded = /* @__PURE__ */ new Set(), only, respectCooldown = true) {
    const items = await this.loadRegistry();
    const candidates = only ? items.filter((item) => item.id === only) : items;
    const now = Date.now() / 1e3;
    for (const item of candidates) {
      if (excluded.has(item.id)) continue;
      if (respectCooldown) {
        const retryAt = item.traffic_capped_at ? item.traffic_capped_at + TRAFFIC_RETRY_SECONDS : 0;
        if (retryAt > now) continue;
      }
      return item.id;
    }
    return null;
  }
};

// tools/pikpak-get/backend/engine/links.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir4, readFile as readFile2, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import path4 from "node:path";

// tools/pikpak-get/backend/engine/pipeline.ts
import { Buffer as Buffer4 } from "node:buffer";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir as mkdir3, rename as rename2, rm as rm3, stat as stat2, writeFile as writeFile2 } from "node:fs/promises";
import path3 from "node:path";

// tools/pikpak-get/backend/engine/stream.ts
import { Buffer as Buffer3 } from "node:buffer";
import { createHash as createHash3 } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir as mkdir2, open, readdir, rm as rm2, stat } from "node:fs/promises";
import path2 from "node:path";
var CHUNK = 1 << 20;
var STALL_SECONDS = 90;
var DEFAULT_IDLE_TIMEOUT_MS = STALL_SECONDS * 1e3;
var PIECE_SIZES = [
  1 << 20,
  2 << 20,
  512 << 10,
  4 << 20,
  8 << 20,
  16 << 20,
  32 << 20,
  256 << 10,
  128 << 10,
  64 << 10
];
async function contentHash(filePath, piece) {
  const outer = createHash3("sha1");
  const stream = createReadStream(filePath, { highWaterMark: CHUNK });
  let buffer = Buffer3.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer3.concat([buffer, chunk]);
    while (buffer.length >= piece) {
      const block = buffer.subarray(0, piece);
      outer.update(createHash3("sha1").update(block).digest());
      buffer = buffer.subarray(piece);
    }
  }
  if (buffer.length) {
    outer.update(createHash3("sha1").update(buffer).digest());
  }
  return outer.digest("hex").toUpperCase();
}
async function verifyContent(filePath, expected, pieceSizes = PIECE_SIZES) {
  if (!expected) return null;
  const wanted = expected.toUpperCase();
  for (const piece of pieceSizes) {
    if (piece && await contentHash(filePath, piece) === wanted) return piece;
  }
  return null;
}
async function readAllBody(res, targetHandle, stop, idleTimeoutMs, onProgress) {
  if (!res.body) throw new PikpakError("\u4E0A\u6E38\u672A\u8FD4\u56DE\u6587\u4EF6\u6D41");
  const reader = res.body.getReader();
  const started = Date.now();
  let written = 0;
  let idleTimer = null;
  const arm = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => reader.cancel("idle-timeout").catch(() => void 0), idleTimeoutMs);
  };
  arm();
  try {
    while (true) {
      if (stop?.()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08.part \u5DF2\u4FDD\u7559\uFF09");
      let result;
      try {
        result = await reader.read();
      } catch (error) {
        if (String(error).includes("idle-timeout")) {
          throw new PikpakError(`\u4E0B\u8F7D\u8D85\u65F6\uFF1A${Math.round(idleTimeoutMs / 1e3)} \u79D2\u672A\u6536\u5230\u65B0\u6570\u636E`);
        }
        throw new PikpakError(`\u4E0B\u8F7D\u8FDE\u63A5\u4E2D\u65AD: ${error.message}`);
      }
      arm();
      if (result.done) break;
      if (result.value && result.value.length) {
        await targetHandle.write(result.value);
        written += result.value.length;
        onProgress?.(written, (Date.now() - started) / 1e3);
      }
    }
    return written;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
async function downloadStream(url, target, expectedSize, resumeFrom, options) {
  const { fetchImpl, onProgress, stop, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options;
  const headers = { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity" };
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    throw new PikpakError(`\u4E0B\u8F7D\u88AB\u62D2: HTTP ${res.status}`, { status: res.status, throttled: [403, 429, 503].includes(res.status) });
  }
  let written = resumeFrom;
  if (resumeFrom > 0 && res.status !== 206) written = 0;
  const handle = await open(target, written > 0 ? "a" : "w");
  try {
    written = await readAllBody(res, handle, stop, idleTimeoutMs, onProgress);
  } finally {
    await handle.close();
  }
  if (expectedSize && written !== expectedSize) {
    throw new PikpakError(`\u4E0B\u8F7D\u4E0D\u5B8C\u6574 ${written}/${expectedSize}`, { action: "download" });
  }
  return written;
}
async function downloadRange(url, target, start, end, options) {
  const { fetchImpl, onProgress, stop, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options;
  const headers = { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity", "Range": `bytes=${start}-${end}` };
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    throw new PikpakError(`\u4E0B\u8F7D\u88AB\u62D2: HTTP ${res.status}`, { status: res.status, throttled: [403, 429, 503].includes(res.status) });
  }
  if (res.status !== 206) throw new PikpakError("\u670D\u52A1\u5668\u4E0D\u652F\u6301 Range \u5206\u6BB5\uFF0C\u8BF7\u6539\u7528\u5355\u8FDE\u63A5");
  const want = end - start + 1;
  const handle = await open(target, "a");
  try {
    const written = await readAllBody(res, handle, stop, idleTimeoutMs, onProgress);
    if (written !== want) throw new PikpakError(`\u5206\u6BB5\u4E0D\u5B8C\u6574 ${written}/${want}`, { action: "download" });
    return written;
  } finally {
    await handle.close();
  }
}
async function downloadSegments(urlOf, target, total, connections, options) {
  const { fetchImpl, onProgress, stop, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options;
  if (connections <= 1) {
    const url = await urlOf();
    const have = await stat(target).then((s) => s.size).catch(() => 0);
    return downloadStream(url, target, total, have, options);
  }
  const segDir = `${target}.segs${connections}`;
  const parentDir = path2.dirname(target);
  const base = path2.basename(target);
  const entries = await readdir(parentDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(`${base}.segs`) && entry.name !== `${base}.segs${connections}`) {
      await rm2(path2.join(parentDir, entry.name), { recursive: true, force: true });
    }
  }
  await mkdir2(segDir, { recursive: true });
  const edges = Array.from({ length: connections + 1 }, (_, i) => Math.floor(total * i / connections));
  const segments = [];
  for (let i = 0; i < connections; i += 1) {
    const start = edges[i];
    const end = edges[i + 1] - 1;
    if (end < start) continue;
    segments.push({ index: i, start, end, want: end - start + 1, have: 0 });
  }
  for (const seg of segments) {
    const segPath = path2.join(segDir, String(seg.index).padStart(3, "0"));
    let have = await stat(segPath).then((s) => s.size).catch(() => 0);
    if (have > seg.want) {
      await rm2(segPath, { force: true });
      have = 0;
    }
    seg.have = have;
  }
  const report = () => {
    onProgress?.(segments.reduce((sum, seg) => sum + seg.have, 0), 0);
  };
  report();
  await Promise.all(segments.map(async (seg) => {
    if (seg.have >= seg.want) return;
    const segPath = path2.join(segDir, String(seg.index).padStart(3, "0"));
    const url = await urlOf();
    const initialHave = seg.have;
    const written = await downloadRange(url, segPath, seg.start + initialHave, seg.end, {
      fetchImpl,
      stop,
      idleTimeoutMs,
      onProgress: (w) => {
        seg.have = initialHave + w;
        report();
      }
    });
    seg.have = initialHave + written;
  }));
  report();
  for (const seg of segments) {
    if (seg.have < seg.want) throw new PikpakError(`\u5206\u6BB5 ${seg.index} \u672A\u5B8C\u6210 ${seg.have}/${seg.want}`, { action: "download" });
  }
  const out = await open(target, "w");
  try {
    for (const seg of segments) {
      const segPath = path2.join(segDir, String(seg.index).padStart(3, "0"));
      let remaining = seg.want;
      for await (const chunk of createReadStream(segPath)) {
        if (stop?.()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u7247\u6BB5\u5DF2\u4FDD\u7559\uFF09");
        if (remaining <= 0) break;
        const take = Math.min(chunk.length, remaining);
        await out.write(chunk.subarray(0, take));
        remaining -= take;
      }
      if (remaining) throw new PikpakError(`\u5206\u6BB5 ${seg.index} \u5B9E\u9645\u5B57\u8282\u4E0D\u8DB3 ${remaining}`, { action: "download" });
    }
  } finally {
    await out.close();
  }
  await rm2(segDir, { recursive: true, force: true });
  return total;
}

// tools/pikpak-get/backend/engine/pipeline.ts
var SPACE_HEADROOM = 4e8;
var POLL_INTERVAL = 4;
var POLL_TIMEOUT = 1800;
var MAX_ATTEMPTS = 3;
var QUARANTINE_SUFFIX = ".unverified";
var STATE_VERSION = 5;
function fileKey(linkKey, fileId) {
  return `${linkKey}	${fileId}`;
}
function human(nbytes) {
  let value = Number(nbytes) || 0;
  let unit = "B";
  for (const next of ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]) {
    unit = next;
    if (Math.abs(value) < 1024 || next === "PiB") break;
    value /= 1024;
  }
  return `${value.toFixed(1)}${unit}`;
}
function clipBytes(text, limit) {
  const encoded = Buffer4.from(text, "utf8");
  if (encoded.length <= limit) return text;
  return encoded.subarray(0, limit).toString("utf8");
}
function safeName(name, limit = 200) {
  let text = String(name).replace(/[/\0]/g, "_").trim();
  text = text.replace(/\s+/g, " ").trim();
  if (text === "." || text === "..") text = `_${text}`;
  if (text === ".pikpakget") text = `_${text}`;
  text = text.replace(/^ +| +$/g, "");
  if (Buffer4.byteLength(text, "utf8") > limit) {
    const dot = text.lastIndexOf(".");
    if (dot > 0) {
      const ext = text.slice(dot);
      const stem = text.slice(0, dot);
      const keep = Math.max(limit - Buffer4.byteLength(ext, "utf8") - 9, 8);
      text = `${clipBytes(stem, keep)}\u2026.${ext}`;
    } else {
      text = `${clipBytes(text, limit - 3)}\u2026`;
    }
  }
  return text || "untitled";
}
function parseSkipExt(text) {
  const exts = /* @__PURE__ */ new Set();
  for (const part of (text || "").split(",")) {
    const ext = part.trim().replace(/^\./, "").toLowerCase();
    if (ext) exts.add(ext);
  }
  return exts;
}
async function sizeOnDisk(filePath) {
  if (!filePath) return null;
  try {
    const info = await stat2(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
var State = class {
  path;
  root;
  data;
  constructor(statePath, root = null, readOnly = false) {
    this.path = statePath;
    this.root = root ? path3.resolve(root) : null;
    this.data = { version: STATE_VERSION, updated: null, links: {}, files: {} };
    if (statePath && existsSync(statePath)) {
      let loaded;
      try {
        loaded = JSON.parse(readFileSync(statePath, "utf8"));
      } catch (error) {
        if (readOnly) throw new PikpakError(`\u72B6\u6001\u6587\u4EF6\u8BFB\u4E0D\u4E86\uFF1A${statePath}\uFF08${error.message}\uFF09`);
        const backup = `${statePath}.corrupt-${Date.now()}`;
        try {
          copyFileSync(statePath, backup);
        } catch {
        }
        loaded = { version: STATE_VERSION, updated: null, links: {}, files: {} };
      }
      if (!loaded || loaded.version !== STATE_VERSION) {
        throw new PikpakError(`\u72B6\u6001\u7248\u672C\u4E0D\u53D7\u652F\u6301\uFF1A${statePath}\uFF1B\u8BF7\u81EA\u884C\u79FB\u8D70\u65E7\u6587\u4EF6\u540E\u91CD\u8DD1`);
      }
      if (typeof loaded.links !== "object" || typeof loaded.files !== "object") {
        throw new PikpakError(`\u72B6\u6001\u7ED3\u6784\u4E0D\u5B8C\u6574\uFF1A${statePath}\uFF1B\u8BF7\u5148\u68C0\u67E5\u6587\u4EF6`);
      }
      if (this.root) {
        for (const record of Object.values(loaded.files)) {
          record.local = this._absolute(record.local);
          record.home = this._absolute(record.home);
          record.quarantined = this._absolute(record.quarantined);
        }
      }
      this.data = loaded;
    }
  }
  _absolute(value) {
    if (value === null || value === void 0) return null;
    if (path3.isAbsolute(value)) throw new PikpakError(`\u8FDB\u5EA6\u6587\u4EF6\u5305\u542B\u975E\u76F8\u5BF9\u8DEF\u5F84\uFF1A${this.path}`);
    const abs = path3.resolve(this.root, value);
    if (!abs.startsWith(this.root)) throw new PikpakError(`\u8FDB\u5EA6\u6587\u4EF6\u8DEF\u5F84\u8D85\u51FA\u7CFB\u5217\u76EE\u5F55\uFF1A${this.path}`);
    return abs;
  }
  _relative(value) {
    if (value === null || value === void 0) return null;
    const abs = path3.resolve(value);
    if (!abs.startsWith(this.root)) throw new PikpakError(`\u672C\u5730\u6587\u4EF6\u8DEF\u5F84\u8D85\u51FA\u7CFB\u5217\u76EE\u5F55\uFF1A${abs}`);
    return path3.relative(this.root, abs).split(path3.sep).join("/");
  }
  link(linkKey) {
    return this.data.links[linkKey] ??= { status: "pending", attempts: 0 };
  }
  file(fileId, linkKey) {
    const key = linkKey !== null ? fileKey(linkKey, fileId) : fileId;
    if (linkKey === null && !this.data.files[key]) {
      const matches = Object.values(this.data.files).filter((rec) => rec.source_id === fileId);
      if (matches.length === 1) return matches[0];
    }
    return this.data.files[key] ??= {
      state: "pending",
      attempts: 0,
      link_key: linkKey,
      restored_id: null,
      source_id: fileId,
      local: null,
      home: null,
      quarantined: null,
      size: 0,
      seconds: null,
      error: null,
      verified_hash: null,
      verified_mtime: null
    };
  }
  filesOf(linkKey) {
    return Object.values(this.data.files).filter((rec) => rec.link_key === linkKey);
  }
  resetTransientFailures() {
    for (const record of Object.values(this.data.files)) {
      if (record.state === "failed" || record.state === "retry") {
        record.state = "pending";
        record.attempts = 0;
      }
    }
    for (const info of Object.values(this.data.links)) {
      if (info.status === "error") {
        info.status = "pending";
        info.attempts = 0;
      }
    }
  }
  async save() {
    if (!this.path) return;
    await mkdir3(path3.dirname(this.path), { recursive: true });
    this.data.updated = (/* @__PURE__ */ new Date()).toISOString();
    let serialized = this.data;
    if (this.root) {
      serialized = { ...this.data, files: {} };
      for (const [key, record] of Object.entries(this.data.files)) {
        serialized.files[key] = {
          ...record,
          local: this._relative(record.local),
          home: this._relative(record.home),
          quarantined: this._relative(record.quarantined)
        };
      }
    }
    const tmp = `${this.path}.tmp`;
    await writeFile2(tmp, `${JSON.stringify(serialized, null, 1)}
`, "utf8");
    await rename2(tmp, this.path);
  }
};
var Pipeline = class {
  args;
  client;
  log;
  stop;
  accountId;
  selectedFileIds;
  onProgress;
  state;
  created = /* @__PURE__ */ new Set();
  usedNames = /* @__PURE__ */ new Map();
  skipExt;
  filesDone = 0;
  bytesDone = 0;
  trafficCapped = false;
  hashHint = null;
  throttleHits = 0;
  authHits = 0;
  constructor(options) {
    this.args = options.args;
    this.client = options.client;
    this.log = options.log;
    this.stop = options.stop;
    this.accountId = options.accountId;
    this.selectedFileIds = options.selectedFileIds ?? null;
    this.onProgress = options.onProgress;
    this.state = new State(
      options.args.stateDir ? path3.join(options.args.stateDir, "state.json") : null,
      options.args.seriesRoot || null
    );
    this.skipExt = parseSkipExt(options.args.skipExt);
    for (const record of Object.values(this.state.data.files)) {
      if (record.restored_id && record.state !== "done" && record.state !== "too_big" && (!this.accountId || record.account_id === this.accountId)) {
        this.created.add(record.restored_id);
      }
      if (record.local) {
        this.usedNames.set(this.nameKey(path3.dirname(record.local), path3.basename(record.local)), record.source_id || record.path || "");
      }
    }
  }
  nameKey(dir, name) {
    return `${dir}\0${name.toLowerCase()}`;
  }
  async space() {
    return this.client.space();
  }
  async waitSpaceFreed(expectDrop, before, timeout = 150) {
    const floor = Math.max((before ?? 0) - expectDrop, 0);
    const tolerance = Math.max(expectDrop * 0.02, 2e6);
    const deadline = Date.now() + timeout * 1e3;
    while (Date.now() < deadline) {
      if (this.stop()) return null;
      const space = await this.space();
      if (space.usage <= floor + tolerance) return space;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL * 1e3));
    }
    return this.space();
  }
  async waitGap(seconds) {
    const deadline = Date.now() + seconds * 1e3;
    while (!this.stop()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
    }
    return true;
  }
  // ----------------------------------------------------------------- planning
  async inventory(job) {
    const walked = await this.client.walkShare(
      String(job.share_id),
      String(job.pass_code ?? ""),
      2e4,
      String(job.root_id ?? "")
    );
    const allNodes = walked.nodes;
    let files = allNodes.filter((node) => !node.is_folder);
    let skipped = 0;
    if (this.skipExt.size) {
      const kept = files.filter((node) => {
        const ext = path3.extname(node.name).replace(/^\./, "").toLowerCase();
        if (this.skipExt.has(ext)) {
          skipped += 1;
          return false;
        }
        return true;
      });
      files = kept;
    }
    return {
      title: String(walked.title ?? ""),
      token: String(walked.pass_code_token ?? ""),
      files,
      total: files.reduce((sum, node) => sum + node.size, 0),
      folder_nodes: allNodes.filter((node) => node.is_folder),
      skipped,
      truncated: Boolean(walked.truncated)
    };
  }
  // ------------------------------------------------------------- one file step
  async reuseOrRestore(job, node, record, token) {
    let restored = record.restored_id;
    if (this.accountId && record.account_id !== this.accountId) {
      restored = null;
      record.restored_id = null;
    }
    if (restored) {
      let exact = false;
      try {
        const info = await this.client.file(restored);
        exact = info.kind === "drive#file" && Number(info.size ?? 0) === node.size && !info.trashed;
      } catch {
        exact = false;
      }
      if (exact) {
        this.created.add(restored);
        return restored;
      }
      await this.forget([restored], node.size);
      record.restored_id = null;
    }
    return this.restoreOne(job, node, record, token);
  }
  async restoreOne(job, node, record, token) {
    if (!this.args.seriesRoot) throw new PikpakError("\u6CA1\u6709\u7F51\u76D8\u4E34\u65F6\u76EE\u5F55\uFF0C\u505C\u6B62\u8F6C\u5B58");
    const workspace = await this.client.prepareWorkspace();
    const before = new Set((await this.client.listFolder(workspace)).map((item) => String(item.id)));
    const made = await this.client.restore(String(job.share_id), token, [node.id], workspace);
    record.restore_task_id = made.restore_task_id;
    const status = String(made.restore_status ?? "");
    if (status.toUpperCase().includes("FAIL") || status.toUpperCase().includes("ERROR")) {
      throw new PikpakError(`\u8F6C\u5B58\u88AB\u62D2: ${status} ${JSON.stringify(made).slice(0, 200)}`);
    }
    const deadline = Date.now() + POLL_TIMEOUT * 1e3;
    while (true) {
      if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u4E91\u7AEF\u526F\u672C\u4E0E\u672C\u5730\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF09");
      const candidates = (await this.client.listFolder(workspace)).filter((item) => {
        if (before.has(String(item.id)) || item.kind !== "drive#file" || item.trashed) return false;
        if (node.size && Number(item.size ?? 0) !== node.size) return false;
        if (node.hash && item.hash && String(item.hash).toUpperCase() !== node.hash.toUpperCase()) return false;
        return true;
      });
      if (candidates.length > 1) throw new PikpakError("\u4E34\u65F6\u76EE\u5F55\u51FA\u73B0\u591A\u4E2A\u540C\u5927\u5C0F\u7684\u65B0\u6587\u4EF6\uFF0C\u65E0\u6CD5\u786E\u8BA4\u8F6C\u5B58\u526F\u672C");
      if (candidates.length === 1) {
        const restored = String(candidates[0].id);
        this.created.add(restored);
        record.restored_id = restored;
        record.account_id = this.accountId ?? null;
        await this.state.save();
        return restored;
      }
      if (Date.now() > deadline) throw new PikpakError(`\u8F6C\u5B58\u540E ${POLL_TIMEOUT / 60} \u5206\u949F\u5185\u6CA1\u770B\u5230\u65B0\u6587\u4EF6`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL * 1e3));
    }
  }
  async waitReady(fileId, expectSize) {
    const deadline = Date.now() + POLL_TIMEOUT * 1e3;
    while (Date.now() < deadline) {
      if (this.stop()) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u4E91\u7AEF\u526F\u672C\u4E0E\u672C\u5730\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF09");
      const info = await this.client.file(fileId);
      const phase = String(info.phase ?? "");
      const size = Number(info.size ?? 0);
      if (phase.toUpperCase().includes("FAIL")) throw new PikpakError(`\u4E91\u7AEF\u6587\u4EF6\u72B6\u6001\u5F02\u5E38 ${phase}`);
      if (phase.endsWith("COMPLETE") || expectSize && size === expectSize) {
        if (expectSize && size && size !== expectSize) throw new PikpakError(`\u4E91\u7AEF\u6587\u4EF6\u5927\u5C0F\u4E0D\u7B26 ${size} != ${expectSize}`);
        return info;
      }
      if (await this.waitGap(POLL_INTERVAL)) throw new PikpakError("\u5DF2\u4E2D\u65AD\uFF08\u4E91\u7AEF\u526F\u672C\u4E0E\u672C\u5730\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF09");
    }
    throw new PikpakError("\u7B49\u5F85\u4E91\u7AEF\u6587\u4EF6\u5C31\u7EEA\u8D85\u65F6");
  }
  destPath(node, destDir) {
    let name = safeName(node.name);
    const identity = node.id || node.path;
    const taken = this.usedNames.get(this.nameKey(destDir, name));
    if (taken && taken !== identity) {
      const parent = node.path.includes("/") ? node.path.split("/").slice(-2, -1)[0] ?? "" : "";
      name = safeName(parent ? `${parent} - ${node.name}` : node.path);
      let bump = 2;
      while (this.usedNames.get(this.nameKey(destDir, name)) && this.usedNames.get(this.nameKey(destDir, name)) !== identity) {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)} (${bump}).${name.slice(dot + 1)}` : `${name} (${bump})`;
        bump += 1;
      }
    }
    this.usedNames.set(this.nameKey(destDir, name), identity);
    return path3.join(destDir, name);
  }
  async ensureLocalDir(target) {
    const base = path3.resolve(this.args.dest);
    const resolved = path3.resolve(target);
    if (!resolved.startsWith(base)) throw new PikpakError(`\u76EE\u6807\u76EE\u5F55\u8D8A\u51FA\u4E0B\u8F7D\u5E93\uFF1A${target}`);
    await mkdir3(resolved, { recursive: true });
  }
  async fetchTo(fileId, node, destDir, record) {
    const final = this.destPath(node, destDir);
    const report = (written, elapsed) => {
      this.onProgress?.(node, written, elapsed);
    };
    let local;
    let how;
    try {
      const part = `${final}.part`;
      if (this.args.connections > 1 && node.size) {
        const got = await downloadSegments(
          () => this.client.downloadUrl(fileId).then((d) => d.url),
          part,
          node.size,
          this.args.connections,
          { fetchImpl: this.client.fetchImpl, stop: this.stop, onProgress: report }
        );
        if (got !== node.size) throw new PikpakError(`\u62FC\u88C5\u540E\u5927\u5C0F\u4E0D\u7B26 ${got}/${node.size}`);
        local = part;
        how = "transfer-ready";
      } else {
        const resume = await sizeOnDisk(part) ?? 0;
        const { url } = await this.client.downloadUrl(fileId);
        const written = await downloadStream(url, part, node.size, resume, {
          fetchImpl: this.client.fetchImpl,
          stop: this.stop,
          onProgress: report
        });
        if (node.size && written !== node.size) throw new PikpakError(`\u4E0B\u8F7D\u4E0D\u5B8C\u6574 ${written}/${node.size}`);
        local = part;
        how = "transfer-ready";
      }
    } catch (error) {
      if (error instanceof PikpakError && error.transient) throw error;
      throw error;
    }
    if (how === "transfer-ready") {
      return [await this.promote(local, final, node, record), "downloaded"];
    }
    return [local, how];
  }
  async existingMatches(filePath, node, record) {
    const size = await sizeOnDisk(filePath);
    if (size !== node.size) return false;
    if (!this.args.verify) return true;
    if (!node.hash) return true;
    if (record && record.verified_hash === node.hash && record.verified_mtime && record.hash_piece) {
      try {
        const info = await stat2(filePath);
        if (record.verified_mtime === Math.round(info.mtimeMs * 1e6)) return true;
      } catch {
        return false;
      }
    }
    const piece = await verifyContent(filePath, node.hash, record?.hash_piece ? [record.hash_piece, ...PIECE_SIZES.filter((s) => s !== record.hash_piece)] : PIECE_SIZES);
    if (piece === null) return false;
    if (record) {
      record.hash_piece = piece;
      record.verified_hash = node.hash;
      try {
        const info = await stat2(filePath);
        record.verified_mtime = Math.round(info.mtimeMs * 1e6);
      } catch {
      }
    }
    return true;
  }
  async promote(part, final, node, record) {
    const expected = node.hash;
    if (expected) {
      const piece = await verifyContent(part, expected, this.hashHint ? [this.hashHint, ...PIECE_SIZES.filter((s) => s !== this.hashHint)] : PIECE_SIZES);
      if (piece === null) {
        const reason = `\u4E91\u7AEF ${expected.slice(0, 16)}\u2026 \u65E0\u5019\u9009\u5206\u7247\u547D\u4E2D`;
        if (record && record.attempts >= MAX_ATTEMPTS) {
          return this.quarantine(part, reason, record, final);
        }
        await rm3(part, { force: true });
        throw new PikpakError(`\u5185\u5BB9 hash \u4E0E\u4E91\u7AEF\u4E0D\u7B26\uFF08${reason}\uFF09\uFF0C\u4E22\u5F03\u91CD\u4E0B`);
      }
      if (record) record.hash_piece = piece;
      this.hashHint = piece;
    }
    await rename2(part, final);
    if (expected && record) {
      try {
        const info = await stat2(final);
        record.verified_hash = expected;
        record.verified_mtime = Math.round(info.mtimeMs * 1e6);
      } catch {
      }
    }
    return final;
  }
  async quarantine(filePath, reason, record, home) {
    let doomed = `${home}${QUARANTINE_SUFFIX}`;
    if (existsSync(doomed)) doomed = `${doomed}-${Date.now()}`;
    await rename2(filePath, doomed);
    if (record) {
      record.state = "unverified";
      record.local = doomed;
      record.home = home;
      record.quarantined = doomed;
      record.hash_piece = null;
      record.verified_hash = null;
      record.verified_mtime = null;
      record.error = reason.slice(0, 300);
    }
    this.log(`\u5185\u5BB9\u6838\u5BF9\u4E0D\u8FC7\uFF08${reason}\uFF09\uFF0C\u5B57\u8282\u4FDD\u7559\u4E3A ${path3.basename(doomed)}`, "error");
    return doomed;
  }
  async forget(ids, size = 0) {
    const mine = ids.filter((id) => id && this.created.has(id));
    if (!mine.length || this.args.noDelete) return;
    const before = this.stop() ? null : (await this.space()).usage;
    await this.client.cleanup(mine);
    for (const id of mine) this.created.delete(id);
    if (before !== null && !this.stop()) {
      await this.waitSpaceFreed(size, before);
    }
  }
  /** 连续限流 / 连续 401/403 / 会话失效时，判断是否该停本轮（对应 Python 的 note_throttle）。 */
  noteThrottle(error) {
    if (!(error instanceof PikpakError)) return false;
    if (this.client.sessionDead) {
      this.log("\u4F1A\u8BDD\u7EED\u671F\u88AB\u670D\u52A1\u5668\u62D2\u7EDD\uFF0C\u505C\u6B62\u672C\u8F6E\uFF1A\u8BF7\u91CD\u65B0\u767B\u5F55\u540E\u91CD\u8DD1", "error");
      return true;
    }
    if (error instanceof TrafficCapped) {
      this.trafficCapped = true;
      return true;
    }
    const status = error.status;
    if (error.throttled || status === 429 || status === 503) {
      this.throttleHits += 1;
      if (this.throttleHits >= 3) {
        this.log("\u8FDE\u7EED 3 \u6B21\u88AB\u9650\u6D41\uFF0C\u505C\u6B62\u672C\u8F6E\u4EE5\u514D\u89E6\u53D1\u98CE\u63A7\uFF1B\u8BF7\u81F3\u5C11 1 \u5C0F\u65F6\u540E\u518D\u91CD\u8DD1", "error");
        return true;
      }
      return false;
    }
    if (status === 401 || status === 403) {
      this.authHits += 1;
      if (this.authHits >= 3) {
        this.log("\u8FDE\u7EED 3 \u6B21 HTTP 401/403 \u88AB\u62D2\uFF0C\u66F4\u50CF\u4F1A\u8BDD\u6216\u8D26\u53F7\u95EE\u9898\uFF1B\u8BF7\u91CD\u65B0\u767B\u5F55\u540E\u91CD\u8DD1", "error");
        return true;
      }
      this.log(`HTTP ${status} \u88AB\u62D2\uFF0C\u6309\u672C\u94FE\u63A5\u4E0D\u53EF\u7528\u5904\u7406\u540E\u7EE7\u7EED\uFF08\u8FDE\u7EED\u7B2C ${this.authHits}/3 \u6B21\uFF09`, "warn");
      return false;
    }
    return false;
  }
  async reclaimWorkspace(needed) {
    const workspace = await this.client.prepareWorkspace();
    const items = await this.client.listFolder(workspace);
    if (!items.length) return false;
    const ids = items.map((item) => String(item.id));
    const before = (await this.space()).usage;
    await this.client.cleanup(ids);
    for (const id of ids) this.created.delete(id);
    for (const record of Object.values(this.state.data.files)) {
      if (record.account_id === this.accountId && record.restored_id && ids.includes(record.restored_id)) {
        record.restored_id = null;
      }
    }
    await this.state.save();
    await this.waitSpaceFreed(items.reduce((sum, item) => sum + Number(item.size ?? 0), 0), before);
    const left = (await this.client.listFolder(workspace)).filter((item) => ids.includes(String(item.id)));
    if (left.length) throw new PikpakError(`Pack From Shared \u6E05\u7406\u540E\u4ECD\u6709 ${left.length} \u9879`);
    return (await this.space()).free >= needed;
  }
  // ----------------------------------------------------------------- runLink
  async runLink(job) {
    const key = String(job.key ?? job.url);
    const link = this.state.link(key);
    link.order = Number(job.order ?? 0);
    link.folder = String(job.folder ?? "");
    let report;
    try {
      report = await this.inventory(job);
    } catch (error) {
      if (this.stop()) {
        link.status = "partial";
        await this.state.save();
        return "stopped";
      }
      if (error instanceof PikpakError && error.transient && error.replaySafe) {
        link.status = "retry";
        link.error = error.message.slice(0, 300);
        await this.state.save();
        return "retry";
      }
      link.status = "error";
      link.error = error.message.slice(0, 300);
      link.attempts += 1;
      await this.state.save();
      return "error";
    }
    this.authHits = 0;
    let files = report.files.sort((a, b) => a.size - b.size);
    if (this.selectedFileIds) {
      files = files.filter((node) => this.selectedFileIds.has(node.id));
    }
    link.status = "active";
    link.folder = String(job.folder ?? "");
    link.title = String(report.title ?? "");
    link.total_bytes = Number(report.total ?? 0);
    link.file_count = files.length;
    link.truncated = Boolean(report.truncated);
    await this.state.save();
    const destDir = path3.join(this.args.dest, String(job.folder ?? ""));
    const folderNodes = report.folder_nodes;
    const folderPaths = /* @__PURE__ */ new Map([["", destDir]]);
    for (const folder of folderNodes) {
      const parent = folderPaths.get(folder.parent_id ?? "");
      if (!parent) throw new PikpakError(`\u5206\u4EAB\u6587\u4EF6\u5939\u7F3A\u5C11\u7236\u76EE\u5F55\uFF1A${folder.name.slice(0, 60)}`);
      folderPaths.set(folder.id, this.destPath(folder, parent));
    }
    for (const dir of folderPaths.values()) {
      try {
        await this.ensureLocalDir(dir);
      } catch (error) {
        link.status = "error";
        link.error = `\u5EFA\u7ACB\u672C\u5730\u76EE\u5F55\u5931\u8D25\uFF1A${error.message}`;
        await this.state.save();
        return "error";
      }
    }
    for (let position = 0; position < files.length; position += 1) {
      const node = files[position];
      if (this.stop()) {
        link.status = "partial";
        await this.state.save();
        return "stopped";
      }
      const record = this.state.file(node.id, key);
      if (record.state === "done") {
        continue;
      }
      const parentDir = folderPaths.get(node.parent_id ?? "");
      if (!parentDir) {
        link.status = "error";
        link.error = `\u6587\u4EF6\u7F3A\u5C11\u7236\u76EE\u5F55\uFF1A${node.path}`;
        await this.state.save();
        return "error";
      }
      const plannedLocal = this.destPath(node, parentDir);
      if (record.local !== plannedLocal && !(record.state === "unverified" && record.home === plannedLocal)) {
        record.state = "pending";
        record.local = plannedLocal;
        record.home = plannedLocal;
        record.quarantined = null;
        record.verified_hash = null;
        record.verified_mtime = null;
      }
      record.source_hash = node.hash;
      record.name = node.name;
      record.size = node.size;
      record.path = node.path;
      record.local = record.local || plannedLocal;
      if (await this.existingMatches(plannedLocal, node, record)) {
        if (record.state === "done") continue;
        await this.forget([record.restored_id ?? ""], node.size);
        record.local = plannedLocal;
        record.home = plannedLocal;
        record.state = "done";
        record.error = null;
        await this.state.save();
        continue;
      }
      if (record.state === "done" || record.state === "downloaded") record.state = "pending";
      if (!record.restored_id || record.account_id !== this.accountId) {
        record.restored_id = null;
      }
      const space = await this.space();
      const needed = node.size + SPACE_HEADROOM;
      if (space.limit && space.free < needed && record.restored_id) {
      } else if (space.limit && space.free < needed) {
        const reclaimed = await this.reclaimWorkspace(needed);
        if (!reclaimed) {
          record.state = "failed";
          record.error = "\u4E91\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u5F53\u524D\u6587\u4EF6\u65E0\u6CD5\u8F6C\u5B58";
          link.status = "partial";
          await this.state.save();
          continue;
        }
      }
      if (this.filesDone && this.args.gap) {
        if (await this.waitGap(this.args.gap)) {
          link.status = "partial";
          await this.state.save();
          return "stopped";
        }
      }
      if (this.stop()) {
        link.status = "partial";
        await this.state.save();
        return "stopped";
      }
      const started = Date.now();
      record.state = "restoring";
      record.attempts += 1;
      await this.state.save();
      try {
        const restored = await this.reuseOrRestore(job, node, record, String(report.token ?? ""));
        await this.waitReady(restored, node.size);
        const [local, how] = await this.fetchTo(restored, node, parentDir, record);
        if (how === "unverified") {
          await this.forget([restored], node.size);
          this.filesDone += 1;
          await this.state.save();
          continue;
        }
        record.state = "downloaded";
        record.local = local;
        record.seconds = Math.round((Date.now() - started) / 10) / 100;
        await this.state.save();
        await this.forget([restored], node.size);
        record.state = "done";
        record.error = null;
        if (record.quarantined && existsSync(record.quarantined)) {
          await rm3(record.quarantined, { force: true });
        }
        record.quarantined = null;
        await this.state.save();
        this.filesDone += 1;
        this.bytesDone += node.size;
        this.throttleHits = 0;
      } catch (error) {
        if (error instanceof MutationOutcomeUnknown) {
          record.attempts = Math.max(record.attempts - 1, 0);
          record.state = "retry";
          record.error = error.message.slice(0, 300);
          await this.state.save();
          return "throttled";
        }
        if (this.stop()) {
          record.state = "retry";
          record.error = error.message.slice(0, 300);
          link.status = "partial";
          await this.state.save();
          return "stopped";
        }
        if (error instanceof PikpakError && error.transient) {
          record.attempts = Math.max(record.attempts - 1, 0);
          record.state = "retry";
          record.error = error.message.slice(0, 300);
          link.status = "retry";
          await this.state.save();
          return "retry";
        }
        if (error instanceof TrafficCapped) {
          record.attempts = Math.max(record.attempts - 1, 0);
          record.state = "pending";
          this.trafficCapped = true;
          record.error = error.message.slice(0, 300);
          link.status = "partial";
          await this.state.save();
          return "throttled";
        }
        record.state = record.attempts >= MAX_ATTEMPTS ? "failed" : "retry";
        record.error = error.message.slice(0, 300);
        link.status = "partial";
        await this.state.save();
        try {
          await this.forget([record.restored_id ?? ""], node.size);
        } catch {
        }
        if (this.noteThrottle(error)) return "throttled";
        if (record.state === "failed") continue;
        return "retry";
      }
    }
    const pending = files.filter((node) => {
      const rec = this.state.data.files[fileKey(key, node.id)];
      return !rec || rec.state !== "done" && rec.state !== "too_big";
    });
    link.status = !pending.length && !report.truncated ? "done" : "incomplete";
    link.pending_files = pending.length;
    await this.state.save();
    return pending.length ? "incomplete" : "ok";
  }
  async run(jobs) {
    await mkdir3(this.args.dest, { recursive: true });
    this.state.resetTransientFailures();
    await this.state.save();
    for (let passNumber = 1; passNumber <= (this.args.repeat || 1); passNumber += 1) {
      let initialized = false;
      let transientFailures = 0;
      const tally = {};
      const tryInit = async () => {
        if (jobs.length && this.accountId) {
          await this.client.prepareWorkspace();
        }
        const space = await this.space();
        this.log(`\u4E91\u76D8 ${human(space.usage)}/${human(space.limit)} \u5DF2\u7528 | \u5E76\u53D1 ${this.args.connections} \u6BB5`);
        initialized = true;
      };
      try {
        await tryInit();
      } catch (error) {
        if (!(error instanceof PikpakError) || !error.transient || !error.replaySafe) throw error;
        transientFailures += 1;
        this.log(`\u4E0B\u8F7D\u51C6\u5907\u6682\u65F6\u5931\u8D25\uFF0C\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF1A${error.message}`, "warn");
      }
      if (initialized) {
        for (const job of jobs) {
          if (this.stop()) break;
          this.log(`\u2014 \u7B2C${passNumber}\u8F6E ${String(job.url)}`);
          const code = await this.runLink(job);
          tally[code] = (tally[code] ?? 0) + 1;
          if (code === "throttled" || this.stop()) break;
        }
      }
      if (this.stop()) return 1;
      if (tally.throttled) return this.trafficCapped ? 4 : 1;
      const unfinished = jobs.filter((job) => this.state.link(String(job.key ?? job.url)).status !== "done");
      if (!unfinished.length) return 0;
      if (transientFailures) {
        if (passNumber >= (this.args.repeat || 1)) break;
        const delay = [5, 15, 45, 120, 240][Math.min(passNumber - 1, 4)];
        this.log(`\u672C\u8F6E\u6709\u4E34\u65F6\u8BF7\u6C42\u5931\u8D25\uFF1B${delay}s \u540E\u8FDB\u5165\u4E0B\u4E00\u8F6E`, "warn");
        if (await this.waitGap(delay)) return 1;
        continue;
      }
      this.log(`${unfinished.length} \u4E2A\u94FE\u63A5\u672A\u5B8C\u6210\uFF0C\u8FDB\u5165\u4E0B\u4E00\u8F6E\u8865\u9F50`);
    }
    this.log("\u4ECD\u6709\u94FE\u63A5\u672A\u5B8C\u6210\uFF1B\u91CD\u8DD1\u540C\u4E00\u547D\u4EE4\u5373\u53EF\u4ECE\u65AD\u70B9\u7EE7\u7EED", "warn");
    return 1;
  }
};

// tools/pikpak-get/backend/engine/links.ts
var DEFAULT_FOLDER = "\u672A\u5206\u7EC4";
var LinkStore = class {
  constructor(configDir2) {
    this.configDir = configDir2;
  }
  configDir;
  linksPath() {
    return path4.join(this.configDir, "links.json");
  }
  async load() {
    try {
      const raw = await readFile2(this.linksPath(), "utf8");
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  async save(items) {
    const file = this.linksPath();
    await mkdir4(path4.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile3(tmp, `${JSON.stringify(items, null, 1)}
`, "utf8");
    await rename3(tmp, file);
  }
  async list() {
    return this.load();
  }
  async get(linkId) {
    return (await this.load()).find((item) => item.id === linkId) ?? null;
  }
  async add(url, folder, passCode) {
    const trimmed = (url || "").trim();
    if (!trimmed) throw new Error("\u5206\u4EAB\u94FE\u63A5\u4E0D\u80FD\u4E3A\u7A7A");
    const { shareId, passCode: urlPassCode } = parseShareUrl(trimmed);
    const items = await this.load();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const item = {
      id: randomUUID2().replace(/-/g, "").slice(0, 16),
      url: trimmed.split("?")[0].replace(/\/+$/, ""),
      title: "",
      folder: safeName(folder || DEFAULT_FOLDER),
      share_id: shareId,
      pass_code: passCode?.trim() || urlPassCode,
      root_id: shareRootId(trimmed),
      created_at: now,
      updated_at: now,
      parsed_at: null,
      parse_cache: null
    };
    items.unshift(item);
    await this.save(items);
    return item;
  }
  async update(linkId, patch) {
    const items = await this.load();
    const item = items.find((entry) => entry.id === linkId);
    if (!item) return null;
    if (patch.url !== void 0 && patch.url.trim()) {
      const trimmed = patch.url.trim();
      const { shareId, passCode: urlPassCode } = parseShareUrl(trimmed);
      item.url = trimmed.split("?")[0].replace(/\/+$/, "");
      item.share_id = shareId;
      item.root_id = shareRootId(trimmed);
      if (patch.passCode === void 0 && urlPassCode) item.pass_code = urlPassCode;
      item.parsed_at = null;
      item.parse_cache = null;
    }
    if (patch.folder !== void 0) item.folder = safeName(patch.folder);
    if (patch.title !== void 0) item.title = String(patch.title).slice(0, 200);
    if (patch.passCode !== void 0) {
      if (patch.passCode.trim() !== item.pass_code) {
        item.parsed_at = null;
        item.parse_cache = null;
      }
      item.pass_code = patch.passCode.trim();
    }
    item.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.save(items);
    return item;
  }
  async getParseCache(linkId) {
    const item = await this.get(linkId);
    if (!item?.parse_cache || !item.parsed_at) return null;
    return { cache: item.parse_cache, parsedAt: item.parsed_at };
  }
  async setParseCache(linkId, cache) {
    const items = await this.load();
    const item = items.find((entry) => entry.id === linkId);
    if (!item) throw new Error(`\u5206\u4EAB\u94FE\u63A5\u4E0D\u5B58\u5728\uFF1A${linkId}`);
    const parsedAt = (/* @__PURE__ */ new Date()).toISOString();
    item.parse_cache = cache;
    item.parsed_at = parsedAt;
    item.updated_at = parsedAt;
    await this.save(items);
    return parsedAt;
  }
  async remove(linkId) {
    const items = await this.load();
    const kept = items.filter((entry) => entry.id !== linkId);
    if (kept.length === items.length) return false;
    await this.save(kept);
    return true;
  }
};

// tools/pikpak-get/backend/engine/engine.ts
var MAX_LOG_LINES = 200;
var PikpakEngine = class {
  accounts;
  links;
  configDir;
  destDir;
  masterKey;
  stop;
  tasks = /* @__PURE__ */ new Map();
  stopFlags = /* @__PURE__ */ new Map();
  progressSamples = /* @__PURE__ */ new Map();
  queue = [];
  workerRunning = false;
  constructor(context) {
    this.configDir = context.configDir;
    this.destDir = context.destDir;
    this.masterKey = context.masterKey;
    this.stop = context.stop;
    this.accounts = new AccountStore(context);
    this.links = new LinkStore(context.configDir);
  }
  now() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  get destRoot() {
    return this.destDir;
  }
  publicTask(task) {
    return {
      ...task,
      files: Object.fromEntries(Object.entries(task.files).map(([key, value]) => [key, { ...value }])),
      logs: [...task.logs]
    };
  }
  // ------------------------------------------------------------------- tasks
  async createTask(linkId, fileIds, dest, accountId) {
    const link = await this.links.get(linkId);
    if (!link) throw new PikpakError(`\u5206\u4EAB\u94FE\u63A5\u4E0D\u5B58\u5728\uFF1A${linkId}`);
    const task = {
      id: `task-${Date.now()}-${randomUUID3().slice(0, 8)}`,
      link_id: linkId,
      file_ids: fileIds?.length ? fileIds : null,
      dest: (dest || this.destDir).trim(),
      account_id: accountId || null,
      status: "queued",
      current_file: null,
      files: {},
      logs: [],
      error: null,
      created_at: this.now(),
      updated_at: this.now()
    };
    this.tasks.set(task.id, task);
    this.stopFlags.set(task.id, { stopped: false });
    return this.publicTask(task);
  }
  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? this.publicTask(task) : null;
  }
  listTasks() {
    return [...this.tasks.values()].map((task) => this.publicTask(task));
  }
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    const flag = this.stopFlags.get(taskId);
    if (!task || !flag) return false;
    if (["done", "error", "cancelled"].includes(task.status)) return false;
    task.status = "cancelling";
    task.updated_at = this.now();
    flag.stopped = true;
    return true;
  }
  enqueue(taskId) {
    this.queue.push(taskId);
    void this.drainQueue();
  }
  async drainQueue() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (this.queue.length) {
        const taskId = this.queue.shift();
        try {
          await this.runTask(taskId);
        } catch (error) {
          this.finalize(taskId, "error", error.message);
          this.addLog(taskId, "error", error.message);
        }
      }
    } finally {
      this.workerRunning = false;
    }
  }
  addLog(taskId, level, message) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.logs.push({ ts: this.now(), level, message: String(message) });
    if (task.logs.length > MAX_LOG_LINES) task.logs = task.logs.slice(-MAX_LOG_LINES);
    task.updated_at = this.now();
  }
  setFileProgress(taskId, node, written) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const entry = task.files[node.id] ??= { node_id: node.id, name: node.name, size: node.size, downloaded: 0, speed: 0, eta: 0 };
    entry.downloaded = written;
    task.current_file = node.id;
    task.updated_at = this.now();
    const now = Date.now();
    const sample = this.progressSamples.get(taskId) ?? { lastBytes: 0, lastAt: now, lastSpeed: 0, lastEta: 0 };
    if (now - sample.lastAt >= 1e3) {
      const dt = (now - sample.lastAt) / 1e3;
      if (dt > 0) sample.lastSpeed = Math.max(0, (written - sample.lastBytes) / dt);
      const remaining = entry.size - written;
      sample.lastEta = sample.lastSpeed > 0 ? remaining / sample.lastSpeed : 0;
      sample.lastBytes = written;
      sample.lastAt = now;
    }
    entry.speed = Math.round(sample.lastSpeed);
    entry.eta = Math.round(sample.lastEta);
    this.progressSamples.set(taskId, sample);
  }
  finalize(taskId, status, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    task.updated_at = this.now();
    if (error) task.error = String(error).slice(0, 300);
  }
  async parseLink(linkId, force = false) {
    const link = await this.links.get(linkId);
    if (!link) throw new PikpakError(`\u5206\u4EAB\u94FE\u63A5\u4E0D\u5B58\u5728\uFF1A${linkId}`);
    let title = "";
    let fileNum = null;
    let truncated = false;
    let nodes = [];
    let parsedAt = null;
    const cached = force ? null : await this.links.getParseCache(linkId);
    if (cached) {
      title = cached.cache.title;
      fileNum = cached.cache.file_num;
      truncated = cached.cache.truncated;
      nodes = cached.cache.nodes;
      parsedAt = cached.parsedAt;
    } else {
      const accountId = await this.accounts.choose(/* @__PURE__ */ new Set(), void 0, false);
      if (!accountId) throw new PikpakError("\u6CA1\u6709\u53EF\u7528\u8D26\u53F7\uFF1B\u8BF7\u5148\u767B\u5F55");
      const client = await this.accounts.clientFor(accountId);
      await client.ensureSession();
      const walked = await client.walkShare(link.share_id, link.pass_code, 2e4, link.root_id);
      title = String(walked.title ?? "");
      fileNum = walked.file_num != null ? Number(walked.file_num) : null;
      truncated = Boolean(walked.truncated);
      nodes = walked.nodes;
      const cache = { title, file_num: fileNum, truncated, nodes };
      parsedAt = await this.links.setParseCache(linkId, cache);
    }
    await this.markDownloaded(nodes, link);
    return { link_id: linkId, title, file_num: fileNum, truncated, nodes, parsed_at: parsedAt };
  }
  /** 读对应系列的 state.json，给每个文件节点标记「是否已下载」与「文件是否真实存在」。 */
  async markDownloaded(nodes, link) {
    const seriesRoot = path5.join(this.destDir, link.folder);
    const statePath = path5.join(seriesRoot, ".pikpakget", "state.json");
    let data = null;
    try {
      data = JSON.parse(await readFile3(statePath, "utf8"));
    } catch {
      return;
    }
    const files = data?.files ?? {};
    for (const raw of nodes) {
      const node = raw;
      if (node.is_folder) continue;
      const record = files[`${link.url}	${node.id}`];
      node.downloaded = record?.state === "done";
      node.exists = record?.state === "done" ? Boolean(record.local && existsSync2(path5.join(seriesRoot, record.local))) : false;
    }
  }
  /** 删除指定文件的已下载记录（重置为未下载），返回删除条数。 */
  async resetRecords(linkId, fileIds) {
    const link = await this.links.get(linkId);
    if (!link) throw new PikpakError(`\u5206\u4EAB\u94FE\u63A5\u4E0D\u5B58\u5728\uFF1A${linkId}`);
    const statePath = path5.join(this.destDir, link.folder, ".pikpakget", "state.json");
    let data = null;
    try {
      data = JSON.parse(await readFile3(statePath, "utf8"));
    } catch {
      return 0;
    }
    const files = data?.files ?? {};
    const wanted = new Set(fileIds);
    let count = 0;
    for (const [key, record] of Object.entries(files)) {
      if (wanted.has(String(record.source_id ?? ""))) {
        delete files[key];
        count += 1;
      }
    }
    if (count > 0) {
      await mkdir5(path5.dirname(statePath), { recursive: true });
      await writeFile4(statePath, `${JSON.stringify(data, null, 1)}
`, "utf8");
    }
    return count;
  }
  /** 导出引擎数据（账号库密文 + 链接库 + 主密钥），用于本机↔NAS 迁移。 */
  async exportData() {
    const files = {};
    const readText = async (filePath) => {
      try {
        return await readFile3(filePath, "utf8");
      } catch {
        return "";
      }
    };
    const accountsJson = await readText(path5.join(this.configDir, "accounts.json"));
    if (accountsJson) files["accounts.json"] = accountsJson;
    const linksJson = await readText(path5.join(this.configDir, "links.json"));
    if (linksJson) files["links.json"] = linksJson;
    const accountsDir = path5.join(this.configDir, "accounts");
    try {
      const entries = await readdir2(accountsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        for (const name of ["session.edt", "device_id.edt"]) {
          const content = await readText(path5.join(accountsDir, entry.name, name));
          if (content) files[`accounts/${entry.name}/${name}`] = content;
        }
      }
    } catch {
    }
    return {
      format: "pikpak-get-export",
      version: 1,
      masterKey: this.masterKey,
      files,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  /** 导入引擎数据（写回 config 目录的密文文件）；masterKey 存在时写 <config>/master.key 供下次启动采用。 */
  async importData(files, masterKey2) {
    let count = 0;
    for (const [rel, content] of Object.entries(files)) {
      if (typeof content !== "string") continue;
      const segments = rel.split("/").filter((part) => part && part !== "." && part !== "..");
      if (segments.length === 0) throw new PikpakError("\u5BFC\u5165\u6570\u636E\u5305\u542B\u975E\u6CD5\u8DEF\u5F84");
      const target = path5.join(this.configDir, ...segments);
      if (!target.startsWith(this.configDir)) throw new PikpakError("\u5BFC\u5165\u6570\u636E\u5305\u542B\u8D8A\u754C\u8DEF\u5F84");
      await mkdir5(path5.dirname(target), { recursive: true });
      await writeFile4(target, content, "utf8");
      count += 1;
    }
    if (masterKey2) {
      await writeFile4(path5.join(this.configDir, "master.key"), masterKey2, "utf8");
    }
    return count;
  }
  async runTask(taskId) {
    const task = this.tasks.get(taskId);
    const flag = this.stopFlags.get(taskId);
    if (!task || !flag) return;
    const link = await this.links.get(task.link_id);
    if (!link) {
      this.finalize(taskId, "error", "\u5206\u4EAB\u94FE\u63A5\u4E0D\u5B58\u5728");
      return;
    }
    task.status = "running";
    task.updated_at = this.now();
    this.addLog(taskId, "info", `\u5F00\u59CB\u4E0B\u8F7D\uFF1A${link.url}`);
    const dest = task.dest || this.destDir;
    const seriesRoot = `${dest}/${link.folder}`;
    const args = {
      dest,
      seriesRoot,
      stateDir: `${seriesRoot}/.pikpakget`,
      connections: 1,
      gap: 20,
      repeat: 3,
      maxFiles: 0,
      skipExt: "",
      verify: false,
      noDelete: false
    };
    const job = {
      url: link.url,
      share_id: link.share_id,
      pass_code: link.pass_code,
      folder: link.folder,
      root_id: link.root_id,
      order: 1,
      key: link.url
    };
    const selected = task.file_ids ? new Set(task.file_ids) : null;
    const logDir = `${seriesRoot}/.pikpakget`;
    const logFile = path5.join(logDir, `grab-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.log`);
    await mkdir5(logDir, { recursive: true });
    const log = (message, level) => {
      const lvl = level ?? "info";
      this.addLog(taskId, lvl, message);
      const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${lvl.toUpperCase().padEnd(4, " ")} ${message}
`;
      void appendFile(logFile, line, "utf8").catch(() => void 0);
    };
    const stop = () => flag.stopped || this.stop?.() === true;
    const onProgress = (node, written) => this.setFileProgress(taskId, node, written);
    const excluded = /* @__PURE__ */ new Set();
    while (true) {
      if (stop()) {
        this.finalize(taskId, "cancelled");
        return;
      }
      const accountId = await this.accounts.choose(excluded, task.account_id ?? void 0, true);
      if (!accountId) {
        this.finalize(taskId, "error", "\u6CA1\u6709\u53EF\u7528\u8D26\u53F7\uFF08\u53EF\u80FD\u5168\u90E8\u5728\u6D41\u91CF\u51B7\u5374\u4E2D\uFF09");
        return;
      }
      let client;
      try {
        client = await this.accounts.clientFor(accountId);
      } catch (error) {
        this.addLog(taskId, "error", `\u8D26\u53F7\u521D\u59CB\u5316\u5931\u8D25\uFF1A${error.message}`);
        excluded.add(accountId);
        continue;
      }
      this.addLog(taskId, "info", `\u4F7F\u7528\u8D26\u53F7 ${accountId} \u4E0B\u8F7D`);
      const pipeline = new Pipeline({
        args,
        client,
        log,
        stop,
        accountId,
        selectedFileIds: selected,
        onProgress
      });
      let code;
      try {
        code = await pipeline.run([job]);
      } catch (error) {
        this.finalize(taskId, "error", error.message);
        this.addLog(taskId, "error", error.message);
        return;
      }
      if (stop()) {
        this.finalize(taskId, "cancelled");
        return;
      }
      if (code === 4) {
        await this.accounts.markTrafficCapped(accountId);
        this.addLog(taskId, "warn", `\u8D26\u53F7 ${accountId} \u4E0B\u884C\u6D41\u91CF\u5DF2\u6EE1\uFF0C1 \u5C0F\u65F6\u540E\u91CD\u8BD5\uFF1B\u5C1D\u8BD5\u4E0B\u4E00\u4E2A\u8D26\u53F7`);
        excluded.add(accountId);
        continue;
      }
      if (code === 0) {
        this.addLog(taskId, "info", "\u4EFB\u52A1\u5B8C\u6210");
        this.finalize(taskId, "done");
      } else {
        this.addLog(taskId, "warn", "\u4ECD\u6709\u6587\u4EF6\u672A\u5B8C\u6210\uFF1B\u53EF\u91CD\u65B0\u53D1\u8D77\u4EFB\u52A1\u7EED\u4F20\uFF08\u5DF2\u5B8C\u6210\u6587\u4EF6\u4F1A\u88AB\u8DF3\u8FC7\uFF09");
        this.finalize(taskId, "partial");
      }
      return;
    }
  }
};

// tools/pikpak-get/backend/engine/service.ts
import { Buffer as Buffer5 } from "node:buffer";
import { createServer } from "node:http";
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer5.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
function str2(value) {
  return typeof value === "string" ? value : "";
}
function createEngineService(options) {
  const { engine: engine2, token } = options;
  return createServer(async (req, res) => {
    try {
      const header = req.headers.authorization ?? "";
      const provided = header.replace(/^Bearer\s+/i, "").trim();
      if (!token || provided !== token) {
        sendJson(res, 401, { detail: "invalid token" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const parts = pathname.split("/").filter(Boolean);
      const route = (segments) => {
        if (segments.length !== parts.length) return null;
        const params = {};
        for (let i = 0; i < segments.length; i += 1) {
          if (segments[i].startsWith(":")) params[segments[i].slice(1)] = parts[i];
          else if (segments[i] !== parts[i]) return null;
        }
        return params;
      };
      try {
        if (method === "GET" && route(["auth", "check"])) {
          return sendJson(res, 200, {
            name: "pikpak-get-engine",
            version: "0.2.0",
            dest: engine2.destRoot,
            accounts: (await engine2.accounts.list()).length,
            links: (await engine2.links.list()).length
          });
        }
        if (method === "GET" && route(["accounts"])) return sendJson(res, 200, await engine2.accounts.list());
        if (method === "POST" && route(["accounts", "login"])) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, await engine2.accounts.login(str2(body.label), str2(body.password)));
        }
        const accountParam = route(["accounts", ":id", "refresh"]);
        if (method === "POST" && accountParam) return sendJson(res, 200, await engine2.accounts.refresh(accountParam.id));
        const revealParam = route(["accounts", ":id", "reveal-password"]);
        if (method === "POST" && revealParam) return sendJson(res, 200, { password: await engine2.accounts.revealPassword(revealParam.id) });
        const whoamiParam = route(["accounts", ":id", "whoami"]);
        if (method === "GET" && whoamiParam) return sendJson(res, 200, await engine2.accounts.whoami(whoamiParam.id));
        const deleteAccountParam = route(["accounts", ":id"]);
        if (method === "DELETE" && deleteAccountParam) return sendJson(res, 200, { deleted: await engine2.accounts.logout(deleteAccountParam.id) });
        if (method === "GET" && route(["links"])) return sendJson(res, 200, await engine2.links.list());
        if (method === "POST" && route(["links"])) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, await engine2.links.add(str2(body.url), typeof body.folder === "string" ? body.folder : void 0, typeof body.passCode === "string" ? body.passCode : void 0));
        }
        const linkParam = route(["links", ":id"]);
        if (method === "PATCH" && linkParam) {
          const body = await readJsonBody(req);
          const updated = await engine2.links.update(linkParam.id, { title: typeof body.title === "string" ? body.title : void 0, folder: typeof body.folder === "string" ? body.folder : void 0, passCode: typeof body.passCode === "string" ? body.passCode : void 0, url: typeof body.url === "string" ? body.url : void 0 });
          return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { detail: "link not found" });
        }
        if (method === "DELETE" && linkParam) return sendJson(res, 200, { deleted: await engine2.links.remove(linkParam.id) });
        const parseParam = route(["links", ":id", "parse"]);
        if (method === "POST" && parseParam) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, await engine2.parseLink(parseParam.id, body.force === true));
        }
        const resetParam = route(["links", ":id", "reset-records"]);
        if (method === "POST" && resetParam) {
          const body = await readJsonBody(req);
          const ids = Array.isArray(body.file_ids) ? body.file_ids.map(String) : [];
          return sendJson(res, 200, { reset: await engine2.resetRecords(resetParam.id, ids) });
        }
        if (method === "GET" && route(["export"])) return sendJson(res, 200, await engine2.exportData());
        if (method === "POST" && route(["import"])) {
          const body = await readJsonBody(req);
          const files = body.files ?? {};
          const masterKey2 = typeof body.masterKey === "string" ? body.masterKey : void 0;
          const count = await engine2.importData(files, masterKey2);
          return sendJson(res, 200, { imported: count });
        }
        if (method === "GET" && route(["tasks"])) return sendJson(res, 200, engine2.listTasks());
        const taskParam = route(["tasks", ":id"]);
        if (method === "GET" && taskParam) {
          const task = engine2.getTask(taskParam.id);
          return task ? sendJson(res, 200, task) : sendJson(res, 404, { detail: "task not found" });
        }
        if (method === "POST" && route(["tasks"])) {
          const body = await readJsonBody(req);
          const task = await engine2.createTask(
            str2(body.link_id),
            Array.isArray(body.file_ids) ? body.file_ids.map(String) : null,
            typeof body.dest === "string" ? body.dest : null,
            typeof body.account_id === "string" ? body.account_id : null
          );
          engine2.enqueue(task.id);
          return sendJson(res, 200, task);
        }
        const cancelParam = route(["tasks", ":id", "cancel"]);
        if (method === "POST" && cancelParam) return sendJson(res, 200, { cancelled: engine2.cancelTask(cancelParam.id) });
        sendJson(res, 404, { detail: "not found" });
      } catch (error) {
        sendJson(res, 400, { detail: error.message });
      }
    } catch (error) {
      sendJson(res, 500, { detail: error.message });
    }
  });
}

// tools/pikpak-get/backend/engine/service-entry.ts
function env(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}
var configDir = env("PIKPAK_ENGINE_CONFIG_DIR", "/config");
var masterKey = "";
try {
  masterKey = readFileSync2(path6.join(configDir, "master.key"), "utf8").trim();
} catch {
  masterKey = env("PIKPAK_ENGINE_MASTER_KEY");
}
if (!masterKey) {
  console.error("PIKPAK_ENGINE_MASTER_KEY is required");
  process.exit(1);
}
var engine = new PikpakEngine({
  configDir,
  destDir: env("PIKPAK_DEST", "/downloads"),
  masterKey
  // 不传 fetchImpl：NAS 用 Node 22 全局 fetch（undici）。
});
var service = createEngineService({
  engine,
  token: env("PIKPAK_ENGINE_TOKEN")
});
var port = Number(env("PIKPAK_ENGINE_PORT", "8787"));
service.listen(port, "0.0.0.0", () => {
  console.error(`pikpak-get-engine listening on :${port}`);
});
