/** Formatações de exibição. Datas em dd/mm/aaaa, números alinhados à direita nas listas. */

export function formatarCnpj(valor: string): string {
  const c = (valor || '').replace(/\D/g, '');
  if (c.length !== 14) return valor || '';
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function formatarCpfCnpj(valor: string): string {
  const c = (valor || '').replace(/\D/g, '');
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  return formatarCnpj(c);
}

/** "2026-09-20 14:32:05" -> "20/09/2026 14:32" */
export function formatarDataHora(valor: string | null | undefined): string {
  if (!valor) return '—';
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?/);
  if (!m) return String(valor);
  const data = `${m[3]}/${m[2]}/${m[1]}`;
  return m[4] ? `${data} ${m[4]}:${m[5]}` : data;
}

export function formatarData(valor: string | null | undefined): string {
  return formatarDataHora(valor).slice(0, 10);
}

export function formatarMoeda(valor: number | string | null | undefined): string {
  const n = Number(valor ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Chave de acesso em blocos de 4, como no DANFE */
export function formatarChave(chave: string): string {
  return ((chave || '').match(/.{1,4}/g) || []).join(' ');
}

export const SITUACOES: Record<string, { rotulo: string; classe: string }> = {
  pendente: { rotulo: 'Pendente', classe: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  autorizada: { rotulo: 'Autorizada', classe: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  rejeitada: { rotulo: 'Rejeitada', classe: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  cancelada: { rotulo: 'Cancelada', classe: 'bg-stone-300 text-stone-800 dark:bg-stone-700 dark:text-stone-200' },
};

export const AMBIENTES: Record<number, string> = { 1: 'Produção', 2: 'Produção restrita' };

/** Código de tributação nacional 010701 → 01.07.01; com o municipal, 010701000 → 01.07.01.000 */
export const formatarServico = (c: string) => (c || '').replace(/^(\d{2})(\d{2})(\d{2})(\d{3})?$/, (_, a, b, d, m) => [a, b, d, m].filter(Boolean).join('.'));

/** NBS 115013000 → 1.1501.30.00 */
export const formatarNbs = (c: string) => (c || '').replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4');
