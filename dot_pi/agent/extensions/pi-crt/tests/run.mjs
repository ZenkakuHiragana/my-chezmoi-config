await import('./context.mjs');
await import('./regressions.mjs');
await (await import('./panels.mjs')).default();
console.log('panel layout assertions passed');
