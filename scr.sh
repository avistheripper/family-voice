#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f src/App.tsx ]]; then echo 'Run this from the family-voice project root.' >&2; exit 1; fi
if ! command -v node >/dev/null 2>&1; then echo 'Node.js is required.' >&2; exit 1; fi
node <<'JS'
const fs = require('fs');
const path = 'src/App.tsx';
let code = fs.readFileSync(path, 'utf8');
const replacements = [
  [
`      if (e.track.kind === 'video' && remoteVideo.current) {
        remoteVideo.current.srcObject = new MediaStream([e.track]);
        void remoteVideo.current.play().catch(() => {});
      }`,
`      if (e.track.kind === 'video') {
        const video = remoteVideo.current;
        if (video) {
          video.srcObject = new MediaStream([e.track]);
          // The remote video is muted because audio plays through the separate
          // <audio> element. This also helps iOS Safari autoplay video.
          video.muted = true;
          const resume = () => { void video.play().catch(error => console.warn('Remote video playback:', error)); };
          e.track.addEventListener('unmute', resume);
          video.addEventListener('loadedmetadata', resume, { once: true });
          resume();
        }
      }`
  ],
  [
`    if (localVideo.current) localVideo.current.srcObject = cameraOn ? cameraStream.current : null;
  }, [cameraOn]);`,
`    if (localVideo.current) localVideo.current.srcObject = cameraOn ? cameraStream.current : null;
  }, [cameraOn]);
  useEffect(() => {
    if (remoteCameraOn && remoteVideo.current) {
      void remoteVideo.current.play().catch(error => console.warn('Remote video playback:', error));
    }
  }, [remoteCameraOn]);`
  ],
  [
`<video ref={remoteVideo} autoPlay playsInline style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: remoteCameraOn ? 'block' : 'none' }} />`,
`<video ref={remoteVideo} autoPlay muted playsInline style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: '#1b2330' }} />`
  ],
  [
`{!remoteCameraOn && <div style={{ padding: 24, color: '#fff', textAlign: 'center' }}>Камера собеседника выключена</div>}`,
`{!remoteCameraOn && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, color: '#fff', textAlign: 'center', background: '#1b2330' }}>Камера собеседника выключена</div>}`
  ]
];
let changed = 0;
for (const [before, after] of replacements) {
  if (code.includes(after)) { console.log('Already patched one section.'); continue; }
  if (!code.includes(before)) { console.error('Expected code not found; stopping without changes:\n' + before.slice(0,120)); process.exit(1); }
  code = code.replace(before, after); changed++;
}
if (!changed) { console.log('Already patched.'); process.exit(0); }
fs.copyFileSync(path, 'src/App.tsx.before-video-fix.bak');
fs.writeFileSync(path, code);
console.log('Patched', changed, 'sections; backup saved.');
JS
npm run build
printf '\nBuild passed. Commit and push to deploy.\n'
