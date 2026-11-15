import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jiti, load, root } from './support.mjs';

const postinstall = join(root, 'scripts', 'postinstall.mjs');
const defaults = readFileSync(join(root, 'radio.default.json'), 'utf8');

/** Run the postinstall with `env` added, from `cwd`; it must succeed. Returns its warnings. */
function runPostinstall(env, cwd) {
  const result = spawnSync(process.execPath, [postinstall], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stderr;
}

/** Run `body` with environment variables set, then put them back. */
async function withEnv(env, body) {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export default async function radioStations() {
  const { stationsFile, readStationsText, writeStationsText, parseStations, createRadio } = await load('features/radio.ts');
  const { getAgentDir } = await jiti.import('@earendil-works/pi-coding-agent');
  await import('node:fs/promises').then(fs => fs.mkdir(join(tmpdir(), 'pi'), { recursive: true }));
  const dir = await mkdtemp(join(tmpdir(), 'pi', 'pie-boy-radio-'));
  try {
    // The place: pie-boy/radio.json in Pi's agent directory.
    assert.equal(stationsFile(join(dir, 'a')), join(dir, 'a', 'pie-boy', 'radio.json'));
    await withEnv({ PI_CODING_AGENT_DIR: join(dir, 'b') }, () => assert.equal(stationsFile(), join(dir, 'b', 'pie-boy', 'radio.json')));

    // No file is an empty list, not an error; other errors are thrown.
    const missing = join(dir, 'none', 'pie-boy', 'radio.json');
    assert.equal(readStationsText(missing), undefined);
    assert.throws(() => readStationsText(dir), error => error.code !== 'ENOENT');

    // Writing makes the folder; writing a new list does not overwrite one made meanwhile.
    writeStationsText(missing, '[{"name":"A","playlist":"P"}]\n', true);
    assert.deepEqual(parseStations(readStationsText(missing)), [{ name: 'A', playlist: 'P' }]);
    assert.throws(() => writeStationsText(missing, '[]\n', true), error => error.code === 'EEXIST');
    writeStationsText(missing, '[]\n', false);
    assert.equal(readStationsText(missing), '[]\n');

    // RADIO with no file: an empty list and no error; adding a station makes the file.
    const radioAgent = join(dir, 'radio-agent');
    await withEnv({ PI_CODING_AGENT_DIR: radioAgent }, () => {
      const radio = createRadio();
      try {
        assert.deepEqual(radio.data.stations, []);
        assert.equal(radio.data.stationsError, undefined);
        radio.addPlaylist({ id: 'PL1', title: 'ONE', author: '', count: undefined });
        assert.equal(radio.data.saveError, undefined);
        assert.deepEqual(radio.data.stations, [{ name: 'ONE', playlist: 'PL1' }]);
        assert.deepEqual(JSON.parse(readFileSync(stationsFile(radioAgent), 'utf8')), [{ name: 'ONE', playlist: 'PL1' }]);
        radio.removeStation(radio.data.stations[0]);
        assert.deepEqual(radio.data.stations, []);
        assert.deepEqual(JSON.parse(readFileSync(stationsFile(radioAgent), 'utf8')), []);
      } finally {
        radio.dispose();
      }
    });

    // npm runs the postinstall.
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts?.postinstall, 'node scripts/postinstall.mjs');

    // postinstall puts the defaults once and leaves an existing file alone.
    const agent = join(dir, 'agent');
    const target = join(agent, 'pie-boy', 'radio.json');
    assert.equal(runPostinstall({ PI_CODING_AGENT_DIR: agent }, dir), '');
    assert.equal(readFileSync(target, 'utf8'), defaults);
    assert.deepEqual(JSON.parse(defaults), [
      { name: 'DIAMOND CITY RADIO', playlist: 'PLxprHD0XC6ct27PHzErvjgfExoHXaTr0s' },
      { name: 'CLASSICAL RADIO', playlist: 'PLoFLC-ZjkrXqnkKKL1HXmMaxnn3I83emj' },
    ]);
    writeFileSync(target, '[]\n');
    runPostinstall({ PI_CODING_AGENT_DIR: agent }, dir);
    assert.equal(readFileSync(target, 'utf8'), '[]\n');

    // The same place as Pi's getAgentDir for ~ and, on Windows, a shell-style path.
    const home = join(dir, 'home');
    mkdirSync(home);
    const homeEnv = { HOME: home, USERPROFILE: home };
    const cases = [['~/tilde-agent', homeEnv]];
    if (process.platform === 'win32') {
      const shell = join(dir, 'shell-agent').replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/');
      cases.push([shell, {}]);
    }
    for (const [value, extra] of cases) {
      runPostinstall({ PI_CODING_AGENT_DIR: value, ...extra }, dir);
      const expected = await withEnv({ PI_CODING_AGENT_DIR: value, ...extra }, () => stationsFile(getAgentDir()));
      assert.ok(expected.startsWith(dir), `${value} resolves inside the test folder: ${expected}`);
      assert.equal(readFileSync(expected, 'utf8'), defaults, value);
    }

    // A value that does not come out as a full absolute path: nothing is written, the install goes on.
    const rejected = ['relative-agent'];
    if (process.platform === 'win32') rejected.push('\\rooted-agent', '///x');
    for (const value of rejected) {
      const work = join(dir, 'work-' + rejected.indexOf(value));
      mkdirSync(work);
      const warning = runPostinstall({ PI_CODING_AGENT_DIR: value }, work);
      assert.match(warning, /not an absolute path/, value);
      assert.equal(existsSync(join(work, 'relative-agent')), false, value);
      // Nothing where Pi would read from this working directory either.
      const piPlace = await withEnv({ PI_CODING_AGENT_DIR: value }, () => stationsFile(getAgentDir()));
      if (!piPlace.startsWith('///')) assert.equal(existsSync(join(work, piPlace)) || existsSync(piPlace), false, value);
    }

    // A place that cannot be written: a warning, and the install goes on.
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, '');
    assert.match(runPostinstall({ PI_CODING_AGENT_DIR: blocked }, dir), /radio.json was not put in place/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log('radio station file and postinstall assertions passed');
}
