-- =====================================================================
-- BMNFs — tabelas de códigos de serviço (tela "Tabelas")
--
-- Rode uma vez no banco do ERP. Os dados entram pela tela Tabelas do BMNFs
-- (botão Baixar/Atualizar), direto da fonte oficial:
--   nfs_servicos_nacionais: Anexo B da NFS-e, aba "LISTA.SERV.NAC." (código de tributação nacional);
--   nfs_nbs:                Anexo B da NFS-e, aba "LISTA.NBS_v2.0" (só os códigos de 9 dígitos);
--   nfs_nbs_itens:          Anexo VIII da Reforma Tributária (NBS que valem para cada subitem da LC 116);
--   nfs_servicos_municipais: parametrização do município no ADN (alíquota de cada código no município).
--
-- Reversão:
--   DROP TABLE nfs_servicos_municipais, nfs_nbs_itens, nfs_nbs, nfs_servicos_nacionais;
-- =====================================================================

-- Código de tributação nacional (cTribNac): item, subitem e desdobro da lista da LC 116
CREATE TABLE IF NOT EXISTS nfs_servicos_nacionais (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        CHAR(6)      NOT NULL,   -- 010701
  descricao     TEXT         NOT NULL,
  criado_em     DATETIME     NOT NULL,
  atualizado_em DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_nfs_servicos_nacionais (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nomenclatura Brasileira de Serviços (cNBS), versão 2.0
CREATE TABLE IF NOT EXISTS nfs_nbs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        CHAR(9)      NOT NULL,   -- 115021000 (1.1502.10.00)
  descricao     TEXT         NOT NULL,
  criado_em     DATETIME     NOT NULL,
  atualizado_em DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_nfs_nbs (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Correlação do Anexo VIII: a Sefin rejeita NBS que não corresponde ao subitem da LC 116
CREATE TABLE IF NOT EXISTS nfs_nbs_itens (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item          CHAR(4)      NOT NULL,   -- subitem da LC 116 sem o ponto (0107)
  nbs           CHAR(9)      NOT NULL,
  criado_em     DATETIME     NOT NULL,
  atualizado_em DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_nfs_nbs_itens (item, nbs)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Serviços parametrizados no município (código nacional + código municipal de 3 dígitos)
CREATE TABLE IF NOT EXISTS nfs_servicos_municipais (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_municipio CHAR(7)      NOT NULL,   -- IBGE
  codigo           CHAR(9)      NOT NULL,   -- 010701000: cTribNac + cTribMun ("000" = sem código municipal)
  incidencia       VARCHAR(10)  NULL,       -- SIM / NAO, como vem do ADN
  aliquota         DECIMAL(5,2) NULL,       -- alíquota do ISS no município (%)
  inicio_vigencia  DATE         NULL,
  fim_vigencia     DATE         NULL,
  criado_em        DATETIME     NOT NULL,
  atualizado_em    DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_nfs_servicos_municipais (codigo_municipio, codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
