import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

const app = express()
const httpServer = createServer(app)
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const io = new Server(httpServer, {
  cors: {
    origin: clientOrigin,
  },
})

app.use(cors({ origin: clientOrigin }))
app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)

  socket.on('join-room', (roomId) => {
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
    console.log(`Client ${socket.id} joined room ${roomId}`)
    socket.emit('room-joined', { roomId, isCaller: memberCount === 0 })

    if (memberCount === 1) {
      for (const peerSocketId of io.sockets.adapter.rooms.get(roomId) ?? []) {
        const peerSocket = io.sockets.sockets.get(peerSocketId)
        if (peerSocket && peerSocket.id !== socket.id) {
          socket.emit('peer-media-state', { cameraOff: Boolean(peerSocket.data.cameraOff), audioOff: Boolean(peerSocket.data.audioOff) })
        }
      }
      socket.to(roomId).emit('peer-joined')
    }
  })

  socket.on('media-state', ({ roomId, cameraOff, audioOff }) => {
    if (socket.data.roomId !== roomId || typeof cameraOff !== 'boolean' || typeof audioOff !== 'boolean') return
    socket.data.cameraOff = cameraOff
    socket.data.audioOff = audioOff
    socket.to(roomId).emit('peer-media-state', { cameraOff, audioOff })
  })

  socket.on('signal', ({ roomId, data }) => {
    socket.to(roomId).emit('signal', { data })
  })

  socket.on('chat-message', ({ roomId, text }) => {
    if (typeof text !== 'string' || !text.trim()) return
    socket.to(roomId).emit('chat-message', {
      id: socket.id,
      text: text.trim().slice(0, 1000),
    })
  })

  socket.on('leave-room', () => {
    if (!socket.data.roomId) return
    const roomId = socket.data.roomId
    socket.leave(roomId)
    socket.data.roomId = null
    socket.to(roomId).emit('peer-left')
  })

  socket.on('disconnect', () => {
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('peer-left')
    }
    console.log(`Client disconnected: ${socket.id}`)
  })
})

const PORT = Number(process.env.PORT || 3001)
httpServer.listen(PORT, () => {
  console.log(`Kuch Batein server listening on http://localhost:${PORT}`)
})
