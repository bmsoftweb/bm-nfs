/**
 * Reúne o que toda operação com a Sefin Nacional precisa: configuração,
 * prestador e certificado. O certificado fica em cache na memória porque abrir
 * o PKCS#12 custa caro e ele só muda quando é trocado.
 */
import { pool } from '../db.js';
import { ConfigNFSe, lerConfig } from '../config.js';
import { carregarPfx, CertificadoCarregado } from './certificado.js';
import { dataHoraMysql } from './datas.js';

export interface Prestador {
  id: number;
  cnpj: string;
  inscricao_municipal: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  codigo_municipio: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  fone: string | null;
  email: string | null;
  /** 1=Não optante, 2=MEI, 3=ME/EPP */
  op_simples_nacional: number;
  regime_apuracao_sn: number | null;
  regime_especial: number;
}

export interface Contexto {
  empresaId: number;
  config: ConfigNFSe;
  prestador: Prestador;
  certificado: CertificadoCarregado;
}

/** De onde veio o certificado: do próprio BMNFs ou do BMNFe (mesmo CNPJ) */
export type OrigemCertificado = 'bmnfs' | 'bmnfe';

const cacheCertificado = new Map<string, { atualizadoEm: string; cert: CertificadoCarregado }>();

export function esquecerCertificado(empresaId: number) {
  for (const chave of [...cacheCertificado.keys()]) {
    if (chave.endsWith(`:${empresaId}`)) cacheCertificado.delete(chave);
  }
}

/**
 * Linha do certificado: o do BMNFs ou, sem ele, o do BMNFe da empresa com o mesmo
 * CNPJ, para não precisar cadastrar o mesmo .pfx duas vezes.
 */
export async function linhaCertificado(empresaId: number): Promise<{ linha: any; origem: OrigemCertificado } | null> {
  const [proprio] = await pool.query<any[]>('SELECT * FROM nfs_certificados WHERE empresa_id = ? LIMIT 1', [empresaId]);
  if (proprio.length) return { linha: proprio[0], origem: 'bmnfs' };

  try {
    const [doBmnfe] = await pool.query<any[]>(
      `SELECT c.* FROM nfe_certificados c
         JOIN nfe_empresas e ON e.id = c.empresa_id
         JOIN nfs_empresas s ON s.cnpj = e.cnpj COLLATE utf8mb4_unicode_ci
        WHERE s.id = ? LIMIT 1`,
      [empresaId],
    );
    if (doBmnfe.length) return { linha: doBmnfe[0], origem: 'bmnfe' };
  } catch {
    // Banco sem o BMNFe: só vale o certificado do próprio BMNFs
  }
  return null;
}

export async function carregarCertificado(empresaId: number): Promise<CertificadoCarregado> {
  const achado = await linhaCertificado(empresaId);
  if (!achado) {
    throw new Error('Nenhum certificado digital cadastrado. Envie o arquivo .pfx em Configurações › Certificado.');
  }

  const { arquivo, senha, atualizado_em } = achado.linha;
  const chave = `${achado.origem}:${empresaId}`;
  const emCache = cacheCertificado.get(chave);
  if (emCache && emCache.atualizadoEm === String(atualizado_em)) return emCache.cert;

  const cert = carregarPfx(Buffer.from(arquivo), senha);
  cacheCertificado.set(chave, { atualizadoEm: String(atualizado_em), cert });
  return cert;
}

export async function carregarPrestador(empresaId: number): Promise<Prestador> {
  const [linhas] = await pool.query<any[]>('SELECT * FROM nfs_empresas WHERE id = ? LIMIT 1', [empresaId]);
  if (!linhas.length) throw new Error('Prestador não encontrado.');
  return linhas[0] as Prestador;
}

export async function montarContexto(empresaId: number): Promise<Contexto> {
  const [config, prestador, certificado] = await Promise.all([
    lerConfig(empresaId),
    carregarPrestador(empresaId),
    carregarCertificado(empresaId),
  ]);

  if (certificado.info.diasParaVencer < 0) {
    throw new Error(`O certificado digital venceu em ${certificado.info.validoAte.toLocaleDateString('pt-BR')}.`);
  }
  if (!/^\d{7}$/.test(prestador.codigo_municipio || '')) {
    throw new Error('Informe o código IBGE do município do prestador em Configurações › Prestador.');
  }

  return { empresaId, config, prestador, certificado };
}

export interface RegistroLog {
  operacao: string;
  url?: string;
  chave?: string;
  sucesso: boolean;
  codigoStatus?: string;
  motivo?: string;
  duracaoMs?: number;
  envio?: string;
  retorno?: string;
}

export async function registrarLog(empresaId: number, reg: RegistroLog) {
  try {
    await pool.query(
      `INSERT INTO nfs_log
         (empresa_id, operacao, url, chave, sucesso, codigo_status, motivo, duracao_ms, envio, retorno, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        reg.operacao,
        reg.url?.slice(0, 255) || null,
        reg.chave || null,
        reg.sucesso ? 1 : 0,
        reg.codigoStatus?.slice(0, 20) ?? null,
        reg.motivo?.slice(0, 255) || null,
        reg.duracaoMs ?? null,
        reg.envio || null,
        reg.retorno || null,
        dataHoraMysql(),
      ],
    );
  } catch (err) {
    // O log nunca pode derrubar a operação que ele está registrando
    console.warn('Falha ao gravar o log da operação:', err);
  }
}
