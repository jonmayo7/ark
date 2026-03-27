// ============================================================================
// Ark — Tools Tests
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, getNativeTools, NATIVE_TOOLS } from '../src/tools/index.js';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const registry = new ToolRegistry();
    const tools = getNativeTools(['file_read', 'shell']);
    for (const t of tools) registry.register(t);

    assert.equal(registry.list().length, 2);
    assert.ok(registry.get('file_read'));
    assert.ok(registry.get('shell'));
    assert.equal(registry.get('nonexistent'), undefined);
  });

  it('returns tool definitions', () => {
    const registry = new ToolRegistry();
    const tools = getNativeTools();
    for (const t of tools) registry.register(t);

    const defs = registry.getDefinitions();
    assert.ok(defs.length >= 7);
    for (const def of defs) {
      assert.ok(def.name);
      assert.ok(def.description);
      assert.ok(def.parameters);
    }
  });

  it('returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('nonexistent', {});
    assert.equal(result.is_error, true);
    assert.ok(result.content.includes('Unknown tool'));
  });
});

describe('Native Tools', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ark-tools-'));
    writeFileSync(join(tmpDir, 'hello.txt'), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
    writeFileSync(join(tmpDir, 'code.ts'), 'const x = 1;\nconst y = 2;\nconst z = x + y;\n');
    writeFileSync(join(tmpDir, 'unicode.txt'), 'Hello 🌍\nCafé\n日本語\n');
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  describe('file_read', () => {
    it('reads a file with line numbers', async () => {
      const result = await NATIVE_TOOLS.file_read.execute({ path: join(tmpDir, 'hello.txt') });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('Line 1'));
      assert.ok(result.content.includes('Line 5'));
    });

    it('supports offset and limit', async () => {
      const result = await NATIVE_TOOLS.file_read.execute({
        path: join(tmpDir, 'hello.txt'),
        offset: 2,
        limit: 2,
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('Line 2'));
      assert.ok(result.content.includes('Line 3'));
      assert.ok(!result.content.includes('Line 1'));
    });

    it('handles missing file', async () => {
      const result = await NATIVE_TOOLS.file_read.execute({ path: join(tmpDir, 'nope.txt') });
      assert.equal(result.is_error, true);
      assert.ok(result.content.includes('not found'));
    });

    it('handles unicode', async () => {
      const result = await NATIVE_TOOLS.file_read.execute({ path: join(tmpDir, 'unicode.txt') });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('🌍'));
      assert.ok(result.content.includes('Café'));
    });
  });

  describe('file_write', () => {
    it('writes a new file', async () => {
      const path = join(tmpDir, 'new.txt');
      const result = await NATIVE_TOOLS.file_write.execute({
        path,
        content: 'Hello, Ark!',
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('Written'));
      assert.equal(readFileSync(path, 'utf-8'), 'Hello, Ark!');
    });

    it('creates parent directories', async () => {
      const path = join(tmpDir, 'deep', 'nested', 'file.txt');
      const result = await NATIVE_TOOLS.file_write.execute({
        path,
        content: 'Deep write',
      });
      assert.equal(result.is_error, false);
      assert.equal(readFileSync(path, 'utf-8'), 'Deep write');
    });

    it('overwrites existing file', async () => {
      const path = join(tmpDir, 'overwrite.txt');
      writeFileSync(path, 'old content');
      const result = await NATIVE_TOOLS.file_write.execute({
        path,
        content: 'new content',
      });
      assert.equal(result.is_error, false);
      assert.equal(readFileSync(path, 'utf-8'), 'new content');
    });
  });

  describe('file_edit', () => {
    it('replaces a unique string', async () => {
      const path = join(tmpDir, 'edit-target.txt');
      writeFileSync(path, 'foo bar baz');
      const result = await NATIVE_TOOLS.file_edit.execute({
        path,
        old_string: 'bar',
        new_string: 'qux',
      });
      assert.equal(result.is_error, false);
      assert.equal(readFileSync(path, 'utf-8'), 'foo qux baz');
    });

    it('errors on ambiguous match', async () => {
      const path = join(tmpDir, 'multi.txt');
      writeFileSync(path, 'aaa bbb aaa');
      const result = await NATIVE_TOOLS.file_edit.execute({
        path,
        old_string: 'aaa',
        new_string: 'ccc',
      });
      assert.equal(result.is_error, true);
      assert.ok(result.content.includes('2 occurrences'));
    });

    it('replace_all works', async () => {
      const path = join(tmpDir, 'multi2.txt');
      writeFileSync(path, 'aaa bbb aaa');
      const result = await NATIVE_TOOLS.file_edit.execute({
        path,
        old_string: 'aaa',
        new_string: 'ccc',
        replace_all: true,
      });
      assert.equal(result.is_error, false);
      assert.equal(readFileSync(path, 'utf-8'), 'ccc bbb ccc');
    });

    it('errors on missing string', async () => {
      const path = join(tmpDir, 'edit-target.txt');
      const result = await NATIVE_TOOLS.file_edit.execute({
        path,
        old_string: 'nonexistent',
        new_string: 'replacement',
      });
      assert.equal(result.is_error, true);
      assert.ok(result.content.includes('not found'));
    });
  });

  describe('shell', () => {
    it('executes a command', async () => {
      const result = await NATIVE_TOOLS.shell.execute({ command: 'echo "hello ark"' });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('hello ark'));
    });

    it('captures exit codes on failure', async () => {
      const result = await NATIVE_TOOLS.shell.execute({ command: 'exit 42' });
      assert.equal(result.is_error, true);
    });

    it('supports cwd', async () => {
      const result = await NATIVE_TOOLS.shell.execute({
        command: 'pwd',
        cwd: tmpDir,
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes(tmpDir) || result.content.includes('/private'));
    });
  });

  describe('glob', () => {
    it('finds files by pattern', async () => {
      const result = await NATIVE_TOOLS.glob.execute({
        pattern: '*.txt',
        path: tmpDir,
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('hello.txt'));
      assert.ok(result.content.includes('unicode.txt'));
    });

    it('finds TypeScript files', async () => {
      const result = await NATIVE_TOOLS.glob.execute({
        pattern: '**/*.ts',
        path: tmpDir,
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('code.ts'));
    });

    it('returns empty for no matches', async () => {
      const result = await NATIVE_TOOLS.glob.execute({
        pattern: '*.xyz',
        path: tmpDir,
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('No files found'));
    });
  });

  describe('grep', () => {
    it('finds files containing pattern', async () => {
      const result = await NATIVE_TOOLS.grep.execute({
        pattern: 'const',
        path: tmpDir,
        mode: 'files',
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('code.ts'));
    });

    it('shows matching content', async () => {
      const result = await NATIVE_TOOLS.grep.execute({
        pattern: 'Line [0-9]',
        path: tmpDir,
        mode: 'content',
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('Line 1'));
    });

    it('handles no matches', async () => {
      const result = await NATIVE_TOOLS.grep.execute({
        pattern: 'zzzznonexistent',
        path: tmpDir,
      });
      assert.equal(result.is_error, false);
      assert.ok(result.content.includes('No matches'));
    });
  });

  describe('http_fetch', () => {
    it('fetches a URL', async () => {
      // Use a reliable endpoint
      const result = await NATIVE_TOOLS.http_fetch.execute({
        url: 'https://httpbin.org/get',
        timeout: 10000,
      });
      // May fail if no internet, that's ok
      if (!result.is_error) {
        assert.ok(result.content.includes('HTTP 200'));
      }
    });

    it('handles invalid URLs', async () => {
      const result = await NATIVE_TOOLS.http_fetch.execute({
        url: 'http://localhost:99999/nonexistent',
        timeout: 3000,
      });
      assert.equal(result.is_error, true);
    });
  });
});
