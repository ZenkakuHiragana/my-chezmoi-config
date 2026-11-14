import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, root, theme, themeDir, themes } from './support.mjs';

/** Which themes leave the text colour to the terminal (pi-crt then does not set it). */
async function textOwnership(themeText) {
  assert.ok(themeText(theme), 'dark has a text colour');
  const pipboy = themes.loadThemeFromPath(join(root, '../../themes/pipboy-bright.json'), 'truecolor');
  assert.deepEqual(themeText(pipboy), { kind: 'rgb', r: 0x1b, g: 0xff, b: 0x80 });
  // A theme with "" as its text colour.
  const dark = JSON.parse(await readFile(join(themeDir, 'dark.json'), 'utf8'));
  dark.name = 'default-text';
  dark.colors.text = '';
  await mkdir(join(tmpdir(), 'pi'), { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), 'pi', 'crt-theme-'));
  try {
    const path = join(dir, 'default-text.json');
    await writeFile(path, JSON.stringify(dark), 'utf8');
    assert.equal(themeText(themes.loadThemeFromPath(path, 'truecolor')), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // The system theme on a terminal that reports a bright foreground (the colour pi-crt
  // set for pipboy-bright): body text is the terminal's own, so it is not set.
  themes.setTerminalColors({ foreground: { r: 0x1b, g: 0xff, b: 0x80 }, background: { r: 0x02, g: 0x0c, b: 0x06 } });
  assert.equal(themeText(themes.getThemeByName('system')), undefined);
  // A dark grey reported on a dark background: the system theme makes its own text colour.
  themes.setTerminalColors({ foreground: { r: 0x40, g: 0x40, b: 0x44 }, background: { r: 0x02, g: 0x0c, b: 0x06 } });
  assert.ok(themeText(themes.getThemeByName('system')));
}

export default async function foreground() {
  const { terminalForeground, themeText } = await load('shell/foreground.ts');
  await textOwnership(themeText);
  const writes = [];
  const terminal = { write: (data) => writes.push(data) };
  const exits = () => process.listenerCount('exit');
  const base = exits();
  const green = { kind: 'rgb', r: 0x1b, g: 0xff, b: 0x80 };

  // Nothing sent: release writes nothing.
  const idle = terminalForeground();
  idle.release(false);
  assert.deepEqual(writes, []);

  const fg = terminalForeground();
  fg.follow(terminal, green, 1);
  assert.deepEqual(writes, ['\x1b]10;rgb:1b/ff/80\x07']);
  assert.equal(exits(), base + 1, 'restores on exit when Pi skips session_shutdown');
  // Same colour on later frames: not sent again.
  fg.follow(terminal, { ...green }, 1);
  assert.equal(writes.length, 1);
  // A theme with another text colour: sent once.
  fg.follow(terminal, { kind: 'rgb', r: 1, g: 2, b: 254.6 }, 1);
  assert.equal(writes.at(-1), '\x1b]10;rgb:01/02/ff\x07');
  assert.equal(writes.length, 2);
  assert.equal(exits(), base + 1);
  // Pi drew the whole screen again (after Ctrl+Z or an external editor): sent again.
  fg.follow(terminal, { kind: 'rgb', r: 1, g: 2, b: 255 }, 2);
  assert.equal(writes.length, 3);
  assert.equal(writes.at(-1), '\x1b]10;rgb:01/02/ff\x07');
  fg.follow(terminal, { kind: 'rgb', r: 1, g: 2, b: 255 }, 2);
  assert.equal(writes.length, 3);
  // A real theme's text colour converts.
  fg.follow(terminal, theme.colors.text, 1);
  assert.match(writes.at(-1), /^\x1b\]10;rgb:[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\x07$/);

  fg.release(false);
  assert.equal(writes.at(-1), '\x1b]110\x07');
  assert.equal(exits(), base);
  const count = writes.length;
  fg.release(false);
  assert.equal(writes.length, count, 'released once');

  // A new instance (after /reload) sends again.
  const next = terminalForeground();
  next.follow(terminal, green, 0);
  assert.equal(writes.at(-1), '\x1b]10;rgb:1b/ff/80\x07');
  next.release(false);
  assert.equal(exits(), base);
  console.log('terminal foreground assertions passed');
}
