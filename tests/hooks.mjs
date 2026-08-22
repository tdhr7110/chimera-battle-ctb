export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-zA-Z0-9]+$/.test(specifier.split('/').pop())) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}
