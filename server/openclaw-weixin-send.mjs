import { pathToFileURL } from 'node:url';

let input = '';
for await (const chunk of process.stdin) input += chunk.toString('utf8');

try {
  const payload = JSON.parse(input);
  const originalFetch = globalThis.fetch;
  let sendResponse = null;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const requestUrl = String(args[0] || '');
    if (requestUrl.includes('/ilink/bot/sendmessage')) {
      const rawText = await response.clone().text();
      try {
        sendResponse = JSON.parse(rawText);
      } catch {
        sendResponse = rawText ? { raw: rawText.slice(0, 200) } : {};
      }
      const businessCode = Number(sendResponse?.ret ?? sendResponse?.code ?? 0);
      if (response.ok && businessCode !== 0) {
        if (businessCode === -2) {
          throw new Error('Weixin proactive send blocked (ret=-2); send any message to the bot to refresh the active conversation');
        }
        throw new Error(`Weixin send rejected with business code ${businessCode}`);
      }
    }
    return response;
  };
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
  process.stdout.write(JSON.stringify({
    messageId: result?.messageId || null,
    businessCode: Number(sendResponse?.ret ?? sendResponse?.code ?? 0),
  }));
} catch (error) {
  process.stderr.write(error?.message || String(error));
  process.exitCode = 1;
}
