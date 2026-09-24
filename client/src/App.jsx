import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
const LOGO_SRC = '/logo.png?v=3'
const MEDIA_CONSTRAINTS = {
  video: { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
}
const DEFAULT_VIDEO_BITRATE = 900000

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function getMediaErrorMessage(error) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'Camera and microphone need a secure browser page. Use localhost or HTTPS.'
  }

  const messages = {
    NotAllowedError: 'Camera or microphone permission was blocked. Use the lock icon beside the address bar to allow both, then try again.',
    PermissionDeniedError: 'Camera or microphone permission was blocked. Allow both in the browser site settings, then try again.',
    NotFoundError: 'No camera or microphone was found. Connect a device and try again.',
    NotReadableError: 'Your camera or microphone is already in use by another app. Close it and try again.',
    OverconstrainedError: 'The connected camera or microphone does not support this call.',
    SecurityError: 'The browser security settings blocked camera and microphone access.',
    TypeError: 'The browser cannot see a usable camera or microphone. Check Windows Privacy settings, connect a device, and try again.'
  }

  return messages[error.name] || `Could not start the call (${error.name || 'unknown media error'}). Check your camera and microphone settings.`
}

async function configureVideoSender(sender, maxBitrate = DEFAULT_VIDEO_BITRATE) {
  const parameters = sender.getParameters()
  parameters.degradationPreference = 'balanced'
  parameters.encodings = (parameters.encodings?.length ? parameters.encodings : [{}]).map((encoding) => ({
    ...encoding,
    maxBitrate,
    maxFramerate: 30
  }))
  await sender.setParameters(parameters)
}

function formatCallDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function Icon({ name }) {
  const paths = {
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0m-6 6v3m-3 0h6',
    micOff: 'm4 4 16 16M9 9v3a3 3 0 0 0 5.12 2.12M15 9V6a3 3 0 0 0-5.12-2.12M6 12a6 6 0 0 0 9.54 4.86M12 18v3m-3 0h6',
    camera: 'm15 10 4.5-2.5v9L15 14m-9 5h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z',
    cameraOff: 'm3 3 18 18M15 10l4.5-2.5v9L17 17m-4.5-1H6a2 2 0 0 1-2-2V7a2 2 0 0 1 .5-1.34',
    chat: 'M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.4-.7L4 20l1.7-3.7A7.4 7.4 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z',
    leave: 'M9 6 4 11l5 5m-5-5h12a4 4 0 0 1 4 4v2',
    hangup: 'M4 14.5c4.5-3 11.5-3 16 0l-1.5 3a1.5 1.5 0 0 1-2 .6l-2.3-1.2a5 5 0 0 0-4.4 0l-2.3 1.2a1.5 1.5 0 0 1-2-.6Z',
    screenShare: 'M4 5h16v11H4zM8 21h8m-4-5v5'
  }

  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}

function App() {
  const [roomId, setRoomId] = useState('')
  const [joinedRoom, setJoinedRoom] = useState('')
  const [callState, setCallState] = useState('idle')
  const [error, setError] = useState('')
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isRemoteCameraOff, setIsRemoteCameraOff] = useState(false)
  const [isRemoteMuted, setIsRemoteMuted] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [networkQuality, setNetworkQuality] = useState(0)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notification, setNotification] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const activeRoomRef = useRef('')
  const pendingCandidatesRef = useRef([])

  useEffect(() => {
    const linkedRoom = new URLSearchParams(window.location.search).get('room')
    if (linkedRoom) setRoomId(linkedRoom.trim().toUpperCase())
  }, [])

  useEffect(() => {
    const socket = io(SERVER_URL)
    socketRef.current = socket

    socket.on('connect', () => setCallState((state) => state === 'idle' ? 'ready' : state))
    socket.on('room-joined', async ({ roomId: joinedId, isCaller }) => {
      activeRoomRef.current = joinedId
      setJoinedRoom(joinedId)
      setCallState('waiting')
      if (isCaller) return

      const peer = peerRef.current || createPeer(joinedId)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      socket.emit('signal', { roomId: joinedId, data: { type: 'offer', offer } })
    })
    socket.on('peer-joined', () => setCallState('connecting'))
    socket.on('peer-media-state', ({ cameraOff, audioOff }) => {
      setIsRemoteCameraOff(cameraOff)
      setIsRemoteMuted(audioOff)
    })
    socket.on('chat-message', ({ id, text }) => {
      setMessages((currentMessages) => [...currentMessages, { id, text, isOwn: false }])
      if (!isChatOpenRef.current) {
        setUnreadCount((count) => count + 1)
        setNotification('New message received')
        window.setTimeout(() => setNotification(''), 3000)
      }
    })
    socket.on('signal', async ({ data }) => {
      const peer = peerRef.current
      if (!peer) return

      if (data.type === 'offer') {
        await peer.setRemoteDescription(data.offer)
        await flushPendingCandidates(peer)
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        socket.emit('signal', { roomId: activeRoomRef.current, data: { type: 'answer', answer } })
      } else if (data.type === 'answer') {
        await peer.setRemoteDescription(data.answer)
        await flushPendingCandidates(peer)
      } else if (data.type === 'ice-candidate' && data.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(data.candidate)
        else pendingCandidatesRef.current.push(data.candidate)
      }
    })
    socket.on('room-full', () => {
      stopCall()
      activeRoomRef.current = ''
      setJoinedRoom('')
      setIsRemoteCameraOff(false)
      setIsRemoteMuted(false)
      setMessages([])
      setIsChatOpen(false)
      setUnreadCount(0)
      setNotification('')
      setError('That room already has two people.')
      setCallState('ready')
    })
    socket.on('peer-left', () => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      setIsRemoteCameraOff(false)
      setIsRemoteMuted(false)
      setMessages([])
      setUnreadCount(0)
      setNotification('')
      setCallState('waiting')
    })
    socket.on('disconnect', () => setCallState('offline'))

    return () => {
      socket.disconnect()
      stopCall()
    }
  }, [])

  useEffect(() => {
    if (joinedRoom && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current
    }
  }, [joinedRoom])

  const isChatOpenRef = useRef(false)

  useEffect(() => {
    isChatOpenRef.current = isChatOpen
    if (isChatOpen) {
      setUnreadCount(0)
      setNotification('')
    }
  }, [isChatOpen])

  useEffect(() => {
    document.querySelector('.chat-messages')?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (callState !== 'connected') {
      setCallDuration(0)
      setNetworkQuality(0)
      return undefined
    }

    const connectedAt = Date.now()
    const updateCallStatus = async () => {
      setCallDuration(Math.floor((Date.now() - connectedAt) / 1000))
      const stats = await peerRef.current?.getStats()
      if (!stats) return

      let roundTripTime = null
      let packetLoss = 0
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
          roundTripTime = report.currentRoundTripTime
        }
        if (report.type === 'remote-inbound-rtp' && report.kind === 'video' && typeof report.fractionLost === 'number') {
          packetLoss = Math.max(packetLoss, report.fractionLost)
        }
      })

      if (roundTripTime === null) return
      setNetworkQuality(roundTripTime < 0.12 ? 3 : roundTripTime < 0.25 ? 2 : 1)
      const videoSender = peerRef.current?.getSenders().find((sender) => sender.track?.kind === 'video')
      if (videoSender) {
        const targetBitrate = packetLoss > 0.08 ? 450000 : packetLoss > 0.03 ? 700000 : DEFAULT_VIDEO_BITRATE
        const currentBitrate = videoSender.getParameters().encodings?.[0]?.maxBitrate
        if (currentBitrate !== targetBitrate) configureVideoSender(videoSender, targetBitrate).catch(() => {})
      }
    }

    updateCallStatus()
    const statusTimer = window.setInterval(updateCallStatus, 1000)
    return () => window.clearInterval(statusTimer)
  }, [callState])

  function createPeer(activeRoomId) {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peerRef.current = peer
    localStreamRef.current?.getTracks().forEach((track) => {
      if (track.kind === 'video') track.contentHint = 'motion'
      const sender = peer.addTrack(track, localStreamRef.current)
      if (track.kind === 'video') configureVideoSender(sender).catch(() => {})
    })
    peer.ontrack = (event) => {
      if (event.track.kind === 'video') {
        setIsRemoteCameraOff(event.track.muted)
        event.track.onmute = () => setIsRemoteCameraOff(true)
        event.track.onunmute = () => setIsRemoteCameraOff(false)
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0]
        remoteVideoRef.current.muted = false
        remoteVideoRef.current.volume = 1
        remoteVideoRef.current.play().catch(() => {})
      }
      setCallState('connected')
    }
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) socketRef.current.emit('signal', { roomId: activeRoomId, data: { type: 'ice-candidate', candidate } })
    }
    return peer
  }

  async function flushPendingCandidates(peer) {
    const candidates = pendingCandidatesRef.current.splice(0)
    for (const candidate of candidates) await peer.addIceCandidate(candidate)
  }

  async function joinRoom(event) {
    event.preventDefault()
    const activeRoomId = roomId.trim().toUpperCase()
    if (!activeRoomId) return setError('Enter a room code first.')

    try {
      setError('')
      activeRoomRef.current = activeRoomId
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('UNSUPPORTED_MEDIA_CONTEXT')
      }
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
      localStreamRef.current = stream
      createPeer(activeRoomId)
      socketRef.current.emit('join-room', activeRoomId)
    } catch (error) {
      activeRoomRef.current = ''
      setError(error.message === 'UNSUPPORTED_MEDIA_CONTEXT' ? 'Camera and microphone need a secure browser page. Use localhost or HTTPS.' : getMediaErrorMessage(error))
    }
  }

  function stopCall() {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    screenStreamRef.current = null
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    setIsScreenSharing(false)
  }

  function leaveRoom() {
    socketRef.current?.emit('leave-room')
    stopCall()
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    activeRoomRef.current = ''
    setMessages([])
    setChatInput('')
    setIsChatOpen(false)
    setUnreadCount(0)
    setNotification('')
    setJoinedRoom('')
    setCallState('ready')
  }

  function sendChatMessage(event) {
    event.preventDefault()
    const text = chatInput.trim()
    if (!text || !activeRoomRef.current) return

    setMessages((currentMessages) => [...currentMessages, { id: `local-${Date.now()}`, text, isOwn: true }])
    socketRef.current.emit('chat-message', { roomId: activeRoomRef.current, text })
    setChatInput('')
  }

  function toggleChat() {
    setIsChatOpen((open) => !open)
  }

  async function stopScreenShare() {
    const cameraTrack = localStreamRef.current?.getTracks().find((track) => track.kind === 'video')
    const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video')
    if (sender && cameraTrack) {
      cameraTrack.contentHint = 'motion'
      await sender.replaceTrack(cameraTrack)
      await configureVideoSender(sender)
    }
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    screenStreamRef.current = null
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current
    setIsScreenSharing(false)
    socketRef.current?.emit('media-state', { roomId: activeRoomRef.current, cameraOff: isCameraOff, audioOff: isMuted })
  }

  async function toggleScreenShare() {
    if (isScreenSharing) {
      await stopScreenShare()
      return
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = displayStream.getVideoTracks()[0]
      const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video')
      if (!screenTrack || !sender) {
        displayStream.getTracks().forEach((track) => track.stop())
        return
      }

      screenTrack.contentHint = 'detail'
      await sender.replaceTrack(screenTrack)
      await configureVideoSender(sender, 1200000)
      screenStreamRef.current = displayStream
      if (localVideoRef.current) localVideoRef.current.srcObject = displayStream
      setIsScreenSharing(true)
      socketRef.current?.emit('media-state', { roomId: activeRoomRef.current, cameraOff: false, audioOff: isMuted })
      screenTrack.onended = () => stopScreenShare()
    } catch {
      setNotification('Screen sharing was cancelled')
      window.setTimeout(() => setNotification(''), 2200)
    }
  }

  async function copyRoomValue(value, label) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyFeedback(`${label} copied`)
      window.setTimeout(() => setCopyFeedback(''), 2200)
    } catch {
      setCopyFeedback('Copy unavailable')
      window.setTimeout(() => setCopyFeedback(''), 2200)
    }
  }

  function toggleTrack(kind) {
    const track = localStreamRef.current?.getTracks().find((item) => item.kind === kind)
    if (!track) return
    track.enabled = !track.enabled
    if (kind === 'audio') {
      const audioOff = !track.enabled
      setIsMuted(audioOff)
      socketRef.current?.emit('media-state', { roomId: activeRoomRef.current, cameraOff: isCameraOff, audioOff })
    }
    if (kind === 'video') {
      const cameraOff = !track.enabled
      setIsCameraOff(cameraOff)
      socketRef.current?.emit('media-state', { roomId: activeRoomRef.current, cameraOff, audioOff: isMuted })
    }
  }

  const statusLabel = { idle: 'Connecting to Kuch Batein', ready: 'Ready to call', waiting: 'Waiting for your friend', connecting: 'Connecting your call', connected: 'You are connected', offline: 'Server unavailable' }[callState]

  if (joinedRoom) {
    return (
      <main className="call-shell">
        <header className="call-header">
          <div className="call-brand"><div><span className="brand-name call-title">Kuch <em>Batein</em></span><span className="room-badge">Room <b>{joinedRoom}</b></span></div></div>
          <div className="call-header-actions"><div className="call-session-meta"><span className="call-timer"><i /> {formatCallDuration(callDuration)}</span><span className={`network-status network-level-${networkQuality}`} aria-label={networkQuality === 0 ? 'Checking network' : networkQuality === 3 ? 'Excellent network' : networkQuality === 2 ? 'Good network' : 'Weak network'} title={networkQuality === 0 ? 'Checking network' : networkQuality === 3 ? 'Excellent network' : networkQuality === 2 ? 'Good network' : 'Weak network'}><span className="network-bars"><i /><i /><i /><i /></span></span></div><span className="connection-status"><i /> {callState === 'connected' ? 'Connected securely' : statusLabel}</span></div>
        </header>
        <div className={`call-layout ${isChatOpen ? 'chat-open' : ''}`}>
          <section className={`video-stage ${callState === 'connected' ? 'is-connected' : 'is-waiting'}`}>
            <div className="remote-tile"><video ref={remoteVideoRef} autoPlay playsInline />{isRemoteCameraOff && callState === 'connected' && <div className="camera-off-placeholder" role="status" aria-label="Friend camera off"><span className="camera-off-avatar">Friend</span></div>}{callState === 'connected' && <span className="remote-label"><i /> Friend <b>{isRemoteMuted ? 'Muted' : 'Connected'}</b></span>}{callState !== 'connected' && <div className="empty-remote"><div className="waiting-card"><div className="radar-orbit radar-orbit-outer"><div className="radar-orbit radar-orbit-inner"><span className="avatar large">...</span></div></div><p>{statusLabel}</p><small>Share the room code with one friend to begin</small><div className="room-share"><span className="room-share-label">Room code</span><strong>{joinedRoom}</strong><div className="share-actions"><button onClick={() => copyRoomValue(joinedRoom, 'Room code')} aria-label="Copy room code">Copy code</button><button onClick={() => copyRoomValue(`${window.location.origin}${window.location.pathname}?room=${joinedRoom}`, 'Room link')} aria-label="Copy room link">Copy link</button></div></div></div></div>}</div>
            <div className="stage-vignette" />
            <div className="local-tile"><video ref={localVideoRef} autoPlay muted playsInline />{isCameraOff && <div className="camera-off-placeholder camera-off-placeholder-local" role="status" aria-label="Your camera off"><span className="camera-off-avatar">You</span></div>}<span className="video-label">You <i>{isCameraOff ? 'Camera off' : 'Live'}</i></span></div>
            {notification && <div className="chat-notification" role="status">{notification}</div>}
            {copyFeedback && <div className="copy-feedback" role="status"><i>✓</i> {copyFeedback}</div>}
          </section>
          {isChatOpen && <aside className="chat-overlay"><div className="chat-overlay-heading"><span><i /> Live chat</span><button onClick={() => setIsChatOpen(false)} aria-label="Close chat">×</button></div><div className="chat-messages" aria-live="polite">{messages.length === 0 && <p className="chat-empty">Say hello while you wait.</p>}{messages.map((message) => <p key={message.id} className={`chat-bubble ${message.isOwn ? 'chat-bubble-own' : ''}`}>{message.text}</p>)}</div><form className="chat-form" onSubmit={sendChatMessage}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Write a message" maxLength="1000" aria-label="Message" /><button type="submit" aria-label="Send message">↗</button></form></aside>}
          <div className="call-controls"><button className="control-button dock-btn leave-control leave-btn" onClick={leaveRoom} aria-label="Leave room"><span className="control-icon"><Icon name="leave" /></span><span>Leave room</span></button><span className="dock-divider" /><button className={`control-button dock-btn media-control ${isMuted ? 'active' : ''}`} data-tooltip={isMuted ? 'Unmute' : 'Mute'} onClick={() => toggleTrack('audio')} aria-label={isMuted ? 'Turn microphone on' : 'Turn microphone off'}><span className="control-icon"><Icon name={isMuted ? 'micOff' : 'mic'} /></span><span>{isMuted ? 'Unmute' : 'Mute'}</span></button><button className={`control-button dock-btn media-control ${isCameraOff ? 'active' : ''}`} data-tooltip={isCameraOff ? 'Turn camera on' : 'Camera'} onClick={() => toggleTrack('video')} aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}><span className="control-icon"><Icon name={isCameraOff ? 'cameraOff' : 'camera'} /></span><span>{isCameraOff ? 'Camera on' : 'Camera'}</span></button><button className={`control-button dock-btn media-control ${isScreenSharing ? 'selected' : ''}`} data-tooltip={isScreenSharing ? 'Stop sharing' : 'Share screen'} onClick={toggleScreenShare} aria-pressed={isScreenSharing} aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}><span className="control-icon"><Icon name="screenShare" /></span><span>{isScreenSharing ? 'Stop sharing' : 'Share screen'}</span></button><button className={`control-button dock-btn media-control chat-control ${isChatOpen ? 'selected' : ''}`} data-tooltip={isChatOpen ? 'Close chat' : 'Open chat'} onClick={toggleChat} aria-expanded={isChatOpen} aria-label="Toggle chat"><span className="control-icon"><Icon name="chat" /></span><span>Chat</span>{unreadCount > 0 && <b>{unreadCount}</b>}</button><span className="dock-divider" /><button className="end-button dock-btn end-call-btn" onClick={leaveRoom} aria-label="End call"><span className="control-icon"><Icon name="hangup" /></span><span>End call</span></button></div>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <div className="ambient-orbit ambient-orbit-one" />
      <div className="ambient-orbit ambient-orbit-two" />
      <section className="welcome-panel" aria-labelledby="app-title">
        <div className="hero-copy">
          <p className="eyebrow">A private space for presence</p>
          <h1 id="app-title">Kuch<br /><em>Batein</em></h1>
          <p className="intro">Some talks are better when it is just the two of you. Make a room, share the code, and be there.</p>
        </div>
        <form className="join-form" onSubmit={joinRoom}>
          <label htmlFor="room-code">Enter your room code</label>
          <div className="input-row">
            <div className="input-shell"><span className="input-prefix">#</span><input id="room-code" value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="SUNSET" maxLength="12" autoComplete="off" /></div>
            <button type="submit">Join call <span>↗</span></button>
          </div>
        </form>
        <div className="secondary-actions"><button className="new-room" onClick={() => setRoomId(createRoomCode())}><span className="spark">✦</span> Create a new room <span>↗</span></button><span className="shortcut-hint">No sign-up needed</span></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="feature-strip" aria-label="Room features"><span><i>✦</i> Private by design</span><span><i>◌</i> No recordings</span><span><i>·</i> Just two people</span></div>
        <p className="creator-credit">Created by <strong>Mr Frost</strong><span className="credit-dot" /> Built for the moments between words</p>
      </section>
    </main>
  )
}

export default App
