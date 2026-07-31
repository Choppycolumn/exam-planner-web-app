import { apiErrorPayload } from '../../http/api-contract-validation.mjs';

export function installBootstrapDomain(runtime, exposeRuntime) {
    runtime.validateStartupConfig();
    try {
        runtime.ensureSqliteStore();
        runtime.startupReady = true;
    }
    catch (error) {
        runtime.startupError = runtime.redactSecretText(error.message || String(error));
        runtime.logStructured('error', 'startup_store_initialization_failed', { error: runtime.startupError });
        throw error;
    }
    const renderLoginPage = (error = '') => runtime.loginPage(error, {
        accounts: runtime.userAccountRepository.listAccounts(),
        canRegister: runtime.userAccountRepository.canCreateMember(),
        maxUsers: runtime.userAccountRepository.maxUsers,
        userCount: runtime.userAccountRepository.countAccounts(),
        readOnlyAvailable: Boolean(runtime.readOnlyPassword),
    });
    const requestHandler = async (req, res) => {
        if (runtime.shuttingDown) {
            res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'connection': 'close' });
            res.end('server shutting down');
            return;
        }
        if (req.url === '/login' && req.method === 'POST') {
            const clientIp = runtime.getClientIp(req);
            const params = new URLSearchParams(await runtime.readBody(req));
            const locked = runtime.getLoginLock(clientIp);
            if (locked) {
                await runtime.loginFailureDelay();
                runtime.sendHtml(res, renderLoginPage(runtime.lockMessage(locked.remainingMs)), 429);
                return;
            }
            const password = String(params.get('password') || '');
            const accountId = String(params.get('accountId') || '');
            let session = null;
            if (accountId === 'visitor' && runtime.readOnlyPassword && runtime.safeSecretEqual(password, runtime.readOnlyPassword)) {
                const owner = runtime.userAccountRepository.listAccounts().find((account) => account.userRole === 'owner');
                session = {
                    role: 'read', userId: runtime.userAccountRepository.getOwnerUserId(), publicId: owner?.publicId || '',
                    accountType: 'visitor', displayName: '访客', sessionVersion: owner?.sessionVersion || 1,
                    capabilities: runtime.defaultCapabilitiesForRole('visitor'),
                };
            }
            else if (accountId) {
                session = runtime.userAccountRepository.authenticateAccount(accountId, password);
            }
            else {
                const owner = runtime.userAccountRepository.listAccounts().find((account) => account.userRole === 'owner');
                if (runtime.safeSecretEqual(password, runtime.appPassword)) session = owner;
                else if (runtime.readOnlyPassword && runtime.safeSecretEqual(password, runtime.readOnlyPassword)) {
                    session = {
                        role: 'read', userId: runtime.userAccountRepository.getOwnerUserId(), publicId: owner?.publicId || '',
                        accountType: 'visitor', displayName: '访客', sessionVersion: owner?.sessionVersion || 1,
                        capabilities: runtime.defaultCapabilitiesForRole('visitor'),
                    };
                }
                else session = runtime.userAccountRepository.authenticateLearner(password);
            }
            if (session) {
                runtime.recordLoginSuccess(clientIp);
                res.writeHead(302, {
                    location: '/',
                    'set-cookie': `${runtime.cookieName}=${encodeURIComponent(runtime.createSessionValue(session, { clientHash: runtime.clientHashForRequest(req) }))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${runtime.secureCookie ? '; Secure' : ''}`,
                });
                res.end();
                return;
            }
            const attempt = runtime.recordLoginFailure(clientIp);
            await runtime.loginFailureDelay();
            if (attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
                runtime.sendHtml(res, renderLoginPage(runtime.lockMessage(attempt.lockedUntil - Date.now())), 429);
                return;
            }
            const remainingAttempts = Math.max(0, runtime.loginFailureLimit - Number(attempt.failures || 0));
            runtime.sendHtml(res, renderLoginPage(`密码不正确，请重试。剩余 ${remainingAttempts} 次后将锁定 30 分钟。`), 401);
            return;
        }
        if (req.url === '/register-invite' && req.method === 'POST') {
            const clientIp = runtime.getClientIp(req);
            const locked = runtime.getLoginLock(clientIp);
            if (locked) {
                await runtime.loginFailureDelay();
                runtime.sendHtml(res, renderLoginPage(runtime.lockMessage(locked.remainingMs)), 429);
                return;
            }
            const params = new URLSearchParams(await runtime.readBody(req));
            const inviteToken = String(params.get('inviteToken') || '');
            const displayName = String(params.get('displayName') || '');
            const password = String(params.get('password') || '');
            const confirmation = String(params.get('confirmPassword') || '');
            let errorMessage = '';
            if (!runtime.userAccountRepository.canCreateMember())
                errorMessage = '用户席位已满，不能继续新增用户。';
            else if (!inviteToken)
                errorMessage = '请输入管理员生成的邀请码。';
            else if (!displayName.trim())
                errorMessage = '请输入显示名称。';
            else if (password.length < 8 || password.length > 128)
                errorMessage = '密码长度需要在 8 到 128 位之间。';
            else if (password !== confirmation)
                errorMessage = '两次输入的密码不一致。';
            else if (runtime.safeSecretEqual(password, runtime.appPassword) || (runtime.readOnlyPassword && runtime.safeSecretEqual(password, runtime.readOnlyPassword)))
                errorMessage = '该密码已被其他访问身份使用，请更换一个密码。';
            if (errorMessage) {
                const attempt = runtime.recordLoginFailure(clientIp);
                await runtime.loginFailureDelay();
                const status = attempt.lockedUntil && attempt.lockedUntil > Date.now() ? 429 : 400;
                runtime.sendHtml(res, renderLoginPage(status === 429 ? runtime.lockMessage(attempt.lockedUntil - Date.now()) : errorMessage), status);
                return;
            }
            try {
                const learner = runtime.userAccountRepository.consumeInvite({ token: inviteToken, password, displayName });
                runtime.recordLoginSuccess(clientIp);
                runtime.tableChanged();
                res.writeHead(302, {
                    location: '/',
                    'set-cookie': `${runtime.cookieName}=${encodeURIComponent(runtime.createSessionValue(learner, { clientHash: runtime.clientHashForRequest(req) }))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${runtime.secureCookie ? '; Secure' : ''}`,
                });
                res.end();
            }
            catch (error) {
                const status = error?.code === 'USER_LIMIT_REACHED' ? 409 : ['PASSWORD_IN_USE', 'INVALID_INVITE'].includes(error?.code) ? 400 : 500;
                const message = error?.code === 'USER_LIMIT_REACHED'
                    ? '用户席位已满，不能继续新增用户。'
                    : error?.code === 'PASSWORD_IN_USE'
                        ? '该密码已被其他学习用户使用，请更换一个密码。'
                        : error?.code === 'INVALID_INVITE'
                            ? '邀请码无效、已使用或已过期。'
                        : '创建用户失败，请稍后重试。';
                runtime.sendHtml(res, renderLoginPage(message), status);
            }
            return;
        }
        if (req.url === '/logout' && req.method === 'POST') {
            runtime.revokeSession(req.headers.cookie);
            res.writeHead(302, {
                location: '/',
                'set-cookie': `${runtime.cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${runtime.secureCookie ? '; Secure' : ''}`,
            });
            res.end();
            return;
        }
        if (req.url?.startsWith('/health')) {
            const requestUrl = new URL(req.url || '/health', 'http://localhost');
            if (requestUrl.searchParams.get('full') === '1') {
                const payload = runtime.getHealthPayload();
                runtime.sendJson(res, payload, payload.ok ? 200 : 503);
                return;
            }
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('ok');
            return;
        }
        if (req.url?.startsWith('/ready')) {
            const payload = runtime.getReadinessPayload();
            runtime.sendJson(res, payload, payload.ok ? 200 : 503);
            return;
        }
        if (req.url?.startsWith('/api/')) {
            const startedAt = Date.now();
            const requestId = runtime.randomBytes(8).toString('hex');
            res.setHeader('x-request-id', requestId);
            const activeSession = runtime.getSession(req.headers.cookie);
            const sessionRole = activeSession?.role || '';
            let statusCode = 200;
            const originalWriteHead = res.writeHead.bind(res);
            res.writeHead = (status, ...args) => {
                statusCode = Number(status) || statusCode;
                return originalWriteHead(status, ...args);
            };
            try {
                await runtime.handleApi(req, res);
            }
            catch (error) {
                runtime.logStructured('error', 'api_error', {
                    method: req.method,
                    path: new URL(req.url || '/', 'http://localhost').pathname,
                    error: runtime.redactSecretText(error.message || String(error)),
                });
                if (!res.headersSent) {
                    statusCode = error.statusCode || 500;
                    const responseStatus = error.statusCode || 500;
                    runtime.sendJson(res, apiErrorPayload(error, requestId), responseStatus);
                }
                else {
                    res.end();
                }
            }
            finally {
                const durationMs = Date.now() - startedAt;
                runtime.writeApiRequestLog({ req, statusCode, durationMs, role: sessionRole });
                if (durationMs >= runtime.requestLogSlowMs) {
                    runtime.logStructured('warn', 'slow_api_request', {
                        method: req.method,
                        path: new URL(req.url || '/', 'http://localhost').pathname,
                        statusCode,
                        durationMs,
                    });
                }
            }
            return;
        }
        const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
        if (['/manifest.webmanifest', '/service-worker.js', '/app-icon.svg', '/favicon.svg', '/icons.svg'].includes(requestPath)) {
            runtime.serveStatic(req, res);
            return;
        }
        const pageSession = runtime.getSession(req.headers.cookie);
        if (!pageSession) {
            if (requestPath.startsWith('/assets/')) {
                res.writeHead(401, {
                    'content-type': 'text/plain; charset=utf-8',
                    'cache-control': 'no-store',
                    'x-content-type-options': 'nosniff',
                });
                res.end('Authentication required');
                return;
            }
            runtime.sendHtml(res, renderLoginPage());
            return;
        }
        runtime.recordVisitEvent(req, `${pageSession.role}:${pageSession.accountType}`);
        runtime.serveStatic(req, res);
    };
    const safeRequestHandler = (req, res) => {
        void requestHandler(req, res).catch((error) => {
            runtime.logStructured('error', 'request_handler_failed', {
                method: req.method,
                path: (() => {
                    try {
                        return new URL(req.url || '/', 'http://localhost').pathname;
                    }
                    catch {
                        return '/';
                    }
                })(),
                error: runtime.redactSecretText(error.message || String(error)),
            });
            if (!res.headersSent)
                runtime.sendJson(res, { error: 'Server error' }, 500);
            else
                res.end();
        });
    };
    const httpServer = runtime.httpEnabled ? runtime.createServer(safeRequestHandler).listen(runtime.port, '127.0.0.1', () => {
        runtime.logStructured('info', 'server_started', { url: `http://127.0.0.1:${runtime.port}`, config: runtime.getAppConfigSnapshot() });
    })
        : null;
    if (!runtime.httpEnabled) {
        runtime.workerKeepAliveTimer = runtime.scheduler.scheduleInterval(
            'worker-keep-alive',
            60 * 1000,
            () => {},
            { keepAlive: true },
        );
        runtime.logStructured('info', 'background_worker_started', { config: runtime.getAppConfigSnapshot() });
    }
    function shutdown(signal) {
        if (runtime.shuttingDown)
            return;
        runtime.shuttingDown = true;
        runtime.logStructured('info', 'server_shutdown_started', { signal });
        runtime.scheduler.stopAll();
        const finish = () => {
            runtime.logStructured('info', 'server_shutdown_completed', { signal });
            process.exit(0);
        };
        if (httpServer)
            httpServer.close(finish);
        else
            finish();
        setTimeout(() => {
            runtime.logStructured('error', 'server_shutdown_forced', { signal });
            process.exit(1);
        }, 10000).unref();
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
        runtime.logStructured('error', 'uncaught_exception', { error: runtime.redactSecretText(error?.stack || error?.message || String(error)) });
        process.exit(1);
    });
    process.on('unhandledRejection', (error) => {
        runtime.logStructured('error', 'unhandled_rejection', { error: runtime.redactSecretText(error?.stack || error?.message || String(error)) });
        process.exit(1);
    });

    exposeRuntime({ "requestHandler": () => requestHandler, "safeRequestHandler": () => safeRequestHandler, "httpServer": () => httpServer, "shutdown": () => shutdown }, {  });
}
