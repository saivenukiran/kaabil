// The public surface of @kaabil/core: pure logic with no browser, clock or storage in it.
// Any app (web today, a phone app at the finale) imports from here and nowhere deeper.
export * from './types';
export * from './time';
export * from './i18n/language';
export * from './i18n/languages';
export * from './i18n/messages';
export * from './i18n/packs';
export * from './voice/words';
export * from './voice/voiceReport';
export * from './dose/dialogue';
export * from './dose/engine';
export * from './dose/medicineParser';
export * from './dose/scenarios';
