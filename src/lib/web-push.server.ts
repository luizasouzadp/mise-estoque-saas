// Minimal Web Push (RFC 8291 aes128gcm + VAPID) sender built on the Web
// Crypto API and fetch, so it runs natively on Cloudflare Workers without
// Node's http/https modules (which the "web-push" npm package needs and
// Workers cannot actually use for outbound requests).

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padding = "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importVapidKeys(publicKeyB64Url: string, privateKeyB64Url: string): Promise<CryptoKey> {
  const pub = base64UrlDecode(publicKeyB64Url); // 65 bytes, uncompressed point 0x04 || X(32) || Y(32)
  const d = base64UrlDecode(privateKeyB64Url); // 32 bytes
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("VAPID public key inválida");
  const x = pub.subarray(1, 33);
  const y = pub.subarray(33, 65);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    d: base64UrlEncode(d),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJwt(audience: string, subjectMailto: string, publicKey: string, privateKey: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subjectMailto,
  };
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importVapidKeys(publicKey, privateKey);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, data as BufferSource);
  return new Uint8Array(sig);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  // Single-round HKDF-Expand (sufficient since we only ever need <= 32 bytes).
  const input = new Uint8Array(info.length + 1);
  input.set(info, 0);
  input[info.length] = 1;
  const t = await hmacSha256(prk, input);
  return t.subarray(0, length);
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) { out.set(a, offset); offset += a.length; }
  return out;
}

async function encryptPayload(
  message: string,
  p256dhB64Url: string,
  authB64Url: string,
): Promise<{ body: Uint8Array; salt: Uint8Array; asPublicRaw: Uint8Array }> {
  const uaPublicRaw = base64UrlDecode(p256dhB64Url); // subscriber's public key, 65 bytes
  const authSecret = base64UrlDecode(authB64Url); // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicRaw as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey },
    asKeyPair.privateKey,
    256,
  );
  const ecdhSecret = new Uint8Array(sharedSecretBits);

  const enc = new TextEncoder();

  // Stage 1 (RFC 8291 §3.4): derive the Input Keying Material from the ECDH secret.
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(enc.encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // Stage 2 (RFC 8188 aes128gcm): derive the content-encryption key and nonce.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, enc.encode("Content-Encoding: nonce\0"), 12);

  const plaintext = concatBytes(enc.encode(message), new Uint8Array([2])); // 0x02 = last (only) record

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertextBits = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext as BufferSource);
  const ciphertext = new Uint8Array(ciphertextBits);

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  const body = concatBytes(header, ciphertext);

  return { body, salt, asPublicRaw };
}

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

export class PushSendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  message: { title: string; body: string; url?: string },
  vapid: { publicKey: string; privateKey: string; subjectMailto: string },
): Promise<void> {
  const endpointUrl = new URL(sub.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const jwt = await signVapidJwt(audience, vapid.subjectMailto, vapid.publicKey, vapid.privateKey);
  const { body } = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body: body as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PushSendError(res.status, `Push falhou (${res.status}): ${text}`);
  }
}
