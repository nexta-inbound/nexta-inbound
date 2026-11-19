// Fluxo testavel de troca de sessao central por sessao Auth do Outbound.
export async function openOutboundSession({central, target, pilotAllowed}) {
  const person = await central.currentUser();
  if (!person) throw new Error('Entre pelo portal central para acessar o Outbound.');
  const registration = await central.registration();
  if (!registration || registration.ativo === false || registration.trocarSenha === true ||
      !pilotAllowed(person, registration) || registration.acessos?.outbound !== true) {
    throw new Error('Seu acesso ao Outbound ainda nao foi liberado. Fale com o administrador.');
  }
  let user = await target.currentUser();
  let valid = false;
  if (user) {
    const {claims} = await user.getIdTokenResult();
    valid = claims.central === true && claims.centralUid === person.uid;
  }
  if (!valid) {
    await target.signOut();
    const {token} = await central.call('entrarNoSistema', {sistema: 'outbound'});
    user = await target.signIn(token);
  }
  const {claims} = await user.getIdTokenResult();
  if (claims.central !== true || claims.centralUid !== person.uid) {
    await target.signOut();
    throw new Error('Token do Outbound nao corresponde ao login central.');
  }
  const profile = await target.profile(user.uid);
  // Perfis gravados pela tela de Usuarios do central (18/11/2026): administrador, interno ou transportador
  // (este sempre com a transportadora, que e' o que as regras do banco usam para separar os dados).
  const perfilValido = ['administrador', 'interno'].includes(profile?.perfil) ||
    (profile?.perfil === 'transportador' && typeof profile.transportadorNome === 'string' && !!profile.transportadorNome);
  if (!profile || profile.ativo !== true || profile.centralUid !== person.uid ||
      !perfilValido || typeof profile.idLegado !== 'string' || !profile.idLegado) {
    await target.signOut();
    throw new Error('Seu perfil no Outbound esta incompleto. Fale com o administrador.');
  }
  return {user, profile, centralUid: person.uid};
}
