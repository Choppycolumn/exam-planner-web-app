import { pathToFileURL } from 'node:url';

let input = '';
for await (const chunk of process.stdin) input += chunk.toString('utf8');

try {
  const payload = JSON.parse(input);
  const module = await import(pathToFileURL(payload.modulePath).href);
  const result = await module.sendMessageWeixin({
    to: payload.to,
    text: payload.text,
    opts: {
      baseUrl: payload.baseUrl,
      token: payload.token,
      contextToken: payload.contextToken,
      timeoutMs: 20_000,
    },
  });
  process.stdout.write(JSON.stringify({ messageId: result?.messageId || null }));
} catch (error) {
  process.stderr.write(error?.message || String(error));
  process.exitCode = 1;
}
