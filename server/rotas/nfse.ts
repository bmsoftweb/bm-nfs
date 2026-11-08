/**
 * Rotas /api do BMNFs: configurações, prestador, certificado, notas e log.
 * A empresa sai sempre da sessão (exigirSessao), nunca do cliente.
 */
import { Request, Response, Router } from 'express';
import { pool } from '../db.js';
import { gravarConfig, lerConfig, preservarSegredos, semSegredos } from '../config.js';
import { carregarPrestador, esquecerCertificado, linhaCertificado } from '../nfse/contexto.js';
import { carregarPfx } from '../nfse/certificado.js';
import { dataHoraMysql, paraBR } from '../nfse/datas.js';
import { FalhaSchema } from '../nfse/validacao.js';
import { buscarNota, cancelar, consultar, danfse, gravar, transmitir } from '../nfse/operacoes.js';
import { urlConsultaPublica } from '../nfse/sefin.js';
import { atualizarTabela, codigosDoServico, codigosNacionais, situacaoTabelas } from '../tabelas.js';

export function empresaDaRequisicao(req: Request): number {
  const id = req.usuario?.empresaId;
  if (!id) throw new Error('Sessão sem empresa. Entre novamente.');
  return id;
}

/** Exceção vira 400 com a mensagem; falha de schema sai como 422 com a lista de erros */
export function rota(handler: (req: Request, res: Response) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      if (res.headersSent) return;
      if (err instanceof FalhaSchema) {
        res.status(422).json({ success: false, error: err.aviso, errosSchema: err.erros, schema: err.schema });
        return;
      }
      if (err?.code === 'ER_NO_SUCH_TABLE') {
        const script = /nfs_(servicos|nbs)/.test(err.sqlMessage || '') ? 'extras/2026-11-08_tabelas_servicos.sql' : 'extras/bmnfs_schema.sql';
        res.status(400).json({ success: false, error: `Faltam tabelas do BMNFs: rode o ${script} no banco.` });
        return;
      }
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  };
}

/**
 * Listagem paginada das grades: página, registros por página, busca e ordenação
 * vêm da tela, mas só por nomes da whitelist.
 */
const paginada = (def: {
  tabela: string;
  colunas: string;
  ordenaveis: Record<string, string>;
  busca: string[];
  ordemPadrao: string;
  direcaoPadrao: 'asc' | 'desc';
  /** Filtro no lugar do empresa_id (as tabelas de códigos são iguais para todas as empresas) */
  onde?: (req: Request) => Promise<[string, unknown[]]>;
}) =>
  rota(async (req, res) => {
    const [base, baseParams] = def.onde ? await def.onde(req) : ['empresa_id = ?', [empresaDaRequisicao(req)]];
    const porPagina = [10, 25, 50, 100].includes(Number(req.query.porPagina)) ? Number(req.query.porPagina) : 25;
    const pagina = Math.max(1, Math.floor(Number(req.query.pagina) || 1));
    const ordem = def.ordenaveis[String(req.query.ordem)] || def.ordenaveis[def.ordemPadrao];
    const direcao = req.query.direcao === 'asc' ? 'ASC' : req.query.direcao === 'desc' ? 'DESC' : def.direcaoPadrao.toUpperCase();

    const termo = String(req.query.busca || '').trim();
    const filtro = termo ? ` AND (${def.busca.map((c) => `${c} LIKE ?`).join(' OR ')})` : '';
    const params = termo ? def.busca.map(() => `%${termo}%`) : [];
    const onde = `WHERE ${base}${filtro}`;

    const [[{ total }]] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM ${def.tabela} ${onde}`, [...baseParams, ...params]);
    const [linhas] = await pool.query<any[]>(
      `SELECT ${def.colunas} FROM ${def.tabela} ${onde} ORDER BY ${ordem} ${direcao}, id ${direcao} LIMIT ? OFFSET ?`,
      [...baseParams, ...params, porPagina, (pagina - 1) * porPagina],
    );
    res.json({ data: linhas, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / porPagina)) });
  });

const COLUNAS_PRESTADOR = [
  'inscricao_municipal', 'razao_social', 'nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro',
  'codigo_municipio', 'municipio', 'uf', 'cep', 'fone', 'email', 'op_simples_nacional', 'regime_apuracao_sn', 'regime_especial',
];

export function criarRotasNFSe(): Router {
  const r = Router();

  // =========================================================================
  // Configurações, prestador e certificado
  // =========================================================================
  r.get('/config', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const [config, prestador, achado] = await Promise.all([lerConfig(empresaId), carregarPrestador(empresaId), linhaCertificado(empresaId)]);

    let certificado: any = null;
    if (achado) {
      const { arquivo: _a, senha: _s, ...c } = achado.linha;
      const dias = Math.floor((new Date(c.valido_ate).getTime() - Date.now()) / 86_400_000);
      certificado = { ...c, origem: achado.origem, diasParaVencer: dias, vencido: dias < 0 };
    }
    res.json({ config: semSegredos(config), prestador, certificado });
  }));

  r.put('/config', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const novo = await gravarConfig(empresaId, preservarSegredos(req.body || {}, await lerConfig(empresaId)));
    res.json({ success: true, config: semSegredos(novo) });
  }));

  r.put('/prestador', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const c = req.body || {};
    const campos = COLUNAS_PRESTADOR.filter((col) => col in c);
    if (!campos.length) throw new Error('Nenhum campo do prestador foi informado.');
    if (!String(c.razao_social ?? 'x').trim()) throw new Error('Informe a razão social.');

    await pool.query(
      `UPDATE nfs_empresas SET ${campos.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
      [...campos.map((f) => (typeof c[f] === 'string' ? c[f].trim() || null : c[f])), empresaId],
    );
    res.json({ success: true, prestador: await carregarPrestador(empresaId) });
  }));

  r.post('/certificado', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const { arquivoBase64, nomeArquivo, senha } = req.body || {};
    if (!arquivoBase64) throw new Error('Envie o arquivo .pfx do certificado.');
    if (!senha) throw new Error('Informe a senha do certificado.');

    const pfx = Buffer.from(String(arquivoBase64).replace(/^data:[^,]+,/, ''), 'base64');
    // Senha errada ou arquivo inválido falham aqui, antes de gravar
    const { info } = carregarPfx(pfx, senha);

    await pool.query(
      `INSERT INTO nfs_certificados
         (empresa_id, nome_arquivo, arquivo, senha, cnpj, razao_social, numero_serie, emissor, valido_de, valido_ate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nome_arquivo = VALUES(nome_arquivo), arquivo = VALUES(arquivo), senha = VALUES(senha),
         cnpj = VALUES(cnpj), razao_social = VALUES(razao_social), numero_serie = VALUES(numero_serie),
         emissor = VALUES(emissor), valido_de = VALUES(valido_de), valido_ate = VALUES(valido_ate)`,
      [
        empresaId, nomeArquivo || 'certificado.pfx', pfx, senha, info.cnpj, info.razaoSocial, info.numeroSerie, info.emissor,
        dataHoraMysql(info.validoDe), dataHoraMysql(info.validoAte),
      ],
    );
    esquecerCertificado(empresaId);
    res.json({ success: true, certificado: { ...info, validoDe: paraBR(info.validoDe, false), validoAte: paraBR(info.validoAte, false) } });
  }));

  /** Apaga só o certificado próprio; o do BMNFe (mesmo CNPJ) volta a valer */
  r.delete('/certificado', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    await pool.query('DELETE FROM nfs_certificados WHERE empresa_id = ?', [empresaId]);
    esquecerCertificado(empresaId);
    res.json({ success: true });
  }));

  // =========================================================================
  // Notas
  // =========================================================================
  r.get('/notas', paginada({
    tabela: 'nfs_notas',
    colunas:
      'id, ambiente, serie, numero_dps, numero_nfse, chave, situacao, data_emissao, competencia, ' +
      'tomador_documento, tomador_nome, codigo_servico, valor_servico, iss_retido, codigo_status, motivo',
    ordenaveis: {
      numero_dps: 'numero_dps', numero_nfse: 'numero_nfse', data_emissao: 'data_emissao', competencia: 'competencia',
      tomador_nome: 'tomador_nome', valor_servico: 'valor_servico', situacao: 'situacao', ambiente: 'ambiente', motivo: 'codigo_status',
    },
    busca: ['CAST(numero_dps AS CHAR)', 'CAST(numero_nfse AS CHAR)', 'tomador_nome', 'tomador_documento', 'chave', 'situacao'],
    ordemPadrao: 'data_emissao',
    direcaoPadrao: 'desc',
  }));

  r.get('/notas/:id', rota(async (req, res) => {
    const nota = await buscarNota(empresaDaRequisicao(req), Number(req.params.id));
    const dados = typeof nota.dados === 'string' ? JSON.parse(nota.dados) : nota.dados;
    const [eventos] = await pool.query<any[]>(
      'SELECT id, tipo, codigo_motivo, motivo, sucesso, retorno, criado_em FROM nfs_eventos WHERE nota_id = ? ORDER BY id',
      [nota.id],
    );
    res.json({ ...nota, dados, eventos, linkConsulta: nota.chave ? urlConsultaPublica(nota.ambiente, nota.chave) : null });
  }));

  /** Grava e transmite (Emitir); com ?gravar=1 só grava, para transmitir depois */
  r.post('/notas', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const nota = await gravar(empresaId, req.body || {});
    res.json({ success: true, nota: req.query.gravar === '1' ? nota : await transmitir(empresaId, nota.id) });
  }));

  r.post('/notas/:id/transmitir', rota(async (req, res) => {
    res.json({ success: true, nota: await transmitir(empresaDaRequisicao(req), Number(req.params.id)) });
  }));

  r.post('/notas/:id/consultar', rota(async (req, res) => {
    res.json({ success: true, nota: await consultar(empresaDaRequisicao(req), Number(req.params.id)) });
  }));

  r.post('/notas/:id/cancelar', rota(async (req, res) => {
    const { codigoMotivo, motivo } = req.body || {};
    res.json({ success: true, nota: await cancelar(empresaDaRequisicao(req), Number(req.params.id), codigoMotivo, motivo) });
  }));

  r.get('/notas/:id/danfse', rota(async (req, res) => {
    const { pdf, nome } = await danfse(empresaDaRequisicao(req), Number(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.send(pdf);
  }));

  /** XML da NFS-e (autorizada) ou, sem ela, da DPS enviada */
  r.get('/notas/:id/xml', rota(async (req, res) => {
    const nota = await buscarNota(empresaDaRequisicao(req), Number(req.params.id));
    const xml = nota.xml_nfse || nota.xml_dps;
    if (!xml) throw new Error('A nota não tem XML.');
    const nome = nota.xml_nfse ? `NFSe_${nota.chave}.xml` : `${nota.id_dps}.xml`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(xml);
  }));

  // =========================================================================
  // Log
  // =========================================================================
  r.get('/log', paginada({
    tabela: 'nfs_log',
    colunas: 'id, operacao, url, chave, sucesso, codigo_status, motivo, duracao_ms, criado_em',
    ordenaveis: {
      criado_em: 'criado_em', operacao: 'operacao', chave: 'chave', sucesso: 'sucesso',
      duracao_ms: 'duracao_ms', codigo_status: 'codigo_status', motivo: 'motivo',
    },
    busca: ['operacao', 'chave', 'motivo', 'codigo_status'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
  }));

  r.get('/log/:id', rota(async (req, res) => {
    const [linhas] = await pool.query<any[]>('SELECT * FROM nfs_log WHERE empresa_id = ? AND id = ? LIMIT 1', [
      empresaDaRequisicao(req), Number(req.params.id),
    ]);
    if (!linhas.length) throw new Error('Registro de log não encontrado.');
    res.json(linhas[0]);
  }));

  // =========================================================================
  // Tabelas de códigos (tela Tabelas): baixadas da fonte oficial só quando o usuário pede
  // =========================================================================
  r.get('/tabelas', rota(async (req, res) => {
    res.json(await situacaoTabelas(empresaDaRequisicao(req)));
  }));

  r.post('/tabelas/:nome/atualizar', rota(async (req, res) => {
    res.json(await atualizarTabela(req.params.nome, empresaDaRequisicao(req)));
  }));

  const todas = async (): Promise<[string, unknown[]]> => ['1 = 1', []];

  r.get('/tabelas/nacionais', paginada({
    tabela: 'nfs_servicos_nacionais',
    colunas: 'id, codigo, descricao',
    ordenaveis: { codigo: 'codigo', descricao: 'descricao' },
    // O código aparece com pontos na grade (01.07.01): a busca acha nos dois formatos
    busca: ['codigo', "CONCAT_WS('.', LEFT(codigo, 2), MID(codigo, 3, 2), RIGHT(codigo, 2))", 'descricao'],
    ordemPadrao: 'codigo',
    direcaoPadrao: 'asc',
    onde: todas,
  }));

  r.get('/tabelas/nbs', paginada({
    tabela: 'nfs_nbs',
    colunas:
      'id, codigo, descricao, ' +
      "(SELECT GROUP_CONCAT(CONCAT(LEFT(i.item, 2), '.', RIGHT(i.item, 2)) ORDER BY i.item SEPARATOR ', ') FROM nfs_nbs_itens i WHERE i.nbs = nfs_nbs.codigo) AS itens",
    ordenaveis: { codigo: 'codigo', descricao: 'descricao' },
    busca: ['codigo', "CONCAT_WS('.', LEFT(codigo, 1), MID(codigo, 2, 4), MID(codigo, 6, 2), RIGHT(codigo, 2))", 'descricao'],
    ordemPadrao: 'codigo',
    direcaoPadrao: 'asc',
    onde: todas,
  }));

  r.get('/tabelas/municipais', paginada({
    tabela: 'nfs_servicos_municipais',
    colunas:
      'id, codigo, incidencia, aliquota, inicio_vigencia, fim_vigencia, ' +
      '(SELECT descricao FROM nfs_servicos_nacionais n WHERE n.codigo = LEFT(nfs_servicos_municipais.codigo, 6)) AS descricao',
    ordenaveis: { codigo: 'codigo', incidencia: 'incidencia', aliquota: 'aliquota', inicio_vigencia: 'inicio_vigencia', fim_vigencia: 'fim_vigencia' },
    busca: ['codigo', "CONCAT_WS('.', LEFT(codigo, 2), MID(codigo, 3, 2), MID(codigo, 5, 2), RIGHT(codigo, 3))"],
    ordemPadrao: 'codigo',
    direcaoPadrao: 'asc',
    // Só a do município do prestador
    onde: async (req) => ['codigo_municipio = ?', [(await carregarPrestador(empresaDaRequisicao(req))).codigo_municipio || '']],
  }));

  // Campos de código (Configurações › Emissão e Nova NFS-e)
  r.get('/codigos/nacionais', rota(async (_req, res) => {
    res.json(await codigosNacionais());
  }));

  r.get('/codigos/servico/:nacional', rota(async (req, res) => {
    res.json(await codigosDoServico(empresaDaRequisicao(req), String(req.params.nacional)));
  }));

  // =========================================================================
  // Preferências das grades (sys_usuarios.config_listas), do usuário da sessão
  // =========================================================================
  r.get('/config-listas', rota(async (req, res) => {
    let config: Record<string, unknown> = {};
    try {
      const [linhas] = await pool.query<any[]>('SELECT config_listas FROM sys_usuarios WHERE id = ? LIMIT 1', [req.usuario!.id]);
      config = JSON.parse(linhas[0]?.config_listas || '{}') || {};
    } catch {
      // Coluna ainda não criada ou JSON inválido: as grades abrem com o padrão
    }
    res.json(config);
  }));

  r.put('/config-listas', rota(async (req, res) => {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Configuração inválida.');
    const texto = JSON.stringify(corpo);
    if (texto.length > 60000) throw new Error('Configuração muito grande.');
    try {
      await pool.query('UPDATE sys_usuarios SET config_listas = ? WHERE id = ?', [texto, req.usuario!.id]);
    } catch (err: any) {
      throw new Error(err?.code === 'ER_BAD_FIELD_ERROR' ? 'A coluna sys_usuarios.config_listas ainda não existe.' : err?.message);
    }
    res.json({ success: true });
  }));

  return r;
}
