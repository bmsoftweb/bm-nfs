# BMNFs

Emissão de **NFS-e no Padrão Nacional** (Sefin Nacional / ADN), na mesma pilha do
BMNFe: React 19 + Vite + Tailwind 4 no front, Express + MySQL no back, tudo em
TypeScript. O protocolo segue o `PadraoNacional.Provider` do ACBr:

- a DPS (layout 1.01) é assinada com o A1 do prestador (RSA-SHA1, C14N), compactada
  em gzip e enviada em base64 dentro de um JSON (`POST /nfse`);
- todas as chamadas usam TLS mútuo com o mesmo certificado;
- o DANFSe é gerado aqui, a partir do XML autorizado, no leiaute da NT 008 (a API
  `GET /danfse/{chave}` do ADN foi suspensa em 03/08/2026);
- cancelamento pelo evento e101101 (`POST /nfse/{chave}/eventos`).

A produção restrita já está na NT 009 (`finNFSe`, ordem nova de `cServ`) e a produção
não: os schemas de cada ambiente ficam em `recursos/Schemas/PadraoNacional/{Producao,Homologacao}`
e a ordem dos campos é lida deles. Quando a produção mudar, basta trocar os .xsd.

Desde 1º/11/2026 (Resolução CGSN 191/2026) ME e EPP do Simples Nacional emitem pelo
Emissor Nacional; o webservice próprio do provedor municipal (ex.: IPM) fica para
prestadores fora do Simples.

## Como rodar

```bash
npm install
```

1. Rode [`extras/bmnfs_schema.sql`](extras/bmnfs_schema.sql) no banco do ERP (o mesmo do
   BMNFe). O aplicativo nunca cria tabelas sozinho. O fim do script tem um `INSERT`
   opcional que traz o prestador do cadastro de emitentes do BMNFe. Rode também
   [`extras/2026-11-08_tabelas_servicos.sql`](extras/2026-11-08_tabelas_servicos.sql): são as
   tabelas de códigos (nacional, municipal e NBS) que a tela Tabelas baixa da fonte oficial.
2. Copie `.env.example` para `.env` e preencha o acesso ao MySQL e o `SESSION_SECRET`.
3. O login usa os usuários do ERP (`sys_usuarios`), ligados ao prestador pelo CNPJ.
4. Certificado: sem um próprio em Configurações › Certificado, o BMNFs usa o do BMNFe
   (`nfe_certificados`) da empresa com o mesmo CNPJ.

```bash
npm run dev
```

Autoteste (monta, assina e valida a DPS e o cancelamento contra o XSD dos dois ambientes,
e gera o DANFSe de uma página, sem banco e sem rede):

```bash
npm run teste
```
