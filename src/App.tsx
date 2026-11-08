import React, { useCallback, useEffect, useState } from 'react';
import { CertificadoInfo, Painel, Prestador, StatusBanco, Usuario } from './types';
import * as api from './services/api';
import { ThemeMode, applyTheme, getInitialTheme } from './utils/theme';
import { lerSessao, limparSessao, salvarSessao } from './utils/session';
import { limparConfigListas } from './utils/configListas';
import { MENU, Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { Dashboard } from './components/Dashboard';
import { NotasView } from './components/NotasView';
import { ConfiguracoesView } from './components/ConfiguracoesView';
import { LogView } from './components/LogView';
import { TabelasView } from './components/TabelasView';

const SUBTITULOS: Record<string, string> = {
  painel: 'Indicadores da emissão, certificado e últimas falhas',
  notas: 'Emissão, consulta, DANFSe e cancelamento de NFS-e no Padrão Nacional',
  tabelas: 'Códigos de tributação nacional e municipal e NBS, baixados da fonte oficial',
  configuracoes: 'Certificado, prestador, ambiente e padrões da emissão',
  log: 'Histórico de comunicação com a Sefin Nacional',
};

export default function App() {
  // ---------------------------------------------------------------
  // Tema
  // ---------------------------------------------------------------
  const [tema, setTema] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => { applyTheme(tema); }, [tema]);
  const alternarTema = useCallback(() => setTema((t) => (t === 'dark' ? 'light' : 'dark')), []);

  // ---------------------------------------------------------------
  // Sessão
  // ---------------------------------------------------------------
  const [sessaoSalva] = useState(() => {
    const salva = lerSessao();
    // O token precisa estar no cliente HTTP antes das primeiras chamadas do painel
    api.definirToken(salva.token);
    return salva;
  });
  const [usuario, setUsuario] = useState<Usuario | null>(sessaoSalva.usuario);
  const [prestador, setPrestador] = useState<Prestador | null>(sessaoSalva.empresa);
  /** Motivo mostrado na tela de login quando a sessão expira ou é revogada */
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);

  // ---------------------------------------------------------------
  // Estado geral
  // ---------------------------------------------------------------
  const [abaAtiva, setAbaAtiva] = useState('painel');
  const [menuMobile, setMenuMobile] = useState(false);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [statusBanco, setStatusBanco] = useState<StatusBanco | null>(null);
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const [ambiente, setAmbiente] = useState(2);

  const recarregar = useCallback(async () => {
    if (!prestador) return;

    api.buscarStatusBanco().then(setStatusBanco).catch(() => setStatusBanco(null));
    api.buscarPainel().then(setPainel).catch(() => setPainel(null));

    try {
      const dados = await api.buscarConfig();
      setCertificado(dados.certificado);
      setAmbiente(dados.config.webservice.ambiente);
      setPrestador((atual) => (atual ? { ...atual, ...dados.prestador } : atual));
    } catch {
      // Banco sem as tabelas ou sessão inválida: o painel mostra o aviso
    }
  }, [prestador?.id]);

  useEffect(() => { recarregar(); }, [recarregar]);

  const sair = useCallback(() => {
    setUsuario(null);
    setPrestador(null);
    setPainel(null);
    setCertificado(null);
    setAbaAtiva('painel');
    api.definirToken(null);
    // As preferências das grades são do usuário que saiu
    limparConfigListas();
    limparSessao();
  }, []);

  // Token vencido (12 h) ou acesso revogado: o servidor responde 401 e volta ao login
  useEffect(() => {
    api.aoExpirarSessao((mensagem) => {
      sair();
      setAvisoLogin(mensagem);
    });
  }, [sair]);

  if (!usuario || !prestador) {
    return (
      <LoginView
        tema={tema}
        onAlternarTema={alternarTema}
        avisoInicial={avisoLogin}
        onEntrou={(novoUsuario, novaEmpresa, token, lembrar) => {
          api.definirToken(token);
          setUsuario(novoUsuario);
          setPrestador(novaEmpresa);
          salvarSessao(novoUsuario, novaEmpresa, token, lembrar);
          setAvisoLogin(null);
          setAbaAtiva('painel');
        }}
      />
    );
  }

  const item = MENU.find((m) => m.id === abaAtiva);
  const contagens: Record<string, number> = { notas: painel?.contagens?.notas ?? 0 };

  return (
    <div className="h-screen overflow-hidden bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100
      flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      <Sidebar
        abaAtiva={abaAtiva}
        onTrocarAba={setAbaAtiva}
        contagens={contagens}
        usuario={usuario}
        razaoSocial={prestador.nome_fantasia || prestador.razao_social}
        onSair={sair}
        abertaNoMobile={menuMobile}
        onFecharMobile={() => setMenuMobile(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header
          titulo={item?.rotulo || 'BMNFs'}
          subtitulo={SUBTITULOS[abaAtiva]}
          prestador={prestador}
          certificado={certificado}
          statusBanco={statusBanco}
          ambiente={ambiente}
          tema={tema}
          onAlternarTema={alternarTema}
          onAtualizar={recarregar}
          onAbrirMenuMobile={() => setMenuMobile(true)}
        />

        {abaAtiva === 'painel' ? (
          // O painel é o único com margem e cartões
          <main className="flex-1 overflow-y-auto min-h-0">
            <div className="px-4 sm:px-6 py-5">
              <Dashboard painel={painel} statusBanco={statusBanco} onNavegar={setAbaAtiva} />
            </div>
          </main>
        ) : (
          // As demais telas seguem o b2b admin: ocupam toda a área útil, chapadas, sem margem
          <main className="flex-1 flex flex-col overflow-y-auto min-h-0 bg-white dark:bg-stone-900">
            {abaAtiva === 'notas' && <NotasView onMudou={recarregar} />}
            {abaAtiva === 'configuracoes' && <ConfiguracoesView onSalvou={recarregar} />}
            {abaAtiva === 'tabelas' && <TabelasView />}
            {abaAtiva === 'log' && <LogView />}
          </main>
        )}
      </div>
    </div>
  );
}
