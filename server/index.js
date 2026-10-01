import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

const app = express()
const httpServer = createServer(app)

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true)
    return
  }

  callback(new Error('Origin is not allowed by CORS'))
}

const roomIdPattern = /^[A-Z0-9]{6,12}$/
const chatWindowMs = 10000
const maxChatMessagesPerWindow = 10

const io = new Server(httpServer, {
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: false,
  },
})

app.use(
  cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  })
)

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/', (_request, response) => {
  response.json({ name: 'Kuch Batein server', status: 'ok' })
})

io.engine.on('connection_error', (error) => {
  console.error('Socket.IO engine connection error:', {
    message: error.message,
    code: error.code,
    context: error.context,
  })
})

io.on('connection', (socket) => {
  console.log(
    `Client connected: ${socket.id} via ${socket.conn.transport.name}`
  )

  socket.conn.on('upgrade', () => {
    console.log(
      `Client ${socket.id} upgraded to ${socket.conn.transport.name}`
    )
  })

  socket.on('join-room', (roomId) => {
    if (
      typeof roomId !== 'string' ||
      !roomIdPattern.test(roomId)
    ) {
      socket.emit(
        'room-error',
        'Use a 6-12 character room code containing only letters and numbers.'
      )
      return
    }

    if (socket.data.roomId) {
      socket.emit(
        'room-error',
        'Leave your current room before joining another one.'
      )
      return
    }

    const room = io.sockets.adapter.rooms.get(roomId)
    const memberCount = room?.size ?? 0

    if (memberCount >= 2) {
      socket.emit('room-full')
      return
    }

    socket.join(roomId)

    socket.data.roomId = roomId
    socket.data.cameraOff = false
    socket.data.audioOff = false

    console.log(
      `Client ${socket.id} joined room ${roomId}`
    )

    socket.emit('room-joined', {
      roomId,
      isCaller: memberCount === 0,
    })

    if (memberCount === 1) {
      for (
        const peerSocketId of
        io.sockets.adapter.rooms.get(roomId) ?? []
      ) {
        const peerSocket =
          io.sockets.sockets.get(peerSocketId)

        if (
          peerSocket &&
          peerSocket.id !== socket.id
        ) {
          socket.emit('peer-media-state', {
            cameraOff: Boolean(
              peerSocket.data.cameraOff
            ),
            audioOff: Boolean(
              peerSocket.data.audioOff
            ),
          })
        }
      }

      socket.to(roomId).emit('peer-joined')
    }
  })

  socket.on('media-state', (payload) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const {
      roomId,
      cameraOff,
      audioOff,
    } = payload

    if (
      socket.data.roomId !== roomId ||
      typeof cameraOff !== 'boolean' ||
      typeof audioOff !== 'boolean'
    ) {
      return
    }

    socket.data.cameraOff = cameraOff
    socket.data.audioOff = audioOff

    socket.to(roomId).emit('peer-media-state', {
      cameraOff,
      audioOff,
    })
  })

  socket.on('signal', (payload) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const { roomId, data } = payload

    if (
      socket.data.roomId !== roomId ||
      !data ||
      typeof data !== 'object'
    ) {
      return
    }

    if (
      ![
        'offer',
        'answer',
        'ice-candidate',
      ].includes(data.type)
    ) {
      return
    }

    socket.to(roomId).emit('signal', { data })
  })

  socket.on('chat-message', (payload) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const { roomId, text } = payload

    if (socket.data.roomId !== roomId) {
      return
    }

    if (
      typeof text !== 'string' ||
      !text.trim()
    ) {
      return
    }

    const now = Date.now()

    if (
      !socket.data.chatWindowStart ||
      now - socket.data.chatWindowStart >=
        chatWindowMs
    ) {
      socket.data.chatWindowStart = now
      socket.data.chatMessageCount = 0
    }

    if (
      socket.data.chatMessageCount >=
      maxChatMessagesPerWindow
    ) {
      socket.emit('chat-rate-limited')
      return
    }

    socket.data.chatMessageCount += 1

    socket.to(roomId).emit('chat-message', {
      id: socket.id,
      text: text.trim().slice(0, 1000),
    })
  })

  socket.on('leave-room', () => {
    if (!socket.data.roomId) {
      return
    }

    const roomId = socket.data.roomId

    socket.leave(roomId)

    socket.data.roomId = null
    socket.data.chatWindowStart = null
    socket.data.chatMessageCount = 0

    socket.to(roomId).emit('peer-left')

    console.log(
      `Client ${socket.id} left room ${roomId}`
    )
  })

  socket.on('disconnect', (reason) => {
    if (socket.data.roomId) {
      socket
        .to(socket.data.roomId)
        .emit('peer-left')
    }

    console.log(
      `Client disconnected: ${socket.id}. Reason: ${reason}`
    )
  })
})

const PORT = Number(
  process.env.PORT || 3001
)

httpServer.listen(PORT, () => {
  console.log(
    `Kuch Batein server listening on http://localhost:${PORT}`
  )

  console.log(
    'Socket.IO transports: polling + websocket'
  )

  console.log(
    `Allowed client origins: ${allowedOrigins.join(', ')}`
  )
})