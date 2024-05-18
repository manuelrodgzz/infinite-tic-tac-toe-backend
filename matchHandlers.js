import { Server, Socket } from 'socket.io'
import crypto from 'node:crypto'
import response from './utils/response.js'

const DISCONNECTION_TIME_ALLOWED = 60_000

const matches = new Map()

// key: playerId, value: {socketId, matchId}
const activePlayers = new Map()

function generateId() {
  return crypto
  .randomBytes(3)
  .toString('hex')
  .toUpperCase()
}

function getPlayerIdBySocketId(socketId) {
  const iterator = activePlayers.entries()
  let currentPlayer = iterator.next()
  let playerId
  let matchId

  while (!currentPlayer.done) {
    const [ currentPlayerId, data ] = currentPlayer.value

    if (data.socketId === socketId) {
      playerId = currentPlayerId
      matchId = data.matchId
      break
    }

    currentPlayer = iterator.next()
  }

  return { playerId, matchId }
}

/**
 * 
 * @param {Object} match 
 * @param {Object} updates Set of arrays of properties to be changed.
 * @example 
 * const match = {
 *   cells: [],
 *   players: {
 *     ASD4FV: {
 *       name: 'Old Name'
 *       wins: 2
 *     }
 *   }
 * }
 * updateMatch(
 *  match,
 *  {
 *    players: {
 *      ASD4FV: prevPlayer => ({...prevPlayer, name: 'New Name})
 *    }
 *  }
 * )
 * // returns 
 *  {
 *    cells: [],
 *    players: {
 *      ASD4FV: {
 *        name: 'New Name'
 *        wins: 2
 *      }
 *    }
 * }
 */
function updateMatch(obj, updates) {
  const objCopy = Array.isArray(obj) ? [...obj] : {...obj}

  Object.entries(updates).forEach(([key, val]) => {
    if (typeof val === 'object') {
      if (val === null) {
        return
      }

      // Arrays are not merged
      if (Array.isArray(val)) {
        objCopy[key] = val
        return
      }

      objCopy[key] = updateMatch(objCopy[key], val)
      return
    }

    if (typeof val === 'function') {
      objCopy[key] = val(objCopy[key])
      return
    }

    objCopy[key] = val
  })

  return objCopy
}

/**
 * 
 * @param {Server} io
 * @param {Socket} socket 
*/
export default function matchHandlers(io, socket) {
  function emitMatchState(matchId) {
    const match = matches.get(matchId)
    io.to(matchId).emit('match:update', matches.get(matchId), match)
  }

  function getMatch(matchId) {
    const match = matches.get(matchId)

    if (!match) {
      return response.error('Match not found.')
    }

    return { match }
  }

  function getOponentId(match, playerId) {
    return Object.keys(match.players).find(id => id !== playerId)
  }

  function getPlayerIdByMarker(players, marker) {
    const [id = null] = Object.entries(players).find(
      ([id, player]) => player?.marker === marker
    ) || []

    return id
  }

  function cleanMatchState(match = {}, isRematch = false) {
    const lastWinnerMarker = match.players[match.lastWinnerId]?.marker || 0
    return {
      ...match,
      playsHistory: [[], []],
      cells: new Array(9).fill({lastTouched: null, active: false}),
      currentPlayer: getPlayerIdByMarker(
        match.players,
        isRematch ? lastWinnerMarker : 0
      ),
    }
  }
  
  socket.on('match:create', (playerName, cb) => {
    const matchId = generateId()
    const playerId = generateId()


    activePlayers.set(playerId, {socketId: socket.id, matchId})

    matches.set(
      matchId,
      cleanMatchState({
        players: {
          [playerId]: {
            marker: 0,
            name: playerName,
            wins: 0,
            isReady: false,
            socketId: socket.id,
          }
        },
        lastWinnerId: undefined,
      })
    )

    console.log('Match created', matches)

    cb(
      response.success({ matchId, playerId })
    )
  })

  socket.on('match:join', (matchId, playerName, playerId, cb) => {
    const matchToJoin = matches.get(matchId.toUpperCase())
    
    if (!matchToJoin) {
      return cb(
        response.error('Match not found')
      )
    }

    const matchIsFull = Object.entries(matchToJoin.players).length > 1

    if (matchIsFull) {
      return cb(
        response.error('Match is full')
      )
    }

    const newPlayerId = playerId || generateId()

    activePlayers.set(
      newPlayerId,
      {socketId: socket.id, matchId}
    )

    matches.set(
      matchId,
      updateMatch(
        matchToJoin,
        {
          players: {
            [newPlayerId]: {
              marker: 1,
              name: playerName,
              wins: 0,
              isReady: false,
            }
          }
        }
      )
    )

    console.log('Joined match', matchId, playerName, matches)

    cb(
      response.success({playerId: newPlayerId})
    )
  })

  socket.on('match:lobby', (matchId, playerId, cb) => {
    const res = getMatch(matchId)

    if (res.error) {
      return cb(
        response.error(`${res.error} Redirecting...`)
      )
    }

    const { match } = res

    if (!match.players[playerId]) {
      return cb(
        response.error('You are not allowed to play this match')
      )
    }

    const { reconnectionLimit } = match.players[playerId]

    // If the user was previously disconnected
    if (reconnectionLimit !== undefined) {

      // Exceeded disconnection time
      if (reconnectionLimit < new Date().getTime()) {
        const { ...playersObj } = match.players
        delete playersObj[playerId]

        matches.set(
          matchId,
          updateMatch(
            match,
            {
              players: playersObj
            }
          )
        )

        return cb(
          response.error('Reconnection time window exceeded')
        )
      }

      matches.set(
        matchId,
        updateMatch(
          match,
          {
            players: {
              [playerId]: {
                disconnected: false
              }
            }
          }
        )
      )
    }
    
    activePlayers.set(playerId,
      {
        socketId: socket.id,
        matchId
      }
    )

    socket.join(matchId)

    emitMatchState(matchId)

    cb(
      response.success(true)
    )
  })

  socket.on('match:player:toggleReady', (matchId, playerId) => {
    const res = getMatch(matchId)

    if (res.error) {
      return
    }

    const { match } = res

    matches.set(
      matchId,
      updateMatch(
        match,
        {
          players: {
            [playerId]: {
              isReady: (prev) => !prev
            }
          }
        }
      )
    )

    emitMatchState(matchId)
  })

  socket.on('match:play', (matchId, matchUpdates) => {
    const res = getMatch(matchId)

    if (res.error) {
      return
    }

    const { match } = res

    matches.set(
      matchId,
      updateMatch(
        match,
        {
          cells: matchUpdates.cells,
          playsHistory: matchUpdates.playsHistory,
          currentPlayer: matchUpdates.currentPlayer,
        }
      )
    )

    emitMatchState(matchId)
  })

  socket.on('match:win', (matchId, matchUpdates, playerId) => {
    const res = getMatch(matchId)

    if (res.error) {
      return
    }

    const { match } = res

    const oponentId = getOponentId(match, playerId)

    matches.set(
      matchId,
      updateMatch(
        match,
        {
          cells: matchUpdates.cells,
          playsHistory: matchUpdates.playsHistory,
          currentPlayer: matchUpdates.currentPlayer,
          players: {
            [playerId]: {
              isReady: false,
              wins: prev => prev + 1
            },
            [oponentId]: {
              isReady: false,
            }
          },
          lastWinnerId: matchUpdates.lastWinnerId
        }
      )
    )

    const updatedMatch = matches.get(matchId)

    console.log('[EMIT]: match:end')
    io.to(matchId).emit(
      'match:end',
      updatedMatch,
      playerId
    )
  })

  socket.on('match:rematch', (matchId, playerId, wantsToPlayAgain) => {
    const res = getMatch(matchId)

    if (res.error) {
      return
    }

    const { match } = res

    if (!wantsToPlayAgain) {
      matches.delete(matchId)
      activePlayers.delete(playerId)
      
      socket.leave(matchId)
      console.log('[EMIT]: match:exit')
      io.to(matchId).emit('match:exit')
      return
    } else {
      const oponentId = getOponentId(match, playerId)

      if (match.players[oponentId].isReady) {
        const cleanMatch = cleanMatchState(match, true)
        matches.set(
          matchId,
          updateMatch(
            cleanMatch,
            {
              players: {
                [playerId]: {
                  isReady: true
                }
              }
            }
          )
        )

        console.log('[EMIT]: match:reset')
        return io.to(matchId).emit('match:reset', matches.get(matchId))
      }
    }

    matches.set(
      matchId,
      updateMatch(
        match,
        {
          players: {
            [playerId]: {
              isReady: true
            }
          }
        }
      )
    )

    emitMatchState(matchId)
  })

  socket.on('player:room:leave', (matchId, playerId) => {
    activePlayers.delete(playerId)
    socket.leave(matchId)
  })

  socket.on('disconnect', () => {
    const { playerId, matchId } = getPlayerIdBySocketId(socket.id)

    console.log(
      'Disonnected:',
      {playerId, socketId: socket.id},
      activePlayers
    )
    if (!playerId) return
  
    const match = matches.get(matchId)
    const {...playersObject} = match?.players || {}

    // If there's still one player in the match
    if (Object.keys(playersObject).length > 1) {
      const now = new Date()
      const currentMilliseconds = now.getMilliseconds()
      matches.set(
        matchId,
        updateMatch(
          match,
          {
            players: {
              [playerId]: {
                disconnected: true,
                reconnectionLimit: now.setMilliseconds(currentMilliseconds + DISCONNECTION_TIME_ALLOWED)
              }
            }
          }
        )
      )

      /**
       * Once the allowed disconnection time allowed passes,
       * delete the match if the disconnected user didn't
       * come back
       */
      setTimeout(() => {
        const match = matches.get(matchId)

        if (match && match.players[playerId].disconnected) {
          io.to(matchId).emit('match:exit')
          matches.delete(matchId)
        }
      }, DISCONNECTION_TIME_ALLOWED)
    } else {
      matches.delete(matchId)
    }
    activePlayers.delete(playerId)

    /**Removing all matches if there is no player
     * just in case*/
    if (!activePlayers.size) {
      matches.clear()
    }

    emitMatchState(matchId)
  })
}
