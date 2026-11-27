/**
 * Cloud Indic speech is the fallback after two failed browser attempts. It needs an API
 * key, and a key must never ship in a browser bundle, so the real call will go through a
 * server-side proxy added for the finale. In this prototype it only reports its status.
 */
export interface CloudSpeechStatus {
  available: false;
  message: string;
}

export function cloudSpeechStatus(): CloudSpeechStatus {
  return {
    available: false,
    message: 'Cloud Indic speech: key not set. The prototype uses the browser speech engine and the buttons.',
  };
}
