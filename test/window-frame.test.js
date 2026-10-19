import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeDocument } from './helpers/fakes.js';
import { SETTLE_MS, grabFrame } from '../src/window-frame.js';

function setup({ failPlay = false } = {}) {
  const doc = new FakeDocument();
  const stopped = [];
  const sleeps = [];
  const requests = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push('video') }] };
  const navigator = {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        requests.push(constraints);
        return stream;
      },
    },
  };
  const realCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const element = realCreate(tag);
    if (tag === 'video') {
      element.videoWidth = 1600;
      element.videoHeight = 900;
      element.play = async () => {
        if (failPlay) throw new Error('no stream');
      };
    }
    if (tag === 'canvas') element.toDataURL = (type) => `data:${type};base64,FRAME`;
    return element;
  };
  const run = () =>
    grabFrame({ navigator, document: doc, streamId: 'stream-1', sleep: async (ms) => sleeps.push(ms), ratio: 2 });
  return { doc, stream, stopped, sleeps, requests, run };
}

test('grabFrame takes one frame of the picked window and stops the stream', async () => {
  const { doc, stream, stopped, sleeps, requests, run } = setup();
  const frame = await run();
  assert.deepEqual(frame, { dataUrl: 'data:image/png;base64,FRAME', width: 1600, height: 900, ratio: 2 });
  assert.deepEqual(requests, [
    { audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'stream-1' } } },
  ]);
  const [video, canvas] = doc.created;
  assert.equal(video.srcObject, stream);
  assert.equal(video.muted, true);
  assert.deepEqual(sleeps, [SETTLE_MS], 'waits until the picker is gone from the window');
  assert.deepEqual(canvas.ctx.calls, [['drawImage', video, 0, 0]]);
  assert.deepEqual(stopped, ['video']);
});

test('grabFrame stops the stream when the frame cannot be taken', async () => {
  const { stopped, run } = setup({ failPlay: true });
  await assert.rejects(run(), /no stream/);
  assert.deepEqual(stopped, ['video']);
});
