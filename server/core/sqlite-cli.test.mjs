import { describe, expect, it } from 'vitest';
import { sqlitePath } from './sqlite-cli.mjs';

describe('sqlite CLI path quoting', () => {
  it('quotes POSIX and Windows paths for SQL and dot commands', () => {
    expect(sqlitePath('/tmp/example.sqlite')).toBe("'/tmp/example.sqlite'");
    expect(sqlitePath("C:\\data\\user's.sqlite")).toBe("'C:/data/user''s.sqlite'");
  });
});
