import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createHttpUtils } from './http-utils.mjs';

describe('bounded JSON request bodies', () => {
  it('accepts a pairing-sized body at 64 KiB and rejects the next byte with 413', async () => {
    const { readJsonBody } = createHttpUtils({ jsonBodyMaxBytes: 10 * 1024 * 1024 });
    const acceptedRequest = new PassThrough();
    const accepted = readJsonBody(acceptedRequest, 64 * 1024);
    acceptedRequest.end(JSON.stringify({ code: 'a'.repeat(60_000) }));
    await expect(accepted).resolves.toMatchObject({ code: expect.any(String) });

    const oversizedRequest = new PassThrough();
    const oversized = readJsonBody(oversizedRequest, 64 * 1024);
    oversizedRequest.end(JSON.stringify({ code: 'a'.repeat(70_000) }));
    await expect(oversized).rejects.toMatchObject({ statusCode: 413 });
  });
});
