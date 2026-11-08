import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Copy, ExternalLink, Eye, FileCode2, FileText, Plus, Printer, RefreshCw, Send, X } from 'lucide-react';
import * as api from '../services/api';
import { DadosNFSe, NotaDetalhe, NotaLista } from '../types';
import { ColunaGrade, Grade } from './Grade';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from './MenuAcoes';
import { NovaNFSeView } from './NovaNFSeView';
import { Area, Botao, Confirmacao, Etiqueta, Secao, Selecao } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { useProgresso } from './ProgressoModal';
import { AMBIENTES, SITUACOES, formatarChave, formatarCpfCnpj, formatarData, formatarDataHora, formatarMoeda } from '../utils/formatters';

type Aba = { id: string; titulo: string; notaId?: number; copia?: DadosNFSe | null };

const MOTIVOS: Record<string, string> = { '1': 'Erro na emissão', '2': 'Serviço não prestado', '9': 'Outros' };

const situacao = (s: string) => {
  const x = SITUACOES[s] || SITUACOES.pendente;
  return <Etiqueta texto={x.rotulo} classe={x.classe} />;
};

/** Só o que já foi enviado tem o que consultar */
const consultavel = (s: string) => s === 'pendente' || s === 'autorizada';

/**
 * Notas de serviço: a grade, e em abas filhas a Nova NFS-e e cada nota aberta.
 * A faixa de abas só aparece com alguma filha aberta; o X fecha e volta à grade.
 */
export const NotasView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const [abas, setAbas] = useState<Aba[]>([]);
  const [ativa, setAtiva] = useState('grade');
  const [recarregar, setRecarregar] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<NotaLista | null>(null);
  const [transmitindo, setTransmitindo] = useState<NotaLista | null>(null);
  const progresso = useProgresso();

  const abrir = (aba: Aba) => {
    setAbas((a) => (a.some((x) => x.id === aba.id) ? a : [...a, aba]));
    setAtiva(aba.id);
  };
  const fechar = (id: string) => {
    setAbas((a) => a.filter((x) => x.id !== id));
    setAtiva('grade');
  };
  const abrirNota = (n: Pick<NotaLista, 'id' | 'numero_nfse' | 'numero_dps'>) =>
    abrir({ id: `nota-${n.id}`, titulo: n.numero_nfse ? `NFS-e ${n.numero_nfse}` : `DPS ${n.numero_dps}`, notaId: n.id });
  const novaNota = (copia?: DadosNFSe | null) => {
    // Uma Nova NFS-e por vez: a cópia substitui o formulário aberto
    setAbas((a) => [...a.filter((x) => x.id !== 'nova'), { id: 'nova', titulo: 'Nova NFS-e', copia }]);
    setAtiva('nova');
  };

  const atualizou = (mensagem?: string) => {
    if (mensagem) setFeito(mensagem);
    setRecarregar((n) => n + 1);
    onMudou();
  };

  /** Executa uma ação da nota mostrando o giro na linha e o erro no canto */
  const executar = async (chave: string, acao: () => Promise<any>, sucesso?: string) => {
    setOcupado(chave);
    setErro(null);
    try {
      await acao();
      if (sucesso) atualizou(sucesso);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const consultar = (n: NotaLista) =>
    executar(`consultar-${n.id}`, async () => {
      const r = await progresso.aguardar('Consultando a NFS-e', 'Perguntando à Sefin Nacional…', () => api.consultarNota(n.id));
      atualizou(r.nota.situacao === 'autorizada' ? `NFS-e ${r.nota.numero_nfse ?? ''} autorizada.` : 'Consulta concluída.');
    });

  const transmitir = (n: NotaLista) => {
    setTransmitindo(null);
    return executar(`transmitir-${n.id}`, async () => {
      try {
        const { nota } = await progresso.aguardar('Transmitindo a NFS-e', 'Assinando e enviando a DPS à Sefin Nacional…', () =>
          api.transmitirNota(n.id),
        );
        if (nota.situacao === 'rejeitada') throw new Error(`NFS-e rejeitada pela Sefin Nacional:\n${nota.motivo || ''}`);
        setFeito(
          nota.situacao === 'autorizada'
            ? `NFS-e ${nota.numero_nfse ?? ''} autorizada.`
            : 'DPS enviada; a autorização ainda não foi confirmada. Use Consultar.',
        );
      } finally {
        // Autorizada, rejeitada ou pendente: a situação mudou de qualquer jeito
        atualizou();
      }
    });
  };

  const abrirDanfse = (id: number) =>
    executar(`danfse-${id}`, () => progresso.aguardar('Abrindo o DANFSe', 'Gerando o PDF…', () => api.abrirDanfse(id)));

  const copiar = (n: NotaLista) =>
    executar(`copiar-${n.id}`, async () => {
      const completa = await api.buscarNota(n.id);
      if (!completa.dados) throw new Error('Esta nota não guarda os dados do formulário.');
      novaNota(completa.dados);
    });

  const colunas = useMemo<ColunaGrade<NotaLista>[]>(
    () => [
      { nome: 'data_emissao', rotulo: 'Emissão', tipo: 'data', valor: (n) => formatarDataHora(n.data_emissao) },
      { nome: 'numero_nfse', rotulo: 'NFS-e', tipo: 'numero', valor: (n) => n.numero_nfse ?? '—' },
      { nome: 'numero_dps', rotulo: 'DPS', tipo: 'numero', valor: (n) => `${n.serie}/${n.numero_dps}` },
      { nome: 'competencia', rotulo: 'Competência', tipo: 'data', valor: (n) => formatarData(n.competencia) },
      { nome: 'tomador_nome', rotulo: 'Tomador', valor: (n) => n.tomador_nome || '—', dica: (n) => n.tomador_nome || undefined },
      {
        nome: 'tomador_documento',
        rotulo: 'CPF/CNPJ',
        ordenavel: false,
        valor: (n) => (n.tomador_documento ? formatarCpfCnpj(n.tomador_documento) : '—'),
      },
      { nome: 'valor_servico', rotulo: 'Valor', tipo: 'numero', valor: (n) => formatarMoeda(n.valor_servico) },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'centro', valor: (n) => situacao(n.situacao) },
      { nome: 'ambiente', rotulo: 'Ambiente', tipo: 'centro', valor: (n) => AMBIENTES[n.ambiente] },
      { nome: 'motivo', rotulo: 'Retorno', valor: (n) => n.motivo || '—', dica: (n) => n.motivo || undefined },
    ],
    [],
  );

  const acoes = (n: NotaLista) => (
    <MenuAcoes>
      <BotaoAcao icone={Eye} titulo="Abrir" descricao="Detalhes da nota" onClick={() => abrirNota(n)} />
      {n.chave && (
        <BotaoAcao
          icone={Printer}
          titulo="DANFSe"
          descricao="PDF no leiaute da NT 008"
          carregando={ocupado === `danfse-${n.id}`}
          onClick={() => abrirDanfse(n.id)}
        />
      )}
      <BotaoAcao icone={FileCode2} titulo="Baixar XML" descricao="XML da NFS-e ou da DPS" onClick={() => executar(`xml-${n.id}`, () => api.baixarXml(n.id))} />
      {n.situacao === 'assinada' && (
        <BotaoAcao icone={Send} titulo="Transmitir" descricao="Enviar a DPS gravada à Sefin Nacional" carregando={ocupado === `transmitir-${n.id}`} onClick={() => setTransmitindo(n)} />
      )}
      {consultavel(n.situacao) && (
        <BotaoAcao icone={RefreshCw} titulo="Consultar" descricao="Situação na Sefin Nacional" carregando={ocupado === `consultar-${n.id}`} onClick={() => consultar(n)} />
      )}
      <BotaoAcao icone={Copy} titulo="Copiar" descricao="Nova NFS-e com os mesmos dados" onClick={() => copiar(n)} />
      {n.situacao === 'autorizada' && (
        <>
          <SeparadorAcoes />
          <BotaoAcao icone={Ban} titulo="Cancelar NFS-e" descricao="Evento de cancelamento" tom="perigo" onClick={() => setCancelando(n)} />
        </>
      )}
    </MenuAcoes>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {feito && <AvisoSucesso mensagem={feito} onFechar={() => setFeito(null)} />}
      {progresso.modal}

      {abas.length > 0 && (
        <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
          <button
            type="button"
            onClick={() => setAtiva('grade')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
              ativa === 'grade'
                ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
                : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Notas de Serviço</span>
          </button>
          {abas.map((aba) => (
            <div
              key={aba.id}
              className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
                ativa === aba.id ? 'bg-white dark:bg-stone-900 border-b-blue-600' : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => setAtiva(aba.id)}
                className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  ativa === aba.id ? 'text-blue-700 dark:text-blue-400' : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                {aba.id === 'nova' ? <Plus className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{aba.titulo}</span>
              </button>
              <button
                type="button"
                onClick={() => fechar(aba.id)}
                title="Fechar aba"
                className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Abas filhas continuam montadas enquanto abertas: o que foi digitado não se perde */}
      {abas.map((aba) => (
        <div key={aba.id} className={ativa === aba.id ? 'flex-1 flex flex-col min-h-0 overflow-y-auto' : 'hidden'}>
          {aba.id === 'nova' ? (
            <NovaNFSeView
              key={JSON.stringify(aba.copia ?? null)}
              inicial={aba.copia}
              onCancelar={() => fechar('nova')}
              onEmitida={(notaId, mensagem) => {
                setAbas((a) => a.filter((x) => x.id !== 'nova'));
                atualizou(mensagem);
                api.buscarNota(notaId).then(abrirNota).catch(() => setAtiva('grade'));
              }}
            />
          ) : (
            <DetalheNota
              notaId={aba.notaId!}
              versao={recarregar}
              ocupado={ocupado}
              onDanfse={abrirDanfse}
              onXml={(id) => executar(`xml-${id}`, () => api.baixarXml(id))}
              onConsultar={consultar}
              onTransmitir={setTransmitindo}
              onCopiar={copiar}
              onCancelar={setCancelando}
            />
          )}
        </div>
      ))}

      <div className={ativa === 'grade' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
        <Grade<NotaLista>
          recurso="notas"
          colunas={colunas}
          carregarPagina={api.listarNotas}
          chave={(n) => n.id}
          ordemPadrao={{ campo: 'data_emissao', direcao: 'desc' }}
          acoes={acoes}
          larguraAcoes={56}
          botoes={
            <Botao variante="primario" icone={<Plus className="w-3.5 h-3.5" />} onClick={() => novaNota()}>
              Nova NFS-e
            </Botao>
          }
          onDuploClique={abrirNota}
          recarregar={recarregar}
          rotuloVazio="Nenhuma NFS-e emitida"
        />
      </div>

      <Confirmacao
        aberto={!!transmitindo}
        titulo={`Transmitir a DPS ${transmitindo?.serie}/${transmitindo?.numero_dps}?`}
        mensagem={
          `${transmitindo?.tomador_nome || 'Sem tomador'} • ${formatarMoeda(transmitindo?.valor_servico)}. ` +
          (Number(transmitindo?.ambiente) === 1
            ? 'Ambiente de Produção: a NFS-e sai com valor fiscal.'
            : 'Ambiente de Produção restrita: a nota não tem valor fiscal.')
        }
        rotuloConfirmar="Transmitir"
        perigo={false}
        onConfirmar={() => transmitindo && transmitir(transmitindo)}
        onCancelar={() => setTransmitindo(null)}
      />

      {cancelando && (
        <DialogoCancelamento
          nota={cancelando}
          onFechar={() => setCancelando(null)}
          onCancelada={() => {
            setCancelando(null);
            atualizou(`NFS-e ${cancelando.numero_nfse ?? ''} cancelada.`);
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detalhe da nota (aba filha)
// ---------------------------------------------------------------------------

const DetalheNota: React.FC<{
  notaId: number;
  versao: number;
  ocupado: string | null;
  onDanfse: (id: number) => void;
  onXml: (id: number) => void;
  onConsultar: (n: NotaLista) => void;
  onTransmitir: (n: NotaLista) => void;
  onCopiar: (n: NotaLista) => void;
  onCancelar: (n: NotaLista) => void;
}> = ({ notaId, versao, ocupado, onDanfse, onXml, onConsultar, onTransmitir, onCopiar, onCancelar }) => {
  const [nota, setNota] = useState<NotaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Recarrega quando alguma ação (consultar, cancelar) mexeu nas notas
  useEffect(() => {
    api.buscarNota(notaId).then(setNota).catch((e) => setErro(e.message));
  }, [notaId, versao]);

  if (!nota) {
    return (
      <>
        <div className="py-16 text-center text-xs text-stone-500">Carregando a nota…</div>
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      </>
    );
  }

  const d = nota.dados;
  const linha = (rotulo: string, valor: React.ReactNode) => (
    <div key={rotulo} className="flex flex-col min-w-0">
      <span className="text-[10px] font-semibold uppercase text-stone-400">{rotulo}</span>
      <span className="text-xs text-stone-800 dark:text-stone-100 break-words">{valor || '—'}</span>
    </div>
  );

  return (
    <div className="flex flex-col">
      <Secao
        titulo={nota.numero_nfse ? `NFS-e ${nota.numero_nfse}` : `DPS ${nota.serie}/${nota.numero_dps}`}
        descricao={AMBIENTES[nota.ambiente]}
        acoes={
          <>
            {situacao(nota.situacao)}
            {nota.chave && (
              <Botao icone={<Printer className="w-3.5 h-3.5" />} carregando={ocupado === `danfse-${nota.id}`} onClick={() => onDanfse(nota.id)}>
                DANFSe
              </Botao>
            )}
            <Botao icone={<FileCode2 className="w-3.5 h-3.5" />} onClick={() => onXml(nota.id)}>XML</Botao>
            {nota.situacao === 'assinada' && (
              <Botao variante="primario" icone={<Send className="w-3.5 h-3.5" />} carregando={ocupado === `transmitir-${nota.id}`} onClick={() => onTransmitir(nota)}>
                Transmitir
              </Botao>
            )}
            {consultavel(nota.situacao) && (
              <Botao icone={<RefreshCw className="w-3.5 h-3.5" />} carregando={ocupado === `consultar-${nota.id}`} onClick={() => onConsultar(nota)}>
                Consultar
              </Botao>
            )}
            <Botao icone={<Copy className="w-3.5 h-3.5" />} onClick={() => onCopiar(nota)}>Copiar</Botao>
            {nota.situacao === 'autorizada' && (
              <Botao variante="perigo" icone={<Ban className="w-3.5 h-3.5" />} onClick={() => onCancelar(nota)}>
                Cancelar NFS-e
              </Botao>
            )}
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
          {linha('Emissão', formatarDataHora(nota.data_emissao))}
          {linha('Competência', formatarData(nota.competencia))}
          {linha('Tomador', nota.tomador_nome)}
          {linha('CPF/CNPJ', nota.tomador_documento ? formatarCpfCnpj(nota.tomador_documento) : '')}
          {linha('Código do serviço', nota.codigo_servico)}
          {linha('Valor do serviço', formatarMoeda(nota.valor_servico))}
          {linha('Desconto incondicionado', formatarMoeda(d?.descontoIncondicionado))}
          {linha('ISS', `${formatarMoeda(d?.aliquotaIss)}%${nota.iss_retido ? ' — retido pelo tomador' : ''}`)}
          <div className="sm:col-span-2 lg:col-span-4">
            {linha(
              'Chave de acesso',
              nota.chave ? (
                <span className="inline-flex items-center gap-2 flex-wrap">
                  {formatarChave(nota.chave)}
                  {nota.linkConsulta && (
                    <a href={nota.linkConsulta} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                      Consulta pública <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              ) : null,
            )}
          </div>
          <div className="sm:col-span-2 lg:col-span-4">{linha('Id da DPS', nota.id_dps)}</div>
          {d?.descricao && <div className="sm:col-span-2 lg:col-span-4">{linha('Descrição', <span className="whitespace-pre-wrap">{d.descricao}</span>)}</div>}
          {nota.motivo && (
            <div className="sm:col-span-2 lg:col-span-4">
              {linha(nota.situacao === 'rejeitada' ? 'Rejeição' : 'Retorno', <span className="whitespace-pre-wrap">{nota.motivo}</span>)}
            </div>
          )}
        </div>
      </Secao>

      {nota.eventos.length > 0 && (
        <Secao titulo="Eventos">
          <ul className="flex flex-col gap-2 text-xs">
            {nota.eventos.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3">
                <span className="text-stone-500">{formatarDataHora(e.criado_em)}</span>
                <span className="font-semibold">Cancelamento ({MOTIVOS[e.codigo_motivo] || e.codigo_motivo})</span>
                <span className={e.sucesso ? 'text-emerald-600' : 'text-red-600'}>{e.sucesso ? 'registrado' : e.retorno || 'falhou'}</span>
                <span className="text-stone-500 w-full">{e.motivo}</span>
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Cancelamento: o diálogo é a confirmação (motivo + justificativa)
// ---------------------------------------------------------------------------

const DialogoCancelamento: React.FC<{ nota: NotaLista; onFechar: () => void; onCancelada: () => void }> = ({
  nota,
  onFechar,
  onCancelada,
}) => {
  const [codigo, setCodigo] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const progresso = useProgresso();

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && !enviando && onFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [enviando, onFechar]);

  const confirmar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await progresso.aguardar('Cancelando a NFS-e', 'Enviando o evento de cancelamento à Sefin Nacional…', () =>
        api.cancelarNota(nota.id, codigo, motivo),
      );
      onCancelada();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const curta = motivo.trim().length < 15;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {progresso.modal}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">Cancelar a NFS-e {nota.numero_nfse}?</h3>
            <p className="text-xs text-stone-600 dark:text-stone-300 mt-1">
              {nota.tomador_nome || 'Sem tomador'} • {formatarMoeda(nota.valor_servico)}. O cancelamento é registrado na Sefin Nacional e não pode ser desfeito.
            </p>
          </div>
          <button type="button" onClick={onFechar} className="text-stone-400 hover:text-stone-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pb-4 flex flex-col gap-3">
          <Selecao
            rotulo="Motivo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            opcoes={Object.entries(MOTIVOS).map(([valor, rotulo]) => ({ valor, rotulo }))}
          />
          <Area
            rotulo="Justificativa"
            required
            autoFocus
            rows={3}
            maxLength={255}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            dica="Mínimo de 15 caracteres"
          />
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2">
          <Botao onClick={onFechar} disabled={enviando}>Voltar</Botao>
          <Botao variante="perigo" icone={<Ban className="w-3.5 h-3.5" />} disabled={curta} carregando={enviando} onClick={confirmar}>
            Cancelar NFS-e
          </Botao>
        </div>
      </div>
    </div>
  );
};
