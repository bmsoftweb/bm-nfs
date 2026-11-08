/**
 * Autoteste da DPS e do cancelamento, sem banco e sem rede: monta, assina com um
 * certificado de teste e valida contra o XSD de cada ambiente.
 *   npm run teste
 */
import assert from 'assert/strict';
import forge from 'node-forge';
import { CONFIG_PADRAO } from '../config.js';
import { conferirAssinatura, assinar } from './assinatura.js';
import type { CertificadoCarregado } from './certificado.js';
import type { Contexto, Prestador } from './contexto.js';
import { conferirDados, DadosNFSe, idDps, montarCancelamento, montarDps } from './dps.js';
import { compactar, descompactar } from './sefin.js';
import { descreverErros, validarDps, validarPedidoEvento } from './validacao.js';

function certificadoDeTeste(): CertificadoCarregado {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const nome = [{ name: 'commonName', value: 'TESTE:11222333000181' }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chaves.privateKey),
    certificadoPem: pem,
    certificadoBase64: pem.replace(/-----[^-]+-----|\s/g, ''),
    cadeiaPem: [],
    info: { razaoSocial: 'TESTE', cnpj: '11222333000181', numeroSerie: '01', emissor: 'TESTE', validoDe: new Date(), validoAte: new Date(), diasParaVencer: 1 },
  };
}

const prestador = (op: number): Prestador => ({
  id: 1, cnpj: '11222333000181', inscricao_municipal: '12345', razao_social: 'PRESTADOR DE TESTE LTDA', nome_fantasia: null,
  logradouro: 'Rua XV de Novembro', numero: '100', complemento: null, bairro: 'Centro', codigo_municipio: '4214805',
  municipio: 'Rio do Sul', uf: 'SC', cep: '89160000', fone: '4735210000', email: 'teste@exemplo.com.br',
  op_simples_nacional: op, regime_apuracao_sn: 1, regime_especial: 0,
});

const cert = certificadoDeTeste();
const ctx = (ambiente: 1 | 2, op = 3): Contexto => ({
  empresaId: 1,
  config: { ...CONFIG_PADRAO, webservice: { ...CONFIG_PADRAO.webservice, ambiente }, emissao: { ...CONFIG_PADRAO.emissao, percentualTributosSN: 6 } },
  prestador: prestador(op),
  certificado: cert,
});

const completa: DadosNFSe = {
  competencia: '2026-11-08',
  tomador: {
    documento: '11444777000161', nome: 'Tomador & Filhos Ltda', cep: '89160000', codigoMunicipio: '4214805',
    logradouro: 'Av. Oscar Barcelos', numero: '', bairro: 'Centro', email: 'tomador@exemplo.com.br',
  },
  codigoServico: '010701',
  codigoServicoMunicipal: '001',
  codigoNBS: '115013000',
  descricao: 'Suporte técnico em informática\nReferente a novembro/2026',
  informacoesComplementares: 'Pedido 123',
  valorServico: 1467.45,
  descontoIncondicionado: 10,
  aliquotaIss: 2.5,
  issRetido: true,
};

async function main() {
  // Id da DPS: 45 posições no padrão do XSD
  const id = idDps('4214805', '11222333000181', 1, 21);
  assert.equal(id, 'DPS421480521122233300018100001000000000000021');
  assert.match(id, /^DPS[0-9]{7}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{20}$/);
  assert.equal(idDps('4214805', '11144477735', 1, 1).charAt(10), '1');

  // Conferências antes do schema
  assert.equal(conferirDados(completa), null);
  assert.match(conferirDados({ ...completa, tomador: { ...completa.tomador!, documento: '11444777000162' } })!, /tomador inválido/);
  assert.match(conferirDados({ ...completa, tomador: null })!, /retido/);
  assert.match(conferirDados({ ...completa, codigoServico: '1234' })!, /6 dígitos/);

  for (const ambiente of [2, 1] as const) {
    for (const [nome, op, dados] of [
      ['ME/EPP completa', 3, completa],
      ['MEI sem tomador', 2, { ...completa, tomador: null, issRetido: false, descontoIncondicionado: 0, aliquotaIss: 0, codigoNBS: '' }],
      ['não optante', 1, { ...completa, issRetido: false }],
    ] as [string, number, DadosNFSe][]) {
      const c = ctx(ambiente, op);
      const dps = montarDps(c, 1, 21, dados);
      const assinado = assinar(dps.xml, 'infDPS', dps.id, cert);
      const r = await validarDps(assinado, ambiente);
      assert.ok(r.valido, `DPS ${nome} (ambiente ${ambiente}):\n${descreverErros(r.erros)}`);
      assert.ok(conferirAssinatura(assinado).valida, `assinatura da DPS ${nome}`);
      assert.equal(descompactar(compactar(assinado)), '<?xml version="1.0" encoding="UTF-8"?>' + assinado);

      // Layout de cada ambiente: a produção restrita já está na NT 009
      assert.equal(assinado.includes('<finNFSe>0</finNFSe>'), ambiente === 2);
      assert.equal(/<\/cNBS>(<cIntContrib>.*<\/cIntContrib>)?<xDescServ>/.test(assinado), ambiente === 2 && !!dados.codigoNBS);
    }

    const chave = '42148052112223330001810000000000021111' + '123456789012';
    const p = montarCancelamento(ctx(ambiente), chave, '1', 'Erro na emissão: valor & tomador errados');
    assert.equal(p.id, `PRE${chave}101101`);
    const pAssinado = assinar(p.xml, 'infPedReg', p.id, cert);
    const rp = await validarPedidoEvento(pAssinado, ambiente);
    assert.ok(rp.valido, `cancelamento (ambiente ${ambiente}):\n${descreverErros(rp.erros)}`);
  }

  assert.throws(() => montarCancelamento(ctx(2), '1'.repeat(50), '1', 'curto'), /15 caracteres/);
  assert.throws(() => montarCancelamento(ctx(2), '1'.repeat(50), '3', 'Justificativa comprida o bastante'), /motivo/);

  // pAliq só quando o Anexo I exige: ME/EPP com ISS pelo SN e retido (E0621); sem retenção (E0625) e não optante (E0617), não
  const temAliquota = (op: number, dados: DadosNFSe) => montarDps(ctx(1, op), 1, 1, dados).xml.includes('<pAliq>');
  assert.equal(temAliquota(3, completa), true);
  assert.equal(temAliquota(3, { ...completa, issRetido: false }), false);
  assert.equal(temAliquota(1, completa), false);
  assert.match(conferirDados({ ...completa, aliquotaIss: 5.01 })!, /5%/);

  // Quebra de linha da descrição chega intacta ao XML
  assert.match(montarDps(ctx(2), 1, 1, completa).xml, /informática\nReferente/);

  if (process.argv.includes('--mostrar')) console.log(montarDps(ctx(2), 1, 21, completa).xml.replace(/></g, '>\n<'));
  console.log('Autoteste da DPS: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
