#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js is required'; exit 1; }
[ -f src/App.tsx ] || { echo 'Run this script from the family-voice project root.'; exit 1; }
node <<'JS'
const fs = require('fs');
const path = 'src/App.tsx';
let s = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const patches = [
  [
`  function createPeer() {
`,
`  function createPeer(answering = false) {
`
  ],
  [
`    // Negotiate a video m-line during the initial audio call. Later camera toggles
    // only replace the sender track, avoiding disruptive SDP renegotiation.
    const existingVideo = cameraStream.current?.getVideoTracks()[0];
    const videoTransceiver = existingVideo
      ? pc.addTransceiver(existingVideo, { direction: 'sendrecv' })
      : pc.addTransceiver('video', { direction: 'sendrecv' });
    videoSender.current = videoTransceiver.sender;
`,
`    // The offerer creates the video m-line. The answerer must reuse that
    // negotiated transceiver after setRemoteDescription, not create another.
    if (!answering) {
      const existingVideo = cameraStream.current?.getVideoTracks()[0];
      const videoTransceiver = existingVideo
        ? pc.addTransceiver(existingVideo, { direction: 'sendrecv' })
        : pc.addTransceiver('video', { direction: 'sendrecv' });
      videoSender.current = videoTransceiver.sender;
    }
`
  ],
  [
`    if (s.kind === 'offer') {
      const pc = createPeer();
      if (pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription(s.sdp);
      await flushIce(pc);
      await pc.setLocalDescription(await pc.createAnswer());
`,
`    if (s.kind === 'offer') {
      const pc = createPeer(true);
      if (pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription(s.sdp);
      // setRemoteDescription creates the matching video transceiver on the
      // answerer. Explicitly enable sending in the SDP answer.
      const videoTransceiver = pc.getTransceivers().find(t =>
        t.receiver.track.kind === 'video' &&
t.currentDirection !== 'stopped'
      );
      if (!videoTransceiver) throw new Error('Не удалось согласовать видеосвязь.');
      videoTransceiver.direction = 'sendrecv';
      videoSender.current = videoTransceiver.sender;
      const cameraTrack = cameraStream.current?.getVideoTracks()[0] ?? null;
      if (cameraTrack) await videoSender.current.replaceTrack(cameraTrack);
      await flushIce(pc);
      await pc.setLocalDescription(await pc.createAnswer());
`
  ]
];
let updated = 0;
for (const [before, after] of patches) {
  const count = s.split(before).length - 1;
  if (count !== 1) {
    console.error(`Patch mismatch: expected one occurrence, found ${count}. No files changed.`);
    process.exit(1);
  }
  s = s.replace(before, after);
  updated++;
}
fs.copyFileSync(path, 'src/App.tsx.before-direction-fix.bak');
fs.writeFileSync(path, s);
console.log(`Applied ${updated} patches. Backup: src/App.tsx.before-direction-fix.bak`);
JS
npm run build
echo 'Build successful. Review git diff, then git add src/App.tsx && git commit && git push.'
