export interface Usuario {
  id: number;
  empresa_id: number;
  nome: string;
  email: string;
  cargo?: string;
}

/** Prestador de serviços (nfs_empresas) */
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
  ativo?: number;
}

export interface ConfigNFSe {
  webservice: {
    ambiente: 1 | 2;
    timeout: number;
    proxyHost: string;
    proxyPorta: string;
    proxyUsuario: string;
    proxySenha: string;
  };
  emissao: {
    serie: number;
    codigoServico: string;
    codigoServicoMunicipal: string;
    codigoNBS: string;
    descricaoServico: string;
    aliquotaIss: number;
    percentualTributosSN: number;
  };
}

export interface CertificadoInfo {
  nome_arquivo: string;
  cnpj: string;
  razao_social: string;
  numero_serie: string;
  emissor: string;
  valido_de: string;
  valido_ate: string;
  diasParaVencer: number;
  vencido: boolean;
  /** bmnfe = usando o certificado do BMNFe da empresa com o mesmo CNPJ */
  origem: 'bmnfs' | 'bmnfe';
}

/** Um problema apontado pelo XSD */
export interface ErroSchema {
  campo?: string;
  mensagem: string;
}

/** Erro devolvido pela API; na falha de schema vem com a lista de problemas */
export interface ErroApi extends Error {
  errosSchema?: ErroSchema[];
  schema?: string;
}

export interface Tomador {
  documento: string;
  nome: string;
  inscricaoMunicipal?: string;
  cep?: string;
  codigoMunicipio?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  fone?: string;
  email?: string;
}

/** O formulário da Nova NFS-e (o mesmo DadosNFSe do servidor) */
export interface DadosNFSe {
  competencia: string;
  tomador: Tomador | null;
  codigoServico: string;
  codigoServicoMunicipal: string;
  codigoNBS: string;
  descricao: string;
  municipioPrestacao: string;
  informacoesComplementares: string;
  valorServico: number;
  descontoIncondicionado: number;
  aliquotaIss: number;
  issRetido: boolean;
}

export interface NotaLista {
  id: number;
  ambiente: number;
  serie: number;
  numero_dps: number;
  numero_nfse: number | null;
  chave: string | null;
  situacao: string;
  data_emissao: string;
  competencia: string;
  tomador_documento: string | null;
  tomador_nome: string | null;
  codigo_servico: string;
  valor_servico: string;
  iss_retido: number;
  codigo_status: string | null;
  motivo: string | null;
}

export interface NotaDetalhe extends NotaLista {
  id_dps: string;
  dados: DadosNFSe | null;
  xml_dps: string | null;
  xml_nfse: string | null;
  linkConsulta: string | null;
  eventos: { id: number; tipo: string; codigo_motivo: string; motivo: string; sucesso: number; retorno: string | null; criado_em: string }[];
}

export interface StatusBanco {
  connected: boolean;
  latencyMs: number;
  version?: string;
  database: string;
  host: string;
  error?: string;
  tabelasFaltando: string[];
}

export interface Painel {
  contagens: {
    notas: number;
    autorizadas: number;
    canceladas: number;
    rejeitadas: number;
    pendentes: number;
    valor_autorizado: number;
  };
  ultimas: NotaLista[];
  erros: { operacao: string; codigo_status: string; motivo: string; criado_em: string }[];
  certificado: { razaoSocial?: string; cnpj?: string; validoAte?: string; diasParaVencer?: number; erro?: string };
  ambiente: number;
}
