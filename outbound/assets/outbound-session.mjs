// Fluxo testavel de troca de sessao central por sessao Auth do Outbound.
export async function openOutboundSession({central, target, pilotAllowed}) {
  const person = await central.currentUser();
  if (!person) throw new Error('Entre pelo portal central para acessar o Outbound.');
  const registration = await central.registration();
  if (!registration || registration.ativo === false || registration.trocarSenha === true ||
      !pilotAllowed(person, registration) || registration.acessos?.outbound !== true) {
    throw new Error('Seu acesso ao piloto Outbound ainda nao foi provisionado.');
  }
  let user = await target.currentUser();
  let valid = false;
  if (user) {
    const {claims} = await user.getIdTokenResult();
    valid = claims.central === true && claims.centralUid === person.uid;
  }
  if (!valid) {
    await target.signOut();
    const {token} = await central.call('entrarNoOutbound', {});
    user = await target.signIn(token);
  }
  const {claims} = await user.getIdTokenResult();
  if (claims.central !== true || claims.centralUid !== person.uid) {
    await target.signOut();
    throw new Error('Token do Outbound nao corresponde ao login central.');
  }
  const profile = await target.profile(user.uid);
  if (!profile || profile.ativo !== true || profile.centralUid !== person.uid ||
      profile.perfil !== 'administrador' || typeof profile.idLegado !== 'string' || !profile.idLegado) {
    await target.signOut();
    throw new Error('Perfil do piloto Outbound incompleto ou sem vinculo com o cadastro.');
  }
  return {user, profile, centralUid: person.uid};
}
