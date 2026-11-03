// Login central dos sistemas Nexta: configuração compartilhada pela tela inicial, pela tela de
// usuários e pelos sistemas.

// Projeto Firebase central. Copie do Console: Configurações do projeto → Seus apps → app da Web.
// São identificadores públicos; quem protege os dados são as regras do banco e as funções.
export const FIREBASE_CENTRAL = {
  apiKey: 'AIzaSyDs9YRHSfocg2PmusNHe6VtyJ8Gu3lDgdM',
  authDomain: 'nexta-logistica.firebaseapp.com',
  databaseURL: 'https://nexta-logistica-default-rtdb.firebaseio.com',
  projectId: 'nexta-logistica',
  storageBucket: 'nexta-logistica.firebasestorage.app',
  messagingSenderId: '620751377945',
  appId: '1:620751377945:web:d461aa6d368e779940bc88',
};

// true (ligado em 03/11/2026): a tela inicial exige login e mostra só os sistemas liberados.
// false: a tela inicial fica aberta (todos os cards, sem login) e o login central fica em /?entrar.
export const LOGIN_OBRIGATORIO = true;

export const REGIAO_FUNCOES = 'southamerica-east1';

// Horas sem uso (em nenhum sistema) até a sessão ser encerrada em todos; padronizado em 03/11/2026, como já era
// no Inbound e no Nextoques. O autoatendimento fica fora: o tablet usa o login próprio do quiosque.
export const HORAS_INATIVIDADE = 2;

// Nome do app no SDK. A sessão fica salva no navegador por domínio + apiKey + este nome: a tela
// inicial, a tela de usuários e os sistemas precisam usar o mesmo para compartilhar o login.
export const APP_CENTRAL = 'nexta-central';

// Mesmos ids e nomes de functions/sistemas.py (os nomes também estão nos cards de index.html)
export const SISTEMAS = {
  inbound: { nome: 'Portal Programação Inbound', curto: 'Inbound', caminho: '/inbound/' },
  agendamento: { nome: 'Portal Agendamento', curto: 'Agendamento', caminho: '/agendamento/' },
  solicitacoes: { nome: 'Portal Solicitações de Adicionais Disp.', curto: 'Solicitações', caminho: '/solicitacao_disponibilidade/' },
  simulador: { nome: 'Portal Nextoques', curto: 'Nextoques', caminho: '/simulador_estoque/' },
};

export const configPronta = () => !String(FIREBASE_CENTRAL.apiKey).startsWith('PREENCHER');
