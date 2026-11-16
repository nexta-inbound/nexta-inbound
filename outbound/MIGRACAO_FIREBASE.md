# Migracao do aplicativo para nexta-outbound

Levantamento local em 16/11/2026. O aplicativo ainda aponta para nexta-frota.
Nenhuma configuracao remota ou dado foi alterado nesta etapa.

## Conexao e autenticacao

- `assets/nexta-frota-main.js:57`: configuracao Web do Firebase; obter o bloco real do App Web de nexta-outbound. Nao basta trocar apenas projectId.
- `assets/nexta-frota-main.js:65`: app principal, Firestore e Auth.
- `assets/nexta-frota-main.js:69`: app secundario usa a mesma configuracao para criar contas sem encerrar a sessao do administrador.
- `assets/nexta-frota-main.js:73`: login converte o identificador para `identificador@nexta-frota.app`. Preservar esta convencao na primeira etapa, a menos que as contas do Auth sejam reconciliadas com outra convencao.
- `assets/nexta-frota-main.js:6672`: login exige conta Auth e perfil ativo correspondente em `config/users.data`; os documentos copiados nao criam contas Auth.
- `assets/nexta-frota-main.js:6392`: SDK compartilhado com os outros modulos via `window.fb*`; uma troca na inicializacao principal afeta esses modulos.

## Mapa de dados

| Caminho Firestore | Uso no aplicativo |
| --- | --- |
| config/plates | Placas por transportador; leitura, gravacao e acompanhamento em tempo real |
| config/roteirizador_clientes, roteirizador_terminais, roteirizador_veiculos | Cadastros; dados em mapas no campo data |
| config/users | Perfis do aplicativo; campo data |
| config/carriers, config/operacoes | Listas de transportadores e operacoes |
| config/drivers | Motoristas; campo data |
| config/notifications, config/audit_log | Avisos e auditoria; campo items |
| config/alert_cutoff, meta_disp, meta_sla | Parametros de metas e hora de corte |
| config/monthly_archives e archives | Historico legado e arquivos mensais; o codigo pode copiar arquivos legados e excluir excedentes |
| availability | Disponibilidade; leituras, filtros, gravacoes, exclusoes e listeners |
| locks | Bloqueios; leitura, gravacao, exclusao e listeners |
| sob_ciclos e config/sob_config | Operacao sob demanda, pelo modulo nexta-frota-sobdemanda.js |
| config/pet_seq | Sequencial compartilhado; leitura e atualizacao pelo roteirizador |
| telao_programacao | Resumos diarios gravados pelo roteirizador e lidos pelo telao |
| devolucoesReentregas | Registro, consulta, exclusao e acompanhamento de devolucoes |
| freteSimulacoes | Gravacao e historico de simulacoes de frete |
| otimizador_eventos | Eventos e historico do otimizador |
| otimizador_parametros/global | Parametros do otimizador; referenciado no codigo, ausente das colecoes encontradas na consulta anterior |
| whatsapp_robo/status | Status do robo; referenciado no codigo, ausente na consulta anterior |
| whatsapp_fila | Envio e historico de fila; referenciado no codigo, ausente na consulta anterior |
| config/whatsapp_grupos | Configuracao de grupos; confirmar integracao consumidora no ambiente novo |

Ausencia de uma colecao na consulta nao significa erro: ela pode ser criada no primeiro uso.
Referencias literais e aliases foram revisados; caminhos dinamicos devem ser exercitados na validacao das telas.

## Consultas para validar com regras e indices

- availability: filtros por carrier/plate, por dateStr, e dateStr combinado com oferta.
- locks: filtro por dateStr; telao_programacao: filtro por mes.
- devolucoesReentregas: faixa e ordenacao por criadoEm.
- archives: ordenacao por key; simulacoes e fila WhatsApp: ordenacao por criadoEm.
- Regras devem autorizar tambem os listeners, batches e exclusoes reais do aplicativo. Os papeis exibidos no frontend nao substituem regras no servidor.
- Esta lista e orientativa; nao criar indices sem confrontar as consultas completas e os indices existentes.

## Integracoes externas

- Fotos usam Cloudinary, pelo helper uploadFotoGenerica e pelo upload de disponibilidade; a troca do bucket Firebase nao migra essas fotos.
- Rotas usam `/api/ors-proxy`, que depende de ORS_API_KEY no servidor Vercel.
- O deploy usa vercel.json e scripts/build-version.js. Um servidor estatico local nao executa a API Vercel.
- WhatsApp depende de um consumidor da fila. Validar qual projeto esse consumidor consulta antes de enviar mensagens.

## Sequencia de validacao

1. Preencher a configuracao real do App Web de nexta-outbound e validar as contas/perfis do Auth, dominios autorizados, regras e indices.
2. Reconciliar os 5 documentos divergentes e revisar os 88 ausentes conforme artifacts/firebase_outbound/COMPARACAO_ATUAL.md; reconsultar antes de escrever.
3. Validar login e leituras nas telas principais; depois executar gravacoes controladas, incluindo cadastros, disponibilidades, ciclos e simulacoes.
4. Confirmar Cloudinary, proxy de rotas e consumidor WhatsApp no destino.
5. Publicar apos validar o ambiente; as melhorias de estrutura ficam para a etapa seguinte.

Nao executar a interface como teste do Outbound enquanto ela ainda estiver configurada para nexta-frota: existem fluxos de escrita e exclusao.

## Verificacao desta etapa

Mapeamento estatico concluido. Node/npm nao estavam disponiveis no PATH, entao os testes Vitest nao foram executados. Login, regras, indices e integracoes ainda nao foram testados no destino.
