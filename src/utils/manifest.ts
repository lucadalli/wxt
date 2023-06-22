import { Entrypoint } from '..';
import { Manifest } from 'webextension-polyfill';
import {
  BackgroundEntrypoint,
  BuildOutput,
  ContentScriptEntrypoint,
  InternalConfig,
  OptionsEntrypoint,
  PopupEntrypoint,
} from '../types';
import fs from 'fs-extra';
import { resolve } from 'path';
import { getEntrypointBundlePath } from './entrypoints';

/**
 * Writes the manifest to the output directory.
 */
export async function writeManifest(
  manifest: Manifest.WebExtensionManifest,
  config: InternalConfig,
): Promise<void> {
  const str =
    config.mode === 'production'
      ? JSON.stringify(manifest)
      : JSON.stringify(manifest, null, 2);

  await fs.writeFile(resolve(config.outDir, 'manifest.json'), str, 'utf-8');
}

/**
 * Generates the manifest based on the config and entrypoints.
 */
export async function generateMainfest(
  entrypoints: Entrypoint[],
  buildOutput: BuildOutput,
  config: InternalConfig,
): Promise<Manifest.WebExtensionManifest> {
  const pkg = await getPackageJson();
  if (pkg.version == null)
    throw Error('package.json does not include a version');
  if (pkg.name == null) throw Error('package.json does not include a name');
  if (pkg.description == null)
    throw Error('package.json does not include a description');

  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: config.manifestVersion,
    name: pkg.name,
    short_name: pkg.shortName,
    version: simplifyVersion(pkg.version),
    version_name: pkg.version,
    ...config.manifest,
  };

  const entriesByType = entrypoints.reduce<
    Partial<Record<Entrypoint['type'], Entrypoint[]>>
  >((map, entrypoint) => {
    map[entrypoint.type] ??= [];
    map[entrypoint.type]?.push(entrypoint);
    return map;
  }, {});

  const background = entriesByType['background']?.[0] as
    | BackgroundEntrypoint
    | undefined;
  const bookmarks = entriesByType['bookmarks']?.[0];
  const contentScripts = entriesByType['content-script'] as
    | ContentScriptEntrypoint[]
    | undefined;
  const devtools = entriesByType['devtools']?.[0];
  const history = entriesByType['history']?.[0];
  const newtab = entriesByType['newtab']?.[0];
  const options = entriesByType['options']?.[0] as
    | OptionsEntrypoint
    | undefined;
  const popup = entriesByType['popup']?.[0] as PopupEntrypoint | undefined;
  const sandboxes = entriesByType['sandbox'];
  const sidepanels = entriesByType['sidepanel'];

  if (background) {
    const script = getEntrypointBundlePath(background, config.outDir, '.js');
    if (manifest.manifest_version === 3) {
      manifest.background = {
        ...background.options,
        service_worker: script,
      };
    } else {
      manifest.background = {
        ...background.options,
        scripts: [script],
      };
    }
  }

  if (bookmarks) {
    if (config.browser === 'firefox') {
      config.logger.warn(
        'Bookmarks are not supported by Firefox. chrome_url_overrides.bookmarks was not added to the manifest',
      );
    } else {
      manifest.chrome_url_overrides ??= {};
      // @ts-expect-error: bookmarks is untyped in webextension-polyfill, but supported by chrome
      manifest.chrome_url_overrides.bookmarks = getEntrypointBundlePath(
        bookmarks,
        config.outDir,
        '.html',
      );
    }
  }

  if (history) {
    if (config.browser === 'firefox') {
      config.logger.warn(
        'Bookmarks are not supported by Firefox. chrome_url_overrides.history was not added to the manifest',
      );
    } else {
      manifest.chrome_url_overrides ??= {};
      // @ts-expect-error: history is untyped in webextension-polyfill, but supported by chrome
      manifest.chrome_url_overrides.history = getEntrypointBundlePath(
        history,
        config.outDir,
        '.html',
      );
    }
  }

  if (newtab) {
    manifest.chrome_url_overrides ??= {};
    manifest.chrome_url_overrides.newtab = getEntrypointBundlePath(
      newtab,
      config.outDir,
      '.html',
    );
  }

  if (popup) {
    const default_popup = getEntrypointBundlePath(
      popup,
      config.outDir,
      '.html',
    );
    if (manifest.manifest_version === 3) {
      manifest.action = {
        ...popup.options,
        default_popup,
      };
    } else {
      manifest[popup.options.mv2Key ?? 'browser_action'] = {
        ...popup.options,
        default_popup,
      };
    }
  }

  if (devtools) {
    manifest.devtools_page = getEntrypointBundlePath(
      devtools,
      config.outDir,
      '.html',
    );
  }

  if (options) {
    const page = getEntrypointBundlePath(options, config.outDir, '.html');
    manifest.options_ui = {
      ...options.options,
      page,
    };
  }

  if (sandboxes?.length) {
    if (config.browser === 'firefox') {
      config.logger.warn(
        'Sandboxed pages not supported by Firefox. sandbox.pages was not added to the manifest',
      );
    } else {
      // @ts-expect-error: sandbox not typed
      manifest.sandbox = {
        pages: sandboxes.map((entry) =>
          getEntrypointBundlePath(entry, config.outDir, '.html'),
        ),
      };
    }
  }

  if (sidepanels?.length) {
    const defaultSidepanel =
      sidepanels.find((entry) => entry.name === 'sidepanel') ?? sidepanels[0];
    const page = getEntrypointBundlePath(
      defaultSidepanel,
      config.outDir,
      '.html',
    );

    if (config.browser === 'firefox') {
      manifest.sidebar_action = {
        // TODO: Add options to side panel
        // ...defaultSidepanel.options,
        default_panel: page,
      };
    } else if (config.browser === 'chromium' && config.manifestVersion === 3) {
      // @ts-expect-error: Untyped
      manifest.side_panel = {
        default_path: page,
      };
    } else if (config.browser === 'chromium') {
      config.logger.warn(
        'Side panel not supported by Chromium using MV2. side_panel.default_path was not added to the manifest',
      );
    }
  }

  if (contentScripts?.length) {
    const hashToEntrypointsMap = contentScripts.reduce<
      Record<string, ContentScriptEntrypoint[]>
    >((map, script) => {
      const hash = JSON.stringify(script.options);
      map[hash] ??= [];
      map[hash].push(script);
      return map;
    }, {});

    manifest.content_scripts = Object.entries(hashToEntrypointsMap).map(
      ([, scripts]) => ({
        ...scripts[0].options,
        css: getContentScriptCssFiles(scripts, buildOutput),
        js: scripts.map((entry) =>
          getEntrypointBundlePath(entry, config.outDir, '.js'),
        ),
      }),
    );
  }

  return manifest;
}

/**
 * Read the package.json from the current directory.
 *
 * TODO: look in root and up directories until it's found
 */
async function getPackageJson(): Promise<any> {
  return await fs.readJson('package.json');
}

/**
 * Removes suffixes from the version, like X.Y.Z-alpha1 (which brosers don't allow), so it's a
 * simple version number, like X or X.Y or X.Y.Z, which browsers allow.
 */
function simplifyVersion(versionName: string): string {
  // Regex adapted from here: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version#version_format

  const version = /^((0|[1-9][0-9]{0,8})([.](0|[1-9][0-9]{0,8})){0,3}).*$/.exec(
    versionName,
  )?.[1];

  if (version == null)
    throw Error(
      `Cannot simplify package.json version "${versionName}" to a valid extension version, "X.Y.Z"`,
    );

  return version;
}

/**
 * Returns the bundle paths to CSS files associated with a list of content scripts, or undefined if
 * there is no associated CSS.
 */
function getContentScriptCssFiles(
  contentScripts: ContentScriptEntrypoint[],
  buildOutput: BuildOutput,
): string[] | undefined {
  console.warn('TODO: getContentScriptCssFiles');
  return undefined;
}
