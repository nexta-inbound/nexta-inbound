# Integracao do codigo Outbound

Repositorio de destino: https://github.com/nexta-inbound/nexta-inbound

- Fonte de trabalho: `testes/outbound` neste workspace.
- Caminho pretendido no repositorio e site: `outbound/`.
- A branch de preparacao `outbound-migracao` recebe o codigo completo. A main mantem a pagina de preparacao restrita pelo menu central ate a validacao.
- `assets/firebase-outbound.config.js` concentra a configuracao publica do destino. Campos vazios interrompem a inicializacao; a configuracao fixa de nexta-frota foi removida.
- Nao adicionar `.env`, credenciais, node_modules ou `.vercel` ao repositorio.

Antes de integrar na main:

Direcao confirmada em 16/11/2026: Realtime Database, como no Inbound, em projeto separado nexta-outbound. O consumidor atual ainda importa Firestore e permanece bloqueado mesmo ao preencher a configuracao Web, ate existir adaptador Realtime validado. A configuracao precisa incluir databaseURL real, sem adivinhar instancia ou regiao.

1. Confirmar instancia Realtime, preencher configuracao Web real, adaptar consultas/gravacoes e validar o login central no Firebase Outbound, incluindo vinculos entre a conta central, a conta Auth de destino e os perfis migrados.
2. Aplicar autorizacao exclusiva do piloto no backend/regras. A regra do cartao nao protege os dados.
3. Reconciliar o delta de dados e executar testes das telas, regras e consultas.
4. Definir onde executar api/ors-proxy.js: GitHub Pages nao executa funcoes Vercel. O cliente usa /api/ors-proxy na raiz, portanto copiar api/ para outbound/ nao publica a API.
5. Validar Cloudinary e o consumidor da fila WhatsApp.
6. Atualizar versoes dos assets, revisar a branch e somente entao substituir a pagina de preparacao.

Esta etapa nao muda as contas, os dados ou as regras remotas. Ainda nao integra o SSO na aplicacao completa.
