import * as pkijs from 'pkijs';
import { parseCertificateDer } from './certificate-utils';

// Lazy module-level CryptoEngine — was constructed twice per encrypt call
// (once per recipient and once on encrypt). `crypto` may be undefined at
// module init in some environments, so build on first use.
let _webcryptoEngine: pkijs.CryptoEngine | null = null;
function getWebcryptoEngine(): pkijs.CryptoEngine {
  if (!_webcryptoEngine) {
    _webcryptoEngine = new pkijs.CryptoEngine({
      crypto: crypto,
      subtle: crypto.subtle,
      name: 'webcrypto',
    });
  }
  return _webcryptoEngine;
}

/**
 * Produce CMS EnvelopedData for the given MIME content.
 *
 * Content type: application/pkcs7-mime; smime-type=enveloped-data
 *
 * Always includes the sender's cert so the sender can decrypt their Sent mail.
 */
export async function smimeEncrypt(
  mimeBytes: Uint8Array,
  recipientCertsDer: ArrayBuffer[],
  senderCertDer: ArrayBuffer,
  useAes128?: boolean,
): Promise<Blob> {
  // Combine recipient + sender certs, deduplicate by DER bytes.
  // Direct dedup walk skips the [...recipientCertsDer, senderCertDer] spread alloc.
  const allCertDers = deduplicateCertsWithSender(recipientCertsDer, senderCertDer);

  if (allCertDers.length === 0) {
    throw new Error('No recipient certificates provided');
  }

  // Build EnvelopedData
  const cmsEnveloped = new pkijs.EnvelopedData();

  // Fused parse + addRecipient walk — drops the intermediate `recipientCerts`
  // array allocation.
  const engine = getWebcryptoEngine();
  for (const der of allCertDers) {
    const cert = parseCertificateDer(der);
    cmsEnveloped.addRecipientByCertificate(cert, {
      oaepHashAlgorithm: 'SHA-256',
    }, undefined, engine);
  }

  // Encrypt the content
  const contentEncryptionAlgorithm = useAes128
    ? { name: 'AES-GCM', length: 128 }
    : { name: 'AES-GCM', length: 256 };

  await cmsEnveloped.encrypt(contentEncryptionAlgorithm, mimeBytes.buffer.slice(mimeBytes.byteOffset, mimeBytes.byteOffset + mimeBytes.byteLength) as ArrayBuffer, engine);

  // Wrap in ContentInfo
  const cms = new pkijs.ContentInfo({
    contentType: '1.2.840.113549.1.7.3', // id-envelopedData
    content: cmsEnveloped.toSchema(),
  });

  const cmsBytes = cms.toSchema().toBER(false);
  return new Blob([cmsBytes], { type: 'application/pkcs7-mime; smime-type=enveloped-data' });
}

/** Remove duplicate DER-encoded certificates (recipients + sender) by byte equality without spread alloc. */
function deduplicateCertsWithSender(recipients: ArrayBuffer[], sender: ArrayBuffer): ArrayBuffer[] {
  const seen = new Set<string>();
  const result: ArrayBuffer[] = [];
  for (const cert of recipients) {
    const key = arrayBufferToHex(cert);
    if (!seen.has(key)) { seen.add(key); result.push(cert); }
  }
  const senderKey = arrayBufferToHex(sender);
  if (!seen.has(senderKey)) { seen.add(senderKey); result.push(sender); }
  return result;
}

// Pre-computed byte → hex lookup. Avoids the Array.from(bytes).map().join()
// chain (two N-sized intermediate arrays per call).
const HEX_PAIRS = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function arrayBufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += HEX_PAIRS[bytes[i]];
  return hex;
}
