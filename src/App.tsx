import { useEffect, useRef, useState } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = url && key ? createClient(url, key) : null;
const roomFromUrl = new URLSearchParams(location.search).get('room') ?? '';
const sessionId = crypto.randomUUID();
type Signal = { kind: 'offer'; sdp: RTCSessionDescriptionInit } | { kind: 'answer'; sdp: RTCSessionDescriptionInit } | { kind: 'ice'; candidate: RTCIceCandidateInit };
type Wire = { sender: string; signal: Signal };
type Member = { id: string; joined: number };
type Phase = 'idle' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'error';

export default function App() {
  const [room, setRoom] = useState(roomFromUrl);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const channel = useRef<RealtimeChannel | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const remoteId = useRef<string | null>(null);
  const makingOffer = useRef(false);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const currentRoom = useRef('');
  const live = useRef(false);

  function closePeer() {
    peer.current?.close(); peer.current = null;
    if (audio.current) audio.current.srcObject = null;
    pendingIce.current = []; makingOffer.current = false;
  }
  function cleanup() {
    live.current = false;
    closePeer();
    local.current?.getTracks().forEach(t => t.stop()); local.current = null;
    if (channel.current && supabase) void supabase.removeChannel(channel.current);
    channel.current = null; remoteId.current = null; currentRoom.current = '';
  }
  useEffect(() => () => cleanup(), []);

  async function send(signal: Signal) {
    if (!channel.current) return;
    const result = await channel.current.send({ type: 'broadcast', event: 'signal', payload: { sender: sessionId, signal } satisfies Wire });
    if (result !== 'ok') throw new Error('Signaling delivery failed: ' + result);
  }

  function createPeer() {
    if (peer.current) return peer.current;
    const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (import.meta.env.VITE_TURN_URL && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
      iceServers.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
    }
    const pc = new RTCPeerConnection({ iceServers });
    peer.current = pc;
    local.current?.getTracks().forEach(t => pc.addTrack(t, local.current!));
    pc.onicecandidate = e => { if (e.candidate) void send({ kind: 'ice', candidate: e.candidate.toJSON() }).catch(fail); };
    pc.ontrack = e => { if (audio.current) { audio.current.srcObject = e.streams[0]; void audio.current.play().catch(() => setMessage('Tap Play audio to hear the other person.')); } };
    pc.onconnectionstatechange = () => {
      if (!live.current || peer.current !== pc) return;
      if (pc.connectionState === 'connected') { setPhase('connected'); setMessage('Audio connected'); }
      if (pc.connectionState === 'disconnected') { setPhase('connecting'); setMessage('Connection interrupted; trying to recover…'); }
      if (pc.connectionState === 'failed') fail(new Error('Connection failed. Configure a TURN server or try another network.'));
    };
    return pc;
  }
  async function flushIce(pc: RTCPeerConnection) {
    for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate);
  }
  async function handleSignal(wire: Wire) {
    if (!live.current || wire.sender === sessionId || wire.sender !== remoteId.current) return;
    const s = wire.signal;
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
      setPhase('connecting'); setMessage('Connecting audio…');
    } finally { makingOffer.current = false; }
  }
  function fail(error: unknown) {
    console.error(error);
    cleanup(); setPhase('error');
    setMessage(error instanceof Error ? error.message : String(error));
  }
  async function join() {
    if (!supabase) { setPhase('error'); setMessage('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.'); return; }
    const value = room.trim();
    if (!/^[a-zA-Z0-9_-]{12,128}$/.test(value)) { setPhase('error'); setMessage('Room ID must be 12–128 letters, numbers, underscores or hyphens. Use Create room.'); return; }
    cleanup(); setPhase('joining'); setMessage('Requesting microphone…');
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
        if (members.length > 2) { fail(new Error('This room already has two people.')); return; }
        const other = members.find(m => m.id !== sessionId);
        if (!other) {
          if (remoteId.current) { closePeer(); remoteId.current = null; }
          setPhase('waiting'); setMessage('Waiting for the other person to join…'); return;
        }
        if (remoteId.current !== other.id) { closePeer(); remoteId.current = other.id; }
        if (members[0]?.id === sessionId) void offer().catch(fail);
        else { setPhase('connecting'); setMessage('Connecting to the other person…'); }
      });
      ch.subscribe(async status => {
        if (!live.current || channel.current !== ch) return;
        if (status === 'SUBSCRIBED') {
          try { await ch.track({ id: sessionId, joined: Date.now() } satisfies Member); }
          catch (e) { fail(e); }
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') fail(new Error('Realtime connection failed. Check Supabase configuration.'));
      });
    } catch (e) { fail(e); }
  }
  function leave() { cleanup(); setPhase('idle'); setMessage('Call ended.'); setMuted(false); }
  function toggleMute() {
    const next = !muted;
    local.current?.getAudioTracks().forEach(t => { t.enabled = !next; }); setMuted(next);
  }
  function createRoom() { const id = crypto.randomUUID().replace(/-/g, ''); setRoom(id); history.replaceState({}, '', '?room=' + id); setCopied(false); }
  async function copyLink() { await navigator.clipboard.writeText(location.origin + '/?room=' + encodeURIComponent(room.trim())); setCopied(true); }
  const active = phase === 'joining' || phase === 'waiting' || phase === 'connecting' || phase === 'connected';
  return <main className="shell"><section className="panel">
    <div className="brand"><span className="logo">♫</span><span>FAMILY VOICE</span></div>
    <h1>Stay close,<br/><em>wherever you are.</em></h1>
    <p className="sub">A private two-person voice room. No download required.</p>
    <div className="field"><label htmlFor="room">ROOM LINK</label><div className="inputrow"><input id="room" value={room} onChange={e => setRoom(e.target.value)} disabled={active} placeholder="Create a room or paste its ID"/><button className="small" onClick={createRoom} disabled={active}>New</button></div></div>
    <div className="actions"><button className="primary" disabled={active || !room.trim()} onClick={() => void join()}>{active ? 'In room' : 'Join voice room'} →</button><button className="secondary" disabled={!room.trim()} onClick={() => void copyLink().catch(fail)}>{copied ? 'Copied!' : 'Copy invite link'}</button></div>
    <div className="callbox"><div className={'pulse ' + (phase === 'connected' ? 'online' : '')}>◉</div><div><strong>{({ idle:'Ready to connect', joining:'Joining…', waiting:'Waiting for someone', connecting:'Connecting…', connected:'You are connected', error:'Something went wrong' } as Record<Phase,string>)[phase]}</strong><p role="status">{message || 'Create a room, share its link, and join from both browsers.'}</p></div></div>
    {active && <div className="controls"><button onClick={toggleMute}>{muted ? 'Unmute microphone' : 'Mute microphone'}</button><button className="hangup" onClick={leave}>Leave call</button></div>}
    <audio ref={audio} autoPlay playsInline controls className="remote-audio" />
    <p className="foot">Audio only · Encrypted WebRTC · Keep this page open during your call</p>
  </section></main>;
}
