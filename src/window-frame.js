/** Time for the picker dialog to disappear from the captured window before the frame is taken. */
export const SETTLE_MS = 300;

/**
 * Grabs one frame of the window or screen the user picked in Chrome's desktop capture dialog and stops the stream.
 * Resolves with `{ dataUrl, width, height, ratio }`: a PNG in device pixels and the device pixels per CSS pixel.
 */
export async function grabFrame({ navigator, document, streamId, sleep, ratio }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } },
  });
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await sleep(SETTLE_MS);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, ratio };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
