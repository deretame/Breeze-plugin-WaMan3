/**
 * Manwa3 加解密工具。
 *
 * 对应 D:\temp\manwa3_decrypt_tools 中的解密逻辑：
 * - API 响应：AES-256-ECB + PKCS7，密钥由 devid 派生
 * - 图片：AES-128-CBC + PKCS7，key/iv 同为 "my2ecret782ecret"
 * - 请求头：devid 为毫秒时间戳，x-token 为 md5hex(devid + "," + TOKEN_SALT)
 */

import type { CryptoApi } from "../types/crypto";

const cryptoApi = (crypto as unknown) as CryptoApi;

export const API_KEY_SALT = ",noiusdfy73osadjap012njdsfn";
export const TOKEN_SALT = "jsdaghuiaonfyudsfnkgjdfkdd";
export const IMAGE_SECRET_KEY = "my2ecret782ecret";

/**
 * 派生 API 解密密钥。
 * key = md5hex("{devid},noiusdfy73osadjap012njdsfn")  // 32 字节 hex 字符串
 */
export async function deriveApiKey(timestamp: string | number): Promise<string> {
  const seed = `${timestamp}${API_KEY_SALT}`;
  return await cryptoApi.md5(seed);
}

/**
 * 生成请求头。
 */
export async function generateHeaders(nowMs = Date.now()): Promise<{
  devid: string;
  "x-token": string;
}> {
  const devid = String(nowMs);
  const token = await cryptoApi.md5(`${devid},${TOKEN_SALT}`);
  return { devid, "x-token": token };
}

/**
 * 解密 API 响应。
 * 响应体是 JSON 编码的 base64 字符串，需要先 JSON.parse 再解密。
 */
export async function apiDecrypt(
  encryptedBase64: string,
  timestamp: string | number,
): Promise<string> {
  const key = await deriveApiKey(timestamp);
  const encrypted = bytesFromBase64(encryptedBase64);
  const decrypted = await cryptoApi.aesEcbPkcs7Decrypt(encrypted, key);
  return new TextDecoder().decode(decrypted);
}

/**
 * 解密章节图片。
 * AES-128-CBC + PKCS7，key 与 iv 都是 IMAGE_SECRET_KEY 的 UTF-8 前 16 字节。
 */
export async function imageDecrypt(
  encryptedBytes: Uint8Array,
): Promise<Uint8Array> {
  return await cryptoApi.aesCbcPkcs7Decrypt(
    encryptedBytes,
    IMAGE_SECRET_KEY,
    IMAGE_SECRET_KEY,
  );
}
