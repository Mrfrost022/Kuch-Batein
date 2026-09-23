import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

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

function App() {
  const [roomId, setRoomId] = useState('')
  const [joinedRoom, setJoinedRoom] = useState('')
  const [callState, setCallState] = useState('idle')
  const [error, setError] = useState('')
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notification, setNotification] = useState('')
  const [callSeconds, setCallSeconds] = useState(0)
  const [roomNotice, setRoomNotice] = useState('')
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const activeRoomRef = useRef('')
  const pendingCandidatesRef = useRef([])

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
      setMessages([])
      setIsChatOpen(false)
      setUnreadCount(0)
      setNotification('')
      setError('That room already has two people.')
      setCallState('ready')
    })
    socket.on('peer-left', () => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
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
    if (!joinedRoom) {
      setCallSeconds(0)
      return undefined
    }

    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [joinedRoom])

  useEffect(() => {
    document.querySelector('.chat-messages')?.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function createPeer(activeRoomId) {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peerRef.current = peer
    localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current))
    peer.ontrack = (event) => {
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      createPeer(activeRoomId)
      socketRef.current.emit('join-room', activeRoomId)
    } catch (error) {
      activeRoomRef.current = ''
      setError(error.message === 'UNSUPPORTED_MEDIA_CONTEXT' ? 'Camera and microphone need a secure browser page. Use localhost or HTTPS.' : getMediaErrorMessage(error))
    }
  }

  function stopCall() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    peerRef.current?.close()
    peerRef.current = null
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
    setRoomNotice('')
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

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(joinedRoom)
      setRoomNotice('Room code copied')
      window.setTimeout(() => setRoomNotice(''), 2200)
    } catch {
      setRoomNotice(`Room code: ${joinedRoom}`)
    }
  }

  function toggleTrack(kind) {
    const track = localStreamRef.current?.getTracks().find((item) => item.kind === kind)
    if (!track) return
    track.enabled = !track.enabled
    if (kind === 'audio') setIsMuted(!track.enabled)
    if (kind === 'video') setIsCameraOff(!track.enabled)
  }

  const statusLabel = { idle: 'Connecting to Kuch Batein', ready: 'Ready to call', waiting: 'Waiting for your friend', connecting: 'Connecting your call', connected: 'You are connected', offline: 'Server unavailable' }[callState]
  const callTime = `${String(Math.floor(callSeconds / 60)).padStart(2, '0')}:${String(callSeconds % 60).padStart(2, '0')}`

  if (joinedRoom) {
    return (
      <main className="call-shell">
        <header className="call-header"><div className="brand-mark">KB</div><div className="call-identity"><strong>Kuch Batein</strong><span><i className={`connection-dot connection-${callState}`} /> {statusLabel}</span></div><div className="room-tools"><span className="call-timer">{callTime}</span><button className="copy-room" onClick={copyRoomCode}>Copy code <b>{joinedRoom}</b></button>{roomNotice && <span className="room-notice" role="status">{roomNotice}</span>}<button className="text-button" onClick={leaveRoom}>Leave room</button></div></header>
        <div className="call-layout"><section className="video-stage">
            <div className="remote-tile"><video ref={remoteVideoRef} autoPlay playsInline />{callState !== 'connected' && <div className="empty-remote"><span className="avatar large">...</span><p>{statusLabel}</p><small>Share room code <b>{joinedRoom}</b> with one friend</small></div>}</div>
            <div className="local-tile"><video ref={localVideoRef} autoPlay muted playsInline /></div>
          {notification && <div className="chat-notification" role="status">{notification}</div>}
          <button className="chat-toggle" onClick={toggleChat} aria-expanded={isChatOpen} aria-label="Toggle chat">Chat{unreadCount > 0 && <span>{unreadCount}</span>}</button>
            {isChatOpen && <div className="chat-overlay"><div className="chat-overlay-heading"><strong>Live chat</strong><button onClick={() => setIsChatOpen(false)} aria-label="Close chat">×</button></div><div className="chat-messages" aria-live="polite">{messages.length === 0 && <p className="chat-empty">Say hello while you wait.</p>}{messages.map((message) => <p key={message.id} className={`chat-bubble ${message.isOwn ? 'chat-bubble-own' : ''}`}>{message.text}</p>)}</div><form className="chat-form" onSubmit={sendChatMessage}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Write a message" maxLength="1000" aria-label="Message" /><button type="submit" aria-label="Send message">↗</button></form></div>}
          </section></div>
        <div className="call-controls"><button className={`control-button ${isMuted ? 'active' : ''}`} onClick={() => toggleTrack('audio')}>{isMuted ? 'Mic off' : 'Mic on'}</button><button className={`control-button ${isCameraOff ? 'active' : ''}`} onClick={() => toggleTrack('video')}>{isCameraOff ? 'Camera off' : 'Camera on'}</button><button className="end-button" onClick={leaveRoom}>End call</button></div>
      </main>
    )
  }

  return (
    <main className="app-shell"><section className="welcome-panel" aria-labelledby="app-title"><div className="topline"><span className="brand-mark">KB</span><span className="live-status"><i /> {statusLabel}</span></div><p className="eyebrow">Just the two of you</p><h1 id="app-title">Kuch<br /><em>Batein</em></h1><p className="intro">A quiet room for the people you want to feel close to.</p><form className="join-form" onSubmit={joinRoom}><label htmlFor="room-code">Your room code</label><div className="input-row"><input id="room-code" value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="E.G. SUNSET" maxLength="12" autoComplete="off" /><button type="submit">Join call <span>↗</span></button></div></form><button className="new-room" onClick={() => setRoomId(createRoomCode())}>Create a new room <span>＋</span></button>{error && <p className="error-message" role="alert">{error}</p>}<p className="privacy-note">No accounts. No recordings. One room, two people.</p><p className="creator-credit"><span className="creator-avatar">MF</span><span>Created by <strong>Mr Frost</strong></span></p></section><aside className="side-note"><span>01</span><p>Make a room.<br />Send the code.<br />Be there.</p></aside>
    </main>
  )
}

export default App
