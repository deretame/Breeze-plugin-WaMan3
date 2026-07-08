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

/**
 * 读取持久化配置项。
 * pluginConfig.load 返回 '{"ok":true,"value":...}' 格式，需要解析两层。
 */
async function loadConfig(key: string, fallback = ""): Promise<string> {
  try {
    const raw = await pluginConfig.load(key, fallback);
    const parsed = JSON.parse(raw) as { ok?: boolean; value?: unknown };
    return typeof parsed.value === "string" ? parsed.value : fallback;
  } catch {
    return fallback;
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
