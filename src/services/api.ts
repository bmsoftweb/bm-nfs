import {
  CertificadoInfo, ConfigNFSe, DadosNFSe, ErroApi, NotaDetalhe, NotaLista, Painel, Prestador, StatusBanco, Usuario,
} from '../types';

/**
 * Token de sessão devolvido pelo login. Vai em toda requisição no header
 * Authorization; é dele que o servidor tira a empresa.
 */
let token: string | null = null;
let aoExpirar: ((mensagem: string) => void) | null = null;

export function definirToken(novo: string | null) {
  token = novo;
}

/** Chamado quando o servidor recusa a sessão (401), para voltar ao login */
export function aoExpirarSessao(callback: (mensagem: string) => void) {
  aoExpirar = callback;
}

function cabecalhos(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 401 com sessão aberta significa token vencido ou acesso revogado: volta ao login */
function conferirSessao(status: number, mensagem: string) {
  if (status === 401 && token && aoExpirar) aoExpirar(mensagem);
}

async function pedir<T>(rota: string, opcoes: RequestInit = {}): Promise<T> {
  return lerResposta<T>(await fetch(`/api${rota}`, { ...opcoes, headers: { ...cabecalhos(), ...opcoes.headers } }));
}

/** Corpo JSON da resposta; erro vira exceção com a mensagem do servidor */
async function lerResposta<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();

  let corpo: any = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { error: texto };
  }

  if (!resposta.ok) {
    conferirSessao(resposta.status, corpo?.error || 'Sessão expirada. Entre novamente.');
    const erro: ErroApi = new Error(corpo?.error || `Falha na requisição (${resposta.status}).`);
    // Falha de schema (422) traz a lista campo a campo para a tela mostrar
    if (corpo?.errosSchema) {
      erro.errosSchema = corpo.errosSchema;
      erro.schema = corpo.schema;
    }
    throw erro;
  }
  return corpo as T;
}

const post = <T>(rota: string, corpo?: any) =>
  pedir<T>(rota, { method: 'POST', body: JSON.stringify(corpo ?? {}) });

/** Andamento de uma ação longa (rotaProgresso no servidor) */
export interface Andamento {
  etapa: string;
  feitos: number;
  total: number;
}

/** POST numa rota com progresso: chama aoAvancar a cada etapa e devolve o resultado final */
async function enviarComProgresso<T>(rota: string, aoAvancar: (a: Andamento) => void): Promise<T> {
  const resposta = await fetch(`/api${rota}`, { method: 'POST', headers: cabecalhos(), body: '{}' });
  // Sessão vencida e afins chegam como JSON comum, antes do streaming começar
  if (!resposta.ok || !resposta.body) return lerResposta<T>(resposta);
  const leitor = resposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await leitor.read();
    resto += value ?? '';
    const linhas = resto.split('\n');
    resto = done ? '' : (linhas.pop() ?? '');
    for (const l of linhas.filter(Boolean)) {
      const o = JSON.parse(l);
      if (o.erro) throw new Error(o.erro);
      if ('ok' in o) return o.ok as T;
      aoAvancar(o as Andamento);
    }
    if (done) throw new Error('A conexão terminou antes do fim da rotina.');
  }
}

// ---------------------------------------------------------------------------
// Sessão e painel
// ---------------------------------------------------------------------------

export const entrar = (cnpj: string, usuario: string, senha: string) =>
  post<{ success: boolean; token: string; usuario: Usuario; empresa: Prestador }>('/login', { cnpj, usuario, senha });

export const buscarPainel = () => pedir<Painel>('/painel');
export const buscarStatusBanco = () => pedir<StatusBanco>('/db/status');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export const buscarConfig = () =>
  pedir<{ config: ConfigNFSe; prestador: Prestador; certificado: CertificadoInfo | null }>('/config');

export const gravarConfig = (config: Partial<ConfigNFSe>) =>
  pedir<{ success: boolean; config: ConfigNFSe }>('/config', { method: 'PUT', body: JSON.stringify(config) });

export const gravarPrestador = (prestador: Partial<Prestador>) =>
  pedir<{ success: boolean; prestador: Prestador }>('/prestador', { method: 'PUT', body: JSON.stringify(prestador) });

export const enviarCertificado = (arquivoBase64: string, nomeArquivo: string, senha: string) =>
  post<{ success: boolean; certificado: any }>('/certificado', { arquivoBase64, nomeArquivo, senha });

export const removerCertificado = () => pedir<{ success: boolean }>('/certificado', { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

type RespostaEnvio = { success: boolean; nota: NotaDetalhe & { erros: any[]; alertas: any[] } };
/** Grava e transmite; `soGravar` deixa a nota assinada para transmitir depois */
export const emitirNota = (dados: DadosNFSe, soGravar = false) => post<RespostaEnvio>(soGravar ? '/notas?gravar=1' : '/notas', dados);
export const transmitirNota = (id: number) => post<RespostaEnvio>(`/notas/${id}/transmitir`);
export const buscarNota = (id: number) => pedir<NotaDetalhe>(`/notas/${id}`);
export const consultarNota = (id: number) => post<{ success: boolean; nota: NotaLista }>(`/notas/${id}/consultar`);
export const cancelarNota = (id: number, codigoMotivo: string, motivo: string) =>
  post<{ success: boolean; nota: NotaLista }>(`/notas/${id}/cancelar`, { codigoMotivo, motivo });

/** Baixa um arquivo da API (com o token) e abre numa aba (PDF) ou salva (XML) */
async function baixar(rota: string, abrir: boolean) {
  const resposta = await fetch(`/api${rota}`, { headers: cabecalhos() });
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({ error: `Falha (${resposta.status}).` }));
    conferirSessao(resposta.status, erro.error);
    throw new Error(erro.error);
  }
  const url = URL.createObjectURL(await resposta.blob());
  if (abrir) {
    window.open(url, '_blank');
  } else {
    const nome = resposta.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'arquivo';
    const a = Object.assign(document.createElement('a'), { href: url, download: nome });
    a.click();
  }
  // O objeto só pode ser liberado depois que a aba carregou
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const abrirDanfse = (id: number) => baixar(`/notas/${id}/danfse`, true);
export const baixarXml = (id: number) => baixar(`/notas/${id}/xml`, false);

// ---------------------------------------------------------------------------
// Listagens
// ---------------------------------------------------------------------------

/** Parâmetros das grades paginadas no servidor (padrão b2b admin) */
export interface ConsultaGrade {
  pagina: number;
  porPagina: number;
  busca: string;
  ordem: string;
  direcao: 'asc' | 'desc';
}

export interface PaginaGrade<T> {
  data: T[];
  total: number;
  totalPages: number;
}

const paraQuery = (c: ConsultaGrade) =>
  new URLSearchParams({
    pagina: String(c.pagina),
    porPagina: String(c.porPagina),
    busca: c.busca,
    ordem: c.ordem,
    direcao: c.direcao,
  }).toString();

export const listarNotas = (c: ConsultaGrade) => pedir<PaginaGrade<NotaLista>>(`/notas?${paraQuery(c)}`);
export const listarLog = (c: ConsultaGrade) => pedir<PaginaGrade<any>>(`/log?${paraQuery(c)}`);

// ---------------------------------------------------------------------------
// Tabelas de códigos de serviço
// ---------------------------------------------------------------------------

export interface SituacaoTabela {
  nome: 'nacionais' | 'nbs' | 'municipais';
  tabela: string;
  fonte: string;
  sql: string;
  existe: boolean;
  total: number;
  atualizadoEm: string | null;
  /** Só na municipal: o município do prestador ("RIO DO SUL - SC") */
  municipio?: string | null;
}

export interface Codigo {
  codigo: string;
  descricao: string;
}

export interface CodigoMunicipal {
  codigo: string;
  incidencia: string | null;
  aliquota: string | null;
}

export const buscarTabelas = () => pedir<SituacaoTabela[]>('/tabelas');
/** Rota com andamento: o ProgressoModal mostra a contagem enquanto a tabela é baixada */
export const atualizarTabela = (nome: SituacaoTabela['nome'], aoAvancar: (a: Andamento) => void) =>
  enviarComProgresso<{ total: number; versao: string }>(`/tabelas/${nome}/atualizar`, aoAvancar);
export const listarNacionais = (c: ConsultaGrade) => pedir<PaginaGrade<any>>(`/tabelas/nacionais?${paraQuery(c)}`);
export const listarNbs = (c: ConsultaGrade) => pedir<PaginaGrade<any>>(`/tabelas/nbs?${paraQuery(c)}`);
export const listarMunicipais = (c: ConsultaGrade) => pedir<PaginaGrade<any>>(`/tabelas/municipais?${paraQuery(c)}`);
export const buscarCodigosNacionais = () => pedir<Codigo[]>('/codigos/nacionais');
export const buscarCodigosDoServico = (nacional: string) =>
  pedir<{ nbs: Codigo[]; nbsDoItem: boolean; municipais: CodigoMunicipal[] }>(`/codigos/servico/${nacional || '-'}`);

// ---------------------------------------------------------------------------
// Preferências das grades
// ---------------------------------------------------------------------------

export const buscarConfigListas = () => pedir<Record<string, unknown>>('/config-listas');

export const gravarConfigListas = (config: Record<string, unknown>) =>
  pedir<{ success: boolean }>('/config-listas', { method: 'PUT', body: JSON.stringify(config) });
export const buscarLog = (id: number) => pedir<any>(`/log/${id}`);
