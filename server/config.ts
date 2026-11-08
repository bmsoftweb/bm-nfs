/**
 * Configuração do prestador, em `nfs_config.dados` (JSON), uma linha por empresa.
 * O certificado tem tabela própria (o .pfx é binário) e os dados do prestador
 * ficam em nfs_empresas.
 */
import { pool } from './db.js';

export interface ConfigWebService {
  /** 1=Produção, 2=Produção restrita (homologação) */
  ambiente: 1 | 2;
  timeout: number;
  proxyHost: string;
  proxyPorta: string;
  proxyUsuario: string;
  proxySenha: string;
}

export interface ConfigEmissao {
  /** Série da DPS (1 a 5 dígitos) */
  serie: number;
  /** Padrões que a Nova NFS-e já traz preenchidos */
  codigoServico: string;
  codigoServicoMunicipal: string;
  codigoNBS: string;
  descricaoServico: string;
  /** Alíquota do ISS em %, vai no pAliq quando maior que zero */
  aliquotaIss: number;
  /** ME/EPP: % aproximado dos tributos do Simples (pTotTribSN); zero gera os valores zerados */
  percentualTributosSN: number;
}

export interface ConfigNFSe {
  webservice: ConfigWebService;
  emissao: ConfigEmissao;
}

export const CONFIG_PADRAO: ConfigNFSe = {
  webservice: {
    ambiente: 2,
    timeout: 60,
    proxyHost: '',
    proxyPorta: '',
    proxyUsuario: '',
    proxySenha: '',
  },
  emissao: {
    serie: 1,
    codigoServico: '',
    codigoServicoMunicipal: '',
    codigoNBS: '',
    descricaoServico: '',
    aliquotaIss: 0,
    percentualTributosSN: 0,
  },
};

/** Mescla raso por grupo: chave nova no código já vem com o padrão sem migração */
function mesclar(gravado: any): ConfigNFSe {
  const saida: any = {};
  for (const grupo of Object.keys(CONFIG_PADRAO) as (keyof ConfigNFSe)[]) {
    saida[grupo] = { ...CONFIG_PADRAO[grupo], ...(gravado?.[grupo] || {}) };
  }
  return saida as ConfigNFSe;
}

export async function lerConfig(empresaId: number): Promise<ConfigNFSe> {
  const [linhas] = await pool.query<any[]>('SELECT dados FROM nfs_config WHERE empresa_id = ? LIMIT 1', [empresaId]);
  if (!linhas.length) return mesclar(null);

  const bruto = linhas[0].dados;
  return mesclar(typeof bruto === 'string' ? JSON.parse(bruto) : bruto);
}

export async function gravarConfig(empresaId: number, config: Partial<ConfigNFSe>): Promise<ConfigNFSe> {
  const atual = await lerConfig(empresaId);
  const novo = mesclar({ ...atual, ...config });

  await pool.query(
    `INSERT INTO nfs_config (empresa_id, dados) VALUES (?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE dados = VALUES(dados)`,
    [empresaId, JSON.stringify(novo)],
  );

  return novo;
}

/** A senha do proxy não volta para a tela */
export function semSegredos(config: ConfigNFSe): ConfigNFSe {
  return { ...config, webservice: { ...config.webservice, proxySenha: config.webservice.proxySenha ? '••••••' : '' } };
}

/** Um campo de senha que voltou mascarado não deve sobrescrever o que está gravado */
export function preservarSegredos(novo: any, atual: ConfigNFSe): any {
  if (novo?.webservice && /^•+$/.test(novo.webservice.proxySenha || '')) {
    novo.webservice.proxySenha = atual.webservice.proxySenha;
  }
  return novo;
}
