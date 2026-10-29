export async function installBrowserCompatibility(): Promise<void> {
  await Promise.all([
    'findLast' in Array.prototype ? undefined : import('core-js/actual/array/find-last.js'),
    CSS.supports('container-type', 'inline-size') ? undefined : import('container-query-polyfill'),
  ]);
}
