import React, { useEffect, useState } from 'react';
import { Save, Send } from 'lucide-react';
import * as api from '../services/api';
import { DadosNFSe, ErroApi, Tomador } from '../types';
import { Area, Botao, Campo, Secao, Texto } from './ui';
import { AvisoErro } from './AvisoErro';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';
import { CampoCodigo, useCodigosServico } from './CampoCodigo';
import { useProgresso } from './ProgressoModal';
import { formatarCpfCnpj, formatarMoeda, formatarNbs, formatarServico } from '../utils/formatters';

const so = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

function hojeIso(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

const TOMADOR_VAZIO: Tomador = {
  documento: '', nome: '', inscricaoMunicipal: '', cep: '', codigoMunicipio: '', logradouro: '',
  numero: '', complemento: '', bairro: '', fone: '', email: '',
};

/** Erro de schema chega com a lista; o aviso no canto mostra tudo junto */
const mensagemDe = (err: ErroApi) =>
  err.errosSchema?.length
    ? `${err.message}\n${err.errosSchema.map((e) => (e.campo ? `${e.campo}: ${e.mensagem}` : e.mensagem)).join('\n')}`
    : err.message;

/**
 * Nova NFS-e (aba filha da tela de notas). `inicial` traz os dados de uma nota
 * copiada; sem ele, o formulário abre com os padrões de Configurações › Emissão.
 */
export const NovaNFSeView: React.FC<{
  inicial?: DadosNFSe | null;
  onEmitida: (notaId: number, mensagem: string) => void;
  onCancelar: () => void;
}> = ({ inicial, onEmitida, onCancelar }) => {
  const [dados, setDados] = useState<DadosNFSe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'gravar' | 'emitir' | null>(null);
  const codigos = useCodigosServico(dados?.codigoServico ?? '');
  const progresso = useProgresso();

  useEffect(() => {
    api
      .buscarConfig()
      .then(({ config, prestador }) => {
        const e = config.emissao;
        setDados(
          inicial
            ? { ...inicial, competencia: hojeIso(), tomador: inicial.tomador ? { ...TOMADOR_VAZIO, ...inicial.tomador } : { ...TOMADOR_VAZIO } }
            : {
                competencia: hojeIso(),
                tomador: { ...TOMADOR_VAZIO },
                codigoServico: e.codigoServico,
                codigoServicoMunicipal: e.codigoServicoMunicipal,
                codigoNBS: e.codigoNBS,
                descricao: e.descricaoServico,
                municipioPrestacao: prestador.codigo_municipio || '',
                informacoesComplementares: '',
                valorServico: 0,
                descontoIncondicionado: 0,
                aliquotaIss: Number(e.aliquotaIss) || 0,
                issRetido: false,
              },
        );
      })
      .catch((err) => setErro(err.message));
  }, [inicial]);

  if (!dados) {
    return (
      <>
        <div className="py-16 text-center text-xs text-stone-500">Carregando…</div>
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      </>
    );
  }

  const t = dados.tomador || TOMADOR_VAZIO;
  const alterar = (campo: keyof DadosNFSe, valor: any) => setDados((d) => (d ? { ...d, [campo]: valor } : d));
  const alterarTomador = (campo: keyof Tomador, valor: string) =>
    setDados((d) => (d ? { ...d, tomador: { ...(d.tomador || TOMADOR_VAZIO), [campo]: valor } } : d));

  const base = Math.max(0, Number(dados.valorServico) - Number(dados.descontoIncondicionado || 0));
  const iss = Math.round(base * Number(dados.aliquotaIss || 0)) / 100;

  const emitir = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // O Enter num campo aciona o primeiro botão de envio, que é o Gravar: nunca transmite sem querer
    const soGravar = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'gravar';
    setErro(null);
    setEnviando(soGravar ? 'gravar' : 'emitir');
    try {
      // Sem nome nem documento, a nota sai sem tomador
      const comTomador = t.documento || t.nome;
      const { nota } = await progresso.aguardar(
        soGravar ? 'Gravando a NFS-e' : 'Emitindo a NFS-e',
        soGravar ? 'Validando e assinando a DPS…' : 'Assinando e transmitindo a DPS à Sefin Nacional…',
        () => api.emitirNota({ ...dados, tomador: comTomador ? t : null }, soGravar),
      );
      if (soGravar) {
        onEmitida(nota.id, `DPS ${nota.serie}/${nota.numero_dps} gravada. Transmita quando quiser.`);
      } else if (nota.situacao === 'rejeitada') {
        setErro(`NFS-e rejeitada pela Sefin Nacional:\n${nota.motivo || ''}`);
      } else {
        onEmitida(
          nota.id,
          nota.situacao === 'autorizada'
            ? `NFS-e ${nota.numero_nfse ?? ''} autorizada.`
            : 'DPS enviada; a autorização ainda não foi confirmada. Use Consultar.',
        );
      }
    } catch (err: any) {
      setErro(mensagemDe(err));
    } finally {
      setEnviando(null);
    }
  };

  return (
    <form onSubmit={emitir} className="flex flex-col">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {progresso.modal}

      <Secao titulo="Tomador" descricao="Deixe em branco para emitir sem tomador identificado">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Texto
            rotulo="CPF / CNPJ"
            autoFocus
            inputMode="numeric"
            value={formatarCpfCnpj(t.documento)}
            onChange={(e) => alterarTomador('documento', so(e.target.value, 14))}
            className="lg:col-span-3"
          />
          <Texto rotulo="Nome / razão social" value={t.nome} onChange={(e) => alterarTomador('nome', e.target.value)} className="lg:col-span-6" />
          <Texto rotulo="Inscrição municipal" value={t.inscricaoMunicipal || ''} onChange={(e) => alterarTomador('inscricaoMunicipal', e.target.value.slice(0, 15))} className="lg:col-span-3" />

          <Texto rotulo="CEP" inputMode="numeric" value={t.cep || ''} onChange={(e) => alterarTomador('cep', so(e.target.value, 8))} className="lg:col-span-2" />
          <Texto rotulo="Logradouro" value={t.logradouro || ''} onChange={(e) => alterarTomador('logradouro', e.target.value)} className="lg:col-span-5" />
          <Texto rotulo="Número" value={t.numero || ''} onChange={(e) => alterarTomador('numero', e.target.value)} className="lg:col-span-2" />
          <Texto rotulo="Complemento" value={t.complemento || ''} onChange={(e) => alterarTomador('complemento', e.target.value)} className="lg:col-span-3" />

          <Texto rotulo="Bairro" value={t.bairro || ''} onChange={(e) => alterarTomador('bairro', e.target.value)} className="lg:col-span-3" />
          <Texto
            rotulo="Código IBGE do município"
            inputMode="numeric"
            value={t.codigoMunicipio || ''}
            onChange={(e) => alterarTomador('codigoMunicipio', so(e.target.value, 7))}
            className="lg:col-span-2"
          />
          <Texto rotulo="Telefone" inputMode="numeric" value={t.fone || ''} onChange={(e) => alterarTomador('fone', so(e.target.value, 20))} className="lg:col-span-3" />
          <Texto rotulo="E-mail" type="email" value={t.email || ''} onChange={(e) => alterarTomador('email', e.target.value)} className="lg:col-span-4" />
        </div>
      </Secao>

      <Secao titulo="Serviço">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Campo rotulo="Competência" className="lg:col-span-2">
            <DateField required value={dados.competencia} onChange={(v) => alterar('competencia', v)} />
          </Campo>
          <CampoCodigo
            rotulo="Cód. tributação nacional"
            required
            value={dados.codigoServico}
            onChange={(v) => alterar('codigoServico', v)}
            opcoes={codigos.nacionais}
            digitos={6}
            formatar={formatarServico}
            foraDaLista="Código fora da Lista de Serviços Nacional"
            dica="6 dígitos (ex.: 010701)"
            className="lg:col-span-3"
          />
          <CampoCodigo
            rotulo="Cód. tributação municipal"
            value={dados.codigoServicoMunicipal}
            onChange={(v) => alterar('codigoServicoMunicipal', v)}
            opcoes={codigos.municipais}
            digitos={3}
            formatar={(c) => c || '000'}
            dica={codigos.dicaMunicipal}
            foraDaLista={codigos.foraMunicipal}
            className="lg:col-span-2"
          />
          <CampoCodigo
            rotulo="Código NBS"
            value={dados.codigoNBS}
            onChange={(v) => alterar('codigoNBS', v)}
            opcoes={codigos.nbs}
            digitos={9}
            formatar={formatarNbs}
            dica={codigos.dicaNbs}
            foraDaLista={codigos.foraNbs}
            className="lg:col-span-2"
          />
          <Texto
            rotulo="Município da prestação (IBGE)"
            required
            inputMode="numeric"
            value={dados.municipioPrestacao}
            onChange={(e) => alterar('municipioPrestacao', so(e.target.value, 7))}
            className="lg:col-span-3"
          />

          <Area
            rotulo="Descrição do serviço"
            required
            rows={4}
            maxLength={2000}
            value={dados.descricao}
            onChange={(e) => alterar('descricao', e.target.value)}
            className="lg:col-span-8"
          />
          <Area
            rotulo="Informações complementares"
            rows={4}
            maxLength={2000}
            value={dados.informacoesComplementares}
            onChange={(e) => alterar('informacoesComplementares', e.target.value)}
            className="lg:col-span-4"
          />
        </div>
      </Secao>

      <Secao titulo="Valores">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <Campo rotulo="Valor do serviço" className="lg:col-span-2">
            <NumberField required scale={2} value={dados.valorServico} onChange={(v) => alterar('valorServico', Number(v))} />
          </Campo>
          <Campo rotulo="Desconto incondicionado" className="lg:col-span-2">
            <NumberField scale={2} value={dados.descontoIncondicionado} onChange={(v) => alterar('descontoIncondicionado', Number(v))} />
          </Campo>
          <Campo rotulo="Alíquota do ISS (%)" className="lg:col-span-2">
            <NumberField scale={2} value={dados.aliquotaIss} onChange={(v) => alterar('aliquotaIss', Number(v))} />
          </Campo>
          <div className="lg:col-span-3 h-[34px] flex items-center">
            <Toggle checked={dados.issRetido} onChange={(v) => alterar('issRetido', v)} label="ISS retido pelo tomador" />
          </div>
          <div className="lg:col-span-3 text-xs text-stone-500 dark:text-stone-400 text-right">
            Base de cálculo <strong className="text-stone-800 dark:text-stone-100">{formatarMoeda(base)}</strong>
            {' · '}ISS <strong className="text-stone-800 dark:text-stone-100">{formatarMoeda(iss)}</strong>
          </div>
        </div>
      </Secao>

      <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40">
        <Botao onClick={onCancelar}>Cancelar</Botao>
        <Botao
          type="submit"
          value="gravar"
          icone={<Save className="w-3.5 h-3.5" />}
          carregando={enviando === 'gravar'}
          disabled={!!enviando}
          title="Grava a nota assinada, sem enviar: transmita depois pela lista"
        >
          Gravar
        </Botao>
        <Botao type="submit" variante="primario" icone={<Send className="w-3.5 h-3.5" />} carregando={enviando === 'emitir'} disabled={!!enviando}>
          Emitir NFS-e
        </Botao>
      </div>
    </form>
  );
};
