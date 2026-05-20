import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { parseCertificateDer } from './certificate-utils';

// Lazy module-level CryptoEngine — was reconstructed per sign call.
let _webcryptoEngine: pkijs.CryptoEngine | null = null;
function getWebcryptoEngine(): pkijs.CryptoEngine {
  if (!_webcryptoEngine) {
    _webcryptoEngine = new pkijs.CryptoEngine({ crypto, subtle: crypto.subtle, name: 'webcrypto' });
  }
  return _webcryptoEngine;
}

/**
 * Produce an opaque CMS SignedData wrapping the given MIME content.
 *
 * Content type: application/pkcs7-mime; smime-type=signed-data
 * This is the "opaque" form - the content is embedded inside the CMS structure.
 */
export async function smimeSign(
  mimeBytes: Uint8Array,
  privateKey: CryptoKey,
  signerCertDer: ArrayBuffer,
  chainCertsDer: ArrayBuffer[] = [],
): Promise<Blob> {
  // Parse signer certificate
  const signerCert = parseCertificateDer(signerCertDer);

  // Pre-sized certs array: [signer, ...chain] without spread alloc.
  const certificates: pkijs.Certificate[] = new Array(chainCertsDer.length + 1);
  certificates[0] = signerCert;
  for (let i = 0; i < chainCertsDer.length; i++) {
    certificates[i + 1] = parseCertificateDer(chainCertsDer[i]);
  }

  // Build CMS SignedData
  const cmsSigned = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: '1.2.840.113549.1.7.1', // id-data
      eContent: new asn1js.OctetString({ valueHex: new Uint8Array(mimeBytes.buffer.slice(mimeBytes.byteOffset, mimeBytes.byteOffset + mimeBytes.byteLength)) }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: signerCert.issuer,
          serialNumber: signerCert.serialNumber,
        }),
      }),
    ],
    certificates,
  });

  // Determine signing algorithm from the key
  const algorithm = privateKey.algorithm;
  const hashAlgorithm = 'SHA-256';

  let _signAlg: string;
  if (algorithm.name === 'RSASSA-PKCS1-v1_5' || algorithm.name === 'RSA-PSS') {
    _signAlg = algorithm.name;
  } else if (algorithm.name === 'ECDSA') {
    _signAlg = 'ECDSA';
  } else {
    _signAlg = 'RSASSA-PKCS1-v1_5';
  }

  // Sign — reuse module-level engine.
  await cmsSigned.sign(privateKey, 0, hashAlgorithm, undefined, getWebcryptoEngine());

  // Wrap in ContentInfo
  const cms = new pkijs.ContentInfo({
    contentType: '1.2.840.113549.1.7.2', // id-signedData
    content: cmsSigned.toSchema(true),
  });

  const cmsBytes = cms.toSchema().toBER(false);
  return new Blob([cmsBytes], { type: 'application/pkcs7-mime; smime-type=signed-data' });
}
