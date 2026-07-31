function requirePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) {
    const error = new Error('密码长度需要在 8 到 128 位之间');
    error.statusCode = 400;
    throw error;
  }
  return password;
}

function requireUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId < 1) {
    const error = new Error('无效的用户 ID');
    error.statusCode = 400;
    throw error;
  }
  return userId;
}

export async function handleAccountRoutes(req, res, {
  session,
  sendJson,
  readJsonBody,
  userAccountRepository,
  writeAuditEvent,
}) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (!pathname.startsWith('/api/users')) return false;

  if (pathname === '/api/users' && req.method === 'GET') {
    sendJson(res, {
      users: userAccountRepository.listAccounts({ includeDisabled: true }),
      invites: userAccountRepository.listInvites(),
      maxUsers: userAccountRepository.maxUsers,
      userCount: userAccountRepository.countAccounts(),
      canCreate: userAccountRepository.canCreateMember(),
    });
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, { error: 'Method not allowed' }, 405);
    return true;
  }

  const body = await readJsonBody(req);
  if (pathname === '/api/users/invites') {
    const invite = userAccountRepository.createInvite({
      createdByUserId: session.userId,
      displayName: body.displayName,
      expiresInHours: body.expiresInHours,
    });
    writeAuditEvent({ action: 'user_invite_created', req, actorRole: session.userRole || 'owner', detail: { expiresAt: invite.expiresAt } });
    sendJson(res, { ok: true, invite }, 201);
    return true;
  }

  if (pathname === '/api/users/invites/revoke') {
    const revoked = userAccountRepository.revokeInvite(requireUserId(body.inviteId));
    writeAuditEvent({ action: 'user_invite_revoked', req, actorRole: session.userRole || 'owner', detail: { inviteId: Number(body.inviteId), revoked } });
    sendJson(res, { ok: true, revoked });
    return true;
  }

  if (pathname === '/api/users/update') {
    if (body.status !== undefined && !['active', 'disabled'].includes(body.status)) {
      const error = new Error('无效的用户状态');
      error.statusCode = 400;
      throw error;
    }
    const account = userAccountRepository.updateAccount(requireUserId(body.userId), {
      displayName: body.displayName,
      status: body.status,
    });
    writeAuditEvent({ action: 'user_updated', req, actorRole: session.userRole || 'owner', detail: { userId: account.userId, status: account.status } });
    sendJson(res, { ok: true, account });
    return true;
  }

  if (pathname === '/api/users/reset-password') {
    userAccountRepository.resetPassword(requireUserId(body.userId), requirePassword(body.password));
    writeAuditEvent({ action: 'user_password_reset', req, actorRole: session.userRole || 'owner', detail: { userId: Number(body.userId) } });
    sendJson(res, { ok: true });
    return true;
  }

  if (pathname === '/api/users/revoke-sessions') {
    userAccountRepository.revokeSessions(requireUserId(body.userId));
    writeAuditEvent({ action: 'user_sessions_revoked', req, actorRole: session.userRole || 'owner', detail: { userId: Number(body.userId) } });
    sendJson(res, { ok: true });
    return true;
  }

  sendJson(res, { error: 'Not found' }, 404);
  return true;
}
