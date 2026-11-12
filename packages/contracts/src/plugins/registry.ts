/** Validate both symbolic names and wire names before any transport accepts requests. */
export function registerPluginMethods<
  const Core extends Readonly<Record<string, string>>,
  const Plugin extends Readonly<Record<string, string>>,
>(core: Core, plugin: Plugin) {
  const wireNames = new Set(Object.values(core));
  for (const [key, wireName] of Object.entries(plugin)) {
    if (Object.hasOwn(core, key) || wireNames.has(wireName)) {
      throw new Error(`Duplicate plugin RPC method: ${key} (${wireName})`);
    }
    wireNames.add(wireName);
  }
  return { ...core, ...plugin };
}
