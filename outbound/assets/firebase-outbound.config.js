// Preencher somente com a configuracao publica do App Web de nexta-outbound.
// Sem fallback para nexta-frota. Chaves privadas nao pertencem ao frontend.
export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyC0wtw3uRIDesJs00eR2eUyNpTbvIuFZT8",
  authDomain: "nexta-outbound.firebaseapp.com",
  projectId: 'nexta-outbound',
  databaseURL: 'https://nexta-outbound-default-rtdb.firebaseio.com',
  storageBucket: "nexta-outbound.firebasestorage.app",
  messagingSenderId: "617366616028",
  appId: "1:617366616028:web:ae058e558f542f2fac0119"
});

export function validarConfigOutbound(config) {
  return config?.projectId === 'nexta-outbound' &&
    ['apiKey', 'authDomain', 'appId', 'messagingSenderId'].every(
      campo => typeof config[campo] === 'string' && config[campo].trim() !== '' &&
        !config[campo].includes('PREENCHER')
    );
}

// A decisao de migrar para Realtime exige adaptar o acesso a dados antes de iniciar.
// Preencher o SDK nao deve reativar por acidente o consumidor Firestore antigo.
// Liberado em 2026-11-18: adaptador validado na homologacao (77/77) e regras novas publicadas no nexta-outbound
// (145/145 na homologacao). As GRAVACOES seguem desligadas em producao (writesEnabled no adaptador).
const ADAPTADOR_REALTIME_PRONTO = true;
if (!ADAPTADOR_REALTIME_PRONTO || !validarConfigOutbound(firebaseConfig)) {
  const painel = document.createElement('main');
  painel.style.cssText = 'max-width:640px;margin:12vh auto;padding:24px;font-family:system-ui;color:#e2edf5';
  const titulo = document.createElement('h1');
  titulo.textContent = 'Portal Programação Outbound';
  const aviso = document.createElement('p');
  aviso.textContent = 'A conexão do ambiente Outbound está em preparação. Volte ao portal central para acessar os outros sistemas.';
  const voltar = document.createElement('a');
  voltar.href = '/?menu';
  voltar.textContent = 'Voltar ao portal';
  voltar.style.color = '#56d5ca';
  painel.append(titulo, aviso, voltar);
  document.body.replaceChildren(painel);
  document.body.style.background = '#0c1921';
  throw new Error('Migracao Realtime pendente: configuracao, adaptador e regras precisam ser validados.');
}
