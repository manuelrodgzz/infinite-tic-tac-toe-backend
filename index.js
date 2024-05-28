import { Server } from 'socket.io'
import express from 'express'
import http from 'node:http'
import https from 'node:https'
import matchHandlers from './matchHandlers.js'
import dotenv from 'dotenv'

dotenv.config()
const port = process.env.PORT

const app = express()
const protocol = process.env.USE_HTTPS ? https : http
const server = protocol.createServer(app)

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

server.listen(port, () => {
  console.log('Server up and running. Port:', port)
})