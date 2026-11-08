/**
 * Tabelas de códigos de serviço da NFS-e (tela "Tabelas"): baixadas da fonte oficial só quando o
 * usuário pede. Ficam nas tabelas nfs_* do extras/2026-11-08_tabelas_servicos.sql: o app nunca cria
 * nem altera tabela.
 */
import { inflateRawSync } from 'node:zlib';
import { pool } from './db.js';
import { dataHoraMysql, dataISO } from './nfse/datas.js';
import { carregarPrestador, montarContexto } from './nfse/contexto.js';
import { consultarAliquotaMunicipal } from './nfse/sefin.js';

/** Documentação atual da NFS-e: lá sai cada versão do Anexo B (lista nacional e NBS) */
const PAGINA_DOCUMENTACAO = 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual';
/** Documentação da Reforma Tributária: Anexo VIII (correlação item da LC 116 x NBS) */
const PAGINA_RTC = 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc';
const SCRIPT = 'extras/2026-11-08_tabelas_servicos.sql';
const LOTE = 500;
/** Consultas simultâneas ao ADN na tabela municipal (uma por código nacional) */
const PARALELAS = 6;

export const TABELAS = {
  nacionais: { tabelas: ['nfs_servicos_nacionais'], fonte: 'Portal da NFS-e (Anexo B › Lista de Serviços Nacional)' },
  nbs: { tabelas: ['nfs_nbs', 'nfs_nbs_itens'], fonte: 'Portal da NFS-e (Anexo B › NBS 2.0 e Anexo VIII › correlação com a LC 116)' },
  municipais: { tabelas: ['nfs_servicos_municipais'], fonte: 'ADN (parametrização do município: alíquota de cada serviço)' },
} as const;
export type NomeTabela = keyof typeof TABELAS;

const faltaTabela = (err: any) => err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR';

/** Quantos códigos cada tabela tem e quando foi atualizada; a municipal é a do município do prestador */
export async function situacaoTabelas(empresaId: number) {
  const { codigo_municipio: cMun, municipio, uf } = await carregarPrestador(empresaId);
  const lista = [];
  for (const [nome, { tabelas, fonte }] of Object.entries(TABELAS)) {
    const [tabela] = tabelas;
    const municipal = nome === 'municipais';
    try {
      const [[l]] = await pool.query<any[]>(
        `SELECT COUNT(*) AS total, MAX(atualizado_em) AS atualizadoEm FROM ${tabela}${municipal ? ' WHERE codigo_municipio = ?' : ''}`,
        municipal ? [cMun || ''] : [],
      );
      lista.push({ nome, tabela: tabelas.join(', '), fonte, sql: SCRIPT, existe: true, total: Number(l.total), atualizadoEm: l.atualizadoEm });
    } catch (err: any) {
      if (!faltaTabela(err)) throw err;
      lista.push({ nome, tabela: tabelas.join(', '), fonte, sql: SCRIPT, existe: false, total: 0, atualizadoEm: null });
    }
    if (municipal) Object.assign(lista[lista.length - 1], { municipio: cMun ? `${municipio || cMun}${uf ? ` - ${uf}` : ''}` : null });
  }
  return lista;
}

export async function atualizarTabela(nome: string, empresaId: number): Promise<{ total: number; versao: string }> {
  if (nome === 'nacionais') return atualizarNacionais();
  if (nome === 'nbs') return atualizarNbs();
  if (nome === 'municipais') return atualizarMunicipais(empresaId);
  throw new Error(`Tabela "${nome}" desconhecida.`);
}

/** Troca o conteúdo numa transação só: ou a tabela inteira entra, ou nada muda */
async function gravar(passos: { apagar: string; apagarParams?: unknown[]; inserir: string; linhas: unknown[][] }[]) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of passos) {
      await conn.query(p.apagar, p.apagarParams ?? []);
      for (let i = 0; i < p.linhas.length; i += LOTE) await conn.query(p.inserir, [p.linhas.slice(i, i + LOTE)]);
    }
    await conn.commit();
  } catch (err: any) {
    await conn.rollback();
    throw faltaTabela(err) ? new Error(`As tabelas de códigos não estão prontas no banco: rode o ${SCRIPT}.`) : err;
  } finally {
    conn.release();
  }
}

async function baixar(url: string) {
  // O gov.br recusa cliente sem User-Agent de navegador
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (BMNFs)' }, signal: AbortSignal.timeout(30000) }).catch((e) => {
    throw new Error(`Não foi possível baixar de ${new URL(url).host}: ${e.cause?.code || e.message}`);
  });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu HTTP ${r.status}.`);
  return r;
}

/** A planilha mais nova cujo link casa com o padrão (a versão vem no nome: v1-01, v01-02-00...) */
async function planilhaDaPagina(pagina: string, padrao: RegExp, nome: string) {
  const html = await (await baixar(pagina)).text();
  const versao = (link: string) => (link.match(/v0?(\d+)-(\d+)(?:-(\d+))?/) ?? []).slice(1).map((n) => Number(n) || 0);
  const links = [...new Set([...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => m[1]).filter((l) => padrao.test(l)))].sort((a, b) => {
    const [va, vb] = [versao(a), versao(b)];
    return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
  });
  if (!links.length) throw new Error(`O ${nome} não foi encontrado em ${new URL(pagina).host}.`);
  const url = new URL(links[0], pagina).href;
  return { xlsx: Buffer.from(await (await baixar(url)).arrayBuffer()), arquivo: decodeURIComponent(url.split('/').pop()!) };
}

// ---------------------------------------------------------------------------
// Leitura do .xlsx (zip + XML), sem dependência
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const textoXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] !== '#' ? ENTIDADES[e] ?? m : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );
const textos = (s: string) => [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => textoXml(t[1])).join('');

/** Linhas da aba pelo nome, como { coluna: texto } (ex.: { A: '10701', E: 'Suporte técnico...' }) */
function lerAba(xlsx: Buffer, nomeAba: string): Record<string, string>[] {
  const livro = arquivoDoZip(xlsx, 'xl/workbook.xml') ?? '';
  const rid = livro.match(new RegExp(`<sheet [^>]*name="${nomeAba.replace(/\./g, '\\.')}"[^>]*r:id="(\\w+)"`))?.[1];
  const alvo = rid && (arquivoDoZip(xlsx, 'xl/_rels/workbook.xml.rels') ?? '').match(new RegExp(`Id="${rid}"[^>]*Target="/?(?:xl/)?([^"]+)"`))?.[1];
  const aba = alvo && arquivoDoZip(xlsx, `xl/${alvo}`);
  if (!aba) throw new Error(`A planilha baixada não tem a aba "${nomeAba}": o formato mudou.`);
  const compartilhados = [...(arquivoDoZip(xlsx, 'xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  return [...aba.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, linha]) => {
    const cel: Record<string, string> = {};
    for (const [, attrs, corpo = ''] of linha.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const coluna = attrs.match(/\br="([A-Z]+)/)?.[1];
      const tipo = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (coluna) cel[coluna] = (tipo === 's' ? compartilhados[Number(v)] : tipo === 'inlineStr' ? textos(corpo) : textoXml(v ?? '')).trim();
    }
    return cel;
  });
}

/** Conteúdo de um arquivo de dentro do .zip (o .xlsx é um zip), achado pelo diretório central */
function arquivoDoZip(zip: Buffer, nome: string): string | null {
  const fim = zip.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (fim < 0) throw new Error('O arquivo baixado não é a planilha esperada (.xlsx).');
  let p = zip.readUInt32LE(fim + 16);
  for (let i = zip.readUInt16LE(fim + 10); i > 0; i--) {
    const tamNome = zip.readUInt16LE(p + 28);
    if (zip.toString('utf8', p + 46, p + 46 + tamNome) === nome) {
      const local = zip.readUInt32LE(p + 42);
      const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const dados = zip.subarray(ini, ini + zip.readUInt32LE(p + 20));
      return (zip.readUInt16LE(p + 10) === 8 ? inflateRawSync(dados) : dados).toString('utf8');
    }
    p += 46 + tamNome + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return null;
}

/** Colunas pelo cabeçalho, não pela posição: se a planilha mudar, falha em vez de gravar errado */
function colunas(cab: Record<string, string>, planilha: string, inicios: string[]) {
  const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return inicios.map((inicio) => {
    const c = Object.keys(cab).find((k) => sem(cab[k] || '').startsWith(sem(inicio)));
    if (!c) throw new Error(`A planilha ${planilha} mudou de formato: falta a coluna "${inicio}".`);
    return c;
  });
}

const dois = (v: string) => String(Number(v) || 0).padStart(2, '0');
/** 1.1502.10.00 → 115021000 */
const nbsDigitos = (v?: string) => (/^\d\.\d{4}\.\d{2}\.\d{2}$/.test(v ?? '') ? v!.replace(/\D/g, '') : null);

// ---------------------------------------------------------------------------
// Lista de Serviços Nacional e NBS (Anexo B; correlação do Anexo VIII)
// ---------------------------------------------------------------------------

async function anexoB() {
  return planilhaDaPagina(PAGINA_DOCUMENTACAO, /anexo_?b[^/]*\.xlsx$/i, 'Anexo B (Lista de Serviços Nacional e NBS)');
}

async function atualizarNacionais() {
  const { xlsx, arquivo } = await anexoB();
  const [cab, ...corpo] = lerAba(xlsx, 'LISTA.SERV.NAC.');
  const [cItem, cSub, cDesd, cDesc] = colunas(cab, 'da Lista de Serviços Nacional', ['ITEM', 'SUBITEM', 'DESDOBRO', 'DESCRI']);
  const agora = dataHoraMysql();
  // Só as linhas de desdobro (as de item e subitem têm desdobro 0): são os códigos que a DPS aceita
  const linhas = corpo
    .filter((l) => Number(l[cDesd]) > 0 && l[cDesc])
    .map((l) => [`${dois(l[cItem])}${dois(l[cSub])}${dois(l[cDesd])}`, l[cDesc], agora, agora]);
  if (linhas.length < 300) throw new Error(`A Lista de Serviços Nacional veio com só ${linhas.length} códigos: nada foi gravado.`);

  await gravar([{ apagar: 'DELETE FROM nfs_servicos_nacionais', inserir: 'INSERT INTO nfs_servicos_nacionais (codigo, descricao, criado_em, atualizado_em) VALUES ?', linhas }]);
  return { total: linhas.length, versao: arquivo };
}

async function atualizarNbs() {
  const [b, viii] = await Promise.all([
    anexoB(),
    planilhaDaPagina(PAGINA_RTC, /anexo_?viii[^/]*\.xlsx$/i, 'Anexo VIII (correlação item da LC 116 x NBS)'),
  ]);

  const [cab, ...corpo] = lerAba(b.xlsx, 'LISTA.NBS_v2.0');
  const [cCod, cDesc] = colunas(cab, 'da NBS', ['CÓDIGO NBS', 'DESCRI']);
  const agora = dataHoraMysql();
  // Só os códigos completos (0.0000.00.00): capítulo, posição e subposição não entram na DPS
  const nbs = corpo.flatMap((l) => {
    const codigo = nbsDigitos(l[cCod]);
    return codigo && l[cDesc] ? [[codigo, l[cDesc].replace(/\s+/g, ' '), agora, agora]] : [];
  });
  if (nbs.length < 500) throw new Error(`A NBS veio com só ${nbs.length} códigos: nada foi gravado.`);

  // Anexo VIII: o item fica numa célula mesclada, só na 1ª linha do bloco
  const [cab8, ...corpo8] = lerAba(viii.xlsx, 'tabela geral');
  const [cItem, cNbs] = colunas(cab8, 'do Anexo VIII', ['ITEM LC 116', 'NBS']);
  let item = '';
  const pares = new Set<string>();
  for (const l of corpo8) {
    if (/^\d{1,2}\.\d{2}$/.test(l[cItem] ?? '')) item = l[cItem].split('.').map(dois).join('');
    const codigo = nbsDigitos(l[cNbs]);
    if (item && codigo) pares.add(`${item}${codigo}`);
  }
  if (pares.size < 300) throw new Error(`O Anexo VIII veio com só ${pares.size} correlações: nada foi gravado.`);
  const itens = [...pares].map((p) => [p.slice(0, 4), p.slice(4), agora, agora]);

  await gravar([
    { apagar: 'DELETE FROM nfs_nbs', inserir: 'INSERT INTO nfs_nbs (codigo, descricao, criado_em, atualizado_em) VALUES ?', linhas: nbs },
    { apagar: 'DELETE FROM nfs_nbs_itens', inserir: 'INSERT INTO nfs_nbs_itens (item, nbs, criado_em, atualizado_em) VALUES ?', linhas: itens },
  ]);
  return { total: nbs.length, versao: `${b.arquivo}; ${itens.length} correlações do ${viii.arquivo}` };
}

// ---------------------------------------------------------------------------
// Serviços do município (parametrização no ADN, consultada código a código)
// ---------------------------------------------------------------------------

/** "2026-11-08T00:00:00" → "2026-11-08" */
const data = (v?: string | null) => (v ? v.slice(0, 10) : null);

async function atualizarMunicipais(empresaId: number) {
  const ctx = await montarContexto(empresaId);
  const cMun = ctx.prestador.codigo_municipio;
  if (!cMun) throw new Error('Informe o município do prestador em Configurações › Prestador.');
  const [nacionais] = await pool.query<any[]>('SELECT codigo FROM nfs_servicos_nacionais ORDER BY codigo').catch((err) => {
    throw faltaTabela(err) ? new Error(`As tabelas de códigos não estão prontas no banco: rode o ${SCRIPT}.`) : err;
  });
  if (!nacionais.length) throw new Error('Baixe antes a Lista de Serviços Nacional: a consulta ao município é feita código a código.');

  const hoje = dataISO();
  const agora = dataHoraMysql();
  const linhas: unknown[][] = [];
  const fila = nacionais.map((n) => String(n.codigo));
  // A resposta vem por código de 9 dígitos: se o município tiver códigos próprios, eles vêm junto
  const consultar = async () => {
    for (let codigo = fila.shift(); codigo; codigo = fila.shift()) {
      const aliquotas = await consultarAliquotaMunicipal(ctx, cMun, codigo, hoje);
      for (const [servico, vigencias] of Object.entries(aliquotas ?? {})) {
        const v = [...vigencias].sort((a, b) => a.DtIni.localeCompare(b.DtIni)).pop();
        if (v) linhas.push([cMun, servico.replace(/\D/g, '').padEnd(9, '0'), v.Incidencia, v.Aliq, data(v.DtIni), data(v.DtFim), agora, agora]);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALELAS }, consultar));
  if (!linhas.length) throw new Error(`O município ${cMun} não tem nenhum serviço parametrizado no ADN: nada foi gravado.`);

  await gravar([
    {
      apagar: 'DELETE FROM nfs_servicos_municipais WHERE codigo_municipio = ?',
      apagarParams: [cMun],
      inserir: `INSERT INTO nfs_servicos_municipais
                  (codigo_municipio, codigo, incidencia, aliquota, inicio_vigencia, fim_vigencia, criado_em, atualizado_em) VALUES ?`,
      linhas,
    },
  ]);
  return { total: linhas.length, versao: `${ctx.prestador.municipio || cMun}, de ${nacionais.length} códigos nacionais consultados` };
}

// ---------------------------------------------------------------------------
// Consultas dos campos de código (Configurações › Emissão e Nova NFS-e)
// ---------------------------------------------------------------------------

export async function codigosNacionais() {
  const [linhas] = await pool.query<any[]>('SELECT codigo, descricao FROM nfs_servicos_nacionais ORDER BY codigo');
  return linhas;
}

/**
 * Para um código nacional: as NBS do subitem (Anexo VIII; sem correlação, a NBS inteira)
 * e os códigos do município do prestador, com a alíquota do ISS lá.
 */
export async function codigosDoServico(empresaId: number, nacional: string) {
  const item = /^\d{6}$/.test(nacional) ? nacional.slice(0, 4) : '';
  const [correlatas] = await pool.query<any[]>(
    'SELECT n.codigo, n.descricao FROM nfs_nbs_itens i JOIN nfs_nbs n ON n.codigo = i.nbs WHERE i.item = ? ORDER BY n.codigo',
    [item],
  );
  const [todas] = correlatas.length ? [correlatas] : await pool.query<any[]>('SELECT codigo, descricao FROM nfs_nbs ORDER BY codigo');

  const { codigo_municipio: cMun } = await carregarPrestador(empresaId);
  const [municipais] = item
    ? await pool.query<any[]>(
        `SELECT RIGHT(codigo, 3) AS codigo, incidencia, aliquota FROM nfs_servicos_municipais
          WHERE codigo_municipio = ? AND LEFT(codigo, 6) = ? ORDER BY codigo`,
        [cMun || '', nacional],
      )
    : [[]];
  return { nbs: todas, nbsDoItem: correlatas.length > 0, municipais };
}
