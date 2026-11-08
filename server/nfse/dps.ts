/**
 * Montagem da DPS (Declaração de Prestação de Serviço) e do pedido de evento de
 * cancelamento, no layout 1.01 do Padrão Nacional, na ordem do
 * PadraoNacional.GravarXml do ACBr.
 *
 * A produção restrita já roda a NT 009 (finNFSe em infDPS e xDescServ no fim de
 * cServ) e a produção ainda não: a ordem certa é lida do XSD de cada ambiente,
 * então basta trocar os .xsd quando a produção mudar.
 */
import fs from 'fs';
import type { Contexto } from './contexto.js';
import { arquivoRecurso } from './recursos.js';
import { dataHoraDFe, agora } from './datas.js';
import { escapar, grupo, grupoObrigatorio, num, tag, NS_NFSE } from './xml.js';

export const VERSAO_DPS = '1.01';
export const VER_APLIC = 'BMNFs';

export interface TomadorNFSe {
  /** CPF ou CNPJ, só dígitos */
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

/** O que a tela manda (e o que fica em nfs_notas.dados) */
export interface DadosNFSe {
  /** aaaa-mm-dd */
  competencia: string;
  tomador?: TomadorNFSe | null;
  /** cTribNac, 6 dígitos (item, subitem e desdobro da lista nacional) */
  codigoServico: string;
  codigoServicoMunicipal?: string;
  codigoNBS?: string;
  descricao: string;
  /** IBGE do local da prestação; vazio = município do prestador */
  municipioPrestacao?: string;
  informacoesComplementares?: string;
  valorServico: number;
  descontoIncondicionado?: number;
  /** % do ISS; zero não vai no XML */
  aliquotaIss?: number;
  issRetido?: boolean;
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

function digitosVerificadores(base: string, pesoInicial: number): string {
  let soma = 0;
  let peso = pesoInicial;
  for (const d of base) {
    soma += Number(d) * peso;
    peso = peso === 2 ? 9 : peso - 1;
  }
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}

export function cnpjValido(valor: string): boolean {
  const c = String(valor || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const d1 = digitosVerificadores(c.slice(0, 12), 5);
  return c.slice(12) === d1 + digitosVerificadores(c.slice(0, 12) + d1, 6);
}

export function cpfValido(valor: string): boolean {
  const c = String(valor || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(c[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return String(resto === 10 ? 0 : resto);
  };
  return c[9] === calc(9) && c[10] === calc(10);
}

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Espaços colapsados e aparados; acentos ficam (o Padrão Nacional é UTF-8) */
function texto(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** xDescServ aceita quebra de linha: só as linhas são aparadas */
function textoComQuebras(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Layout de cada ambiente
// ---------------------------------------------------------------------------

export const pastaAmbiente = (ambiente: number) => (ambiente === 1 ? 'Producao' : 'Homologacao');

interface Layout {
  finNFSe: boolean;
  descricaoNoFim: boolean;
}

const cacheLayout = new Map<number, Layout>();

function layout(ambiente: number): Layout {
  const emCache = cacheLayout.get(ambiente);
  if (emCache) return emCache;

  const caminho = arquivoRecurso('Schemas', 'PadraoNacional', pastaAmbiente(ambiente), 'tiposComplexos_v1.01.xsd');
  if (!caminho) throw new Error(`Schemas do Padrão Nacional (${pastaAmbiente(ambiente)}) não encontrados em recursos.`);
  const xsd = fs.readFileSync(caminho, 'utf8');

  const elementos = (tipo: string) =>
    [...(xsd.match(new RegExp(`<xs:complexType name="${tipo}">([\\s\\S]*?)</xs:complexType>`))?.[1] || '')
      .matchAll(/element name="(\w+)"/g)].map((m) => m[1]);
  const cServ = elementos('TCCServ');

  const achado = {
    finNFSe: elementos('TCInfDPS').includes('finNFSe'),
    descricaoNoFim: cServ.indexOf('xDescServ') > cServ.indexOf('cNBS'),
  };
  cacheLayout.set(ambiente, achado);
  return achado;
}

// ---------------------------------------------------------------------------
// DPS
// ---------------------------------------------------------------------------

/**
 * Id da DPS, 45 posições: "DPS" + município (7) + tipo de inscrição (1=CPF,
 * 2=CNPJ) + inscrição (14) + série (5) + número (15)
 */
export function idDps(codigoMunicipio: string, documento: string, serie: number, numero: number): string {
  const doc = documento.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (
    'DPS' +
    so(codigoMunicipio).padStart(7, '0') +
    (doc.length === 11 ? '1' : '2') +
    doc.padStart(14, '0') +
    String(serie).padStart(5, '0') +
    String(numero).padStart(15, '0')
  );
}

/** Confere o que o schema não pega e devolve a mensagem para o usuário */
export function conferirDados(d: DadosNFSe): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.competencia || '')) return 'Informe a data de competência.';
  if (!/^\d{6}$/.test(so(d.codigoServico))) return 'O código de tributação nacional tem 6 dígitos.';
  if (d.codigoServicoMunicipal && !/^\d{3}$/.test(so(d.codigoServicoMunicipal))) return 'O código de tributação municipal tem 3 dígitos.';
  if (d.codigoNBS && !/^\d{9}$/.test(so(d.codigoNBS))) return 'O código NBS tem 9 dígitos.';
  if (!texto(d.descricao, 2000)) return 'Informe a descrição do serviço.';
  if (!(Number(d.valorServico) > 0)) return 'Informe o valor do serviço.';
  if (Number(d.descontoIncondicionado || 0) >= Number(d.valorServico)) return 'O desconto não pode ser igual ou maior que o valor do serviço.';
  if (Number(d.aliquotaIss || 0) > 5) return 'A alíquota do ISS não pode passar de 5% (E0595).';

  const t = d.tomador;
  if (t?.nome || t?.documento) {
    const doc = so(t.documento);
    if (doc.length === 14 ? !cnpjValido(doc) : doc.length === 11 ? !cpfValido(doc) : true) {
      return 'CPF/CNPJ do tomador inválido.';
    }
    if (!texto(t.nome, 300)) return 'Informe o nome do tomador.';
  } else if (d.issRetido) {
    return 'ISS retido pelo tomador exige o tomador identificado.';
  }
  return null;
}

function endereco(e: { cep?: string | null; codigoMunicipio?: string | null; logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null }): string {
  // Sem os obrigatórios do grupo, o endereço fica de fora (ele é opcional)
  if (!/^\d{8}$/.test(so(e.cep)) || !/^\d{7}$/.test(so(e.codigoMunicipio)) || !texto(e.logradouro, 255) || !texto(e.bairro, 60)) {
    return '';
  }
  return grupo(
    'end',
    grupo('endNac', tag('cMun', so(e.codigoMunicipio)), tag('CEP', so(e.cep))),
    tag('xLgr', texto(e.logradouro, 255)),
    tag('nro', texto(e.numero, 60) || 'S/N'),
    tag('xCpl', texto(e.complemento, 156)),
    tag('xBairro', texto(e.bairro, 60)),
  );
}

const fone = (v: unknown) => (/^\d{6,20}$/.test(so(v)) ? so(v) : '');

/**
 * Total aproximado dos tributos (Lei 12.741), como o ACBr: MEI informa
 * indTotTrib=0; ME/EPP o % do Simples (ou valores zerados, sem o %); não
 * optante os valores zerados.
 */
function totalTributos(ctx: Contexto): string {
  const op = Number(ctx.prestador.op_simples_nacional);
  const pSN = Number(ctx.config.emissao.percentualTributosSN || 0);
  if (op === 2) return grupo('totTrib', tag('indTotTrib', '0'));
  if (op === 3 && pSN > 0) return grupo('totTrib', tag('pTotTribSN', num(pSN)));
  return grupo('totTrib', grupo('vTotTrib', tag('vTotTribFed', '0.00'), tag('vTotTribEst', '0.00'), tag('vTotTribMun', '0.00')));
}

/**
 * pAliq vai só quando o Anexo I (RN da DPS) exige; nos outros casos a Sefin rejeita e calcula pela
 * parametrização do município. Com o convênio ativo, sem benefício municipal e tribISSQN=1:
 * MEI nunca (E0600); regime especial nunca (E0604); não optante nunca (E0617);
 * ME/EPP com ISSQN pelo SN só com ISS retido (E0621 exige, mínimo 1,8%; E0625 proíbe sem retenção);
 * ME/EPP com ISSQN fora do SN nunca (E0635).
 * ponytail: supõe o município de incidência com convênio ativo (o emissor tem que ter, senão E0037);
 * prestação em município não conveniado inverte várias regras (E0619, E0628, E0631, E0640).
 */
export function informaAliquota(prestador: { op_simples_nacional: number; regime_apuracao_sn: number | null; regime_especial: number }, issRetido: boolean) {
  if (Number(prestador.regime_especial || 0) !== 0) return false;
  return Number(prestador.op_simples_nacional) === 3 && Number(prestador.regime_apuracao_sn || 1) === 1 && issRetido;
}

export interface DpsMontada {
  /** XML sem declaração e sem assinatura */
  xml: string;
  id: string;
  dataEmissao: Date;
}

export function montarDps(ctx: Contexto, serie: number, numero: number, d: DadosNFSe): DpsMontada {
  const ambiente = ctx.config.webservice.ambiente;
  const p = ctx.prestador;
  const { finNFSe, descricaoNoFim } = layout(ambiente);
  const dataEmissao = agora();
  const id = idDps(p.codigo_municipio || '', p.cnpj, serie, numero);
  const op = Number(p.op_simples_nacional);

  const prest = grupo(
    'prest',
    tag('CNPJ', so(p.cnpj)),
    tag('IM', texto(p.inscricao_municipal, 15)),
    tag('fone', fone(p.fone)),
    tag('email', texto(p.email, 80)),
    grupo(
      'regTrib',
      tag('opSimpNac', op),
      op === 3 ? tag('regApTribSN', p.regime_apuracao_sn || 1) : '',
      tag('regEspTrib', p.regime_especial ?? 0),
    ),
  );

  const t = d.tomador;
  const docToma = so(t?.documento);
  const toma = t?.nome
    ? grupo(
        'toma',
        tag(docToma.length === 11 ? 'CPF' : 'CNPJ', docToma),
        tag('IM', texto(t.inscricaoMunicipal, 15)),
        tag('xNome', texto(t.nome, 300)),
        endereco(t),
        tag('fone', fone(t.fone)),
        tag('email', texto(t.email, 80)),
      )
    : '';

  const descricao = tag('xDescServ', textoComQuebras(d.descricao, 2000));
  const cServ = grupo(
    'cServ',
    tag('cTribNac', so(d.codigoServico)),
    tag('cTribMun', so(d.codigoServicoMunicipal)),
    descricaoNoFim ? '' : descricao,
    tag('cNBS', so(d.codigoNBS)),
    descricaoNoFim ? descricao : '',
  );

  const serv = grupo(
    'serv',
    grupo('locPrest', tag('cLocPrestacao', so(d.municipioPrestacao) || so(p.codigo_municipio))),
    cServ,
    grupo('infoCompl', tag('xInfComp', texto(d.informacoesComplementares, 2000))),
  );

  const desconto = Number(d.descontoIncondicionado || 0);
  const aliquota = Number(d.aliquotaIss || 0);
  const valores = grupo(
    'valores',
    grupo('vServPrest', tag('vServ', num(d.valorServico))),
    desconto > 0 ? grupo('vDescCondIncond', tag('vDescIncond', num(desconto))) : '',
    grupoObrigatorio(
      'trib',
      grupo(
        'tribMun',
        // ponytail: só operação tributável; imunidade, exportação e não incidência quando aparecer cliente
        tag('tribISSQN', '1'),
        tag('tpRetISSQN', d.issRetido ? '2' : '1'),
        aliquota > 0 && informaAliquota(p, !!d.issRetido) ? tag('pAliq', num(aliquota)) : '',
      ),
      totalTributos(ctx),
    ),
  );

  const infDPS =
    `<infDPS Id="${id}">` +
    tag('tpAmb', ambiente) +
    tag('dhEmi', dataHoraDFe(dataEmissao)) +
    tag('verAplic', VER_APLIC) +
    tag('serie', serie) +
    tag('nDPS', numero) +
    tag('dCompet', d.competencia) +
    tag('tpEmit', '1') +
    (finNFSe ? tag('finNFSe', '0') : '') +
    tag('cLocEmi', so(p.codigo_municipio)) +
    prest +
    toma +
    serv +
    valores +
    '</infDPS>';

  return { xml: `<DPS xmlns="${NS_NFSE}" versao="${VERSAO_DPS}">${infDPS}</DPS>`, id, dataEmissao };
}

// ---------------------------------------------------------------------------
// Evento de cancelamento (e101101)
// ---------------------------------------------------------------------------

/** cMotivo do e101101 */
export const MOTIVOS_CANCELAMENTO: Record<string, string> = {
  '1': 'Erro na emissão',
  '2': 'Serviço não prestado',
  '9': 'Outros',
};

/** Id "PRE" + chave (50) + código do evento (6), sem número de sequência */
export function montarCancelamento(ctx: Contexto, chave: string, cMotivo: string, xMotivo: string): { xml: string; id: string } {
  const motivo = texto(xMotivo, 255);
  if (!MOTIVOS_CANCELAMENTO[cMotivo]) throw new Error('Escolha o motivo do cancelamento.');
  if (motivo.length < 15) throw new Error('A justificativa do cancelamento precisa ter pelo menos 15 caracteres.');

  const id = `PRE${chave}101101`;
  const xml =
    `<pedRegEvento xmlns="${NS_NFSE}" versao="${VERSAO_DPS}">` +
    `<infPedReg Id="${id}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('verAplic', VER_APLIC) +
    tag('dhEvento', dataHoraDFe()) +
    tag('CNPJAutor', so(ctx.prestador.cnpj)) +
    tag('chNFSe', chave) +
    `<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${cMotivo}</cMotivo><xMotivo>${escapar(motivo)}</xMotivo></e101101>` +
    '</infPedReg></pedRegEvento>';
  return { xml, id };
}
