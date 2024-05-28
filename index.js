import { Server } from 'socket.io'
import express from 'express'
import http from 'node:http'
import https from 'node:https'
import matchHandlers from './matchHandlers.js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()
const port = process.env.PORT

const app = express()
const protocol = process.env.USE_HTTPS ? https : http
const options = process.env.USE_HTTPS ? {
  key: fs.readFileSync(process.env.SSL_KEY_PATH),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH)
} : {}
const server = protocol.createServer(options, app)

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