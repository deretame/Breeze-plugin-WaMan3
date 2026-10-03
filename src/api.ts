import axios, { type AxiosResponse } from "axios";
import { cache, pluginConfig } from "breeze-plugin-kit";
import { apiDecrypt, generateHeaders } from "./crypto";

const DEFAULT_BASE_URL = "http://mseeowpm.pro";
const BASE_URL_CACHE_KEY = "manwa3_base_url";

const CANDIDATE_BASE_URLS = [
  DEFAULT_BASE_URL,
  "http://mseeowpm1.xyz",
  "http://mseeowpm2.cc",
  "https://mseeowpma.cc",
  "https://manwa.me",
];

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 12; PGT-AN20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 mwa-1.1.27+1 (Android/12 HONOR/PGT-AN20)";

export const AUTH_ACCOUNT_CONFIG_KEY = "auth.account";
export const AUTH_PASSWORD_CONFIG_KEY = "auth.password";
export const CONTENT_MODE_CONFIG_KEY = "content.mode";
const AUTH_COOKIE_CONFIG_KEY = "auth.cookie";
const AUTH_UID_CONFIG_KEY = "auth.uid";
const AUTH_SSID_CONFIG_KEY = "auth.ssid";

export type ContentMode = "all" | "bl" | "adult" | "normal" | "tl" | "gl";

export const DEFAULT_CONTENT_MODE: ContentMode = "all";

const CONTENT_MODE_GENDERS: Record<Exclude<ContentMode, "all">, number> = {
  bl: 0,
  adult: 1,
  normal: 2,
  tl: 3,
  gl: 4,
};

type ManwaLoginData = {
  uid?: string | number;
  ssid?: string;
};

export type AuthState = {
  account: string;
  uid: string;
  loggedIn: boolean;
};

/**
 * 读取持久化配置项。
 * pluginConfig.load 返回 '{"ok":true,"value":...}' 格式，需要解析两层。
 */
function decodeConfigValue(raw: unknown, fallback = ""): string {
  if (raw === undefined || raw === null) return fallback;

  if (typeof raw === "object") {
    const map = raw as Record<string, unknown>;
    if (map.ok === true && "value" in map) {
      return decodeConfigValue(map.value, fallback);
    }
    return fallback;
  }

  const text = String(raw);
  if (!text.trim()) return fallback;

  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).ok === true &&
      "value" in (parsed as Record<string, unknown>)
    ) {
      return decodeConfigValue(
        (parsed as Record<string, unknown>).value,
        fallback,
      );
    }
    if (
      typeof parsed === "string" ||
      typeof parsed === "number" ||
      typeof parsed === "boolean"
    ) {
      return String(parsed);
    }
  } catch {
    // pluginConfig may return the raw string for older runtimes
  }

  return text;
}

async function loadConfig(key: string, fallback = ""): Promise<string> {
  try {
    const raw = await pluginConfig.load(key, fallback);
    return decodeConfigValue(raw, fallback);
  } catch {
    return fallback;
  }
}

async function saveConfig(key: string, value: string): Promise<void> {
  await pluginConfig.save(key, value);
}

export function normalizeContentMode(value: unknown): ContentMode {
  const text = String(value ?? "").trim().toLowerCase();
  switch (text) {
    case "bl":
    case "0":
      return "bl";
    case "adult":
    case "18":
    case "1":
      return "adult";
    case "normal":
    case "bg":
    case "2":
      return "normal";
    case "tl":
    case "3":
      return "tl";
    case "gl":
    case "4":
      return "gl";
    default:
      return DEFAULT_CONTENT_MODE;
  }
}

export function contentModeToGender(
  mode: unknown,
  allGender: -2 | -1,
): number {
  const normalized = normalizeContentMode(mode);
  return normalized === "all"
    ? allGender
    : CONTENT_MODE_GENDERS[normalized];
}

export async function loadContentMode(): Promise<ContentMode> {
  return normalizeContentMode(
    await loadConfig(CONTENT_MODE_CONFIG_KEY, DEFAULT_CONTENT_MODE),
  );
}

export async function saveContentMode(value: unknown): Promise<ContentMode> {
  const mode = normalizeContentMode(value);
  await saveConfig(CONTENT_MODE_CONFIG_KEY, mode);
  return mode;
}

export async function loadAuthCredentials(): Promise<{
  account: string;
  password: string;
}> {
  const [account, password] = await Promise.all([
    loadConfig(AUTH_ACCOUNT_CONFIG_KEY),
    loadConfig(AUTH_PASSWORD_CONFIG_KEY),
  ]);
  return { account, password };
}

export async function getAuthState(): Promise<AuthState> {
  const [account, uid, cookie] = await Promise.all([
    loadConfig(AUTH_ACCOUNT_CONFIG_KEY),
    loadConfig(AUTH_UID_CONFIG_KEY),
    loadConfig(AUTH_COOKIE_CONFIG_KEY),
  ]);
  return {
    account,
    uid,
    loggedIn: Boolean(cookie),
  };
}

const COOKIE_ATTRIBUTE_NAMES: Record<string, true> = {
  expires: true,
  "max-age": true,
  path: true,
  domain: true,
  secure: true,
  httponly: true,
  samesite: true,
};

function isCookieAttributePair(pair: string): boolean {
  const name = pair.split("=", 1)[0].trim().toLowerCase();
  return name in COOKIE_ATTRIBUTE_NAMES;
}

/**
 * 从一个或多个 Set-Cookie 值中提取 `name=value` 对。
 * 数组元素各自独立（axios fetch adapter 的 getSetCookie() 即如此）；
 * 字符串形式（多个 cookie 用逗号连接）里 Expires 日期也含逗号，
 * 不能按逗号切——按“非属性名的新 pair 即新 cookie”切分。
 */
function cookiePairs(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const pairs: string[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const sub of item) visit(sub);
      return;
    }
    if (typeof item !== "string") return;
    // 先按逗号粗切（Expires 日期会被误切：`Fri` 碎片无等号被丢弃，
    // `09-Oct-...` 段按 expires 属性名丢弃）。
    for (const segment of item.split(",")) {
      const pair = segment.split(";", 1)[0].trim();
      if (!/^[^=;\s]+=[^;]*$/.test(pair)) continue;
      if (isCookieAttributePair(pair)) continue;
      pairs.push(pair);
    }
  };
  for (const item of values) visit(item);
  return pairs;
}

function mergeCookieHeaders(...values: unknown[]): string {
  const merged = new Map<string, string>();
  for (const pair of cookiePairs(values)) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    merged.set(pair.slice(0, separator), pair);
  }
  return [...merged.values()].join("; ");
}

function readSetCookieHeaders(headers: unknown): string {
  if (!headers || typeof headers !== "object") return "";

  const candidate = headers as {
    get?: (name: string) => unknown;
    getSetCookie?: () => unknown;
    toJSON?: () => Record<string, unknown>;
    [key: string]: unknown;
  };

  // AxiosHeaders 的方法依赖 this，必须绑定后调用，不能裸调用。
  // 多个来源（getSetCookie/get/toJSON/下标）指向同一组值，去重后只取一份。
  const seen = new Set<string>();
  const sources: unknown[] = [];
  const addSource = (value: unknown): void => {
    if (value === undefined || value === null) return;
    const key = JSON.stringify(value) ?? String(value);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(value);
  };
  if (typeof candidate.getSetCookie === "function") {
    addSource(candidate.getSetCookie.call(candidate));
  }
  if (typeof candidate.get === "function") {
    addSource(candidate.get.call(candidate, "set-cookie"));
  }
  if (typeof candidate.toJSON === "function") {
    const json = candidate.toJSON.call(candidate);
    addSource(json["set-cookie"]);
    addSource(json["Set-Cookie"]);
  }
  addSource(candidate["set-cookie"]);
  addSource(candidate["Set-Cookie"]);

  return mergeCookieHeaders(...sources);
}

export async function saveAuthCredentials(
  account: string,
  password: string,
): Promise<void> {
  await Promise.all([
    saveConfig(AUTH_ACCOUNT_CONFIG_KEY, account),
    saveConfig(AUTH_PASSWORD_CONFIG_KEY, password),
  ]);
}

export async function clearAuthState(): Promise<void> {
  await Promise.all([
    saveConfig(AUTH_COOKIE_CONFIG_KEY, ""),
    saveConfig(AUTH_UID_CONFIG_KEY, ""),
    saveConfig(AUTH_SSID_CONFIG_KEY, ""),
  ]);
}

/**
 * 蛙漫3的自动登录路径：请求体只包含 username/password，不发送 captcha。
 * 登录成功后保存 Cookie；如果运行时不暴露 Set-Cookie，则使用响应中的 uid/ssid
 * 构造同等的 Cookie 头，保证后续收藏等登录接口仍能复用会话。
 */
export async function loginWithoutCaptcha(payload: {
  account?: string;
  password?: string;
}): Promise<ManwaLoginData> {
  const account = String(payload.account ?? "").trim();
  const password = String(payload.password ?? "");
  if (!account || !password.trim()) {
    throw new Error("账号或密码不能为空");
  }

  const response = await apiPost<ManwaLoginData>("/api/account/login", {
    username: account,
    password,
  });
  const data = getResponseData<ManwaLoginData>(response);
  const cookieFromHeaders = readSetCookieHeaders(response.headers);
  const bodyUid = data.uid === undefined ? "" : `uid=${data.uid}`;
  const bodySess = data.ssid ? `PHPSESSID=${data.ssid}` : "";
  // headers 已含 uid+ssid（与 body 同值）时不重复拼接；仅 headers 缺失
  // 的那一半才用 body 补。
  const headerHasUid = /(?:^|;\s*)uid=/.test(cookieFromHeaders);
  const headerHasSess = /(?:^|;\s*)PHPSESSID=/.test(cookieFromHeaders);
  const cookie = [
    cookieFromHeaders,
    !headerHasUid && bodyUid ? bodyUid : "",
    !headerHasSess && bodySess ? bodySess : "",
  ]
    .filter((part) => part)
    .join("; ");
  if (!cookie) {
    throw new Error("登录成功但未获得会话 Cookie");
  }

  await Promise.all([
    saveAuthCredentials(account, password),
    saveConfig(AUTH_COOKIE_CONFIG_KEY, cookie),
    saveConfig(AUTH_UID_CONFIG_KEY, data.uid === undefined ? "" : String(data.uid)),
    saveConfig(AUTH_SSID_CONFIG_KEY, data.ssid ?? ""),
  ]);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiPost("/api/account/logout", {});
  } finally {
    await clearAuthState();
  }
}

/**
 * 获取当前使用的 API 基础地址。
 * 优先读取缓存；缓存不存在时返回默认第一个地址。
 */
export async function getBaseUrl(): Promise<string> {
  try {
    const cached = await cache.get<string>(BASE_URL_CACHE_KEY, "");
    if (cached) return cached;
  } catch {
    // ignore cache read error
  }
  return DEFAULT_BASE_URL;
}

/**
 * 测量单个候选地址的延迟。
 * 用真实 API 路径（/api/search/index）做 GET 探测，且必须携带合法
 * devid/x-token：服务端对无签名请求返回 501（连带 WAF 计数），会污染
 * 后续同 IP 的正常请求（表现为 403）。5 秒超时，失败返回 null。
 */
async function measureLatency(url: string): Promise<number | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const headers = await generateHeaders();
    const probe = `${url.replace(/\/+$/, "")}/api/search/index?k=%E6%B5%B7%E8%B4%BC&page=0`;
    const res = await fetch(probe, {
      signal: controller.signal,
      headers: {
        devid: headers.devid,
        "x-token": headers["x-token"],
        "user-agent": USER_AGENT,
      },
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      return Date.now() - start;
    }
  } catch {
    // ignore failure
  }
  return null;
}

/**
 * 插件初始化：在候选地址中测速，选择最快的一个写入缓存。
 * 测速前、测速失败都使用默认第一个地址。
 */
export async function init(): Promise<void> {
  const results = await Promise.all(
    CANDIDATE_BASE_URLS.map(async (url) => ({
      url,
      latency: await measureLatency(url),
    })),
  );

  const valid = results.filter(
    (r): r is { url: string; latency: number } => r.latency !== null,
  );

  let fastest = DEFAULT_BASE_URL;
  if (valid.length > 0) {
    valid.sort((a, b) => a.latency - b.latency);
    fastest = valid[0].url;
  }

  await cache.set(BASE_URL_CACHE_KEY, fastest);
}

/**
 * Manwa3 API 专用 axios 实例。
 *
 * 请求拦截器：动态选择 baseURL、自动生成 devid / x-token，补齐 UA、origin、referer、cookie。
 * 响应拦截器：把 JSON 编码的 base64 密文解密为 JSON 对象。
 */
export const manwaApi = axios.create({
  // Node 侧（调试/测试）用 http adapter：fetch 是浏览器语义，会吞掉
  // Cookie 请求头（forbidden header），导致登录态收藏 401/請先登入；
  // Breeze 宿主内无 node:http 时 axios 会自动回退到 fetch。
  adapter: ["http", "fetch"],
  responseType: "text",
  headers: {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: "http://mseeowpm1.xyz",
    Referer: "http://mseeowpm1.xyz",
    "Content-Type": "application/json; charset=utf-8",
  },
});

/**
 * devid 必须与“发出该请求时”的请求头一一对应：响应解密用错 devid
 * 会导致 AES `wrong final block length`。
 *
 * axios 的 `config.headers` 在发送后不可靠（fetch adapter 会消费/转换），
 * 且默认值对象全局共享、并发下会被后来者覆盖。因此 devid 不再经过
 * headers 传给响应拦截器，而是直接挂在本次请求的 `config` 对象上：
 * 同一个 config 对象从请求拦截器一路传到响应拦截器，并发互不干扰。
 */
manwaApi.interceptors.request.use(async (config) => {
  const mutable = config as typeof config & { devidForDecrypt?: string };
  const headers = await generateHeaders();
  mutable.devidForDecrypt = headers.devid;
  const cookie = await loadConfig("auth.cookie", "");

  mutable.headers = mutable.headers ?? {};
  mutable.headers["devid"] = headers.devid;
  mutable.headers["x-token"] = headers["x-token"];
  mutable.headers["user-agent"] = USER_AGENT;
  if (cookie) {
    // axios 的 fetch adapter 会丢弃小写 `cookie`（按 forbidden header 处理），
    // 必须用标准 `Cookie` 大小写，AxiosHeaders 才能正确归一化并发送。
    mutable.headers["Cookie"] = cookie;
  }

  return mutable;
});

manwaApi.interceptors.response.use(async (response) => {
  const devid = String(
    (response.config as { devidForDecrypt?: unknown }).devidForDecrypt ??
      Date.now(),
  );
  const text = typeof response.data === "string" ? response.data : "";

  // 响应体是 JSON 编码的字符串字面量（即一个 base64 字符串）；
  // 验证码等少数接口直接返回二进制（PNG），此时不做解密原样透传。
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('"')) {
    return response;
  }
  const encryptedBase64 = JSON.parse(text) as string;
  const decrypted = await apiDecrypt(encryptedBase64, devid);
  response.data = JSON.parse(decrypted);

  return response;
});

/**
 * 带域名故障转移的请求封装：当前缓存域名连续失败时，按候选列表顺序
 * 逐个重试（每个域名只试一次），首个成功的域名写回缓存。
 * 网络错误、HTTP 5xx、解密失败都会触发换域名；业务 code !== 1 不触发
 *（那是账号/参数问题，换域名也一样）。
 */
async function requestWithFailover<T>(
  run: (baseURL: string) => Promise<T>,
): Promise<T> {
  const cached = await getBaseUrl();
  const ordered = [
    cached,
    ...CANDIDATE_BASE_URLS.filter((url) => url !== cached),
  ];
  let lastError: unknown = null;
  for (const baseURL of ordered) {
    try {
      await cache.set(BASE_URL_CACHE_KEY, baseURL);
      return await run(baseURL);
    } catch (error) {
      lastError = error;
      if (
        axios.isAxiosError(error) &&
        error.response &&
        error.response.status < 500
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Manwa3 API 错误")) throw error;
      // 否则换下一个域名继续。
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Manwa3 API 错误: ${String(lastError ?? "未知错误")}`);
}

type ManwaEnvelope<T> = {
  code?: number;
  data?: T;
  msg?: string;
};

export async function apiGet<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<AxiosResponse<ManwaEnvelope<T>>> {
  return requestWithFailover((baseURL) =>
    manwaApi.get(url, { params, baseURL }),
  );
}

export async function apiPost<T>(
  url: string,
  body?: Record<string, unknown>,
): Promise<AxiosResponse<ManwaEnvelope<T>>> {
  return requestWithFailover((baseURL) =>
    manwaApi.post(url, body, { baseURL }),
  );
}

/**
 * 类型安全的 API 响应提取。
 */
export function getResponseData<T>(response: {
  data?: { code?: number; data?: T; msg?: string };
}): T {
  const data = response.data;
  if (!data || data.code !== 1) {
    throw new Error(`Manwa3 API 错误: ${data?.msg ?? "未知错误"}`);
  }
  return data.data as T;
}
