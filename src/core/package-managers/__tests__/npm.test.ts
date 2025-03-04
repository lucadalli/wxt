import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { npm } from '../npm';
import { execaCommand } from 'execa';
import { exists } from 'fs-extra';

const cwd = path.resolve(__dirname, 'fixtures/npm-project');

describe(
  'NPM Package Management Utils',
  () => {
    beforeAll(async () => {
      // NPM needs the modules installed for 'npm ls' to work
      await execaCommand('npm i', { cwd });
    });

    describe('listDependencies', () => {
      it('should list direct dependencies', async () => {
        const actual = await npm.listDependencies({ cwd });
        expect(actual).toEqual([
          { name: 'flatten', version: '1.0.3' },
          { name: 'mime-types', version: '2.1.35' },
        ]);
      });

      it('should list all dependencies', async () => {
        const actual = await npm.listDependencies({ cwd, all: true });
        expect(actual).toEqual([
          { name: 'flatten', version: '1.0.3' },
          { name: 'mime-types', version: '2.1.35' },
          { name: 'mime-db', version: '1.52.0' },
        ]);
      });
    });

    describe('downloadDependency', () => {
      it('should download the dependency as a tarball', async () => {
        const downloadDir = path.resolve(cwd, 'dist');
        const id = 'mime-db@1.52.0';
        const expected = path.resolve(downloadDir, 'mime-db-1.52.0.tgz');

        const actual = await npm.downloadDependency(id, downloadDir);

        expect(actual).toEqual(expected);
        expect(await exists(actual)).toBe(true);
      });
    });
  },
  { timeout: 20e3 },
);
