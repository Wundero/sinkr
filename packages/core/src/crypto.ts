import { decodeBase64url, encodeBase64url } from "@oslojs/encoding";

const SUPPORTED_HASHES = ["256", "384", "512"];

async function importRSAJWK(key: JsonWebKey) {
  if (key.kty !== "RSA" || !key.alg) {
    throw new Error("Invalid key type");
  }
  const [_, algSubtype, hash] = key.alg.split("-");
  if (algSubtype !== "OAEP" || !hash) {
    throw new Error("Invalid key type");
  }
  if (!SUPPORTED_HASHES.includes(hash)) {
    throw new Error("Unsupported hash");
  }
  if (!key.key_ops?.includes("encrypt")) {
    throw new Error("Key does not support encryption");
  }
  return await crypto.subtle.importKey(
    "jwk",
    key,
    {
      name: "RSA-OAEP",
      hash: `SHA-${hash}`,
    },
    true,
    key.key_ops as KeyUsage[],
  );
}

async function importAESGCMJWK(key: JsonWebKey) {
  if (key.kty !== "oct") {
    throw new Error("Invalid key type");
  }
  if (!key.key_ops?.includes("encrypt")) {
    throw new Error("Key does not support encryption");
  }
  if (key.alg !== "A256GCM") {
    throw new Error("Unsupported algorithm");
  }
  return await crypto.subtle.importKey(
    "jwk",
    key,
    {
      name: "AES-GCM",
    },
    true,
    key.key_ops as KeyUsage[],
  );
}

export async function importUnknownJWK(key: JsonWebKey | CryptoKey) {
  if (key instanceof CryptoKey) {
    if (!key.usages.includes("encrypt")) {
      throw new Error("Key does not support encryption");
    }
    switch (key.algorithm.name) {
      case "RSA-OAEP":
      case "AES-GCM":
        return key;
    }
    throw new Error("Unsupported key type");
  }
  if (!key.kty) {
    throw new Error("Invalid key type");
  }
  if (key.kty === "RSA") {
    return await importRSAJWK(key);
  }
  if (key.kty === "oct") {
    return await importAESGCMJWK(key);
  }
  throw new Error("Unsupported key type");
}

export async function decrypt(ciphertext: string, key: CryptoKey) {
  if (key.algorithm.name === "RSA-OAEP") {
    const decoded = decodeBase64url(ciphertext);
    return await crypto.subtle.decrypt(
      {
        name: "RSA-OAEP",
      },
      key,
      decoded,
    );
  } else {
    const [iv, msg] = ciphertext.split(".").map(decodeBase64url);
    if (!iv || !msg) {
      throw new Error("Invalid ciphertext");
    }
    return await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      msg,
    );
  }
}

export async function encrypt(message: Uint8Array, key: CryptoKey) {
  if (key.algorithm.name === "AES-GCM") {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: key.algorithm.name,
        iv,
      },
      key,
      message,
    );
    const ivs = encodeBase64url(iv);
    const es = encodeBase64url(new Uint8Array(encrypted));
    return `${ivs}.${es}`;
  }
  const encrypted = await crypto.subtle.encrypt(
    {
      name: key.algorithm.name,
    },
    key,
    message,
  );
  return encodeBase64url(new Uint8Array(encrypted));
}
