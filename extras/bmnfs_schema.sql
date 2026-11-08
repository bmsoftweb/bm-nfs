-- =====================================================================
-- BMNFs — estrutura do banco (NFS-e no Padrão Nacional)
-- Rode este script no MySQL antes de subir o app. O aplicativo NUNCA cria
-- tabelas sozinho. Os usuários são os do ERP (sys_usuarios / sys_empresas),
-- os mesmos do BMNFe.
--
-- Reversão (apaga tudo do BMNFs, inclusive as notas emitidas):
--   DROP TABLE nfs_log, nfs_eventos, nfs_notas, nfs_numeracao,
--              nfs_certificados, nfs_config, nfs_empresas;
-- =====================================================================

-- ---------------------------------------------------------------------
-- Prestador de serviços. É o tenant do sistema: tudo é isolado por ele.
-- O login liga o usuário do ERP ao prestador pelo CNPJ da empresa.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_empresas (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cnpj                VARCHAR(14)  NOT NULL,
  inscricao_municipal VARCHAR(15)  NULL,
  razao_social        VARCHAR(150) NOT NULL,
  nome_fantasia       VARCHAR(150) NULL,
  logradouro          VARCHAR(120) NULL,
  numero              VARCHAR(20)  NULL,
  complemento         VARCHAR(80)  NULL,
  bairro              VARCHAR(80)  NULL,
  -- código IBGE: é o município emissor da DPS (cLocEmi)
  codigo_municipio    VARCHAR(7)   NULL,
  municipio           VARCHAR(80)  NULL,
  uf                  CHAR(2)      NULL,
  cep                 VARCHAR(8)   NULL,
  fone                VARCHAR(20)  NULL,
  email               VARCHAR(80)  NULL,
  -- regTrib/opSimpNac: 1=Não optante, 2=MEI, 3=ME/EPP do Simples Nacional
  op_simples_nacional TINYINT      NOT NULL DEFAULT 3,
  -- regTrib/regApTribSN (só ME/EPP): 1=federais e ISSQN pelo SN, 2=federais pelo SN e ISSQN fora, 3=tudo fora do SN
  regime_apuracao_sn  TINYINT      NULL DEFAULT 1,
  -- regTrib/regEspTrib: 0=Nenhum, 1=Ato cooperado, 2=Estimativa, 3=ME municipal, 4=Notário/registrador, 5=Profissional autônomo, 6=Sociedade de profissionais, 9=Outros
  regime_especial     TINYINT      NOT NULL DEFAULT 0,
  ativo               TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfs_empresas_cnpj (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Configurações (ambiente, série da DPS, padrões do serviço). JSON, como no
-- BMNFe: as opções mudam com frequência e não pedem migração.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_config (
  empresa_id    INT UNSIGNED NOT NULL,
  dados         JSON         NOT NULL,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id),
  CONSTRAINT fk_nfs_config_empresa FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Certificado A1 (.pfx). Opcional: sem ele aqui, o BMNFs usa o certificado
-- do BMNFe (nfe_certificados) da empresa com o mesmo CNPJ.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_certificados (
  empresa_id     INT UNSIGNED NOT NULL,
  nome_arquivo   VARCHAR(160) NOT NULL,
  arquivo        LONGBLOB     NOT NULL,
  senha          VARCHAR(255) NOT NULL,
  cnpj           VARCHAR(14)  NULL,
  razao_social   VARCHAR(160) NULL,
  numero_serie   VARCHAR(80)  NULL,
  emissor        VARCHAR(255) NULL,
  valido_de      DATETIME     NULL,
  valido_ate     DATETIME     NULL,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id),
  CONSTRAINT fk_nfs_certificados_empresa FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Contador da DPS por série e ambiente: o próximo número sai de um comando
-- atômico (LAST_INSERT_ID), sem número repetido entre chamadas simultâneas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_numeracao (
  empresa_id    INT UNSIGNED NOT NULL,
  serie         INT          NOT NULL,
  ambiente      TINYINT      NOT NULL,
  ultimo_numero BIGINT       NOT NULL,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, serie, ambiente),
  CONSTRAINT fk_nfs_numeracao_empresa FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Notas: a DPS enviada e a NFS-e devolvida pela Sefin Nacional
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_notas (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id      INT UNSIGNED  NOT NULL,
  ambiente        TINYINT       NOT NULL,
  serie           INT           NOT NULL,
  numero_dps      BIGINT        NOT NULL,
  -- Id da DPS (45 posições): "DPS" + município + tipo e número da inscrição + série + número
  id_dps          VARCHAR(45)   NOT NULL,
  -- pendente (enviada sem resposta conclusiva), autorizada, rejeitada, cancelada
  situacao        VARCHAR(20)   NOT NULL DEFAULT 'pendente',
  -- chave de acesso da NFS-e (50 posições) e número dado pelo sistema nacional
  chave           VARCHAR(50)   NULL,
  numero_nfse     BIGINT        NULL,
  data_emissao    DATETIME      NOT NULL,
  competencia     DATE          NOT NULL,
  tomador_documento VARCHAR(14) NULL,
  tomador_nome    VARCHAR(150)  NULL,
  codigo_servico  VARCHAR(6)    NOT NULL,
  valor_servico   DECIMAL(15,2) NOT NULL,
  aliquota_iss    DECIMAL(5,2)  NULL,
  iss_retido      TINYINT(1)    NOT NULL DEFAULT 0,
  -- código e descrição do erro, ou do alerta, da última resposta
  codigo_status   VARCHAR(20)   NULL,
  motivo          VARCHAR(1000) NULL,
  -- dados do formulário, para copiar ou corrigir uma rejeitada
  dados           JSON          NULL,
  xml_dps         LONGTEXT      NULL,
  xml_nfse        LONGTEXT      NULL,
  criado_em       DATETIME      NOT NULL,
  atualizado_em   DATETIME      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfs_notas_dps (empresa_id, ambiente, serie, numero_dps),
  KEY ix_nfs_notas_chave (empresa_id, chave),
  KEY ix_nfs_notas_emissao (empresa_id, data_emissao),
  CONSTRAINT fk_nfs_notas_empresa FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Eventos da NFS-e (cancelamento): o pedido assinado e a resposta
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_eventos (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  nota_id        BIGINT UNSIGNED NOT NULL,
  chave          VARCHAR(50)  NOT NULL,
  -- e101101 = cancelamento
  tipo           VARCHAR(10)  NOT NULL,
  codigo_motivo  VARCHAR(2)   NULL,
  motivo         VARCHAR(255) NULL,
  sucesso        TINYINT(1)   NOT NULL DEFAULT 0,
  retorno        VARCHAR(1000) NULL,
  xml_envio      LONGTEXT     NULL,
  xml_retorno    LONGTEXT     NULL,
  criado_em      DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_nfs_eventos_nota (empresa_id, nota_id),
  CONSTRAINT fk_nfs_eventos_empresa FOREIGN KEY (empresa_id) REFERENCES nfs_empresas (id),
  CONSTRAINT fk_nfs_eventos_nota FOREIGN KEY (nota_id) REFERENCES nfs_notas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Log de comunicação com a Sefin Nacional / ADN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfs_log (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  operacao       VARCHAR(40)  NOT NULL,
  url            VARCHAR(255) NULL,
  chave          VARCHAR(50)  NULL,
  sucesso        TINYINT(1)   NOT NULL DEFAULT 0,
  codigo_status  VARCHAR(20)  NULL,
  motivo         VARCHAR(255) NULL,
  duracao_ms     INT          NULL,
  envio          LONGTEXT     NULL,
  retorno        LONGTEXT     NULL,
  criado_em      DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_nfs_log_empresa (empresa_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Opcional, só onde o BMNFe já está instalado: traz o prestador do cadastro
-- de emitentes do BMNFe (mesmo CNPJ). Confira depois, em Configurações ›
-- Prestador, a inscrição municipal e o regime do Simples.
-- ---------------------------------------------------------------------
-- INSERT IGNORE INTO nfs_empresas
--   (cnpj, razao_social, nome_fantasia, logradouro, numero, complemento, bairro,
--    codigo_municipio, municipio, uf, cep, fone, op_simples_nacional)
-- SELECT cnpj, razao_social, nome_fantasia, logradouro, numero, complemento, bairro,
--        codigo_municipio, municipio, uf, cep, fone, IF(crt IN (1, 2, 4), IF(crt = 4, 2, 3), 1)
--   FROM nfe_empresas WHERE ativo = 1;
