import axios from "axios";
import { cache, pluginConfig } from "breeze-plugin-kit";
import { apiDecrypt, generateHeaders } from "./crypto";

const DEFAULT_BASE_URL = "http://mseeowpm.pro";
const BASE_URL_CACHE_KEY = "manwa3_base_url";

const CANDIDATE_BASE_URLS = [
  DEFAULT_BASE_URL,
  "http://mseeowpm1.xyz",
  "http://mseeowpm2.cc",
  "https://mseeowpma.cc",
];

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 12; PGT-AN20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 mwa-1.1.26+1 (Android/12 HONOR/PGT-AN20)";

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

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

function cookiePairs(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) =>
      typeof item === "string" ? splitSetCookieHeader(item) : [],
    )
    .map((item) => item.split(";", 1)[0].trim())
    .filter((item) => /^[^=;\s]+=[^;]*$/.test(item));
}

function mergeCookieHeaders(...values: unknown[]): string {
  const merged = new Map<string, string>();
  for (const pair of values.flatMap(cookiePairs)) {
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

  const values: unknown[] = [];
  if (typeof candidate.getSetCookie === "function") {
    values.push(candidate.getSetCookie());
  }
  if (typeof candidate.get === "function") {
    values.push(candidate.get("set-cookie"));
  }
  if (typeof candidate.toJSON === "function") {
    const json = candidate.toJSON();
    values.push(json["set-cookie"], json["Set-Cookie"]);
  }
  values.push(candidate["set-cookie"], candidate["Set-Cookie"]);

  return mergeCookieHeaders(...values);
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

  const response = await manwaApi.post("/api/account/login", {
    username: account,
    password,
  });
  const data = getResponseData<ManwaLoginData>(response);
  const cookieFromHeaders = readSetCookieHeaders(response.headers);
  const cookieFromBody = mergeCookieHeaders(
    data.uid === undefined ? "" : `uid=${data.uid}`,
    data.ssid ? `PHPSESSID=${data.ssid}` : "",
  );
  const cookie = mergeCookieHeaders(cookieFromHeaders, cookieFromBody);
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
    await manwaApi.post("/api/account/logout");
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
 * 使用 HEAD 请求，3 秒超时。
 */
async function measureLatency(url: string): Promise<number | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
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
  adapter: "fetch",
  responseType: "text",
  headers: {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: "http://mseeowpm1.xyz",
    Referer: "http://mseeowpm1.xyz",
    "Content-Type": "application/json; charset=utf-8",
  },
});

manwaApi.interceptors.request.use(async (config) => {
  config.baseURL = await getBaseUrl();

  const headers = await generateHeaders();
  const cookie = await loadConfig("auth.cookie", "");

  config.headers = config.headers || {};
  config.headers["devid"] = headers.devid;
  config.headers["x-token"] = headers["x-token"];
  config.headers["user-agent"] = USER_AGENT;
  if (cookie) {
    config.headers["cookie"] = cookie;
  }

  // 把 devid 临时存到 headers 里，供响应拦截器解密使用
  config.headers["x-manwa-devid"] = headers.devid;

  return config;
});

manwaApi.interceptors.response.use(async (response) => {
  const devid = String(response.config.headers["x-manwa-devid"] ?? Date.now());
  const text = typeof response.data === "string" ? response.data : "";

  // 响应体是 JSON 编码的字符串字面量（即一个 base64 字符串）
  const encryptedBase64 = JSON.parse(text) as string;
  const decrypted = await apiDecrypt(encryptedBase64, devid);
  response.data = JSON.parse(decrypted);

  return response;
});

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
