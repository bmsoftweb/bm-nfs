import React, { useEffect, useRef, useState } from 'react';
import { Building2, FileCog, Globe2, Save, ShieldCheck, Trash2, Upload } from 'lucide-react';
import * as api from '../services/api';
import { CertificadoInfo, ConfigNFSe, Prestador } from '../types';
import { Abas, Area, Botao, Campo, Confirmacao, Secao, Selecao, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { NumberField } from './NumberField';
import { CampoCodigo, useCodigosServico } from './CampoCodigo';
import { formatarCnpj, formatarData, formatarNbs, formatarServico } from '../utils/formatters';

const so = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

/** Certificado, prestador, webservice (ambiente e proxy) e os padrões da emissão */
export const ConfiguracoesView: React.FC<{ onSalvou: () => void }> = ({ onSalvou }) => {
  const [aba, setAba] = useState('certificado');
  const [config, setConfig] = useState<ConfigNFSe | null>(null);
  const [prestador, setPrestador] = useState<Prestador | null>(null);
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [removendoCert, setRemovendoCert] = useState(false);

  const [senhaCertificado, setSenhaCertificado] = useState('');
  const [arquivoCertificado, setArquivoCertificado] = useState<File | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const codigos = useCodigosServico(config?.emissao.codigoServico ?? '');

  const recarregar = async () => {
    try {
      const dados = await api.buscarConfig();
      setConfig(dados.config);
      setPrestador(dados.prestador);
      setCertificado(dados.certificado);
    } catch (err: any) {
      setErro(err.message);
    }
  };

  useEffect(() => { recarregar(); }, []);

  const alterar = <G extends keyof ConfigNFSe>(grupo: G, campo: keyof ConfigNFSe[G], valor: any) => {
    setConfig((atual) => (atual ? { ...atual, [grupo]: { ...atual[grupo], [campo]: valor } } : atual));
  };

  const alterarPrestador = (campo: keyof Prestador, valor: any) => {
    setPrestador((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  };

  const salvar = async () => {
    if (!config || !prestador) return;
    setSalvando(true);
    setErro(null);
    try {
      const { id: _id, cnpj: _cnpj, ativo: _ativo, ...campos } = prestador;
      await api.gravarConfig(config);
      await api.gravarPrestador(campos);
      setAviso('Configurações salvas.');
      recarregar();
      onSalvou();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const enviarCertificado = async () => {
    if (!arquivoCertificado) return;
    setErro(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
        leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        leitor.readAsDataURL(arquivoCertificado);
      });
      await api.enviarCertificado(base64, arquivoCertificado.name, senhaCertificado);
      setAviso('Certificado cadastrado.');
      setArquivoCertificado(null);
      setSenhaCertificado('');
      recarregar();
      onSalvou();
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const removerCertificado = async () => {
    setRemovendoCert(false);
    try {
      await api.removerCertificado();
      recarregar();
      onSalvou();
    } catch (err: any) {
      setErro(err.message);
    }
  };

  if (!config || !prestador) {
    return (
      <>
        <div className="py-16 text-center text-xs text-stone-500">Carregando as configurações…</div>
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      </>
    );
  }

  const doBmnfe = certificado?.origem === 'bmnfe';

  return (
    <div className="flex flex-col">
      <Abas
        ativa={aba}
        onTrocar={setAba}
        abas={[
          { id: 'certificado', rotulo: 'Certificado', icone: <ShieldCheck className="w-3.5 h-3.5" /> },
          { id: 'prestador', rotulo: 'Prestador', icone: <Building2 className="w-3.5 h-3.5" /> },
          { id: 'webservice', rotulo: 'WebService', icone: <Globe2 className="w-3.5 h-3.5" /> },
          { id: 'emissao', rotulo: 'Emissão', icone: <FileCog className="w-3.5 h-3.5" /> },
        ]}
      />

      {aviso && <AvisoSucesso mensagem={aviso} onFechar={() => setAviso(null)} />}
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      {/* ---------------- Certificado ---------------- */}
      {aba === 'certificado' && (
        <Secao titulo="Certificado digital A1" descricao="Assina a DPS e autentica a conexão com a Sefin Nacional">
          {certificado ? (
            <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs">
              {[
                ['Titular', certificado.razao_social],
                ['CNPJ', formatarCnpj(certificado.cnpj)],
                ['Número de série', certificado.numero_serie],
                ['Emissor', certificado.emissor],
                ['Válido de', formatarData(certificado.valido_de)],
                ['Válido até', formatarData(certificado.valido_ate)],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase text-stone-400">{rotulo}</span>
                  <span className="text-stone-800 dark:text-stone-100 break-all">{valor || '—'}</span>
                </div>
              ))}

              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3 pt-2">
                <span
                  className={`text-[11px] font-bold px-2 py-1 rounded-full ${
                    certificado.vencido
                      ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                      : certificado.diasParaVencer <= 30
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  }`}
                >
                  {certificado.vencido ? 'Vencido' : `Vence em ${certificado.diasParaVencer} dia(s)`}
                </span>
                {doBmnfe ? (
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">
                    Usando o certificado cadastrado no BMNFe para este CNPJ. Enviar um arquivo aqui passa a valer só para o BMNFs.
                  </span>
                ) : (
                  <Botao variante="perigo" icone={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setRemovendoCert(true)}>
                    Remover certificado
                  </Botao>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-4">
              Nenhum certificado: nem aqui nem no BMNFe para este CNPJ. Sem ele nenhuma operação com a Sefin Nacional funciona.
            </p>
          )}

          <div className="border-t border-stone-200 dark:border-stone-800 pt-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
            <input
              ref={arquivoRef}
              type="file"
              accept=".pfx,.p12"
              className="hidden"
              onChange={(e) => setArquivoCertificado(e.target.files?.[0] || null)}
            />
            <Campo rotulo="Arquivo do certificado" className="lg:col-span-5">
              <div className="flex gap-2">
                <div className="flex-1 min-w-0 h-[34px] flex items-center px-3 bg-stone-50 dark:bg-stone-800/80 text-xs truncate border-l-2 border-amber-500">
                  {arquivoCertificado?.name || 'Nenhum arquivo escolhido'}
                </div>
                <Botao icone={<Upload className="w-3.5 h-3.5" />} onClick={() => arquivoRef.current?.click()}>
                  Escolher
                </Botao>
              </div>
            </Campo>
            <Texto
              rotulo="Senha do certificado"
              type="password"
              required
              value={senhaCertificado}
              onChange={(e) => setSenhaCertificado(e.target.value)}
              className="lg:col-span-4"
            />
            <div className="lg:col-span-3 flex items-end">
              <Botao variante="primario" disabled={!arquivoCertificado || !senhaCertificado} onClick={enviarCertificado} className="w-full">
                Enviar certificado
              </Botao>
            </div>
          </div>
        </Secao>
      )}

      {/* ---------------- Prestador ---------------- */}
      {aba === 'prestador' && (
        <>
          <Secao titulo="Prestador" descricao={`CNPJ ${formatarCnpj(prestador.cnpj)} — o CNPJ não muda por aqui`}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <Texto rotulo="Razão social" required value={prestador.razao_social || ''} onChange={(e) => alterarPrestador('razao_social', e.target.value)} className="lg:col-span-5" />
              <Texto rotulo="Nome fantasia" value={prestador.nome_fantasia || ''} onChange={(e) => alterarPrestador('nome_fantasia', e.target.value)} className="lg:col-span-4" />
              <Texto
                rotulo="Inscrição municipal"
                value={prestador.inscricao_municipal || ''}
                onChange={(e) => alterarPrestador('inscricao_municipal', e.target.value.slice(0, 15))}
                dica="Só se a prefeitura registrou no CNC NFS-e; sem esse registro a Sefin rejeita (E0120)"
                className="lg:col-span-3"
              />

              <Texto rotulo="CEP" inputMode="numeric" value={prestador.cep || ''} onChange={(e) => alterarPrestador('cep', so(e.target.value, 8))} className="lg:col-span-2" />
              <Texto rotulo="Logradouro" value={prestador.logradouro || ''} onChange={(e) => alterarPrestador('logradouro', e.target.value)} className="lg:col-span-5" />
              <Texto rotulo="Número" value={prestador.numero || ''} onChange={(e) => alterarPrestador('numero', e.target.value)} className="lg:col-span-2" />
              <Texto rotulo="Complemento" value={prestador.complemento || ''} onChange={(e) => alterarPrestador('complemento', e.target.value)} className="lg:col-span-3" />

              <Texto rotulo="Bairro" value={prestador.bairro || ''} onChange={(e) => alterarPrestador('bairro', e.target.value)} className="lg:col-span-3" />
              <Texto
                rotulo="Código IBGE do município"
                required
                inputMode="numeric"
                value={prestador.codigo_municipio || ''}
                onChange={(e) => alterarPrestador('codigo_municipio', so(e.target.value, 7))}
                dica="Rio do Sul/SC = 4214805"
                className="lg:col-span-3"
              />
              <Texto rotulo="Município" value={prestador.municipio || ''} onChange={(e) => alterarPrestador('municipio', e.target.value)} className="lg:col-span-4" />
              <Texto rotulo="UF" value={prestador.uf || ''} onChange={(e) => alterarPrestador('uf', e.target.value.toUpperCase().slice(0, 2))} className="lg:col-span-2" />

              <Texto rotulo="Telefone" inputMode="numeric" value={prestador.fone || ''} onChange={(e) => alterarPrestador('fone', so(e.target.value, 20))} className="lg:col-span-3" />
              <Texto rotulo="E-mail" type="email" value={prestador.email || ''} onChange={(e) => alterarPrestador('email', e.target.value)} className="lg:col-span-5" />
            </div>
          </Secao>

          <Secao titulo="Regime tributário" descricao="Vai no grupo regTrib de toda DPS">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <Selecao
                rotulo="Simples Nacional"
                value={prestador.op_simples_nacional}
                onChange={(e) => alterarPrestador('op_simples_nacional', Number(e.target.value))}
                opcoes={[
                  { valor: 3, rotulo: 'Optante — ME/EPP' },
                  { valor: 2, rotulo: 'Optante — MEI' },
                  { valor: 1, rotulo: 'Não optante' },
                ]}
                className="lg:col-span-3"
              />
              {Number(prestador.op_simples_nacional) === 3 && (
                <Selecao
                  rotulo="Apuração dos tributos (ME/EPP)"
                  value={prestador.regime_apuracao_sn ?? 1}
                  onChange={(e) => alterarPrestador('regime_apuracao_sn', Number(e.target.value))}
                  opcoes={[
                    { valor: 1, rotulo: 'Federais e ISSQN pelo Simples Nacional' },
                    { valor: 2, rotulo: 'Federais pelo SN e ISSQN fora do SN' },
                    { valor: 3, rotulo: 'Federais e ISSQN fora do SN' },
                  ]}
                  className="lg:col-span-5"
                />
              )}
              <Selecao
                rotulo="Regime especial de tributação"
                value={prestador.regime_especial}
                onChange={(e) => alterarPrestador('regime_especial', Number(e.target.value))}
                opcoes={[
                  { valor: 0, rotulo: 'Nenhum' },
                  { valor: 1, rotulo: 'Ato cooperado (cooperativa)' },
                  { valor: 2, rotulo: 'Estimativa' },
                  { valor: 3, rotulo: 'Microempresa municipal' },
                  { valor: 4, rotulo: 'Notário ou registrador' },
                  { valor: 5, rotulo: 'Profissional autônomo' },
                  { valor: 6, rotulo: 'Sociedade de profissionais' },
                  { valor: 9, rotulo: 'Outros' },
                ]}
                className="lg:col-span-4"
              />
            </div>
          </Secao>
        </>
      )}

      {/* ---------------- WebService ---------------- */}
      {aba === 'webservice' && (
        <>
          <Secao titulo="Sefin Nacional" descricao="Ambiente de destino e tempo de espera">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <Selecao
                rotulo="Ambiente"
                value={config.webservice.ambiente}
                onChange={(e) => alterar('webservice', 'ambiente', Number(e.target.value))}
                opcoes={[
                  { valor: 2, rotulo: 'Produção restrita (homologação)' },
                  { valor: 1, rotulo: 'Produção' },
                ]}
                className="lg:col-span-4"
              />
              <Campo rotulo="Timeout (segundos)" className="lg:col-span-2">
                <NumberField required value={config.webservice.timeout} onChange={(v) => alterar('webservice', 'timeout', Number(v) || 60)} />
              </Campo>
            </div>
          </Secao>

          <Secao titulo="Proxy" descricao="Deixe em branco quando a saída for direta">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <Texto rotulo="Servidor" value={config.webservice.proxyHost} onChange={(e) => alterar('webservice', 'proxyHost', e.target.value)} className="lg:col-span-4" />
              <Texto rotulo="Porta" inputMode="numeric" value={config.webservice.proxyPorta} onChange={(e) => alterar('webservice', 'proxyPorta', so(e.target.value, 5))} className="lg:col-span-2" />
              <Texto rotulo="Usuário" value={config.webservice.proxyUsuario} onChange={(e) => alterar('webservice', 'proxyUsuario', e.target.value)} className="lg:col-span-3" />
              <Texto rotulo="Senha" type="password" value={config.webservice.proxySenha} onChange={(e) => alterar('webservice', 'proxySenha', e.target.value)} className="lg:col-span-3" />
            </div>
          </Secao>
        </>
      )}

      {/* ---------------- Emissão ---------------- */}
      {aba === 'emissao' && (
        <Secao titulo="Emissão" descricao="Série da DPS e os padrões que a Nova NFS-e já traz preenchidos">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <Campo rotulo="Série da DPS" className="lg:col-span-2">
              <NumberField required value={config.emissao.serie} onChange={(v) => alterar('emissao', 'serie', Math.min(Number(v) || 1, 99999))} />
            </Campo>
            <CampoCodigo
              rotulo="Código de tributação nacional"
              value={config.emissao.codigoServico}
              onChange={(v) => alterar('emissao', 'codigoServico', v)}
              opcoes={codigos.nacionais}
              digitos={6}
              formatar={formatarServico}
            foraDaLista="Código fora da Lista de Serviços Nacional"
              dica="6 dígitos: item, subitem e desdobro (ex.: 010701)"
              className="lg:col-span-3"
            />
            <CampoCodigo
              rotulo="Código de tributação municipal"
              value={config.emissao.codigoServicoMunicipal}
              onChange={(v) => alterar('emissao', 'codigoServicoMunicipal', v)}
              opcoes={codigos.municipais}
              digitos={3}
              formatar={(c) => c || '000'}
            dica={codigos.dicaMunicipal}
            foraDaLista={codigos.foraMunicipal}
              className="lg:col-span-3"
            />
            <CampoCodigo
              rotulo="Código NBS"
              value={config.emissao.codigoNBS}
              onChange={(v) => alterar('emissao', 'codigoNBS', v)}
              opcoes={codigos.nbs}
              digitos={9}
              formatar={formatarNbs}
              dica={codigos.dicaNbs}
            foraDaLista={codigos.foraNbs}
              className="lg:col-span-2"
            />
            <Campo rotulo="Alíquota do ISS (%)" className="lg:col-span-2">
              <NumberField scale={2} value={config.emissao.aliquotaIss} onChange={(v) => alterar('emissao', 'aliquotaIss', Number(v))} />
            </Campo>

            <Area
              rotulo="Descrição padrão do serviço"
              rows={3}
              value={config.emissao.descricaoServico}
              onChange={(e) => alterar('emissao', 'descricaoServico', e.target.value)}
              className="lg:col-span-9"
            />
            <Campo
              rotulo="Tributos do Simples (%)"
              dica="ME/EPP: % aproximado (pTotTribSN). Zero informa os valores zerados."
              className="lg:col-span-3"
            >
              <NumberField scale={2} value={config.emissao.percentualTributosSN} onChange={(v) => alterar('emissao', 'percentualTributosSN', Number(v))} />
            </Campo>
          </div>
        </Secao>
      )}

      {/* Barra de ações no pé, como a do formulário do b2b admin */}
      {aba !== 'certificado' && (
        <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40">
          <Botao variante="primario" icone={<Save className="w-3.5 h-3.5" />} carregando={salvando} onClick={salvar}>
            Salvar Configurações
          </Botao>
        </div>
      )}

      <Confirmacao
        aberto={removendoCert}
        titulo="Remover o certificado?"
        mensagem="O BMNFs volta a usar o certificado do BMNFe deste CNPJ, se houver. Sem nenhum, nada funciona com a Sefin Nacional."
        rotuloConfirmar="Remover"
        onConfirmar={removerCertificado}
        onCancelar={() => setRemovendoCert(false)}
      />
    </div>
  );
};
