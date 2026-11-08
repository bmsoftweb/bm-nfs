/**
 * DANFSe em PDF, no leiaute da NT 008 SE/CGNFS-e v1.02 (Anexo I).
 *
 * A API de DANFSe do ADN foi suspensa em 03/08/2026 pela própria NT 008: desde então o
 * documento auxiliar é gerado pelo emissor a partir do XML autorizado. As medidas seguem a
 * tabela 2.4.5 (em cm, a partir da borda do papel); os quadros de tamanho variável
 * (Descrição do Serviço e Informações Complementares) ficam com o espaço que sobra.
 * Helvetica faz as vezes de Arial / Microsoft Sans Serif (mesmas métricas, sem embutir fonte).
 * O canhoto é opcional (nota 11) e não é impresso.
 */
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js/node';
import { arquivoRecurso } from './recursos.js';
import { lerXml } from './xml.js';

const CM = 72 / 2.54;
const c = (cm: number) => cm * CM;

/** Corpo de 0,30 a 20,70 cm, em quatro colunas de 5,09 cm */
const ESQ = 0.3;
const LARG = 20.4;
const COL = 5.09;
const [C1, C2, C3, C4] = [0.3, 5.41, 10.51, 15.62];
const DUAS = 10.19;
const LINHA = 0.64;
const PAD = 0.08;
/** Borda da página (NT 2.2.2: até 0,20 cm do fim do papel) e limite de baixo do conteúdo */
const BORDA = 0.2;
const FIM = 29.7 - BORDA - 0.08;
/** Cinza claro a 5% (NT 2.2.3) */
const FUNDO = '#F2F2F2';

// ---------------------------------------------------------------------------
// Descrições dos códigos (documentação dos tipos no XSD da NFS-e v1.01)
// ---------------------------------------------------------------------------

type Tabela = Record<string, string>;
const SITUACAO: Tabela = { '100': 'NFS-e Gerada', '102': 'NFS-e de Decisão Judicial', '103': 'NFS-e Avulsa', '107': 'NFS-e MEI' };
const FINALIDADE: Tabela = { '0': 'NFS-e regular' };
const EMITENTE: Tabela = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' };
const AMBIENTE_GERADOR: Tabela = { '1': 'Prefeitura', '2': 'Sistema Nacional da NFS-e' };
const TIPO_AMBIENTE: Tabela = { '1': 'Produção', '2': 'Homologação' };
const SIMPLES: Tabela = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
};
const APURACAO_SN: Tabela = {
  '1': 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional',
  '2': 'Regime de apuração dos tributos federais pelo SN e o ISSQN por fora do SN conforme respectiva legislação municipal do tributo',
  '3': 'Regime de apuração dos tributos federais e municipal por fora do SN conforme respectivas legislações federal e municipal de cada tributo',
};
const REGIME_ESPECIAL: Tabela = {
  '0': 'Nenhum', '1': 'Ato Cooperado (Cooperativa)', '2': 'Estimativa', '3': 'Microempresa Municipal',
  '4': 'Notário ou Registrador', '5': 'Profissional Autônomo', '6': 'Sociedade de Profissionais', '9': 'Outros',
};
const TRIBUTACAO_ISSQN: Tabela = { '1': 'Operação Tributável', '2': 'Imunidade', '3': 'Exportação de Serviço', '4': 'Não Incidência' };
const IMUNIDADE: Tabela = {
  '0': 'Imunidade (tipo não informado na nota de origem)',
  '1': 'Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)',
  '2': 'Templos de qualquer culto (CF88, Art 150, VI, b)',
  '3': 'Patrimônio, renda ou serviços dos partidos políticos, entidades sindicais, de educação e de assistência social (CF88, Art 150, VI, c)',
  '4': 'Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)',
  '5': 'Fonogramas e videofonogramas musicais produzidos no Brasil (CF88, Art 150, VI, e)',
};
const SUSPENSAO: Tabela = { '1': 'Exigibilidade Suspensa por Decisão Judicial', '2': 'Exigibilidade Suspensa por Processo Administrativo' };
const BENEFICIO: Tabela = { '1': 'Isenção', '2': 'Redução da BC em percentual', '3': 'Redução da BC em valor', '4': 'Alíquota Diferenciada' };
const RETENCAO_ISSQN: Tabela = { '1': 'Não Retido', '2': 'Retido pelo Tomador', '3': 'Retido pelo Intermediário' };
const RETENCAO_PIS_COFINS: Tabela = {
  '0': 'PIS/COFINS/CSLL Não Retidos', '1': 'PIS/COFINS Retidos', '2': 'PIS/COFINS Não Retidos', '3': 'PIS/COFINS/CSLL Retidos',
  '4': 'PIS/COFINS Retidos, CSLL Não Retido', '5': 'PIS Retido, COFINS/CSLL Não Retido', '6': 'COFINS Retido, PIS/CSLL Não Retido',
  '7': 'PIS Não Retido, COFINS/CSLL Retidos', '8': 'PIS/COFINS Não Retidos, CSLL Retido', '9': 'COFINS Não Retido, PIS/CSLL Retidos',
};
/**
 * A NT fala em "tpRetPisCofins = 1 (PIS/COFINS Retido)", escrita para a lista antiga de 3 opções;
 * na v1.01 são 10. Aqui vale a descrição de cada código: em quais o PIS e a COFINS são retidos.
 */
const PIS_RETIDO = ['1', '3', '4', '5', '9'];
const COFINS_RETIDO = ['1', '3', '4', '6', '7'];

/** UF pelos 2 primeiros dígitos do código IBGE do município */
const UF_IBGE: Tabela = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI',
  '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES',
  '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

// ---------------------------------------------------------------------------
// Formatação (nota 12: campo sem informação no XML sai com um traço)
// ---------------------------------------------------------------------------

const vazio = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
const ou = (v: unknown) => (vazio(v) ? '-' : String(v).trim());
const numero = (v: unknown) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moeda = (v: unknown) => (vazio(v) ? '-' : `R$ ${numero(v)}`);
const perc = (v: unknown) => (vazio(v) ? '-' : `${numero(v)}%`);
const data = (v: unknown) => (vazio(v) ? '-' : String(v).replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1'));
/** Hora como está no XML (já em Brasília), sem converter fuso */
const dataHora = (v: unknown) => (vazio(v) ? '-' : String(v).replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2}).*$/, '$3/$2/$1 $4'));
const descricao = (tabela: Tabela, v: unknown) => (vazio(v) ? '-' : tabela[String(v)] || String(v));
/** Soma dos valores informados; nenhum informado = sem valor */
const soma = (...vs: unknown[]) => (vs.some((v) => !vazio(v)) ? vs.reduce<number>((s, v) => s + Number(v || 0), 0) : undefined);
/** "a / b / c", ou um traço quando nenhum foi informado */
const juntar = (...vs: unknown[]) => (vs.every(vazio) ? '-' : vs.map(ou).join(' / '));

function documento(p: any): string {
  if (p?.CNPJ) return String(p.CNPJ).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (p?.CPF) return String(p.CPF).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return ou(p?.NIF);
}

function telefone(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return d.replace(/^(\d{2})(\d+)(\d{4})$/, '($1) $2-$3');
  return ou(v);
}

const cep = (v: unknown) => String(v ?? '').replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3');

// ---------------------------------------------------------------------------

interface Municipio {
  nome: string;
  uf: string;
}

export interface OpcoesDanfse {
  /** Marca d'água "CANCELADA" (o XML da NFS-e não muda com o evento de cancelamento) */
  cancelada?: boolean;
  /** Nome e UF de municípios pelo código IBGE; sem isso sai o código onde o XML não traz o nome */
  municipios?: (codigos: string[]) => Promise<Record<string, Municipio>>;
}

interface Pessoa {
  doc: string;
  im: string;
  fone: string;
  nome: string;
  municipio: string;
  ibgeCep: string;
  endereco: string;
  email: string;
}

/** Endereço nacional (TCEndereco/endNac ou o enderNac do emitente) ou do exterior */
function lerEndereco(e: any) {
  if (!e) return null;
  return { ...e, nac: e.endNac || (e.cMun ? e : null), ext: e.endExt || null };
}

/** XML da NFS-e autorizada (NFSe com infNFSe e a DPS dentro) → PDF de uma página A4 */
export async function gerarDanfse(xml: string, opcoes: OpcoesDanfse = {}): Promise<Buffer> {
  const inf = lerXml(xml)?.NFSe?.infNFSe;
  const dps = inf?.DPS?.infDPS;
  if (!dps) throw new Error('O XML informado não contém uma NFS-e.');

  const chave = String(inf['@Id'] || '').replace(/^\D+/, '');
  const emit = inf.emit || {};
  const prest = dps.prest || {};
  const serv = dps.serv || {};
  const valores = dps.valores || {};
  const tribMun = valores.trib?.tribMun || {};
  const tribFed = valores.trib?.tribFed || {};
  const piscofins = tribFed.piscofins || {};
  const descontos = valores.vDescCondIncond || {};
  const ibs = inf.IBSCBS;
  const ibsValores = ibs?.valores || {};
  const totIbs = ibs?.totCIBS || {};
  const ibsDps = dps.IBSCBS;
  const gIbsCbs = ibsDps?.valores?.trib?.gIBSCBS || {};

  // Prestador emitente: nome, endereço e contatos vêm do cadastro (grupo emit), não da DPS
  const ePrestador = String(dps.tpEmit || '1') === '1';
  const endPrestador = lerEndereco(prest.end || (ePrestador ? emit.enderNac : null));
  const enderecos = [endPrestador, lerEndereco(dps.toma?.end), lerEndereco(dps.interm?.end), lerEndereco(ibsDps?.dest?.end)];

  // Nomes de município: os que o XML traz e, para os demais, a tabela do IBGE
  const doXml: Record<string, Municipio> = {};
  for (const [cod, nome] of [
    [dps.cLocEmi, inf.xLocEmi],
    [serv.locPrest?.cLocPrestacao, inf.xLocPrestacao],
    [inf.cLocIncid, inf.xLocIncid],
    [ibs?.cLocalidadeIncid, ibs?.xLocalidadeIncid],
  ]) {
    if (!vazio(cod) && !vazio(nome)) doXml[cod] = { nome, uf: UF_IBGE[String(cod).slice(0, 2)] || '' };
  }
  const faltam = [...new Set(enderecos.map((e) => e?.nac?.cMun).filter((cod) => !vazio(cod) && !doXml[cod]))] as string[];
  const nomes = { ...(faltam.length && opcoes.municipios ? await opcoes.municipios(faltam).catch(() => ({})) : {}), ...doXml };
  const uf = (cod: unknown) => (vazio(cod) ? '' : nomes[String(cod)]?.uf || UF_IBGE[String(cod).slice(0, 2)] || '');
  const municipio = (cod: unknown) => (vazio(cod) ? '-' : `${nomes[String(cod)]?.nome || cod} / ${uf(cod)}`);

  const pessoa = (p: any, end: ReturnType<typeof lerEndereco>, extra: any = {}): Pessoa => ({
    doc: documento(p),
    im: ou(p.IM ?? extra.IM),
    fone: telefone(p.fone ?? extra.fone),
    nome: ou(p.xNome ?? extra.xNome),
    municipio: end?.nac ? municipio(end.nac.cMun) : end?.ext ? juntar(end.ext.xCidade, end.ext.xEstProvReg) : '-',
    ibgeCep: end?.nac ? juntar(end.nac.cMun, cep(end.nac.CEP)) : ou(end?.ext?.cEndPost),
    endereco: ou([end?.xLgr, end?.nro, end?.xCpl, end?.xBairro].filter((v) => !vazio(v)).join(', ')),
    email: ou(p.email ?? extra.email),
  });

  // ---- PDF ----
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: { Title: `DANFSe ${inf.nNFSe || ''}`, Author: String(emit.xNome || '') },
  });
  const pedacos: Buffer[] = [];
  pdf.on('data', (d) => pedacos.push(d));
  const pronto = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(pedacos))));

  const fonte = (tamanho: number, negrito = false, cor = '#000') =>
    pdf.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamanho).fillColor(cor);
  /** Uma linha só, com reticências quando não cabe (NT 2.1) */
  const caber = (texto: string, largura: number) => {
    if (pdf.widthOfString(texto) <= largura) return texto;
    let s = texto;
    while (s && pdf.widthOfString(`${s}...`) > largura) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  };
  const escrever = (texto: string, x: number, y: number, w: number, align: 'left' | 'center' = 'left') =>
    pdf.text(caber(texto, c(w)), c(x), c(y), { width: c(w), lineBreak: false, align });
  /** Texto em várias linhas, cortado com reticências na altura do quadro */
  const paragrafo = (texto: string, x: number, y: number, w: number, h: number, align: 'left' | 'justify' = 'left') =>
    pdf.text(texto, c(x), c(y), { width: c(w), height: c(h), ellipsis: true, align });
  const altura = (texto: string, w: number) => pdf.heightOfString(texto, { width: c(w) }) / CM;
  const sombra = (x: number, y: number, w: number, h: number) => pdf.rect(c(x), c(y), c(w), c(h)).fill(FUNDO);
  const divisoria = (y: number) =>
    pdf.lineWidth(0.5).strokeColor('#000').moveTo(c(BORDA), c(y)).lineTo(c(21 - BORDA), c(y)).stroke();

  /** Rótulo em cima, conteúdo embaixo (rótulo 6 pt em negrito; os "grandes" em 7 pt) */
  const campo = (x: number, y: number, w: number, rotulo: string, valor: string, grande = false) => {
    fonte(grande ? 7 : 6, true);
    escrever(rotulo, x + PAD, y + 0.08, w - 2 * PAD);
    fonte(7);
    escrever(valor, x + PAD, y + (grande ? 0.36 : 0.32), w - 2 * PAD);
  };
  /** Título do bloco na 1ª coluna, sombreado */
  const titulo = (texto: string, y: number, h = LINHA) => {
    sombra(ESQ, y + 0.02, COL, h - 0.04);
    fonte(7, true);
    escrever(texto, ESQ + PAD, y + 0.13, COL - 2 * PAD);
  };

  let y = 0.3;

  // ---- Cabeçalho ----
  sombra(ESQ, y, LARG, 1.16);
  const logo = arquivoRecurso('logo-nfse.png');
  if (logo) pdf.image(logo, c(0.49), c(0.44), { fit: [c(4), c(0.85)], valign: 'center' });

  const homologacao = String(dps.tpAmb) === '2';
  const yTitulo = homologacao ? 0.4 : 0.56;
  fonte(9, true);
  escrever('DANFSe v2.0', C2, yTitulo, DUAS, 'center');
  escrever('Documento Auxiliar da NFS-e', C2, yTitulo + 0.35, DUAS, 'center');
  if (homologacao) {
    fonte(9, true, '#E00000');
    escrever('NFS-e SEM VALIDADE JURÍDICA', C2, yTitulo + 0.7, DUAS, 'center');
  }

  // O município não sai quando o item do código de tributação nacional é o 99
  if (!String(serv.cServ?.cTribNac || '').startsWith('99')) {
    fonte(8);
    paragrafo(`Município: ${juntar(inf.xLocEmi, emit.enderNac?.UF)}`, C4 + PAD, 0.36, COL - 2 * PAD, 0.6);
  }
  fonte(6);
  escrever(`Ambiente Gerador: ${descricao(AMBIENTE_GERADOR, inf.ambGer)}`, C4 + PAD, 0.97, COL - 2 * PAD);
  escrever(`Tipo de Ambiente: ${descricao(TIPO_AMBIENTE, dps.tpAmb)}`, C4 + PAD, 1.2, COL - 2 * PAD);

  // ---- Dados da NFS-e (rótulos em 7 pt, caixa alta) ----
  y = 1.48;
  divisoria(y);
  campo(C1, y, 15.3, 'CHAVE DE ACESSO DA NFS-E', ou(chave), true);
  y = 2.27;
  campo(C1, y, COL, 'NÚMERO DA NFS-E', ou(inf.nNFSe), true);
  campo(C2, y, COL, 'COMPETÊNCIA DA NFS-E', data(dps.dCompet), true);
  campo(C3, y, COL, 'DATA E HORA DA EMISSÃO DA NFS-E', dataHora(inf.dhProc), true);
  y = 2.96;
  campo(C1, y, COL, 'NÚMERO DA DPS', ou(dps.nDPS), true);
  campo(C2, y, COL, 'SÉRIE DA DPS', ou(dps.serie), true);
  campo(C3, y, COL, 'DATA E HORA DA EMISSÃO DA DPS', dataHora(dps.dhEmi), true);
  y = 3.65;
  sombra(C1, y + 0.02, COL, 0.63);
  campo(C1, y, COL, 'EMITENTE DA NFS-E', descricao(EMITENTE, dps.tpEmit), true);
  campo(C2, y, COL, 'SITUAÇÃO DA NFS-E', descricao(SITUACAO, inf.cStat), true);
  campo(C3, y, COL, 'FINALIDADE', descricao(FINALIDADE, ibsDps?.finNFSe), true);

  // QR Code da consulta pública (mínimo 1,52 x 1,52 cm, em X 17,48 / Y 1,67)
  const qr = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`,
    scale: 4,
  });
  pdf.image(qr, c(17.48), c(1.67), { width: c(1.52), height: c(1.52) });
  fonte(6);
  paragrafo(
    'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e',
    15.8, 3.28, 4.72, 1.05, 'justify',
  );

  // ---- Pessoas ----
  y = 4.34;
  const mensagem = (texto: string) => {
    divisoria(y);
    fonte(7);
    escrever(texto, ESQ, y + 0.12, LARG, 'center');
    y += 0.42;
  };
  const blocoPessoa = (rotulo: string, p: Pessoa, comIM = true) => {
    divisoria(y);
    titulo(rotulo, y);
    campo(C2, y, COL, 'CNPJ / CPF / NIF', p.doc);
    if (comIM) campo(C3, y, COL, 'Indicador Municipal (Inscrição)', p.im);
    campo(C4, y, COL, 'Telefone', p.fone);
    y += LINHA;
    campo(C1, y, DUAS, 'Nome / Nome Empresarial', p.nome);
    campo(C3, y, COL, 'Município / Sigla UF', p.municipio);
    campo(C4, y, COL, 'Código IBGE / CEP', p.ibgeCep);
    y += LINHA;
    campo(C1, y, DUAS, 'Endereço', p.endereco);
    campo(C3, y, DUAS, 'E-mail', p.email);
    y += LINHA;
  };

  blocoPessoa('PRESTADOR / FORNECEDOR', pessoa(prest, endPrestador, ePrestador ? emit : {}));
  const regTrib = prest.regTrib || {};
  campo(C1, y, COL, 'Simples Nacional na Data de Competência', descricao(SIMPLES, regTrib.opSimpNac));
  campo(C2, y, DUAS, 'Regime de Apuração Tributária pelo SN', descricao(APURACAO_SN, regTrib.regApTribSN));
  y += LINHA;

  if (dps.toma) blocoPessoa('TOMADOR / ADQUIRENTE', pessoa(dps.toma, lerEndereco(dps.toma.end)));
  else mensagem('TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');

  // Sem o grupo dest, o destinatário é o próprio tomador (indDest 0, ou NFS-e sem IBS/CBS)
  if (ibsDps?.dest) blocoPessoa('DESTINATÁRIO DA OPERAÇÃO', pessoa(ibsDps.dest, lerEndereco(ibsDps.dest.end)), false);
  else if (dps.toma && (!ibsDps || String(ibsDps.indDest) === '0')) mensagem('O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO');
  else mensagem('DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');

  if (dps.interm) blocoPessoa('INTERMEDIÁRIO DA OPERAÇÃO', pessoa(dps.interm, lerEndereco(dps.interm.end)));
  else mensagem('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');

  // ---- Serviço prestado ----
  const cServ = serv.cServ || {};
  const cTribNac = String(cServ.cTribNac || '').replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3');
  const locPrest = serv.locPrest || {};
  divisoria(y);
  titulo('SERVIÇO PRESTADO', y);
  campo(C2, y, COL, 'Código de Tributação Nacional / Municipal', juntar(cTribNac, cServ.cTribMun).replace(/ \/ -$/, ''));
  campo(C3, y, COL, 'Código da NBS', ou(String(cServ.cNBS || '').replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4')));
  campo(
    C4, y, COL, 'Local da Prestação / Sigla UF / País',
    vazio(locPrest.cLocPrestacao) ? ou(locPrest.cPaisPrestacao) : `${municipio(locPrest.cLocPrestacao)} / ${locPrest.cPaisPrestacao || 'BR'}`,
  );
  y += LINHA;
  // Descrição do código (sem rótulo): a municipal, quando houver
  fonte(7);
  escrever(ou(inf.xTribMun || inf.xTribNac), ESQ + PAD, y + 0.06, LARG - 2 * PAD);
  y += 0.4;

  // ---- O que vem depois da descrição: alturas fixas, para a descrição e as
  // informações complementares dividirem o resto da página ----
  const semIssqn = String(tribMun.tribISSQN) === '4';
  const exig = tribMun.exigSusp || {};
  const bm = tribMun.BM || {};
  const deducoes = vazio(valores.vDedRed?.vDR) ? soma(inf.valores?.vCalcDR, ibsValores.vCalcReeRepRes) : valores.vDedRed.vDR;
  // Nota 5: as linhas marcadas com ** saem só quando algum campo delas tem dado
  const linhaRegime = [prest.regTrib?.regEspTrib, tribMun.tpImunidade, exig.tpSusp, exig.nProcesso].some((v) => !vazio(v));
  const linhaBeneficio = [inf.valores?.tpBM, inf.valores?.vCalcBM ?? bm.vRedBCBM, deducoes, descontos.vDescIncond].some((v) => !vazio(v));
  // Nota 6: PIS/COFINS próprios só nas NFS-e com competência até 2026
  const linhaPisCofins = String(dps.dCompet || '') <= '2026-12-31';
  const alturaFixa =
    (semIssqn ? 0.42 : LINHA * (2 + Number(linhaRegime) + Number(linhaBeneficio))) +
    LINHA * (1 + Number(linhaPisCofins)) +
    LINHA * 4 +
    0.67 * 2;

  const totTrib = valores.trib?.totTrib || {};
  const totais = !vazio(totTrib.vTotTrib?.vTotTribFed) || !vazio(totTrib.vTotTrib?.vTotTribEst) || !vazio(totTrib.vTotTrib?.vTotTribMun)
    ? `Federais: ${moeda(totTrib.vTotTrib.vTotTribFed)}; Estaduais: ${moeda(totTrib.vTotTrib.vTotTribEst)}; Municipais: ${moeda(totTrib.vTotTrib.vTotTribMun)}`
    : totTrib.pTotTrib
      ? `Federais: ${perc(totTrib.pTotTrib.pTotTribFed)}; Estaduais: ${perc(totTrib.pTotTrib.pTotTribEst)}; Municipais: ${perc(totTrib.pTotTrib.pTotTribMun)}`
      : !vazio(totTrib.pTotTribSN)
        ? `Simples Nacional: ${perc(totTrib.pTotTribSN)}`
        : !vazio(totTrib.indTotTrib)
          ? 'Não informados (Decreto nº 8.264/2014)'
          : '-';
  const infoCompl = serv.infoCompl || {};
  const itensPedido = [infoCompl.gItemPed].flat().map((g: any) => g?.xItemPed).filter((v) => !vazio(v)).join(', ');
  // Nota 7 a 10: nesta ordem, separadas por "|", e sempre com os totais aproximados no fim
  const informacoes = [
    ['Inf. Cont.:', infoCompl.xInfComp],
    ['NFS-e Subst.:', dps.subst?.chSubstda],
    ['Doc. Ref.:', infoCompl.docRef],
    ['Cod. Obra:', serv.obra?.cObra],
    ['Insc. Imob.:', ibsDps?.imovel?.inscImobFisc],
    ['Cod. Evt.:', serv.atvEvento?.idAtvEvt],
    ['Doc. Tec.:', infoCompl.idDocTec],
    ['Núm. Ped.:', infoCompl.xPed],
    ['Item Ped.:', itensPedido],
    ['Inf. A. T. Mun.:', inf.xOutInf],
  ]
    .filter(([, v]) => !vazio(v))
    .map(([rotulo, v]) => `${rotulo} ${String(v).trim()}`)
    .concat(`Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${totais}`)
    .join(' | ');

  const descServ = ou(cServ.xDescServ);
  fonte(7);
  const disponivel = FIM - y - alturaFixa;
  const precisaInfo = Math.max(1.2, 0.5 + altura(informacoes, LARG - 2 * PAD));
  // Como no Anexo I: a descrição fica com metade do espaço livre, ou o que o texto pedir
  const alturaDescricao = Math.max(1, Math.min(Math.max(disponivel / 2, 0.42 + altura(descServ, LARG - 2 * PAD)), disponivel - precisaInfo));

  fonte(6, true);
  escrever('Descrição do Serviço', ESQ + PAD, y, LARG - 2 * PAD);
  fonte(7);
  paragrafo(descServ, ESQ + PAD, y + 0.28, LARG - 2 * PAD, alturaDescricao - 0.32);
  y += alturaDescricao;

  // ---- Tributação municipal ----
  if (semIssqn) mensagem('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN');
  else {
    divisoria(y);
    titulo('TRIBUTAÇÃO MUNICIPAL (ISSQN)', y);
    campo(C2, y, COL, 'Tipo de Tributação do ISSQN', descricao(TRIBUTACAO_ISSQN, tribMun.tribISSQN));
    campo(
      C3, y, DUAS, 'Município / Sigla UF / País de Incidência do ISSQN',
      vazio(inf.cLocIncid) ? ou(tribMun.cPaisResult) : `${municipio(inf.cLocIncid)} / ${tribMun.cPaisResult || 'BR'}`,
    );
    y += LINHA;
    if (linhaRegime) {
      campo(C1, y, COL, 'Regime Especial de Tributação do ISSQN', descricao(REGIME_ESPECIAL, prest.regTrib?.regEspTrib));
      campo(C2, y, COL, 'Tipo de Imunidade do ISSQN', descricao(IMUNIDADE, tribMun.tpImunidade));
      campo(C3, y, COL, 'Suspensão da Exigibilidade do ISSQN', descricao(SUSPENSAO, exig.tpSusp));
      campo(C4, y, COL, 'Número Processo Suspensão', ou(exig.nProcesso));
      y += LINHA;
    }
    if (linhaBeneficio) {
      campo(C1, y, COL, 'Benefício Municipal', descricao(BENEFICIO, inf.valores?.tpBM));
      campo(C2, y, COL, 'Cálculo do BM', moeda(inf.valores?.vCalcBM ?? bm.vRedBCBM));
      campo(C3, y, COL, 'Total Deduções/Reduções', moeda(deducoes));
      campo(C4, y, COL, 'Desconto Incondicionado', moeda(descontos.vDescIncond));
      y += LINHA;
    }
    campo(C1, y, COL, 'BC ISSQN', moeda(inf.valores?.vBC));
    campo(C2, y, COL, 'Alíquota Aplicada', perc(inf.valores?.pAliqAplic));
    campo(C3, y, COL, 'Retenção do ISSQN', descricao(RETENCAO_ISSQN, tribMun.tpRetISSQN));
    campo(C4, y, COL, 'ISSQN Apurado', moeda(inf.valores?.vISSQN));
    y += LINHA;
  }

  // ---- Tributação federal ----
  const tpRet = String(piscofins.tpRetPisCofins ?? '');
  const pisRetido = PIS_RETIDO.includes(tpRet);
  const cofinsRetido = COFINS_RETIDO.includes(tpRet);
  divisoria(y);
  titulo('TRIBUTAÇÃO FEDERAL (EXCETO CBS)', y);
  campo(C2, y, COL, 'IRRF', moeda(tribFed.vRetIRRF));
  campo(C3, y, COL, 'Contribuição Previdenciária - Retida', moeda(tribFed.vRetCP));
  campo(C4, y, COL, 'Contribuições Sociais - Retidas', moeda(
    soma(tribFed.vRetCSLL, pisRetido ? piscofins.vPis : undefined, cofinsRetido ? piscofins.vCofins : undefined),
  ));
  y += LINHA;
  if (linhaPisCofins) {
    campo(C1, y, COL, 'PIS - Débito Apuração Própria', moeda(vazio(piscofins.vPis) ? undefined : pisRetido ? 0 : piscofins.vPis));
    campo(C2, y, COL, 'COFINS - Débito Apuração Própria', moeda(vazio(piscofins.vCofins) ? undefined : cofinsRetido ? 0 : piscofins.vCofins));
    campo(C3, y, DUAS, 'Descrição Contrib. Sociais - Retidas', descricao(RETENCAO_PIS_COFINS, piscofins.tpRetPisCofins));
    y += LINHA;
  }

  // ---- Tributação IBS / CBS ----
  const vUf = ibsValores.uf || {};
  const vMun = ibsValores.mun || {};
  const vFed = ibsValores.fed || {};
  const gIbs = totIbs.gIBS || {};
  const gCbs = totIbs.gCBS || {};
  divisoria(y);
  titulo('TRIBUTAÇÃO IBS / CBS', y);
  campo(C2, y, COL, 'CST / cClassTrib', juntar(gIbsCbs.CST, gIbsCbs.cClassTrib));
  campo(
    C3, y, DUAS, 'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF',
    juntar(ibsDps?.cIndOp, ibs?.cLocalidadeIncid, ibs?.xLocalidadeIncid, uf(ibs?.cLocalidadeIncid)),
  );
  y += LINHA;
  campo(C1, y, COL, 'Exclusões e Reduções da Base de Cálculo', ibs
    ? moeda(soma(descontos.vDescIncond, ibsValores.vCalcReeRepRes, inf.valores?.vISSQN, piscofins.vPis, piscofins.vCofins))
    : '-');
  campo(C2, y, COL, 'Base de Cálculo Após Exclusões e Reduções', moeda(ibsValores.vBC));
  campo(C3, y, COL, 'Red. Alíquota IBS / Red. Alíquota CBS',
    [vUf.pRedAliqUF, vMun.pRedAliqMun, vFed.pRedAliqCBS].every(vazio) ? '-' : [vUf.pRedAliqUF, vMun.pRedAliqMun, vFed.pRedAliqCBS].map(perc).join(' / '));
  campo(C4, y, COL, 'Alíquota - IBS UF / IBS Mun',
    [vUf.pIBSUF, vMun.pIBSMun].every(vazio) ? '-' : [vUf.pIBSUF, vMun.pIBSMun].map(perc).join(' / '));
  y += LINHA;
  campo(C1, y, COL, 'Alíq. Efetiva Municipal - IBS', perc(vMun.pAliqEfetMun));
  campo(C2, y, COL, 'Valor Apurado Municipal - IBS', moeda(gIbs.gIBSMunTot?.vIBSMun));
  campo(C3, y, COL, 'Alíq. Efetiva Estadual - IBS', perc(vUf.pAliqEfetUF));
  campo(C4, y, COL, 'Valor Apurado Estadual - IBS', moeda(gIbs.gIBSUFTot?.vIBSUF));
  y += LINHA;
  campo(C1, y, COL, 'Valor Total Apurado - IBS', moeda(gIbs.vIBSTot));
  campo(C2, y, COL, 'Alíquota - CBS', perc(vFed.pCBS));
  campo(C3, y, COL, 'Alíquota Efetiva - CBS', perc(vFed.pAliqEfetCBS));
  campo(C4, y, COL, 'Valor Total Apurado - CBS', moeda(gCbs.vCBS));
  y += LINHA;

  // ---- Valor total ----
  divisoria(y);
  titulo('VALOR TOTAL DA NFS-E', y, 0.67);
  campo(C2, y, COL, 'VALOR DA OPERAÇÃO / SERVIÇO', moeda(valores.vServPrest?.vServ), true);
  campo(C3, y, COL, 'Desconto Incondicionado', moeda(descontos.vDescIncond));
  campo(C4, y, COL, 'Desconto Condicionado', moeda(descontos.vDescCond));
  y += 0.67;
  campo(C1, y, COL, 'Total das Retenções (ISSQN / Federais)', moeda(inf.valores?.vTotalRet));
  campo(C2, y, COL, 'VALOR LÍQUIDO DA NFS-e', moeda(inf.valores?.vLiq), true);
  campo(C3, y, COL, 'Total do IBS/CBS', moeda(soma(gIbs.vIBSTot, gCbs.vCBS)));
  sombra(C4, y + 0.02, COL, 0.63);
  campo(C4, y, COL, 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', moeda(totIbs.vTotNF), true);
  y += 0.67;

  // ---- Informações complementares: o resto da página ----
  divisoria(y);
  titulo('INFORMAÇÕES COMPLEMENTARES', y);
  fonte(7);
  paragrafo(informacoes, ESQ + PAD, y + 0.5, LARG - 2 * PAD, FIM - y - 0.55);

  // Borda da página, 1 pt
  pdf.lineWidth(1).strokeColor('#000').rect(c(BORDA), c(BORDA), c(21 - 2 * BORDA), c(29.7 - 2 * BORDA)).stroke();

  // NT 2.5.1: marca d'água na diagonal, 50 pt ou mais, cinza K35
  if (opcoes.cancelada) {
    pdf.save()
      .font('Helvetica')
      .fontSize(96)
      .fillColor('#A6A6A6')
      .opacity(0.45)
      .rotate(-55, { origin: [pdf.page.width / 2, pdf.page.height / 2] })
      .text('CANCELADA', 0, pdf.page.height / 2 - 48, { width: pdf.page.width, align: 'center', lineBreak: false })
      .restore();
  }

  pdf.end();
  return pronto;
}
