import React, { useEffect, useRef, useState } from 'react';
import * as api from '../services/api';
import { formatarMoeda, formatarServico } from '../utils/formatters';
import { ALTURA_CONTROLE, Campo } from './ui';
import { INPUT_CLASS } from '../utils/formStyles';

export interface OpcaoCodigo {
  codigo: string;
  descricao: string;
  /** Texto à direita na lista (ex.: "ISS 2,00%") */
  detalhe?: string;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MAXIMO = 100;

/**
 * Campo de código com a lista da tabela: digitar números filtra pelo começo do código,
 * digitar palavras procura na descrição. O valor só muda com dígitos ou escolhendo da lista;
 * código fora da lista continua aceito (a tabela pode estar desatualizada). Embaixo, a
 * descrição do código escolhido.
 */
export const CampoCodigo: React.FC<{
  rotulo: string;
  value: string;
  onChange: (codigo: string) => void;
  opcoes: OpcaoCodigo[];
  digitos: number;
  formatar?: (codigo: string) => string;
  dica?: string;
  /** Aviso (âmbar) para código digitado que não está na lista */
  foraDaLista?: string;
  required?: boolean;
  className?: string;
}> = ({ rotulo, value, onChange, opcoes, digitos, formatar = (c) => c, dica, foraDaLista = 'Código fora da tabela', required, className = '' }) => {
  const [busca, setBusca] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const [paraCima, setParaCima] = useState(false);
  const [pelaDireita, setPelaDireita] = useState(false);
  const lista = useRef<HTMLUListElement>(null);

  const termo = (busca ?? '').trim();
  const soDigitos = termo.replace(/[.\s-]/g, '');
  const filtradas = (
    !termo
      ? opcoes
      : /^\d+$/.test(soDigitos)
        ? opcoes.filter((o) => o.codigo.startsWith(soDigitos))
        : opcoes.filter((o) => semAcento(o.descricao).includes(semAcento(termo)))
  ).slice(0, MAXIMO);

  const escolhida = opcoes.find((o) => o.codigo === value);
  const fora = !aberto && !!value && opcoes.length > 0 && !escolhida;

  const abrir = (e: React.SyntheticEvent<HTMLInputElement>) => {
    // Perto do pé da tela a lista abre para cima; perto da borda direita, alinha pela direita do campo
    const r = e.currentTarget.getBoundingClientRect();
    setParaCima(r.bottom + 280 > window.innerHeight);
    setPelaDireita(r.left + 560 > window.innerWidth);
    setAberto(true);
  };

  const escolher = (o: OpcaoCodigo) => {
    onChange(o.codigo);
    setBusca(null);
    setAberto(false);
  };

  const mudar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const texto = e.target.value;
    setBusca(texto);
    setDestaque(0);
    abrir(e);
    if (/^\d*$/.test(texto)) onChange(texto.slice(0, digitos));
  };

  const teclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) return abrir(e);
      const n = Math.max(0, Math.min(filtradas.length - 1, destaque + (e.key === 'ArrowDown' ? 1 : -1)));
      setDestaque(n);
      lista.current?.children[n]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && aberto && filtradas[destaque]) {
      e.preventDefault();
      escolher(filtradas[destaque]);
    } else if (e.key === 'Escape' && aberto) {
      e.stopPropagation();
      setAberto(false);
    }
  };

  return (
    <Campo rotulo={rotulo} dica={escolhida || fora ? undefined : dica} className={className}>
      <div className="relative">
        <input
          value={busca ?? value}
          onChange={mudar}
          onFocus={abrir}
          onClick={abrir}
          onKeyDown={teclar}
          onBlur={() => {
            setBusca(null);
            setAberto(false);
          }}
          required={required}
          autoComplete="off"
          placeholder={opcoes.length ? 'Código ou parte da descrição' : undefined}
          className={`${INPUT_CLASS} ${ALTURA_CONTROLE} w-full`}
        />
        {aberto && filtradas.length > 0 && (
          <ul
            ref={lista}
            // mouseDown não tira o foco do campo: o clique escolhe antes do blur fechar a lista
            onMouseDown={(e) => e.preventDefault()}
            className={`absolute z-40 w-[34rem] max-w-[90vw] max-h-64 overflow-y-auto py-1 rounded-md shadow-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 ${
              paraCima ? 'bottom-full mb-1' : 'top-full mt-1'} ${pelaDireita ? 'right-0' : 'left-0'
            }`}
          >
            {filtradas.map((o, i) => (
              <li
                key={o.codigo}
                onClick={() => escolher(o)}
                onMouseEnter={() => setDestaque(i)}
                title={o.descricao}
                className={`flex items-baseline gap-2 px-3 py-1.5 text-xs cursor-pointer ${
                  i === destaque ? 'bg-blue-50 dark:bg-blue-950/50' : ''
                } ${o.codigo === value ? 'font-semibold' : ''}`}
              >
                <span className="shrink-0 tabular-nums text-stone-800 dark:text-stone-100">{formatar(o.codigo)}</span>
                <span className="flex-1 truncate text-stone-600 dark:text-stone-300">{o.descricao}</span>
                {o.detalhe && <span className="shrink-0 text-stone-500 dark:text-stone-400">{o.detalhe}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {escolhida && (
        <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400 truncate" title={escolhida.descricao}>
          {formatar(escolhida.codigo)} · {escolhida.descricao}
          {escolhida.detalhe ? ` · ${escolhida.detalhe}` : ''}
        </span>
      )}
      {fora && <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{foraDaLista}</span>}
    </Campo>
  );
};

const aliquota = (c?: api.CodigoMunicipal) => (c?.aliquota == null ? '' : `ISS ${formatarMoeda(c.aliquota)}%`);

/**
 * Opções dos três campos de código do serviço (tela Tabelas): a lista nacional inteira, as NBS do
 * subitem do código nacional (Anexo VIII) e os códigos do município do prestador, com a alíquota.
 */
export function useCodigosServico(nacional: string) {
  const [nacionais, setNacionais] = useState<OpcaoCodigo[]>([]);
  const [doServico, setDoServico] = useState<Awaited<ReturnType<typeof api.buscarCodigosDoServico>> | null>(null);

  useEffect(() => {
    // Sem as tabelas os campos continuam aceitando o código digitado
    api
      .buscarCodigosNacionais()
      .then(setNacionais)
      .catch(() => setNacionais([]));
  }, []);

  useEffect(() => {
    // Só vale a resposta do código atual: a de um código anterior pode chegar depois
    let atual = true;
    api
      .buscarCodigosDoServico(nacional.length === 6 ? nacional : '')
      .then((r) => atual && setDoServico(r))
      .catch(() => atual && setDoServico(null));
    return () => {
      atual = false;
    };
  }, [nacional]);

  const municipais = doServico?.municipais ?? [];
  const semCodigo = municipais.find((c) => c.codigo === '000');
  const proprios = municipais.filter((c) => c.codigo !== '000');
  const item = nacional.length === 6 ? `${nacional.slice(0, 2)}.${nacional.slice(2, 4)}` : '';

  return {
    nacionais,
    nbs: doServico?.nbs ?? [],
    dicaNbs: !doServico?.nbs.length
      ? '9 dígitos'
      : doServico.nbsDoItem
        ? `As NBS do item ${item} (Anexo VIII)`
        : item
          ? `O item ${item} não está no Anexo VIII: lista a NBS inteira`
          : '9 dígitos',
    // "000" é o serviço sem código do município: a DPS vai sem cTribMun (campo vazio), só com o nacional
    municipais: [
      ...(semCodigo ? [{ codigo: '', descricao: 'Sem código municipal: vai só o código nacional', detalhe: aliquota(semCodigo) }] : []),
      ...proprios.map((c) => ({ codigo: c.codigo, descricao: `Código municipal ${c.codigo}`, detalhe: aliquota(c) })),
    ],
    dicaMunicipal: !item
      ? 'Escolha antes o código nacional'
      : doServico && !municipais.length
        ? 'Serviço sem parametrização no município (ou a tabela municipal não foi baixada)'
        : '3 dígitos, quando o município usa',
    foraMunicipal: `Não existe no município para o ${item ? formatarServico(nacional) : 'serviço'}: a Sefin rejeita (E0314)`,
    foraNbs: doServico?.nbsDoItem ? `Não está entre as NBS do item ${item} (Anexo VIII)` : 'Código fora da NBS',
  };
}
