/**
 * Emissão, consulta, cancelamento e DANFSe, com o registro em nfs_notas,
 * nfs_eventos e nfs_log.
 *
 * Situações da nota: pendente (enviada sem resposta conclusiva: consultar),
 * autorizada, rejeitada, cancelada.
 */
import { pool } from '../db.js';
import { assinar } from './assinatura.js';
import { Contexto, montarContexto, registrarLog } from './contexto.js';
import { dataHoraMysql } from './datas.js';
import { conferirDados, DadosNFSe, montarCancelamento, montarDps } from './dps.js';
import * as sefin from './sefin.js';
import { exigirValido, validarDps, validarPedidoEvento } from './validacao.js';
import { valorTag } from './xml.js';

/**
 * Próximo número da DPS, atômico: LAST_INSERT_ID(expr) sobe o contador e guarda
 * o valor para esta conexão num comando só. O GREATEST cobre notas que entraram
 * por fora do contador.
 */
async function reservarNumero(empresaId: number, serie: number, ambiente: number): Promise<number> {
  const con = await pool.getConnection();
  try {
    const [maior] = await con.query<any[]>(
      'SELECT COALESCE(MAX(numero_dps), 0) AS n FROM nfs_notas WHERE empresa_id = ? AND serie = ? AND ambiente = ?',
      [empresaId, serie, ambiente],
    );
    const seguinte = Number(maior[0].n) + 1;
    await con.query(
      `INSERT INTO nfs_numeracao (empresa_id, serie, ambiente, ultimo_numero)
       VALUES (?, ?, ?, LAST_INSERT_ID(?))
       ON DUPLICATE KEY UPDATE ultimo_numero = LAST_INSERT_ID(GREATEST(ultimo_numero + 1, ?))`,
      [empresaId, serie, ambiente, seguinte, seguinte],
    );
    const [linhas] = await con.query<any[]>('SELECT LAST_INSERT_ID() AS numero');
    return Number(linhas[0].numero);
  } finally {
    con.release();
  }
}

/** Chave (50 dígitos), número e data de processamento, lidos da NFS-e devolvida */
function lerNFSe(xml: string) {
  const id = xml.match(/<infNFSe[^>]*\bId="([^"]+)"/i)?.[1] || '';
  return { chave: id.replace(/^\D+/, ''), numero: valorTag(xml, 'nNFSe') };
}

async function logar(ctx: Contexto, operacao: string, c: sefin.Chamada, chave?: string, envio?: string) {
  const r = c.retorno;
  await registrarLog(ctx.empresaId, {
    operacao,
    url: c.url,
    chave,
    sucesso: r.ok,
    codigoStatus: r.erros[0]?.codigo || r.alertas[0]?.codigo || String(r.status),
    motivo: sefin.descreverMensagens(r.erros.length ? r.erros : r.alertas) || undefined,
    duracaoMs: r.duracaoMs,
    envio: envio ?? c.envio,
    retorno: r.bruto,
  });
}

async function buscarNota(empresaId: number, notaId: number) {
  const [linhas] = await pool.query<any[]>('SELECT * FROM nfs_notas WHERE id = ? AND empresa_id = ?', [notaId, empresaId]);
  if (!linhas.length) throw new Error('Nota não encontrada.');
  return linhas[0];
}

async function gravarAutorizada(notaId: number, xmlNfse: string, chaveResposta: string, alertas: sefin.Mensagem[]) {
  const lida = lerNFSe(xmlNfse);
  await pool.query(
    `UPDATE nfs_notas SET situacao = 'autorizada', chave = ?, numero_nfse = ?, xml_nfse = ?,
            codigo_status = ?, motivo = ?, atualizado_em = ?
      WHERE id = ?`,
    [
      lida.chave || chaveResposta || null,
      lida.numero || null,
      xmlNfse || null,
      alertas[0]?.codigo || null,
      sefin.descreverMensagens(alertas).slice(0, 1000) || null,
      dataHoraMysql(),
      notaId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Emissão
// ---------------------------------------------------------------------------

export async function emitir(empresaId: number, dados: DadosNFSe) {
  const ctx = await montarContexto(empresaId);
  const erro = conferirDados(dados);
  if (erro) throw new Error(erro);

  const ambiente = ctx.config.webservice.ambiente;
  const serie = Number(ctx.config.emissao.serie) || 1;

  // Valida com um número provisório antes de reservar o definitivo: DPS com erro
  // de schema não gasta número
  const teste = montarDps(ctx, serie, 1, dados);
  exigirValido(await validarDps(assinar(teste.xml, 'infDPS', teste.id, ctx.certificado), ambiente), 'Falha na validação da DPS.');

  const numero = await reservarNumero(empresaId, serie, ambiente);
  const dps = montarDps(ctx, serie, numero, dados);
  const xmlDps = assinar(dps.xml, 'infDPS', dps.id, ctx.certificado);
  const t = dados.tomador;

  const [ins] = await pool.query<any>(
    `INSERT INTO nfs_notas
       (empresa_id, ambiente, serie, numero_dps, id_dps, situacao, data_emissao, competencia,
        tomador_documento, tomador_nome, codigo_servico, valor_servico, aliquota_iss, iss_retido,
        dados, xml_dps, criado_em)
     VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId, ambiente, serie, numero, dps.id, dataHoraMysql(dps.dataEmissao), dados.competencia,
      t?.nome ? String(t.documento).replace(/\D/g, '') : null, t?.nome || null,
      String(dados.codigoServico).replace(/\D/g, ''), Number(dados.valorServico), Number(dados.aliquotaIss || 0), dados.issRetido ? 1 : 0,
      JSON.stringify(dados), xmlDps, dataHoraMysql(),
    ],
  );
  const notaId = Number(ins.insertId);

  let chamada: sefin.Chamada;
  try {
    chamada = await sefin.enviarDps(ctx, xmlDps);
  } catch (err: any) {
    // Sem resposta: a nota fica pendente e a consulta pela DPS resolve depois
    await registrarLog(empresaId, { operacao: 'Emitir', sucesso: false, motivo: err.message, envio: xmlDps });
    await pool.query('UPDATE nfs_notas SET motivo = ?, atualizado_em = ? WHERE id = ?', [String(err.message).slice(0, 1000), dataHoraMysql(), notaId]);
    throw new Error(`${err.message} A nota ficou pendente: use Consultar para saber se foi autorizada.`);
  }

  const r = chamada.retorno;
  await logar(ctx, 'Emitir', chamada, r.json?.chaveAcesso, xmlDps);

  if (r.ok) {
    await gravarAutorizada(notaId, sefin.descompactar(r.json?.nfseXmlGZipB64), String(r.json?.chaveAcesso || ''), r.alertas);
  } else {
    await pool.query(
      `UPDATE nfs_notas SET situacao = 'rejeitada', codigo_status = ?, motivo = ?, atualizado_em = ? WHERE id = ?`,
      [r.erros[0].codigo.slice(0, 20), sefin.descreverMensagens(r.erros).slice(0, 1000), dataHoraMysql(), notaId],
    );
  }
  return { notaId, ...(await buscarNota(empresaId, notaId)), erros: r.erros, alertas: r.alertas };
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/** Consulta, DANFSe e cancelamento vão ao ambiente onde a nota foi emitida, não ao da configuração atual */
async function contextoDaNota(empresaId: number, nota: { ambiente: number }): Promise<Contexto> {
  const ctx = await montarContexto(empresaId);
  return { ...ctx, config: { ...ctx.config, webservice: { ...ctx.config.webservice, ambiente: Number(nota.ambiente) === 1 ? 1 : 2 } } };
}

/** Pela chave quando já existe; sem ela, pergunta pela DPS qual chave foi gerada */
export async function consultar(empresaId: number, notaId: number) {
  const nota = await buscarNota(empresaId, notaId);
  if (nota.situacao === 'cancelada') return nota;
  const ctx = await contextoDaNota(empresaId, nota);

  let chave: string = nota.chave || '';
  if (!chave) {
    const pelaDps = await sefin.consultarDps(ctx, nota.id_dps);
    await logar(ctx, 'Consultar DPS', pelaDps);
    if (!pelaDps.retorno.ok) {
      throw new Error(`A Sefin Nacional não encontrou NFS-e para esta DPS.\n${sefin.descreverMensagens(pelaDps.retorno.erros)}`);
    }
    chave = String(pelaDps.retorno.json?.chaveAcesso || '');
    if (!chave) throw new Error('A consulta da DPS não devolveu a chave da NFS-e.');
  }

  const c = await sefin.consultarNFSe(ctx, chave);
  await logar(ctx, 'Consultar NFS-e', c, chave);
  if (!c.retorno.ok) throw new Error(sefin.descreverMensagens(c.retorno.erros));

  await gravarAutorizada(notaId, sefin.descompactar(c.retorno.json?.nfseXmlGZipB64), chave, []);
  return buscarNota(empresaId, notaId);
}

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

export async function cancelar(empresaId: number, notaId: number, cMotivo: string, xMotivo: string) {
  const nota = await buscarNota(empresaId, notaId);
  if (nota.situacao !== 'autorizada' || !nota.chave) throw new Error('Só uma NFS-e autorizada pode ser cancelada.');
  const ctx = await contextoDaNota(empresaId, nota);

  const pedido = montarCancelamento(ctx, nota.chave, String(cMotivo), xMotivo);
  const assinado = assinar(pedido.xml, 'infPedReg', pedido.id, ctx.certificado);
  exigirValido(await validarPedidoEvento(assinado, ctx.config.webservice.ambiente), 'Falha na validação do pedido de cancelamento.');

  const c = await sefin.enviarEvento(ctx, nota.chave, assinado);
  await logar(ctx, 'Cancelar', c, nota.chave, assinado);
  const r = c.retorno;

  await pool.query(
    `INSERT INTO nfs_eventos (empresa_id, nota_id, chave, tipo, codigo_motivo, motivo, sucesso, retorno, xml_envio, xml_retorno, criado_em)
     VALUES (?, ?, ?, 'e101101', ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId, notaId, nota.chave, String(cMotivo), String(xMotivo).slice(0, 255), r.ok ? 1 : 0,
      sefin.descreverMensagens(r.erros).slice(0, 1000) || null, assinado, sefin.descompactar(r.json?.eventoXmlGZipB64) || r.bruto,
      dataHoraMysql(),
    ],
  );
  if (!r.ok) throw new Error(sefin.descreverMensagens(r.erros));

  await pool.query(
    `UPDATE nfs_notas SET situacao = 'cancelada', atualizado_em = ? WHERE id = ?`,
    [dataHoraMysql(), notaId],
  );
  return buscarNota(empresaId, notaId);
}

// ---------------------------------------------------------------------------
// DANFSe (o PDF oficial, gerado pelo ADN)
// ---------------------------------------------------------------------------

export async function danfse(empresaId: number, notaId: number): Promise<{ pdf: Buffer; nome: string }> {
  const nota = await buscarNota(empresaId, notaId);
  if (!nota.chave) throw new Error('A nota ainda não tem chave: só a NFS-e autorizada tem DANFSe.');
  const ctx = await contextoDaNota(empresaId, nota);

  const r = await sefin.obterDanfse(ctx, nota.chave);
  if (r.pdf) return { pdf: r.pdf, nome: `NFSe_${nota.numero_nfse || nota.chave}.pdf` };

  await logar(ctx, 'DANFSe', { url: r.url, retorno: r.retorno! }, nota.chave);
  throw new Error(sefin.descreverMensagens(r.retorno!.erros) || 'O ADN não devolveu o PDF.');
}

export { buscarNota };
