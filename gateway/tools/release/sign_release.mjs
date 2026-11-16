#!/usr/bin/env node
// Firma un paquete del gateway con Ed25519: escribe PAQUETE.sig (base64, una línea).
//   node gateway/tools/release/sign_release.mjs dist/cam5-gateway-1.3.0.tar.gz [clave.pem]
// La clave privada por omisión está en ~/.hoit/gateway-release-ed25519.pem y nunca va al repositorio.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const [bundlePath, keyPath = `${homedir()}/.hoit/gateway-release-ed25519.pem`] = process.argv.slice(2);
if (!bundlePath) {
  console.error("Uso: sign_release.mjs PAQUETE.tar.gz [clave.pem]");
  process.exit(2);
}
const EXPECTED_PUBLIC_KEY = "Gexjc4a3fY4i3KV/9yFkno2nT1IHTJrtsxwPsX+MV1g=";
const privateKey = createPrivateKey(readFileSync(keyPath));
const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
if (publicKey !== EXPECTED_PUBLIC_KEY) {
  console.error(`La clave ${keyPath} no es la de versiones HOIT (pública ${publicKey}).`);
  process.exit(1);
}
const signature = sign(null, readFileSync(bundlePath), privateKey).toString("base64");
writeFileSync(`${bundlePath}.sig`, `${signature}\n`);
console.log(`Firma: ${bundlePath}.sig`);
