/** Records from the microphone with MediaRecorder. The result is processed (trimmed, evened out, converted to WAV) before upload. */
export interface Recording {
  /** Stops and resolves with what was recorded. Also called by itself after `maxSeconds`. */
  stop(): Promise<Blob>;
  readonly done: Promise<Blob>;
}

export async function startRecording(maxSeconds: number): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record. Use "Upload a file" instead.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); // release the microphone
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
  });
  const timer = setTimeout(() => {
    if (rec.state !== 'inactive') rec.stop();
  }, maxSeconds * 1000);
  rec.start();
  return {
    done,
    stop: () => {
      clearTimeout(timer);
      if (rec.state !== 'inactive') rec.stop();
      return done;
    },
  };
}
