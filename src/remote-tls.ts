// HTTPS for the remote control without a certificate to make by hand (REMOTE_TLS=auto): a CA of its
// own, made once and kept in OUT_DIR, and a server certificate from it for this machine's current
// addresses, made anew at every start. The phone trusts the CA once (the dashboard shows how) – a
// new address then needs nothing on the phone. The CA's key never leaves this machine.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { readJson, writeAtomic } from "./store.ts";

export type AutoTls = {
  /** PEM, for Bun.serve */
  cert: string;
  key: string;
  /** the CA as DER – what the phone installs */
  caDer: Uint8Array;
  /** SHA-256 of the CA, "AB:CD:…" – what the phone shows to compare */
  fingerprint: string;
};

const YEAR_MS = 365 * 86_400_000;
/** Apple refuses server certificates valid for more than 825 days, even from your own CA */
const SERVER_DAYS = 397;

const rsa = () =>
  generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

/** positive, 16 random bytes */
const serial = () => `01${randomBytes(15).toString("hex")}`;

const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

type StoredCa = { cert: string; key: string };

/** The CA from OUT_DIR, made on first use. */
async function loadCa(dir: string, now: Date): Promise<{ cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }> {
  const path = join(dir, "remote-ca.json");
  const stored = await readJson<StoredCa>(path);
  if (stored) {
    const cert = forge.pki.certificateFromPem(stored.cert);
    // a few months before it runs out, a new one – the phone then needs it once more
    if (cert.validity.notAfter.getTime() - now.getTime() > 90 * 86_400_000) return { cert, key: forge.pki.privateKeyFromPem(stored.key) as forge.pki.rsa.PrivateKey };
  }
  const pair = rsa();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - 3_600_000);
  cert.validity.notAfter = new Date(now.getTime() + 10 * YEAR_MS);
  const name = [
    { name: "commonName", value: `dev-dashboard remote (${hostname()})` },
    { name: "organizationName", value: "dev-dashboard" },
  ];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  const key = forge.pki.privateKeyFromPem(pair.privateKey) as forge.pki.rsa.PrivateKey;
  cert.sign(key, forge.md.sha256.create());
  await mkdir(dir, { recursive: true });
  await writeAtomic(path, JSON.stringify({ cert: forge.pki.certificateToPem(cert), key: pair.privateKey } satisfies StoredCa));
  await chmod(path, 0o600).catch(() => {}); // only you may read the CA's key (no effect on Windows)
  return { cert, key };
}

/** The CA (made once) and a server certificate for these addresses and names. */
export async function autoTls(dir: string, hosts: string[], now = new Date()): Promise<AutoTls> {
  const ca = await loadCa(dir, now);
  const pair = rsa();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - 3_600_000);
  cert.validity.notAfter = new Date(now.getTime() + SERVER_DAYS * 86_400_000);
  cert.setSubject([{ name: "commonName", value: hosts[0] ?? "localhost" }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    // ip: type 7, DNS name: type 2
    { name: "subjectAltName", altNames: [...new Set(hosts)].map((h) => (isIp(h) ? { type: 7, ip: h } : { type: 2, value: h })) },
    { name: "subjectKeyIdentifier" },
    { name: "authorityKeyIdentifier", keyIdentifier: ca.cert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());

  const caDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(ca.cert)).getBytes(), "binary");
  const fingerprint = createHash("sha256").update(caDer).digest("hex").toUpperCase().match(/../g)!.join(":");
  return {
    // the chain: the phone knows the CA, but sending it along does no harm
    cert: forge.pki.certificateToPem(cert) + forge.pki.certificateToPem(ca.cert),
    key: pair.privateKey,
    caDer: new Uint8Array(caDer),
    fingerprint,
  };
}
