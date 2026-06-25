const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (username) => {
        let roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = {
            id: roomId,
            level: 1,
            players: {
                slot1: { id: socket.id, name: username, x: 150, y: 300, state: 'idle', frame: 0, dir: 1, hp: 100, maxHp: 100, dmg: 10 },
                slot2: null
            }
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, slot: 'slot1', roomData: rooms[roomId] });
    });

    socket.on('joinRoom', ({ roomId, username }) => {
        if (rooms[roomId]) {
            if (!rooms[roomId].players.slot2) {
                rooms[roomId].players.slot2 = { id: socket.id, name: username, x: 100, y: 300, state: 'idle', frame: 0, dir: 1, hp: 100, maxHp: 100, dmg: 10 };
                socket.join(roomId);
                io.to(roomId).emit('roomUpdated', rooms[roomId]);
                socket.emit('joinSuccess', { roomId, slot: 'slot2', roomData: rooms[roomId] });
            } else {
                socket.emit('errorMsg', 'Phòng đã đầy rồi bạn ơi!');
            }
        } else {
            socket.emit('errorMsg', 'Mã phòng không tồn tại!');
        }
    });

    socket.on('playerUpdate', ({ roomId, slot, playerData }) => {
        if (rooms[roomId] && rooms[roomId].players[slot]) {
            rooms[roomId].players[slot] = { ...rooms[roomId].players[slot], ...playerData };
            socket.to(roomId).emit('peerUpdate', { slot, playerData });
        }
    });

    socket.on('startGame', (roomId) => {
        if (rooms[roomId]) {
            io.to(roomId).emit('gameStarted');
        }
    });

    socket.on('nextLevel', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].level += 1;
            for (let slot in rooms[roomId].players) {
                if (rooms[roomId].players[slot]) {
                    rooms[roomId].players[slot].maxHp = Math.round(rooms[roomId].players[slot].maxHp * 1.5);
                    rooms[roomId].players[slot].hp = rooms[roomId].players[slot].maxHp;
                    rooms[roomId].players[slot].dmg = Math.round(rooms[roomId].players[slot].dmg * 1.5);
                }
            }
            io.to(roomId).emit('levelUp', { level: rooms[roomId].level, roomData: rooms[roomId] });
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            if (rooms[roomId].players.slot1?.id === socket.id || rooms[roomId].players.slot2?.id === socket.id) {
                io.to(roomId).emit('playerLeft');
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
