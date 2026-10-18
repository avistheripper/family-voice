import { useEffect, useRef, useState } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = url && key ? createClient(url, key) : null;
const roomFromUrl = new URLSearchParams(location.search).get('room') ?? '';
const sessionId = crypto.randomUUID();
type Signal = { kind: 'offer'; sdp: RTCSessionDescriptionInit } | { kind: 'answer'; sdp: RTCSessionDescriptionInit } | { kind: 'ice'; candidate: RTCIceCandidateInit } | { kind: 'camera'; enabled: boolean };
type Wire = { sender: string; signal: Signal };
type Member = { id: string; joined: number };
type Phase = 'idle' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'error';

export default function App() {
  const [room, setRoom] = useState(roomFromUrl);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [remoteCameraOn, setRemoteCameraOn] = useState(false);
  const channel = useRef<RealtimeChannel | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const videoSender = useRef<RTCRtpSender | null>(null);
  const cameraRequest = useRef(0);
  const cameraBusyRef = useRef(false);
  const remoteId = useRef<string | null>(null);
  const makingOffer = useRef(false);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const currentRoom = useRef('');
  const live = useRef(false);

  function closePeer() {
    peer.current?.close(); peer.current = null;
    if (audio.current) audio.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    videoSender.current = null;
    setRemoteCameraOn(false);
    pendingIce.current = []; makingOffer.current = false;
  }
  function cleanup() {
    live.current = false;
    cameraRequest.current += 1;
    cameraBusyRef.current = false;
    cameraStream.current?.getTracks().forEach(t => t.stop());
    cameraStream.current = null;
    setCameraOn(false); setCameraBusy(false);
    closePeer();
    local.current?.getTracks().forEach(t => t.stop()); local.current = null;
    if (channel.current && supabase) void supabase.removeChannel(channel.current);
    channel.current = null; remoteId.current = null; currentRoom.current = '';
  }
  useEffect(() => () => cleanup(), []);
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = cameraOn ? cameraStream.current : null;
  }, [cameraOn]);
  useEffect(() => {
    if (remoteCameraOn && remoteVideo.current) {
      void remoteVideo.current.play().catch(error => console.warn('Remote video playback:', error));
    }
  }, [remoteCameraOn]);

  async function send(signal: Signal) {
    if (!channel.current) return;
    const result = await channel.current.send({ type: 'broadcast', event: 'signal', payload: { sender: sessionId, signal } satisfies Wire });
    if (result !== 'ok') throw new Error('Ошибка передачи сигнала: ' + result);
  }

  function createPeer() {
    if (peer.current) return peer.current;
    const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (import.meta.env.VITE_TURN_URL && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
      iceServers.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
    }
    const pc = new RTCPeerConnection({ iceServers });
    peer.current = pc;
    local.current?.getAudioTracks().forEach(t => pc.addTrack(t, local.current!));
    // Negotiate a video m-line during the initial audio call. Later camera toggles
    // only replace the sender track, avoiding disruptive SDP renegotiation.
    const existingVideo = cameraStream.current?.getVideoTracks()[0];
    const videoTransceiver = existingVideo
      ? pc.addTransceiver(existingVideo, { direction: 'sendrecv' })
      : pc.addTransceiver('video', { direction: 'sendrecv' });
    videoSender.current = videoTransceiver.sender;
    pc.onicecandidate = e => { if (e.candidate) void send({ kind: 'ice', candidate: e.candidate.toJSON() }).catch(fail); };
    pc.ontrack = e => {
      if (e.track.kind === 'audio' && audio.current) {
        audio.current.srcObject = new MediaStream([e.track]);
        void audio.current.play().catch(() => setMessage('Нажмите кнопку воспроизведения, чтобы услышать собеседника.'));
      }
      if (e.track.kind === 'video') {
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
      }
    };
    pc.onconnectionstatechange = () => {
      if (!live.current || peer.current !== pc) return;
      if (pc.connectionState === 'connected') {
        setPhase('connected'); setMessage('Связь установлена');
        void send({ kind: 'camera', enabled: !!cameraStream.current }).catch(console.error);
      }
      if (pc.connectionState === 'disconnected') { setPhase('connecting'); setMessage('Связь прервалась. Пробуем восстановить соединение…'); }
      if (pc.connectionState === 'failed') fail(new Error('Не удалось установить соединение. Попробуйте другую сеть или настройте TURN-сервер.'));
    };
    return pc;
  }
  async function flushIce(pc: RTCPeerConnection) {
    for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate);
  }
  async function handleSignal(wire: Wire) {
    if (!live.current || wire.sender === sessionId || wire.sender !== remoteId.current) return;
    const s = wire.signal;
    if (s.kind === 'camera') { setRemoteCameraOn(s.enabled); return; }
    if (s.kind === 'ice') {
      if (peer.current?.remoteDescription) await peer.current.addIceCandidate(s.candidate);
      else pendingIce.current.push(s.candidate);
      return;
    }
    if (s.kind === 'offer') {
      const pc = createPeer();
      if (pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription(s.sdp);
      await flushIce(pc);
      await pc.setLocalDescription(await pc.createAnswer());
      await send({ kind: 'answer', sdp: pc.localDescription!.toJSON() });
      setPhase('connecting');
    } else if (s.kind === 'answer') {
      const pc = peer.current;
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(s.sdp);
      await flushIce(pc);
    }
  }
  async function offer() {
    if (makingOffer.current || peer.current || !live.current) return;
    makingOffer.current = true;
    try {
      const pc = createPeer();
      await pc.setLocalDescription(await pc.createOffer());
      await send({ kind: 'offer', sdp: pc.localDescription!.toJSON() });
      setPhase('connecting'); setMessage('Устанавливаем аудиосвязь…');
    } finally { makingOffer.current = false; }
  }
  function fail(error: unknown) {
    console.error(error);
    cleanup(); setPhase('error');
    setMessage(error instanceof Error ? error.message : String(error));
  }
  async function join() {
    if (!supabase) { setPhase('error'); setMessage('Сначала настройте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'); return; }
    const value = room.trim();
    if (!/^[a-zA-Z0-9_-]{12,128}$/.test(value)) { setPhase('error'); setMessage('ID комнаты должен содержать от 12 до 128 латинских букв, цифр, подчёркиваний или дефисов. Нажмите «Создать комнату».'); return; }
    cleanup(); setPhase('joining'); setMessage('Запрашиваем доступ к микрофону…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      local.current = stream; live.current = true; currentRoom.current = value;
      history.replaceState({}, '', '?room=' + encodeURIComponent(value));
      const ch = supabase.channel('voice:' + value, { config: { presence: { key: sessionId }, broadcast: { self: false, ack: true } } });
      channel.current = ch;
      ch.on('broadcast', { event: 'signal' }, ({ payload }) => { void handleSignal(payload as Wire).catch(fail); });
      ch.on('presence', { event: 'sync' }, () => {
        if (!live.current || channel.current !== ch) return;
        const members = Object.values(ch.presenceState()).flatMap(entries => entries as unknown as Member[]).sort((a,b) => a.joined - b.joined || a.id.localeCompare(b.id));
        if (members.length > 2) { fail(new Error('В этой комнате уже два участника.')); return; }
        const other = members.find(m => m.id !== sessionId);
        if (!other) {
          if (remoteId.current) { closePeer(); remoteId.current = null; }
          setPhase('waiting'); setMessage('Ожидаем, когда собеседник присоединится…'); return;
        }
        if (remoteId.current !== other.id) { closePeer(); remoteId.current = other.id; }
        if (members[0]?.id === sessionId) void offer().catch(fail);
        else { setPhase('connecting'); setMessage('Соединяем с собеседником…'); }
      });
      ch.subscribe(async status => {
        if (!live.current || channel.current !== ch) return;
        if (status === 'SUBSCRIBED') {
          try { await ch.track({ id: sessionId, joined: Date.now() } satisfies Member); }
          catch (e) { fail(e); }
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') fail(new Error('Ошибка подключения. Проверьте настройки Supabase.'));
      });
    } catch (e) { fail(e); }
  }
  async function toggleCamera() {
    if (!live.current || cameraBusyRef.current) return;
    cameraBusyRef.current = true;
    setCameraBusy(true);
    const request = ++cameraRequest.current;
    try {
      if (cameraStream.current) {
        await videoSender.current?.replaceTrack(null);
        cameraStream.current.getTracks().forEach(t => t.stop());
        cameraStream.current = null;
        setCameraOn(false);
        if (remoteId.current) void send({ kind: 'camera', enabled: false }).catch(console.error);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (!live.current || request !== cameraRequest.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        try { await videoSender.current?.replaceTrack(track); }
        catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
        if (!live.current || request !== cameraRequest.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        cameraStream.current = stream;
        setCameraOn(true);
        if (remoteId.current) void send({ kind: 'camera', enabled: true }).catch(console.error);
      }
    } catch (error) {
      console.error('Camera error:', error);
      setMessage('Не удалось включить камеру. Проверьте разрешения браузера.');
    } finally {
      if (request === cameraRequest.current) {
        cameraBusyRef.current = false;
        setCameraBusy(false);
      }
    }
  }
  function leave() { cleanup(); setPhase('idle'); setMessage('Звонок завершён.'); setMuted(false); }
  function toggleMute() {
    const next = !muted;
    local.current?.getAudioTracks().forEach(t => { t.enabled = !next; }); setMuted(next);
  }
  function createRoom() { const id = crypto.randomUUID().replace(/-/g, ''); setRoom(id); history.replaceState({}, '', '?room=' + id); setCopied(false); }
  async function copyLink() { await navigator.clipboard.writeText(location.origin + '/?room=' + encodeURIComponent(room.trim())); setCopied(true); }
  const active = phase === 'joining' || phase === 'waiting' || phase === 'connecting' || phase === 'connected';
  return <main className="shell"><section className="panel">
    <div className="brand"><span className="logo">♫</span><span>СЕМЕЙНАЯ СВЯЗЬ</span></div>
    <h1>Будьте рядом,<br/><em>где бы вы ни были.</em></h1>
    <p className="sub">Личный голосовой звонок для двоих. Ничего устанавливать не нужно.</p>
    <div className="field"><label htmlFor="room">ССЫЛКА НА КОМНАТУ</label><div className="inputrow"><input id="room" value={room} onChange={e => setRoom(e.target.value)} disabled={active} placeholder="Создайте комнату или вставьте её ID"/><button className="small" onClick={createRoom} disabled={active}>Создать</button></div></div>
    <div className="actions"><button className="primary" disabled={active || !room.trim()} onClick={() => void join()}>{active ? 'Вы в комнате' : 'Присоединиться к звонку'} →</button><button className="secondary" disabled={!room.trim()} onClick={() => void copyLink().catch(fail)}>{copied ? 'Скопировано!' : 'Скопировать ссылку'}</button></div>
    <div className="callbox"><div className={'pulse ' + (phase === 'connected' ? 'online' : '')}>◉</div><div><strong>{({ idle:'Готовы к звонку', joining:'Подключаемся…', waiting:'Ожидаем собеседника', connecting:'Соединяем…', connected:'Связь установлена', error:'Произошла ошибка' } as Record<Phase,string>)[phase]}</strong><p role="status">{message || 'Создайте комнату, отправьте ссылку близкому человеку и откройте её в обоих браузерах.'}</p></div></div>
    {active && <div className="controls">
      <button onClick={toggleMute}>{muted ? 'Включить микрофон' : 'Выключить микрофон'}</button>
      <button onClick={() => void toggleCamera()} disabled={cameraBusy || phase === 'joining'}>{cameraBusy ? 'Подождите…' : cameraOn ? 'Выключить камеру' : 'Включить камеру'}</button>
      <button className="hangup" onClick={leave}>Завершить звонок</button>
    </div>}
    {active && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12, marginTop: 16 }}>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#1b2330', minHeight: 170 }}>
        <video ref={remoteVideo} autoPlay muted playsInline style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: '#1b2330' }} />
        {!remoteCameraOn && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, color: '#fff', textAlign: 'center', background: '#1b2330' }}>Камера собеседника выключена</div>}
        <div style={{ position: 'absolute', bottom: 8, left: 8, color: '#fff', background: '#0009', padding: '3px 8px', borderRadius: 6 }}>Собеседник</div>
      </div>
      {cameraOn && <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#1b2330' }}>
        <video ref={localVideo} autoPlay muted playsInline style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        <div style={{ position: 'absolute', bottom: 8, left: 8, color: '#fff', background: '#0009', padding: '3px 8px', borderRadius: 6 }}>Вы</div>
      </div>}
    </div>}
    <audio ref={audio} autoPlay playsInline controls className="remote-audio" />
    <p className="foot">Голос и видео · Защищённая связь WebRTC · Не закрывайте страницу во время звонка</p>
  </section></main>;
}
