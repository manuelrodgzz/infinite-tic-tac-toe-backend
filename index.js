import { Server } from 'socket.io'
import express from 'express'
import { createServer } from 'node:http'
import matchHandlers from './matchHandlers.js'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const server = createServer(app)

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL
  }
})

function onConnection(socket) {
  console.log(`socket ${socket.id} connected!`)
  matchHandlers(io, socket)
}

io.on('connection', onConnection)

server.listen(3001, () => {
  console.log('Server up and running')
})