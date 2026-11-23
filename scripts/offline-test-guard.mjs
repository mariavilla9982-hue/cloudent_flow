const originalFetch=globalThis.fetch;
globalThis.fetch=(input,...args)=>{
 const url=String(input?.url||input);
 if(/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url))return originalFetch(input,...args);
 throw Error('Unmocked external network is disabled in offline regressions.');
};
