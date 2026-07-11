import { exposeRuntime, runtime } from '../runtime-context.mjs';

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
            runtime.sendHtml(res, runtime.loginPage(runtime.lockMessage(locked.remainingMs)), 429);
            return;
        }
        const password = params.get('password');
        const role = password === runtime.appPassword ? 'write' : runtime.readOnlyPassword && password === runtime.readOnlyPassword ? 'read' : '';
        if (role) {
            runtime.recordLoginSuccess(clientIp);
            res.writeHead(302, {
                location: '/',
                'set-cookie': `${runtime.cookieName}=${encodeURIComponent(runtime.createSessionValue(role))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${runtime.secureCookie ? '; Secure' : ''}`,
            });
            res.end();
            return;
        }
        const attempt = runtime.recordLoginFailure(clientIp);
        await runtime.loginFailureDelay();
        if (attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
            runtime.sendHtml(res, runtime.loginPage(runtime.lockMessage(attempt.lockedUntil - Date.now())), 429);
            return;
        }
        const remainingAttempts = Math.max(0, runtime.loginFailureLimit - Number(attempt.failures || 0));
        runtime.sendHtml(res, runtime.loginPage(`密码不正确，请重试。剩余 ${remainingAttempts} 次后将锁定 30 分钟。`), 401);
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
        const sessionRole = runtime.getSessionRole(req.headers.cookie) || '';
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
                runtime.sendJson(res, { error: responseStatus >= 500 ? 'Server error' : error.message || 'Request failed' }, responseStatus);
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
    const pageSessionRole = runtime.getSessionRole(req.headers.cookie);
    if (!pageSessionRole) {
        runtime.sendHtml(res, runtime.loginPage());
        return;
    }
    runtime.recordVisitEvent(req, pageSessionRole);
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
