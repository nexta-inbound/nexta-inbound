// Preencher somente com a configuracao publica do App Web de nexta-outbound.
// Sem fallback para nexta-frota. Chaves privadas nao pertencem ao frontend.
export const firebaseConfig = Object.freeze({
  apiKey: '',
  authDomain: '',
  projectId: 'nexta-outbound',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
});

export function validarConfigOutbound(config) {
  return config?.projectId === 'nexta-outbound' &&
    ['apiKey', 'authDomain', 'appId', 'messagingSenderId'].every(
      campo => typeof config[campo] === 'string' && config[campo].trim() !== '' &&
        !config[campo].includes('PREENCHER')
    );
}

if (!validarConfigOutbound(firebaseConfig)) {
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
  throw new Error('Configuracao Web de nexta-outbound pendente; inicializacao Firebase interrompida.');
}
