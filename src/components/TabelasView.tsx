import React, { useEffect, useState } from 'react';
import { Download, Library, Table2, X } from 'lucide-react';
import * as api from '../services/api';
import { Botao, Etiqueta, Secao } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { ColunaGrade, Grade } from './Grade';
import { formatarData, formatarDataHora, formatarMoeda, formatarNbs, formatarServico } from '../utils/formatters';

type NomeTabela = api.SituacaoTabela['nome'];

const TITULOS: Record<NomeTabela, string> = {
  nacionais: 'Código de Tributação Nacional',
  nbs: 'Código NBS',
  municipais: 'Código de Tributação Municipal',
};

/**
 * Códigos de serviço da NFS-e: só são baixados da fonte quando o usuário pede.
 * O Ver abre a grade da tabela numa aba filha; a faixa de abas só aparece com alguma aberta,
 * e o X de cada filha a fecha e volta para a 1ª aba.
 */
export const TabelasView: React.FC = () => {
  const [tabelas, setTabelas] = useState<api.SituacaoTabela[]>([]);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<NomeTabela[]>([]);
  const [ativa, setAtiva] = useState<'tabelas' | NomeTabela>('tabelas');

  const ver = (nome: NomeTabela) => {
    setAbertas((a) => (a.includes(nome) ? a : [...a, nome]));
    setAtiva(nome);
  };
  const fechar = (nome: NomeTabela) => {
    setAbertas((a) => a.filter((n) => n !== nome));
    setAtiva('tabelas');
  };

  const ler = () => api.buscarTabelas().then(setTabelas).catch((e) => setErro(e.message));
  useEffect(() => {
    ler();
  }, []);

  const atualizar = async (nome: NomeTabela) => {
    setBaixando(nome);
    setErro(null);
    try {
      const r = await api.atualizarTabela(nome);
      setFeito(`${TITULOS[nome]} atualizado: ${r.total.toLocaleString('pt-BR')} códigos (${r.versao}).`);
      await ler();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setBaixando(null);
    }
  };

  const semNacionais = !tabelas.find((t) => t.nome === 'nacionais')?.total;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {feito && <AvisoSucesso mensagem={feito} onFechar={() => setFeito(null)} />}

      {abertas.length > 0 && (
        <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
          <button
            type="button"
            onClick={() => setAtiva('tabelas')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
              ativa === 'tabelas'
                ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
                : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <Library className="w-3.5 h-3.5" />
            <span>Tabelas</span>
          </button>
          {abertas.map((nome) => (
            <div
              key={nome}
              className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
                ativa === nome
                  ? 'bg-white dark:bg-stone-900 border-b-blue-600'
                  : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => setAtiva(nome)}
                className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  ativa === nome ? 'text-blue-700 dark:text-blue-400' : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>{TITULOS[nome]}</span>
              </button>
              <button
                type="button"
                onClick={() => fechar(nome)}
                title="Fechar aba"
                className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Abas filhas continuam montadas enquanto abertas: busca, página e rolagem ficam como estavam */}
      {abertas.map((nome) => (
        <div key={nome} className={ativa === nome ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <GradeTabela nome={nome} />
        </div>
      ))}

      <div className={ativa === 'tabelas' ? 'flex flex-col overflow-y-auto' : 'hidden'}>
        {tabelas.map((t) => {
          const esperaNacionais = t.nome === 'municipais' && semNacionais;
          return (
            <Secao
              key={t.nome}
              titulo={`${TITULOS[t.nome]}${t.nome === 'municipais' && t.municipio ? ` · ${t.municipio}` : ''}`}
              descricao={`${t.fonte} · ${t.tabela}`}
              acoes={
                <>
                  <Botao icone={<Table2 className="w-3.5 h-3.5" />} disabled={!t.total} onClick={() => ver(t.nome)}>
                    Ver
                  </Botao>
                  <Botao
                    variante="primario"
                    icone={<Download className="w-3.5 h-3.5" />}
                    carregando={baixando === t.nome}
                    disabled={!!baixando || !t.existe || esperaNacionais}
                    title={esperaNacionais ? 'Baixe antes o Código de Tributação Nacional' : undefined}
                    onClick={() => atualizar(t.nome)}
                  >
                    {baixando === t.nome ? 'Baixando…' : t.total ? 'Atualizar' : 'Baixar'}
                  </Botao>
                </>
              }
            >
              {!t.existe ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">As tabelas não estão prontas no banco: rode o {t.sql}.</p>
              ) : (
                <p className="text-xs text-stone-600 dark:text-stone-300">
                  {t.total
                    ? `${t.total.toLocaleString('pt-BR')} códigos, atualizado em ${formatarDataHora(t.atualizadoEm)}.`
                    : esperaNacionais
                      ? 'Vazia: baixe antes o Código de Tributação Nacional (o município é consultado código a código).'
                      : 'Vazia: clique em Baixar.'}
                </p>
              )}
            </Secao>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grade de cada tabela (aba filha, aberta pelo Ver)
// ---------------------------------------------------------------------------

interface LinhaCodigo {
  id: number;
  codigo: string;
  descricao: string | null;
  itens?: string | null;
  incidencia?: string | null;
  aliquota?: string | null;
  inicio_vigencia?: string | null;
  fim_vigencia?: string | null;
}

const COLUNAS: Record<NomeTabela, ColunaGrade<LinhaCodigo>[]> = {
  nacionais: [
    { nome: 'codigo', rotulo: 'Código', valor: (l) => formatarServico(l.codigo) },
    { nome: 'descricao', rotulo: 'Descrição', valor: (l) => l.descricao, dica: (l) => l.descricao || '' },
  ],
  nbs: [
    { nome: 'codigo', rotulo: 'NBS', valor: (l) => formatarNbs(l.codigo) },
    { nome: 'descricao', rotulo: 'Descrição', valor: (l) => l.descricao, dica: (l) => l.descricao || '' },
    { nome: 'itens', rotulo: 'Itens da LC 116', valor: (l) => l.itens || '—', dica: (l) => l.itens || '' },
  ],
  municipais: [
    { nome: 'codigo', rotulo: 'Código', valor: (l) => formatarServico(l.codigo) },
    { nome: 'descricao', rotulo: 'Serviço', valor: (l) => l.descricao || '—', dica: (l) => l.descricao || '' },
    {
      nome: 'incidencia',
      rotulo: 'Incidência',
      tipo: 'centro',
      valor: (l) =>
        l.incidencia === 'SIM' ? (
          <Etiqueta texto="Sim" classe="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
        ) : (
          <Etiqueta texto={l.incidencia || '—'} classe="bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400" />
        ),
    },
    { nome: 'aliquota', rotulo: 'Alíquota ISS (%)', tipo: 'numero', valor: (l) => (l.aliquota == null ? '—' : formatarMoeda(l.aliquota)) },
    { nome: 'inicio_vigencia', rotulo: 'Início vigência', tipo: 'data', valor: (l) => formatarData(l.inicio_vigencia) },
    { nome: 'fim_vigencia', rotulo: 'Fim vigência', tipo: 'data', valor: (l) => formatarData(l.fim_vigencia) },
  ],
};

const CARREGAR = { nacionais: api.listarNacionais, nbs: api.listarNbs, municipais: api.listarMunicipais };

/** A tabela gravada no banco, na grade padrão (só leitura) */
const GradeTabela: React.FC<{ nome: NomeTabela }> = ({ nome }) => (
  <div className="flex-1 flex flex-col min-h-0">
    <Grade<LinhaCodigo>
      recurso={`tabela_${nome}`}
      colunas={COLUNAS[nome]}
      carregarPagina={CARREGAR[nome]}
      chave={(l) => l.id}
      ordemPadrao={{ campo: 'codigo', direcao: 'asc' }}
      rotuloVazio="Nenhum código encontrado"
    />
  </div>
);
