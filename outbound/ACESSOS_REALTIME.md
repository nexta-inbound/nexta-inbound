# Contrato inicial de acesso Realtime

Etapa de 16/11/2026. Nenhuma regra, conta ou dado remoto foi alterado.

## Identidade e piloto

- `perfis/{uidAuthOutbound}` guarda nome, perfil, ativo e centralUid. Perfil de transportador tambem exige transportadorId, definido a partir do cadastro reconciliado.
- O UID no caminho e do Firebase Auth de nexta-outbound. Nao usar login antigo, email ou UID central nesse lugar por suposicao.
- O backend central deve conferir acessos/outbound e emitir token do destino com claims central=true e centralUid.
- `liberacoesPiloto/{uidAuthOutbound}=true` e provisionado somente por backend administrativo, inicialmente apenas para Amanda.
- Nenhum cliente pode alterar perfil ou lista do piloto.

## Pessoas confirmadas no plano

| Pessoa | Conta | Papel pretendido |
| --- | --- | --- |
| Amanda | amanda.borges@nexta.com.br | Administrador |
| Matheus Sanches | matheus.sanches@nexta.com.br | Administrador |
| Arley Honorio | arley.honorio@nexta.com.br | Interno; somente Outbound no central |
| Natanael | natanael.pires@nexta.com.br | Interno; somente Outbound; sem vinculo com Sadi |

Outros administradores encontrados no legado exigem revisao antes de conceder privilegio. Nenhum acesso central existente sera removido automaticamente com base apenas no plano de migracao.

## Rascunho de regras

`preparar_regras_piloto.py` gera `database.piloto.rules.json` para validar a primeira leitura de dados. Exige conta ativa, perfil vinculado ao mesmo centralUid do token e liberacao individual do piloto.

- Raiz fechada; leitura somente dos caminhos explicitamente permitidos.
- Dados operacionais acessiveis somente ao piloto interno/administrador; configuracoesLegadas somente ao administrador.
- Todas as escritas de cliente bloqueadas nesta primeira etapa, inclusive pelo administrador.
- Transportadores permanecem sem leitura operacional neste rascunho: acesso por transportadora depende da estrutura segregada e dos testes de autorizacao, nao de filtros feitos no navegador.
- Indices simples propostos nao substituem os filtros compostos do Firestore; o adaptador deve usar indices derivados ou consultas adequadas, sem baixar dados de outras transportadoras.

Nao publicar este rascunho como regras finais. Faltam testes no emulador, adaptador, contrato de gravacao e autorizacao por transportadora. A aplicacao completa permanece bloqueada.

## Bloqueio administrativo confirmado

Atualizacao: a nova credencial de nexta-outbound foi encontrada e validada. Leitura das regras passou (raiz com read=false e write=false); configuracao publica do App Web foi obtida e aplicada localmente. A credencial administrativa do projeto central nexta-logistica continua pendente para publicar a integracao SSO e provisionar os vinculos centrais.

## Leitor Realtime em desenvolvimento

- realtime-codec.mjs reconstroi o contrato de envelopes `{existe, dados, formatos}` gerado no arquivo alternativo carga_piloto_envelopes.json. Nao misturar com o payload anterior sem envelopes.
- realtime-query.mjs cobre filtros escalares ==, in, <, <=, > e >=, ordenacao e limite. Valores ausentes sao distinguidos de null.
- realtime-reader.mjs recebe o SDK e uma verificacao de acesso, fornece snapshots e colecoes somente para perfis internos/administradores autorizados. Registra listeners com cancelamento e revalidacao antes de entregar cada evento. Nao escreve.
- realtime-writer.mjs prepara gravacoes individuais por transacao, inclusive merge e exclusao. Exige administrador e writesEnabled=true explicito; fica desligado por padrao. Nao implementa batches multi-registro nem esta ligado a interface.
- Para este piloto, getDocs le uma colecao inteira autorizada e aplica filtros em memoria. Nao liberar transportadores com esse mecanismo; eles precisam de acesso segregado no servidor.
- Validacao cruzada: os 5.636 documentos convertidos em Python foram reconstruidos em JavaScript e comparados integralmente com o snapshot. Doze testes JavaScript cobrem codec, consultas, listeners e transacoes com SDK simulado.
- Modulos ainda nao conectados ao app principal: faltam consultas no SDK real, batches atomicos, regras no emulador e SSO. ADAPTADOR_REALTIME_PRONTO permanece false. Nao houve carga, publicacao de regras ou alteracao de contas nesta etapa.

Em 16/11/2026, a credencial nexta-frota disponivel retornou HTTP 401 ao consultar regras do Realtime Outbound e INSUFFICIENT_PERMISSION ao consultar contas Auth do destino. A URL foi confirmada pela Amanda; permissao administrativa nao foi obtida.

Para aplicar a migracao, um administrador precisa disponibilizar uma credencial autorizada do nexta-outbound em arquivo local (nunca colar chave privada no chat) ou executar os passos administrativos no console. O cadastro Web firebaseConfig ainda precisa ser fornecido; nao e uma credencial administrativa.
