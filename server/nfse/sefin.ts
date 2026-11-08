/**
 * Cliente da API do Padrão Nacional (Sefin Nacional e ADN), como o
 * PadraoNacional.Provider do ACBr: REST com JSON, TLS mútuo com o A1 do
 * prestador em todas as chamadas, e o XML assinado vai compactado (gzip) e em
 * base64 dentro do JSON. O status HTTP não decide nada: sucesso é a resposta
 * sem lista de erros.
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import tls from 'tls';
import zlib from 'zlib';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Contexto } from './contexto.js';
import type { CertificadoCarregado } from './certificado.js';
import { pastaRecursos } from './recursos.js';
import { DECLARACAO } from './xml.js';

const URLS = {
  1: { sefin: 'https://sefin.nfse.gov.br/sefinnacional', adn: 'https://adn.nfse.gov.br' },
  2: { sefin: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional', adn: 'https://adn.producaorestrita.nfse.gov.br' },
} as const;

export const urlConsultaPublica = (ambiente: number, chave: string) =>
  `https://www.${ambiente === 1 ? '' : 'producaorestrita.'}nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`;

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

/**
 * Autoridades para validar o servidor: as do Node mais as de recursos/cadeias
 * (a raiz da ICP-Brasil não vem no pacote padrão)
 */
let cacheAutoridades: string[] | null = null;

function autoridades(): string[] {
  if (cacheAutoridades) return cacheAutoridades;
  const base = pastaRecursos();
  const pasta = base ? path.join(base, 'cadeias') : null;
  const extras =
    pasta && fs.existsSync(pasta)
      ? fs.readdirSync(pasta).filter((a) => /\.(crt|pem|cer)$/i.test(a)).map((a) => fs.readFileSync(path.join(pasta, a), 'utf8'))
      : [];
  const padrao =
    typeof (tls as any).getCACertificates === 'function'
      ? ((tls as any).getCACertificates('default') as string[])
      : (tls as any).rootCertificates || [];
  cacheAutoridades = [...padrao, ...extras];
  return cacheAutoridades;
}

function traduzirErro(err: any, url: string): Error {
  const mapa: Record<string, string> = {
    ENOTFOUND: 'Servidor da Sefin Nacional não encontrado (DNS). Verifique a conexão.',
    ECONNREFUSED: 'A Sefin Nacional recusou a conexão.',
    ECONNRESET: 'A Sefin Nacional encerrou a conexão. Confira se o certificado é do prestador e está válido.',
    ETIMEDOUT: 'Tempo esgotado aguardando a Sefin Nacional.',
    EPROTO: 'Falha no handshake TLS. Geralmente é certificado vencido ou sem cadeia completa.',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'Falta a autoridade raiz do servidor em recursos/cadeias.',
    SELF_SIGNED_CERT_IN_CHAIN: 'Cadeia do servidor não confiável. Proxy ou antivírus inspecionando HTTPS?',
    CERT_HAS_EXPIRED: 'O certificado usado na conexão está vencido.',
  };
  const e = new Error(`${mapa[err?.code] || err?.message || String(err)} (${url})`);
  (e as any).code = err?.code;
  return e;
}

interface Resposta {
  status: number;
  corpo: Buffer;
  duracaoMs: number;
}

function requisitar(ctx: Contexto, metodo: 'GET' | 'POST', url: string, json?: object): Promise<Resposta> {
  const cert: CertificadoCarregado = ctx.certificado;
  const ws = ctx.config.webservice;
  const alvo = new URL(url);
  const corpo = json ? Buffer.from(JSON.stringify(json), 'utf8') : null;
  const timeoutMs = (Number(ws.timeout) || 60) * 1000;

  const opcoes: https.RequestOptions = {
    key: cert.chavePrivadaPem,
    cert: [cert.certificadoPem, ...cert.cadeiaPem].join('\n'),
    ca: autoridades(),
    minVersion: 'TLSv1.2',
    host: alvo.hostname,
    port: alvo.port || 443,
    path: alvo.pathname + alvo.search,
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json', 'Content-Length': corpo.length } : {},
  };
  if (ws.proxyHost) {
    const auth = ws.proxyUsuario ? `${encodeURIComponent(ws.proxyUsuario)}:${encodeURIComponent(ws.proxySenha || '')}@` : '';
    opcoes.agent = new HttpsProxyAgent(`http://${auth}${ws.proxyHost}:${ws.proxyPorta || 8080}`, opcoes as any);
  }

  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request(opcoes, (res) => {
      const pedacos: Buffer[] = [];
      res.on('data', (d) => pedacos.push(d));
      res.on('end', () => resolve({ status: res.statusCode || 0, corpo: Buffer.concat(pedacos), duracaoMs: Date.now() - inicio }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`A Sefin Nacional não respondeu em ${timeoutMs / 1000}s.`)));
    req.on('error', (err) => reject(traduzirErro(err, url)));
    if (corpo) req.write(corpo);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

/** XML assinado -> gzip -> base64, com a declaração e sem quebras de linha fora do conteúdo */
export function compactar(xmlAssinado: string): string {
  const xml = xmlAssinado.startsWith('<?xml') ? xmlAssinado : DECLARACAO + xmlAssinado;
  return zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

/** base64 -> gzip ou zlib (pelo número mágico) -> XML. Texto que já é XML passa direto. */
export function descompactar(b64: string | undefined | null): string {
  if (!b64) return '';
  if (b64.includes('<')) return b64;
  const bruto = Buffer.from(b64, 'base64');
  const xml = bruto[0] === 0x1f && bruto[1] === 0x8b ? zlib.gunzipSync(bruto) : zlib.inflateSync(bruto);
  return xml.toString('utf8');
}

export interface Mensagem {
  codigo: string;
  descricao: string;
  complemento?: string;
}

export interface RetornoSefin {
  ok: boolean;
  status: number;
  duracaoMs: number;
  /** Corpo como veio, para o log */
  bruto: string;
  json: any;
  erros: Mensagem[];
  alertas: Mensagem[];
}

/** Erros/erro/Erros e Alertas/alertas, em lista ou objeto único, com campos maiúsculos ou minúsculos */
function mensagens(json: any, ...nomes: string[]): Mensagem[] {
  const lista = nomes.flatMap((n) => {
    const v = json?.[n];
    return v == null ? [] : Array.isArray(v) ? v : [v];
  });
  return lista.map((m: any) => ({
    codigo: String(m?.Codigo ?? m?.codigo ?? ''),
    descricao: String(m?.Descricao ?? m?.descricao ?? m?.mensagem ?? ''),
    complemento: m?.Complemento ?? m?.complemento ?? undefined,
  }));
}

function interpretar(r: Resposta): RetornoSefin {
  const bruto = r.corpo.toString('utf8');
  let json: any = null;
  try {
    json = bruto.trim() ? JSON.parse(bruto) : null;
  } catch {
    // Página de erro (HTML, proxy): vira um erro E9999 com o texto, como no ACBr
  }

  const erros = json
    ? mensagens(json, 'erros', 'Erros', 'erro')
    : [{ codigo: 'E9999', descricao: bruto.trim() ? bruto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : `Resposta vazia (HTTP ${r.status}).` }];

  // Sem lista de erros mas com HTTP de falha (ex.: 404 do "title/status"): ainda é erro
  if (json && !erros.length && r.status >= 400) {
    erros.push({ codigo: String(json.status ?? r.status), descricao: String(json.title || json.detail || json.message || `HTTP ${r.status}`) });
  }

  return { ok: !erros.length, status: r.status, duracaoMs: r.duracaoMs, bruto, json, erros, alertas: json ? mensagens(json, 'alertas', 'Alertas') : [] };
}

export const descreverMensagens = (lista: Mensagem[]) =>
  lista.map((m) => [m.codigo, m.descricao, m.complemento].filter(Boolean).join(' - ')).join('\n');

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------

const urls = (ctx: Contexto) => URLS[ctx.config.webservice.ambiente === 1 ? 1 : 2];

export interface Chamada {
  url: string;
  envio?: string;
  retorno: RetornoSefin;
}

async function chamar(ctx: Contexto, metodo: 'GET' | 'POST', url: string, json?: object): Promise<Chamada> {
  const r = await requisitar(ctx, metodo, url, json);
  return { url, envio: json ? JSON.stringify(json) : undefined, retorno: interpretar(r) };
}

/** POST /nfse — uma DPS por chamada */
export const enviarDps = (ctx: Contexto, dpsAssinada: string) =>
  chamar(ctx, 'POST', `${urls(ctx).sefin}/nfse`, { dpsXmlGZipB64: compactar(dpsAssinada) });

/** GET /nfse/{chave} — devolve a NFS-e (nfseXmlGZipB64) */
export const consultarNFSe = (ctx: Contexto, chave: string) => chamar(ctx, 'GET', `${urls(ctx).sefin}/nfse/${chave}`);

/** GET /dps/{id} — devolve a chave da NFS-e gerada para a DPS (para quando o envio caiu sem resposta) */
export const consultarDps = (ctx: Contexto, id: string) => chamar(ctx, 'GET', `${urls(ctx).sefin}/dps/${id}`);

/** POST /nfse/{chave}/eventos */
export const enviarEvento = (ctx: Contexto, chave: string, pedidoAssinado: string) =>
  chamar(ctx, 'POST', `${urls(ctx).sefin}/nfse/${chave}/eventos`, { pedidoRegistroEventoXmlGZipB64: compactar(pedidoAssinado) });

export interface AliquotaMunicipal {
  Incidencia: string | null;
  Aliq: number | null;
  DtIni: string;
  DtFim: string | null;
}

/**
 * GET {adn}/parametrizacao/{cMun}/{01.07.01.000}/{competência}/aliquota — alíquota do serviço no município,
 * por código (não há lista). Sempre da produção: é o cadastro real da prefeitura, e na produção restrita
 * muitos municípios nem têm o convênio ativo. null = serviço não parametrizado no município.
 */
export async function consultarAliquotaMunicipal(
  ctx: Contexto,
  cMun: string,
  codigo: string,
  competencia: string,
): Promise<Record<string, AliquotaMunicipal[]> | null> {
  const servico = `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 9) || '000'}`;
  const r = await requisitar(ctx, 'GET', `${URLS[1].adn}/parametrizacao/${cMun}/${servico}/${competencia}/aliquota`);
  let json: any = null;
  try {
    json = JSON.parse(r.corpo.toString('utf8'));
  } catch {
    // HTML de erro do IIS
  }
  if (r.status === 404 && json) return null;
  if (r.status !== 200 || !json?.aliquotas) throw new Error(`ADN (parâmetros municipais, ${servico}): HTTP ${r.status} ${json?.mensagem || ''}`.trim());
  return json.aliquotas;
}
