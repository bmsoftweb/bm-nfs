/**
 * Assinatura digital XMLDSig, no perfil exigido pela NF-e.
 *
 * Os algoritmos são os mesmos que o ACBr usa por padrão em
 * ACBrDFeUtil.SignatureElement: RSA-SHA1, digest SHA-1 e canonicalização C14N
 * 1.0 inclusiva. SHA-256 até existe no componente, mas a SEFAZ continua
 * validando a NF-e com SHA-1 — trocar rejeita o documento.
 *
 * A assinatura entra como ÚLTIMO filho do elemento que contém o assinado
 * (enveloped). "Logo depois do assinado" não serve: na NFC-e o schema exige
 * <NFe><infNFe/><infNFeSupl/><Signature/></NFe>, e a assinatura colada em
 * </infNFe> ficaria antes do infNFeSupl — rejeição 225 em toda NFC-e.
 */
import { SignedXml } from 'xml-crypto';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export interface DadosAssinatura {
  chavePrivadaPem: string;
  certificadoPem: string;
}

/**
 * @param xml       documento inteiro, sem declaração
 * @param elemento  nome do elemento que carrega o atributo Id (infNFe, infEvento, infInut)
 * @param id        conteúdo do atributo Id, sem o "#"
 */
export function assinar(
  xml: string,
  elemento: string,
  id: string,
  cert: DadosAssinatura,
): string {
  const sig = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });

  sig.addReference({
    xpath: `//*[local-name(.)='${elemento}']`,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
    uri: id,
  });

  // A SEFAZ espera <Signature> sem prefixo e com o namespace declarado nele mesmo
  sig.computeSignature(xml, {
    prefix: '',
    location: { reference: `//*[local-name(.)='${elemento}']/..`, action: 'append' },
  });

  return sig.getSignedXml();
}

/** Confere a assinatura de um XML já assinado (botão "Validar Assinatura" do exemplo) */
export function conferirAssinatura(xml: string): { valida: boolean; erro?: string } {
  try {
    const m = xml.match(/<Signature[\s\S]*?<\/Signature>/i);
    if (!m) return { valida: false, erro: 'O XML não contém assinatura digital.' };

    const certBase64 = (xml.match(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/i) || [])[1];
    if (!certBase64) return { valida: false, erro: 'A assinatura não traz o certificado (X509Certificate).' };

    const sig = new SignedXml({
      publicCert: `-----BEGIN CERTIFICATE-----\n${certBase64.replace(/\s+/g, '')}\n-----END CERTIFICATE-----`,
    });
    sig.loadSignature(m[0]);

    const valida = sig.checkSignature(xml);
    return valida ? { valida: true } : { valida: false, erro: 'Assinatura inválida: o resumo do documento não confere com o assinado.' };
  } catch (err: any) {
    return { valida: false, erro: err.message || String(err) };
  }
}
