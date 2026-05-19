import * as pkijs from 'pkijs';
import { parseCertificateDer } from './certificate-utils';

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
  // Combine recipient + sender certs, deduplicate by DER bytes
  const allCertDers = deduplicateCerts([...recipientCertsDer, senderCertDer]);

  if (allCertDers.length === 0) {
    throw new Error('No recipient certificates provided');
  }

  // Parse all certificates
  const recipientCerts = allCertDers.map((der) => parseCertificateDer(der));

  // Build EnvelopedData
  const cmsEnveloped = new pkijs.EnvelopedData();

  // Add recipient info for each certificate
  for (const cert of recipientCerts) {
    cmsEnveloped.addRecipientByCertificate(cert, {
      oaepHashAlgorithm: 'SHA-256',
    }, undefined, new pkijs.CryptoEngine({
      crypto: crypto,
      subtle: crypto.subtle,
      name: 'webcrypto',
    }));
  }

  // Encrypt the content
  const contentEncryptionAlgorithm = useAes128
    ? { name: 'AES-GCM', length: 128 }
    : { name: 'AES-GCM', length: 256 };

  await cmsEnveloped.encrypt(contentEncryptionAlgorithm, mimeBytes.buffer.slice(mimeBytes.byteOffset, mimeBytes.byteOffset + mimeBytes.byteLength) as ArrayBuffer, new pkijs.CryptoEngine({
    crypto: crypto,
    subtle: crypto.subtle,
    name: 'webcrypto',
  }));

  // Wrap in ContentInfo
  const cms = new pkijs.ContentInfo({
    contentType: '1.2.840.113549.1.7.3', // id-envelopedData
    content: cmsEnveloped.toSchema(),
  });

  const cmsBytes = cms.toSchema().toBER(false);
  return new Blob([cmsBytes], { type: 'application/pkcs7-mime; smime-type=enveloped-data' });
}

/** Remove duplicate DER-encoded certificates based on byte equality. */
function deduplicateCerts(certs: ArrayBuffer[]): ArrayBuffer[] {
  const seen = new Set<string>();
  const result: ArrayBuffer[] = [];
  for (const cert of certs) {
    const key = arrayBufferToHex(cert);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cert);
    }
  }
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
